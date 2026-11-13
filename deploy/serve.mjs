// ArkLaw static host for the community (bring-your-own-key) build.
//
// Zero-dependency Node server used by Dockerfile.community. It serves the built
// dist/ folder over plain HTTP on $PORT (the platform terminates TLS), applies the
// same security headers as deploy/nginx.conf with a tighter community-only CSP,
// and serves a ready-to-sideload manifest at /manifest.xml with the live host
// filled in, so nobody has to hand-edit YOUR-DOMAIN.example.com.

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(process.env.ARKLAW_DIST ?? join(here, "..", "dist"));
const MANIFEST = resolve(process.env.ARKLAW_MANIFEST ?? join(here, "..", "manifest.arklaw.xml"));
const PORT = Number(process.env.PORT ?? 8080);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

// Community build only: the pane talks to the user's own AI provider and to
// Office. No Vaquill backend, no Supabase, no analytics host is allowed.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://appsforoffice.microsoft.com https://ajax.aspnetcdn.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self' https://api.openai.com https://api.anthropic.com https://api.groq.com https://generativelanguage.googleapis.com https://appsforoffice.microsoft.com https://*.officeapps.live.com https://*.office.com https://*.microsoftonline.com",
  "frame-src 'self' https://appsforoffice.microsoft.com https://*.oaspapps.com https://login.microsoftonline.com https://login.live.com",
  "frame-ancestors 'self' https://*.officeapps.live.com https://*.office.com https://*.office365.com https://*.microsoft365.com https://*.cloud.microsoft https://*.microsoftpersonalcontent.com https://*.live.com https://*.sharepoint.com",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
].join("; ");

const SECURITY_HEADERS = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(self), geolocation=(), payment=(), usb=()",
  "Content-Security-Policy": CSP,
};

function send(res, status, headers, body) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}

/** The public host this site is reached on, validated so it is safe to write into XML. */
function publicHost(req) {
  const candidate =
    process.env.ARKLAW_PUBLIC_HOST ??
    process.env.RAILWAY_PUBLIC_DOMAIN ??
    String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "");
  const host = candidate.split(",")[0].trim().toLowerCase();
  return /^[a-z0-9.-]+(:\d+)?$/.test(host) ? host : null;
}

async function serveManifest(req, res) {
  const host = publicHost(req);
  if (!host) return send(res, 400, { "Content-Type": "text/plain" }, "Unknown host\n");
  const xml = (await readFile(MANIFEST, "utf8")).replaceAll("YOUR-DOMAIN.example.com", host);
  send(
    res,
    200,
    {
      "Content-Type": TYPES[".xml"],
      "Content-Disposition": 'attachment; filename="arklaw-manifest.xml"',
      "Cache-Control": "no-store",
    },
    xml,
  );
}

async function serveFile(res, file, cacheControl) {
  const body = await readFile(file);
  send(
    res,
    200,
    { "Content-Type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream", "Cache-Control": cacheControl },
    body,
  );
}

const server = createServer(async (req, res) => {
  try {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return send(res, 405, { "Content-Type": "text/plain", Allow: "GET, HEAD" }, "Method not allowed\n");
    }
    let path;
    try {
      path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    } catch {
      return send(res, 400, { "Content-Type": "text/plain" }, "Bad request\n");
    }

    if (path === "/health") return send(res, 200, { "Content-Type": "text/plain" }, "ok\n");
    if (path === "/manifest.xml") return await serveManifest(req, res);

    // Never expose source maps or dotfiles.
    if (path.endsWith(".map") || path.split("/").some((part) => part.startsWith("."))) {
      return send(res, 404, { "Content-Type": "text/plain" }, "Not found\n");
    }

    const file = resolve(join(ROOT, normalize(path)));
    if (file !== ROOT && !file.startsWith(ROOT + sep)) {
      return send(res, 404, { "Content-Type": "text/plain" }, "Not found\n");
    }

    const info = await stat(file).catch(() => null);
    if (info?.isFile()) {
      // Hashed build assets are content-addressed; HTML must revalidate.
      const cache = path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache";
      return await serveFile(res, file, cache);
    }
    if (path.startsWith("/assets/")) {
      return send(res, 404, { "Content-Type": "text/plain" }, "Not found\n");
    }
    // Anything else falls back to the task pane.
    return await serveFile(res, join(ROOT, "index.html"), "no-cache");
  } catch (err) {
    console.error(err);
    send(res, 500, { "Content-Type": "text/plain" }, "Server error\n");
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`ArkLaw listening on ${PORT}, serving ${ROOT}`);
});
