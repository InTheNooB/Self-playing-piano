#pragma once

#include <Arduino.h>

namespace spp {

constexpr uint8_t kFrameMagic = 0xA5;
constexpr uint8_t kProtocolVersion = 1;
constexpr uint8_t kFrameSize = 12;

enum class MessageType : uint8_t {
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

enum class ErrorCode : uint8_t {
  kNone = 0,
  kBadMagic = 1,
  kBadVersion = 2,
  kBadCrc = 3,
  kBufferFull = 4,
  kInvalidKey = 5,
  kHardwareUnavailable = 6,
  kUnknownMessage = 7,
};

struct Frame {
  uint8_t bytes[kFrameSize];
};

uint16_t crc16(const uint8_t* data, uint8_t length);
bool validateFrame(const Frame& frame, ErrorCode& error);
Frame makeResponse(MessageType type, uint8_t sequence, uint8_t freeSlots,
                   ErrorCode error, bool playing);
uint32_t readUint32(const uint8_t* bytes);

}  // namespace spp
