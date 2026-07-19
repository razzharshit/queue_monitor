import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "../api.js";
import { useAuth } from "../auth.js";
import {
  CopyButton,
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
import type { TraceResponse } from "../types.js";

export function TracePage() {
  const { traceId = "" } = useParams();
  const { project, environment } = useAuth();
  const { version, connected } = useLive();
  const [trace, setTrace] = useState<TraceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!environment || !traceId) return;
    if (!quiet) setLoading(true);
    try {
      setTrace(await api.trace(environment.id, traceId));
      setError(null);
    } catch (value) {
      setError(value instanceof ApiError ? value.message : "The API did not respond.");
    } finally {
      setLoading(false);
    }
  }, [environment, traceId]);

  useEffect(() => { void load(Boolean(trace)); }, [load, version]);
  useEffect(() => {
    const timer = window.setInterval(() => void load(true), 4_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const failure = useMemo(
    () => trace ? [...trace.events].reverse().find((event) => event.status === "failure" && event.error) : undefined,
    [trace],
  );
  const terminal = trace
    ? [...trace.events].reverse().find((event) => event.type === "queue_failed" || (event.type === "queue_job" && event.status === "success"))
    : undefined;
  const duration = trace && trace.events.length > 1
    ? Date.parse(trace.events.at(-1)!.occurredAt) - Date.parse(trace.events[0]!.occurredAt)
    : 0;

  return (
    <main className="page trace-page">
      <div className="breadcrumbs"><Link to="/events">Event stream</Link><Icon name="chevron" /><span>Trace {shortId(traceId)}</span></div>
      <div className="trace-heading">
        <div><span className="kicker"><span /> {connected ? "Live trace" : "Polling trace"}</span><h1>Request journey</h1><div className="trace-id"><code>{traceId}</code><CopyButton value={traceId} label="Copy trace ID" /></div></div>
        {trace && <div className="trace-summary"><div><span>Events</span><strong>{trace.events.length}</strong></div><div><span>Elapsed</span><strong>{formatDuration(duration)}</strong></div><div><span>Outcome</span><StatusBadge status={terminal?.status ?? "processing"} /></div></div>}
      </div>

      {loading && !trace ? <LoadingState label="Building trace timeline" /> : error && !trace ? <ErrorState message={error} onRetry={() => void load()} /> : trace && (
        <div className="trace-layout">
          <section className="trace-timeline panel">
            <header className="panel__head"><div><h2>Correlated timeline</h2><p>Ordered through parent-event causality</p></div><span className={connected ? "live-chip" : "live-chip live-chip--polling"}><span />{connected ? "Live" : "Polling"}</span></header>
            <div className="timeline">
              {trace.events.map((event, index) => (
                <article className={`timeline-event timeline-event--${event.status}`} key={event.eventId}>
                  <div className="timeline-event__rail"><EventGlyph type={event.type} status={event.status} />{index < trace.events.length - 1 && <i />}</div>
                  <div className="timeline-event__content">
                    <header><div><span>Step {index + 1}</span><h3>{eventSummary(event)}</h3></div><time>{formatDateTime(event.occurredAt)}</time></header>
                    <div className="timeline-event__meta"><StatusBadge status={event.status} /><span>{eventLabels[event.type]}</span><span>{event.source}</span>{event.durationMs !== null && <span>{formatDuration(event.durationMs)}</span>}{event.queue?.attempt !== null && event.queue?.attempt !== undefined && <span>Attempt {event.queue.attempt}</span>}</div>
                    {event.error && <div className="inline-error"><Icon name="alert" /><div><strong>{event.error.name}</strong><p>{event.error.message}</p></div></div>}
                    <div className="causal-link"><span>event <code>{shortId(event.eventId)}</code></span><Icon name="arrow" /><span>parent <code>{shortId(event.parentEventId)}</code></span></div>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <aside className="trace-aside">
            <section className={`outcome-card ${failure ? "outcome-card--failure" : terminal ? "outcome-card--success" : ""}`}>
              <span className="outcome-card__icon"><Icon name={failure ? "alert" : terminal ? "check" : "activity"} /></span>
              <span>Trace outcome</span>
              <h2>{failure ? "Final failure" : terminal ? "Completed" : "In progress"}</h2>
              <p>{failure?.error?.message ?? (terminal ? "The order worker completed successfully." : "Waiting for the worker’s next state transition.")}</p>
              {failure?.error && <code>{failure.error.name}</code>}
            </section>
            <section className="panel trace-context"><h3>Trace context</h3><dl>
              <div><dt>Scope</dt><dd>{project?.name} / {environment?.name}</dd></div>
              <div><dt>Root source</dt><dd>{trace.events[0]?.source ?? "—"}</dd></div>
              <div><dt>Root event</dt><dd><code>{shortId(trace.events[0]?.eventId ?? null)}</code></dd></div>
              <div><dt>Terminal event</dt><dd><code>{shortId(terminal?.eventId ?? null)}</code></dd></div>
            </dl></section>
          </aside>
        </div>
      )}
    </main>
  );
}
