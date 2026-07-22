import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const migrationId = "0000_initial";
const migrationPath = fileURLToPath(new URL("../drizzle/0000_initial.sql", import.meta.url));
const migration = await readFile(migrationPath, "utf8");
const client = postgres(url, { prepare: false, max: 1 });

try {
  await client`CREATE TABLE IF NOT EXISTS spp_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
  const applied = await client`SELECT id FROM spp_migrations WHERE id = ${migrationId}`;
  if (applied.length === 0) {
    await client.begin(async (transaction) => {
      await transaction.unsafe(migration);
      await transaction`INSERT INTO spp_migrations (id) VALUES (${migrationId})`;
    });
  }
  process.stdout.write(`Database migration ${migrationId} is applied.\n`);
} finally {
  await client.end();
}
