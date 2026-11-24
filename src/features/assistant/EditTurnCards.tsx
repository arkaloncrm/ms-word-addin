import { useState } from "react";
import { Toggle } from "@/ui/primitives";
import { RedlineCard } from "@/features/review/RedlineCard";
import { EditApplyAll, type CardError, type NoteTask } from "./EditApplyAll";
import { CommentCard, applyCommentProposal, canAddProposal, replyTarget } from "./CommentCard";
import type { RedlineSuggestion } from "@/api/types";
import type { CommentProposal } from "@/api/edit";
import type { DocumentComment } from "@/lib/wordComments";
import type { Decision } from "@/features/review/decisions";

/** Stable identity of a proposed comment by its content. */
export function noteKey(p: CommentProposal): string {
  return `note\u0000${p.replyTo ?? ""}\u0000${p.anchor}\u0000${p.text}`;
}

function countLabel(edits: number, notes: number): string {
  const parts: string[] = [];
  if (edits) parts.push(`${edits} proposed edit${edits === 1 ? "" : "s"}`);
  if (notes) parts.push(`${notes} comment${notes === 1 ? "" : "s"}`);
  return parts.join(", ");
}

/**
 * The cards for the latest Edit turn: proposed changes (RedlineCard) and
 * proposed Word comments or replies (CommentCard), with Apply all and the
 * "Explain each change in a comment bubble" switch. Nothing touches the
 * document until the lawyer applies a card or presses Apply all.
 */
export function EditTurnCards({
  redlines,
  notes,
  commentTargets,
  keyOf,
  decisionOf,
  decisionOfLive,
  setDecision,
  applyBusy,
  setApplyBusy,
  cardErrors,
  setCardErrors,
  onApplied,
  showApplyAll,
  explain,
  setExplain,
}: {
  redlines: RedlineSuggestion[];
  notes: CommentProposal[];
  /** The Word comments read when this turn was drafted (replyTo indexes them). */
  commentTargets: DocumentComment[];
  keyOf: (r: RedlineSuggestion) => string;
  decisionOf: (key: string) => Decision;
  decisionOfLive: (key: string) => Decision;
  setDecision: (key: string, d: Decision) => void;
  applyBusy: boolean;
  setApplyBusy: (b: boolean) => void;
  cardErrors: Record<string, CardError>;
  setCardErrors: (e: Record<string, CardError>) => void;
  onApplied: () => void;
  /** False while the turn is still streaming in. */
  showApplyAll: boolean;
  explain: boolean;
  setExplain: (on: boolean) => void;
}) {
  // Comment text as edited by the lawyer, so Apply all adds what they see.
  const [noteText, setNoteText] = useState<Record<string, string>>({});
  const textOf = (p: CommentProposal) => noteText[noteKey(p)] ?? p.text;
  const hasBubbles = redlines.some((r) => r.marginComment?.trim());

  const noteTasks: NoteTask[] = notes.map((p) => {
    const key = noteKey(p);
    const target = replyTarget(p, commentTargets);
    return {
      key,
      label: p.label,
      addable: canAddProposal(p, target),
      isPending: () => decisionOfLive(key) === "pending",
      run: () => applyCommentProposal(p, target, textOf(p)),
      markDone: () => setDecision(key, "accepted"),
    };
  });

  return (
    <div className="stack">
      <span className="small muted">{countLabel(redlines.length, notes.length)}</span>
      {hasBubbles && (
        <div className="explain-toggle">
          <div className="stack" style={{ gap: 2, minWidth: 0 }}>
            <span className="small">Explain each change in a comment bubble</span>
            <span className="small muted">
              Adds a short, courteous note for the other side next to each change you apply. Never
              internal strategy.
            </span>
          </div>
          <Toggle checked={explain} onChange={setExplain} label="Explain each change in a comment bubble" />
        </div>
      )}
      {showApplyAll && (
        <EditApplyAll
          redlines={redlines}
          keyOf={keyOf}
          decisionOf={(r) => decisionOf(keyOf(r))}
          decisionOfLive={(r) => decisionOfLive(keyOf(r))}
          setDecision={(r, d) => setDecision(keyOf(r), d)}
          applyBusy={applyBusy}
          setApplyBusy={setApplyBusy}
          onApplied={onApplied}
          onErrors={setCardErrors}
          commentFor={explain ? (r) => r.marginComment?.trim() || null : undefined}
          notes={noteTasks}
        />
      )}
      {redlines.map((r, i) => (
        <RedlineCard
          key={`${keyOf(r)}::${i}`}
          redline={r}
          index={i}
          decision={decisionOf(keyOf(r))}
          onDecision={(_idx, d) => setDecision(keyOf(r), d)}
          onApplied={onApplied}
          applyBusy={applyBusy}
          setApplyBusy={setApplyBusy}
          externalError={cardErrors[keyOf(r)] ?? null}
          commentOnApply={explain ? r.marginComment?.trim() || null : null}
        />
      ))}
      {notes.map((p, i) => {
        const key = noteKey(p);
        return (
          <CommentCard
            key={key}
            proposal={p}
            target={replyTarget(p, commentTargets)}
            index={redlines.length + i}
            text={textOf(p)}
            onTextChange={(t) => setNoteText((prev) => ({ ...prev, [key]: t }))}
            decision={decisionOf(key)}
            onDecision={(d) => setDecision(key, d)}
            applyBusy={applyBusy}
            setApplyBusy={setApplyBusy}
            externalError={cardErrors[key] ?? null}
          />
        );
      })}
    </div>
  );
}
