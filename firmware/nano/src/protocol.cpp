#include "protocol.h"

namespace spp {

uint16_t crc16(const uint8_t* data, uint8_t length) {
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

bool validateFrame(const Frame& frame, ErrorCode& error) {
  if (frame.bytes[0] != kFrameMagic) {
    error = ErrorCode::kBadMagic;
    return false;
  }
  if (frame.bytes[1] != kProtocolVersion) {
    error = ErrorCode::kBadVersion;
    return false;
  }
  const uint16_t expected = crc16(frame.bytes, kFrameSize - 2);
  const uint16_t actual = static_cast<uint16_t>(frame.bytes[10]) |
                          (static_cast<uint16_t>(frame.bytes[11]) << 8);
  if (expected != actual) {
    error = ErrorCode::kBadCrc;
    return false;
  }
  error = ErrorCode::kNone;
  return true;
}

Frame makeResponse(MessageType type, uint8_t sequence, uint8_t freeSlots,
                   ErrorCode error, bool playing) {
  Frame frame{};
  frame.bytes[0] = kFrameMagic;
  frame.bytes[1] = kProtocolVersion;
  frame.bytes[2] = static_cast<uint8_t>(type);
  frame.bytes[3] = sequence;
  frame.bytes[4] = sequence;
  frame.bytes[5] = freeSlots;
  frame.bytes[6] = playing ? 1 : 0;
  frame.bytes[7] = static_cast<uint8_t>(error);
  const uint16_t crc = crc16(frame.bytes, kFrameSize - 2);
  frame.bytes[10] = crc & 0xFF;
  frame.bytes[11] = crc >> 8;
  return frame;
}

uint32_t readUint32(const uint8_t* bytes) {
  return static_cast<uint32_t>(bytes[0]) |
         (static_cast<uint32_t>(bytes[1]) << 8) |
         (static_cast<uint32_t>(bytes[2]) << 16) |
         (static_cast<uint32_t>(bytes[3]) << 24);
}

}  // namespace spp
