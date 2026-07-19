import type { JobsOptions } from "bullmq";
import type { AddedJob, MonitoringContext } from "@queue-monitor/node";

export const DEMO_BEHAVIORS = ["success", "retry", "failure"] as const;
export type DemoBehavior = (typeof DEMO_BEHAVIORS)[number];

export interface ProcessOrderData extends Record<string, unknown> {
  orderId: string;
  behavior: DemoBehavior;
}

export interface DemoOrderQueue {
  add(
    name: string,
    data: ProcessOrderData,
    context: MonitoringContext,
    options?: JobsOptions,
  ): Promise<AddedJob>;
}
