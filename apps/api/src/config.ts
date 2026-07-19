import { z } from "zod";

const logLevel = z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]);
const postgresUrl = z.string().url().refine(
  (value) => value.startsWith("postgres://") || value.startsWith("postgresql://"),
  "must use postgres:// or postgresql://",
);
const optionalNonEmpty = z.preprocess((value) => value === "" ? undefined : value, z.string().min(1).optional());
const optionalEmail = z.preprocess((value) => value === "" ? undefined : value, z.string().email().optional());

const apiEnvironmentSchema = z.object({
  DATABASE_URL: postgresUrl,
  JWT_SECRET: z.string().min(32),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  APP_HOST: z.string().min(1).default("0.0.0.0"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: logLevel.default("info"),
  COOKIE_SECURE: z.enum(["true", "false"]).optional(),
  WEB_ORIGIN: z.string().url().optional(),
  TELEMETRY_DATA_ALLOWLIST: z.string().optional(),
  APP_VERSION: z.string().min(1).default("0.1.0"),
  GIT_COMMIT_SHA: z.string().min(1).default("unknown"),
  BUILD_TIMESTAMP: z.string().datetime().default(new Date().toISOString()),
  APP_URL: z.string().url().default("http://localhost:5173"),
  SMTP_HOST: optionalNonEmpty,
  SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(587),
  SMTP_SECURE: z.enum(["true", "false"]).default("false"),
  SMTP_USER: optionalNonEmpty,
  SMTP_PASSWORD: optionalNonEmpty,
  SMTP_FROM: optionalEmail,
  HTTPS_ENFORCE: z.enum(["true", "false"]).optional(),
  TRUST_PROXY: z.enum(["true", "false"]).default("false"),
  MAX_REQUEST_BYTES: z.coerce.number().int().min(16 * 1024).max(10 * 1024 * 1024).default(1024 * 1024),
  MAX_EVENT_BYTES: z.coerce.number().int().min(1024).max(1024 * 1024).default(16 * 1024),
  MAX_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(100),
  MAX_NESTING_DEPTH: z.coerce.number().int().min(2).max(32).default(12),
}).superRefine((value, context) => {
  const configured = Boolean(value.SMTP_HOST || value.SMTP_USER || value.SMTP_PASSWORD || value.SMTP_FROM);
  if (configured && !value.SMTP_HOST) context.addIssue({ code: "custom", path: ["SMTP_HOST"], message: "is required when SMTP is configured" });
  if (configured && !value.SMTP_FROM) context.addIssue({ code: "custom", path: ["SMTP_FROM"], message: "is required when SMTP is configured" });
  if (Boolean(value.SMTP_USER) !== Boolean(value.SMTP_PASSWORD)) context.addIssue({ code: "custom", path: ["SMTP_PASSWORD"], message: "SMTP_USER and SMTP_PASSWORD must be configured together" });
});

const migrationEnvironmentSchema = z.object({ DATABASE_URL: postgresUrl });

function formatEnvironmentError(error: z.ZodError): Error {
  const issues = error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
  return new Error(`Invalid API environment: ${issues}`);
}

export interface ApiConfig {
  databaseUrl: string;
  jwtSecret: string;
  port: number;
  host: string;
  nodeEnvironment: "development" | "test" | "production";
  logLevel: z.infer<typeof logLevel>;
  secureCookies: boolean;
  webOrigin?: string;
  telemetryDataAllowlist?: string;
  version: string;
  gitCommitSha: string;
  buildTimestamp: string;
  appUrl: string;
  smtp?: { host: string; port: number; secure: boolean; user?: string; password?: string; from: string };
  enforceHttps: boolean;
  trustProxy: boolean;
  maxRequestBytes: number;
  maxEventBytes: number;
  maxBatchSize: number;
  maxNestingDepth: number;
}

export function loadApiConfig(environment: NodeJS.ProcessEnv = process.env): ApiConfig {
  const result = apiEnvironmentSchema.safeParse(environment);
  if (!result.success) throw formatEnvironmentError(result.error);
  const value = result.data;
  return {
    databaseUrl: value.DATABASE_URL,
    jwtSecret: value.JWT_SECRET,
    port: value.PORT,
    host: value.APP_HOST,
    nodeEnvironment: value.NODE_ENV,
    logLevel: value.LOG_LEVEL,
    secureCookies: value.COOKIE_SECURE === "true" ||
      (value.NODE_ENV === "production" && value.COOKIE_SECURE !== "false"),
    webOrigin: value.WEB_ORIGIN,
    telemetryDataAllowlist: value.TELEMETRY_DATA_ALLOWLIST,
    version: value.APP_VERSION,
    gitCommitSha: value.GIT_COMMIT_SHA,
    buildTimestamp: value.BUILD_TIMESTAMP,
    appUrl: value.APP_URL.replace(/\/$/, ""),
    smtp: value.SMTP_HOST && value.SMTP_FROM ? {
      host: value.SMTP_HOST,
      port: value.SMTP_PORT,
      secure: value.SMTP_SECURE === "true",
      user: value.SMTP_USER,
      password: value.SMTP_PASSWORD,
      from: value.SMTP_FROM,
    } : undefined,
    enforceHttps: value.HTTPS_ENFORCE === "true" || (value.NODE_ENV === "production" && value.HTTPS_ENFORCE !== "false"),
    trustProxy: value.TRUST_PROXY === "true",
    maxRequestBytes: value.MAX_REQUEST_BYTES,
    maxEventBytes: value.MAX_EVENT_BYTES,
    maxBatchSize: value.MAX_BATCH_SIZE,
    maxNestingDepth: value.MAX_NESTING_DEPTH,
  };
}

export function loadMigrationConfig(environment: NodeJS.ProcessEnv = process.env): { databaseUrl: string } {
  const result = migrationEnvironmentSchema.safeParse(environment);
  if (!result.success) throw formatEnvironmentError(result.error);
  return { databaseUrl: result.data.DATABASE_URL };
}
