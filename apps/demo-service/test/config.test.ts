import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";

test("demo environment validation applies local defaults", () => {
  const config = loadConfig({ QMON_API_KEY: `qmon_live_${"a".repeat(32)}` });
  assert.equal(config.port, 3001);
  assert.equal(config.ingestionEndpoint, "http://localhost:3000");
  assert.equal("host" in config.redis ? config.redis.host : undefined, "localhost");
});

test("demo environment validation rejects missing and malformed values", () => {
  assert.throws(() => loadConfig({}), /DEMO_SEED_API_KEY or QMON_API_KEY/);
  assert.throws(
    () => loadConfig({ QMON_API_KEY: `qmon_live_${"a".repeat(32)}`, REDIS_URL: "http://localhost" }),
    /REDIS_URL must use redis:\/\/ or rediss:\/\//,
  );
});

test("dedicated demo seed key takes precedence for presentation traces", () => {
  const seedKey = `qmon_live_${"s".repeat(32)}`;
  const config = loadConfig({
    QMON_API_KEY: `qmon_live_${"a".repeat(32)}`,
    DEMO_SEED_API_KEY: seedKey,
  });
  assert.equal(config.apiKey, seedKey);
});
