import { useState } from "react";
import {
  Navigate,
  NavLink,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { Icon, LogoMark } from "./components.js";
import { useAuth } from "./auth.js";
import { LiveProvider, useLive } from "./live.js";
import { EventsPage } from "./pages/EventsPage.js";
import { LoginPage } from "./pages/LoginPage.js";
import { SignupPage } from "./pages/SignupPage.js";
import { OverviewPage } from "./pages/OverviewPage.js";
import { TracePage } from "./pages/TracePage.js";
import { SetupPage } from "./pages/SetupPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { AcceptInvitePage } from "./pages/AcceptInvitePage.js";
import { StatusPage } from "./pages/StatusPage.js";
import { PasswordResetPage } from "./pages/PasswordResetPage.js";
import { canAccessSettings } from "./permissions.js";

function AppShell() {
  const { auth, project, environment, selectEnvironment, logout } = useAuth();
  const { connected } = useLive();
  const navigate = useNavigate();
  const location = useLocation();
  const [accountOpen, setAccountOpen] = useState(false);
  const pageName = location.pathname.startsWith("/events")
    ? "Event stream"
    : location.pathname.startsWith("/traces")
      ? "Trace timeline"
      : location.pathname.startsWith("/setup")
        ? "Setup"
        : location.pathname.startsWith("/settings")
          ? "Settings"
          : "Overview";

  const signOut = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><LogoMark /><span>Queue Monitor</span></div>
        <nav className="main-nav" aria-label="Primary navigation">
          <NavLink to="/overview"><Icon name="overview" /><span>Overview</span></NavLink>
          <NavLink to="/events"><Icon name="events" /><span>Event stream</span></NavLink>
          <NavLink to="/setup"><Icon name="check" /><span>Setup</span></NavLink>
          {project && canAccessSettings(project.role) && <NavLink to="/settings"><Icon name="trace" /><span>Settings</span></NavLink>}
        </nav>
        <div className="sidebar__foot">
          <a className="support-link" href="mailto:support@queue-monitor.dev"><Icon name="alert" /><span><strong>Contact support</strong><small>support@queue-monitor.dev</small></span></a>
          <div className="ingestion-state">
            <span className={connected ? "pulse-dot" : "pulse-dot pulse-dot--offline"} />
            <div><strong>{connected ? "Live ingestion" : "Polling fallback"}</strong><span>{connected ? "Socket connected" : "Checks every 5 seconds"}</span></div>
          </div>
          <span className="version">QMON / SDK 1.0.0</span>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div><span className="topbar__eyebrow">Observability</span><strong>{pageName}</strong></div>
          <div className="topbar__actions">
            {environment && <label className="project-select">
              <span>Environment</span>
              <select value={environment?.id ?? ""} onChange={(event) => selectEnvironment(event.target.value)}>
                {auth?.projects.flatMap((item) => item.environments.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {item.organizationName} / {item.name} / {candidate.name}
                  </option>
                )))}
              </select>
            </label>}
            <div className="account">
              <button className="account__trigger" onClick={() => setAccountOpen((value) => !value)} aria-expanded={accountOpen}>
                <span>{(auth?.user.name ?? auth?.user.email ?? "U").slice(0, 1).toUpperCase()}</span>
                <div><strong>{auth?.user.name ?? "Authenticated user"}</strong><small>{project?.role ?? "member"} access</small></div>
                <Icon name="chevron" />
              </button>
              {accountOpen && (
                <div className="account__menu">
                  <button onClick={() => void signOut()}><Icon name="logout" />Sign out</button>
                </div>
              )}
            </div>
          </div>
        </header>
        {auth?.user.isDemo && <div className="demo-banner"><Icon name="check" /><span><strong>Read-only demo workspace</strong> Historical data is safe to explore; administrative and destructive actions are disabled.</span></div>}
        {!project || !environment ? (location.pathname === "/setup" || location.pathname.startsWith("/accept-invite") ? <Outlet /> :
          <main className="page"><div className="error-state"><Icon name="alert" /><div><strong>No environment access</strong><p>Ask an organization owner to create or grant access to an environment.</p></div></div></main>
        ) : <Outlet />}
      </div>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        <NavLink to="/overview"><Icon name="overview" /><span>Overview</span></NavLink>
        <NavLink to="/events"><Icon name="events" /><span>Events</span></NavLink>
      </nav>
    </div>
  );
}

function ProtectedLayout() {
  const { auth, loading } = useAuth();
  if (loading) return <div className="boot-screen"><LogoMark /><span className="spinner" /></div>;
  if (!auth) return <Navigate to="/login" replace />;
  return <LiveProvider><AppShell /></LiveProvider>;
}

function LoginRoute() {
  const { auth, loading } = useAuth();
  if (loading) return <div className="boot-screen"><LogoMark /><span className="spinner" /></div>;
  return auth ? <Navigate to={auth.projects.length ? "/overview" : "/setup"} replace /> : <LoginPage />;
}

function SignupRoute() {
  const { auth, loading } = useAuth();
  if (loading) return <div className="boot-screen"><LogoMark /><span className="spinner" /></div>;
  return auth ? <Navigate to={auth.projects.length ? "/overview" : "/setup"} replace /> : <SignupPage />;
}

function SettingsRoute() {
  const { project } = useAuth();
  return project && canAccessSettings(project.role) ? <SettingsPage /> : <Navigate to="/overview" replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginRoute />} />
      <Route path="/signup" element={<SignupRoute />} />
      <Route path="/status" element={<StatusPage />} />
      <Route path="/forgot-password" element={<PasswordResetPage />} />
      <Route path="/reset-password" element={<PasswordResetPage />} />
      <Route element={<ProtectedLayout />}>
        <Route path="/overview" element={<OverviewPage />} />
        <Route path="/events" element={<EventsPage />} />
        <Route path="/traces/:traceId" element={<TracePage />} />
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/settings" element={<SettingsRoute />} />
        <Route path="/accept-invite" element={<AcceptInvitePage />} />
        <Route path="/" element={<Navigate to="/overview" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/overview" replace />} />
    </Routes>
  );
}
