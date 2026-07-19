import { randomUUID } from "node:crypto";
import {
  Queue,
  Worker,
  type ConnectionOptions,
  type JobsOptions,
  type QueueOptions,
  type WorkerOptions,
} from "bullmq";
import type { IngestEvent } from "@queue-monitor/shared";
import type { TelemetryEmitter } from "./client.js";
import { traceIdFrom, type MonitoringContext } from "./context.js";

export type MonitoredJobData<T extends Record<string, unknown>> = T & {
  _monitor: MonitoringContext;
};

export interface AddedJob {
  id?: string;
  name: string;
}

export interface QueueLike {
  add(name: string, data: Record<string, unknown>, options?: JobsOptions): Promise<AddedJob>;
  close?(): Promise<void>;
}

export interface InstrumentedJob<T extends Record<string, unknown>> {
  id?: string;
  name: string;
  data: MonitoredJobData<T>;
  attemptsMade: number;
  opts: JobsOptions;
  updateData(data: MonitoredJobData<T>): Promise<void>;
}

export type InstrumentedProcessor<T extends Record<string, unknown>, Result> = (
  job: InstrumentedJob<T>,
) => Promise<Result>;

export interface WorkerInstrumentationOptions {
  source?: string;
  retryDelayMs?: number;
}

function jobId(job: { id?: string }): string {
  return job.id === undefined ? "unknown" : String(job.id);
}

function eventError(error: unknown): { name: string; message: string } {
  if (error instanceof Error) return { name: error.name, message: error.message };
  return { name: "Error", message: String(error) };
}

function fixedBackoffMs(options: JobsOptions, fallback: number): number {
  if (typeof options.backoff === "number") return options.backoff;
  if (options.backoff && typeof options.backoff === "object") return options.backoff.delay ?? fallback;
  return fallback;
}

export async function addMonitoredJob<T extends Record<string, unknown>>(
  queueName: string,
  queue: QueueLike,
  client: TelemetryEmitter,
  name: string,
  data: T,
  context: MonitoringContext,
  options?: JobsOptions,
): Promise<AddedJob> {
  const queuedEventId = randomUUID();
  const occurredAt = new Date().toISOString();
  const monitoredData: MonitoredJobData<T> = {
    ...data,
    _monitor: { traceId: context.traceId, parentEventId: queuedEventId },
  };
  const job = await queue.add(name, monitoredData, options);
  client.emit({
    eventId: queuedEventId,
    traceId: context.traceId,
    parentEventId: context.parentEventId,
    type: "queue_job",
    status: "pending",
    source: client.service,
    occurredAt,
    durationMs: null,
    data: {
      queueName,
      jobId: jobId(job),
      jobName: name,
      attempt: 0,
    },
  });
  return job;
}

export class InstrumentedQueue {
  private readonly queue: Queue;

  constructor(
    readonly name: string,
    private readonly client: TelemetryEmitter,
    options: QueueOptions,
  ) {
    this.queue = new Queue(name, options);
  }

  add<T extends Record<string, unknown>>(
    name: string,
    data: T,
    context: MonitoringContext,
    options?: JobsOptions,
  ): Promise<AddedJob> {
    return addMonitoredJob(this.name, this.queue as unknown as QueueLike, this.client, name, data, context, options);
  }

  close(): Promise<void> {
    return this.queue.close();
  }

  waitUntilReady(): Promise<unknown> {
    return this.queue.waitUntilReady();
  }

  onError(listener: (error: Error) => void): void {
    this.queue.on("error", listener);
  }
}

export function instrumentBullMqProcessor<T extends Record<string, unknown>, Result>(
  queueName: string,
  client: TelemetryEmitter,
  processor: InstrumentedProcessor<T, Result>,
  options: WorkerInstrumentationOptions = {},
): InstrumentedProcessor<T, Result> {
  return async (job) => {
    const traceId = traceIdFrom(job.data._monitor?.traceId);
    const parentEventId = job.data._monitor?.parentEventId ?? randomUUID();
    const attempt = job.attemptsMade + 1;
    const maxAttempts = Math.max(job.opts.attempts ?? 1, 1);
    const activeEventId = randomUUID();
    const startedAt = new Date();
    const source = options.source ?? client.service;

    client.emit({
      eventId: activeEventId,
      traceId,
      parentEventId,
      type: "queue_job",
      status: "processing",
      source,
      occurredAt: startedAt.toISOString(),
      durationMs: null,
      data: {
        queueName,
        jobId: jobId(job),
        jobName: job.name,
        attempt,
      },
    });

    try {
      const result = await processor(job);
      const durationMs = Math.max(0, Date.now() - startedAt.getTime());
      client.emit({
        eventId: randomUUID(),
        traceId,
        parentEventId: activeEventId,
        type: "queue_job",
        status: "success",
        source,
        occurredAt: new Date().toISOString(),
        durationMs,
        data: {
          queueName,
          jobId: jobId(job),
          jobName: job.name,
          attempt,
        },
      });
      return result;
    } catch (error) {
      const durationMs = Math.max(0, Date.now() - startedAt.getTime());
      const normalizedError = eventError(error);
      if (attempt < maxAttempts) {
        const retryEventId = randomUUID();
        const retryDelayMs = fixedBackoffMs(job.opts, options.retryDelayMs ?? 1_000);
        const retryEvent: IngestEvent = {
          eventId: retryEventId,
          traceId,
          parentEventId: activeEventId,
          type: "queue_retry",
          status: "retrying",
          source,
          occurredAt: new Date().toISOString(),
          durationMs,
          data: {
            queueName,
            jobId: jobId(job),
            jobName: job.name,
            attempt,
            maxAttempts,
            nextRetryAt: new Date(Date.now() + retryDelayMs).toISOString(),
            error: normalizedError,
          },
        };
        client.emit(retryEvent);
        await job.updateData({
          ...job.data,
          _monitor: { traceId, parentEventId: retryEventId },
        });
      } else {
        client.emit({
          eventId: randomUUID(),
          traceId,
          parentEventId: activeEventId,
          type: "queue_failed",
          status: "failure",
          source,
          occurredAt: new Date().toISOString(),
          durationMs,
          data: {
            queueName,
            jobId: jobId(job),
            jobName: job.name,
            attempt,
            maxAttempts,
            error: normalizedError,
          },
        });
      }
      throw error instanceof Error ? error : new Error(String(error));
    }
  };
}

export function createInstrumentedWorker<T extends Record<string, unknown>, Result>(
  queueName: string,
  client: TelemetryEmitter,
  processor: InstrumentedProcessor<T, Result>,
  workerOptions: Omit<WorkerOptions, "connection"> & { connection: ConnectionOptions },
  instrumentationOptions: WorkerInstrumentationOptions = {},
): Worker {
  const instrumented = instrumentBullMqProcessor(queueName, client, processor, instrumentationOptions);
  return new Worker(
    queueName,
    async (job) => instrumented(job as unknown as InstrumentedJob<T>),
    workerOptions,
  );
}
