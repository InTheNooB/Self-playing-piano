import { and, desc, eq } from "drizzle-orm";
import { artifacts, songs } from "@spp/database";
import { database, storage } from "@/lib/services";

export const dynamic = "force-dynamic";

export const GET = async (_request: Request, context: { params: Promise<{ id: string }> }) => {
  const { id } = await context.params;
  const [artifact] = await database().db
    .select({ objectKey: artifacts.objectKey })
    .from(artifacts)
    .innerJoin(songs, eq(songs.id, artifacts.songId))
    .where(and(eq(songs.id, id), eq(songs.status, "ready")))
    .orderBy(desc(artifacts.createdAt))
    .limit(1);
  if (!artifact) return Response.json({ error: "Artifact not found" }, { status: 404 });
  return Response.redirect(await storage().getDownloadUrl(artifact.objectKey, 300), 307);
};
