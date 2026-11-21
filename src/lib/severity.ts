export type Severity = "high" | "medium" | "low";

/**
 * How much a finding matters. Uses the reviewer model's own rating when the
 * review carries one (every current review does). Older or server reviews
 * without it fall back to the deal-breaker / sign-off heuristic. Without this,
 * every ordinary material issue in a BYOK review (no approval levels) showed
 * as "Low".
 */
export function severityOf(r: {
  isDealBreaker: boolean;
  approvalLevel?: "none" | "manager" | "partner" | "gc" | null;
  severity?: Severity;
}): Severity {
  // A deal-breaker or a partner/GC sign-off is always high, whatever the rating.
  if (r.isDealBreaker || r.approvalLevel === "partner" || r.approvalLevel === "gc") return "high";
  if (r.severity === "high" || r.severity === "medium" || r.severity === "low") return r.severity;
  if (r.approvalLevel === "manager") {
    return "medium";
  }
  return "low";
}

export const SEVERITY_META: Record<Severity, { label: string; tone: "red" | "yellow" | "neutral" }> = {
  high: { label: "High", tone: "red" },
  medium: { label: "Medium", tone: "yellow" },
  low: { label: "Low", tone: "neutral" },
};
