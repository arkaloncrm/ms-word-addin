import { useEffect, useState } from "react";
import { parseCitations } from "@/legal/cite";
import { attribution, verifyCitations, type ActCheck, type RegisterClient, type SectionCheck } from "@/legal/verify";
import { register } from "@/legal/register";
import { Spinner } from "@/ui/primitives";
import "./law-cited.css";

/**
 * "Law cited": under an Ask answer, every Commonwealth Act and section the
 * answer cites is checked against the Federal Register of Legislation (the
 * official register), with a link to the official page and the section's real
 * text one click away. State laws and schedule provisions are labelled as not
 * checked, never as missing.
 */
export function LawCited({ text, client = register }: { text: string; client?: RegisterClient }) {
  const cited = parseCitations(text).length;
  const [checks, setChecks] = useState<ActCheck[] | null>(null);
  // The credit line names the date the register was read.
  const [checkedAt, setCheckedAt] = useState<Date>(() => new Date());

  useEffect(() => {
    if (cited === 0) return;
    // Leaving the answer (or a new one) stops any lookups still running.
    const controller = new AbortController();
    setChecks(null);
    verifyCitations(text, client, controller.signal)
      .then((r) => {
        if (controller.signal.aborted) return;
        setCheckedAt(new Date());
        setChecks(r);
      })
      .catch(() => !controller.signal.aborted && setChecks([]));
    return () => controller.abort();
  }, [text, client, cited]);

  if (cited === 0) return null;

  return (
    <section className="law-cited" aria-label="Law cited, checked against the Federal Register of Legislation">
      <div className="law-cited__head">
        <strong className="small">Law cited</strong>
        <span className="small muted">checked against the Federal Register of Legislation</span>
      </div>
      {checks === null ? (
        <span className="small muted row" style={{ gap: 6, alignItems: "center" }}>
          <Spinner /> Checking {cited === 1 ? "the Act" : `${cited} Acts`} on the official register...
        </span>
      ) : checks.length === 0 ? (
        <span className="small muted">Couldn't check the register right now.</span>
      ) : (
        <ul className="law-cited__list">
          {checks.map((a) => (
            <ActRow key={`${a.cited}-${a.jurisdiction ?? ""}`} act={a} />
          ))}
        </ul>
      )}
      <p className="small muted law-cited__credit">
        {attribution(checkedAt)} Commonwealth laws only for now.{" "}
        <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">
          CC BY 4.0
        </a>
      </p>
    </section>
  );
}

const ACT_STATUS: Record<ActCheck["status"], { icon: string; tone: string; label: (a: ActCheck) => string }> = {
  "in-force": { icon: "✓", tone: "ok", label: (a) => (a.closest ? "closest match on the register" : "in force") },
  "not-in-force": { icon: "!", tone: "warn", label: (a) => `no longer in force${a.registerStatus ? ` (${a.registerStatus})` : ""}` },
  "no-match": {
    icon: "?",
    tone: "warn",
    label: () => "not on the Commonwealth register (it may be a state law, or the name may be wrong)",
  },
  "state-law": { icon: "–", tone: "muted", label: (a) => `${a.jurisdiction} law: not checked yet` },
  unverified: { icon: "?", tone: "muted", label: () => "couldn't check the register right now" },
  "over-limit": { icon: "–", tone: "muted", label: () => "not checked: too many Acts in one answer" },
};

function ActRow({ act }: { act: ActCheck }) {
  const s = ACT_STATUS[act.status];
  const title = act.name ?? act.cited;
  return (
    <li className={`law-cited__act law-cited--${s.tone}`}>
      <div className="law-cited__line">
        <span className="law-cited__icon" aria-hidden>
          {s.icon}
        </span>
        {act.link ? (
          <a href={act.link} target="_blank" rel="noreferrer" title="Open on the Federal Register of Legislation">
            {title}
          </a>
        ) : (
          <span>{title}</span>
        )}
        {act.jurisdiction && <span className="small muted"> ({act.jurisdiction})</span>}
        <span className="small muted"> · {s.label(act)}</span>
      </div>
      {act.closest && act.name !== act.cited && (
        <span className="small muted law-cited__note">The answer cited "{act.cited}".</span>
      )}
      {act.sections.length > 0 && (
        <ul className="law-cited__sections">
          {act.sections.map((sec, i) => (
            <SectionRow key={`${i}-${sec.no}`} sec={sec} />
          ))}
        </ul>
      )}
    </li>
  );
}

const SECTION_ICON: Record<SectionCheck["status"], string> = {
  found: "✓",
  "not-found": "✗",
  unverified: "?",
  "not-checked": "–",
};

function SectionRow({ sec }: { sec: SectionCheck }) {
  const [open, setOpen] = useState(false);
  const label = `s ${sec.no}`;
  if (sec.status === "found") {
    return (
      <li className="law-cited__section law-cited--ok">
        <button
          type="button"
          className="linkaction law-cited__toggle"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span aria-hidden>{SECTION_ICON.found}</span> {label}
          {sec.heading ? ` ${sec.heading}` : ""} <span className="small muted">({open ? "hide text" : "read the section"})</span>
        </button>
        {open && sec.body && <blockquote className="law-cited__text">{sec.body}</blockquote>}
      </li>
    );
  }
  const tone = sec.status === "not-found" ? "bad" : "muted";
  const words =
    sec.status === "not-found" ? "not in this Act" : sec.status === "unverified" ? "couldn't confirm" : "not checked";
  // Notes from a failed download are technical; the lawyer just needs "couldn't confirm".
  const showNote = sec.note && (sec.status !== "unverified" || sec.note.startsWith("Couldn't confirm"));
  return (
    <li className={`law-cited__section law-cited--${tone}`}>
      <span aria-hidden>{SECTION_ICON[sec.status]}</span> {label} <span className="small muted">· {words}</span>
      {showNote && <span className="small muted law-cited__note"> {sec.note}</span>}
    </li>
  );
}
