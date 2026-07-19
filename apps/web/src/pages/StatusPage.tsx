import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { LogoMark, formatDateTime } from "../components.js";
import type { PublicStatus } from "../types.js";

export function StatusPage() {
  const [status, setStatus] = useState<PublicStatus | null>(null);
  useEffect(() => {
    const load = () => void api.status().then(setStatus).catch(() => setStatus({
      status: "outage", checkedAt: new Date().toISOString(), components: [], incidents: [], maintenance: [],
    }));
    load();
    const timer = window.setInterval(load, 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return <main className="status-page">
    <header><div className="brand"><LogoMark /><span>Queue Monitor Status</span></div><Link to="/login">Dashboard</Link></header>
    <section className={`status-hero status-hero--${status?.status ?? "degraded"}`}><span />
      <div><h1>{status?.status === "operational" ? "All systems operational" : status?.status === "outage" ? "Service outage" : "Service degradation"}</h1><p>Last checked {status ? formatDateTime(status.checkedAt) : "now"}</p></div>
    </section>
    <section className="status-components">{status?.components.map((component) => <article key={component.name}><strong>{component.name}</strong><span>{component.status}</span></article>)}</section>
    <section className="status-history"><h2>Incident history</h2>{status?.incidents.length ? status.incidents.map((incident) => <article key={incident.id}><strong>{incident.title}</strong><span>{incident.status}</span><p>{incident.message}</p></article>) : <p>No incidents reported.</p>}<h2>Maintenance</h2>{status?.maintenance.length ? status.maintenance.map((item) => <article key={item.id}><strong>{item.title}</strong><p>{item.message}</p><small>{formatDateTime(item.startsAt)} – {formatDateTime(item.endsAt)}</small></article>) : <p>No maintenance scheduled.</p>}</section>
  </main>;
}
