import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api.js";
import { Icon, LogoMark } from "../components.js";

export function PasswordResetPage() {
  const [search] = useSearchParams();
  const token = search.get("token");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (token) {
        await api.confirmPasswordReset(token, password);
        setMessage("Password changed. Existing sessions were revoked; you can sign in again.");
      } else {
        const result = await api.requestPasswordReset(email);
        setMessage(result.message);
      }
    } catch (value) {
      setError(value instanceof ApiError ? value.message : "The API is unavailable.");
    } finally {
      setSubmitting(false);
    }
  };

  return <main className="login-page">
    <section className="login-story">
      <div className="brand brand--login"><LogoMark /><span>Queue Monitor</span></div>
      <div className="login-story__content"><span className="kicker"><span />Account security</span><h1>Recover access without weakening your workspace.</h1><p>Reset links are single-use, expire after 30 minutes, and revoke every existing session when used.</p></div>
    </section>
    <section className="login-panel"><div className="login-card">
      <span className="login-card__eyebrow">Account recovery</span>
      <h2>{token ? "Choose a new password" : "Reset your password"}</h2>
      <p>{token ? "Use at least 12 characters. You will need to sign in again on every device." : "We return the same response whether or not the account exists."}</p>
      {!message && <form onSubmit={(event) => void submit(event)}>
        {token
          ? <label>New password<input type="password" autoComplete="new-password" minLength={12} maxLength={200} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
          : <label>Email address<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>}
        {error && <div className="form-error"><Icon name="alert" />{error}</div>}
        <button className="button button--primary button--wide" disabled={submitting}>{submitting ? "Working…" : token ? "Change password" : "Send reset link"}</button>
      </form>}
      {message && <div className="form-success"><Icon name="check" />{message}</div>}
      <p className="auth-switch"><Link to="/login">Back to sign in</Link></p>
    </div></section>
  </main>;
}
