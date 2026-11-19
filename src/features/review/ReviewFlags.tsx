import { useState } from "react";
import { FlagIcon, LocateIcon } from "@/ui/icons";
import { IconButton } from "@/ui/primitives";
import { locateInDocument } from "@/office/navigate";
import type { ReviewFlag } from "@/api/types";
import "./review-flags.css";

/**
 * "Flag for discussion" section: substantive things the review NOTICED but
 * deliberately did NOT redline (a wrong entity name, an odd schedule entry, a
 * genuine ambiguity). These are not edits; they are items a human should
 * confirm before signing. Visually distinct from redlines (amber/info card).
 *
 * Each flag shows the exact contract wording it is about (when there is one),
 * with a button that jumps to that wording in Word, so every point can be
 * checked at its source.
 *
 * Purely additive: renders nothing when there are no flags, so an older backend
 * that omits `flags` changes nothing about the existing review UI.
 */
export function ReviewFlags({ flags }: { flags: ReviewFlag[] }) {
  // Index of each flag whose wording could not be found, to say so in place.
  const [notFound, setNotFound] = useState<Set<number>>(new Set());

  if (!flags || flags.length === 0) return null;

  async function find(i: number, quote: string) {
    const found = await locateInDocument(quote).catch(() => false);
    setNotFound((prev) => {
      const next = new Set(prev);
      if (found) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  return (
    <section className="review-flags card" aria-label="Flag for discussion">
      <div className="review-flags__head">
        <span className="review-flags__icon" aria-hidden>
          <FlagIcon size={13} />
        </span>
        <h2 className="review-flags__title">Flag for discussion</h2>
        <span className="review-flags__count">{flags.length}</span>
      </div>
      <p className="review-flags__intro small">Noticed but not changed. Confirm before sending.</p>
      <ul className="review-flags__list">
        {flags.map((flag, i) => (
          <li className="review-flags__item" key={`${flag.clauseName}-${i}`}>
            <span className="review-flags__num" aria-hidden>
              {i + 1}
            </span>
            <div className="review-flags__body">
              <div className="review-flags__meta">
                <span className="review-flags__clause">{flag.clauseName}</span>
                {flag.sectionReference && (
                  <span className="review-flags__section">{flag.sectionReference}</span>
                )}
              </div>
              <p className="review-flags__observation">{flag.observation}</p>
              {flag.quote && (
                <div className="review-flags__quote">
                  <q className="small">{flag.quote}</q>
                  <IconButton label="Find in document" onClick={() => void find(i, flag.quote ?? "")}>
                    <LocateIcon size={13} />
                  </IconButton>
                </div>
              )}
              {notFound.has(i) && (
                <span className="small muted">Couldn't find that exact wording in the document.</span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
