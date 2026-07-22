#pragma once

#include <Arduino.h>
#include <SPI.h>

namespace spp {

enum class SpiMessageType : uint8_t {
  kNoop = 0x00,
  kSyncClock = 0x01,
  kNoteOn = 0x02,
  kNoteOff = 0x03,
  kFlushAllOff = 0x04,
  kHeartbeat = 0x05,
  kStatus = 0x06,
  kAck = 0x80,
  kNack = 0x81,
};

enum class SpiResult : uint8_t { kOk, kBufferFull, kRejected, kUnavailable };

class SpiTransport {
 public:
  void begin();
  SpiResult syncClock(uint32_t positionMs);
  SpiResult sendNote(bool on, uint8_t keyIndex, uint8_t velocity, uint32_t timeMs);
  SpiResult flushAllOff();
  SpiResult heartbeat();
  uint8_t freeSlots() const { return freeSlots_; }

 private:
  static constexpr uint8_t kFrameSize = 12;
  static constexpr uint8_t kMagic = 0xA5;
  static constexpr uint8_t kVersion = 1;
  static constexpr uint8_t kClockPin = 14;
  static constexpr uint8_t kMisoPin = 12;
  static constexpr uint8_t kMosiPin = 13;
  static constexpr uint8_t kSelectPin = 32;

  uint8_t sequence_ = 0;
  uint8_t freeSlots_ = 0;

  SpiResult send(SpiMessageType type, uint8_t first, uint8_t second, uint32_t value);
  void transfer(const uint8_t* outgoing, uint8_t* incoming);
  static uint16_t crc16(const uint8_t* data, uint8_t length);
  static bool valid(const uint8_t* frame);
};

}  // namespace spp
