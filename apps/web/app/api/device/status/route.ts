import { and, eq } from "drizzle-orm";
import { commands, pianos, playbackSessions } from "@spp/database";
import { pianoStates } from "@spp/contracts";
import { z } from "zod";
import { authenticateDevice } from "@/lib/device-auth";
import { database } from "@/lib/services";

const statusSchema = z.object({
  pianoId: z.string().uuid(),
  state: z.enum(pianoStates),
  online: z.boolean(),
  sessionId: z.string().uuid().optional(),
  songId: z.string().uuid().optional(),
  positionMs: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  firmwareVersion: z.string().max(100),
  profileId: z.string().max(100),
  lastAppliedRevision: z.number().int().nonnegative(),
  lastCommandId: z.string().uuid().optional(),
  error: z.object({ code: z.string().max(100), message: z.string().max(500) }).optional(),
});

const sessionStateFor = (state: (typeof pianoStates)[number]) => {
  if (state === "playing") return "playing" as const;
  if (state === "paused") return "paused" as const;
  if (state === "error") return "failed" as const;
  return "preparing" as const;
};

export const POST = async (request: Request) => {
  const parsed = statusSchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Invalid reported state" }, { status: 400 });
  if (!await authenticateDevice(request, parsed.data.pianoId)) return Response.json({ error: "Invalid device token" }, { status: 401 });

  const now = new Date();
  const terminal = parsed.data.state === "idle";
  const failed = parsed.data.state === "error";
  await database().db.transaction(async (transaction) => {
    await transaction.update(pianos).set({
      state: parsed.data.state,
      online: parsed.data.online,
      positionMs: parsed.data.positionMs,
      durationMs: parsed.data.durationMs,
      firmwareVersion: parsed.data.firmwareVersion,
      lastAppliedRevision: parsed.data.lastAppliedRevision,
      lastSeenAt: now,
      updatedAt: now,
      ...(terminal ? { activeSessionId: null } : {}),
    }).where(eq(pianos.id, parsed.data.pianoId));

    if (parsed.data.sessionId) {
      await transaction.update(playbackSessions).set({
        state: failed ? "failed" : terminal ? "completed" : sessionStateFor(parsed.data.state),
        positionMs: parsed.data.positionMs,
        ...(parsed.data.state === "playing" ? { startedAt: now } : {}),
        ...(terminal || failed ? { endedAt: now, errorMessage: parsed.data.error?.message ?? null } : {}),
      }).where(and(eq(playbackSessions.id, parsed.data.sessionId), eq(playbackSessions.pianoId, parsed.data.pianoId)));
    }

    if (parsed.data.lastCommandId) {
      await transaction.update(commands).set({ status: parsed.data.error ? "rejected" : "acknowledged", acknowledgedAt: now, errorMessage: parsed.data.error?.message ?? null }).where(and(eq(commands.id, parsed.data.lastCommandId), eq(commands.pianoId, parsed.data.pianoId)));
    }
  });
  return new Response(null, { status: 204 });
};
