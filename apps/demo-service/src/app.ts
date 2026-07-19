import { randomUUID } from "node:crypto";
import express, {
  type ErrorRequestHandler,
  type Express,
  type Request,
  type Response,
} from "express";
import type { Logger } from "pino";
import {
  expressErrorMiddleware,
  expressMiddleware,
  getExpressMonitoringContext,
  type TelemetryEmitter,
} from "@queue-monitor/node";
import { DEMO_BEHAVIORS, type DemoBehavior, type DemoOrderQueue } from "./types.js";

export interface DemoAppOptions {
  client: TelemetryEmitter;
  queue: DemoOrderQueue;
  retryDelayMs?: number;
  logger?: Logger;
  readiness?: () => Promise<void>;
  version?: { version: string; gitCommitSha: string; buildTimestamp: string; environment: string };
}

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

function requestedBehavior(body: unknown): DemoBehavior {
  if (body === undefined || body === null) return "success";
  if (typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "body must be an object");
  const value = (body as Record<string, unknown>).behavior ?? "success";
  if (!DEMO_BEHAVIORS.includes(value as DemoBehavior)) {
    throw new HttpError(400, `behavior must be one of: ${DEMO_BEHAVIORS.join(", ")}`);
  }
  return value as DemoBehavior;
}

export function createDemoApp(options: DemoAppOptions): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use((request, response, next) => {
    const supplied = request.header("x-request-id");
    const requestId = supplied && /^[A-Za-z0-9._:-]{1,128}$/.test(supplied) ? supplied : randomUUID();
    const startedAt = process.hrtime.bigint();
    response.setHeader("x-request-id", requestId);
    response.on("finish", () => {
      options.logger?.info({
        requestId,
        userId: null,
        organizationId: null,
        projectId: null,
        environmentId: null,
        method: request.method,
        route: request.route?.path ?? request.path,
        statusCode: response.statusCode,
        durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
      }, "request_completed");
    });
    next();
  });
  app.use(expressMiddleware(options.client, { source: "demo-api" }));
  app.use(express.json({ limit: "16kb" }));

  app.get("/health", (_request, response) => {
    response.json({ status: "ok" });
  });
  app.get("/ready", async (_request, response) => {
    try {
      await options.readiness?.();
      response.json({ status: "ready", checks: { redis: "ok", ingestion: "ok" } });
    } catch {
      response.status(503).json({ status: "not_ready", checks: { redis: "unavailable" } });
    }
  });
  app.get("/version", (_request, response) => {
    response.json(options.version ?? {
      version: "0.1.0-test",
      gitCommitSha: "unknown",
      buildTimestamp: new Date(0).toISOString(),
      environment: "test",
    });
  });

  app.post("/orders", async (request, response) => {
    const behavior = requestedBehavior(request.body);
    const orderId = `order_${randomUUID()}`;
    const context = getExpressMonitoringContext(request);
    const attempts = behavior === "success" ? 1 : 3;
    const job = await options.queue.add(
      "process-order",
      { orderId, behavior },
      context,
      {
        attempts,
        backoff: { type: "fixed", delay: options.retryDelayMs ?? 250 },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );

    response.status(202).json({
      orderId,
      jobId: job.id,
      traceId: context.traceId,
      behavior,
      status: "queued",
    });
  });

  app.use(expressErrorMiddleware());
  const errorHandler: ErrorRequestHandler = (error, request: Request, response: Response, _next) => {
    const statusCode = error instanceof HttpError ? error.statusCode : 500;
    options.logger?.error({
      err: error,
      method: request.method,
      route: request.route?.path ?? request.path,
      statusCode,
    }, "request_failed");
    response.status(statusCode).json({
      error: statusCode === 500 ? "internal server error" : error.message,
    });
  };
  app.use(errorHandler);

  return app;
}
