import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api.js";
import { useAuth } from "../auth.js";
import {
  EmptyState,
  ErrorState,
  EventGlyph,
  Icon,
  LoadingState,
  StatusBadge,
  eventSummary,
  formatClock,
  formatDuration,
  shortId,
} from "../components.js";
import { useLive } from "../live.js";
import type { DashboardEvent, OverviewMetrics } from "../types.js";

function formatMetric(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
}

function LineChart({ metrics }: { metrics: OverviewMetrics }) {
  const width = 720;
  const height = 210;
  const pad = 24;
  const values = metrics.series.flatMap((item) => [item.averageLatencyMs, item.p95LatencyMs]);
  const max = Math.max(...values, 10);
  const x = (index: number) => pad + (index / Math.max(metrics.series.length - 1, 1)) * (width - pad * 2);
  const y = (value: number) => height - pad - (value / max) * (height - pad * 2);
  const points = (key: "averageLatencyMs" | "p95LatencyMs") =>
    metrics.series.map((item, index) => `${x(index)},${y(item[key])}`).join(" ");
  return (
    <div className="chart-wrap">
      {metrics.series.length === 0 ? <EmptyState title="No latency samples" body="Trigger an order scenario to populate this chart." /> : (
        <svg className="line-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Average and P95 HTTP latency">
          {[0, .25, .5, .75, 1].map((ratio) => <line key={ratio} x1={pad} x2={width - pad} y1={pad + ratio * (height - pad * 2)} y2={pad + ratio * (height - pad * 2)} className="chart-grid" />)}
          <polyline points={points("p95LatencyMs")} className="chart-line chart-line--p95" />
          <polyline points={points("averageLatencyMs")} className="chart-line chart-line--avg" />
          {metrics.series.map((item, index) => <circle key={item.bucket} cx={x(index)} cy={y(item.averageLatencyMs)} r="3.5" className="chart-point" />)}
        </svg>
      )}
    </div>
  );
}

function TrafficChart({ metrics }: { metrics: OverviewMetrics }) {
  const max = Math.max(...metrics.series.map((item) => item.requests), 1);
  return (
    <div className="traffic-chart">
      {metrics.series.length === 0 ? <EmptyState title="No request traffic" body="HTTP requests will appear here as they arrive." /> : metrics.series.map((item) => {
        const failureHeight = item.requests === 0 ? 0 : (item.failures / item.requests) * 100;
        return (
          <div className="traffic-bar" key={item.bucket} title={`${item.requests} requests · ${item.failures} failed`}>
            <span style={{ height: `${Math.max((item.requests / max) * 100, 4)}%` }}><i style={{ height: `${failureHeight}%` }} /></span>
          </div>
        );
      })}
    </div>
  );
}

export function OverviewPage() {
  const { project, environment } = useAuth();
  const { version, connected } = useLive();
  const [range, setRange] = useState<OverviewMetrics["range"]>("24h");
  const [metrics, setMetrics] = useState<OverviewMetrics | null>(null);
  const [failures, setFailures] = useState<DashboardEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!environment) return;
    if (!quiet) setLoading(true);
    try {
      const query = new URLSearchParams({ status: "failure", limit: "5", page: "1" });
      const [overview, events] = await Promise.all([
        api.overview(environment.id, range),
        api.events(environment.id, query),
      ]);
      setMetrics(overview);
      setFailures(events.items);
      setError(null);
    } catch (value) {
      setError(value instanceof ApiError ? value.message : "The API did not respond.");
    } finally {
      setLoading(false);
    }
  }, [environment, range]);

  useEffect(() => { void load(Boolean(metrics)); }, [load, version]);
  useEffect(() => {
    const timer = window.setInterval(() => void load(true), 5_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const queueTotal = useMemo(() => metrics ? Object.values(metrics.queueStatusCounts).reduce((a, b) => a + b, 0) : 0, [metrics]);

  return (
    <main className="page overview-page">
      <div className="page-heading">
        <div><span className="kicker"><span /> {connected ? "Live data" : "Polling every 5 seconds"}</span><h1>System pulse</h1><p>HTTP performance and queue outcomes for <strong>{project?.name} / {environment?.name}</strong>.</p></div>
        <div className="segmented" aria-label="Metrics range">
          {(["24h", "7d", "30d"] as const).map((value) => <button className={range === value ? "active" : ""} onClick={() => setRange(value)} key={value}>{value}</button>)}
        </div>
      </div>

      {loading && !metrics ? <LoadingState /> : error && !metrics ? <ErrorState message={error} onRetry={() => void load()} /> : metrics && (
        <>
          <section className="metric-grid">
            <article className="metric-card"><span className="metric-card__icon"><Icon name="activity" /></span><div><span>HTTP requests</span><strong>{formatMetric(metrics.requestCount)}</strong><small>in the selected window</small></div></article>
            <article className={`metric-card ${metrics.failureRate > 0 ? "metric-card--danger" : ""}`}><span className="metric-card__icon"><Icon name="alert" /></span><div><span>Failure rate</span><strong>{formatMetric(metrics.failureRate)}%</strong><small>{metrics.failedRequestCount} failed requests</small></div></article>
            <article className="metric-card"><span className="metric-card__icon"><Icon name="clock" /></span><div><span>Average latency</span><strong>{formatMetric(metrics.averageLatencyMs)} <em>ms</em></strong><small>mean request duration</small></div></article>
            <article className="metric-card"><span className="metric-card__icon"><Icon name="clock" /></span><div><span>P95 latency</span><strong>{formatMetric(metrics.p95LatencyMs)} <em>ms</em></strong><small>95th percentile</small></div></article>
          </section>

          <section className="dashboard-grid">
            <article className="panel panel--wide">
              <header className="panel__head"><div><h2>Latency profile</h2><p>Average and P95 HTTP duration</p></div><div className="chart-legend"><span className="chart-legend__avg">Average</span><span className="chart-legend__p95">P95</span></div></header>
              <LineChart metrics={metrics} />
            </article>
            <article className="panel">
              <header className="panel__head"><div><h2>Request outcomes</h2><p>Failures inside total traffic</p></div></header>
              <TrafficChart metrics={metrics} />
              <div className="traffic-legend"><span><i />Requests</span><span><i />Failures</span></div>
            </article>
            <article className="panel">
              <header className="panel__head"><div><h2>Queue transitions</h2><p>{queueTotal} events in this window</p></div><Icon name="queue" /></header>
              <div className="queue-stats">
                {Object.entries(metrics.queueStatusCounts).map(([status, count]) => (
                  <div key={status}><span className={`queue-dot queue-dot--${status}`} /><span>{status}</span><strong>{count}</strong><i><b style={{ width: `${queueTotal ? Math.max((count / queueTotal) * 100, count ? 3 : 0) : 0}%` }} /></i></div>
                ))}
              </div>
            </article>
            <article className="panel panel--wide">
              <header className="panel__head"><div><h2>Recent failures</h2><p>Latest request and worker errors</p></div><Link to="/events?status=failure" className="text-link">View stream <Icon name="arrow" /></Link></header>
              {failures.length === 0 ? <EmptyState title="No failures in view" body="The selected time window has no failed events." /> : (
                <div className="failure-list">
                  {failures.map((event) => (
                    <Link to={event.traceId ? `/traces/${event.traceId}` : "/events"} key={event.eventId}>
                      <EventGlyph type={event.type} status={event.status} />
                      <div><strong>{eventSummary(event)}</strong><span>{event.error?.message ?? `${event.source} reported a failure`}</span></div>
                      <StatusBadge status={event.status} />
                      <span className="mono">{shortId(event.traceId)}</span>
                      <time>{formatClock(event.occurredAt)}</time>
                      <span>{formatDuration(event.durationMs)}</span>
                      <Icon name="chevron" />
                    </Link>
                  ))}
                </div>
              )}
            </article>
          </section>
        </>
      )}
    </main>
  );
}
