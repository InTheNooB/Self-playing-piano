#pragma once

#include <Arduino.h>
#include <SPI.h>

#include "spp_spi_protocol.h"

namespace spp {

enum class SpiResult : uint8_t {
  kOk,
  kBufferFull,
  kRejected,
  kUnavailable,
  kClockStopped,
  kHardwareUnavailable,
};

class SpiTransport {
 public:
  void begin();
  SpiResult syncClock(uint32_t positionMs);
  SpiResult sendNote(bool on, uint8_t keyIndex, uint8_t velocity, uint32_t timeMs);
  SpiResult flushAllOff();
  SpiResult heartbeat();
  uint8_t freeSlots() const { return freeSlots_; }
  bool clockRunning() const { return clockRunning_; }
  bool hardwareReady() const { return hardwareReady_; }

 private:
  static constexpr uint8_t kClockPin = 14;
  static constexpr uint8_t kMisoPin = 12;
  static constexpr uint8_t kMosiPin = 13;
  static constexpr uint8_t kSelectPin = 32;

  uint8_t sequence_ = 0;
  uint8_t freeSlots_ = 0;
  bool clockRunning_ = false;
  bool hardwareReady_ = false;

  SpiResult send(const Frame& frame, uint32_t timeoutMs);
  void transfer(const Frame& outgoing, Frame& incoming);
  SpiResult interpret(const Frame& response, uint8_t expectedSequence);
};

}  // namespace spp
