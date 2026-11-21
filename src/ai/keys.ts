import type { ProviderId } from "./providers/types";

export type { ProviderId };

/**
 * BYOK key store for the community edition.
 *
 * Keys live in the add-in's own partitioned localStorage: on the user's machine,
 * sent only to the provider they chose. Office gives no encrypted store, so this
 * is the standard, accepted trust model for a bring-your-own-key tool. We never
 * write keys to Office document settings, which would travel inside the .docx.
 */
const PREFIX = "vaquill.byok";

export interface ModelOption {
  id: string;
  label: string;
}

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Google Gemini",
  groq: "Groq",
  ollama: "Ollama",
  azure: "Azure OpenAI",
};

/** Providers that run against a user-supplied endpoint (need the base-URL
 *  field): Ollama's local server and an Azure deployment. */
export const PROVIDERS_NEEDING_BASE_URL: ProviderId[] = ["ollama", "azure"];

/** Providers that do not require an API key (Ollama runs locally). */
export const KEYLESS_PROVIDERS: ProviderId[] = ["ollama"];

const KNOWN_PROVIDERS: ProviderId[] = ["openai", "anthropic", "gemini", "groq", "ollama", "azure"];

/**
 * A small curated list per provider. New models are a one-line add here. Azure
 * lists nothing because the "model" is the user's own deployment name.
 *
 * Checked against each provider's official model and deprecation pages on
 * 20 Nov 2026. Only IDs that are current AND documented for the API this
 * add-in uses are listed; anything else can still be typed in under "Other".
 * Removed then: gpt-4o-mini (deprecated, shutdown 14 Jan 2027); gemini-2.5-flash
 * and gemini-2.5-pro (deprecated 2 Nov 2026, shut down 1 Dec 2026, after which
 * calls are silently rerouted to other models);
 * llama-3.3-70b-versatile and llama-3.1-8b-instant (shut down 16 Aug 2026 for
 * non-enterprise keys); qwen-2.5-32b (shut down 14 Apr 2025).
 * Sources: developers.openai.com/api/docs/models and /deprecations,
 * aistudio.google.com/docs/models, /deprecations and /openai,
 * console.groq.com/docs/models and /deprecations.
 */
export const MODEL_OPTIONS: Record<ProviderId, ModelOption[]> = {
  openai: [
    { id: "gpt-5.4-mini", label: "GPT-5.4 mini (fast, low cost)" },
    { id: "gpt-5.5", label: "GPT-5.5 (highest quality)" },
  ],
  // Current Claude models (IDs from Anthropic's model list, Nov 2026). The
  // default (below) was chosen by a measured comparison on the fictional sample
  // contract; see the PR that introduced this list.
  anthropic: [
    { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
    { id: "claude-opus-5-5", label: "Claude Opus 5.5 (highest quality)" },
    { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 (fastest, lowest cost)" },
    { id: "claude-sonnet-5", label: "Claude Sonnet 5 (previous generation)" },
  ],
  // The two Gemini models Google's docs show on the OpenAI-compatible endpoint
  // this add-in calls.
  gemini: [
    { id: "gemini-4-hydrogen", label: "Gemini 4 Hydrogen (recommended)" },
    { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash (fast)" },
  ],
  groq: [
    { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B" },
    { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B (fast)" },
  ],
  ollama: [
    { id: "llama3.1", label: "Llama 3.1" },
    { id: "qwen2.5", label: "Qwen 2.5" },
    { id: "mistral", label: "Mistral" },
  ],
  azure: [],
};

const DEFAULT_MODEL: Record<ProviderId, string> = {
  openai: "gpt-5.4-mini",
  anthropic: "claude-sonnet-5",
  gemini: "gemini-4-hydrogen",
  groq: "openai/gpt-oss-120b",
  ollama: "llama3.1",
  // Azure's model is the deployment name, which is per-account; no default.
  azure: "",
};

/** Partition the storage key per add-in instance where Office supports it. */
function partition(): string {
  try {
    const ctx = (typeof Office !== "undefined" ? Office.context : undefined) as
      | { partitionKey?: string }
      | undefined;
    return ctx?.partitionKey ? `${ctx.partitionKey}:` : "";
  } catch {
    return "";
  }
}

function keyName(suffix: string): string {
  return `${partition()}${PREFIX}.${suffix}`;
}

/**
 * Session fallback for when localStorage is unavailable (Office storage
 * partitioning, an InPrivate / third-party pane, or an enterprise cookie
 * policy). Without it a swallowed write meant `read` returned null immediately
 * after `setKey` "succeeded", so the key never took: Save looked like a dead
 * button and the user could never get past the BYOK screen. Mirrors the
 * in-memory fallback in lib/prefs.ts and lib/org.ts. Keys still never leave
 * this device.
 */
const memory = new Map<string, string>();

function read(suffix: string): string | null {
  const k = keyName(suffix);
  try {
    const v = localStorage.getItem(k);
    if (v !== null) return v;
  } catch {
    // storage blocked; fall through to the session fallback
  }
  return memory.get(k) ?? null;
}

/** Returns whether the value was PERSISTED (false = held in memory only, so it
 *  works for this session but will not survive a reload). */
function write(suffix: string, value: string | null): boolean {
  const k = keyName(suffix);
  if (value === null) memory.delete(k);
  else memory.set(k, value);
  try {
    if (value === null) localStorage.removeItem(k);
    else localStorage.setItem(k, value);
    return true;
  } catch {
    return false;
  }
}

export function getActiveProvider(): ProviderId {
  const saved = read("provider");
  return saved && (KNOWN_PROVIDERS as string[]).includes(saved) ? (saved as ProviderId) : "openai";
}

export function setActiveProvider(p: ProviderId): void {
  write("provider", p);
}

export function getKey(p: ProviderId): string | null {
  const v = read(`${p}.key`);
  return v && v.trim() ? v : null;
}

/** Returns whether the key was PERSISTED (false = kept for this session only). */
export function setKey(p: ProviderId, key: string): boolean {
  return write(`${p}.key`, key.trim() || null);
}

export function removeKey(p: ProviderId): void {
  write(`${p}.key`, null);
}

/** Clear every provider's key and custom base URL (sign-out / leave BYOK). */
export function clearAllProviderKeys(): void {
  for (const p of KNOWN_PROVIDERS) {
    write(`${p}.key`, null);
    write(`${p}.baseUrl`, null);
  }
}

export function getModel(p: ProviderId): string {
  return read(`${p}.model`) || DEFAULT_MODEL[p];
}

export function setModel(p: ProviderId, model: string): void {
  write(`${p}.model`, model);
}

/** Optional custom endpoint base URL (Ollama server / Azure deployment). Empty
 *  string when unset so callers can fall back to a per-provider default. */
export function getBaseUrl(p: ProviderId): string {
  return read(`${p}.baseUrl`) || "";
}

export function setBaseUrl(p: ProviderId, url: string): void {
  write(`${p}.baseUrl`, url.trim() || null);
}

/** True once the active provider is usable. Unlocks the AI features and the app.
 *  Ollama runs locally with no key, so it counts as configured on its own. */
export function isConfigured(): boolean {
  const p = getActiveProvider();
  if ((KEYLESS_PROVIDERS as string[]).includes(p)) return true;
  return getKey(p) !== null;
}

// --- CourtListener (optional BYO case-law token) ----------------------------
// Separate from the LLM providers: used only to verify that cited cases exist,
// browser-direct against the user's own free CourtListener account.
const CL_TOKEN = "courtlistener.token";

export function getCourtListenerToken(): string | null {
  const v = read(CL_TOKEN);
  return v && v.trim() ? v : null;
}

export function setCourtListenerToken(token: string): void {
  write(CL_TOKEN, token.trim() || null);
}

export function hasCourtListenerToken(): boolean {
  return getCourtListenerToken() !== null;
}
