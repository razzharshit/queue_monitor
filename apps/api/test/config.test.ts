import assert from "node:assert/strict";
import test from "node:test";
import { loadApiConfig } from "../src/config.js";

const validEnvironment = {
  DATABASE_URL: "postgres://queue:password@localhost:5432/queue",
  JWT_SECRET: "a-production-length-signing-secret-for-tests",
};

test("API environment validation applies safe defaults", () => {
  const config = loadApiConfig(validEnvironment);
  assert.equal(config.port, 3000);
  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.logLevel, "info");
  assert.equal(config.secureCookies, false);
});

test("API environment validation fails fast for invalid required values", () => {
  assert.throws(
    () => loadApiConfig({ DATABASE_URL: "not-a-database", JWT_SECRET: "short" }),
    /Invalid API environment: DATABASE_URL:.*JWT_SECRET:/,
  );
});

test("production cookies default to secure", () => {
  assert.equal(loadApiConfig({ ...validEnvironment, NODE_ENV: "production" }).secureCookies, true);
});

test("SMTP configuration is all-or-nothing", () => {
  assert.throws(
    () => loadApiConfig({ ...validEnvironment, SMTP_HOST: "smtp.example.test" }),
    /SMTP_FROM/,
  );
  const config = loadApiConfig({
    ...validEnvironment,
    SMTP_HOST: "smtp.example.test",
    SMTP_FROM: "support@example.test",
  });
  assert.equal(config.smtp?.port, 587);
  assert.equal(config.smtp?.from, "support@example.test");
});
