/**
 * [B24-A3] The page `artifacts/ai-control-plane-b24/abuse-controls.md` (D24-8, OD-197): its limit tables equal the code's registries
 * value for value (`ABUSE_LIMITS`, `EMBEDDING_ADMISSION`, the preview's ceilings and bounds); every citation resolves by content (its
 * anchor stands exactly once in its file, or in the body of the function it names - the b20-b4-stop-evidence case 8 rule; the line
 * beside it is as of the A3 tree and is not checked); the authenticated rows it lists as unlimited after part 1 are exactly the
 * census's authenticated credit-or-expensive rows (40); it states the per-process limit, the lockout trade-off, the window order, the
 * lexical fallback, the outcome classes, the SDK retries, the work bound and what a person sees on a 429; it carries
 * BLOCKED-LIVE-QUALIFICATION with LB-13, LB-1 and LB-2; and it spells no earlier closeout's dated note prefix (the B21, B22 and B23
 * closeout tripwires scan it too).
 *
 * Failing first on b3b6b05: the page does not exist (page section 10). Files are read as text; nothing is written.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { anchorOccurrences, pageCitations } from "@/app/lib/mcp/server/__tests__/_citations";
import { routeResourceClassification } from "@/app/lib/auth/route-resource-classification";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8").replaceAll(`${CR}${NEWLINE}`, NEWLINE);
const PAGE = "artifacts/ai-control-plane-b24/abuse-controls.md";
const page = (): string => {
  expect(existsSync(join(ROOT, PAGE)), `${PAGE} exists`).toBe(true);
  return read(PAGE);
};
/** One `## <n>. ` section of the page, up to the next one. */
const section = (text: string, n: number): string => {
  const start = text.search(new RegExp(`^## ${n}\\. `, "m"));
  expect(start, `section ${n}`).toBeGreaterThanOrEqual(0);
  const rest = text.slice(start + 1);
  const next = rest.search(/^## \d+\. /m);
  return next < 0 ? text.slice(start) : text.slice(start, start + 1 + next);
};
const seconds = (ms: number): string => (ms % 3_600_000 === 0 ? `${ms / 3_600_000} h` : `${ms / 1_000} s`);

describe("[B24-A3] the page abuse-controls.md", () => {
  it("1. counterexample (red on b3b6b05): the page exists, its sections are in order, and its public-window table equals ABUSE_LIMITS value for value (each row's global and per-client limit, window and key cap, and what it is keyed on)", async () => {
    const text = page();
    const headings = [...text.matchAll(/^## (\d+)\. /gm)].map((match) => Number(match[1]));
    expect(headings).toEqual(headings.map((_, index) => index));
    expect(headings.length).toBeGreaterThanOrEqual(15);
    const { ABUSE_LIMITS } = await import("@/app/lib/auth/abuse-limits");
    const table = section(text, 1);
    for (const [key, entry] of Object.entries(ABUSE_LIMITS)) {
      expect(table, `${key} global`).toMatch(new RegExp(`^\\| \`${key}\` \\| global \\| ${entry.global.limit} \\| ${seconds(entry.global.windowMs)} \\| ${entry.global.maxKeys.toLocaleString("en-US")} \\| [^|]*every caller[^|]* \\|$`, "m"));
      expect(table, `${key} per client`).toMatch(new RegExp(`^\\| \`${key}\` \\| per client \\| ${entry.perClient.limit} \\| ${seconds(entry.perClient.windowMs)} \\| ${entry.perClient.maxKeys.toLocaleString("en-US")} \\| [^|]*\`ip-<literal>\`[^|]* \\|$`, "m"));
    }
    expect(table.split(NEWLINE).filter((line) => /^\| `(?:GET|POST) \/api\//.test(line))).toHaveLength(Object.keys(ABUSE_LIMITS).length * 2);
  });

  it("2. the embedding meter's table equals EMBEDDING_ADMISSION and its key; the preview's ceilings and bounds are stated as the route enforces them (b24-a3-placement-bound pins the same values)", async () => {
    const text = page();
    const { EMBEDDING_ADMISSION, admissionKeyString } = await import("@/app/lib/acquisition/admission-control");
    const { EMBEDDING_ADMISSION_KEY } = await import("@/app/lib/embedding-admission");
    const meter = section(text, 1);
    expect(meter).toContain(`\`${admissionKeyString(EMBEDDING_ADMISSION_KEY)}\``);
    expect(meter).toMatch(new RegExp(`^\\| \`${admissionKeyString(EMBEDDING_ADMISSION_KEY)}\` \\| ${EMBEDDING_ADMISSION.requestsPerMinute} a minute, process-wide \\| ${EMBEDDING_ADMISSION.consecutiveFailuresToOpen} consecutive failures: ${seconds(EMBEDDING_ADMISSION.rateLimitOpenMs)} \\| a provider 429: ${seconds(EMBEDDING_ADMISSION.rateLimitOpenMs)} \\| \`insufficient_quota\`: ${seconds(EMBEDDING_ADMISSION.quotaOpenMs)} \\|$`, "m"));
    const bound = section(text, 9);
    // [B24-A3 review, 2026-10-08] security-1, security-3: the reviewed, measured ceilings and bounds (b24-a3-placement-bound pins the same)
    for (const fact of ["`timeoutMs` at most 5,000 (absent means 5,000)", "`candidateCount` at most 2", "`maxIterations` at most 400", "`localRefinementPasses` at most 0", "`gridNm` at least 100,000", "1,000,000 bytes", "30 footprints", "600 pads", "128 pads in one footprint", "2,400 polygon-pad vertices", "300 nets", "100 tracks and vias", "8 zones", "512 zone vertices", "512 keepout vertices", "a rect or roundrect outline", "413 `PLACEMENT_PREVIEW_TOO_LARGE`", "at most two candidate evaluations", "not a preemptive stop", "D24-28"]) expect(bound, fact).toContain(fact);
    expect(bound).toMatch(/measured once on this host/);
    for (const stale of ["200 footprints", "4,000 pads", "20,000 tracks and vias", "`candidateCount` at most 4", "`localRefinementPasses` at most 1"]) expect(bound, stale).not.toContain(stale);
  });

  it("3. every citation resolves by content: its anchor stands exactly once in its file, or in the body of the function it names", { timeout: 30_000 }, () => {
    const text = page();
    expect(text).toMatch(/^## \d+\. Citations, as of the B24-A3 tree/m);
    const citations = pageCitations(text);
    expect(citations.length).toBeGreaterThanOrEqual(20);
    expect(citations.map((citation) => citation.id)).toEqual(citations.map((_, index) => `C${index + 1}`));
    const wrong = citations.filter((citation) => anchorOccurrences(ROOT, citation) !== 1).map((citation) => `${citation.id} ${citation.path}: ${anchorOccurrences(ROOT, citation)}`);
    expect(wrong).toEqual([]);
    for (const path of ["app/lib/auth/authorize.ts", "app/lib/auth/abuse-limits.ts", "app/lib/acquisition/admission-control.ts", "app/lib/embedding-admission.ts", "app/api/parts/search/route.ts", "app/api/pcb/footprints/search/route.ts", "app/api/pcb/placement/preview/route.ts", "app/lib/auth/route-policy.ts", "app/lib/auth/route-resource-classification.ts", "app/signin/page.tsx", "app/components/editor/BuildLibraryPanel.tsx"]) {
      expect(citations.some((citation) => citation.path === path), path).toBe(true);
    }
  });

  it("4. the authenticated rows listed as unlimited after part 1 are exactly the census's authenticated provider-credit or expensive rows (40), /api/chat among them", () => {
    const listed = [...section(page(), 11).matchAll(/^- `((?:GET|POST|PUT|PATCH|DELETE) \/[^`]+)`/gm)].map((match) => match[1]!);
    const census = routeResourceClassification().filter((row) => !row.isPublic && (row.providerCredit || row.expensive)).map((row) => `${row.method} ${row.path}`);
    expect(census).toHaveLength(40);
    expect([...listed].sort()).toEqual([...census].sort());
    expect(listed).toContain("POST /api/chat");
  });

  it("5. the statements: per process (N instances allow N times as much), the trusted-header rule and why it is unset (OD-190), the lockout trade-off in OD-197's words, the window order, the lexical fallback, the outcome classes, the SDK retries (INFERRED), the work bound, what a person sees on a 429, the stale statements handed to B24-F", () => {
    const text = page();
    for (const fact of [
      "per process", "N instances allow N times as much",
      "`x-real-ip`", "`cf-connecting-ip`", "`true-client-ip`", "`fly-client-ip`", "unset by default", "OD-190",
      "With the header unset, each window is one bucket shared by every caller. Any client can exhaust it: sign-in at 30/60 s locks every user out of sign-in for up to 60 s, and each search at 300/60 s refuses every user. This is the owner's trade-off against OD-197's alternative (require sign-in) and against configuring a trusted proxy header (LB-13).",
      "Setting the header does not remove the lockout", "/64", // [B24-A3 review, 2026-10-08] security-2
      "per-client window first, then the global window", "a global refusal has already used that client's own per-client slot",
      "lexical fallback", "`rate_limited`", "`insufficient_quota`", "`failure`", "`neutral`", "counts `embedQuery` calls, not provider HTTP requests", "INFERRED",
      "Too many sign-in attempts; try again in a minute.", "`BuildLibraryPanel.tsx`",
      "`tier3-vocabulary.md`", "`unknowns-and-owner-decisions.md`", "`final-verdict.md`", "`mcp-server-proposals.md`", "`named-computations.md`", "admission-control.ts:19", "B24-F",
    ]) expect(text, fact).toContain(fact);
  });

  it("6. the live halves are BLOCKED-LIVE-QUALIFICATION with LB-13, LB-1 and LB-2, never claimed; no earlier closeout's dated note prefix is spelled on the page", () => {
    const text = page();
    const live = section(text, 14);
    expect(live).toContain("BLOCKED-LIVE-QUALIFICATION");
    for (const id of ["LB-13", "LB-1", "LB-2"]) expect(live, id).toMatch(new RegExp(`\\b${id}\\b`));
    const prefixes = [["[superseded 2026-09-29 by the B21 clos", "eout ("], ["[superseded 2026-10-02 by the B22 clos", "eout ("], ["[superseded 2026-10-05 by the B23 clos", "eout ("], ["[B21 clos", "eout, 2026-09-29]"], ["[B22 clos", "eout, 2026-10-02]"]].map((parts) => parts.join(""));
    for (const prefix of prefixes) expect(text, prefix).not.toContain(prefix);
    expect(text).not.toMatch(/\b(?:QUALIFIED|PASSED) live\b/);
  });

  it("7. part 2 (B24-A3b; red on the A3a tree): the per-principal table equals PRINCIPAL_ABUSE_LIMITS value for value; the page states the enforcement order (after membership and role; chat after its body read), the fail-closed refusal, the meters beside the windows, Q8's count, the two authenticated embedding paths and the gate at OD-197's full scope, and cites each site", async () => {
    const text = page();
    const limits = await import("@/app/lib/auth/abuse-limits") as unknown as Record<string, unknown>;
    const registry = limits.PRINCIPAL_ABUSE_LIMITS as Readonly<Record<string, { perPrincipal: { limit: number; windowMs: number; maxKeys: number }; kind: string }>> | undefined;
    expect(typeof registry, "PRINCIPAL_ABUSE_LIMITS is exported by abuse-limits.ts").toBe("object");
    const table = section(text, 15);
    expect(table).toMatch(/^## 15\. Part 2: the per-principal windows/);
    for (const [key, entry] of Object.entries(registry!)) {
      expect(table, key).toMatch(new RegExp(`^\\| \`${key}\` \\| ${entry.kind} \\| ${entry.perPrincipal.limit} \\| ${seconds(entry.perPrincipal.windowMs)} \\| ${entry.perPrincipal.maxKeys.toLocaleString("en-US")} \\| \`\\[tenantId, projectId, principalId\\]\` \\|$`, "m"));
    }
    expect(table.split(NEWLINE).filter((line) => /^\| `(?:GET|POST|PUT|PATCH|DELETE) \/api\//.test(line))).toHaveLength(Object.keys(registry!).length);
    for (const fact of [
      "after membership and role", "reads its body first", "`PRINCIPAL_RATE_LIMITED`", "fail closed",
      "`requestLlmProviderAdmission`", "0 calls", "distributor quotas", "`NGSPICE_DIAGNOSTIC_BUSY`", "`PX_PLAN_LIMIT_REACHED`", "`PX_KEY_LIMIT_REACHED`",
      "`POST /api/pcb/assign/suggest`", "`searchPartsForAI`", "`credit_unlimited`", "`expensive_unlimited`", "43 gated rows plus sign-in",
    ]) expect(text, fact).toContain(fact);
    const citations = pageCitations(text);
    for (const path of ["app/lib/auth/route-handlers.ts", "app/lib/computation/diagnostic-runner.ts", "app/lib/manufacturing-providers/provider-exchange.ts", "app/api/chat/orchestration-runtime.ts"]) {
      expect(citations.some((citation) => citation.path === path), path).toBe(true);
    }
  });

  it("8. [B24-A3 review, 2026-10-08] the review round (red on the reviewed page): the windows' clock is stated and cited (regressions-1); the preview's measured worst case per request and per minute, each figure with its log, and no unmeasured figure (security-1, coverage-preview-block-not-closed, coverage-measurement-evidence); the part-2 red record as the logs show it (coverage-a3b-red-record); and a section that lists every finding with its reproduction and fix", () => {
    const text = page();
    const citations = pageCitations(text);
    expect(citations.some((citation) => citation.path === "app/lib/fixture-runtime/clock.ts" && citation.anchor.startsWith("export function unfrozenNowMs(")), "the unfrozen clock is cited").toBe(true);
    for (const fact of ["`unfrozenNowMs`", "frozen clock", "e2e/agent-execution.spec.ts"]) expect(section(text, 2), fact).toContain(fact);
    const nine = section(text, 9);
    const logs = new Set([...nine.matchAll(/`(a3fix-measure-[a-z0-9-]+\.log)`/g)].map((match) => match[1]));
    expect(logs.size, "each measured figure names its log").toBeGreaterThanOrEqual(6);
    expect(nine).not.toContain("38 ms");
    expect(nine).toMatch(/of every minute/);
    expect(nine).not.toMatch(/The largest admitted board/);
    const fifteen = section(text, 15);
    expect(fifteen).toContain("`unfrozenNowMs`");
    const eighteen = section(text, 18);
    for (const fact of ["11 cases failed", "page case 5", "page case 7", "the values then proposed", "the final part-2 suites"]) expect(eighteen, fact).toContain(fact);
    expect(section(text, 20)).toMatch(/RECORDED/);
    const review = section(text, 21);
    expect(review).toMatch(/^## 21\. The review round/);
    for (const id of ["regressions-1", "security-1", "security-2", "security-3", "coverage-preview-block-not-closed", "coverage-signin-gate-gap", "coverage-a2-page-stale-total", "coverage-a3b-red-record", "coverage-measurement-evidence", "tests-01", "tests-02", "tests-03", "tests-04", "tests-05"]) expect(review, id).toContain(`\`${id}\``);
  });
});
