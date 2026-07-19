import { randomBytes } from "node:crypto";
import process from "node:process";
import pg from "pg";
import { hashApiKey } from "../src/app.js";

const [environmentIdArgument, name = "Default"] = process.argv.slice(2);
if (!environmentIdArgument) {
  console.error("Usage: npm run key:create -- <environment-uuid> [name]");
  process.exit(1);
}
const environmentId = environmentIdArgument.trim().split(/\s+/)[0]!;
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(environmentId)) {
  console.error("environment-uuid must be a valid UUID");
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const apiKey = `qmon_live_${randomBytes(24).toString("base64url")}`;
const prefix = apiKey.slice(0, 18);
const pool = new pg.Pool({ connectionString: databaseUrl });
try {
  await pool.query(
    `INSERT INTO api_keys (environment_id, name, key_prefix, key_hash)
     VALUES ($1, $2, $3, $4)`,
    [environmentId, name, prefix, hashApiKey(apiKey)],
  );
  console.log("API key created. Copy it now; it cannot be recovered:");
  console.log(apiKey);
} finally {
  await pool.end();
}
