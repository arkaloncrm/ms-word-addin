import { Badge } from "@/ui/primitives";
import type { Grounding } from "@/api/types";

/**
 * Grounding is the transparency signal: whether the quoted clause was found
 * word for word, exactly once, in the document (src/lib/grounding.ts).
 * `note` says why a clause is unverified (not found, or found more than once);
 * it shows as the badge's tooltip and is read out by screen readers.
 */
export function GroundingBadge({ grounding, note }: { grounding: Grounding; note?: string }) {
  switch (grounding) {
    case "verified":
      return <Badge tone="green">Verified</Badge>;
    case "insertion":
      return <Badge tone="brand">New clause</Badge>;
    default:
      return (
        <span title={note} aria-label={note ? `Verify manually. ${note}` : undefined}>
          <Badge tone="yellow">Verify manually</Badge>
        </span>
      );
  }
}
