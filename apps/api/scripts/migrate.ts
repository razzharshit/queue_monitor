import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import process from "node:process";
import pg from "pg";
import { loadMigrationConfig } from "../src/config.js";

const { databaseUrl } = loadMigrationConfig(process.env);
const migrationsUrl = new URL("../migrations/", import.meta.url);
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
try {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    checksum TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  const files = (await readdir(migrationsUrl))
    .filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name))
    .sort();
  for (const name of files) {
    const sql = await readFile(new URL(name, migrationsUrl), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const applied = await pool.query<{ checksum: string }>(
      "SELECT checksum FROM schema_migrations WHERE name = $1",
      [name],
    );
    if (applied.rowCount === 1) {
      if (applied.rows[0]!.checksum !== checksum) {
        throw new Error(`Applied migration ${name} has been modified`);
      }
      continue;
    }
    await pool.query("BEGIN");
    try {
      await pool.query(sql);
      await pool.query(
        "INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)",
        [name, checksum],
      );
      await pool.query("COMMIT");
      console.log(JSON.stringify({ level: "info", event: "migration_applied", migration: name }));
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
  }
} finally {
  await pool.end();
}
