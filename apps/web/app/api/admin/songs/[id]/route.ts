import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { artifacts, songs } from "@spp/database";
import { ARTIFACT_VERSION, LEGACY_V1_PROFILE } from "@spp/contracts";
import { processMidi } from "@spp/midi";
import { z } from "zod";
import { auth } from "@/auth";
import { database, storage } from "@/lib/services";

const updateSchema = z.object({ title: z.string().trim().min(1).max(200).optional(), artist: z.string().trim().max(200).nullable().optional() });

const requireAdmin = async () => Boolean(await auth());

export const PATCH = async (request: Request, context: { params: Promise<{ id: string }> }) => {
  if (!await requireAdmin()) return Response.json({ error: "Authentication required" }, { status: 401 });
  const body = updateSchema.safeParse(await request.json());
  if (!body.success) return Response.json({ error: "Invalid song metadata" }, { status: 400 });
  const { id } = await context.params;
  const [updated] = await database().db.update(songs).set({ ...body.data, updatedAt: new Date() }).where(eq(songs.id, id)).returning();
  return updated ? Response.json(updated) : Response.json({ error: "Song not found" }, { status: 404 });
};

export const POST = async (_request: Request, context: { params: Promise<{ id: string }> }) => {
  if (!await requireAdmin()) return Response.json({ error: "Authentication required" }, { status: 401 });
  const { id } = await context.params;
  const [song] = await database().db.select().from(songs).where(eq(songs.id, id)).limit(1);
  if (!song) return Response.json({ error: "Song not found" }, { status: 404 });
  const objectStorage = storage();
  const originalResponse = await fetch(await objectStorage.getDownloadUrl(song.originalObjectKey, 300));
  if (!originalResponse.ok) return Response.json({ error: "Original MIDI is unavailable" }, { status: 502 });
  const processed = processMidi(new Uint8Array(await originalResponse.arrayBuffer()), LEGACY_V1_PROFILE);
  const newObjectKey = `songs/${id}/legacy-v1-${Date.now()}.spp`;
  await objectStorage.put(newObjectKey, processed.artifact, "application/vnd.self-playing-piano");
  const [existing] = await database().db.select().from(artifacts).where(and(eq(artifacts.songId, id), eq(artifacts.profileId, LEGACY_V1_PROFILE.id))).limit(1);
  try {
    await database().db.transaction(async (transaction) => {
      if (existing) {
        await transaction.update(artifacts).set({
          objectKey: newObjectKey,
          sha256: processed.sha256,
          byteSize: processed.artifact.byteLength,
          noteCount: processed.noteCount,
          durationMs: processed.durationMs,
          formatVersion: ARTIFACT_VERSION,
          processorVersion: existing.processorVersion + 1,
          createdAt: new Date(),
        }).where(eq(artifacts.id, existing.id));
      } else {
        await transaction.insert(artifacts).values({
          id: randomUUID(), songId: id, profileId: LEGACY_V1_PROFILE.id,
          formatVersion: ARTIFACT_VERSION, processorVersion: 1,
          objectKey: newObjectKey, sha256: processed.sha256,
          byteSize: processed.artifact.byteLength, noteCount: processed.noteCount,
          durationMs: processed.durationMs,
        });
      }
      await transaction.update(songs).set({ durationMs: processed.durationMs, noteCount: processed.noteCount, warnings: processed.warnings, status: "ready", errorMessage: null, updatedAt: new Date() }).where(eq(songs.id, id));
    });
  } catch (error) {
    await objectStorage.delete(newObjectKey).catch(() => undefined);
    throw error;
  }
  if (existing) await objectStorage.delete(existing.objectKey).catch(() => undefined);
  return Response.json({ id, warnings: processed.warnings });
};

export const DELETE = async (_request: Request, context: { params: Promise<{ id: string }> }) => {
  if (!await requireAdmin()) return Response.json({ error: "Authentication required" }, { status: 401 });
  const { id } = await context.params;
  const rows = await database().db.select({ original: songs.originalObjectKey, artifact: artifacts.objectKey }).from(songs).leftJoin(artifacts, and(eq(artifacts.songId, songs.id), eq(songs.id, id))).where(eq(songs.id, id));
  const first = rows[0];
  if (!first) return Response.json({ error: "Song not found" }, { status: 404 });
  await database().db.delete(songs).where(eq(songs.id, id));
  await Promise.allSettled([storage().delete(first.original), ...rows.flatMap((row) => row.artifact ? [storage().delete(row.artifact)] : [])]);
  return new Response(null, { status: 204 });
};
