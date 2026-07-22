import { describe, expect, it } from "vitest";
import { playbackPositionAt, rebasePlaybackClock } from "./playback-clock";

const playing = (positionMs: number, sessionId = "session-1", lastAppliedRevision = 1) => ({
  state: "playing" as const,
  sessionId,
  positionMs,
  durationMs: 10_000,
  lastAppliedRevision,
});

describe("playback clock", () => {
  it("advances continuously between device reports", () => {
    const clock = rebasePlaybackClock(undefined, playing(1_000), 5_000);
    expect(playbackPositionAt(clock, 5_400)).toBe(1_400);
  });

  it("ignores position reports during uninterrupted playback", () => {
    const initial = rebasePlaybackClock(undefined, playing(1_000), 5_000);
    const rebased = rebasePlaybackClock(initial, playing(1_700), 6_000);

    expect(playbackPositionAt(rebased, 6_000)).toBe(2_000);
    expect(playbackPositionAt(rebased, 6_300)).toBe(2_300);
  });

  it("re-anchors on pause, resume, and session changes", () => {
    const initial = rebasePlaybackClock(undefined, playing(4_000), 1_000);
    const paused = rebasePlaybackClock(initial, { ...playing(4_500), state: "paused" }, 2_000);
    const resumed = rebasePlaybackClock(paused, playing(4_500), 3_000);
    const newSession = rebasePlaybackClock(initial, playing(200, "session-2"), 2_000);
    const restarted = rebasePlaybackClock(initial, playing(0, "session-1", 2), 4_000);

    expect(playbackPositionAt(paused, 3_000)).toBe(4_500);
    expect(playbackPositionAt(resumed, 3_400)).toBe(4_900);
    expect(playbackPositionAt(newSession, 2_000)).toBe(200);
    expect(playbackPositionAt(restarted, 4_000)).toBe(0);
  });

  it("clamps playback to the artifact duration", () => {
    const clock = rebasePlaybackClock(undefined, playing(9_900), 1_000);
    expect(playbackPositionAt(clock, 2_000)).toBe(10_000);
  });
});
