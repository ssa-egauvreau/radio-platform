// Shared "this panel has no useful state to show right now" components.
// Used by the analytics page first; intended to replace ad-hoc inline
// "(loading)" / "no data" / red-text-on-blank-page patterns across the console.

import type { ReactNode } from "react";
import { IconAlertTriangle } from "../../icons";

interface EmptyStateProps {
  /** One short noun phrase — "No transmissions yet". */
  title: string;
  /** Optional second-line explanation. */
  description?: string;
  /** Optional CTA — usually a "Refresh" or "Try again" button. */
  action?: ReactNode;
}

/** Use when a fetch succeeded but returned zero rows. NOT for errors or loading. */
export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="ui-empty">
      <div className="ui-empty-title">{title}</div>
      {description && <div className="ui-empty-desc">{description}</div>}
      {action && <div className="ui-empty-action">{action}</div>}
    </div>
  );
}

interface LoadingStateProps {
  /** Optional label shown next to the spinner. Defaults to nothing. */
  label?: string;
  /** Inline vs centred block. Defaults to "block". */
  variant?: "inline" | "block";
}

/** Lightweight loading placeholder — preferred over blank space while polling. */
export function LoadingState({ label, variant = "block" }: LoadingStateProps) {
  return (
    <div className={`ui-loading ui-loading-${variant}`}>
      <span className="ui-loading-spinner" aria-hidden="true" />
      {label && <span className="ui-loading-label">{label}</span>}
    </div>
  );
}

interface ErrorStateProps {
  /** Short user-readable summary — "Couldn't load analytics." */
  title: string;
  /** Optional detail line (e.g. the `describeError` output). */
  detail?: string;
  /** Optional retry button — wired by the caller. */
  onRetry?: () => void;
}

/** Use when a fetch *failed*, not for transient validation errors inside forms. */
export function ErrorState({ title, detail, onRetry }: ErrorStateProps) {
  return (
    <div className="ui-error" role="alert">
      <span className="ui-error-icon" aria-hidden="true">
        <IconAlertTriangle />
      </span>
      <div className="ui-error-body">
        <div className="ui-error-title">{title}</div>
        {detail && <div className="ui-error-detail">{detail}</div>}
      </div>
      {onRetry && (
        <button type="button" className="btn sm" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
