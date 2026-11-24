/**
 * Lightweight, deterministic intent classifier for the assistant composer.
 *
 * Phase 1: detect when an Ask-mode message is really a document ACTION (redline
 * or navigate) so the assistant can offer to run it instead of just answering.
 * Deliberately conservative and client-side (no LLM): a false positive only ever
 * surfaces a dismissible "Do it / Just answer" chip, never a silent action, so
 * this errs toward offering rather than guessing wrong. Destructive actions
 * (accept/reject, clean copy, redact) are intentionally NOT auto-detected here;
 * they belong to a later phase behind explicit confirms.
 */

export type Intent =
  | { action: "ask" }
  /**
   * `explicit`: the lawyer plainly asked for the document to be changed ("insert
   * it into the text", "apply these changes"), so the Edit flow runs straight
   * away. It only drafts cards; nothing touches the document until the lawyer
   * applies a card, so this is still never a silent change.
   * `followUp`: the request points back at wording ArkLaw already proposed
   * ("insert this", "apply that"), so that earlier answer is the instruction.
   */
  | { action: "edit"; explicit?: boolean; followUp?: boolean }
  | { action: "navigate"; target: string }
  | { action: "comment"; target: string; note: string }
  // Destructive document actions -- always run behind an explicit confirm.
  | { action: "accept" }
  | { action: "cleanCopy" };

// Leading verbs that almost always mean "modify the open document".
const STRONG_EDIT = new Set([
  "redline",
  "rewrite",
  "reword",
  "revise",
  "redraft",
  "amend",
  "strike",
  "tighten",
  "soften",
  "strengthen",
  "weaken",
  "narrow",
  "broaden",
]);

// Verbs that mean edit only when clearly aimed at a clause / legal object, so
// "add a confidentiality clause" is an edit but "add up the fees" is not.
const OBJECTY_EDIT = new Set([
  "change",
  "edit",
  "modify",
  "cap",
  "update",
  "adjust",
  "add",
  "insert",
  "remove",
  "delete",
  "make",
  "limit",
  "extend",
  "shorten",
]);

// A clause / legal-object cue that disambiguates the object-y verbs above.
const LEGAL_OBJECT =
  /\b(clause|section|provision|paragraph|language|term|wording|indemn|liabilit|warrant|termination|confidential|non-?compete|non-?solicit|governing law|jurisdiction|carve-?out|cap|renewal|assignment|arbitration|indemnity)\b/i;

// Leading phrases that mean "jump to something in the document".
const NAV_CUE = /^\s*(take me to|go to|jump to|scroll to|find the|show me the|where is the|where is|locate)\b\s*/i;

// Clean copy: accept every change AND strip comments (send-ready).
const CLEAN_CUE =
  /\b(clean copy|clean version|send-?ready copy|finali[sz]e (?:the )?(?:document|contract|draft)|accept everything and (?:remove|strip|delete) (?:the )?comments)\b/i;

// Accept all tracked changes.
const ACCEPT_CUE = /\baccept (?:all|every|the) (?:tracked )?(?:changes|edits|revisions|redlines)\b/i;

// Comment: "comment on X: note", "add a note to X", "flag X".
const COMMENT_CUE =
  /^\s*(?:comment on|add a (?:note|comment) (?:to|on)|leave a (?:note|comment) (?:on|about)|flag(?: the)?)\s+/i;

// Conversational lead-ins that hide the real verb: "yes, can you insert this",
// "ok please rewrite 9.1", "could you please suggest one and insert it". The
// classifier strips these (repeatedly) before reading the first word, so the
// verb that follows decides the intent rather than "yes" or "can".
const LEAD_IN = new RegExp(
  "^\\s*(?:" +
    [
      "(?:yes|yeah|yep|yup|ok|okay|sure|great|good|perfect|thanks|thank you|cheers|please|pls|now|then|and|so|right|alright|cool|lovely|excellent|fine|done|nice)\\b[\\s,.!:;-]*",
      "(?:can|could|would|will) (?:you|u)\\b[\\s,]*",
      "(?:i(?:'d| would) like you to|i want you to|i need you to|go ahead and|let'?s|kindly)\\b[\\s,]*",
    ].join("|") +
    ")",
  "i",
);

/** Remove conversational lead-ins so the message starts at its real verb. */
export function stripLeadIns(text: string): string {
  let t = text.trim();
  for (let i = 0; i < 8; i++) {
    const m = t.match(LEAD_IN);
    if (!m || !m[0]) break;
    t = t.slice(m[0].length).trim();
  }
  return t;
}

// A question about whether or what to change is a question, not an instruction:
// "should I insert a cap?", "what would you add to the contract?".
const QUESTION_START =
  /^(?:should|shall|would it|is|are|was|were|does|did|do (?:i|we|they)|what|why|how|when|which|who|where|whether)\b/i;

// An explicit request to put wording into the document: "insert this into the
// text", "add it to the contract", "put that in clause 9". "add up" is arithmetic.
const INTO_DOC =
  /\b(?:insert|put|apply|add(?!\s+up\b)|place|drop|paste|write|incorporate)\b[^.?!]{0,80}?\b(?:in|into|to|onto)\s+(?:the|my|this|our)\s+(?:text|document|doc|contract|agreement|draft|clause|word|file)\b/i;

// "apply these changes", "make that change", "use your version", "insert the clause".
const APPLY_CHANGES =
  /\b(?:apply|make|action|implement|insert|incorporate|use)\s+(?:this|that|these|those|the|your|them)\s+(?:changes?|edits?|amendments?|suggestions?|rewrites?|redrafts?|wording|drafting|clauses?|redlines?|versions?|definitions?)\b/i;

// "insert" as a verb anywhere ("suggest one and insert it") asks for a change.
// "inserted" / "insertion" are not matched (\b after insert).
const INSERT_VERB = /\binsert\b/i;

// The request points at something already on screen rather than describing new
// wording: "insert this", "apply that", "use your suggestion", "the above".
const DEICTIC =
  /\b(?:this|that|it|these|those|them|the above|your (?:suggestions?|versions?|rewrites?|drafts?|wording|clauses?|amendments?|changes?|edits?|definitions?))\b/i;

// ...unless the same message asks ArkLaw to come up with new wording first, in
// which case "it" is the thing being asked for, not an earlier answer.
const ASKS_FOR_NEW = /\b(?:suggest|draft|propose|write|come up with|give me|create)\b/i;

function firstWord(text: string): string {
  return text.trim().toLowerCase().split(/\s+/)[0]?.replace(/[^a-z-]/g, "") ?? "";
}

export function classifyIntent(text: string): Intent {
  const t = text.trim();
  if (!t) return { action: "ask" };
  const lower = t.toLowerCase();

  // Clean copy is checked before accept (it also mentions accepting).
  if (CLEAN_CUE.test(lower)) return { action: "cleanCopy" };
  if (ACCEPT_CUE.test(lower)) return { action: "accept" };

  // Comment: "comment on <target>: <note>" / "flag <target>". A ":" splits the
  // anchor from the note; otherwise the whole remainder is the anchor and the
  // note defaults to a flag.
  const lead = stripLeadIns(t);
  const cm = lead.match(COMMENT_CUE);
  if (cm) {
    const rest = lead.slice(cm[0].length).trim();
    const colon = rest.indexOf(":");
    let target = colon >= 0 ? rest.slice(0, colon) : rest;
    const note = colon >= 0 ? rest.slice(colon + 1).trim() : "";
    target = target
      .replace(/^(the|a|an)\s+/i, "")
      .replace(/\s+(clause|section|provision|paragraph)\b/i, "")
      .replace(/[?.!]+\s*$/, "")
      .trim();
    // "flag any issues" / "flag the risks" are questions, not comment requests:
    // a vague target means the user wants an answer, not a comment on that text.
    const vague = /^(any|all)?\s*(issues?|problems?|risks?|concerns?|red flags?|anything|everything)$/i;
    if (target.length >= 3 && !vague.test(target)) {
      return { action: "comment", target, note: note || "Flagged for review." };
    }
  }

  // Navigate: a leading nav phrase, with the remainder as the target to find.
  const nav = lead.match(NAV_CUE);
  if (nav) {
    const target = lead
      .slice(nav[0].length)
      .replace(/^(the|a|an)\s+/i, "")
      .replace(/\s+(clause|section|provision|paragraph)\b/i, "")
      .replace(/[?.!]+\s*$/, "")
      .trim();
    if (target.length >= 3) return { action: "navigate", target };
  }

  // Edit. Read the message from its real verb, not from "yes" / "can you".
  const core = stripLeadIns(t);
  const coreLower = core.toLowerCase();
  if (!QUESTION_START.test(core)) {
    // An explicit request to change the document runs the Edit flow directly.
    if (INTO_DOC.test(core) || APPLY_CHANGES.test(core) || INSERT_VERB.test(core)) {
      const followUp = DEICTIC.test(core) && !ASKS_FOR_NEW.test(core) && core.length <= 240;
      return { action: "edit", explicit: true, followUp };
    }
  }

  // A strong leading verb, an object-y verb aimed at a legal object, or
  // "redline" anywhere near the front: offer the Edit flow.
  const fw = firstWord(core);
  if (STRONG_EDIT.has(fw)) return { action: "edit" };
  if (OBJECTY_EDIT.has(fw) && LEGAL_OBJECT.test(coreLower)) return { action: "edit" };
  if (/\bredline\b/i.test(lower)) return { action: "edit" };

  return { action: "ask" };
}
