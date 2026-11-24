// "Suggest a feature" endpoint for the ArkLaw trial (community build only).
//
// The task pane POSTs a short request here; this server emails it to the owner
// through Resend. The Resend key and the destination address live ONLY in the
// host's environment variables (Railway), never in the client bundle.
//
// Environment:
//   RESEND_API_KEY        Resend API key (required to enable)
//   FEATURE_REQUEST_TO    destination address (required to enable)
//   FEATURE_REQUEST_FROM  sender, e.g. "ArkLaw <feedback@yourdomain>"; defaults
//                         to Resend's test sender, which only delivers to the
//                         Resend account owner's own address
//   FEATURE_REQUESTS      set to "off" to switch the feature off (the button
//                         disappears from the pane; the endpoint returns 404)
//   RESEND_API_URL        override for tests only
//
// Abuse limits: same-origin only, JSON only, 8 KB body, 2,000-character
// request, 5 per IP per 15 minutes and 60 per hour in total.

const MAX_BODY = 8 * 1024;
export const MAX_TEXT = 2000;
const PER_IP = { limit: 5, windowMs: 15 * 60 * 1000 };
const GLOBAL = { limit: 60, windowMs: 60 * 60 * 1000 };

const hits = new Map(); // ip -> number[] (timestamps)
let globalHits = [];

/** True when the feature is configured and not switched off. */
export function featureRequestsEnabled(env = process.env) {
  if (String(env.FEATURE_REQUESTS ?? "").toLowerCase() === "off") return false;
  return !!(env.RESEND_API_KEY && env.FEATURE_REQUEST_TO);
}

function json(send, res, status, body) {
  send(res, status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, JSON.stringify(body));
}

/** Sliding-window limiter. Returns false when the caller is over a limit. */
function allow(ip, now = Date.now()) {
  globalHits = globalHits.filter((t) => now - t < GLOBAL.windowMs);
  const mine = (hits.get(ip) ?? []).filter((t) => now - t < PER_IP.windowMs);
  if (mine.length >= PER_IP.limit || globalHits.length >= GLOBAL.limit) {
    hits.set(ip, mine);
    return false;
  }
  mine.push(now);
  globalHits.push(now);
  hits.set(ip, mine);
  // Keep the map from growing without bound.
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (!v.some((t) => now - t < PER_IP.windowMs)) hits.delete(k);
  }
  return true;
}

/** For tests. */
export function resetLimits() {
  hits.clear();
  globalHits = [];
}

function clientIp(req) {
  const fwd = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim();
  return fwd || req.socket?.remoteAddress || "unknown";
}

/** Same-origin check: the Origin (or Referer) host must be the host this
 *  request was sent to (or the configured public host). */
function sameOrigin(req, host) {
  const src = req.headers.origin || req.headers.referer;
  if (!src) return false;
  const allowed = [host, req.headers["x-forwarded-host"], req.headers.host]
    .flatMap((h) => String(h ?? "").split(","))
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  try {
    return allowed.includes(new URL(String(src)).host.toLowerCase());
  } catch {
    return false;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    // Refuse early on a declared oversize body.
    if (Number(req.headers["content-length"] ?? 0) > MAX_BODY) {
      req.resume();
      reject(Object.assign(new Error("too large"), { status: 413 }));
      return;
    }
    let size = 0;
    let over = false;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        // Keep draining (so the client still gets the 413), but stop storing.
        over = true;
        return;
      }
      chunks.push(c);
    });
    req.on("end", () =>
      over
        ? reject(Object.assign(new Error("too large"), { status: 413 }))
        : resolve(Buffer.concat(chunks).toString("utf8")),
    );
    req.on("error", reject);
  });
}

/** Strip control characters except newline and tab; normalise line endings. */
function clean(s, max) {
  return String(s ?? "")
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .trim()
    .slice(0, max);
}

const EMAIL = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[a-z]{2,}$/i;

/** Validate and normalise the posted request. Returns { error } or { value }. */
export function parseRequest(raw) {
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return { error: "Invalid request." };
  }
  if (!body || typeof body !== "object") return { error: "Invalid request." };
  const text = clean(body.text, MAX_TEXT + 1);
  if (!text) return { error: "Please describe the feature." };
  if (text.length > MAX_TEXT) return { error: `Please keep it under ${MAX_TEXT} characters.` };
  const source = ["typed", "dictated", "both"].includes(body.source) ? body.source : "typed";
  const contact = clean(body.contact, 200).replace(/\n/g, " ");
  const version = clean(body.version, 40).replace(/\n/g, " ");
  const host = clean(body.host, 80).replace(/\n/g, " ");
  return { value: { text, source, contact, version, host } };
}

const SOURCE_LABEL = { typed: "typed", dictated: "dictated", both: "dictated and typed" };

/** The email Resend sends. Plain text only, so nothing in it can be markup. */
export function buildEmail(v, now = new Date()) {
  const firstLine = v.text.split("\n")[0].slice(0, 60);
  const sydney = now.toLocaleString("en-AU", { timeZone: "Australia/Sydney", dateStyle: "medium", timeStyle: "short" });
  const lines = [
    "New ArkLaw feature request",
    "",
    v.text,
    "",
    "----",
    `Entered: ${SOURCE_LABEL[v.source] ?? "typed"}`,
    `From: ${v.contact || "not given"}`,
    `Sent: ${sydney} Sydney time (${now.toISOString()})`,
    `Add-in version: ${v.version || "unknown"}`,
    ...(v.host ? [`Word: ${v.host}`] : []),
  ];
  return {
    subject: `ArkLaw feature request: ${firstLine}${v.text.length > firstLine.length ? "..." : ""}`,
    text: lines.join("\n"),
    replyTo: EMAIL.test(v.contact) ? v.contact : undefined,
  };
}

async function sendEmail(env, mail) {
  const url = env.RESEND_API_URL || "https://api.resend.com/emails";
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.FEATURE_REQUEST_FROM || "ArkLaw <onboarding@resend.dev>",
      to: [env.FEATURE_REQUEST_TO],
      subject: mail.subject,
      text: mail.text,
      ...(mail.replyTo ? { reply_to: mail.replyTo } : {}),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`email service returned ${res.status}`);
}

/**
 * Handle /api/feature-request. GET reports whether the feature is on (the pane
 * shows the button only then); POST sends one request. Returns true when the
 * request was handled.
 */
export async function handleFeatureRequest(req, res, { send, host, env = process.env }) {
  const enabled = featureRequestsEnabled(env);
  if (req.method === "GET" || req.method === "HEAD") {
    json(send, res, 200, { enabled });
    return true;
  }
  if (req.method !== "POST") {
    send(res, 405, { "Content-Type": "text/plain", Allow: "GET, POST" }, "Method not allowed\n");
    return true;
  }
  if (!enabled) return json(send, res, 404, { error: "Feature requests are switched off." }), true;
  if (!sameOrigin(req, host)) return json(send, res, 403, { error: "Not allowed." }), true;
  if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
    return json(send, res, 415, { error: "Invalid request." }), true;
  }
  if (!allow(clientIp(req))) {
    return json(send, res, 429, { error: "Too many requests. Please try again later." }), true;
  }
  let raw;
  try {
    raw = await readBody(req);
  } catch (e) {
    return json(send, res, e.status === 413 ? 413 : 400, { error: "Request too large." }), true;
  }
  const parsed = parseRequest(raw);
  if (parsed.error) return json(send, res, 400, { error: parsed.error }), true;
  try {
    await sendEmail(env, buildEmail(parsed.value));
  } catch (e) {
    console.error("feature request email failed:", e?.message ?? e);
    return json(send, res, 502, { error: "Could not send right now. Please try again later." }), true;
  }
  json(send, res, 200, { ok: true });
  return true;
}
