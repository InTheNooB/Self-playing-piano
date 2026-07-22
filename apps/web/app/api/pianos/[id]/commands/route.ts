import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { artifacts, commands, pianos, playbackSessions, songs } from "@spp/database";
import { commandTypes, type DesiredCommand } from "@spp/contracts";
import { desiredTopic } from "@spp/infrastructure";
import { z } from "zod";
import { auth } from "@/auth";
import { database, mqttPublisher } from "@/lib/services";

const commandSchema = z.object({
  type: z.enum(commandTypes),
  songId: z.string().uuid().optional(),
  sessionId: z.string().uuid().optional(),
});

interface CommandResult {
  desired: DesiredCommand;
  isNewSession: boolean;
}

const failDispatch = async (result: CommandResult, message: string) => {
  await database().db.transaction(async (transaction) => {
    await transaction.update(commands).set({ status: "dispatch_failed", errorMessage: message }).where(eq(commands.id, result.desired.commandId));
    if (!result.isNewSession) return;
    await transaction.update(playbackSessions).set({ state: "failed", endedAt: new Date(), errorMessage: message }).where(eq(playbackSessions.id, result.desired.sessionId));
    await transaction.update(pianos).set({ state: "idle", activeSessionId: null, updatedAt: new Date() }).where(eq(pianos.id, result.desired.pianoId));
  });
};

export const POST = async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const parsed = commandSchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Invalid command" }, { status: 400 });
  if (parsed.data.type === "enter_provisioning" && !await auth()) return Response.json({ error: "Admin authentication required" }, { status: 401 });
  const { id } = await context.params;

  let result: CommandResult;
  try {
    result = await database().db.transaction(async (transaction): Promise<CommandResult> => {
      const lockedRows = await transaction.execute(sql`
        SELECT ${pianos.id} AS id FROM ${pianos}
        WHERE ${pianos.id}::text = ${id} OR ${pianos.slug} = ${id}
        FOR UPDATE
      `) as unknown as Array<{ id: string }>;
      const locked = lockedRows[0];
      if (!locked) throw new Error("NOT_FOUND:Piano not found");
      const [piano] = await transaction.select().from(pianos).where(eq(pianos.id, locked.id)).limit(1);
      if (!piano) throw new Error("NOT_FOUND:Piano not found");
      const online = piano.online && piano.lastSeenAt && Date.now() - new Date(piano.lastSeenAt).getTime() < 90_000;
      if (!online) throw new Error("OFFLINE:The piano is offline");

      const revision = Number(piano.commandRevision) + 1;
      const commandId = randomUUID();
      const expiresAt = new Date(Date.now() + 30_000).toISOString();

      if (parsed.data.type === "play") {
        if (!parsed.data.songId) throw new Error("INVALID:A song is required");
        if (piano.activeSessionId || piano.state !== "idle") throw new Error("CONFLICT:The piano is already in use");
        const [artifact] = await transaction
          .select({ id: artifacts.id, sha256: artifacts.sha256, byteSize: artifacts.byteSize, durationMs: artifacts.durationMs })
          .from(artifacts)
          .innerJoin(songs, eq(songs.id, artifacts.songId))
          .where(and(eq(artifacts.songId, parsed.data.songId), eq(artifacts.profileId, piano.profileId), eq(songs.status, "ready")))
          .limit(1);
        if (!artifact) throw new Error("INVALID:Song is not ready for this piano");

        const sessionId = randomUUID();
        await transaction.insert(playbackSessions).values({ id: sessionId, pianoId: piano.id, songId: parsed.data.songId, artifactId: artifact.id });
        await transaction.update(pianos).set({ state: "preparing", activeSessionId: sessionId, commandRevision: revision, durationMs: artifact.durationMs, positionMs: 0, updatedAt: new Date() }).where(eq(pianos.id, piano.id));
        await transaction.insert(commands).values({ id: commandId, pianoId: piano.id, sessionId, type: "play", revision });
        return {
          isNewSession: true,
          desired: {
            commandId,
            revision,
            sessionId,
            type: "play",
            pianoId: piano.id,
            songId: parsed.data.songId,
            artifactId: artifact.id,
            artifactSha256: artifact.sha256,
            artifactBytes: artifact.byteSize,
            expiresAt,
          },
        };
      }

      if (parsed.data.type !== "enter_provisioning") {
        if (!piano.activeSessionId || parsed.data.sessionId !== piano.activeSessionId) throw new Error("CONFLICT:The active session has changed");
      } else if (piano.state !== "idle") {
        throw new Error("CONFLICT:Provisioning can only start while idle");
      }

      const sessionId = piano.activeSessionId ?? randomUUID();
      const [activeSession] = piano.activeSessionId
        ? await transaction.select().from(playbackSessions).where(eq(playbackSessions.id, piano.activeSessionId)).limit(1)
        : [undefined];
      await transaction.update(pianos).set({ commandRevision: revision, updatedAt: new Date() }).where(eq(pianos.id, piano.id));
      await transaction.insert(commands).values({ id: commandId, pianoId: piano.id, sessionId: activeSession?.id ?? null, type: parsed.data.type, revision });
      return {
        isNewSession: false,
        desired: {
          commandId,
          revision,
          sessionId,
          type: parsed.data.type,
          pianoId: piano.id,
          ...(activeSession ? { songId: activeSession.songId, artifactId: activeSession.artifactId } : {}),
          expiresAt,
        },
      };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Command failed";
    const [code, detail] = message.includes(":") ? message.split(/:(.*)/s, 2) : ["ERROR", message];
    const status = code === "NOT_FOUND" ? 404 : code === "OFFLINE" ? 503 : code === "CONFLICT" ? 409 : 400;
    return Response.json({ error: detail }, { status });
  }

  const publisher = mqttPublisher();
  try {
    await publisher.connect();
    await publisher.publish(desiredTopic(result.desired.pianoId), JSON.stringify(result.desired), { qos: 1, retain: true });
    await database().db.update(commands).set({ status: "published" }).where(eq(commands.id, result.desired.commandId));
    return Response.json(result.desired, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "MQTT dispatch failed";
    await failDispatch(result, message);
    return Response.json({ error: "The piano command could not be delivered" }, { status: 503 });
  } finally {
    await publisher.close().catch(() => undefined);
  }
};
