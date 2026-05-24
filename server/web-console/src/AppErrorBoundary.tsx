import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

/** Catches errors anywhere in the app (including outside Mission Control). */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("App render error:", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="boot-fatal">
          <h1>safeT PTT could not start</h1>
          <p>{this.state.error.message}</p>
          <p className="muted">
            If this only happens in normal Chrome (not incognito), clear saved site data or open
            Mission Control with{" "}
            <code>?console_reset=1</code> on the URL, then sign in again.
          </p>
          <div className="boot-fatal-actions">
            <button
              type="button"
              className="btn"
              onClick={() => {
                try {
                  localStorage.removeItem("securityradio.console.state");
                  localStorage.removeItem("securityradio.openChannels");
                  localStorage.removeItem("securityradio.lastChannel");
                } catch {
                  /* ignore */
                }
                window.location.href = "/console?console_reset=1";
              }}
            >
              Clear saved console data and reload
            </button>
            <button type="button" className="btn sm" onClick={() => window.location.reload()}>
              Reload page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
