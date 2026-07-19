import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../api.js";
import { useAuth } from "../auth.js";
import { CopyButton, Icon, formatDateTime } from "../components.js";
import { canInvite, canManageKeys, canManageProjects, canManageRoles } from "../permissions.js";
import type { ApiKeySummary, Invitation, OrganizationRole, SecurityPolicy, TeamMember, UsageSummary } from "../types.js";

export function SettingsPage() {
  const { project, environment } = useAuth();
  const [keys, setKeys] = useState<ApiKeySummary[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [keyName, setKeyName] = useState("Production SDK");
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Exclude<OrganizationRole, "owner">>("developer");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [security, setSecurity] = useState<SecurityPolicy | null>(null);
  const [customFields, setCustomFields] = useState("");
  const [networks, setNetworks] = useState("");
  const reload = useCallback(async () => {
    if (!project || !environment) return;
    const [keyResult, memberResult, inviteResult, usageResult, securityResult] = await Promise.all([
      api.keys(environment.id), api.members(project.organizationId), api.invitations(project.organizationId),
      api.usage(project.organizationId), api.security(project.organizationId),
    ]);
    setKeys(keyResult.items); setMembers(memberResult.items); setInvitations(inviteResult.items);
    setUsage(usageResult); setSecurity(securityResult);
    setCustomFields(securityResult.customRedactFields.join(", "));
    setNetworks(securityResult.allowedNetworks.join("\n"));
  }, [environment, project]);
  useEffect(() => { void reload().catch((value) => setError(value instanceof ApiError ? value.message : "Could not load settings")); }, [reload]);
  if (!project || !environment) return <main className="page"><div className="error-state"><Icon name="alert" /><div><strong>Finish setup first</strong><p>Create a project and environment before managing access.</p></div></div></main>;
  const submitKey = async (event: FormEvent) => {
    event.preventDefault(); setError(null);
    try { const created = await api.createKey(environment.id, keyName); setNewSecret(created.apiKey ?? null); await reload(); } catch (value) { setError(value instanceof ApiError ? value.message : "Key creation failed"); }
  };
  const rotate = async (key: ApiKeySummary) => {
    const created = await api.createKey(environment.id, `${key.name} (rotated)`);
    setNewSecret(created.apiKey ?? null);
    await reload();
  };
  const revoke = async (key: ApiKeySummary) => {
    if (!window.confirm(`Revoke ${key.name}? Requests using it will fail immediately. Confirm the replacement key is deployed first.`)) return;
    await api.revokeKey(environment.id, key.id); await reload();
  };
  const invite = async (event: FormEvent) => {
    event.preventDefault();
    const result = await api.invite(project.organizationId, email, inviteRole);
    setInviteUrl(`${window.location.origin}${result.acceptPath}`);
    await api.completeOnboarding(project.organizationId, "invite_teammate");
    setEmail(""); await reload();
  };
  return <main className="page">
    <div className="page-heading"><div><span className="kicker"><span />Access control</span><h1>Project settings</h1><p>{project.organizationName} / {project.name} / {environment.name}</p></div></div>
    {error && <div className="form-error"><Icon name="alert" />{error}</div>}
    <div className="settings-grid">
      <section className="panel setup-card"><h2>Environment API keys</h2><p>Rotate with no downtime: create a replacement, deploy it, then revoke the old key.</p>
        {canManageKeys(project.role) && <form className="inline-form" onSubmit={(event) => void submitKey(event)}><input value={keyName} onChange={(event) => setKeyName(event.target.value)} required /><button className="button button--primary">Generate key</button></form>}
        {newSecret && <div className="secret-once"><strong>New key — shown once</strong><div><code>{newSecret}</code><CopyButton value={newSecret} /></div><button className="button button--ghost" onClick={() => setNewSecret(null)}>I saved it</button></div>}
        <div className="resource-list">{keys.map((key) => <article key={key.id}><div><strong>{key.name}</strong><code>{key.keyPrefix}••••••••</code><small>Created {formatDateTime(key.createdAt)} · Last used {key.lastUsedAt ? formatDateTime(key.lastUsedAt) : "never"}</small></div><span className={key.revokedAt ? "status status--failure" : "status status--success"}>{key.revokedAt ? "revoked" : "active"}</span>{!key.revokedAt && canManageKeys(project.role) && <div><button className="button button--ghost" onClick={() => void rotate(key)}>Rotate</button><button className="button button--danger" onClick={() => void revoke(key)}>Revoke</button></div>}</article>)}</div>
      </section>
      <section className="panel setup-card"><h2>Team</h2><p>Owner controls roles; owners and admins can invite. Viewers always remain read-only.</p>
        {canInvite(project.role) && <form className="inline-form" onSubmit={(event) => void invite(event)}><input type="email" placeholder="developer@company.com" value={email} onChange={(event) => setEmail(event.target.value)} required /><select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as typeof inviteRole)}><option value="admin">Admin</option><option value="developer">Developer</option><option value="viewer">Viewer</option></select><button className="button button--primary">Invite</button></form>}
        {inviteUrl && <div className="secret-once"><strong>Invitation link</strong><div><code>{inviteUrl}</code><CopyButton value={inviteUrl} /></div></div>}
        <div className="resource-list">{members.map((member) => <article key={member.userId}><div><strong>{member.name ?? member.email}</strong><small>{member.email}</small></div>{canManageRoles(project.role) ? <select value={member.role} onChange={async (event) => { await api.updateMember(project.organizationId, member.userId, event.target.value as OrganizationRole); await reload(); }}><option value="owner">Owner</option><option value="admin">Admin</option><option value="developer">Developer</option><option value="viewer">Viewer</option></select> : <span className="role-pill">{member.role}</span>}</article>)}</div>
        {invitations.filter((item) => !item.acceptedAt && !item.revokedAt).length > 0 && <><h3>Pending invitations</h3><div className="resource-list">{invitations.filter((item) => !item.acceptedAt && !item.revokedAt).map((item) => <article key={item.id}><div><strong>{item.email}</strong><small>{item.role} · expires {formatDateTime(item.expiresAt)}</small></div></article>)}</div></>}
      </section>
      <section className="panel setup-card"><h2>Usage and plan</h2><p>Current billing-period counters are enforced during ingestion.</p>
        {usage && <div className="usage-grid"><div><span>Plan</span><strong>{usage.plan.name}</strong></div><div><span>Events</span><strong>{usage.usage.eventsIngested.toLocaleString()}</strong><small>of {usage.plan.limits.events.toLocaleString()}</small></div><div><span>Requests</span><strong>{usage.usage.ingestionRequests.toLocaleString()}</strong><small>of {usage.plan.limits.requests.toLocaleString()}</small></div><div><span>Storage</span><strong>{(usage.usage.storageBytes / 1_048_576).toFixed(1)} MB</strong></div><div><span>Rate limited</span><strong>{usage.usage.rateLimitedRequests}</strong></div><div><span>Active services</span><strong>{usage.usage.activeServices}</strong></div></div>}
      </section>
      <section className="panel setup-card"><h2>Data protection</h2><p>Retention and server-side PII redaction apply before telemetry is persisted.</p>
        {security && <form onSubmit={async (event) => { event.preventDefault(); const next = await api.updateSecurity(project.organizationId, { retentionDays: security.retentionDays, redactEmails: security.redactEmails, redactPhoneNumbers: security.redactPhoneNumbers, customRedactFields: customFields.split(",").map((item) => item.trim()).filter(Boolean) }); setSecurity(next); }}>
          <label>Retention<select disabled={!canManageProjects(project.role)} value={security.retentionDays} onChange={(event) => setSecurity({ ...security, retentionDays: Number(event.target.value) as SecurityPolicy["retentionDays"] })}><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option><option value="180">180 days</option><option value="365">1 year</option></select></label>
          <label className="check-row"><input type="checkbox" disabled={!canManageProjects(project.role)} checked={security.redactEmails} onChange={(event) => setSecurity({ ...security, redactEmails: event.target.checked })} />Redact email addresses</label>
          <label className="check-row"><input type="checkbox" disabled={!canManageProjects(project.role)} checked={security.redactPhoneNumbers} onChange={(event) => setSecurity({ ...security, redactPhoneNumbers: event.target.checked })} />Redact phone numbers</label>
          <label>Custom redacted fields<input disabled={!canManageProjects(project.role)} value={customFields} onChange={(event) => setCustomFields(event.target.value)} placeholder="customer.email, internalSecret" /></label>
          {canManageProjects(project.role) && <button className="button button--primary">Save data policy</button>}
        </form>}
        {security && <form onSubmit={async (event) => { event.preventDefault(); const next = await api.updateAllowlist(environment.id, security.ipAllowlistEnabled, networks.split("\n").map((item) => item.trim()).filter(Boolean)); setSecurity(next); }}>
          <label className="check-row"><input type="checkbox" disabled={!canManageProjects(project.role)} checked={security.ipAllowlistEnabled} onChange={(event) => setSecurity({ ...security, ipAllowlistEnabled: event.target.checked })} />Restrict ingestion by IP (Business)</label>
          <label>Allowed IPs/CIDRs<textarea disabled={!canManageProjects(project.role)} value={networks} onChange={(event) => setNetworks(event.target.value)} placeholder={"203.0.113.10\n10.20.0.0/16"} /></label>
          {canManageProjects(project.role) && <button className="button button--ghost">Save allowlist</button>}
        </form>}
      </section>
    </div>
  </main>;
}
