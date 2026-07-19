import type { InstrumentedProcessor } from "@queue-monitor/node";
import type { ProcessOrderData } from "./types.js";

export class SimulatedProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SimulatedProviderError";
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function createOrderProcessor(providerLatencyMs = 100): InstrumentedProcessor<ProcessOrderData, {
  orderId: string;
  processed: true;
}> {
  return async (job) => {
    await delay(providerLatencyMs);
    if (job.data.behavior === "failure") {
      throw new SimulatedProviderError("Demo provider failed permanently");
    }
    if (job.data.behavior === "retry" && job.attemptsMade === 0) {
      throw new SimulatedProviderError("Demo provider failed once; retry requested");
    }
    return { orderId: job.data.orderId, processed: true };
  };
}
