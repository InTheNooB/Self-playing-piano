import type { PianoState } from "@spp/contracts";

const DISCONTINUITY_MS = 1_500;
const MIN_CORRECTION_MS = 1_000;
const MAX_CORRECTION_RATE = 0.15;

interface PlaybackTimingStatus {
  state: PianoState;
  sessionId?: string;
  positionMs: number;
  durationMs: number;
}

export interface PlaybackClock {
  state: PianoState;
  sessionId: string | undefined;
  positionMs: number;
  durationMs: number;
  anchoredAtMs: number;
  correctionMs: number;
  correctionDurationMs: number;
}

const rawPositionAt = (clock: PlaybackClock, nowMs: number) =>
  clock.positionMs + (clock.state === "playing" ? Math.max(0, nowMs - clock.anchoredAtMs) : 0);

export const playbackPositionAt = (clock: PlaybackClock, nowMs: number) => {
  const elapsedMs = Math.max(0, nowMs - clock.anchoredAtMs);
  const correctionProgress = clock.correctionDurationMs > 0
    ? Math.min(1, elapsedMs / clock.correctionDurationMs)
    : 1;
  const corrected = rawPositionAt(clock, nowMs) + clock.correctionMs * (1 - correctionProgress);
  return Math.min(clock.durationMs || Number.MAX_SAFE_INTEGER, Math.max(0, corrected));
};

export const rebasePlaybackClock = (
  previous: PlaybackClock | undefined,
  status: PlaybackTimingStatus,
  nowMs: number,
): PlaybackClock => {
  const continuousPlayback = previous?.state === "playing" &&
    status.state === "playing" &&
    previous.sessionId === status.sessionId;
  const previousPosition = previous ? playbackPositionAt(previous, nowMs) : status.positionMs;
  const correctionMs = continuousPlayback ? previousPosition - status.positionMs : 0;
  const smoothCorrection = continuousPlayback && Math.abs(correctionMs) <= DISCONTINUITY_MS;

  return {
    state: status.state,
    sessionId: status.sessionId,
    positionMs: status.positionMs,
    durationMs: status.durationMs,
    anchoredAtMs: nowMs,
    correctionMs: smoothCorrection ? correctionMs : 0,
    correctionDurationMs: smoothCorrection
      ? Math.max(MIN_CORRECTION_MS, Math.abs(correctionMs) / MAX_CORRECTION_RATE)
      : 0,
  };
};
