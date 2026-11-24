import { useEffect, useRef, useState } from "react";
import { Banner, Button, Field, IconButton, Modal } from "@/ui/primitives";
import { AutoTextarea } from "@/ui/AutoTextarea";
import { useVoiceInput } from "@/lib/useVoiceInput";
import {
  FEATURE_REQUEST_MAX,
  featureRequestsEnabled,
  sendFeatureRequest,
  type FeatureRequestSource,
} from "@/api/featureRequest";
import "./suggest-feature.css";

/** Lightbulb glyph for the header button. */
function IdeaGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 18h6M10 22h4" />
      <path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.2 1 2v.3h6v-.3c0-.8.4-1.5 1-2A7 7 0 0 0 12 2z" />
    </svg>
  );
}

function MicGlyph() {
  return (
    <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0M12 17v4" />
    </svg>
  );
}

// The tester's name or email, remembered on this computer only (per-viewer
// convenience; never written into the document or Office settings).
const CONTACT_KEY = "arklaw.featureRequestContact";
function loadContact(): string {
  try {
    return localStorage.getItem(CONTACT_KEY) ?? "";
  } catch {
    return "";
  }
}
function saveContact(v: string) {
  try {
    if (v.trim()) localStorage.setItem(CONTACT_KEY, v.trim());
    else localStorage.removeItem(CONTACT_KEY);
  } catch {
    // storage blocked: just don't remember it
  }
}

/**
 * Header button + form for trial testers to suggest a feature, typed or
 * dictated. Dictation reuses the composer's live speech-to-text; the tester
 * sees and can correct the transcript before sending, and ArkLaw records no
 * audio. Appears only when the server has the feature switched on.
 */
export function SuggestFeature() {
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    void featureRequestsEnabled().then((on) => alive && setEnabled(on));
    return () => {
      alive = false;
    };
  }, []);
  if (!enabled) return null;
  return (
    <>
      <IconButton label="Suggest a feature" onClick={() => setOpen(true)} active={open}>
        <IdeaGlyph />
      </IconButton>
      {open && <SuggestFeatureForm onClose={() => setOpen(false)} />}
    </>
  );
}

function SuggestFeatureForm({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState("");
  const [contact, setContact] = useState(loadContact);
  const [typed, setTyped] = useState(false);
  const [dictated, setDictated] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Dictation appends after whatever is already in the box (captured when the
  // mic starts), so speaking never wipes typed text.
  const baseRef = useRef("");
  const voice = useVoiceInput((t) => {
    const base = baseRef.current;
    if (t.trim()) setDictated(true);
    setText((base ? `${base} ${t}` : t).slice(0, FEATURE_REQUEST_MAX));
  });
  function toggleMic() {
    if (voice.listening) {
      voice.stop();
      return;
    }
    baseRef.current = text.trim();
    voice.start();
  }

  const source: FeatureRequestSource = typed && dictated ? "both" : dictated ? "dictated" : "typed";
  const remaining = FEATURE_REQUEST_MAX - text.length;

  async function send() {
    if (!text.trim() || sending) return;
    voice.stop();
    setSending(true);
    setError(null);
    try {
      await sendFeatureRequest({ text, source, contact });
      saveContact(contact);
      setSent(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  const footer = sent ? (
    <Button variant="primary" size="sm" onClick={onClose}>
      Close
    </Button>
  ) : (
    <>
      <Button variant="ghost" size="sm" onClick={onClose} disabled={sending}>
        Cancel
      </Button>
      <Button variant="primary" size="sm" onClick={() => void send()} loading={sending} disabled={!text.trim()}>
        Send
      </Button>
    </>
  );

  return (
    <Modal open onClose={onClose} title="Suggest a feature" footer={footer}>
      {sent ? (
        <p className="small" style={{ margin: 0 }} role="status">
          Thanks. Your suggestion has been sent.
        </p>
      ) : (
        <div className="stack suggest-feature" style={{ gap: 8 }}>
          <p className="small muted" style={{ margin: 0 }}>
            What would make ArkLaw more useful? Type it, or dictate it and correct the text before sending.
          </p>
          <p className="small suggest-feature__warn" style={{ margin: 0 }}>
            Don't include client or matter details.
          </p>
          <Field label="Your suggestion">
            <AutoTextarea
              value={text}
              maxLength={FEATURE_REQUEST_MAX}
              rows={4}
              placeholder="For example: let me pick the governing law for each document."
              onChange={(e) => {
                setText(e.target.value);
                setTyped(true);
              }}
            />
          </Field>
          <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {voice.supported && (
              <Button
                variant={voice.listening ? "primary" : "default"}
                size="sm"
                onClick={toggleMic}
                aria-pressed={voice.listening}
              >
                <MicGlyph /> {voice.listening ? "Stop dictating" : "Dictate"}
              </Button>
            )}
            <span className={`small ${remaining < 100 ? "suggest-feature__warn" : "muted"}`} style={{ marginLeft: "auto" }}>
              {remaining} characters left
            </span>
          </div>
          {voice.error && <span className="small muted">{voice.error}</span>}
          {voice.supported && (
            <p className="small muted" style={{ margin: 0 }}>
              Dictation turns speech into text using your browser's or Windows' speech service, which receives the
              audio to transcribe it. ArkLaw itself records and keeps no audio.
            </p>
          )}
          <Field label="Your name or email (optional, so we can follow up)">
            <input
              type="text"
              value={contact}
              maxLength={200}
              autoComplete="email"
              onChange={(e) => setContact(e.target.value)}
            />
          </Field>
          {error && <Banner tone="danger">{error}</Banner>}
        </div>
      )}
    </Modal>
  );
}
