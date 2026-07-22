import type { SessionOutcome } from "@spp/contracts";

interface StoredPiano {
  activeSessionId: string | null;
  lastHandledRevision: number;
}

interface ReconciliationReport {
  lastHandledRevision: number;
  sessionId?: string | undefined;
  sessionOutcome?: SessionOutcome | undefined;
}

export const planStatusReconciliation = (piano: StoredPiano, reported: ReconciliationReport) => {
  const currentOrNewer = reported.lastHandledRevision >= piano.lastHandledRevision;
  const activeSessionMatches = Boolean(piano.activeSessionId && reported.sessionId === piano.activeSessionId);
  return {
    currentOrNewer,
    activeSessionMatches,
    mayApplyRuntime: currentOrNewer && (!piano.activeSessionId || activeSessionMatches),
    mayFinishSession: activeSessionMatches && Boolean(reported.sessionOutcome),
    mayClearActiveSession: activeSessionMatches && Boolean(reported.sessionOutcome) && reported.sessionOutcome !== "failed",
  };
};
