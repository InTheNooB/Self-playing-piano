#pragma once

#include <Arduino.h>

#include "artifact.h"
#include "spi_transport.h"

namespace spp {

enum class CommandType : uint8_t {
  kPlay,
  kPause,
  kResume,
  kRestart,
  kStop,
  kEnterProvisioning,
  kInvalid,
};

enum class DeviceState : uint8_t {
  kBooting,
  kProvisioning,
  kConnecting,
  kIdle,
  kPreparing,
  kReady,
  kPlaying,
  kPaused,
  kStopping,
  kError,
};

struct DesiredCommand {
  CommandType type = CommandType::kInvalid;
  uint32_t revision = 0;
  char commandId[37]{};
  char sessionId[37]{};
  char songId[37]{};
  char artifactId[37]{};
  char artifactSha256[65]{};
  uint32_t artifactBytes = 0;
};

struct PlaybackSnapshot {
  DeviceState state;
  uint32_t positionMs;
  uint32_t durationMs;
  uint32_t lastAppliedRevision;
  const char* commandId;
  const char* sessionId;
  const char* songId;
  const char* errorCode;
  const char* errorMessage;
};

class PlaybackController {
 public:
  PlaybackController(SpiTransport& transport, ArtifactDownloader& downloader)
      : transport_(transport), downloader_(downloader) {}

  void begin(uint32_t lastAppliedRevision);
  bool handle(const DesiredCommand& command);
  void tick();
  void setConnectivityState(DeviceState state);
  PlaybackSnapshot snapshot() const;
  bool consumeDirty();
  bool idle() const { return state_ == DeviceState::kIdle; }

 private:
  struct PendingOff {
    uint32_t timeMs;
    uint8_t keyIndex;
  };
  static constexpr uint8_t kMaxPendingOffs = 10;
  static constexpr uint32_t kLookAheadMs = 750;

  SpiTransport& transport_;
  ArtifactDownloader& downloader_;
  Artifact artifact_;
  DeviceState state_ = DeviceState::kBooting;
  uint32_t cursor_ = 0;
  uint32_t basePositionMs_ = 0;
  uint32_t startedAtMs_ = 0;
  uint32_t lastHeartbeatMs_ = 0;
  uint32_t lastAppliedRevision_ = 0;
  PendingOff pendingOffs_[kMaxPendingOffs]{};
  uint8_t pendingOffCount_ = 0;
  char commandId_[37]{};
  char sessionId_[37]{};
  char songId_[37]{};
  char errorCode_[48]{};
  char errorMessage_[160]{};
  bool dirty_ = true;

  void transition(DeviceState state);
  void fail(const char* code, const String& message);
  void resetScheduler(uint32_t positionMs);
  void stopSafely(DeviceState finalState);
  uint32_t positionMs() const;
  bool scheduleNext(uint32_t windowEndMs);
  int8_t earliestOffIndex() const;
  void removeOff(uint8_t index);
  void addOff(uint32_t timeMs, uint8_t keyIndex);
};

const char* stateName(DeviceState state);
CommandType commandTypeFrom(const char* value);

}  // namespace spp
