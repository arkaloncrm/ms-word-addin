import type { ReactNode } from "react";

/**
 * A "Source: ..." line shown beside drafted or pulled-in wording, before it is
 * inserted, so the lawyer always knows where it came from: a named precedent,
 * the firm's clause library, or written by the AI.
 */
export function SourceNote({ children }: { children: ReactNode }) {
  return (
    <p className="small muted source-note" style={{ margin: 0 }}>
      <strong>Source:</strong> {children}
    </p>
  );
}
