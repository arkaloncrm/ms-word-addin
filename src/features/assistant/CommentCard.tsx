import { useState } from "react";
import { AutoTextarea } from "@/ui/AutoTextarea";
import { Badge, Button, IconButton } from "@/ui/primitives";
import { CheckIcon, CopyIcon, EditIcon, LocateIcon, UndoIcon, XIcon } from "@/ui/icons";
import { copyPlain } from "@/lib/clipboard";
import { insertCommentAnchored, locateComment, replyToComment } from "@/office/comments";
import { locateInDocument } from "@/office/navigate";
import { errorMessage } from "@/api/errors";
import type { CommentProposal } from "@/api/edit";
import type { DocumentComment } from "@/lib/wordComments";
import type { Decision } from "@/features/review/decisions";
import "./comment-card.css";

/** The existing Word comment a reply answers, if this proposal is a reply. */
export function replyTarget(
  p: CommentProposal,
  comments: readonly DocumentComment[],
): DocumentComment | null {
  if (!p.replyTo || p.replyTo < 1) return null;
  return comments[p.replyTo - 1] ?? null;
}

/** True when the card can write this proposal into the document by itself. */
export function canAddProposal(p: CommentProposal, target: DocumentComment | null): boolean {
  return p.replyTo ? !!target : !!p.anchor.trim();
}

/**
 * Add a proposed comment (margin bubble) or post a reply. Throws with a plain
 * message when it cannot be placed; nothing is written in that case.
 */
export async function applyCommentProposal(
  p: CommentProposal,
  target: DocumentComment | null,
  text: string = p.text,
): Promise<void> {
  const body = text.trim();
  if (!body) throw new Error("The comment is empty.");
  if (p.replyTo) {
    if (!target) throw new Error("Couldn't find the comment this replies to. Nothing was added.");
    const ok = await replyToComment(target.id, body);
    if (!ok) throw new Error("That comment is no longer in the document. Nothing was added.");
    return;
  }
  if (!p.anchor.trim()) throw new Error("Couldn't tell where this comment goes. Copy it instead.");
  const r = await insertCommentAnchored(p.anchor, body);
  if (r === "not_found") throw new Error("Couldn't find that wording in the document. Nothing was added.");
  if (r === "unsupported_region") throw new Error("Word doesn't allow a comment in that spot. Nothing was added.");
}

function clip(s: string, max = 140): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max)}...`;
}

/**
 * One proposed Word comment or reply. The lawyer sees where it goes and can
 * edit the text before adding it; nothing goes into the document until they
 * click Add comment / Post reply (or Apply all).
 */
export function CommentCard({
  proposal,
  target,
  index,
  text,
  onTextChange,
  decision,
  onDecision,
  applyBusy,
  setApplyBusy,
  externalError,
}: {
  proposal: CommentProposal;
  target: DocumentComment | null;
  index: number;
  /** The comment text as the lawyer has it now (owned by the parent, so Apply
   *  all adds the edited text, not the original proposal). */
  text: string;
  onTextChange: (text: string) => void;
  decision: Decision;
  onDecision: (d: Decision) => void;
  applyBusy?: boolean;
  setApplyBusy?: (b: boolean) => void;
  externalError?: { message: string } | null;
}) {
  const setText = onTextChange;
  const [editing, setEditing] = useState(false);
  const [before, setBefore] = useState(text);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const isReply = !!proposal.replyTo;
  const addable = canAddProposal(proposal, target);

  async function add() {
    if (busy || applyBusy) return;
    setBusy(true);
    setApplyBusy?.(true);
    setNote(null);
    try {
      await applyCommentProposal(proposal, target, text);
      onDecision("accepted");
    } catch (e) {
      setNote(errorMessage(e));
    } finally {
      setBusy(false);
      setApplyBusy?.(false);
    }
  }

  async function copy() {
    if (await copyPlain(text)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } else {
      setNote("Copy was blocked. Select the text and use Ctrl+C.");
    }
  }

  async function show() {
    setNote(null);
    try {
      const ok = isReply && target ? await locateComment(target.id) : await locateInDocument(proposal.anchor);
      if (!ok) setNote("Couldn't find that in the document.");
    } catch (e) {
      setNote(errorMessage(e));
    }
  }

  if (decision === "accepted") {
    return (
      <div className="card redline redline--accepted">
        <span className="redline__resolved-icon redline__resolved-icon--ok">
          <CheckIcon />
        </span>
        <span className="redline__resolved-name">{proposal.label}</span>
        <span className="small muted">{isReply ? "Reply posted" : "Comment added"}</span>
      </div>
    );
  }
  if (decision === "rejected") {
    return (
      <div className="card redline redline--rejected">
        <span className="redline__resolved-name muted">{proposal.label}</span>
        <span className="small muted">Dismissed</span>
        <Button variant="ghost" size="sm" onClick={() => onDecision("pending")}>
          <UndoIcon size={13} /> Restore
        </Button>
      </div>
    );
  }

  const shownNote = note ?? externalError?.message ?? null;
  return (
    <div className="card redline redline--enter comment-card">
      <div className="redline__head">
        <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "flex-start", minWidth: 0 }}>
          <span className="redline__num">{index + 1}</span>
          <div className="redline__titlewrap">
            <strong>{proposal.label}</strong>
            <div className="redline__badges">
              <Badge tone="brand">{isReply ? "Reply" : "Comment"}</Badge>
            </div>
          </div>
        </div>
        {(isReply ? !!target : !!proposal.anchor) && (
          <IconButton label="Show me where" onClick={() => void show()}>
            <LocateIcon size={14} />
          </IconButton>
        )}
      </div>

      {isReply ? (
        <p className="small muted redline__ref">
          {target
            ? `Reply to ${target.author ? `${target.author}'s` : "a"} comment: "${clip(target.text)}"`
            : "Reply to a comment that couldn't be found in the document."}
        </p>
      ) : (
        <p className="small muted redline__ref">
          {proposal.anchor ? `On: "${clip(proposal.anchor)}"` : "No place in the document was given for this comment."}
        </p>
      )}

      {editing ? (
        <div className="redline__edit">
          <AutoTextarea
            className="redline__editbox"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={Math.min(8, Math.max(3, text.split("\n").length + 1))}
            aria-label="Edit the comment"
          />
          <div className="row" style={{ gap: 6 }}>
            <Button variant="primary" size="sm" onClick={() => setEditing(false)} disabled={!text.trim()}>
              Done
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setText(before);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <p className="comment-card__text">{text}</p>
      )}

      {!editing && (
        <div className="redline__actions">
          {addable ? (
            <Button
              variant="primary"
              size="sm"
              onClick={() => void add()}
              loading={busy}
              disabled={(applyBusy && !busy) || !text.trim()}
            >
              <CheckIcon size={14} /> {isReply ? "Post reply" : "Add comment"}
            </Button>
          ) : (
            <Button variant="default" size="sm" onClick={() => void copy()}>
              {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />} {copied ? "Copied" : "Copy"}
            </Button>
          )}
          <IconButton
            label="Edit the comment"
            onClick={() => {
              setBefore(text);
              setEditing(true);
            }}
          >
            <EditIcon size={14} />
          </IconButton>
          <IconButton label="Dismiss" tone="red" onClick={() => onDecision("rejected")}>
            <XIcon size={14} />
          </IconButton>
          {shownNote && (
            <span className={`small ${/couldn't|could not|doesn't|no longer/i.test(shownNote) ? "redline__note--err" : "muted"}`}>
              {shownNote}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
