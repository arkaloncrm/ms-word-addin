import { useState } from "react";
import { Button, Field } from "@/ui/primitives";
import {
  KEYLESS_PROVIDERS,
  MODEL_OPTIONS,
  PROVIDERS_NEEDING_BASE_URL,
  PROVIDER_LABELS,
  getActiveProvider,
  getBaseUrl,
  getKey,
  getModel,
  isConfigured,
  setActiveProvider,
  setBaseUrl,
  setKey,
  setModel,
  type ProviderId,
} from "@/ai/keys";
import { testKey } from "@/ai/test";
import { errorMessage } from "@/api/errors";

/**
 * Reusable provider + key form, used both by the first-run wizard and the
 * Settings screen. Picks a provider, a model, and stores the user's key on this
 * device. "Test" does a live one-token ping so the user gets instant feedback.
 */
type Status =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "ok" }
  | { kind: "error"; message: string };

const PROVIDERS: ProviderId[] = ["openai", "anthropic", "gemini", "groq", "ollama", "azure"];

/**
 * Provider logo shown as the option itself, so the picker needs no separate text
 * label (the accessible name is the alt text). Each option keeps a light
 * background in both states and shows selection with a brand ring rather than a
 * dark fill (which would hide a dark mark).
 */
const PROVIDER_LOGO: Record<ProviderId, { src: string; alt: string }> = {
  openai: { src: "/assets/openai.webp", alt: "OpenAI" },
  anthropic: { src: "/assets/claude.png", alt: "Claude" },
  gemini: { src: "/assets/googlegemini.svg", alt: "Google Gemini" },
  groq: { src: "/assets/groq.svg", alt: "Groq" },
  ollama: { src: "/assets/ollama.svg", alt: "Ollama" },
  azure: { src: "/assets/azure.svg", alt: "Azure OpenAI" },
};

function needsBaseUrl(p: ProviderId): boolean {
  return PROVIDERS_NEEDING_BASE_URL.includes(p);
}

function needsKey(p: ProviderId): boolean {
  return !KEYLESS_PROVIDERS.includes(p);
}

/** Placeholder for the base-URL field, per provider. */
function baseUrlPlaceholder(p: ProviderId): string {
  if (p === "ollama") return "http://localhost:11434/v1";
  if (p === "azure")
    return "https://<resource>.openai.azure.com/openai/deployments/<name>/chat/completions?api-version=2024-10-01";
  return "";
}

/** Sentinel dropdown value that reveals the free-text model id field. */
const CUSTOM = "__custom__";

function isKnownModel(provider: ProviderId, model: string): boolean {
  return MODEL_OPTIONS[provider].some((m) => m.id === model);
}

export function ProviderKeyForm({ onSaved }: { onSaved?: () => void }) {
  const [provider, setProvider] = useState<ProviderId>(getActiveProvider());
  const [model, setModelValue] = useState<string>(getModel(getActiveProvider()));
  // A saved model that is not in the curated list (a newer or provider-specific
  // one the user typed) starts the form in custom mode so it stays editable.
  const [custom, setCustom] = useState<boolean>(
    () => !isKnownModel(getActiveProvider(), getModel(getActiveProvider())),
  );
  const [key, setKeyValue] = useState<string>(getKey(getActiveProvider()) ?? "");
  const [baseUrl, setBaseUrlValue] = useState<string>(getBaseUrl(getActiveProvider()));
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  function switchProvider(p: ProviderId) {
    const nextModel = getModel(p);
    setProvider(p);
    setModelValue(nextModel);
    setCustom(!isKnownModel(p, nextModel));
    setKeyValue(getKey(p) ?? "");
    setBaseUrlValue(getBaseUrl(p));
    setStatus({ kind: "idle" });
  }

  function onModelSelect(value: string) {
    if (value === CUSTOM) {
      setCustom(true);
      setModelValue("");
    } else {
      setCustom(false);
      setModelValue(value);
    }
    setStatus({ kind: "idle" });
  }

  const keyRequired = needsKey(provider);
  const baseUrlRequired = needsBaseUrl(provider);
  // Ollama needs no key; Azure has no default endpoint so its base URL is
  // mandatory. Everything else just needs a key + model.
  const canSubmit =
    !!model.trim() &&
    (!keyRequired || !!key.trim()) &&
    (provider !== "azure" || !!baseUrl.trim());

  async function runTest() {
    const k = key.trim();
    if (keyRequired && !k) {
      setStatus({ kind: "error", message: "Enter your API key first." });
      return;
    }
    if (!model.trim()) {
      setStatus({ kind: "error", message: "Enter a model id first." });
      return;
    }
    if (provider === "azure" && !baseUrl.trim()) {
      setStatus({ kind: "error", message: "Enter your Azure endpoint URL first." });
      return;
    }
    setStatus({ kind: "testing" });
    try {
      await testKey(provider, k, model, baseUrl.trim());
      setStatus({ kind: "ok" });
    } catch (e) {
      setStatus({ kind: "error", message: errorMessage(e) });
    }
  }

  function save() {
    setKey(provider, key.trim());
    setModel(provider, model.trim());
    if (baseUrlRequired) setBaseUrl(provider, baseUrl.trim());
    setActiveProvider(provider);
    // Never report success blind: if the config did not actually take (storage
    // blocked AND the session fallback somehow empty), advancing would drop the
    // user on a screen that immediately bounces back with no explanation.
    if (!isConfigured()) {
      setStatus({
        kind: "error",
        message: "Could not save on this device. Check that browser storage is not blocked.",
      });
      return;
    }
    onSaved?.();
  }

  return (
    <div className="stack" style={{ gap: 12 }}>
      <Field label="AI provider">
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          {PROVIDERS.map((p) => {
            const logo = PROVIDER_LOGO[p];
            const on = p === provider;
            return (
              <button
                key={p}
                type="button"
                aria-pressed={on}
                aria-label={logo.alt}
                title={PROVIDER_LABELS[p]}
                onClick={() => switchProvider(p)}
                style={{
                  flex: "1 1 28%",
                  minWidth: 64,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  minHeight: 42,
                  padding: "8px 10px",
                  background: "var(--surface)",
                  border: `1px solid ${on ? "var(--brand)" : "var(--control-border)"}`,
                  borderRadius: "var(--radius-sm)",
                  boxShadow: on ? "0 0 0 2px var(--brand-tint)" : "none",
                  cursor: "pointer",
                }}
              >
                <img
                  src={logo.src}
                  alt={logo.alt}
                  style={{ height: 18, width: "auto", maxWidth: "100%", objectFit: "contain" }}
                />
              </button>
            );
          })}
        </div>
      </Field>

      <Field label="Model">
        <select
          value={custom ? CUSTOM : model}
          onChange={(e) => onModelSelect(e.target.value)}
          style={{ width: "100%" }}
        >
          {MODEL_OPTIONS[provider].map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
          <option value={CUSTOM}>Other (enter model id)</option>
        </select>
        {custom && (
          <input
            type="text"
            value={model}
            autoComplete="off"
            spellCheck={false}
            placeholder="e.g. gpt-5.5-pro"
            onChange={(e) => {
              setModelValue(e.target.value);
              setStatus({ kind: "idle" });
            }}
            style={{ width: "100%", marginTop: 6 }}
          />
        )}
      </Field>

      {baseUrlRequired && (
        <Field label={provider === "ollama" ? "Ollama server URL" : "Azure endpoint URL"}>
          <input
            type="text"
            value={baseUrl}
            autoComplete="off"
            spellCheck={false}
            placeholder={baseUrlPlaceholder(provider)}
            onChange={(e) => {
              setBaseUrlValue(e.target.value);
              setStatus({ kind: "idle" });
            }}
            style={{ width: "100%" }}
          />
          {provider === "ollama" && (
            <p className="small muted" style={{ margin: "6px 0 0" }}>
              Leave blank for the default. The Ollama server must allow this add-in's origin (set
              OLLAMA_ORIGINS).
            </p>
          )}
        </Field>
      )}

      {keyRequired ? (
        <Field label={`${PROVIDER_LABELS[provider]} API key`}>
          {/* Not type="password": WebView2 (Word's browser engine) then offers
              "Save your password?" after Save and would store the AI key in the
              browser's password store. A text field masked by CSS
              (.secret-input) shows dots without that prompt. */}
          <input
            type="text"
            className="secret-input"
            name="arklaw-ai-key"
            value={key}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            data-1p-ignore
            data-lpignore="true"
            data-form-type="other"
            placeholder="Paste your key"
            onChange={(e) => {
              setKeyValue(e.target.value);
              setStatus({ kind: "idle" });
            }}
            style={{ width: "100%" }}
          />
        </Field>
      ) : (
        <p className="small muted" style={{ margin: 0 }}>
          No API key needed. Ollama runs on your machine.
        </p>
      )}

      <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <Button variant="default" size="sm" loading={status.kind === "testing"} onClick={runTest}>
          Test
        </Button>
        <Button variant="primary" size="sm" disabled={!canSubmit} onClick={save}>
          Save
        </Button>
        {status.kind === "ok" && (
          <span className="small" style={{ color: "#157347" }}>
            Working
          </span>
        )}
        {status.kind === "error" && (
          <span className="small" style={{ color: "#b02a37" }}>
            {status.message}
          </span>
        )}
      </div>

      <p className="small muted" style={{ margin: 0 }}>
        {provider === "ollama"
          ? "Everything runs on this device against your local Ollama server. Nothing leaves your machine."
          : `Your key stays on this device and is sent only to ${PROVIDER_LABELS[provider]}.`}
      </p>
    </div>
  );
}
