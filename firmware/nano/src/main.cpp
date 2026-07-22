#include <Arduino.h>
#include <SPI.h>
#include <util/atomic.h>

#include "event_queue.h"
#include "note_mapping.h"
#include "protocol.h"
#include "solenoid_driver.h"

namespace {

constexpr uint8_t kQueueCapacity = 64;
constexpr uint32_t kCommunicationTimeoutMs = 2000;

volatile spp::Frame g_receivedFrame{};
volatile spp::Frame g_responseFrame{};
volatile uint8_t g_spiIndex = 0;
volatile bool g_frameReady = false;

spp::EventQueue<kQueueCapacity> g_events;
spp::SolenoidDriver g_solenoids;
uint8_t g_lastSequence = 0;
uint32_t g_clockPositionMs = 0;
uint32_t g_clockStartedAtMs = 0;
uint32_t g_lastHeartbeatMs = 0;
bool g_clockRunning = false;

void setResponse(const spp::Frame& response) {
  ATOMIC_BLOCK(ATOMIC_RESTORESTATE) {
    for (uint8_t index = 0; index < spp::kFrameSize; ++index) {
      g_responseFrame.bytes[index] = response.bytes[index];
    }
    SPDR = g_responseFrame.bytes[0];
  }
}

void allOffAndStop() {
  g_events.clear();
  g_clockRunning = false;
  g_solenoids.allOff();
}

void respond(spp::MessageType type, uint8_t sequence, spp::ErrorCode error = spp::ErrorCode::kNone) {
  setResponse(spp::makeResponse(type, sequence, g_events.freeSlots(), error, g_clockRunning));
}

void processFrame(const spp::Frame& frame) {
  spp::ErrorCode validationError = spp::ErrorCode::kNone;
  const uint8_t sequence = frame.bytes[3];
  if (!spp::validateFrame(frame, validationError)) {
    respond(spp::MessageType::kNack, sequence, validationError);
    return;
  }

  const auto type = static_cast<spp::MessageType>(frame.bytes[2]);
  if (sequence == g_lastSequence && type != spp::MessageType::kStatus) {
    respond(spp::MessageType::kAck, sequence);
    return;
  }

  switch (type) {
    case spp::MessageType::kSyncClock:
      allOffAndStop();
      g_clockPositionMs = spp::readUint32(&frame.bytes[4]);
      g_clockStartedAtMs = millis();
      g_lastHeartbeatMs = millis();
      g_clockRunning = true;
      break;
    case spp::MessageType::kNoteOn:
    case spp::MessageType::kNoteOff: {
      if (spp::outputForKey(frame.bytes[4]) == spp::kUnmappedOutput) {
        respond(spp::MessageType::kNack, sequence, spp::ErrorCode::kInvalidKey);
        return;
      }
      const spp::ScheduledEvent event{
          spp::readUint32(&frame.bytes[6]), frame.bytes[4], frame.bytes[5],
          type == spp::MessageType::kNoteOn};
      if (!g_events.push(event)) {
        respond(spp::MessageType::kNack, sequence, spp::ErrorCode::kBufferFull);
        return;
      }
      break;
    }
    case spp::MessageType::kFlushAllOff:
      allOffAndStop();
      break;
    case spp::MessageType::kHeartbeat:
      g_lastHeartbeatMs = millis();
      break;
    case spp::MessageType::kStatus:
      respond(spp::MessageType::kStatus, sequence);
      return;
    default:
      respond(spp::MessageType::kNack, sequence, spp::ErrorCode::kUnknownMessage);
      return;
  }

  g_lastSequence = sequence;
  respond(spp::MessageType::kAck, sequence);
}

void runScheduledEvents() {
  if (!g_clockRunning) return;
  if (millis() - g_lastHeartbeatMs > kCommunicationTimeoutMs) {
    allOffAndStop();
    return;
  }

  const uint32_t positionMs = g_clockPositionMs + (millis() - g_clockStartedAtMs);
  while (const spp::ScheduledEvent* event = g_events.front()) {
    if (static_cast<int32_t>(positionMs - event->timeMs) < 0) break;
    g_solenoids.setKey(event->keyIndex, event->on, event->velocity);
    g_events.pop();
  }
}

}  // namespace

ISR(SPI_STC_vect) {
  const uint8_t received = SPDR;
  if (!g_frameReady) g_receivedFrame.bytes[g_spiIndex] = received;
  ++g_spiIndex;
  if (g_spiIndex >= spp::kFrameSize) {
    g_spiIndex = 0;
    g_frameReady = true;
  }
  SPDR = g_responseFrame.bytes[g_spiIndex];
}

void setup() {
  Serial.begin(9600);
  pinMode(MISO, OUTPUT);
  pinMode(MOSI, INPUT);
  pinMode(SCK, INPUT);
  pinMode(SS, INPUT);
  SPCR = _BV(SPE) | _BV(SPIE);

  const bool hardwareReady = g_solenoids.begin();
  const auto error = hardwareReady ? spp::ErrorCode::kNone : spp::ErrorCode::kHardwareUnavailable;
  setResponse(spp::makeResponse(spp::MessageType::kStatus, 0, g_events.freeSlots(), error, false));
  Serial.println(hardwareReady ? F("Nano ready") : F("PCA initialization failed"));
}

void loop() {
  if (g_frameReady) {
    spp::Frame frame{};
    ATOMIC_BLOCK(ATOMIC_RESTORESTATE) {
      for (uint8_t index = 0; index < spp::kFrameSize; ++index) {
        frame.bytes[index] = g_receivedFrame.bytes[index];
      }
      g_frameReady = false;
    }
    if (!g_solenoids.ready()) {
      respond(spp::MessageType::kNack, frame.bytes[3], spp::ErrorCode::kHardwareUnavailable);
    } else {
      processFrame(frame);
    }
  }
  runScheduledEvents();
}
