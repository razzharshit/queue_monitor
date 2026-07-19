import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api.js";
import { useAuth } from "../auth.js";
import { Icon } from "../components.js";
import type { Invitation } from "../types.js";

export function AcceptInvitePage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { refresh } = useAuth();
  const navigate = useNavigate();
  useEffect(() => { void api.invitation(token).then(setInvitation).catch((value) => setError(value instanceof ApiError ? value.message : "Invitation unavailable")); }, [token]);
  const accept = async () => {
    try { await api.acceptInvitation(token); await refresh(); navigate("/overview", { replace: true }); }
    catch (value) { setError(value instanceof ApiError ? value.message : "Could not accept invitation"); }
  };
  return <main className="page"><div className="page-heading"><div><span className="kicker"><span />Team invitation</span><h1>Join {invitation?.organizationName ?? "organization"}</h1><p>{invitation ? `${invitation.email} · ${invitation.role} access` : "Checking invitation…"}</p></div></div>{error && <div className="error-state"><Icon name="alert" /><div><strong>Invitation unavailable</strong><p>{error}</p></div></div>}{invitation && <button className="button button--primary" onClick={() => void accept()}>Accept invitation</button>}</main>;
}
