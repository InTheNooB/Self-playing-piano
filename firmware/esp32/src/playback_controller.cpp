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

const char* acknowledgementName(AcknowledgementResult result) {
  if (result == AcknowledgementResult::kAccepted) return "accepted";
  if (result == AcknowledgementResult::kRejected) return "rejected";
  return "";
}

const char* sessionOutcomeName(SessionOutcome outcome) {
  if (outcome == SessionOutcome::kCompleted) return "completed";
  if (outcome == SessionOutcome::kStopped) return "stopped";
  if (outcome == SessionOutcome::kFailed) return "failed";
  return "";
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

void PlaybackController::begin(uint32_t lastAppliedRevision, uint32_t lastHandledRevision) {
  lastAppliedRevision_ = lastAppliedRevision;
  lastHandledRevision_ = max(lastAppliedRevision, lastHandledRevision);
  const uint32_t startedAt = millis();
  bool stopped = false;
  do {
    stopped = stopNano();
    if (!stopped) delay(50);
  } while (!stopped && millis() - startedAt < 3000);
  if (!stopped) {
    strlcpy(errorCode_, "nano_unavailable", sizeof(errorCode_));
    strlcpy(errorMessage_, "Nano did not acknowledge startup all-off", sizeof(errorMessage_));
    transition(DeviceState::kError);
    return;
  }
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

bool PlaybackController::stopNano() {
  pendingOffCount_ = 0;
  return transport_.flushAllOff() == SpiResult::kOk;
}

void PlaybackController::fail(const char* code, const String& message) {
  stopNano();
  strlcpy(errorCode_, code, sizeof(errorCode_));
  strlcpy(errorMessage_, message.c_str(), sizeof(errorMessage_));
  if (sessionId_[0] != '\0') sessionOutcome_ = SessionOutcome::kFailed;
  transition(DeviceState::kError);
}

void PlaybackController::accept(const DesiredCommand& command) {
  lastHandledRevision_ = command.revision;
  lastAppliedRevision_ = command.revision;
  acknowledgementRevision_ = command.revision;
  acknowledgementResult_ = AcknowledgementResult::kAccepted;
  strlcpy(acknowledgementCommandId_, command.commandId, sizeof(acknowledgementCommandId_));
  acknowledgementErrorCode_[0] = '\0';
  acknowledgementErrorMessage_[0] = '\0';
  dirty_ = true;
}

void PlaybackController::reject(const DesiredCommand& command, const char* code,
                                const char* message) {
  lastHandledRevision_ = command.revision;
  acknowledgementRevision_ = command.revision;
  acknowledgementResult_ = AcknowledgementResult::kRejected;
  strlcpy(acknowledgementCommandId_, command.commandId, sizeof(acknowledgementCommandId_));
  strlcpy(acknowledgementErrorCode_, code, sizeof(acknowledgementErrorCode_));
  strlcpy(acknowledgementErrorMessage_, message, sizeof(acknowledgementErrorMessage_));
  dirty_ = true;
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

CommandHandling PlaybackController::handle(const DesiredCommand& command) {
  if (command.revision <= lastHandledRevision_) return CommandHandling::kDuplicate;
  if (command.expired) {
    reject(command, "command_expired", "The retained command has expired");
    return CommandHandling::kRejected;
  }
  if (command.type == CommandType::kInvalid) {
    reject(command, "invalid_command", "The command type is invalid");
    return CommandHandling::kRejected;
  }

  if (command.type == CommandType::kStop) {
    if (sessionId_[0] == '\0') strlcpy(sessionId_, command.sessionId, sizeof(sessionId_));
    const uint32_t stoppedPosition = positionMs();
    transition(DeviceState::kStopping);
    if (!stopNano()) {
      reject(command, "nano_unavailable", "Nano did not acknowledge all-off");
      fail("nano_unavailable", "Nano did not acknowledge Stop");
      return CommandHandling::kRejected;
    }
    basePositionMs_ = stoppedPosition;
    sessionOutcome_ = SessionOutcome::kStopped;
    errorCode_[0] = '\0';
    errorMessage_[0] = '\0';
    accept(command);
    transition(DeviceState::kIdle);
    return CommandHandling::kAccepted;
  }

  if (command.type != CommandType::kPlay && command.type != CommandType::kEnterProvisioning &&
      strcmp(command.sessionId, sessionId_) != 0) {
    reject(command, "session_mismatch", "The active session does not match");
    return CommandHandling::kRejected;
  }

  switch (command.type) {
    case CommandType::kPlay:
      if (state_ != DeviceState::kIdle) {
        reject(command, "piano_busy", "The piano is not idle");
        return CommandHandling::kRejected;
      }
      strlcpy(sessionId_, command.sessionId, sizeof(sessionId_));
      strlcpy(songId_, command.songId, sizeof(songId_));
      errorCode_[0] = '\0';
      errorMessage_[0] = '\0';
      sessionOutcome_ = SessionOutcome::kNone;
      artifact_.clear();
      resetScheduler(0);
      accept(command);
      transition(DeviceState::kPreparing);
      return CommandHandling::kDownloadArtifact;
    case CommandType::kPause:
      if (state_ != DeviceState::kPlaying) {
        reject(command, "invalid_state", "Pause requires active playback");
        return CommandHandling::kRejected;
      }
      basePositionMs_ = positionMs();
      if (!stopNano()) {
        reject(command, "nano_unavailable", "Nano did not acknowledge Pause");
        fail("nano_unavailable", "Nano did not acknowledge Pause");
        return CommandHandling::kRejected;
      }
      accept(command);
      transition(DeviceState::kPaused);
      return CommandHandling::kAccepted;
    case CommandType::kResume:
      if (state_ != DeviceState::kPaused) {
        reject(command, "invalid_state", "Resume requires paused playback");
        return CommandHandling::kRejected;
      }
      resetScheduler(basePositionMs_);
      if (transport_.syncClock(basePositionMs_) != SpiResult::kOk || !transport_.clockRunning()) {
        reject(command, "nano_unavailable", "Nano did not acknowledge Resume");
        fail("nano_unavailable", "Nano did not acknowledge Resume");
        return CommandHandling::kRejected;
      }
      accept(command);
      transition(DeviceState::kPlaying);
      return CommandHandling::kAccepted;
    case CommandType::kRestart:
      if (state_ != DeviceState::kPlaying && state_ != DeviceState::kPaused) {
        reject(command, "invalid_state", "Restart requires an active session");
        return CommandHandling::kRejected;
      }
      if (!stopNano()) {
        reject(command, "nano_unavailable", "Nano did not acknowledge Restart all-off");
        fail("nano_unavailable", "Nano did not acknowledge Restart");
        return CommandHandling::kRejected;
      }
      resetScheduler(0);
      if (transport_.syncClock(0) != SpiResult::kOk || !transport_.clockRunning()) {
        reject(command, "nano_unavailable", "Nano did not acknowledge Restart clock");
        fail("nano_unavailable", "Nano did not acknowledge Restart");
        return CommandHandling::kRejected;
      }
      accept(command);
      transition(DeviceState::kPlaying);
      return CommandHandling::kAccepted;
    case CommandType::kEnterProvisioning:
      if (state_ != DeviceState::kIdle) {
        reject(command, "invalid_state", "Provisioning requires an idle piano");
        return CommandHandling::kRejected;
      }
      accept(command);
      return CommandHandling::kEnterProvisioning;
    case CommandType::kStop:
    case CommandType::kInvalid:
      break;
  }
  reject(command, "invalid_command", "The command could not be handled");
  return CommandHandling::kRejected;
}

void PlaybackController::artifactReady(const DesiredCommand& command, Artifact&& artifact) {
  if (state_ != DeviceState::kPreparing || command.revision != lastAppliedRevision_ ||
      strcmp(command.sessionId, sessionId_) != 0) return;
  artifact_ = std::move(artifact);
  resetScheduler(0);
  if (transport_.syncClock(0) != SpiResult::kOk || !transport_.clockRunning()) {
    fail("nano_unavailable", "Nano did not acknowledge clock synchronization");
    return;
  }
  transition(DeviceState::kReady);
  transition(DeviceState::kPlaying);
}

void PlaybackController::artifactFailed(const DesiredCommand& command, const char* message) {
  if (state_ != DeviceState::kPreparing || command.revision != lastAppliedRevision_ ||
      strcmp(command.sessionId, sessionId_) != 0) return;
  fail("artifact_download_failed", message);
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
    fail("spi_protocol_error", "Nano rejected or failed to acknowledge a scheduled note");
    return false;
  }
  return true;
}

void PlaybackController::tick() {
  if (millis() - lastHeartbeatMs_ >= 400) {
    const SpiResult heartbeat = transport_.heartbeat();
    if (state_ == DeviceState::kError && sessionId_[0] == '\0' &&
        heartbeat == SpiResult::kClockStopped && transport_.hardwareReady() && stopNano()) {
      errorCode_[0] = '\0';
      errorMessage_[0] = '\0';
      transition(DeviceState::kIdle);
      lastHeartbeatMs_ = millis();
      return;
    }
    if (state_ == DeviceState::kPlaying &&
        (heartbeat != SpiResult::kOk || !transport_.clockRunning())) {
      fail("nano_timeout", "Nano stopped or failed to acknowledge its heartbeat");
      return;
    }
    if (heartbeat == SpiResult::kHardwareUnavailable && state_ != DeviceState::kError) {
      fail("nano_hardware_unavailable", "Nano reports unavailable PCA hardware");
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
    stopNano();
    sessionOutcome_ = SessionOutcome::kCompleted;
    transition(DeviceState::kIdle);
  }
}

PlaybackSnapshot PlaybackController::snapshot() const {
  PlaybackSnapshot result{};
  result.state = state_;
  result.positionMs = positionMs();
  result.durationMs = artifact_.durationMs();
  result.lastAppliedRevision = lastAppliedRevision_;
  result.lastHandledRevision = lastHandledRevision_;
  result.acknowledgementRevision = acknowledgementRevision_;
  result.acknowledgementResult = acknowledgementResult_;
  result.sessionOutcome = sessionOutcome_;
  strlcpy(result.acknowledgementCommandId, acknowledgementCommandId_, sizeof(result.acknowledgementCommandId));
  strlcpy(result.acknowledgementErrorCode, acknowledgementErrorCode_, sizeof(result.acknowledgementErrorCode));
  strlcpy(result.acknowledgementErrorMessage, acknowledgementErrorMessage_, sizeof(result.acknowledgementErrorMessage));
  strlcpy(result.sessionId, sessionId_, sizeof(result.sessionId));
  strlcpy(result.songId, songId_, sizeof(result.songId));
  strlcpy(result.errorCode, errorCode_, sizeof(result.errorCode));
  strlcpy(result.errorMessage, errorMessage_, sizeof(result.errorMessage));
  return result;
}

bool PlaybackController::consumeDirty() {
  const bool result = dirty_;
  dirty_ = false;
  return result;
}

}  // namespace spp
