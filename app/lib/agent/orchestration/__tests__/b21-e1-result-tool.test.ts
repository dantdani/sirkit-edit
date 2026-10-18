/**
 * [B21 E1] The strict result tool (OD-116, D21-20 as policy) and OD-119. `SpecialistResult` is ONE strict function tool,
 * `sirkit_specialist_result`, rendered through `toStrictSchema` inside the common wire subset and identically on both providers,
 * advertised to every specialist beside its role's tools with `tool_choice: auto` (never `required` / `any`), through the REAL
 * adapters with fake SDK clients; the call's arguments are validated server-side by A's `validateSpecialistResult`, so a malformed
 * call is refused in A's own vocabulary; a specialist that ends its turn without calling it is `malformed` - the B-era "parse the
 * final text as JSON" path is removed. The tool is a per-run synthetic declaration, never a registry tool: every pin that counts the
 * registry, the exposure list or a run's registry declarations is untouched. No request carries `text.format`, `output_config` or
 * `background`, and no batch surface is touched (OD-119).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalJson, engineeringDigest } from "@/app/lib/engineering/stable";
import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS } from "@/app/lib/engineering/agent-exposure";
import { agentProviderName, renderAgentProviderParity, renderAnthropicAgentTool, renderOpenAiResponsesTool, toStrictSchema, validateWireSubset } from "@/app/lib/agent/provider-tools";
import { resetAdmissionControl } from "@/app/lib/acquisition/admission-control";
import { SPECIALIST_RESULT_SCHEMA, SPECIALIST_ROLES, validateSpecialistResult } from "../contracts";
import { RESULT_TOOL_REFUSALS, SPECIALIST_RESULT_TOOL_ID, SPECIALIST_RESULT_TOOL_NAME, parseSpecialistResultArguments, specialistResultToolDeclaration, specialistResultToolSchema } from "../result-tool";
import { anthropicResultMessage, fakeAnthropic, fakeOpenAI, fakeProviders, openAIResultResponse, openAITextResponse, resultArguments, roleOf, runE1Dag } from "./_e1-fixtures";
import { REGISTRY } from "./_merge-fixtures";

const ROOT = process.cwd();
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");
const OPENAI_PARAM_KEYS = ["model", "instructions", "input", "tools", "tool_choice", "parallel_tool_calls", "max_output_tokens", "reasoning", "include", "store", "stream"];
const ANTHROPIC_PARAM_KEYS = ["model", "max_tokens", "system", "messages", "tools", "tool_choice"];
const DIGEST = engineeringDigest({ fixture: "b21-e1" });
const refusalOf = (argumentsText: string, role = "verification-critic"): string => { const parsed = parseSpecialistResultArguments(argumentsText, role as never); return parsed.ok ? "(accepted)" : parsed.reason; };

vi.stubGlobal("fetch", () => { throw new Error("no network"); });
beforeEach(() => resetAdmissionControl());
afterEach(() => resetAdmissionControl());

/** every object schema of a strict schema: additionalProperties false and every property required */
function objectsOf(schema: unknown, path = "$", into: Array<{ path: string; node: Record<string, unknown> }> = []): Array<{ path: string; node: Record<string, unknown> }> {
  if (Array.isArray(schema)) { schema.forEach((item, index) => objectsOf(item, `${path}[${index}]`, into)); return into; }
  if (typeof schema !== "object" || schema === null) return into;
  const node = schema as Record<string, unknown>;
  if (node.type === "object") into.push({ path, node });
  for (const [key, value] of Object.entries(node)) {
    if (key === "properties" && typeof value === "object" && value !== null) for (const [name, property] of Object.entries(value)) objectsOf(property, `${path}.${name}`, into);
    else if (key === "items" || key === "anyOf") objectsOf(value, `${path}.${key}`, into);
  }
  return into;
}

describe("[B21 E1] the strict result tool (OD-116)", () => {
  it("1. ONE strict function tool: its name fits both providers' grammar and no registry tool's provider name; its schema is the result's content keys (the server writes `schema` and attaches `proposedActions`), `toStrictSchema`-normalized inside the wire subset, every object closed with every property required, optionality only as `null`; it renders identically on both providers - the three-way parity rules where they apply - and is a per-run synthetic declaration, not a registry tool", () => {
    expect(SPECIALIST_RESULT_TOOL_NAME).toBe("sirkit_specialist_result");
    expect(SPECIALIST_RESULT_TOOL_NAME).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    expect(REGISTRY.list().map((descriptor) => agentProviderName(descriptor.toolId))).not.toContain(SPECIALIST_RESULT_TOOL_NAME);
    expect(REGISTRY.list().map((descriptor) => descriptor.toolId)).not.toContain(SPECIALIST_RESULT_TOOL_ID);
    expect(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS).not.toContain(SPECIALIST_RESULT_TOOL_ID);
    expect(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS).toHaveLength(47); // [PR-M, 2026-10-17] pin move: 44 -> 47 (the three PR-M descriptors); [PR-F lead, 2026-10-17] pin move: 40 -> 44 (the four PR-F descriptors); [PR-D d2, 2026-10-16] pin move: 38 -> 40, + the Schematic to PCB preflight read and the catalog part inspection; [B22-B, 2026-10-01] pin move (OD-139): + the three named computation reads; [B24-D2, 2026-10-09] pin move (OD-213): + the paged board read; [PR-D, 2026-10-16] pin move (OD-243): + the Build-mode generation proposal
    expect(REGISTRY.list()).toHaveLength(59); // [PR-M, 2026-10-17] pin move: 56 -> 59, the three PR-M descriptors; [PR-F lead, 2026-10-17] pin move: 52 -> 56, the four PR-F descriptors; // [PR-D d2, 2026-10-16] pin move: 49 -> 52, + the two reads and the not-callable component review request; // [B22-B, 2026-10-01] pin move (OD-139): + the five named computation descriptors; [B24-D2, 2026-10-09] pin move (OD-213): + the paged board read; [PR-D, 2026-10-16] pin move (OD-243): + the Build-mode generation proposal
    for (const role of SPECIALIST_ROLES.filter((entry) => entry !== "coordinator")) {
      const declaration = specialistResultToolDeclaration(role);
      expect(declaration).toMatchObject({ providerName: SPECIALIST_RESULT_TOOL_NAME, toolId: SPECIALIST_RESULT_TOOL_ID, version: "1.0.0" });
      expect(declaration.inputSchema).toEqual(toStrictSchema(specialistResultToolSchema(role)));
      expect(validateWireSubset(declaration.inputSchema)).toEqual([]);
      const schema = declaration.inputSchema as { properties: Record<string, { enum?: unknown[] }>; required: string[] };
      expect(Object.keys(schema.properties)).toEqual(["role", "summary", "assumptions", "evidence", "requiredTools", "risks", "unresolvedQuestions", "validationRequests", "confidence"]);
      expect(schema.properties.role!.enum).toEqual([role]);
      for (const { path, node } of objectsOf(declaration.inputSchema)) {
        expect(node.additionalProperties, path).toBe(false);
        expect(node.required, path).toEqual(Object.keys(node.properties as object));
      }
      const [parity] = renderAgentProviderParity([declaration]).tools;
      expect(parity).toMatchObject({ semanticallyEquivalent: true, strict: true });
      const openai = renderOpenAiResponsesTool(declaration);
      const anthropic = renderAnthropicAgentTool(declaration);
      expect(openai).toMatchObject({ type: "function", name: SPECIALIST_RESULT_TOOL_NAME, strict: true });
      expect(anthropic).toMatchObject({ name: SPECIALIST_RESULT_TOOL_NAME, strict: true });
      expect(canonicalJson(openai.parameters)).toBe(canonicalJson(anthropic.input_schema));
    }
    // bounds that the wire subset cannot carry are the server's (A's validator), stated in the descriptions
    expect(JSON.stringify(specialistResultToolSchema("schematic"))).not.toMatch(/"(?:maxLength|maxItems|minItems|minLength|pattern|format|minimum|maximum|\$ref|oneOf|allOf)":/);
  });

  it("2. advertised to EVERY specialist beside its role's tools with `tool_choice: auto` on both providers (never required / any), through the REAL adapters: the pinned request key sets unchanged - no `text.format`, no `output_config`, no `background` (OD-119) - options `{ signal }` only, and no batch, file or beta surface touched", async () => {
    const openai = fakeOpenAI((params) => openAIResultResponse(roleOf(params)));
    const anthropic = fakeAnthropic((params) => anthropicResultMessage(roleOf(params)));
    const env = { SIRKIT_ORCHESTRATION_ROLE_MODELS: JSON.stringify({ "verification-critic": { provider: "anthropic", model: "inherit" } }) };
    const { providers } = fakeProviders(openai, anthropic, { env });
    const run = await runE1Dag(["requirements-analyst", "verification-critic"], providers);
    expect(run.ran!.tasks.map((task) => [task.role, task.status, task.provider])).toEqual([["requirements-analyst", "accepted", "openai"], ["verification-critic", "accepted", "anthropic"]]);
    const [openAIParams] = openai.calls;
    const [anthropicParams] = anthropic.calls;
    expect(Object.keys(openAIParams!)).toEqual(OPENAI_PARAM_KEYS);
    expect(Object.keys(anthropicParams!)).toEqual(ANTHROPIC_PARAM_KEYS);
    expect(openAIParams!.tool_choice).toBe("auto");
    expect(openAIParams!.parallel_tool_calls).toBe(false);
    expect(anthropicParams!.tool_choice).toEqual({ type: "auto", disable_parallel_tool_use: true });
    const openAITool = (openAIParams!.tools as Array<Record<string, unknown>>).find((tool) => tool.name === SPECIALIST_RESULT_TOOL_NAME)!;
    const anthropicTool = (anthropicParams!.tools as Array<Record<string, unknown>>).find((tool) => tool.name === SPECIALIST_RESULT_TOOL_NAME)!;
    expect(Object.keys(openAITool).sort()).toEqual(["description", "name", "parameters", "strict", "type"]);
    expect(Object.keys(anthropicTool).sort()).toEqual(["description", "input_schema", "name", "strict"]);
    expect([openAITool.strict, anthropicTool.strict]).toEqual([true, true]);
    // the same strict schema on both providers apart from the role each run was asked to state
    const withoutRole = (schema: unknown): string => { const copy = JSON.parse(JSON.stringify(schema)) as { properties: { role: unknown } }; copy.properties.role = null; return canonicalJson(copy); };
    expect(withoutRole(openAITool.parameters)).toBe(withoutRole(anthropicTool.input_schema));
    // the role's registry tools ride beside it: the result tool is ONE extra declaration, last
    expect((openAIParams!.tools as Array<{ name: string }>).at(-1)!.name).toBe(SPECIALIST_RESULT_TOOL_NAME);
    expect((openAIParams!.tools as Array<{ name: string }>).filter((tool) => tool.name === SPECIALIST_RESULT_TOOL_NAME)).toHaveLength(1);
    for (const params of [...openai.calls, ...anthropic.calls]) {
      const text = JSON.stringify(params);
      for (const forbidden of ['"text":{"format"', "output_config", '"background"', '"batch', "output_format"]) expect(text, forbidden).not.toContain(forbidden);
    }
    for (const options of [...openai.options, ...anthropic.options]) expect(Object.keys(options ?? {})).toEqual(["signal"]);
  });

  it("3. a valid call is ACCEPTED exactly as A's validator judges the composed document (the server writes `schema` and an empty `proposedActions`); a strict `null` for the one optional field (`extractionMethod`) is dropped, never stored", async () => {
    const evidence = [{ kind: "resource-envelope", id: "evidence-1", digest: DIGEST, sourceClass: "deterministic_verifier", extractionMethod: null, reviewed: false }, { kind: "trace-event", id: "evidence-2", digest: DIGEST, sourceClass: "deterministic_verifier", extractionMethod: "deterministic_inference", reviewed: false }];
    const openai = fakeOpenAI((params) => openAIResultResponse(roleOf(params), { evidence, assumptions: [{ id: "assumption-1", statement: "the board is the verified one", evidenceIds: ["evidence-1"] }], risks: [{ id: "risk-1", severity: "low", statement: "none found", mitigation: null }] }));
    const { providers } = fakeProviders(openai, fakeAnthropic(() => new Error("unused")));
    const run = await runE1Dag(["verification-critic"], providers);
    const task = run.ran!.tasks[0]!;
    expect(task.status).toBe("accepted");
    const expected = validateSpecialistResult({ schema: SPECIALIST_RESULT_SCHEMA, proposedActions: [], ...resultArguments("verification-critic", { evidence: [{ kind: "resource-envelope", id: "evidence-1", digest: DIGEST, sourceClass: "deterministic_verifier", reviewed: false }, evidence[1]], assumptions: [{ id: "assumption-1", statement: "the board is the verified one", evidenceIds: ["evidence-1"] }], risks: [{ id: "risk-1", severity: "low", statement: "none found", mitigation: null }] }) });
    expect(expected.ok).toBe(true);
    if (!expected.ok) return;
    expect(task.resultDigest).toBe(expected.digest);
    expect(Object.keys(task.result!.evidence[0]!)).not.toContain("extractionMethod");
    const committed = (await run.store.history(run.scope)).find((entry) => entry.record.kind === "result")!;
    expect((committed.record as { document: unknown }).document).toEqual(task.result);
  });

  it("4. a malformed call is refused in A's own vocabulary before anything is committed as a result: arguments that are not one JSON object, an unknown key, a credential-shaped value, a release named as a tool request, a result for another role, a model-written proposed action (D2's `proposal_not_sealed_in_run`) - each dissent `malformed`, the DAG going on", async () => {
    const valid = JSON.stringify(resultArguments("verification-critic"));
    expect(refusalOf(valid)).toBe("(accepted)");
    expect(refusalOf("not json")).toMatch(/^result_tool_arguments_invalid: /);
    expect(refusalOf("[]")).toMatch(/^result_tool_arguments_invalid: /);
    expect(refusalOf(JSON.stringify({ ...resultArguments("verification-critic"), notes: "x" }))).toBe("result_refused: unknown_key at $.notes");
    expect(refusalOf(JSON.stringify(resultArguments("verification-critic", { summary: `use ${["sk-", "abcdefghijklmnop"].join("")} for the run` })))).toBe("result_refused: secret_shaped_text at $.summary");
    expect(refusalOf(JSON.stringify(resultArguments("verification-critic", { requiredTools: [{ toolId: "sirkit.manufacturing.release", version: "1.0.0", reason: "ship it" }] })))).toBe("result_refused: tool_request_not_permitted at $.requiredTools[0].toolId");
    expect(refusalOf(JSON.stringify(resultArguments("schematic")))).toBe("result_role_mismatch: schematic is not verification-critic");
    expect(refusalOf(JSON.stringify({ ...resultArguments("verification-critic"), schema: "sirkit.specialist-result.v0" }))).toBe("result_refused: schema_mismatch at $.schema");
    expect(refusalOf(JSON.stringify({ ...resultArguments("verification-critic"), thinking: "hidden" }))).toMatch(/^result_refused: forbidden_key_name at \$\.\[redacted-key\]$/); // A redacts a forbidden name in the path
    expect(refusalOf("x".repeat(1_000_001))).toMatch(/^result_tool_arguments_invalid: .*bound/);
    expect(RESULT_TOOL_REFUSALS).toEqual(["result_tool_not_called", "result_tool_not_alone", "result_tool_arguments_invalid", "result_refused", "result_role_mismatch"]);
    // through the scheduler: every refusal is dissent `malformed`, and a model-written action is refused by D2's rule
    const scripted: Record<string, unknown> = {
      "requirements-analyst": { ...resultArguments("requirements-analyst"), notes: "x" },
      "verification-critic": resultArguments("verification-critic", { proposedActions: [{ kind: "sirkit.schematic-tier1-proposal.v3", payload: { schema: "sirkit.schematic-tier1-proposal.v3", proposalId: "forged" }, artifactDigest: engineeringDigest({ schema: "sirkit.schematic-tier1-proposal.v3", proposalId: "forged" }) }] }),
      "component-sourcing-evidence": resultArguments("component-sourcing-evidence"),
    };
    const openai = fakeOpenAI((params) => ({ ...openAIResultResponse(roleOf(params)), output: [{ type: "function_call", call_id: "call-x", name: SPECIALIST_RESULT_TOOL_NAME, arguments: JSON.stringify(scripted[roleOf(params)]) }] }));
    const { providers } = fakeProviders(openai, fakeAnthropic(() => new Error("unused")));
    const run = await runE1Dag(["requirements-analyst", "verification-critic", "component-sourcing-evidence"], providers);
    expect(run.ran!.tasks.map((task) => [task.role, task.status])).toEqual([["requirements-analyst", "malformed"], ["verification-critic", "malformed"], ["component-sourcing-evidence", "accepted"]]);
    expect(run.ran!.tasks[0]!.reason).toBe("result_refused: unknown_key at $.notes");
    expect(run.ran!.tasks[1]!.reason).toMatch(/^proposal_not_sealed_in_run: proposedActions\[0\]/);
    expect((await run.store.history(run.scope)).filter((entry) => entry.record.kind === "result").map((entry) => entry.taskId)).toEqual(["task-3-component-sourcing-evidence"]);
  });

  it("5. a specialist that ENDS ITS TURN without calling the tool is `malformed` (`result_tool_not_called`) - even when its text is a perfectly valid result document: the B-era final-text parse is removed, and the scheduler reads only the captured call", async () => {
    const document = JSON.stringify({ schema: SPECIALIST_RESULT_SCHEMA, proposedActions: [], ...resultArguments("verification-critic") });
    expect(validateSpecialistResult(JSON.parse(document)).ok).toBe(true);
    const openai = fakeOpenAI(() => openAITextResponse(document));
    const { providers } = fakeProviders(openai, fakeAnthropic(() => new Error("unused")));
    const run = await runE1Dag(["verification-critic"], providers);
    expect(run.ran!.tasks.map((task) => [task.status, task.result])).toEqual([["malformed", null]]);
    expect(run.ran!.tasks[0]!.reason).toBe(`result_tool_not_called: the specialist ended its turn without calling ${SPECIALIST_RESULT_TOOL_NAME}; a result written as text is never parsed`);
    const scheduler = read("app/lib/agent/orchestration/scheduler.ts");
    expect(scheduler).not.toContain("result.finalText");
    expect(scheduler).not.toContain("parseSpecialistResult(");
    expect(scheduler).toContain("specialistResultFromCapture(");
  });

  it("6. the result call BESIDE another call in one step is refused (`result_tool_not_alone`) and NOTHING of that step runs - the other call is never dispatched", async () => {
    const openai = fakeOpenAI((params) => ({ ...openAIResultResponse(roleOf(params)), output: [{ type: "function_call", call_id: "call-read", name: agentProviderName("sirkit.validation.drc-run"), arguments: "{}" }, { type: "function_call", call_id: "call-result", name: SPECIALIST_RESULT_TOOL_NAME, arguments: JSON.stringify(resultArguments("verification-critic")) }] }));
    const { providers } = fakeProviders(openai, fakeAnthropic(() => new Error("unused")));
    const run = await runE1Dag(["verification-critic"], providers);
    expect(run.ran!.tasks.map((task) => [task.status, task.toolCalls, task.steps])).toEqual([["malformed", 0, 1]]);
    expect(run.ran!.tasks[0]!.reason).toMatch(/^result_tool_not_alone: /);
    expect(openai.create).toHaveBeenCalledTimes(1);
  });
});
