import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError } from "../api.js";
import { useAuth } from "../auth.js";
import { Icon, LogoMark } from "../components.js";

export function SignupPage() {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await signup(name, email, password);
      navigate("/setup", { replace: true });
    } catch (value) {
      setError(value instanceof ApiError ? value.message : "The API is unavailable.");
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <main className="login-page">
      <section className="login-story">
        <div className="brand brand--login"><LogoMark /><span>Queue Monitor</span></div>
        <div className="login-story__content"><span className="kicker"><span />External developer beta</span><h1>Debug the whole request, not just the first hop.</h1><p>Create an isolated production stream, send your first event, and follow retries to their final cause.</p></div>
      </section>
      <section className="login-panel"><div className="login-card">
        <span className="login-card__eyebrow">Create your account</span>
        <h2>Start monitoring in minutes</h2>
        <p>Your password is hashed server-side and authentication uses a secure HttpOnly session cookie.</p>
        <form onSubmit={(event) => void submit(event)}>
          <label>Full name<input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" minLength={2} required /></label>
          <label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>
          <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={12} required /></label>
          {error && <div className="form-error"><Icon name="alert" />{error}</div>}
          <button className="button button--primary button--wide" disabled={submitting}>{submitting ? "Creating account…" : <>Create account<Icon name="arrow" /></>}</button>
        </form>
        <p className="auth-switch">Already have an account? <Link to="/login">Sign in</Link></p>
      </div></section>
    </main>
  );
}
