/**
 * "Check for updates". ArkLaw is loaded fresh from its website each time the
 * pane opens, so a new release normally arrives on its own. This covers the
 * two gaps: a pane left open for hours, and Word serving a cached copy. The
 * build writes dist/version.json; the pane compares it with its own build id
 * and, if newer, offers a reload (no reinstall, no Word restart).
 */
import { config } from "@/config";

declare const __BUILD_ID__: string;

export interface BuildInfo {
  version: string;
  /** ISO time the bundle was built. Later builds compare greater. */
  buildId: string;
}

export const currentBuild: BuildInfo = {
  version: config.appVersion,
  buildId: typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "",
};

/** The build the website is serving now, or null when it cannot be read (no
 *  network, or the dev server, which has no version.json). */
export async function fetchLatestBuild(): Promise<BuildInfo | null> {
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    const j = (await res.json()) as Partial<BuildInfo>;
    if (typeof j.buildId !== "string" || !j.buildId) return null;
    return { version: typeof j.version === "string" ? j.version : "", buildId: j.buildId };
  } catch {
    return null;
  }
}

/** True when `latest` is a newer build than `current`. */
export function isNewerBuild(current: BuildInfo, latest: BuildInfo | null): boolean {
  if (!latest?.buildId || !current.buildId) return false;
  return latest.buildId > current.buildId;
}

/** "24 Nov 2026, 10:40 pm" (Sydney time), or "" for an unreadable id. */
export function formatBuildTime(buildId: string): string {
  const d = new Date(buildId);
  if (!buildId || Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-AU", {
    timeZone: "Australia/Sydney",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Reload the pane from the website, picking up the latest version. */
export function reloadPane(): void {
  window.location.reload();
}
