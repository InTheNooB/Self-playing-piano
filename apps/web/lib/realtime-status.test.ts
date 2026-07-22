import { describe, expect, it } from "vitest";
import type { ReportedState } from "@spp/contracts";
import { reconcileRealtimeStatus } from "./realtime-status";

const status = (overrides: Partial<ReportedState> = {}): ReportedState => ({
  pianoId: "00000000-0000-0000-0000-000000000001",
  state: "idle",
  online: true,
  positionMs: 0,
  durationMs: 0,
  firmwareVersion: "test",
  profileId: "legacy-v1",
  lastAppliedRevision: 1,
  lastHandledRevision: 1,
  reportedAt: new Date().toISOString(),
  ...overrides,
});

describe("reconcileRealtimeStatus", () => {
  it("does not hide a cloud-reserved session behind a stale device heartbeat", () => {
    const current = status({ state: "preparing", sessionId: "00000000-0000-0000-0000-000000000010" });
    expect(reconcileRealtimeStatus(current, status()).sessionId).toBe(current.sessionId);
  });

  it("accepts a matching device session", () => {
    const sessionId = "00000000-0000-0000-0000-000000000010";
    expect(reconcileRealtimeStatus(status({ state: "preparing", sessionId }), status({ state: "playing", sessionId })).state).toBe("playing");
  });

  it("accepts an explicit newer rejection", () => {
    const current = status({ state: "preparing", sessionId: "00000000-0000-0000-0000-000000000010" });
    const incoming = status({ lastHandledRevision: 2, acknowledgement: { commandId: "00000000-0000-0000-0000-000000000020", revision: 2, result: "rejected" } });
    expect(reconcileRealtimeStatus(current, incoming).state).toBe("idle");
  });
});
