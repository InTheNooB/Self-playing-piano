import { asc } from "drizzle-orm";
import { pianos } from "@spp/database";
import { reportedTopic } from "@spp/infrastructure";
import { database } from "@/lib/services";

export const dynamic = "force-dynamic";

export const GET = async () => {
  const [piano] = await database().db.select().from(pianos).orderBy(asc(pianos.createdAt)).limit(1);
  if (!piano) return Response.json({ error: "No piano is configured" }, { status: 503 });
  if (!process.env.NEXT_PUBLIC_MQTT_WS_URL) return Response.json({ error: "MQTT WebSocket URL is not configured" }, { status: 503 });
  return Response.json({
    pianoId: piano.id,
    pianoName: piano.name,
    url: process.env.NEXT_PUBLIC_MQTT_WS_URL,
    username: process.env.NEXT_PUBLIC_MQTT_BROWSER_USERNAME,
    password: process.env.NEXT_PUBLIC_MQTT_BROWSER_PASSWORD,
    topic: reportedTopic(piano.id),
  });
};
