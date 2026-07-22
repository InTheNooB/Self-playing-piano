#include "playback_controller.h"

namespace spp {

const char* stateName(DeviceState state) {
  switch (state) {
    case DeviceState::kBooting: return "booting";
    case DeviceState::kProvisioning: return "provisioning";
    case DeviceState::kConnecting: return "connecting";
    case DeviceState::kIdle: return "idle";
    case DeviceState::kPreparing: return "preparing";
    case DeviceState::kReady: return "ready";
    case DeviceState::kPlaying: return "playing";
    case DeviceState::kPaused: return "paused";
    case DeviceState::kStopping: return "stopping";
    case DeviceState::kError: return "error";
  }
  return "error";
}

CommandType commandTypeFrom(const char* value) {
  if (strcmp(value, "play") == 0) return CommandType::kPlay;
  if (strcmp(value, "pause") == 0) return CommandType::kPause;
  if (strcmp(value, "resume") == 0) return CommandType::kResume;
  if (strcmp(value, "restart") == 0) return CommandType::kRestart;
  if (strcmp(value, "stop") == 0) return CommandType::kStop;
  if (strcmp(value, "enter_provisioning") == 0) return CommandType::kEnterProvisioning;
  return CommandType::kInvalid;
}

void PlaybackController::begin(uint32_t lastAppliedRevision) {
  lastAppliedRevision_ = lastAppliedRevision;
  transport_.flushAllOff();
  transition(DeviceState::kIdle);
}

void PlaybackController::transition(DeviceState state) {
  state_ = state;
  dirty_ = true;
}

void PlaybackController::setConnectivityState(DeviceState state) {
  if (state_ != DeviceState::kIdle && state_ != DeviceState::kConnecting &&
      state_ != DeviceState::kProvisioning) return;
  transition(state);
}

void PlaybackController::fail(const char* code, const String& message) {
  transport_.flushAllOff();
  strlcpy(errorCode_, code, sizeof(errorCode_));
  strlcpy(errorMessage_, message.c_str(), sizeof(errorMessage_));
  transition(DeviceState::kError);
}

uint32_t PlaybackController::positionMs() const {
  if (state_ != DeviceState::kPlaying) return basePositionMs_;
  return basePositionMs_ + (millis() - startedAtMs_);
}

void PlaybackController::resetScheduler(uint32_t position) {
  cursor_ = 0;
  pendingOffCount_ = 0;
  ArtifactNote note{};
  while (cursor_ < artifact_.noteCount() && artifact_.noteAt(cursor_, note) && note.startMs < position) ++cursor_;
  basePositionMs_ = position;
  startedAtMs_ = millis();
}

void PlaybackController::stopSafely(DeviceState finalState) {
  const uint32_t stoppedPosition = positionMs();
  transition(DeviceState::kStopping);
  transport_.flushAllOff();
  pendingOffCount_ = 0;
  basePositionMs_ = stoppedPosition;
  transition(finalState);
}

bool PlaybackController::handle(const DesiredCommand& command) {
  if (command.revision <= lastAppliedRevision_) return true;
  if (command.type == CommandType::kInvalid) return false;

  if (command.type != CommandType::kPlay && command.type != CommandType::kEnterProvisioning &&
      strcmp(command.sessionId, sessionId_) != 0) {
    return false;
  }

  strlcpy(commandId_, command.commandId, sizeof(commandId_));
  errorCode_[0] = '\0';
  errorMessage_[0] = '\0';

  switch (command.type) {
    case CommandType::kPlay: {
      if (state_ != DeviceState::kIdle) return false;
      strlcpy(sessionId_, command.sessionId, sizeof(sessionId_));
      strlcpy(songId_, command.songId, sizeof(songId_));
      transition(DeviceState::kPreparing);
      String error;
      artifact_.clear();
      if (!downloader_.download(command.sessionId, command.artifactSha256,
                                command.artifactBytes, artifact_, error)) {
        lastAppliedRevision_ = command.revision;
        fail("artifact_download_failed", error);
        return true;
      }
      resetScheduler(0);
      if (transport_.syncClock(0) != SpiResult::kOk) {
        lastAppliedRevision_ = command.revision;
        fail("nano_unavailable", "Nano did not acknowledge clock synchronization");
        return true;
      }
      transition(DeviceState::kReady);
      transition(DeviceState::kPlaying);
      break;
    }
    case CommandType::kPause:
      if (state_ != DeviceState::kPlaying) return false;
      basePositionMs_ = positionMs();
      transport_.flushAllOff();
      pendingOffCount_ = 0;
      transition(DeviceState::kPaused);
      break;
    case CommandType::kResume:
      if (state_ != DeviceState::kPaused) return false;
      resetScheduler(basePositionMs_);
      if (transport_.syncClock(basePositionMs_) != SpiResult::kOk) {
        fail("nano_unavailable", "Nano did not acknowledge resume");
        break;
      }
      transition(DeviceState::kPlaying);
      break;
    case CommandType::kRestart:
      if (state_ != DeviceState::kPlaying && state_ != DeviceState::kPaused) return false;
      transport_.flushAllOff();
      resetScheduler(0);
      if (transport_.syncClock(0) != SpiResult::kOk) {
        fail("nano_unavailable", "Nano did not acknowledge restart");
        break;
      }
      transition(DeviceState::kPlaying);
      break;
    case CommandType::kStop:
      stopSafely(DeviceState::kIdle);
      break;
    case CommandType::kEnterProvisioning:
      if (state_ != DeviceState::kIdle) return false;
      break;
    case CommandType::kInvalid:
      return false;
  }

  lastAppliedRevision_ = command.revision;
  dirty_ = true;
  return true;
}

int8_t PlaybackController::earliestOffIndex() const {
  if (pendingOffCount_ == 0) return -1;
  uint8_t earliest = 0;
  for (uint8_t index = 1; index < pendingOffCount_; ++index) {
    if (pendingOffs_[index].timeMs < pendingOffs_[earliest].timeMs) earliest = index;
  }
  return earliest;
}

void PlaybackController::removeOff(uint8_t index) {
  if (index >= pendingOffCount_) return;
  pendingOffs_[index] = pendingOffs_[pendingOffCount_ - 1];
  --pendingOffCount_;
}

void PlaybackController::addOff(uint32_t timeMs, uint8_t keyIndex) {
  if (pendingOffCount_ >= kMaxPendingOffs) return;
  pendingOffs_[pendingOffCount_++] = PendingOff{timeMs, keyIndex};
}

bool PlaybackController::scheduleNext(uint32_t windowEndMs) {
  ArtifactNote nextNote{};
  const bool hasNote = cursor_ < artifact_.noteCount() && artifact_.noteAt(cursor_, nextNote);
  const int8_t offIndex = earliestOffIndex();
  const bool useOff = offIndex >= 0 && (!hasNote || pendingOffs_[offIndex].timeMs <= nextNote.startMs);
  const uint32_t eventTime = useOff ? pendingOffs_[offIndex].timeMs : (hasNote ? nextNote.startMs : UINT32_MAX);
  if (eventTime > windowEndMs) return false;

  SpiResult result;
  if (useOff) {
    result = transport_.sendNote(false, pendingOffs_[offIndex].keyIndex, 0, eventTime);
    if (result == SpiResult::kOk) removeOff(offIndex);
  } else {
    result = transport_.sendNote(true, nextNote.keyIndex, nextNote.velocity, nextNote.startMs);
    if (result == SpiResult::kOk) {
      addOff(nextNote.startMs + nextNote.durationMs, nextNote.keyIndex);
      ++cursor_;
    }
  }

  if (result == SpiResult::kBufferFull) return false;
  if (result != SpiResult::kOk) {
    fail("spi_protocol_error", "Nano rejected a scheduled note");
    return false;
  }
  return true;
}

void PlaybackController::tick() {
  if (millis() - lastHeartbeatMs_ >= 500) {
    if (transport_.heartbeat() == SpiResult::kUnavailable && state_ == DeviceState::kPlaying) {
      fail("nano_timeout", "Nano heartbeat timed out");
      return;
    }
    lastHeartbeatMs_ = millis();
  }
  if (state_ != DeviceState::kPlaying) return;

  const uint32_t currentPosition = positionMs();
  for (uint8_t count = 0; count < 24 && transport_.freeSlots() > 0; ++count) {
    if (!scheduleNext(currentPosition + kLookAheadMs)) break;
  }
  if (currentPosition >= artifact_.durationMs() && cursor_ >= artifact_.noteCount() && pendingOffCount_ == 0) {
    basePositionMs_ = artifact_.durationMs();
    stopSafely(DeviceState::kIdle);
  }
}

PlaybackSnapshot PlaybackController::snapshot() const {
  return PlaybackSnapshot{state_, positionMs(), artifact_.durationMs(),
                          lastAppliedRevision_, commandId_, sessionId_, songId_,
                          errorCode_, errorMessage_};
}

bool PlaybackController::consumeDirty() {
  const bool result = dirty_;
  dirty_ = false;
  return result;
}

}  // namespace spp
