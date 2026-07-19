import process from "node:process";
import { fileURLToPath } from "node:url";
import pino from "pino";
import {
  InstrumentedQueue,
  QueueMonitorClient,
  createInstrumentedWorker,
} from "@queue-monitor/node";
import { createDemoApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createOrderProcessor } from "./processor.js";
import type { ProcessOrderData } from "./types.js";

try {
  process.loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const config = loadConfig();
const logger = pino({ level: config.logLevel, base: { service: "demo-order-service", environment: config.environment } });
const client = new QueueMonitorClient({
  apiKey: config.apiKey,
  endpoint: config.ingestionEndpoint,
  service: "demo-order-service",
  environment: config.environment,
  batchSize: 100,
  flushIntervalMs: 100,
  maxBufferSize: 20_000,
});
const queue = new InstrumentedQueue("process-order", client, { connection: config.redis });
const worker = createInstrumentedWorker<ProcessOrderData, { orderId: string; processed: true }>(
  "process-order",
  client,
  createOrderProcessor(),
  { connection: config.redis, concurrency: 4 },
  { source: "demo-order-worker", retryDelayMs: 250 },
);
let redisErrorLogged = false;
const logRedisError = (error: Error): void => {
  if (redisErrorLogged) return;
  redisErrorLogged = true;
  logger.error({ err: error }, "redis_unavailable");
};
queue.onError(logRedisError);
worker.on("error", logRedisError);

try {
  await Promise.all([queue.waitUntilReady(), worker.waitUntilReady()]);
} catch (error) {
  logRedisError(error instanceof Error ? error : new Error(String(error)));
  await worker.close(true);
  await queue.close();
  await client.close();
  throw new Error("demo service requires Redis; start Redis and retry npm run dev:demo", { cause: error });
}
const app = createDemoApp({
  client,
  queue,
  retryDelayMs: 250,
  logger,
  readiness: async () => {
    const [, ingestion] = await Promise.all([
      queue.waitUntilReady(),
      fetch(`${config.ingestionEndpoint}/ready`, { signal: AbortSignal.timeout(2_000) }),
    ]);
    if (!ingestion.ok) throw new Error(`ingestion readiness returned HTTP ${ingestion.status}`);
  },
  version: {
    version: config.version,
    gitCommitSha: config.gitCommitSha,
    buildTimestamp: config.buildTimestamp,
    environment: config.environment,
  },
});
const server = app.listen(config.port, config.host, () => {
  logger.info({ host: config.host, port: config.port }, "demo_service_listening");
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "demo_service_shutting_down");
  server.close();
  await worker.close();
  await queue.close();
  await client.close();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
