import type { ReactNode, SVGProps } from "react";
import type { DashboardEvent, EventStatus, EventType } from "./types.js";

export type IconName =
  | "overview"
  | "events"
  | "trace"
  | "search"
  | "chevron"
  | "close"
  | "logout"
  | "clock"
  | "activity"
  | "alert"
  | "check"
  | "queue"
  | "http"
  | "retry"
  | "copy"
  | "arrow";

export function Icon({ name, ...props }: { name: IconName } & SVGProps<SVGSVGElement>) {
  const paths: Record<IconName, ReactNode> = {
    overview: <><path d="M4 13h6V4H4v9Zm0 7h6v-4H4v4Zm10 0h6v-9h-6v9Zm0-13h6V4h-6v3Z" /></>,
    events: <><path d="M4 6h16M4 12h16M4 18h10" /><circle cx="18" cy="18" r="2" /></>,
    trace: <><circle cx="6" cy="5" r="2" /><circle cx="18" cy="12" r="2" /><circle cx="6" cy="19" r="2" /><path d="M8 5h2a4 4 0 0 1 4 4v0a3 3 0 0 0 3 3h-2a3 3 0 0 0-3 3v0a4 4 0 0 1-4 4" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    chevron: <path d="m9 18 6-6-6-6" />,
    close: <path d="M6 6l12 12M18 6 6 18" />,
    logout: <><path d="M10 5H5v14h5M14 8l4 4-4 4M9 12h9" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    activity: <path d="M3 12h4l2-6 4 12 2-6h6" />,
    alert: <><path d="M12 3 2.8 19h18.4L12 3Z" /><path d="M12 9v4M12 16h.01" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    queue: <><rect x="4" y="5" width="16" height="4" rx="1" /><rect x="4" y="15" width="16" height="4" rx="1" /><path d="M8 9v6M16 9v6" /></>,
    http: <><path d="M5 8h14M5 16h14M8 5 5 8l3 3M16 13l3 3-3 3" /></>,
    retry: <><path d="M20 11a8 8 0 0 0-14.8-4M4 5v5h5M4 13a8 8 0 0 0 14.8 4M20 19v-5h-5" /></>,
    copy: <><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
    arrow: <><path d="M5 12h14M14 7l5 5-5 5" /></>,
  };
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {paths[name]}
    </svg>
  );
}

export function LogoMark() {
  return (
    <span className="logo-mark" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

export const eventLabels: Record<EventType, string> = {
  http_request: "HTTP request",
  queue_job: "Queue job",
  queue_retry: "Queue retry",
  queue_failed: "Queue failed",
  webhook_received: "Webhook",
};

const eventIcons: Record<EventType, IconName> = {
  http_request: "http",
  queue_job: "queue",
  queue_retry: "retry",
  queue_failed: "alert",
  webhook_received: "events",
};

export function EventGlyph({ type, status }: { type: EventType; status: EventStatus }) {
  return (
    <span className={`event-glyph event-glyph--${status}`}>
      <Icon name={eventIcons[type]} />
    </span>
  );
}

export function StatusBadge({ status }: { status: EventStatus }) {
  return <span className={`status status--${status}`}><span />{status}</span>;
}

export function shortId(value: string | null, length = 8): string {
  return value ? value.slice(0, length) : "—";
}

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

export function formatClock(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

export function formatDuration(value: number | null): string {
  if (value === null) return "—";
  if (value < 1_000) return `${value} ms`;
  return `${(value / 1_000).toFixed(2)} s`;
}

export function eventSummary(event: DashboardEvent): string {
  if (event.http) return `${event.http.method ?? "HTTP"} ${event.http.route ?? "unknown route"}`;
  if (event.queue) return `${event.queue.jobName ?? "job"} · ${event.queue.name ?? "queue"}`;
  const provider = typeof event.data.provider === "string" ? event.data.provider : "provider";
  return `${provider} webhook`;
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty-state">
      <span className="empty-state__icon"><Icon name="activity" /></span>
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  );
}

export function LoadingState({ label = "Loading telemetry" }: { label?: string }) {
  return (
    <div className="loading-state"><span className="spinner" /><span>{label}</span></div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-state">
      <Icon name="alert" />
      <div><strong>Couldn’t load this view</strong><p>{message}</p></div>
      {onRetry && <button className="button button--ghost" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const copy = () => void navigator.clipboard.writeText(value);
  return <button type="button" className="icon-button copy-button" onClick={copy} title={label}><Icon name="copy" /></button>;
}
