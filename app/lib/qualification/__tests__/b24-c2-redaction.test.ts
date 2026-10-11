/**
 * [B24-C2] The redaction authority on the three stores that kept user or model text without it (D24-25; runbook :1088 "Redact secrets and
 * sensitive source content"): the execution grant's 240-character instruction excerpt (`app/lib/execution-grant/mint.ts`), the SPICE
 * studio's browser-local `aiAuditLog` (`app/lib/spice/project.ts`, `persistence.ts`) and the provider error's `detail` and log line
 * (`app/lib/llm/errors.ts`). One classifier (`app/lib/agent/redaction.ts`, not edited): the token-anchored patterns for design text, the
 * diagnostic patterns for a provider's message.
 *
 *  1. a secret-shaped instruction is stored redacted in the grant's excerpt (red at 4ec18eb), the message digest unchanged;
 *  2. "desk-lamp-controller" survives (the token-anchored `sk-` rule);
 *  3. a key that straddles character 240 is redacted whole (redact first, then cut); the excerpt stays at most 240;
 *  4. a message with no secret shape and no control or format character keeps today's excerpt byte for byte; U+200B and U+202E become a
 *     space (a stated change); explicit-request.ts is unchanged and the proof still reads the whole message;
 *  5. 501 test edits leave at most `maxEntries` entries, the oldest out first, behind one leading `system` entry carrying the number
 *     dropped (red);
 *  6. a stored project holding 501 entries is bounded by `loadStudioProject` (red), and a stored entry written before the redaction is
 *     redacted and capped on load as on write (reason, change set, evidence; red before the review round);
 *  7. a change set over 16,000 characters is stored as `{ withheld: "change_set_too_large", operationCount, digest }` (red); a smaller one
 *     keeps its shape with its string leaves redacted; `reason` is redacted and capped;
 *  8. B22-C's case 2 fields hold: every evidence reference labelled caller-supplied, `changeSet[].operation.op` readable;
 *  9. the provider `detail` and the log line are redacted (red);
 * 10. a key straddling character 300 of a provider message is redacted whole, and a message over 300 characters still ends in "...";
 * 11. the evidence references are redacted and bounded: a secret-shaped `signal` or `unit` is stored redacted, at most `maxEvidenceRefs`
 *     references are kept and the excess is counted in `evidenceWithheld` (red before the review round).
 *
 * Every secret-shaped fixture is assembled at run time (string joins), so the staged-content scan and A2's CI scan stay clean. Nothing
 * here writes a file; the SPICE store is a fake `window.localStorage`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import type { DurableWorkflowScope } from "@/app/lib/durable-workflow/types";
import { makeBoard, makeInstance, makeResistorDef } from "@/app/lib/pcb/__tests__/autoplace-fixture";
import { mmToNm } from "@/app/lib/pcb/units";
import { PRESETS } from "@/app/lib/pcb/drc/presets";
import { assembleAgentRunContext } from "@/app/lib/agent/context";
import { sealExecutionIntent, type SealedExecutionPlan } from "@/app/lib/agent/execution-intents";
import { SIRKIT_TOOL_CATALOG } from "@/app/lib/engineering/tool-catalog";
import { AGENT_AUTONOMY_SCHEMA, type AgentAutonomySetting } from "@/app/lib/engineering/permission-tiers";
import { MAX_INSTRUCTION_EXCERPT, userInstructionDigest, type ExecutionGrantBase, type PublicExecutionGrant } from "@/app/lib/engineering/execution-grant";
import { ExecutionGrantStore, resetExecutionGrantStoreFactory } from "@/app/lib/execution-grant/store";
import { createExecutionGrantMinter, type MinterContext } from "@/app/lib/execution-grant/mint";
import { sanitizeModelBoundText } from "@/app/lib/agent/redaction";
import { AI_AUDIT_LOG_BOUNDS, applyAiProposal, boundAiAuditLog, createSimulationProject, updateTest } from "@/app/lib/spice/project";
import { loadStudioProject, saveStudioProject } from "@/app/lib/spice/persistence";
import { dividerSchematic } from "@/app/lib/spice/__tests__/fixtures";
import type { AiStudioProposal, EvidenceRef, SimulationProject } from "@/app/lib/spice/types";
import { providerErrorResponse } from "@/app/lib/llm/errors";

const ROOT = process.cwd();
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");
/** Secret-shaped fixtures, joined at run time. */
const OPENAI_KEY = ["sk-", "proj-", "0123456789abcdefghijklmnop"].join("");
const ANTHROPIC_KEY = ["sk-", "ant-", "api03-", "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123"].join("");
const BEARER = ["Bearer", " ", "eyJhbGciOiJIUzI1NiJ9.payload.signature"].join("");
const ENV_DUMP = ["OPENAI_", "API_KEY", "=", "abcdefghijklmnopqrstuvwxyz"].join("");
const ZERO_WIDTH = String.fromCharCode(0x200b);
const RTL_OVERRIDE = String.fromCharCode(0x202e);

// ── the grant's excerpt (mint.ts) ───────────────────────────────────────────────────────────────────────────────────────────────
const SCOPE: DurableWorkflowScope = { tenantId: "local", projectId: "p24c2", branchId: "main" };
const T0 = "2026-10-08T12:00:00.000Z";
const LINEAGE = "lin1-0000000000000c02";
const def = makeResistorDef();
const board = makeBoard(40, 30, [makeInstance("r3", def, { x: 5, y: 5 }, { "1": 1, "2": 2 }), makeInstance("u1", def, { x: 12, y: 12 }, { "1": 2, "2": 0 }, { locked: true })], 2);
const R3 = board.footprints.find((f) => f.ref === "R3")!;
const MOVE = SIRKIT_TOOL_CATALOG.find((d) => d.toolId === "sirkit.pcb.move-footprint")!;
const setting = (mode: AgentAutonomySetting["mode"]): AgentAutonomySetting => ({ schema: AGENT_AUTONOMY_SCHEMA, tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, mode, revision: 1, updatedAt: T0, updatedBy: null });
const BASE: ExecutionGrantBase = { canonicalRevisionDigest: "eng1-canon", pcb: { pcbRevisionId: "pcb2-abc", boardDigest: "eng1-board", headSequence: 4, lineageId: LINEAGE, validationPolicy: { presetId: PRESETS[0]!.id, presetVersion: "2", rulesDigest: "eng1-rules" } }, schematic: null };
function plan(): SealedExecutionPlan {
  const assembly = assembleAgentRunContext({ ...SCOPE, board, pcbProposalBasis: { historyHeadSequence: 4, historyHeadLabel: null, lineageId: LINEAGE, activeDrcPresetId: PRESETS[0]!.id }, verifiedActor: { principalId: "u-1", actorRole: "pcb_editor", membershipRevision: "mbr1-a", authMethod: "local_dev" }, autonomy: setting("execute_explicit_tier1") });
  if (!assembly.ok) throw new Error(assembly.reason);
  const sealed = sealExecutionIntent({ descriptor: MOVE, args: { moves: [{ footprintId: R3.id, x: R3.at.x + mmToNm(2), y: R3.at.y }] }, context: assembly.context });
  if (!sealed.ok) throw new Error(sealed.diagnostics.join(" "));
  return sealed.plan;
}
let seed = 0;
async function mintWith(userMessage: string, over: Partial<MinterContext> = {}): Promise<PublicExecutionGrant> {
  const store = new ExecutionGrantStore(new InMemoryDurableWorkflowRepository());
  const minter = createExecutionGrantMinter({
    principalId: "u-1", role: "pcb_editor", membershipRevision: "mbr1-a", authClass: "local_dev", sessionIdentity: "sess-1", correlationId: "corr-1",
    scope: SCOPE, boardInstanceId: "board:p24c2", autonomy: setting("execute_explicit_tier1"), userMessage, runId: `run-${(seed += 1)}`, provider: "openai",
    now: () => Date.parse(T0), store, randomHex: () => (seed += 1).toString(16).padStart(32, "0"), ...over,
  });
  const outcome = await minter.mint({ plan: plan(), board, base: BASE, session: { editor: "pcb", lineageId: LINEAGE, runId: `run-${seed}`, viewSessionId: null }, origin: { callId: `call-${seed}`, registryDigest: "eng1-registry", promptVersion: "1.0.0" } });
  if (!outcome.ok) throw new Error(outcome.diagnostics.join(" "));
  return outcome.grant;
}
/** The excerpt as mint.ts built it before B24-C2 (explicit-request.ts:69's formula): whitespace collapsed, trimmed, cut at 240. */
const legacyExcerpt = (message: string): string => message.replace(/\s+/g, " ").trim().slice(0, MAX_INSTRUCTION_EXCERPT);

afterEach(() => {
  resetExecutionGrantStoreFactory();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("[B24-C2] the grant's instruction excerpt is redacted (D24-25)", () => {
  it("1. a secret-shaped instruction is stored redacted in the grant's excerpt (red at 4ec18eb): the key is gone, [redacted] stands in its place, and the message digest is the whole message's, unchanged", async () => {
    const message = `Move R3 2 mm to the right, my key is ${OPENAI_KEY} and ${ANTHROPIC_KEY}.`;
    const grant = await mintWith(message);
    const excerpt = grant.binding.instruction.excerpt;
    expect(excerpt).not.toContain(OPENAI_KEY);
    expect(excerpt).not.toContain(ANTHROPIC_KEY);
    expect(excerpt).not.toContain("0123456789abcdefghijklmnop");
    expect(excerpt).toContain("[redacted]");
    expect(excerpt.length).toBeLessThanOrEqual(MAX_INSTRUCTION_EXCERPT);
    expect(grant.binding.instruction.userMessageDigest).toBe(userInstructionDigest(message)); // the digest is of the whole message, as before
    expect(JSON.stringify(grant)).not.toContain(OPENAI_KEY);
    const envDump = await mintWith(`Move R3 2 mm to the right. ${ENV_DUMP} ${BEARER}`);
    expect(envDump.binding.instruction.excerpt).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(envDump.binding.instruction.excerpt).not.toContain("eyJhbGciOiJIUzI1NiJ9");
  });

  it("2. design text survives: \"desk-lamp-controller\" is not a key (the token-anchored sk- rule), so the excerpt keeps it and equals today's", async () => {
    const message = "Move desk-lamp-controller R3 2 mm to the right.";
    const grant = await mintWith(message);
    expect(grant.binding.instruction.excerpt).toBe(legacyExcerpt(message));
    expect(grant.binding.instruction.excerpt).toContain("desk-lamp-controller");
    expect(sanitizeModelBoundText("the desk-lamp-tools board")).toBe("the desk-lamp-tools board");
  });

  it("3. a key that straddles character 240 is redacted whole: redact first, then cut - no fragment of the key survives and the excerpt is at most 240 characters", async () => {
    const filler = `${"Move R3 2 mm to the right. ".repeat(20).slice(0, MAX_INSTRUCTION_EXCERPT - 11)} `; // the key starts a token (the design-text rule); it begins 10 characters before the cut
    const message = `${filler}${OPENAI_KEY} then stop.`;
    expect(message.indexOf(OPENAI_KEY)).toBeLessThan(MAX_INSTRUCTION_EXCERPT);
    expect(message.indexOf(OPENAI_KEY) + OPENAI_KEY.length).toBeGreaterThan(MAX_INSTRUCTION_EXCERPT);
    expect(legacyExcerpt(message)).toContain(OPENAI_KEY.slice(0, 8)); // the pre-C2 cut kept a fragment of the key
    const grant = await mintWith(message);
    const excerpt = grant.binding.instruction.excerpt;
    expect(excerpt.length).toBeLessThanOrEqual(MAX_INSTRUCTION_EXCERPT);
    for (const fragment of [OPENAI_KEY, OPENAI_KEY.slice(0, 8), "0123456789"]) expect(excerpt).not.toContain(fragment);
    expect(excerpt).toContain("[redacted]");
  });

  it("4. a message with no secret shape and no control or format character keeps today's excerpt byte for byte (a long one cut at 240 included); U+200B and U+202E become a space (a stated change, OD-232); explicit-request.ts is unchanged and the proof still reads the whole message", async () => {
    for (const message of ["Move R3 2 mm to the right.", "  Rotate   U1 by\n90 degrees.  ", `Move R3 2 mm to the right. ${"Please keep the net names as they are. ".repeat(12)}`]) {
      const grant = await mintWith(message);
      expect(grant.binding.instruction.excerpt, message.slice(0, 30)).toBe(legacyExcerpt(message));
    }
    const zeroWidth = await mintWith(`Move R3${ZERO_WIDTH} 2 mm to the right.`);
    expect(zeroWidth.binding.instruction.excerpt).toBe(sanitizeModelBoundText(legacyExcerpt(`Move R3${ZERO_WIDTH} 2 mm to the right.`)));
    expect(zeroWidth.binding.instruction.excerpt).not.toContain(ZERO_WIDTH);
    const override = await mintWith(`Move R3 2 mm to the ${RTL_OVERRIDE}right.`);
    expect(override.binding.instruction.excerpt).not.toContain(RTL_OVERRIDE);
    expect(override.binding.instruction.excerpt).toBe("Move R3 2 mm to the right."); // the override (and the space before it) became one space
    // the proof reads the whole message: an explicit instruction is still proven whole-message, and explicit-request.ts is as it was
    const explicit = await mintWith("Move R3 2 mm to the right.");
    expect(explicit.binding.instruction.explicit).toMatchObject({ proven: true, coverage: "whole-message" });
    expect(explicit.binding.operation.decision).toBe("execute_explicit");
    const explicitRequest = read("app/lib/engineering/explicit-request.ts");
    expect(explicitRequest).toContain('const excerpt = userMessage.replace(/\\s+/g, " ").trim().slice(0, MAX_INSTRUCTION_EXCERPT);');
    expect(explicitRequest).not.toContain("B24-C2");
    expect(explicitRequest).not.toContain("sanitize");
    const mint = read("app/lib/execution-grant/mint.ts");
    expect(mint).toContain('excerpt: sanitizeModelBoundText(ctx.userMessage.replace(/\\s+/g, " ").trim()).slice(0, MAX_INSTRUCTION_EXCERPT)');
  });
});

// ── the SPICE audit log (project.ts, persistence.ts) ──────────────────────────────────────────────────────────────────────────────
function studioProject(): SimulationProject {
  const value = createSimulationProject(dividerSchematic(), { now: T0 });
  value.tests[0]!.analyses = [{ id: "op", name: "Operating point", type: "op", enabled: true }];
  return value;
}
const proposal = (overrides: Partial<AiStudioProposal> = {}): AiStudioProposal => ({ id: "aiprop-b24c2", summary: "s", rationale: "r", confidence: 0.5, assumptions: [], operations: [], evidence: [], createdAt: T0, ...overrides });
class FakeStorage implements Storage {
  private readonly items = new Map<string, string>();
  get length(): number { return this.items.size; }
  clear(): void { this.items.clear(); }
  getItem(key: string): string | null { return this.items.get(key) ?? null; }
  key(index: number): string | null { return [...this.items.keys()][index] ?? null; }
  removeItem(key: string): void { this.items.delete(key); }
  setItem(key: string, value: string): void { this.items.set(key, String(value)); }
}

describe("[B24-C2] the SPICE audit log is bounded and redacted (D24-25)", () => {
  it("5. 501 test edits leave at most maxEntries entries (red at 4ec18eb): the oldest go first, one leading `system` entry `audit-log-truncated` carries the cumulative number dropped, and the newest edit is the last entry", () => {
    expect(AI_AUDIT_LOG_BOUNDS).toEqual({ maxEntries: 200, maxReasonChars: 2_000, maxChangeSetChars: 16_000, maxEvidenceRefs: 200 }); // [B24-C2 review, 2026-10-09] + maxEvidenceRefs (the server's cap, /api/spice/ai)
    let project = studioProject();
    const testId = project.tests[0]!.id;
    for (let edit = 1; edit <= 501; edit += 1) project = updateTest(project, testId, (draft) => { draft.name = `edit ${edit}`; }, `edit ${edit}`, T0);
    expect(project.aiAuditLog.length).toBeLessThanOrEqual(AI_AUDIT_LOG_BOUNDS.maxEntries);
    expect(project.aiAuditLog.length).toBe(AI_AUDIT_LOG_BOUNDS.maxEntries);
    const [truncated, ...kept] = project.aiAuditLog;
    expect(truncated).toMatchObject({ actor: "system", operation: "audit-log-truncated", approval: "automatic", status: "applied" });
    expect(truncated!.changeSet).toEqual({ droppedEntries: 501 - (AI_AUDIT_LOG_BOUNDS.maxEntries - 1) });
    expect(kept.map((entry) => entry.reason)).toEqual(Array.from({ length: AI_AUDIT_LOG_BOUNDS.maxEntries - 1 }, (_, index) => `edit ${501 - (AI_AUDIT_LOG_BOUNDS.maxEntries - 1) + 1 + index}`));
    expect(kept.at(-1)!.reason).toBe("edit 501");
    expect(project.aiAuditLog.filter((entry) => entry.operation === "audit-log-truncated")).toHaveLength(1); // one leading marker, never a chain
    // the bound is applied by one helper both writers use: a project already at the bound gains exactly one entry per write
    const once = applyAiProposal(project, proposal({ operations: [{ approval: "review", operation: { op: "request-run", runPlanId: project.runPlans[0]!.id } }] }), [0], T0);
    expect(once.aiAuditLog.length).toBe(AI_AUDIT_LOG_BOUNDS.maxEntries);
    expect(once.aiAuditLog.at(-1)).toMatchObject({ actor: "ai", operation: "apply-ai-proposal" });
    expect(once.aiAuditLog[0]!.changeSet).toEqual({ droppedEntries: 501 - (AI_AUDIT_LOG_BOUNDS.maxEntries - 1) + 1 });
  });

  it("6. a stored project holding 501 entries is bounded by loadStudioProject (red at 4ec18eb): the same bound, the same leading marker; a stored entry written before the redaction is redacted and capped on load as on write (reason, change set, evidence; red before the review round); a project within the bound loads unchanged", () => {
    const storage = new FakeStorage();
    vi.stubGlobal("window", { localStorage: storage });
    const stored = studioProject();
    stored.aiAuditLog = Array.from({ length: 501 }, (_, index) => ({ id: `audit_${index}`, timestamp: T0, actor: "user" as const, operation: "update-test", approval: "automatic" as const, status: "applied" as const, reason: `stored ${index + 1}` }));
    saveStudioProject(stored);
    expect(JSON.parse(storage.getItem("sirkit:spice-studio:project:v1")!).aiAuditLog).toHaveLength(501); // the store holds what was saved; the bound is applied on load
    const loaded = loadStudioProject();
    expect(loaded).not.toBeNull();
    expect(loaded!.aiAuditLog.length).toBe(AI_AUDIT_LOG_BOUNDS.maxEntries);
    expect(loaded!.aiAuditLog[0]).toMatchObject({ actor: "system", operation: "audit-log-truncated", changeSet: { droppedEntries: 501 - (AI_AUDIT_LOG_BOUNDS.maxEntries - 1) } });
    expect(loaded!.aiAuditLog.at(-1)!.reason).toBe("stored 501");
    // [B24-C2 review, 2026-10-09] a stored entry written before the redaction (or by any writer that set aiAuditLog directly) is redacted and
    // capped on load exactly as on write: the store still holds the pre-redaction bytes, the loaded project does not
    const legacy = studioProject();
    legacy.aiAuditLog = [{
      id: "audit_legacy", timestamp: T0, actor: "ai", operation: "apply-ai-proposal", approval: "review", status: "applied",
      reason: `set from ${OPENAI_KEY} ${"r".repeat(30_000)}`,
      evidence: [{ runId: "run-a", testId: "test", signal: ANTHROPIC_KEY, unit: BEARER }],
      changeSet: Array.from({ length: 200 }, (_, index) => ({ approval: "review", operation: { op: "set-variable", testId: "t", variable: { id: `var_${index}`, name: `v${index}`, value: "1", unit: "V", enabled: true, description: `${OPENAI_KEY} ${"x".repeat(80)}` } } })),
    }];
    expect(JSON.stringify(legacy.aiAuditLog[0]!.changeSet).length).toBeGreaterThan(AI_AUDIT_LOG_BOUNDS.maxChangeSetChars);
    saveStudioProject(legacy);
    expect(storage.getItem("sirkit:spice-studio:project:v1")!).toContain(OPENAI_KEY); // the store holds what was saved
    const loadedLegacy = loadStudioProject()!.aiAuditLog;
    expect(loadedLegacy).toHaveLength(1);
    expect(loadedLegacy[0]!.reason).toContain("[redacted]");
    expect(loadedLegacy[0]!.reason.length).toBeLessThanOrEqual(AI_AUDIT_LOG_BOUNDS.maxReasonChars);
    expect(loadedLegacy[0]!.changeSet).toEqual({ withheld: "change_set_too_large", operationCount: 200, digest: expect.stringMatching(/^eng1-[0-9a-f]{16}$/) });
    expect(loadedLegacy[0]!.evidence).toEqual([{ runId: "run-a", testId: "test", signal: "[redacted]", unit: expect.stringContaining("[redacted]") }]);
    for (const fragment of [OPENAI_KEY, ANTHROPIC_KEY, "eyJhbGciOiJIUzI1NiJ9", "0123456789abcdefghijklmnop", "x".repeat(80)]) expect(JSON.stringify(loadedLegacy)).not.toContain(fragment);
    expect(loadedLegacy[0]).toMatchObject({ id: "audit_legacy", actor: "ai", operation: "apply-ai-proposal", approval: "review", status: "applied" });
    const small = studioProject();
    small.aiAuditLog = [{ id: "audit_1", timestamp: T0, actor: "user", operation: "update-test", approval: "automatic", status: "applied", reason: "one" }];
    saveStudioProject(small);
    expect(loadStudioProject()!.aiAuditLog).toEqual(small.aiAuditLog);
    expect(boundAiAuditLog(small.aiAuditLog)).toEqual(small.aiAuditLog);
    expect(boundAiAuditLog([])).toEqual([]);
  });

  it("7. a change set over 16,000 characters is stored as { withheld: \"change_set_too_large\", operationCount, digest } (red at 4ec18eb); a smaller one keeps its shape with its string leaves redacted; `reason` is redacted and capped at 2,000 characters", () => {
    const project = studioProject();
    const testId = project.tests[0]!.id;
    const variable = (index: number, description: string) => ({ approval: "review" as const, operation: { op: "set-variable" as const, testId, variable: { id: `var_${index}`, name: `v${index}`, value: "1", unit: "V", enabled: true, description } } });
    const big = Array.from({ length: 200 }, (_, index) => variable(index, "x".repeat(40)));
    expect(JSON.stringify(big).length).toBeGreaterThan(AI_AUDIT_LOG_BOUNDS.maxChangeSetChars);
    const withheld = applyAiProposal(project, proposal({ operations: big }), big.map((_, index) => index), T0).aiAuditLog.at(-1)!;
    expect(withheld.changeSet).toEqual({ withheld: "change_set_too_large", operationCount: 200, digest: expect.stringMatching(/^eng1-[0-9a-f]{16}$/) });
    expect(JSON.stringify(withheld)).not.toContain("x".repeat(40));
    const secretOperations = [variable(900, `set from ${OPENAI_KEY}`)];
    const redacted = applyAiProposal(project, proposal({ operations: secretOperations, rationale: `because ${ANTHROPIC_KEY} and ${"r".repeat(3_000)}` }), [0], T0).aiAuditLog.at(-1)!;
    expect((redacted.changeSet as Array<{ operation: { op: string } }>).map((change) => change.operation.op)).toEqual(["set-variable"]);
    expect((redacted.changeSet as Array<{ operation: { variable: { description: string } } }>)[0]!.operation.variable.description).toBe("set from [redacted]");
    expect(JSON.stringify(redacted)).not.toContain(OPENAI_KEY);
    expect(redacted.reason).not.toContain(ANTHROPIC_KEY);
    expect(redacted.reason).toContain("[redacted]");
    expect(redacted.reason.length).toBeLessThanOrEqual(AI_AUDIT_LOG_BOUNDS.maxReasonChars);
    const edited = updateTest(project, project.tests[0]!.id, (draft) => { draft.name = "n"; }, `renamed; ${BEARER}`, T0).aiAuditLog.at(-1)!;
    expect(edited.reason).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(edited.reason).toContain("[redacted]");
    // design text in a change set survives the token-anchored rule
    const design = applyAiProposal(project, proposal({ operations: [variable(901, "the desk-lamp-controller supply rail")] }), [0], T0).aiAuditLog.at(-1)!;
    expect((design.changeSet as Array<{ operation: { variable: { description: string } } }>)[0]!.operation.variable.description).toBe("the desk-lamp-controller supply rail");
  });

  it("8. B22-C's case 2 fields hold: applyAiProposal writes every reference labelled caller-supplied, whatever the browser claimed, and changeSet[].operation.op reads as before", () => {
    const value = studioProject();
    const forged: EvidenceRef[] = [{ runId: "run-a", testId: "test", measurementId: "m", value: 1, unit: "V", provenance: "server-held" } as EvidenceRef, { runId: "run-a", testId: "test", signal: "v(out)" } as EvidenceRef];
    const next = applyAiProposal(value, proposal({ operations: [{ approval: "review", operation: { op: "request-run", runPlanId: value.runPlans[0]!.id } }, { approval: "explicit", operation: { op: "propose-design-patch", description: "raise R2", changes: [], evidence: forged } }], evidence: forged }), [0]);
    const entry = next.aiAuditLog.at(-1)!;
    expect((entry.evidence ?? []).map((ref) => ref.provenance)).toEqual(["caller-supplied", "caller-supplied"]);
    expect((entry.changeSet as Array<{ operation: { op: string } }>).map((change) => change.operation.op)).toEqual(["request-run"]);
    expect(JSON.stringify(entry)).not.toContain("server-held");
    expect(entry).toMatchObject({ actor: "ai", operation: "apply-ai-proposal", approval: "review", status: "applied", reason: "r" });
  });

  it("11. [B24-C2 review, 2026-10-09] the evidence references are redacted and bounded (red before the review round): a secret-shaped `signal` or `unit` is stored redacted with its provenance still caller-supplied, at most maxEvidenceRefs references are kept (the server's own cap) and the excess is counted in `evidenceWithheld`, absent when none", () => {
    const value = studioProject();
    const planted: EvidenceRef[] = [{ runId: "run-a", testId: "test", signal: OPENAI_KEY }, { runId: "run-a", testId: "test", measurementId: "m", value: 1, unit: BEARER }, { runId: "run-a", testId: "test", signal: "v(out)" }];
    const entry = applyAiProposal(value, proposal({ evidence: planted }), [], T0).aiAuditLog.at(-1)!;
    expect(entry.evidence).toEqual([
      { runId: "run-a", testId: "test", signal: "[redacted]", provenance: "caller-supplied" },
      { runId: "run-a", testId: "test", measurementId: "m", value: 1, unit: expect.stringContaining("[redacted]"), provenance: "caller-supplied" },
      { runId: "run-a", testId: "test", signal: "v(out)", provenance: "caller-supplied" },
    ]);
    for (const fragment of [OPENAI_KEY, "0123456789abcdefghijklmnop", "eyJhbGciOiJIUzI1NiJ9"]) expect(JSON.stringify(entry)).not.toContain(fragment);
    expect(entry.evidenceWithheld).toBeUndefined();
    const many = Array.from({ length: 10_000 }, (_, index): EvidenceRef => ({ runId: `run-${index}`, testId: "test", signal: `v(n${index})` }));
    const bounded = applyAiProposal(value, proposal({ evidence: many }), [], T0).aiAuditLog.at(-1)!;
    expect(bounded.evidence).toHaveLength(AI_AUDIT_LOG_BOUNDS.maxEvidenceRefs);
    expect(bounded.evidence![0]).toEqual({ runId: "run-0", testId: "test", signal: "v(n0)", provenance: "caller-supplied" });
    expect(bounded.evidence!.at(-1)).toMatchObject({ runId: `run-${AI_AUDIT_LOG_BOUNDS.maxEvidenceRefs - 1}` });
    expect(bounded.evidenceWithheld).toBe(10_000 - AI_AUDIT_LOG_BOUNDS.maxEvidenceRefs);
    expect(JSON.stringify(bounded).length).toBeLessThan(40_000);
    // the bound equals the server's: /api/spice/ai dedupes a proposal's references and keeps at most 200
    expect(AI_AUDIT_LOG_BOUNDS.maxEvidenceRefs).toBe(200);
    expect(read("app/api/spice/ai/route.ts")).toContain(".slice(0, 200)");
  });
});

// ── the provider error (errors.ts) ───────────────────────────────────────────────────────────────────────────────────────────────
describe("[B24-C2] the provider error's detail and log line are redacted (D24-25)", () => {
  it("9. `detail` and the console.error line are redacted (red at 4ec18eb): a provider message carrying a key reaches neither the 503 body nor the log; a plain message still reaches both as before (errors.test.ts:22 holds)", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const upstream = Object.assign(new Error(`invalid api key ${OPENAI_KEY} for ${BEARER}`), { status: 401, code: "invalid_api_key" });
    const response = providerErrorResponse(upstream, "openai");
    const body = (await response.json()) as Record<string, unknown>;
    expect(response.status).toBe(503);
    expect(body.reason).toBe("authentication");
    expect(String(body.detail)).not.toContain(OPENAI_KEY);
    expect(String(body.detail)).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(String(body.detail)).toContain("[redacted]");
    const logged = JSON.stringify(error.mock.calls);
    expect(logged).not.toContain(OPENAI_KEY);
    expect(logged).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(logged).toContain("[redacted]");
    const plain = providerErrorResponse(Object.assign(new Error("sensitive upstream detail"), { status: 429, code: "rate_limit_exceeded" }), "openai");
    expect(((await plain.json()) as Record<string, unknown>).detail).toBe("sensitive upstream detail");
  });

  it("10. a key straddling character 300 of a provider message is redacted whole (the redactor runs before the 297 + \"...\" cut), and a message over 300 characters still ends in \"...\" at 300 characters", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const filler = "provider said something long. ".repeat(12).slice(0, 290);
    const message = `${filler}${OPENAI_KEY} and more words follow here`;
    expect(message.indexOf(OPENAI_KEY)).toBeLessThan(300);
    expect(message.indexOf(OPENAI_KEY) + OPENAI_KEY.length).toBeGreaterThan(300);
    const body = (await providerErrorResponse(Object.assign(new Error(message), { status: 500 }), "anthropic").json()) as Record<string, unknown>;
    const detail = String(body.detail);
    for (const fragment of [OPENAI_KEY, OPENAI_KEY.slice(0, 8), "0123456789"]) expect(detail).not.toContain(fragment);
    expect(detail).toContain("[redact"); // the whole key became one token before the cut; the cut may fall inside that token, never inside the key
    expect(detail.endsWith("...")).toBe(true);
    expect(detail.length).toBe(300);
    const whole = (await providerErrorResponse(Object.assign(new Error(`${"p".repeat(200)} ${OPENAI_KEY} ${"q".repeat(200)}`), { status: 500 }), "anthropic").json()) as Record<string, unknown>;
    expect(String(whole.detail)).toContain("[redacted]"); // a key well inside the cut is one intact token
    expect(String(whole.detail)).not.toContain(OPENAI_KEY.slice(0, 8));
    const long = (await providerErrorResponse(Object.assign(new Error("x".repeat(400)), { status: 500 }), "openai").json()) as Record<string, unknown>;
    expect(String(long.detail)).toBe(`${"x".repeat(297)}...`);
    const errors = read("app/lib/llm/errors.ts");
    expect(errors).toContain("sanitizeTraceText(");
    expect(errors).toContain("Number.MAX_SAFE_INTEGER");
  });
});
