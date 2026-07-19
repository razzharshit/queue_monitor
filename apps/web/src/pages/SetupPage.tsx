import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api, ApiError } from "../api.js";
import { useAuth } from "../auth.js";
import { CopyButton, Icon } from "../components.js";
import type { ApiKeySummary, OnboardingProgress, Organization } from "../types.js";
import { ONBOARDING_LABELS } from "../onboarding.js";
const slugify = (value: string) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function SetupPage() {
  const { auth, refresh } = useAuth();
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [progress, setProgress] = useState<OnboardingProgress | null>(null);
  const [name, setName] = useState("");
  const [secret, setSecret] = useState<ApiKeySummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const project = auth?.projects.find((item) => item.organizationId === organization?.id) ?? auth?.projects[0] ?? null;
  const production = project?.environments.find((item) => item.environmentType === "production") ?? null;

  const reloadOrganizations = async () => {
    const result = await api.organizations();
    setOrganization((current) => result.items.find((item) => item.id === current?.id) ?? result.items[0] ?? null);
  };
  useEffect(() => { void reloadOrganizations().catch((value) => setError(String(value))); }, []);
  useEffect(() => {
    if (!organization) { setProgress(null); return; }
    void (async () => {
      let next = await api.completeOnboarding(organization.id, "create_organization");
      if (project) next = await api.completeOnboarding(organization.id, "create_project");
      if (production) {
        next = await api.completeOnboarding(organization.id, "create_production_environment");
        const existingKeys = await api.keys(production.id);
        if (existingKeys.items.length > 0) next = await api.completeOnboarding(organization.id, "generate_api_key");
        const events = await api.events(production.id, new URLSearchParams({ limit: "1" }));
        if (events.total > 0) next = await api.completeOnboarding(organization.id, "send_first_event");
      }
      setProgress(next);
    })().catch((value) => setError(String(value)));
  }, [organization, production, project]);
  const complete = async (step: string) => {
    if (organization) setProgress(await api.completeOnboarding(organization.id, step));
  };
  const execute = async (event: FormEvent, action: () => Promise<void>) => {
    event.preventDefault(); setError(null);
    try { await action(); setName(""); } catch (value) { setError(value instanceof ApiError ? value.message : "Setup request failed"); }
  };
  const install = "npm install @queue-monitor/node";
  const init = useMemo(() => `import { monitor } from "@queue-monitor/node";\n\nmonitor.init({\n  apiKey: process.env.QMON_API_KEY,\n  endpoint: "http://localhost:3000",\n  service: "my-service",\n  environment: "production"\n});`, []);

  return <main className="page">
    <div className="page-heading"><div><span className="kicker"><span />Guided setup</span><h1>Ship your first trace</h1><p>Complete each step once; progress is saved to your organization.</p></div></div>
    {error && <div className="form-error"><Icon name="alert" />{error}</div>}
    <div className="setup-grid">
      <section className="panel setup-card"><h2>Onboarding checklist</h2>
        <ol className="checklist">{Object.entries(ONBOARDING_LABELS).map(([step, label]) => <li key={step} className={progress?.completedSteps.includes(step) ? "done" : ""}><span><Icon name="check" /></span>{label}{["install_sdk", "send_first_event", "view_telemetry"].includes(step) && !progress?.completedSteps.includes(step) && organization && <button onClick={() => void complete(step)}>Mark done</button>}</li>)}</ol>
      </section>
      <section className="panel setup-card"><h2>Workspace resources</h2>
        {!organization && <form onSubmit={(event) => void execute(event, async () => { const created = await api.createOrganization(name, slugify(name)); await reloadOrganizations(); setOrganization(created); await api.completeOnboarding(created.id, "create_organization"); })}><label>Organization name<input value={name} onChange={(event) => setName(event.target.value)} required /></label><button className="button button--primary">Create organization</button></form>}
        {organization && !project && <form onSubmit={(event) => void execute(event, async () => { await api.createProject(organization.id, name, slugify(name)); await complete("create_project"); await refresh(); })}><label>Project name<input value={name} onChange={(event) => setName(event.target.value)} required /></label><button className="button button--primary">Create project</button></form>}
        {project && !production && <form onSubmit={(event) => void execute(event, async () => { await api.createEnvironment(project.id, "Production", "production", "production"); await complete("create_production_environment"); await refresh(); })}><p>Create an isolated production event stream for <strong>{project.name}</strong>.</p><button className="button button--primary">Create production environment</button></form>}
        {production && !secret && <form onSubmit={(event) => void execute(event, async () => { const key = await api.createKey(production.id, "Production SDK"); setSecret(key); await complete("generate_api_key"); })}><p>Generate a production API key. It is shown only once.</p><button className="button button--primary">Generate API key</button></form>}
        {secret?.apiKey && <div className="secret-once"><strong>Copy this key now</strong><div><code>{secret.apiKey}</code><CopyButton value={secret.apiKey} /></div><small>Queue Monitor stores only a SHA-256 hash.</small></div>}
      </section>
      <section className="panel setup-card setup-card--code"><h2>Install and initialize</h2><div className="code-block"><code>{install}</code><CopyButton value={install} /></div><pre>{init}</pre><CopyButton value={init} label="Copy initialization" /></section>
    </div>
  </main>;
}
