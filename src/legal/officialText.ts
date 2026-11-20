/**
 * Before Ask answers, fetch the official text of any Commonwealth section the
 * lawyer's question names ("Does s 6 of the Privacy Act 1988 cover ...?"), so
 * the AI quotes the law itself rather than its memory of it. Best effort: if
 * the register is slow or unreachable, or the lawyer cancels, the lookups are
 * stopped and the question is answered without it.
 */
import { verifyCitations, type RegisterClient } from "./verify";
import { parseCitations } from "./cite";

const MAX_SECTIONS = 4;
const MAX_CHARS = 3_000;
const TIMEOUT_MS = 8_000;

export async function officialTextFor(
  question: string,
  client: RegisterClient,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<string> {
  // Only Commonwealth (or unmarked) Acts with a named section are worth a fetch.
  if (!parseCitations(question).some((c) => c.sections.length > 0 && (!c.jurisdiction || c.jurisdiction === "Cth"))) {
    return "";
  }
  if (opts.signal?.aborted) return "";

  // One controller for every register call: the lawyer's cancel or the time
  // limit stops them all, including an Act that is still downloading.
  const controller = new AbortController();
  const stop = () => controller.abort();
  opts.signal?.addEventListener("abort", stop, { once: true });
  const timer = setTimeout(stop, opts.timeoutMs ?? TIMEOUT_MS);
  const stopped = new Promise<null>((resolve) => controller.signal.addEventListener("abort", () => resolve(null)));
  try {
    const checks = await Promise.race([verifyCitations(question, client, controller.signal), stopped]);
    if (!checks) return "";
    const parts: string[] = [];
    for (const act of checks) {
      for (const s of act.sections) {
        if (s.status !== "found" || !s.body || parts.length >= MAX_SECTIONS) continue;
        const body = s.body.length > MAX_CHARS ? `${s.body.slice(0, MAX_CHARS)}…` : s.body;
        parts.push(`[${act.name} (Cth) s ${s.no}${s.heading ? ` ${s.heading}` : ""}]\n${body}`);
      }
    }
    if (parts.length === 0) return "";
    return (
      "\n\nOfficial text from the Federal Register of Legislation (the current compilation, fetched today). " +
      "When you rely on these provisions, quote from this text, not from memory:\n\n" +
      parts.join("\n\n")
    );
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", stop);
    controller.abort();
  }
}
