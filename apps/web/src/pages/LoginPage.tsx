import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError } from "../api.js";
import { useAuth } from "../auth.js";
import { Icon, LogoMark } from "../components.js";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email, password);
      navigate("/overview", { replace: true });
    } catch (value) {
      setError(value instanceof ApiError ? value.message : "The API is unavailable. Check that it is running.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="login-page">
      <section className="login-story">
        <div className="brand brand--login"><LogoMark /><span>Queue Monitor</span></div>
        <div className="login-story__content">
          <span className="kicker"><span /> Correlated by design</span>
          <h1>Follow every request beyond the HTTP boundary.</h1>
          <p>See the API call, every queue transition, every retry, and the final provider failure as one causally ordered trace.</p>
          <div className="mini-trace" aria-hidden="true">
            <div><span className="mini-trace__node mini-trace__node--http"><Icon name="http" /></span><strong>POST /orders</strong><small>202 Accepted · 42 ms</small></div>
            <i />
            <div><span className="mini-trace__node"><Icon name="queue" /></span><strong>process-order</strong><small>queued → active</small></div>
            <i />
            <div><span className="mini-trace__node mini-trace__node--warn"><Icon name="retry" /></span><strong>Provider retry</strong><small>attempt 2 of 3</small></div>
            <i />
            <div><span className="mini-trace__node mini-trace__node--fail"><Icon name="alert" /></span><strong>PaymentProviderError</strong><small>failure reason captured</small></div>
          </div>
        </div>
        <p className="login-story__foot">HTTP + BullMQ telemetry in one timeline</p>
      </section>

      <section className="login-panel">
        <div className="login-card">
          <span className="login-card__eyebrow">Welcome back</span>
          <h2>Sign in to your workspace</h2>
          <p>Your session is kept in a secure, HttpOnly cookie and is never exposed to browser storage.</p>
          <form onSubmit={(event) => void submit(event)}>
            <label>Email address<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
            <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required /></label>
            {error && <div className="form-error"><Icon name="alert" />{error}</div>}
            <button className="button button--primary button--wide" disabled={submitting}>
              {submitting ? <><span className="spinner spinner--small" />Signing in</> : <>Open web app<Icon name="arrow" /></>}
            </button>
          </form>
          <div className="demo-credentials">
            <span>Local demo</span>
            <code>Use the credentials configured in your local .env file.</code>
          </div>
          <p className="auth-switch"><Link to="/forgot-password">Forgot password?</Link> · New here? <Link to="/signup">Create an account</Link></p>
        </div>
      </section>
    </main>
  );
}
