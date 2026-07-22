import type { ReportedState } from "@spp/contracts";
import type { DiagnosticsPiano } from "@/lib/diagnostics-types";

const activeStates = new Set(["preparing", "ready", "playing", "paused", "stopping", "error"]);

export const mergeLivePianoStatus = (stored: DiagnosticsPiano, live: ReportedState): DiagnosticsPiano => {
  if (live.pianoId !== stored.id) return stored;

  const state = live.online ? live.state : "offline";
  return {
    ...stored,
    state,
    online: live.online,
    firmwareVersion: live.firmwareVersion,
    profileId: live.profileId,
    positionMs: live.positionMs,
    durationMs: live.durationMs,
    activeSessionId: live.sessionId && activeStates.has(state) ? live.sessionId : null,
    lastAppliedRevision: live.lastAppliedRevision,
    lastHandledRevision: live.lastHandledRevision,
    lastSeenAt: live.reportedAt,
    errorCode: live.error?.code ?? null,
    errorMessage: live.error?.message ?? null,
    updatedAt: live.reportedAt,
  };
};
