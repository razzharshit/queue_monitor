import type { ConnectionOptions } from "bullmq";
import { z } from "zod";

export interface DemoConfig {
  port: number;
  host: string;
  redis: ConnectionOptions;
  apiKey: string;
  ingestionEndpoint: string;
  environment: string;
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
  version: string;
  gitCommitSha: string;
  buildTimestamp: string;
}

const demoEnvironmentSchema = z.object({
  QMON_API_KEY: z.string().min(24).startsWith("qmon_live_").optional(),
  DEMO_SEED_API_KEY: z.string().min(24).startsWith("qmon_live_").optional(),
  INGESTION_ENDPOINT: z.string().url().default("http://localhost:3000"),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  DEMO_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  DEMO_HOST: z.string().min(1).default("0.0.0.0"),
  DEMO_ENVIRONMENT: z.string().min(1).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  APP_VERSION: z.string().min(1).default("0.1.0"),
  GIT_COMMIT_SHA: z.string().min(1).default("unknown"),
  BUILD_TIMESTAMP: z.string().datetime().default(new Date().toISOString()),
}).superRefine((value, context) => {
  if (!value.DEMO_SEED_API_KEY && !value.QMON_API_KEY) {
    context.addIssue({ code: "custom", path: ["DEMO_SEED_API_KEY"], message: "DEMO_SEED_API_KEY or QMON_API_KEY is required" });
  }
});

function redisConnection(value: string): ConnectionOptions {
  const url = new URL(value);
  if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
    throw new Error("REDIS_URL must use redis:// or rediss://");
  }
  return {
    host: url.hostname,
    port: url.port ? Number.parseInt(url.port, 10) : 6379,
    username: url.username || undefined,
    password: url.password || undefined,
    db: url.pathname.length > 1 ? Number.parseInt(url.pathname.slice(1), 10) : 0,
    tls: url.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null,
    connectTimeout: 1_000,
    retryStrategy: (attempt) => (attempt > 3 ? null : Math.min(attempt * 200, 1_000)),
  };
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): DemoConfig {
  const result = demoEnvironmentSchema.safeParse(environment);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid demo-service environment: ${issues}`);
  }
  const value = result.data;
  return {
    port: value.DEMO_PORT,
    host: value.DEMO_HOST,
    redis: redisConnection(value.REDIS_URL),
    apiKey: value.DEMO_SEED_API_KEY ?? value.QMON_API_KEY!,
    ingestionEndpoint: value.INGESTION_ENDPOINT,
    environment: value.DEMO_ENVIRONMENT,
    logLevel: value.LOG_LEVEL,
    version: value.APP_VERSION,
    gitCommitSha: value.GIT_COMMIT_SHA,
    buildTimestamp: value.BUILD_TIMESTAMP,
  };
}
