/**
 * [B22-C] SPICE AI evidence (discovery D22-21; 9.5 item 31; OD-150, the evidence half; global :138 "never accept browser-authored
 * or model-authored state as canonical"). `read_results`, `diagnose_failure` and `compare_runs` built `EvidenceRef` objects from the
 * run records the browser sends (`body.runs`), with no digest or server lookup; `propose_design_patch` attached them to a proposal,
 * every submitted proposal carried them, `applyAiProposal` wrote them to `aiAuditLog`, and the studio labelled them "evidence-bound"
 * and "internal evidence reference(s)". No server-held record backs them in B22-C (the evidence aggregate is not bound to this
 * route), so every reference now carries the closed label `caller-supplied` wherever it appears: in the tool results the model
 * reads, in the proposal and its design-patch operation, in the audit log (whatever label a browser-held proposal claims), and in
 * the studio, beside the disclosure "caller-supplied records, not verified by Sirkit".
 *
 * Test-first: cases 1-4 ran RED on b4c7be7 ([B22-C review] coverage-8: corrected from 1-3; the re-run after case 2's test error,
 * `c-red-pre-edit-ai2`, failed 4 of 4). The LLM router is a scripted fake (zero credits); no process, no network.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const generate = vi.hoisted(() => vi.fn());
vi.mock("@/app/lib/llm/router", () => ({ llmRouter: { generate } }));

import { injectAuthorizedPrincipal, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { applyAiProposal, createSimulationProject } from "@/app/lib/spice/project";
import { dividerSchematic } from "@/app/lib/spice/__tests__/fixtures";
import type { AiStudioProposal, EvidenceRef, RunRecord } from "@/app/lib/spice/types";
import { POST as aiPost } from "@/app/api/spice/ai/route";

const read = (path: string): string => readFileSync(join(process.cwd(), path), "utf8");
afterEach(() => {
  resetInjectedIdentity();
  generate.mockReset();
});
function project() {
  const value = createSimulationProject(dividerSchematic());
  value.tests[0]!.analyses = [{ id: "op", name: "Operating point", type: "op", enabled: true }];
  return value;
}
/** A run record as a browser sends it - including a forged claim that it is server-held. */
function browserRun(id: string, value: number): RunRecord {
  return {
    id, projectId: "p", runPlanId: "plan", testId: "test", status: "completed", progress: 100, label: id,
    waveforms: [{ id: `${id}-w`, name: "v(out)", unit: "V", xName: "time", xUnit: "s", x: [0, 1], y: [0, value], sourceRefs: [] }],
    scalars: [{ id: `${id}-s`, runId: id, measurementId: "m-vout", name: "VOUT", value, unit: "V", status: "pass" }],
    diagnostics: [{ id: `${id}-d`, code: "unknown", severity: "warning", title: "t", summary: "s", sourceRefs: [], suggestions: [] }],
    events: [], stdout: "", stderr: "", createdAt: "2026-10-02T00:00:00.000Z",
    evidence: { provenance: "server-held" },
  } as unknown as RunRecord;
}
const call = (id: string, name: string, input: unknown) => ({ id, name, input });
const reply = (toolCalls: Array<{ id: string; name: string; input: unknown }>) => ({ provider: "openai", model: "test-model", text: "", toolCalls });

describe("[B22-C] SPICE AI evidence is labelled caller-supplied wherever it appears (D22-21, OD-150 evidence half)", () => {
  it("1. every reference read_results, diagnose_failure and compare_runs build from body.runs - in the proposal and in its design patch - carries provenance caller-supplied, and the tool results the model reads say so (a forged server-held claim is ignored)", async () => {
    injectAuthorizedPrincipal({ userId: "u1", tenantId: "local", projectId: "proj-1", role: "editor" });
    generate
      .mockResolvedValueOnce(reply([call("t1", "read_results", { run_id: "run-a" })]))
      .mockResolvedValueOnce(reply([call("t2", "diagnose_failure", { run_id: "run-a" })]))
      .mockResolvedValueOnce(reply([call("t3", "compare_runs", { run_a: "run-a", run_b: "run-b" })]))
      .mockResolvedValueOnce(reply([call("t4", "propose_design_patch", { description: "raise R2", changes: [] })]))
      .mockResolvedValueOnce(reply([call("t5", "submit_proposal", { summary: "s", rationale: "r", confidence: 0.5, assumptions: [] })]));
    const value = project();
    const response = await aiPost(new Request("http://localhost/api/spice/ai", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", "x-sirkit-tenant-id": "local", "x-sirkit-project-id": "proj-1", "x-sirkit-branch-id": "main" }, body: JSON.stringify({ instruction: "why is VOUT low", project: value, testId: value.tests[0]!.id, runs: [browserRun("run-a", 1), browserRun("run-b", 2)] }) }));
    expect(response.status).toBe(200);
    const proposal = ((await response.json()) as { proposal: AiStudioProposal }).proposal;
    expect(proposal.evidence.length).toBeGreaterThan(0);
    expect(proposal.evidence.every((ref) => ref.provenance === "caller-supplied")).toBe(true);
    expect(new Set(proposal.evidence.map((ref) => ref.runId))).toEqual(new Set(["run-a", "run-b"]));
    expect(proposal.evidence.some((ref) => ref.diagnosticId === "run-a-d")).toBe(true);
    const patch = proposal.operations.find((entry) => entry.operation.op === "propose-design-patch")!.operation as { evidence: EvidenceRef[] };
    expect(patch.evidence.length).toBeGreaterThan(0);
    expect(patch.evidence.every((ref) => ref.provenance === "caller-supplied")).toBe(true);
    // what the model read back: every evidence-reading tool result names its source
    const messages = (generate.mock.calls.at(-1)![0] as { messages: Array<{ role: string; content: unknown }> }).messages;
    const outputs = new Map(messages.flatMap((message) => (Array.isArray(message.content) ? message.content as Array<{ type?: string; toolCallId?: string; output?: string }> : [])).filter((part) => part.type === "tool_result").map((part) => [part.toolCallId, part.output ?? ""]));
    for (const id of ["t1", "t2", "t3"]) expect(JSON.parse(outputs.get(id)!) as Record<string, unknown>, id).toMatchObject({ provenance: "caller-supplied" });
    expect(JSON.stringify(proposal)).not.toContain("server-held");
  });

  it("2. applyAiProposal writes every reference to aiAuditLog labelled caller-supplied, whatever a browser-held proposal claims; a design patch never enters the change set (it needs an explicit editor confirmation)", () => {
    const value = project();
    const forged: EvidenceRef[] = [{ runId: "run-a", testId: "test", measurementId: "m", value: 1, unit: "V", provenance: "server-held" }, { runId: "run-a", testId: "test", signal: "v(out)" }];
    const proposal: AiStudioProposal = { id: "aiprop-b22c", summary: "s", rationale: "r", confidence: 0.5, assumptions: [], operations: [{ approval: "review", operation: { op: "request-run", runPlanId: value.runPlans[0]!.id } }, { approval: "explicit", operation: { op: "propose-design-patch", description: "raise R2", changes: [], evidence: forged } }], evidence: forged, createdAt: "2026-10-02T00:00:00.000Z" };
    const next = applyAiProposal(value, proposal, [0]);
    const entry = next.aiAuditLog.at(-1)!;
    expect((entry.evidence ?? []).map((ref) => ref.provenance)).toEqual(["caller-supplied", "caller-supplied"]);
    expect((entry.changeSet as Array<{ operation: { op: string } }>).map((change) => change.operation.op)).toEqual(["request-run"]);
    expect(JSON.stringify(entry)).not.toContain("server-held");
    expect(() => applyAiProposal(value, proposal, [1])).toThrow("Design patches require explicit schematic-editor confirmation");
  });

  it("3. the studio's AI drawer says caller-supplied, never evidence-bound or internal, and shows the disclosure", () => {
    const studio = read("app/components/spice/SpiceStudio.tsx");
    expect(studio).not.toContain("evidence-bound");
    expect(studio).not.toContain("internal evidence reference(s)");
    expect(studio).toContain("Typed tools · caller-supplied evidence · reviewable");
    expect(studio).toContain("caller-supplied evidence reference(s) attached");
    expect(studio).toContain("{CALLER_SUPPLIED_RECORDS_DISCLOSURE}");
  });

  it("4. the route never writes a server-held label: the closed label is the route's one value, and the type names both states", () => {
    const route = read("app/api/spice/ai/route.ts");
    expect(route).not.toContain("server-held");
    expect((route.match(/provenance: CALLER_SUPPLIED_EVIDENCE/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(read("app/lib/spice/types.ts")).toMatch(/provenance\?: "caller-supplied" \| "server-held";/);
  });
});
