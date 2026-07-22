import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const migrationDirectory = fileURLToPath(new URL("../drizzle", import.meta.url));
const client = postgres(url, { prepare: false, max: 1 });

try {
  await client`CREATE TABLE IF NOT EXISTS spp_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
  const migrationFiles = (await readdir(migrationDirectory)).filter((file) => file.endsWith(".sql")).sort();
  for (const migrationFile of migrationFiles) {
    const migrationId = migrationFile.replace(/\.sql$/, "");
    const applied = await client`SELECT id FROM spp_migrations WHERE id = ${migrationId}`;
    if (applied.length > 0) continue;
    const migration = await readFile(`${migrationDirectory}/${migrationFile}`, "utf8");
    await client.begin(async (transaction) => {
      await transaction.unsafe(migration);
      await transaction`INSERT INTO spp_migrations (id) VALUES (${migrationId})`;
    });
    process.stdout.write(`Applied database migration ${migrationId}.\n`);
  }
  process.stdout.write("Database migrations are up to date.\n");
} finally {
  await client.end();
}
