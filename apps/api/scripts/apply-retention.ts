import process from "node:process";
import pg from "pg";
import { loadMigrationConfig } from "../src/config.js";
import { PostgresEventStore } from "../src/store.js";

const { databaseUrl } = loadMigrationConfig(process.env);
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1, application_name: "queue-monitor-retention" });
try {
  const result = await new PostgresEventStore(pool).deleteExpiredEvents();
  console.log(JSON.stringify({ level: "info", event: "retention_cleanup_completed", ...result }));
} finally {
  await pool.end();
}
