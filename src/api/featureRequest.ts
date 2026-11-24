/**
 * "Suggest a feature" (trial only). Posts a short request to the add-in's OWN
 * server (deploy/feature-request.mjs), which emails it to the owner. The email
 * service key lives on that server, never in this bundle. Same origin, so the
 * pane's CSP (connect-src 'self') already allows it.
 *
 * Never send document text from here: the form carries only what the lawyer
 * typed or dictated into it.
 */
import { config } from "@/config";
import { isBuildCommunity } from "@/community/edition";

const PATH = "/api/feature-request";
/** Must match MAX_TEXT in deploy/feature-request.mjs. */
export const FEATURE_REQUEST_MAX = 2000;

export type FeatureRequestSource = "typed" | "dictated" | "both";

let enabledProbe: Promise<boolean> | null = null;

/**
 * Whether the server has the feature switched on (configured, and not turned
 * off with FEATURE_REQUESTS=off). Probed once per session; any failure (no such
 * endpoint, e.g. the dev server or the hosted build) means "off", so the button
 * simply does not appear.
 */
export function featureRequestsEnabled(): Promise<boolean> {
  if (!isBuildCommunity()) return Promise.resolve(false);
  enabledProbe ??= fetch(PATH, { method: "GET", headers: { Accept: "application/json" } })
    .then(async (r) => (r.ok ? ((await r.json()) as { enabled?: boolean }).enabled === true : false))
    .catch(() => false);
  return enabledProbe;
}

/** Word host and version, for the owner's triage ("PC 16.0.18129"). */
function hostInfo(): string {
  try {
    const d = Office?.context?.diagnostics;
    return d ? `${d.platform} ${d.version}`.trim() : "";
  } catch {
    return "";
  }
}

export async function sendFeatureRequest(input: {
  text: string;
  source: FeatureRequestSource;
  contact: string;
}): Promise<void> {
  const res = await fetch(PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      text: input.text.trim().slice(0, FEATURE_REQUEST_MAX),
      source: input.source,
      contact: input.contact.trim().slice(0, 200),
      version: `${config.appVersion} (${isBuildCommunity() ? "community" : "hosted"})`,
      host: hostInfo(),
    }),
  });
  if (res.ok) return;
  let message = "Could not send right now. Please try again later.";
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) message = body.error;
  } catch {
    // keep the generic message
  }
  throw new Error(message);
}
