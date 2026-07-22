#pragma once

#include <Arduino.h>
#include <memory>

namespace spp {

struct ArtifactNote {
  uint32_t startMs;
  uint32_t durationMs;
  uint8_t keyIndex;
  uint8_t velocity;
  uint8_t flags;
};

class Artifact {
 public:
  bool adopt(std::unique_ptr<uint8_t[]> data, size_t size, String& error);
  void clear();
  bool noteAt(uint32_t index, ArtifactNote& note) const;
  uint32_t noteCount() const { return noteCount_; }
  uint32_t durationMs() const { return durationMs_; }

 private:
  static constexpr size_t kHeaderSize = 16;
  static constexpr size_t kRecordSize = 12;
  std::unique_ptr<uint8_t[]> data_;
  size_t size_ = 0;
  uint32_t noteCount_ = 0;
  uint32_t durationMs_ = 0;

  static uint32_t readUint32(const uint8_t* bytes);
};

class ArtifactDownloader {
 public:
  bool download(const char* sessionId, const char* expectedSha256,
                size_t expectedBytes, Artifact& artifact, String& error);
};

}  // namespace spp
