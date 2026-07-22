import type { PianoState } from "@spp/contracts";

interface PlaybackTimingStatus {
  state: PianoState;
  sessionId?: string;
  positionMs: number;
  durationMs: number;
  lastAppliedRevision: number;
}

export interface PlaybackClock {
  state: PianoState;
  sessionId: string | undefined;
  positionMs: number;
  durationMs: number;
  lastAppliedRevision: number;
  anchoredAtMs: number;
}

export const playbackPositionAt = (clock: PlaybackClock, nowMs: number) => {
  const position = clock.positionMs +
    (clock.state === "playing" ? Math.max(0, nowMs - clock.anchoredAtMs) : 0);
  return Math.min(clock.durationMs || Number.MAX_SAFE_INTEGER, Math.max(0, position));
};

export const rebasePlaybackClock = (
  previous: PlaybackClock | undefined,
  status: PlaybackTimingStatus,
  nowMs: number,
): PlaybackClock => {
  const continuousPlayback = previous?.state === "playing" &&
    status.state === "playing" &&
    previous.sessionId === status.sessionId &&
    previous.lastAppliedRevision === status.lastAppliedRevision;
  if (continuousPlayback) {
    return {
      ...previous,
      durationMs: status.durationMs || previous.durationMs,
    };
  }

  return {
    state: status.state,
    sessionId: status.sessionId,
    positionMs: status.positionMs,
    durationMs: status.durationMs,
    lastAppliedRevision: status.lastAppliedRevision,
    anchoredAtMs: nowMs,
  };
};
