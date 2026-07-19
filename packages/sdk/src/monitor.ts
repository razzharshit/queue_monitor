import type { IngestEvent } from "@queue-monitor/shared";
import { QueueMonitorClient, type CaptureEvent, type QueueMonitorOptions, type SdkDiagnostics } from "./client.js";

class Monitor {
  private client: QueueMonitorClient | null = null;

  init(options: QueueMonitorOptions): QueueMonitorClient {
    if (this.client) throw new Error("monitor.init has already been called; call monitor.shutdown() before reinitializing");
    this.client = new QueueMonitorClient(options);
    return this.client;
  }

  emit(event: IngestEvent): void {
    this.requireClient().emit(event);
  }

  capture(event: CaptureEvent): string {
    return this.requireClient().capture(event);
  }

  diagnostics(): Readonly<SdkDiagnostics> {
    return this.requireClient().diagnostics();
  }

  flush(): Promise<void> {
    return this.requireClient().flush();
  }

  async shutdown(): Promise<void> {
    if (!this.client) return;
    const client = this.client;
    this.client = null;
    await client.close();
  }

  private requireClient(): QueueMonitorClient {
    if (!this.client) throw new Error("monitor.init must be called before using the SDK");
    return this.client;
  }
}

export const monitor = new Monitor();
