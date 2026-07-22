import { describe, expect, it } from "vitest";
import type { ReportedState } from "@spp/contracts";
import type { DiagnosticsPiano } from "@/lib/diagnostics-types";
import { mergeLivePianoStatus } from "./live-diagnostics";

const pianoId = "00000000-0000-0000-0000-000000000001";
const stored: DiagnosticsPiano = {
  id: pianoId,
  name: "House Piano",
  state: "preparing",
  online: true,
  firmwareVersion: "old",
  profileId: "legacy-v1",
  positionMs: 0,
  durationMs: 1000,
  activeSessionId: "00000000-0000-0000-0000-000000000010",
  commandRevision: 8,
  lastAppliedRevision: 4,
  lastHandledRevision: 4,
  lastSeenAt: "2026-01-01T00:00:00.000Z",
  errorCode: null,
  errorMessage: null,
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const live = (overrides: Partial<ReportedState> = {}): ReportedState => ({
  pianoId,
  state: "error",
  online: true,
  sessionId: "00000000-0000-0000-0000-000000000010",
  songId: "00000000-0000-0000-0000-000000000020",
  positionMs: 12,
  durationMs: 1000,
  firmwareVersion: "new",
  profileId: "legacy-v1",
  lastAppliedRevision: 5,
  lastHandledRevision: 5,
  error: { code: "download_failed", message: "Exact device error" },
  reportedAt: "2026-01-01T00:00:10.000Z",
  ...overrides,
});

describe("mergeLivePianoStatus", () => {
  it("uses the live device state while retaining server-only metadata", () => {
    expect(mergeLivePianoStatus(stored, live())).toMatchObject({
      state: "error",
      errorMessage: "Exact device error",
      lastHandledRevision: 5,
      commandRevision: 8,
      name: "House Piano",
    });
  });

  it("clears a stale active session and error after a live idle report", () => {
    const idle = live({ state: "idle", sessionOutcome: "stopped" });
    delete idle.error;
    expect(mergeLivePianoStatus(stored, idle)).toMatchObject({
      state: "idle",
      activeSessionId: null,
      errorCode: null,
    });
  });

  it("does not merge a report for another piano", () => {
    expect(mergeLivePianoStatus(stored, live({ pianoId: "00000000-0000-0000-0000-000000000099" }))).toBe(stored);
  });
});
