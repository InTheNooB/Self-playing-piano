import { hash } from "@node-rs/argon2";

const password = process.argv[2];
if (!password) throw new Error("Usage: pnpm --filter @spp/web auth:hash -- <password>");
process.stdout.write(`${await hash(password)}\n`);
