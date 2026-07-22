import type { CommandType, ReportedState } from "@spp/contracts";

export interface PendingCommand {
  type: CommandType;
  revision: number | undefined;
}

export type PendingCommandOutcome = "pending" | "accepted" | "rejected";

export const pendingCommandOutcome = (
  command: PendingCommand,
  status: ReportedState,
): PendingCommandOutcome => {
  if (command.revision === undefined || status.lastHandledRevision < command.revision) {
    return "pending";
  }
  if (status.acknowledgement?.revision === command.revision &&
      status.acknowledgement.result === "rejected") {
    return "rejected";
  }
  return "accepted";
};
