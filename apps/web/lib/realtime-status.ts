import type { ReportedState } from "@spp/contracts";

const activeStates = new Set(["preparing", "ready", "playing", "paused", "stopping", "error"]);

export const reconcileRealtimeStatus = (current: ReportedState, incoming: ReportedState): ReportedState => {
  const activeSession = current.sessionId && activeStates.has(current.state);
  if (!activeSession || incoming.sessionId === current.sessionId) return incoming;
  const rejectedNewCommand = incoming.acknowledgement?.result === "rejected" &&
    incoming.lastHandledRevision > current.lastHandledRevision;
  if (rejectedNewCommand) return incoming;
  return {
    ...current,
    state: incoming.online ? current.state : "offline",
    online: incoming.online,
    reportedAt: incoming.reportedAt,
  };
};
