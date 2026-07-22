import { describe, expect, it } from "vitest";
import type { ReportedState } from "@spp/contracts";
import { planStatusReconciliation } from "./status-reconciliation";

const report = (overrides: Partial<ReportedState> = {}): ReportedState => ({
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

describe("planStatusReconciliation", () => {
  it("does not unlock an active cloud session from an unrelated idle heartbeat", () => {
    const plan = planStatusReconciliation({ activeSessionId: "00000000-0000-0000-0000-000000000010", lastHandledRevision: 1 }, report());
    expect(plan.mayApplyRuntime).toBe(false);
    expect(plan.mayClearActiveSession).toBe(false);
  });

  it("clears only a matching completed or stopped session", () => {
    const sessionId = "00000000-0000-0000-0000-000000000010";
    const plan = planStatusReconciliation({ activeSessionId: sessionId, lastHandledRevision: 1 }, report({ sessionId, sessionOutcome: "stopped" }));
    expect(plan.mayClearActiveSession).toBe(true);
  });

  it("retains a failed session until Stop", () => {
    const sessionId = "00000000-0000-0000-0000-000000000010";
    const plan = planStatusReconciliation({ activeSessionId: sessionId, lastHandledRevision: 1 }, report({ state: "error", sessionId, sessionOutcome: "failed" }));
    expect(plan.mayFinishSession).toBe(true);
    expect(plan.mayClearActiveSession).toBe(false);
  });

  it("ignores an older revision", () => {
    const plan = planStatusReconciliation({ activeSessionId: null, lastHandledRevision: 5 }, report({ lastHandledRevision: 4 }));
    expect(plan.mayApplyRuntime).toBe(false);
  });
});
