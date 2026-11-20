import type { ReactNode } from "react";

/** What a locked feature says in ArkLaw. One place to change it. */
export const NOT_YET_NOTE = "Not in ArkLaw yet.";

export function LockIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

/**
 * Locked-feature card. Shown where a feature needs data or an account ArkLaw
 * does not have yet (case law, legislation, client records), so the lawyer SEES
 * what is missing instead of the feature being hidden or failing on click. It
 * links nowhere: ArkLaw has no hosted plan to send anyone to.
 */
export function UpgradeGate({
  title,
  children,
  notYet = true,
}: {
  title: string;
  children?: ReactNode;
  /** False when the lawyer can unlock it themselves (for example with a token in Settings). */
  notYet?: boolean;
}) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="row" style={{ gap: 8, alignItems: "center", color: "#7a5b12" }}>
        <LockIcon size={16} />
        <strong>{title}</strong>
      </div>
      {(children || notYet) && (
        <p className="small muted" style={{ margin: "8px 0 0" }}>
          {children}
          {children && notYet ? " " : ""}
          {notYet ? NOT_YET_NOTE : null}
        </p>
      )}
    </div>
  );
}

/** Compact inline variant, for a locked action that sat in a row of buttons. */
export function UpgradeLink({ label }: { label: string }) {
  return (
    <span
      className="btn btn--sm"
      aria-disabled="true"
      title={NOT_YET_NOTE}
      style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "default", opacity: 0.7 }}
    >
      <LockIcon size={14} /> {label}
    </span>
  );
}
