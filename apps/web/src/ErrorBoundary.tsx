import { Component, type ErrorInfo, type ReactNode } from "react";
import { LogoMark } from "./components.js";

interface ErrorBoundaryState {
  crashed: boolean;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { crashed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { crashed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(JSON.stringify({
      level: "error",
      event: "web_render_failed",
      message: error.message,
      componentStack: info.componentStack,
      timestamp: new Date().toISOString(),
    }));
  }

  render(): ReactNode {
    if (!this.state.crashed) return this.props.children;
    return (
      <main className="fatal-page" role="alert">
        <LogoMark />
        <p className="kicker">Queue Monitor</p>
        <h1>Something went wrong</h1>
        <p>The interface hit an unexpected error. Your telemetry is still safe.</p>
        <button className="button button--primary" onClick={() => window.location.reload()}>
          Reload application
        </button>
      </main>
    );
  }
}
