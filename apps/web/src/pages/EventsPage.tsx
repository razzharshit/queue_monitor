import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api.js";
import { useAuth } from "../auth.js";
import {
  CopyButton,
  EmptyState,
  ErrorState,
  EventGlyph,
  Icon,
  LoadingState,
  StatusBadge,
  eventLabels,
  eventSummary,
  formatDateTime,
  formatDuration,
  shortId,
} from "../components.js";
import { useLive } from "../live.js";
import type { DashboardEvent, EventStatus, EventType } from "../types.js";

const types: Array<{ value: EventType | ""; label: string }> = [
  { value: "", label: "All event types" },
  { value: "http_request", label: "HTTP requests" },
  { value: "queue_job", label: "Queue jobs" },
  { value: "queue_retry", label: "Queue retries" },
  { value: "queue_failed", label: "Queue failures" },
  { value: "webhook_received", label: "Webhooks" },
];

const statuses: Array<EventStatus | ""> = ["", "success", "failure", "pending", "processing", "retrying"];

function EventDrawer({ event, onClose }: { event: DashboardEvent; onClose(): void }) {
  return (
    <div className="drawer-layer" role="presentation" onMouseDown={(mouse) => mouse.target === mouse.currentTarget && onClose()}>
      <aside className="event-drawer" role="dialog" aria-modal="true" aria-label="Event details">
        <header>
          <div><EventGlyph type={event.type} status={event.status} /><div><span>{eventLabels[event.type]}</span><h2>{eventSummary(event)}</h2></div></div>
          <button className="icon-button" onClick={onClose} aria-label="Close details"><Icon name="close" /></button>
        </header>
        <div className="drawer-body">
          <section className="detail-hero">
            <StatusBadge status={event.status} />
            <span>{formatDateTime(event.occurredAt)}</span>
            <span>{formatDuration(event.durationMs)}</span>
          </section>
          {event.error && (
            <section className="failure-reason">
              <Icon name="alert" />
              <div><span>Failure reason</span><strong>{event.error.name}</strong><p>{event.error.message}</p></div>
            </section>
          )}
          <section className="detail-section"><h3>Correlation</h3><dl>
            <div><dt>Trace ID</dt><dd><code>{event.traceId ?? "Not traced"}</code>{event.traceId && <CopyButton value={event.traceId} />}</dd></div>
            <div><dt>Event ID</dt><dd><code>{event.eventId}</code><CopyButton value={event.eventId} /></dd></div>
            <div><dt>Parent event</dt><dd><code>{event.parentEventId ?? "Root event"}</code>{event.parentEventId && <CopyButton value={event.parentEventId} />}</dd></div>
          </dl></section>
          <section className="detail-section"><h3>Event fields</h3><dl>
            <div><dt>Source</dt><dd>{event.source}</dd></div>
            {event.http && <><div><dt>Method</dt><dd>{event.http.method}</dd></div><div><dt>Route template</dt><dd>{event.http.route}</dd></div><div><dt>Status code</dt><dd>{event.http.statusCode}</dd></div></>}
            {event.queue && <><div><dt>Queue</dt><dd>{event.queue.name}</dd></div><div><dt>Job</dt><dd>{event.queue.jobName} <span className="muted">#{event.queue.jobId}</span></dd></div><div><dt>Attempt</dt><dd>{event.queue.attempt ?? 0}</dd></div></>}
          </dl></section>
          <section className="detail-section"><h3>Telemetry data</h3><pre>{JSON.stringify(event.data, null, 2)}</pre></section>
        </div>
        {event.traceId && <footer><Link className="button button--primary button--wide" to={`/traces/${event.traceId}`}>Open full trace <Icon name="arrow" /></Link></footer>}
      </aside>
    </div>
  );
}

export function EventsPage() {
  const { project, environment } = useAuth();
  const { connected, version, lastBatch } = useLive();
  const [urlSearch] = useSearchParams();
  const [search, setSearch] = useState("");
  const [type, setType] = useState<EventType | "">("");
  const [status, setStatus] = useState<EventStatus | "">((urlSearch.get("status") as EventStatus | null) ?? "");
  const [source, setSource] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: DashboardEvent[]; total: number; pages: number } | null>(null);
  const [selected, setSelected] = useState<DashboardEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    if (project) void api.completeOnboarding(project.organizationId, "view_telemetry").catch(() => undefined);
  }, [project]);

  const query = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), limit: "50" });
    if (search) params.set("search", search);
    if (type) params.set("type", type);
    if (status) params.set("status", status);
    if (source) params.set("source", source);
    return params;
  }, [page, search, source, status, type]);

  const load = useCallback(async (quiet = false) => {
    if (!environment) return;
    if (!quiet) setLoading(true);
    try {
      const response = await api.events(environment.id, query);
      setData(response);
      setLastUpdated(new Date());
      setError(null);
    } catch (value) {
      setError(value instanceof ApiError ? value.message : "The API did not respond.");
    } finally {
      setLoading(false);
    }
  }, [environment, query]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(Boolean(data)), 180);
    return () => window.clearTimeout(timer);
  }, [load, version]);
  useEffect(() => {
    const timer = window.setInterval(() => void load(true), 5_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const resetFilters = () => {
    setSearch(""); setType(""); setStatus(""); setSource(""); setPage(1);
  };
  const hasFilters = Boolean(search || type || status || source);

  return (
    <main className="page events-page">
      <div className="page-heading page-heading--compact">
        <div><span className="kicker"><span /> {connected ? "Streaming live" : "Polling fallback"}</span><h1>Event stream</h1><p>Every accepted telemetry event, newest first.</p></div>
        <div className="stream-status"><span className={connected ? "pulse-dot" : "pulse-dot pulse-dot--offline"} /><div><strong>{connected ? "Live" : "Polling"}</strong><small>{lastBatch ? `${lastBatch.events.length} event${lastBatch.events.length === 1 ? "" : "s"} just accepted` : lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : "Connecting…"}</small></div></div>
      </div>

      <section className="filter-bar">
        <label className="search-field"><Icon name="search" /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search route, source, job, or error…" /></label>
        <select value={type} onChange={(event) => { setType(event.target.value as EventType | ""); setPage(1); }}>{types.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select>
        <select value={status} onChange={(event) => { setStatus(event.target.value as EventStatus | ""); setPage(1); }}>{statuses.map((item) => <option value={item} key={item}>{item ? item[0]!.toUpperCase() + item.slice(1) : "All statuses"}</option>)}</select>
        <input className="source-field" value={source} onChange={(event) => { setSource(event.target.value); setPage(1); }} placeholder="Exact source" />
        {hasFilters && <button className="button button--ghost" onClick={resetFilters}>Clear</button>}
      </section>

      <section className="event-table-panel">
        <div className="table-meta"><span>{data?.total ?? 0} events</span><span>Environment-scoped · {project?.name} / {environment?.name}</span></div>
        {loading && !data ? <LoadingState /> : error && !data ? <ErrorState message={error} onRetry={() => void load()} /> : data && data.items.length === 0 ? (
          <EmptyState title={hasFilters ? "No matching events" : "Waiting for telemetry"} body={hasFilters ? "Try relaxing one of your filters." : "Run a success, retry, or failure order scenario to start the stream."} />
        ) : data && (
          <div className="event-table-wrap">
            <table className="event-table">
              <thead><tr><th>Event</th><th>Status</th><th>Source</th><th>Trace</th><th>Time</th><th>Duration</th><th /></tr></thead>
              <tbody>{data.items.map((event) => (
                <tr key={event.eventId} onClick={() => setSelected(event)} tabIndex={0} onKeyDown={(key) => key.key === "Enter" && setSelected(event)}>
                  <td><EventGlyph type={event.type} status={event.status} /><div><strong>{eventSummary(event)}</strong><span>{eventLabels[event.type]}{event.queue?.attempt ? ` · attempt ${event.queue.attempt}` : ""}</span></div></td>
                  <td><StatusBadge status={event.status} /></td>
                  <td><span className="source-tag">{event.source}</span></td>
                  <td><span className="mono">{shortId(event.traceId)}</span></td>
                  <td><time>{formatDateTime(event.occurredAt)}</time></td>
                  <td>{formatDuration(event.durationMs)}</td>
                  <td><Icon name="chevron" /></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        {data && data.pages > 1 && <div className="pagination"><button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button><span>Page {page} of {data.pages}</span><button disabled={page >= data.pages} onClick={() => setPage((value) => value + 1)}>Next</button></div>}
      </section>
      {selected && <EventDrawer event={selected} onClose={() => setSelected(null)} />}
    </main>
  );
}
