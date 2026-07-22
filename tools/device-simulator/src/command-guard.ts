export type CommandGuardResult = "duplicate" | "expired" | "new";

export const guardCommand = (lastHandledRevision: number, revision: number, expiresAt: string, now = Date.now()): CommandGuardResult => {
  if (revision <= lastHandledRevision) return "duplicate";
  const expiration = Date.parse(expiresAt);
  if (!Number.isFinite(expiration) || expiration <= now) return "expired";
  return "new";
};

export const completedPosition = (durationMs: number) => Math.max(0, durationMs);
