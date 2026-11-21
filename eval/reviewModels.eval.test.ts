/**
 * Model comparison for the contract review (NOT part of `npm test`: it is
 * skipped unless ARKLAW_EVAL=1 and ANTHROPIC_API_KEY are set, and it costs real
 * money: roughly US$0.01 to US$0.50 per run depending on the model).
 *
 * It runs the REAL review prompt (contractReviewPrompt), the REAL Anthropic
 * adapter (makeAnthropic, streamed) and the REAL fail-safe checks (runJson
 * strict + reviewProblem + shapeReview) on the fictional sample contract, then
 * scores the findings against the 10-problem answer key
 * (_arklaw-notes/TEST-PLAN.md), matching each finding to a clause number.
 *
 * Run (PowerShell), after setting the key yourself in the same terminal:
 *   $env:ARKLAW_EVAL = "1"
 *   npx vitest run eval/reviewModels.eval.test.ts
 * Optional: ARKLAW_EVAL_MODELS (comma list), ARKLAW_EVAL_RUNS (default 2),
 * ARKLAW_EVAL_MODES (default "balanced"), ARKLAW_EVAL_OUT (results JSON path).
 * The key is read from the environment only and is never printed or saved.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { contractReviewPrompt, normalizeReviewDepth } from "@/ai/prompts";
import { makeAnthropic } from "@/ai/providers/anthropic";
import { runJson } from "@/community/llm";
import { REVIEW_MAX_TOKENS, reviewProblem, shapeReview } from "@/community/reviewStream";

const KEY = process.env.ANTHROPIC_API_KEY ?? "";
const ENABLED = process.env.ARKLAW_EVAL === "1" && KEY.length > 0;
const MODELS = (process.env.ARKLAW_EVAL_MODELS ?? "claude-opus-5-5,claude-sonnet-5-5,claude-haiku-5-5,claude-sonnet-5")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const RUNS = Number(process.env.ARKLAW_EVAL_RUNS ?? "2");
const MODES = (process.env.ARKLAW_EVAL_MODES ?? "balanced").split(",").map((s) => normalizeReviewDepth(s.trim()));
const OUT =
  process.env.ARKLAW_EVAL_OUT ?? resolve(process.cwd(), `eval/results/review-models-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);

/** US$ per million tokens (input, output), from Anthropic's price list, Nov 2026. */
const PRICE: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-sonnet-5": [2, 10],
};

const CONTRACT = readFileSync(resolve(process.cwd(), "eval/fixtures/sample-contract.txt"), "utf8");
const USER_SIDE = "Tallowmere Retail Group Pty Ltd (Customer)";

/** The 10 planted problems (answer key), by clause. `cue` also accepts a
 *  finding that names the problem in words. */
const KEY_PROBLEMS: { n: number; what: string; clauses: string[]; cue?: RegExp }[] = [
  { n: 1, what: '"Services" used but never defined (2.1, 1.3)', clauses: ["2.1", "1.3"], cue: /\bServices\b.{0,80}(undefined|not defined|never defined|defin)/i },
  { n: 2, what: "36-month auto-renewal, 180 days' notice (3.2)", clauses: ["3.2"] },
  { n: 3, what: "7-day payment, 5%/month interest, 7-day price rises (4.1-4.3)", clauses: ["4.1", "4.2", "4.3"] },
  { n: 4, what: "Supplier varies the contract by website notice (5.1)", clauses: ["5.1"] },
  { n: 5, what: "Supplier takes the Customer's data (6.2)", clauses: ["6.2"] },
  { n: 6, what: "Confidentiality protects only the Supplier (7.1)", clauses: ["7.1"] },
  { n: 7, what: "Lopsided liability (8.1-8.3)", clauses: ["8.1", "8.2", "8.3"] },
  { n: 8, what: "Indemnity covers the Supplier's own negligence (9.1)", clauses: ["9.1"] },
  { n: 9, what: "Lopsided termination and acceleration (10.1-10.3)", clauses: ["10.1", "10.2", "10.3"] },
  { n: 10, what: "Delaware law; reference to a missing clause 14 (11.1, 12.1)", clauses: ["11.1", "12.1"], cue: /Delaware|clause 14/i },
];

/** Clause numbers ("4.2") a finding is about: from its section reference and
 *  name, else from where its quoted wording sits in the contract. */
function clausesOf(f: { sectionReference?: string | null; clauseName?: string; currentLanguage?: string; quote?: string }): string[] {
  const out = new Set<string>();
  const ref = `${f.sectionReference ?? ""} ${f.clauseName ?? ""}`;
  for (const m of ref.matchAll(/\b(\d{1,2})\.(\d{1,2})\b/g)) out.add(`${m[1]}.${m[2]}`);
  if (out.size === 0) {
    for (const m of ref.matchAll(/\b(?:clause|cl\.?|section)?\s*(\d{1,2})\b/gi)) {
      const top = m[1];
      for (const line of CONTRACT.split("\n")) {
        const lm = line.match(/^(\d{1,2})\.(\d{1,2})\s/);
        if (lm && lm[1] === top) out.add(`${lm[1]}.${lm[2]}`);
      }
    }
  }
  const words = (f.currentLanguage || f.quote || "").trim();
  if (words.length >= 8) {
    const line = CONTRACT.split("\n").find((l) => l.includes(words));
    const lm = line?.match(/^(\d{1,2})\.(\d{1,2})\s/);
    if (lm) out.add(`${lm[1]}.${lm[2]}`);
  }
  return [...out];
}

interface Usage {
  input: number;
  output: number;
}

/** Wrap fetch so the eval can read token usage from the SSE stream while the
 *  real adapter still parses the same bytes. */
function meteredFetch(usage: Usage): typeof fetch {
  const real = globalThis.fetch;
  return (async (url: RequestInfo | URL, init?: RequestInit) => {
    const res = await real(url, init);
    if (!res.ok) return res;
    const text = await res.text();
    for (const line of text.split("\n")) {
      if (!line.startsWith("data:")) continue;
      try {
        const j = JSON.parse(line.slice(5).trim());
        if (j.type === "message_start") {
          const u = j.message?.usage ?? {};
          usage.input += (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
        }
        if (j.type === "message_delta" && j.usage?.output_tokens) usage.output += j.usage.output_tokens;
      } catch {
        // keepalive
      }
    }
    return new Response(text, { status: res.status, headers: res.headers });
  }) as typeof fetch;
}

describe.skipIf(!ENABLED)("review model comparison (paid; ARKLAW_EVAL=1)", () => {
  it(
    "runs every model and mode, and writes the results",
    async () => {
      const rows: Record<string, unknown>[] = [];
      for (const depth of MODES) {
        for (const model of MODELS) {
          for (let run = 1; run <= RUNS; run++) {
            const usage: Usage = { input: 0, output: 0 };
            const started = Date.now();
            const realFetch = globalThis.fetch;
            globalThis.fetch = meteredFetch(usage);
            let row: Record<string, unknown> = { model, depth, run };
            try {
              const p = contractReviewPrompt(CONTRACT, "SaaS agreement", USER_SIDE, depth, undefined, undefined);
              const raw = await runJson(p.system, p.user, {
                strict: true,
                maxTokens: REVIEW_MAX_TOKENS,
                provider: makeAnthropic(KEY, model),
              });
              const problem = reviewProblem(raw);
              if (problem) throw new Error(`incomplete review: ${problem}`);
              const review = shapeReview(raw as Record<string, unknown>, CONTRACT, "saas", USER_SIDE, depth);
              const findings = [
                ...review.redlines.map((r) => ({ kind: "redline", ...r, text: `${r.clauseName} ${r.rationale}` })),
                ...(review.flags ?? []).map((f) => ({ kind: "flag", ...f, text: `${f.clauseName} ${f.observation}` })),
              ];
              const found = KEY_PROBLEMS.filter((k) =>
                findings.some((f) => clausesOf(f).some((c) => k.clauses.includes(c)) || (k.cue ? k.cue.test(f.text) : false)),
              ).map((k) => k.n);
              const [inP, outP] = PRICE[model] ?? [0, 0];
              row = {
                ...row,
                ok: true,
                found: found.length,
                foundProblems: found,
                missedProblems: KEY_PROBLEMS.filter((k) => !found.includes(k.n)).map((k) => `${k.n}: ${k.what}`),
                redlines: review.redlines.length,
                flags: review.flags?.length ?? 0,
                cosmeticShown: review.redlines.filter((r) => r.nature === "housekeeping").length,
                hiddenMinor: review.hiddenMinorCount ?? 0,
                severity: {
                  high: review.redlines.filter((r) => r.severity === "high").length,
                  medium: review.redlines.filter((r) => r.severity === "medium").length,
                  low: review.redlines.filter((r) => r.severity === "low").length,
                },
                anchoredVerbatim: review.redlines.filter((r) => r.grounding === "verified").length,
                seconds: Math.round((Date.now() - started) / 100) / 10,
                inputTokens: usage.input,
                outputTokens: usage.output,
                costUsd: Math.round(((usage.input * inP + usage.output * outP) / 1e6) * 10000) / 10000,
                findings: findings.map((f) => ({
                  kind: f.kind,
                  clauseName: f.clauseName,
                  ref: f.sectionReference ?? null,
                  clauses: clausesOf(f),
                  severity: (f as { severity?: string }).severity ?? null,
                  nature: (f as { nature?: string }).nature ?? null,
                })),
              };
            } catch (e) {
              row = {
                ...row,
                ok: false,
                error: (e as Error).message,
                seconds: Math.round((Date.now() - started) / 100) / 10,
                inputTokens: usage.input,
                outputTokens: usage.output,
              };
            } finally {
              globalThis.fetch = realFetch;
            }
            rows.push(row);
            // One line per run (no contract text, no key).
            console.log(
              `${depth} ${model} run ${run}: ${row.ok ? `${row.found}/10, ${row.redlines} changes, ${row.seconds}s, US$${row.costUsd}` : `FAILED: ${row.error}`}`,
            );
            mkdirSync(dirname(OUT), { recursive: true });
            writeFileSync(OUT, JSON.stringify({ when: new Date().toISOString(), rows }, null, 2));
          }
        }
      }
      expect(rows.length).toBe(MODES.length * MODELS.length * RUNS);
    },
    60 * 60 * 1000,
  );
});
