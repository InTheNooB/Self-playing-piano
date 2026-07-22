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
volatile bool g_captureTransaction = false;

spp::EventQueue<kQueueCapacity> g_events;
spp::SolenoidDriver g_solenoids;
uint8_t g_responseSequence = 0;
uint8_t g_lastExecutedSequence = 0;
bool g_hasExecutedSequence = false;
spp::MessageType g_lastResult = spp::MessageType::kAck;
spp::ErrorCode g_lastError = spp::ErrorCode::kNone;
spp::MessageType g_executedResult = spp::MessageType::kAck;
spp::ErrorCode g_executedError = spp::ErrorCode::kNone;
uint32_t g_clockPositionMs = 0;
uint32_t g_clockStartedAtMs = 0;
uint32_t g_lastHeartbeatMs = 0;
bool g_clockRunning = false;

uint8_t statusFlags() {
  uint8_t flags = 0;
  if (g_clockRunning) flags |= spp::StatusFlag::kClockRunning;
  if (g_solenoids.ready()) flags |= spp::StatusFlag::kHardwareReady;
  return flags;
}

void setResponse(const spp::Frame& response) {
  ATOMIC_BLOCK(ATOMIC_RESTORESTATE) {
    for (uint8_t index = 0; index < spp::kFrameSize; ++index) {
      g_responseFrame.bytes[index] = response.bytes[index];
    }
    if (digitalRead(SS) == HIGH) SPDR = g_responseFrame.bytes[0];
  }
}

void publishResponse() {
  setResponse(spp::makeResponse(g_lastResult, g_responseSequence, g_events.freeSlots(),
                                g_lastError, statusFlags()));
}

void setCommandResult(uint8_t sequence, spp::MessageType result,
                      spp::ErrorCode error = spp::ErrorCode::kNone,
                      bool executed = true) {
  g_responseSequence = sequence;
  g_lastResult = result;
  g_lastError = error;
  if (executed) {
    g_lastExecutedSequence = sequence;
    g_hasExecutedSequence = true;
    g_executedResult = result;
    g_executedError = error;
  }
  publishResponse();
}

void allOffAndStop() {
  g_events.clear();
  g_clockRunning = false;
  g_solenoids.allOff();
}

void processFrame(const spp::Frame& frame) {
  spp::ErrorCode validationError = spp::ErrorCode::kNone;
  const uint8_t sequence = frame.bytes[3];
  if (!spp::validateFrame(frame, validationError)) {
    setCommandResult(sequence, spp::MessageType::kNack, validationError, false);
    return;
  }

  const auto type = static_cast<spp::MessageType>(frame.bytes[2]);
  if (type == spp::MessageType::kStatus) {
    publishResponse();
    return;
  }
  if (g_hasExecutedSequence && sequence == g_lastExecutedSequence) {
    g_responseSequence = sequence;
    g_lastResult = g_executedResult;
    g_lastError = g_executedError;
    publishResponse();
    return;
  }
  if (!g_solenoids.ready()) {
    setCommandResult(sequence, spp::MessageType::kNack, spp::ErrorCode::kHardwareUnavailable, false);
    return;
  }

  switch (type) {
    case spp::MessageType::kSyncClock:
      allOffAndStop();
      if (!g_solenoids.ready()) {
        setCommandResult(sequence, spp::MessageType::kNack, spp::ErrorCode::kHardwareUnavailable, false);
        return;
      }
      g_clockPositionMs = spp::readUint32(&frame.bytes[4]);
      g_clockStartedAtMs = millis();
      g_lastHeartbeatMs = millis();
      g_clockRunning = true;
      break;
    case spp::MessageType::kNoteOn:
    case spp::MessageType::kNoteOff: {
      if (!g_clockRunning) {
        setCommandResult(sequence, spp::MessageType::kNack, spp::ErrorCode::kHardwareUnavailable, false);
        return;
      }
      if (spp::outputForKey(frame.bytes[4]) == spp::kUnmappedOutput) {
        setCommandResult(sequence, spp::MessageType::kNack, spp::ErrorCode::kInvalidKey);
        return;
      }
      const spp::ScheduledEvent event{
          spp::readUint32(&frame.bytes[6]), frame.bytes[4], frame.bytes[5],
          type == spp::MessageType::kNoteOn};
      if (!g_events.push(event)) {
        setCommandResult(sequence, spp::MessageType::kNack, spp::ErrorCode::kBufferFull, false);
        return;
      }
      break;
    }
    case spp::MessageType::kFlushAllOff:
      allOffAndStop();
      if (!g_solenoids.ready()) {
        setCommandResult(sequence, spp::MessageType::kNack, spp::ErrorCode::kHardwareUnavailable);
        return;
      }
      break;
    case spp::MessageType::kHeartbeat:
      g_lastHeartbeatMs = millis();
      break;
    default:
      setCommandResult(sequence, spp::MessageType::kNack, spp::ErrorCode::kUnknownMessage);
      return;
  }

  setCommandResult(sequence, spp::MessageType::kAck);
}

void runScheduledEvents() {
  if (!g_clockRunning) return;
  if (millis() - g_lastHeartbeatMs > kCommunicationTimeoutMs) {
    allOffAndStop();
    publishResponse();
    return;
  }

  const uint32_t positionMs = g_clockPositionMs + (millis() - g_clockStartedAtMs);
  while (const spp::ScheduledEvent* event = g_events.front()) {
    if (static_cast<int32_t>(positionMs - event->timeMs) < 0) break;
    if (!g_solenoids.setKey(event->keyIndex, event->on, event->velocity)) {
      allOffAndStop();
      g_lastResult = spp::MessageType::kNack;
      g_lastError = spp::ErrorCode::kHardwareUnavailable;
      publishResponse();
      return;
    }
    g_events.pop();
  }
}

}  // namespace

ISR(PCINT0_vect) {
  if (PINB & _BV(PB2)) {
    g_spiIndex = 0;
    g_captureTransaction = false;
    SPDR = g_responseFrame.bytes[0];
    return;
  }
  g_spiIndex = 0;
  g_captureTransaction = !g_frameReady;
  SPDR = g_responseFrame.bytes[0];
}

ISR(SPI_STC_vect) {
  const uint8_t received = SPDR;
  if (g_captureTransaction && g_spiIndex < spp::kFrameSize) {
    g_receivedFrame.bytes[g_spiIndex] = received;
  }
  ++g_spiIndex;
  if (g_spiIndex >= spp::kFrameSize) {
    if (g_captureTransaction) g_frameReady = true;
    g_captureTransaction = false;
  }
  SPDR = g_spiIndex < spp::kFrameSize ? g_responseFrame.bytes[g_spiIndex] : 0;
}

void setup() {
  Serial.begin(9600);
  pinMode(MISO, OUTPUT);
  pinMode(MOSI, INPUT);
  pinMode(SCK, INPUT);
  pinMode(SS, INPUT);
  SPCR = _BV(SPE) | _BV(SPIE);
  PCICR |= _BV(PCIE0);
  PCMSK0 |= _BV(PCINT2);

  const bool hardwareReady = g_solenoids.begin();
  g_lastError = hardwareReady ? spp::ErrorCode::kNone : spp::ErrorCode::kHardwareUnavailable;
  g_lastResult = hardwareReady ? spp::MessageType::kAck : spp::MessageType::kNack;
  publishResponse();
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
    processFrame(frame);
  }
  runScheduledEvents();
}
