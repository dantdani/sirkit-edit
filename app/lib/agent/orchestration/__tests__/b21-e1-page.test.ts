/**
 * [B21 E1] The page `provider-routing-and-failure.md` (its E1 sections), pinned by content: its sections, labels, base and tag; the
 * role table IS `ROLE_PROVIDER_POLICY`, the breaker table IS `LLM_PROVIDER_ADMISSION`, the family rules are the rule objects' own
 * sources; the Anthropic stop rows ARE what the REAL adapter maps and the reason table IS `SPECIALIST_STOP_REASONS`; the refusal lists
 * ARE `PROVIDER_ROUTE_REFUSALS`, `RESULT_TOOL_REFUSALS` and `PROVIDER_FAILURES_WITHOUT_RETRY` and the pause sentence is the meters' own;
 * every citation resolves by content exactly once and, for every file E1 changed, on the line it states; every suite row carries its
 * real `it(` count and the route suite is admitted to CI by one explicit entry; what E1 does NOT do is stated; the B and D2 pages carry
 * their dated E1 notes and re-anchored rows; the provider notes carry the dated package facts; and the "For the lead" texts are present.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { anchorOccurrences, pageCitations } from "@/app/lib/mcp/server/__tests__/_citations";
import { AnthropicAgentAdapter, OpenAIAgentAdapter } from "@/app/lib/agent/adapters";
import { LLM_PROVIDER_ADMISSION, currentLlmProviderPause, resetAdmissionControl } from "@/app/lib/acquisition/admission-control";
import { PROVIDER_FAILURES_WITHOUT_RETRY } from "@/app/lib/agent/run-consumer";
import { SPECIALIST_ROLES } from "../contracts";
import { MODEL_FAMILY_RULES, PROVIDER_ROUTE_REFUSALS, ROLE_PROVIDER_POLICY } from "../provider-policy";
import { RESULT_TOOL_REFUSALS, SPECIALIST_RESULT_TOOL_NAME, SPECIALIST_STOP_REASONS } from "../result-tool";
import { MERGE_RULES } from "../merge";
import { anthropicTextMessage, failOnce, fakeAnthropic, fakeOpenAI, openAITextResponse } from "./_e1-fixtures";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8").replaceAll(`${String.fromCharCode(13)}${NEWLINE}`, NEWLINE);
const PAGE = "artifacts/ai-control-plane-b21/provider-routing-and-failure.md";
const BASE = "a4aba95";
const ROUTE_SUITE = "app/api/chat/__tests__/b21-e1-chat-provider.test.ts";
const SUITES = [
  "app/lib/agent/orchestration/__tests__/b21-e1-provider-policy.test.ts",
  "app/lib/agent/orchestration/__tests__/b21-e1-provider-breaker.test.ts",
  "app/lib/agent/orchestration/__tests__/b21-e1-fallback.test.ts",
  "app/lib/agent/orchestration/__tests__/b21-e1-stop-reasons.test.ts",
  "app/lib/agent/orchestration/__tests__/b21-e1-result-tool.test.ts",
  "app/lib/agent/orchestration/__tests__/b21-e1-retry-card.test.ts",
  "app/lib/agent/orchestration/__tests__/b21-e1-page.test.ts",
  ROUTE_SUITE,
];
/** every file E1 changed: its cited lines must be current */
const CHANGED = [
  "app/lib/agent/orchestration/provider-policy.ts", "app/lib/agent/orchestration/result-tool.ts", "app/lib/agent/orchestration/scheduler.ts", "app/api/chat/orchestration-runtime.ts",
  "app/api/chat/route.ts", "app/lib/agent/adapters.ts", "app/lib/agent/contracts.ts", "app/lib/acquisition/admission-control.ts", "app/lib/agent/run-consumer.ts",
  "app/lib/llm/openai-config.ts", "app/lib/llm/anthropic-config.ts", "app/lib/llm/openai-provider.ts", "app/lib/llm/anthropic-provider.ts",
  "app/api/chat/__tests__/b19-d-external-text-injection-route.test.ts", ".github/workflows/deterministic-manufacturing.yml",
  "app/page.tsx", "app/lib/ai-preferences.ts", "app/lib/agent/orchestration/merge.ts", // [B21 E1 fix] the card's withheld Retry, the merge's source wording
];
/** [B21 E1 fix] the test files and fixtures E1 changed (their cited lines must be current on every B21 page) */
const E1_CHANGED_SUITES = [
  "app/lib/agent/orchestration/__tests__/b21-a-import-gates.test.ts", "app/lib/agent/orchestration/__tests__/b21-b-scheduler.test.ts", "app/lib/agent/orchestration/__tests__/b21-d-merge.test.ts",
  "app/lib/agent/orchestration/__tests__/b21-d2-provenance.test.ts", "app/lib/agent/orchestration/__tests__/_role-fixtures.ts", "app/lib/agent/orchestration/__tests__/_merge-fixtures.ts",
  "app/lib/agent/orchestration/__tests__/_d2-fixtures.ts", "app/lib/agent/orchestration/__tests__/_seal-relay.ts", "app/api/chat/__tests__/b21-b-chat-router.test.ts", "app/api/chat/__tests__/b21-d-chat-merge.test.ts",
  "app/api/chat/__tests__/b21-d2-chat-proposals.test.ts", "app/api/chat/__tests__/b21-d3-chat-replacement.test.ts", "app/lib/mcp/__tests__/b20-a0-admission-by-server-and-tool.test.ts",
];
const quoted = (value: string): string => `\`${value}\``;
const section = (page: string, from: number): string => page.slice(page.indexOf(`## ${from}. `), page.indexOf(`## ${from + 1}. `) > 0 ? page.indexOf(`## ${from + 1}. `) : undefined);

vi.stubGlobal("fetch", () => { throw new Error("no network"); });
afterEach(() => resetAdmissionControl());

describe("[B21 E1] the provider-routing-and-failure page", () => {
  it("1. the page exists with its sections in order, its labels, its base, its tag, its E1 scope and its provider facts", () => {
    const page = read(PAGE);
    const headings = [...page.matchAll(/^## (\d+)\. /gm)].map((match) => Number(match[1]));
    expect(headings).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(page).toMatch(new RegExp(`^## 9\\. Citations, as of base ${BASE}`, "m"));
    for (const label of ["CONFIRMED", "INFERRED", "RECORDED", "UNKNOWN", "BLOCKED-LIVE-QUALIFICATION"]) expect(page, label).toContain(label);
    expect(page).toContain("[B21 E1]");
    expect(page).toContain("provider-reference-notes.md");
    expect(page).toContain("This page holds the E1 sections; B21-E2");
  });

  it("2. the role table IS ROLE_PROVIDER_POLICY, the breaker table IS LLM_PROVIDER_ADMISSION, and the family rules are quoted from the rule objects themselves", () => {
    const page = read(PAGE);
    const roles = [...section(page, 1).matchAll(/^\| `([a-z-]+)` \| (inherit|openai|anthropic) \| ([a-z0-9.-]+) \|$/gm)].map((row) => [row[1]!, row[2]!, row[3]!]);
    expect(roles).toEqual(SPECIALIST_ROLES.map((role) => [role, ROLE_PROVIDER_POLICY[role].provider, ROLE_PROVIDER_POLICY[role].model]));
    const values = [...section(page, 2).matchAll(/^\| `([a-zA-Z]+)` \| (\d+) \| [^|]+ \|$/gm)].map((row) => [row[1]!, Number(row[2])]);
    expect(values).toEqual(Object.entries(LLM_PROVIDER_ADMISSION));
    for (const rule of [...MODEL_FAMILY_RULES.openai, ...MODEL_FAMILY_RULES.anthropic]) expect(section(page, 1), rule.source).toContain(`\`/${rule.source}/\``);
  });

  it("3. the Anthropic stop rows ARE what the REAL adapter maps, every closed stop appears, and the reason table IS SPECIALIST_STOP_REASONS verbatim", async () => {
    const page = read(PAGE);
    const mapping = [...section(page, 4).matchAll(/^\| (Anthropic|OpenAI) (.+?) \| `([a-z_]+)` \|$/gm)].map((row) => ({ provider: row[1]!, value: row[2]!, stop: row[3]! }));
    expect(mapping.length).toBeGreaterThanOrEqual(12);
    for (const row of mapping.filter((entry) => entry.provider === "Anthropic")) {
      const values = [...row.value.matchAll(/`([a-z_]+)`/g)].map((match) => match[1]!);
      for (const value of values) {
        const step = await new AnthropicAgentAdapter(fakeAnthropic(() => anthropicTextMessage("ok", { stop_reason: value })).client as never, "claude-test").start({ system: "s", history: [], userMessage: "u", tools: [] });
        expect(step.stop, value).toBe(row.stop);
      }
    }
    expect(new Set(mapping.map((row) => row.stop))).toEqual(new Set(["end_turn", ...Object.keys(SPECIALIST_STOP_REASONS)]));
    const reasons = [...section(page, 4).matchAll(/^\| `([a-z_]+)` \| (stop_[^|]+?) \|$/gm)].map((row) => [row[1]!, row[2]!]);
    expect(reasons).toEqual(Object.entries(SPECIALIST_STOP_REASONS));
  });

  it("4. the closed lists ARE the code's: the result tool's refusals in order, the route refusals, the failures without Retry, the tool's name; the pause sentence is the meters' own", async () => {
    const page = read(PAGE);
    const refusals = [...section(page, 5).matchAll(/^\| `([a-z_]+)` \| [^|]+ \|$/gm)].map((row) => row[1]!);
    expect(refusals).toEqual([...RESULT_TOOL_REFUSALS]);
    for (const code of [...PROVIDER_ROUTE_REFUSALS, ...PROVIDER_FAILURES_WITHOUT_RETRY, SPECIALIST_RESULT_TOOL_NAME]) expect(page, code).toContain(quoted(code));
    const at = Date.parse("2026-09-27T12:00:00.000Z");
    await failOnce("openai", "insufficient_quota", at);
    const sentence = currentLlmProviderPause({ kind: "llm-provider", provider: "openai" }, at + 1, "agent")!.message;
    expect(section(page, 2)).toContain(`\`${sentence.replace(new Date(at + LLM_PROVIDER_ADMISSION.quotaOpenMs).toISOString(), "<ISO>")}\``);
  });

  it("5. every citation resolves by content exactly once, ids run C1..Cn; for every file E1 changed the cited line IS current and each is cited; every suite row names a file with the `it(` count it states; the route suite is admitted to CI by one explicit entry", () => {
    const page = read(PAGE);
    const citations = pageCitations(page);
    expect(citations.length).toBeGreaterThanOrEqual(50);
    expect(citations.map((citation) => citation.id)).toEqual(citations.map((_, index) => `C${index + 1}`));
    const wrong = citations.filter((citation) => anchorOccurrences(ROOT, citation) !== 1).map((citation) => `${citation.id} ${citation.path}: ${anchorOccurrences(ROOT, citation)}`);
    expect(wrong).toEqual([]);
    for (const path of CHANGED) expect(citations.some((citation) => citation.path === path), path).toBe(true);
    const stale = citations.filter((citation) => CHANGED.includes(citation.path) && !(read(citation.path).split(NEWLINE)[citation.line - 1] ?? "").includes(citation.anchor)).map((citation) => `${citation.id} ${citation.path}:${citation.line}`);
    expect(stale).toEqual([]);
    const rows = [...page.matchAll(/^\| `((?:app|e2e)\/[^`]+\.(?:test|spec)\.tsx?)` \| (\d+) \|/gm)];
    expect(rows.map((row) => row[1])).toEqual(expect.arrayContaining(SUITES));
    for (const row of rows) expect((read(row[1]!).match(/^\s*it\(/gm) ?? []).length, `${row[1]} it( blocks`).toBe(Number(row[2]));
    expect(read(".github/workflows/deterministic-manufacturing.yml")).toMatch(/^ {10}app\/api\/chat\/__tests__\/b21-e1-chat-provider\.test\.ts$/m);
  });

  it("6. what E1 does NOT do is stated: no evaluations, no exposed tool, no route, no UI control, no run event, no request key outside the pinned sets, no background or batch, no edit to the nine scanned files, no trace block, no route-level resume, no composer routing, no reserved-file edit", () => {
    const not = section(read(PAGE), 6).toLowerCase();
    for (const claim of ["no evaluations", "no new exposed tool", "no ui", "no new run event", "no request key outside the pinned sets", "no `background`", "no edit to the nine b11-scanned files", "no trace", "no route-level resume", "no composer routing", "no reserved-file edit", "no provider sdk outside the adapters"]) expect(not, claim).toContain(claim);
  });

  it("7. the B and D2 pages carry their dated E1 notes and re-anchored rows, and the provider notes carry the dated package facts", () => {
    const note = "[B21 E1, 2026-09-27]";
    const router = read("artifacts/ai-control-plane-b21/task-complexity-router.md");
    expect(router).toMatch(/B21-E replaces this\s+with the strict result tool\.[^\n]*\n?[^\n]*\[B21 E1, 2026-09-27\] Replaced since/);
    expect(router).toMatch(/\| `attemptsPerTask` \| 2 \|[^\n]*\[B21 E1, 2026-09-27\] Applied since B21-E1/);
    expect(router).toMatch(/^\| C16 \| `app\/lib\/agent\/orchestration\/result-tool\.ts` \| \d+ \| — \| `export function parseSpecialistResultArguments\(/m);
    expect(router).not.toContain("export function parseSpecialistResult(finalText");
    const proposals = read("artifacts/ai-control-plane-b21/specialist-proposals.md");
    expect(proposals).toContain(`applied to the parsed final text (C17; ${note} since B21-E1 the ONE strict result-tool call's arguments`);
    expect(proposals).toMatch(/^\| C17 \| `app\/lib\/agent\/orchestration\/scheduler\.ts` \| \d+ \| — \| `const parsed = attachSealedArtifacts\(specialistResultFromCapture\(specialist\.capture, task\.role\), seals\.artifacts\);`/m);
    const notes = read("artifacts/ai-control-plane-b21/provider-reference-notes.md");
    const entry = notes.slice(notes.indexOf("**2026-09-27, B21-E1"));
    expect(entry.length).toBeGreaterThan(500);
    for (const claim of ["NO page fetched", "@anthropic-ai/sdk` 0.98.0", "`openai` 6.48.0", "model_context_window_exceeded", "ResponseOutputRefusal", "incomplete_details", "BLOCKED-LIVE-QUALIFICATION"]) expect(entry, claim).toContain(claim);
  });

  it("8. the \"For the lead\" section holds every reserved text in full: OD-115, OD-116, OD-117 and OD-119 as applied, the README row, the ledger paragraph, the PROGRAM_STATE texts, the discovery closure clauses (D21-18, D21-19, D21-20 as policy, D21-21 closed; D21-39 and D21-40 new) and the section-10 line, and the pin moves with their reasons", () => {
    const page = read(PAGE);
    const lead = section(page, 8);
    expect(lead.length).toBeGreaterThan(6_000);
    for (const od of ["OD-115", "OD-116", "OD-117", "OD-119"]) expect(lead).toMatch(new RegExp(`^### ${od} .*as applied \\(B21-E1, 2026-09-27\\)$`, "m"));
    for (const heading of ["The README row", "The ledger paragraph", "PROGRAM_STATE.json", "Discovery closure clauses", "§10, B21-E1 amendment"]) expect(lead, heading).toContain(heading);
    expect(lead).toMatch(/^\| B21-E1 /m);
    expect(lead).toMatch(/^### B21-E1 — /m);
    for (const defect of ["D21-18", "D21-19", "D21-21"]) expect(lead).toMatch(new RegExp(`\\*\\*${defect} [^*]*\\*\\* — CLOSED by B21-E1`));
    expect(lead).toMatch(/\*\*D21-20 [^*]*\*\* — CLOSED AS POLICY by B21-E1/);
    for (const defect of ["D21-39", "D21-40"]) expect(lead).toMatch(new RegExp(`\\*\\*${defect} \\(new, low\\)`));
    expect(lead).toContain("MULTI-AGENT STATUS");
    const moves = section(page, 7);
    for (const suite of ["b21-a-import-gates.test.ts", "b21-b-scheduler.test.ts", "b21-d2-provenance.test.ts", "b09-2-recovery.test.tsx", "b20-a0-admission-by-server-and-tool.test.ts", "b19-d-external-text-injection-route.test.ts", "_role-fixtures.ts", "_merge-fixtures.ts", "_d2-fixtures.ts", "_seal-relay.ts"]) expect(moves, suite).toContain(suite);
    expect(page).toContain("OD-108's deviation stands");
  });

  it("9. [B21 E1 fix: tests-page-openai-stop-rows] every OpenAI stop row IS what the REAL OpenAI adapter maps: each row's provider values, built as the Responses API reports them, run through `OpenAIAgentAdapter` and land on the row's stop (a row this case does not know fails it)", async () => {
    const rows = [...section(read(PAGE), 4).matchAll(/^\| OpenAI (.+?) \| `([a-z_]+)` \|$/gm)].map((row) => ({ value: row[1]!, stop: row[2]! }));
    const refusalPart = { output: [{ type: "message", role: "assistant", content: [{ type: "refusal", refusal: "(fake) I can't help with that." }] }], output_text: "" };
    const responses: Record<string, Array<Record<string, unknown>>> = {
      "`completed`": [{ status: "completed" }],
      "`completed` with an output message's `refusal` part": [{ status: "completed", ...refusalPart }],
      "`incomplete` with `incomplete_details.reason` `max_output_tokens`": [{ status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }],
      "`incomplete` otherwise (`content_filter`, none)": [{ status: "incomplete", incomplete_details: { reason: "content_filter" } }, { status: "incomplete", incomplete_details: null }],
      "`failed`, `cancelled`, `queued`, `in_progress`, none": [{ status: "failed" }, { status: "cancelled" }, { status: "queued" }, { status: "in_progress" }, { status: undefined }],
    };
    expect(rows.map((row) => row.value)).toEqual(Object.keys(responses));
    for (const row of rows) {
      for (const extra of responses[row.value]!) {
        const step = await new OpenAIAgentAdapter(fakeOpenAI(() => openAITextResponse("ok", extra)).client as never, "gpt-test", undefined).start({ system: "s", history: [], userMessage: "u", tools: [] });
        expect(step.stop, `${row.value} ${JSON.stringify(extra)}`).toBe(row.stop);
      }
    }
  });

  it("10. [B21 E1 fix: regressions-5] every citation row of the B21 pages A..D3 that cites a file E1 changed states that file's CURRENT line (B's gate-test row included), and the provider notes carry a dated note re-pointing the family rules and the default model to where E1 named them", () => {
    const touched = [...CHANGED, ...E1_CHANGED_SUITES];
    const stale: string[] = [];
    for (const name of ["orchestration-contracts", "task-complexity-router", "specialist-roles", "merge-and-disagreement", "specialist-proposals", "specialist-replacement"]) {
      for (const citation of pageCitations(read(`artifacts/ai-control-plane-b21/${name}.md`))) {
        if (touched.includes(citation.path) && !(read(citation.path).split(NEWLINE)[citation.line - 1] ?? "").includes(citation.anchor)) stale.push(`${name} ${citation.id} ${citation.path}:${citation.line}`);
      }
    }
    expect(stale).toEqual([]);
    const notes = read("artifacts/ai-control-plane-b21/provider-reference-notes.md");
    const repointed = notes.split(NEWLINE).filter((line) => line.includes("[B21 E1, 2026-09-27] Re-pointed:"));
    expect(repointed).toHaveLength(1);
    for (const claim of ["`app/lib/llm/anthropic-config.ts`", "`OPENAI_REASONING_MODEL_FAMILY`", "`OPENAI_NO_TEMPERATURE_MODEL_FAMILY`", "`ANTHROPIC_TEMPERATURE_MODEL_FAMILY`", "`DEFAULT_ANTHROPIC_MODEL`"]) expect(repointed[0], claim).toContain(claim);
  });

  it("11. [B21 E1 fix: coverage-merge-one-adapter-premise] the merge's source rule no longer rests on \"one adapter per provider\" (since E1 every specialist runs on its own adapter and may run on a routed model of its provider): the rule, its streamed escalation sentence, its D8 row and the runtime's comment say one provider is ONE source whatever model or adapter a role ran on; the D page carries the dated note, and OD-132's provider-and-model keying is re-deferred on this page", () => {
    for (const path of ["app/lib/agent/orchestration/merge.ts", "app/api/chat/orchestration-runtime.ts"]) expect(read(path), path).not.toMatch(/one adapter per provider|one configured model per provider/);
    expect(MERGE_RULES.find((rule) => rule.id === "D8")!.merge).toMatch(/one provider is ONE source whatever model or adapter/);
    expect(read("app/lib/agent/orchestration/merge.ts")).toContain("one provider is one correlated source whatever model or adapter its specialists ran on");
    expect(read("artifacts/ai-control-plane-b21/merge-and-disagreement.md").split(NEWLINE).filter((line) => line.includes("[B21 E1, 2026-09-27]") && line.includes("one provider is ONE source whatever model or adapter")).length).toBeGreaterThanOrEqual(1);
    expect(read(PAGE).split(NEWLINE).filter((line) => /OD-132.*provider and model.*re-deferred/.test(line)).length).toBeGreaterThanOrEqual(1);
  });
});
