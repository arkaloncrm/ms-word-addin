import { Button } from "@/ui/primitives";
import type { ContractParty } from "@/lib/parties";

/**
 * "Which party are you acting for?" with the contract's own party names as
 * buttons, plus "Someone else" for a party the contract does not list. Always
 * shown above the fold in Review: reviewing from the wrong side is the costliest
 * mistake a review can make, so the lawyer picks by name instead of trusting a
 * generic default.
 */
export function PartyPicker({
  parties,
  chosen,
  other,
  onChoose,
  onOther,
}: {
  parties: ContractParty[];
  /** Index of the chosen party, or null when none is chosen. */
  chosen: number | null;
  /** True when the lawyer picked "Someone else". */
  other: boolean;
  onChoose: (index: number) => void;
  onOther: () => void;
}) {
  if (parties.length === 0) return null;
  return (
    <div className="field" role="group" aria-label="Which party are you acting for?">
      <label>Which party are you acting for?</label>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        {parties.map((p, i) => (
          <Button
            key={p.name}
            type="button"
            size="sm"
            variant={chosen === i ? "primary" : "default"}
            aria-pressed={chosen === i}
            onClick={() => onChoose(i)}
          >
            {p.name}
            {p.role ? ` (${p.role})` : ""}
          </Button>
        ))}
        <Button
          type="button"
          size="sm"
          variant={other ? "primary" : "default"}
          aria-pressed={other}
          onClick={onOther}
        >
          Someone else
        </Button>
      </div>
    </div>
  );
}
