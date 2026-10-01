/**
 * [B21 E1] The compatible fallback, both ways (OD-117, runbook B21-E "compatible fallback only when schemas and task requirements
 * match"). A specialist whose role's provider is PAUSED by the breaker runs on the other provider ONLY when every declaration it would
 * be offered - its role's tools and the strict result tool - renders identically through the two `provider-tools.ts` renderers (the
 * parity check the three-way parity gate uses) inside the wire subset, and the other provider's model is qualified and not paused;
 * otherwise its task is dissent `escalated` with `provider_unavailable` and no call is made. Degraded mode is visible (one line per
 * fallback). The coordinator never switches provider: when ITS provider is paused the DAG stops before any specialist. The Anthropic
 * renderer is wrapped here so a divergence can be injected - the REAL adapters render through the same wrapped module.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const divergence = vi.hoisted(() => ({ on: false }));
vi.mock("@/app/lib/agent/provider-tools", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/app/lib/agent/provider-tools")>();
  return {
    ...original,
    // a renderer drift: Anthropic would be sent a different description than OpenAI for the same declaration
    renderAnthropicAgentTool: (declaration: Parameters<typeof original.renderAnthropicAgentTool>[0]) => (divergence.on ? { ...original.renderAnthropicAgentTool(declaration), description: `${declaration.description} (drifted)` } : original.renderAnthropicAgentTool(declaration)),
  };
});

import { buildRunToolset } from "@/app/lib/agent/loop";
import type { ProviderToolDeclaration } from "@/app/lib/agent/contracts";
import { LLM_PROVIDER_ADMISSION, requestLlmProviderAdmission, resetAdmissionControl } from "@/app/lib/acquisition/admission-control";
import { ROLE_MODELS_ENV, fallbackCompatibility } from "../provider-policy";
import { specialistResultToolDeclaration } from "../result-tool";
import { specialistContextFor, specialistToolRegistry, specialistAllowedToolIds } from "../scheduler";
import { agentProviderName } from "@/app/lib/agent/provider-tools";
import { anthropicResultMessage, answersAnthropic, answersOpenAI, failOnce, fakeAnthropic, fakeOpenAI, fakeProviders, openAIResultResponse, roleOf, runE1Dag } from "./_e1-fixtures";
import { PCB_EDIT_ARGS, TIER1_ARGS } from "./_d2-fixtures";
import { REGISTRY, coordinatorContext } from "./_merge-fixtures";

const T0 = Date.parse("2026-09-27T12:00:00.000Z");
const ENV = { [ROLE_MODELS_ENV]: JSON.stringify({ "verification-critic": { provider: "anthropic", model: "claude-sonnet-4-5" } }) };

vi.stubGlobal("fetch", () => { throw new Error("no network"); });
beforeEach(() => { resetAdmissionControl(); divergence.on = false; });
afterEach(() => { resetAdmissionControl(); divergence.on = false; });

/** the declarations the critic's run would be offered: its role's effective set and the strict result tool */
function criticDeclarations(): { role: ProviderToolDeclaration[]; result: ProviderToolDeclaration } {
  const context = specialistContextFor(coordinatorContext(), "verification-critic");
  const allowed = specialistAllowedToolIds(REGISTRY, context, buildRunToolset, "verification-critic");
  return { role: [...buildRunToolset(specialistToolRegistry(REGISTRY, "verification-critic"), context, () => undefined, allowed).declarations], result: specialistResultToolDeclaration("verification-critic") };
}

describe("[B21 E1] the compatible fallback (OD-117)", () => {
  it("1. the rule itself: the critic's real declarations and its result tool render identically on both providers inside the wire subset (compatible); a declaration outside the wire subset, or a renderer that drifts, is incompatible with a stated reason", () => {
    const { role, result } = criticDeclarations();
    expect(role.length).toBeGreaterThan(0);
    expect(fallbackCompatibility(role, result)).toEqual({ compatible: true });
    const nonWire: ProviderToolDeclaration = { ...role[0]!, inputSchema: { type: "object", properties: { q: { type: "string", maxLength: 10 } }, required: ["q"], additionalProperties: false } };
    expect(fallbackCompatibility([nonWire], result)).toMatchObject({ compatible: false, detail: expect.stringMatching(/outside the wire subset/) });
    divergence.on = true;
    expect(fallbackCompatibility(role, result)).toMatchObject({ compatible: false, detail: expect.stringMatching(/do not render identically/) });
  });

  it("2. compatible: the critic's provider (anthropic, by server override) is paused - it runs on the coordinator's provider with that provider's configured model, under ONE visible fallback line; the outcome records where it ran and where it was routed from; no call reaches the paused provider", async () => {
    await failOnce("anthropic", "insufficient_quota", T0);
    const openai = fakeOpenAI(answersOpenAI);
    const anthropic = fakeAnthropic(answersAnthropic);
    const { providers, built } = fakeProviders(openai, anthropic, { env: ENV });
    const run = await runE1Dag(["requirements-analyst", "verification-critic"], providers, { now: () => T0 + 1 });
    expect(run.ran!.tasks.map((task) => [task.role, task.status, task.provider, task.route?.provider, task.route?.fallbackFrom?.provider ?? null])).toEqual([["requirements-analyst", "accepted", "openai", "openai", null], ["verification-critic", "accepted", "openai", "openai", "anthropic"]]);
    expect(run.ran!.tasks[1]!.route).toMatchObject({ model: "gpt-5.6-sol", source: "env", fallbackFrom: { provider: "anthropic", model: "claude-sonnet-4-5" } });
    expect(anthropic.create).not.toHaveBeenCalled();
    expect(openai.calls.map(roleOf)).toEqual(["requirements-analyst", "verification-critic"]);
    expect(built.map((route) => [route.role, route.provider])).toEqual([["requirements-analyst", "openai"], ["verification-critic", "openai"]]);
    expect(run.warnings.filter((line) => line.includes("compatible fallback"))).toEqual([expect.stringMatching(/^Orchestration: specialist verification-critic \(task task-2-verification-critic\) runs on openai \(gpt-5\.6-sol\) instead of anthropic \(claude-sonnet-4-5\) - LLM provider "anthropic" is paused \(insufficient_quota\) until 2026-09-27T13:00:00\.000Z or until an operator resets it; no call is made to it before then \(OD-115\)\. Its tools and its result tool render identically on both providers: a compatible fallback, degraded and never silent\.$/)]);
  });

  it("3. incompatible: the same pause with a renderer that drifts - the critic's task is dissent `escalated` `provider_unavailable` with both reasons, NO call on either provider for it, and the DAG goes on", async () => {
    await failOnce("anthropic", "insufficient_quota", T0);
    divergence.on = true;
    const openai = fakeOpenAI(answersOpenAI);
    const anthropic = fakeAnthropic(answersAnthropic);
    const { providers } = fakeProviders(openai, anthropic, { env: ENV });
    const run = await runE1Dag(["verification-critic", "requirements-analyst"], providers, { now: () => T0 + 1 });
    expect(run.ran!.stop).toBe("completed");
    expect(run.ran!.tasks.map((task) => [task.role, task.status, task.provider, task.model])).toEqual([["verification-critic", "escalated", "anthropic", null], ["requirements-analyst", "accepted", "openai", "gpt-fake"]]);
    expect(run.ran!.tasks[0]!.reason).toMatch(/^provider_unavailable: LLM provider "anthropic" is paused \(insufficient_quota\)[\s\S]*No compatible fallback: [\s\S]*do not render identically/);
    expect(anthropic.create).not.toHaveBeenCalled();
    expect(openai.calls.map(roleOf)).toEqual(["requirements-analyst"]);
    expect((await run.store.history(run.scope)).filter((entry) => entry.taskId === "task-1-verification-critic").map((entry) => entry.record.kind)).toEqual(["dissent"]);
  });

  it("4. no fallback that would be the coordinator switching: with two providers a role's fallback IS the coordinator's provider, so when that one is paused the DAG stops before any specialist - whichever provider the coordinator runs on, no call on either; a failure count below the threshold is no pause; an unqualified route is a policy refusal, never an outage - no fallback, no call; a WINDOW pause (the agent's share of the minute used up) is no outage either - `provider_unavailable`, no fallback, no call", async () => {
    await failOnce("anthropic", "insufficient_quota", T0);
    await failOnce("openai", "rate_limit", T0);
    const openai = fakeOpenAI((params) => openAIResultResponse(roleOf(params)));
    const anthropic = fakeAnthropic((params) => anthropicResultMessage(roleOf(params)));
    const { providers } = fakeProviders(openai, anthropic, { env: ENV });
    // the coordinator on ANTHROPIC (paused): the DAG stops before the critic, never runs it on openai in the coordinator's place
    const both = await runE1Dag(["verification-critic"], providers, { now: () => T0 + 1, provider: "anthropic" });
    expect(both.ran!.stop).toBe("provider_paused"); // [B21 E1 fix: regressions-3] paused by the meters before any call: no call failed
    expect(both.ran!.tasks).toEqual([]); // anthropic is the coordinator's provider: the DAG stops before the critic
    const coordinatorPaused = await runE1Dag(["requirements-analyst"], providers, { now: () => T0 + 1, runId: "run-b21e1-coordinator-paused" });
    expect(coordinatorPaused.ran!.stop).toBe("provider_paused"); // openai (the coordinator's) is rate-limited: nothing runs, no fallback
    expect(coordinatorPaused.ran!.notStarted.map((task) => task.role)).toEqual(["requirements-analyst"]);
    resetAdmissionControl();
    await failOnce("anthropic", "insufficient_quota", T0);
    const routedEnv = { [ROLE_MODELS_ENV]: JSON.stringify({ "verification-critic": { provider: "anthropic", model: "claude-sonnet-4-5" }, "requirements-analyst": { provider: "anthropic", model: "inherit" } }) };
    const { providers: routed } = fakeProviders(openai, anthropic, { env: routedEnv });
    await failOnce("openai", "network", T0); // one transient failure: not enough to pause openai
    const run = await runE1Dag(["verification-critic"], routed, { now: () => T0 + 1, runId: "run-b21e1-fallback-ok" });
    expect(run.ran!.tasks.map((task) => [task.status, task.provider])).toEqual([["accepted", "openai"]]);
    const unqualified = { [ROLE_MODELS_ENV]: JSON.stringify({ "verification-critic": { provider: "anthropic", model: "claude-opus-5-5" } }) };
    const { providers: refusedPolicy } = fakeProviders(openai, anthropic, { env: unqualified });
    const refused = await runE1Dag(["verification-critic"], refusedPolicy, { now: () => T0 + 1, runId: "run-b21e1-unqualified" });
    expect(refused.ran!.tasks.map((task) => [task.status, task.provider])).toEqual([["escalated", "anthropic"]]);
    expect(refused.ran!.tasks[0]!.reason).toMatch(/^model_unqualified: /);
    expect(anthropic.create).not.toHaveBeenCalled();
    // a WINDOW pause: the agent's share of anthropic's minute used up - the provider is not out, so the critic never falls back
    resetAdmissionControl();
    const share = Math.floor(LLM_PROVIDER_ADMISSION.requestsPerMinute / 4);
    for (let index = 0; index < share; index += 1) requestLlmProviderAdmission({ kind: "llm-provider", provider: "anthropic" }, T0, "agent");
    const openAICalls = openai.create.mock.calls.length;
    const windowed = await runE1Dag(["verification-critic"], fakeProviders(openai, anthropic, { env: ENV }).providers, { now: () => T0 + 1, runId: "run-b21e1-window" });
    expect(windowed.ran!.tasks.map((task) => [task.status, task.provider])).toEqual([["escalated", "anthropic"]]);
    expect(windowed.ran!.tasks[0]!.reason).toMatch(/^provider_unavailable: LLM provider "anthropic" is paused for the agent: [\s\S]*No fallback: a window pause is no outage/);
    expect(openai.create.mock.calls.length).toBe(openAICalls);
    expect(anthropic.create).not.toHaveBeenCalled();
    expect(LLM_PROVIDER_ADMISSION.quotaOpenMs).toBe(3_600_000);
  });

  it("5. [B21 E1 fix: regressions-2, security-1] a proposing specialist SEALS under the provider it actually ran on: routed to anthropic by the server env while the coordinator runs on openai, its Tier 1 and PCB proposals' sealed provenance (and the PCB actor) name anthropic - the provider its outcome and its route name, which the merge reads; a compatible fallback seals under the provider it fell back to", async () => {
    const tier1 = agentProviderName("sirkit.schematic.propose-tier1-edit");
    const pcb = agentProviderName("sirkit.pcb.propose-bounded-edit");
    const usage = { input_tokens: 5, output_tokens: 7 };
    const turns = new Map<string, number>();
    const firstTurn = (role: string): boolean => { const turn = turns.get(role) ?? 0; turns.set(role, turn + 1); return turn === 0; };
    const anthropic = fakeAnthropic((params) => {
      const role = roleOf(params);
      if (!firstTurn(role)) return anthropicResultMessage(role);
      if (role === "circuit-topology") return { content: [{ type: "tool_use", id: "toolu_tier1", name: tier1, input: TIER1_ARGS("10k") }], stop_reason: "tool_use", model: "claude-fake", usage };
      return { content: [{ type: "tool_use", id: "toolu_pcb", name: pcb, input: PCB_EDIT_ARGS() }], stop_reason: "tool_use", model: "claude-fake", usage };
    });
    const openai = fakeOpenAI(answersOpenAI);
    const env = { [ROLE_MODELS_ENV]: JSON.stringify({ "circuit-topology": { provider: "anthropic", model: "inherit" }, "pcb-placement-routing": { provider: "anthropic", model: "inherit" } }) };
    const run = await runE1Dag(["circuit-topology", "pcb-placement-routing"], fakeProviders(openai, anthropic, { env }).providers);
    expect(run.ran!.tasks.map((task) => [task.role, task.status, task.provider, task.route?.provider])).toEqual([["circuit-topology", "accepted", "anthropic", "anthropic"], ["pcb-placement-routing", "accepted", "anthropic", "anthropic"]]);
    const sealed = run.ran!.tasks.map((task) => task.result!.proposedActions[0]!.payload as unknown as { schema: string; provenance: { provider: string }; actor?: { actorId: string } });
    expect(sealed.map((artifact) => [artifact.schema, artifact.provenance.provider])).toEqual([["sirkit.schematic-tier1-proposal.v3", "anthropic"], ["sirkit.pcb-bounded-edit-proposal.v2", "anthropic"]]);
    expect(sealed[1]!.actor!.actorId).toBe("agent:anthropic");
    expect(openai.create).not.toHaveBeenCalled();
    // a compatible fallback: anthropic is OUT, so the circuit specialist falls back to openai (the coordinator's) and seals under openai
    await failOnce("anthropic", "insufficient_quota", Date.now());
    turns.clear();
    const fallbackOpenAI = fakeOpenAI((params) => {
      const role = roleOf(params);
      return firstTurn(role) ? { ...openAIResultResponse(role), output: [{ type: "function_call", call_id: "call-tier1", name: tier1, arguments: JSON.stringify(TIER1_ARGS("22k")) }] } : openAIResultResponse(role);
    });
    const fallback = await runE1Dag(["circuit-topology"], fakeProviders(fallbackOpenAI, anthropic, { env }).providers, { runId: "run-b21e1-fallback-seal" });
    const task = fallback.ran!.tasks[0]!;
    expect([task.status, task.provider, task.route?.provider, task.route?.fallbackFrom?.provider]).toEqual(["accepted", "openai", "openai", "anthropic"]);
    expect((task.result!.proposedActions[0]!.payload as unknown as { provenance: { provider: string } }).provenance.provider).toBe(task.provider);
  });
});
