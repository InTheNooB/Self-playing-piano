import { describe, expect, it } from "vitest";
import { playbackPositionAt, rebasePlaybackClock } from "./playback-clock";

const playing = (positionMs: number, sessionId = "session-1") => ({
  state: "playing" as const,
  sessionId,
  positionMs,
  durationMs: 10_000,
});

describe("playback clock", () => {
  it("advances continuously between device reports", () => {
    const clock = rebasePlaybackClock(undefined, playing(1_000), 5_000);
    expect(playbackPositionAt(clock, 5_400)).toBe(1_400);
  });

  it("preserves the visible position and gradually corrects a delayed report", () => {
    const initial = rebasePlaybackClock(undefined, playing(1_000), 5_000);
    const rebased = rebasePlaybackClock(initial, playing(1_700), 6_000);

    expect(playbackPositionAt(rebased, 6_000)).toBe(2_000);
    expect(playbackPositionAt(rebased, 6_300)).toBeGreaterThan(2_000);
    expect(playbackPositionAt(rebased, 8_000)).toBe(3_700);
  });

  it("snaps on pause, session changes, and large discontinuities", () => {
    const initial = rebasePlaybackClock(undefined, playing(4_000), 1_000);
    const paused = rebasePlaybackClock(initial, { ...playing(4_500), state: "paused" }, 2_000);
    const newSession = rebasePlaybackClock(initial, playing(200, "session-2"), 2_000);
    const restarted = rebasePlaybackClock(initial, playing(0), 4_000);

    expect(playbackPositionAt(paused, 3_000)).toBe(4_500);
    expect(playbackPositionAt(newSession, 2_000)).toBe(200);
    expect(playbackPositionAt(restarted, 4_000)).toBe(0);
  });

  it("clamps playback to the artifact duration", () => {
    const clock = rebasePlaybackClock(undefined, playing(9_900), 1_000);
    expect(playbackPositionAt(clock, 2_000)).toBe(10_000);
  });
});
