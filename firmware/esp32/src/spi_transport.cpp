#include "spi_transport.h"

namespace spp {

void SpiTransport::begin() {
  pinMode(kSelectPin, OUTPUT);
  digitalWrite(kSelectPin, HIGH);
  SPI.begin(kClockPin, kMisoPin, kMosiPin, kSelectPin);
  delay(50);
  heartbeat();
}

uint16_t SpiTransport::crc16(const uint8_t* data, uint8_t length) {
  uint16_t crc = 0xFFFF;
  for (uint8_t index = 0; index < length; ++index) {
    crc ^= static_cast<uint16_t>(data[index]) << 8;
    for (uint8_t bit = 0; bit < 8; ++bit) {
      crc = (crc & 0x8000) ? static_cast<uint16_t>((crc << 1) ^ 0x1021)
                           : static_cast<uint16_t>(crc << 1);
    }
  }
  return crc;
}

bool SpiTransport::valid(const uint8_t* frame) {
  if (frame[0] != kMagic || frame[1] != kVersion) return false;
  const uint16_t expected = crc16(frame, kFrameSize - 2);
  const uint16_t actual = static_cast<uint16_t>(frame[10]) |
                          (static_cast<uint16_t>(frame[11]) << 8);
  return expected == actual;
}

void SpiTransport::transfer(const uint8_t* outgoing, uint8_t* incoming) {
  SPI.beginTransaction(SPISettings(500000, MSBFIRST, SPI_MODE0));
  digitalWrite(kSelectPin, LOW);
  delayMicroseconds(20);
  for (uint8_t index = 0; index < kFrameSize; ++index) {
    incoming[index] = SPI.transfer(outgoing[index]);
  }
  digitalWrite(kSelectPin, HIGH);
  SPI.endTransaction();
}

SpiResult SpiTransport::send(SpiMessageType type, uint8_t first, uint8_t second,
                             uint32_t value) {
  uint8_t frame[kFrameSize]{};
  uint8_t ignored[kFrameSize]{};
  uint8_t response[kFrameSize]{};
  const uint8_t sequence = ++sequence_;
  frame[0] = kMagic;
  frame[1] = kVersion;
  frame[2] = static_cast<uint8_t>(type);
  frame[3] = sequence;
  frame[4] = first;
  frame[5] = second;
  frame[6] = value & 0xFF;
  frame[7] = (value >> 8) & 0xFF;
  frame[8] = (value >> 16) & 0xFF;
  frame[9] = (value >> 24) & 0xFF;
  const uint16_t crc = crc16(frame, kFrameSize - 2);
  frame[10] = crc & 0xFF;
  frame[11] = crc >> 8;
  transfer(frame, ignored);

  delay(2);
  uint8_t poll[kFrameSize]{};
  poll[0] = kMagic;
  poll[1] = kVersion;
  poll[2] = static_cast<uint8_t>(SpiMessageType::kStatus);
  poll[3] = ++sequence_;
  const uint16_t pollCrc = crc16(poll, kFrameSize - 2);
  poll[10] = pollCrc & 0xFF;
  poll[11] = pollCrc >> 8;
  transfer(poll, response);

  if (!valid(response) || response[4] != sequence) return SpiResult::kUnavailable;
  freeSlots_ = response[5];
  if (response[2] == static_cast<uint8_t>(SpiMessageType::kAck)) return SpiResult::kOk;
  if (response[7] == 4) return SpiResult::kBufferFull;
  return SpiResult::kRejected;
}

SpiResult SpiTransport::syncClock(uint32_t positionMs) {
  return send(SpiMessageType::kSyncClock, 0, 0, positionMs);
}

SpiResult SpiTransport::sendNote(bool on, uint8_t keyIndex, uint8_t velocity,
                                 uint32_t timeMs) {
  return send(on ? SpiMessageType::kNoteOn : SpiMessageType::kNoteOff,
              keyIndex, velocity, timeMs);
}

SpiResult SpiTransport::flushAllOff() {
  return send(SpiMessageType::kFlushAllOff, 0, 0, 0);
}

SpiResult SpiTransport::heartbeat() {
  return send(SpiMessageType::kHeartbeat, 0, 0, 0);
}

}  // namespace spp
