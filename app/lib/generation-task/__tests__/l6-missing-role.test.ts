/**
 * [PR-L6, 2026-10-19] L.6 part 2, item 8 (runbook L.6 "integrate real missing-resource state into this task"; L.7 item 5; OD-253 item 9):
 * a block reports a role the catalog cannot fill - `report_unfilled_role` - instead of guessing a part.
 *
 *  1. a report backed by fewer than two searches this conversation recorded is refused with a correction, and the conversation goes on;
 *     a report backed by two is accepted and routed: below S3 the block is re-searched catalog-guided (S3: the reported searches run again
 *     with the cache bypassed); reported again there, the block waits at S6 (`missing_part`, zero model calls) with its roles on the
 *     block, in the blocker's evidence and in the snapshot; the other blocks stay saved (`partial_available`); no partId is ever made up;
 *  2. once the part exists, Retry block finds it at S3 and the design completes with it;
 *  3. Review the saved blocks instead: the partial explanation names the role that was not designed;
 *  4. the request-lifetime loop never offers the tool.
 *
 * The real worker, store and slice code; a scripted model, a fake catalog, the in-memory durable repository, a simulated clock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/erc", () => ({
  runErc: vi.fn(() => ({ ok: true, errors: [], criticalCount: 0, warningCount: 0, reward: 1 })),
  formatErcFeedback: vi.fn(() => "ERC: offline fixture feedback."),
}));
vi.mock("@/lib/kg", () => ({ kgDesignNotes: vi.fn(() => null) }));

import { InMemoryDurableWorkflowRepository } from "../../durable-workflow/repository";
import type { LLMToolResultPart } from "../../llm/types";
import { buildGenerationTaskSnapshot } from "../snapshot";
import { PARTS, ScriptedModel, drive, droneCatalog, droneScripts, head, l3Env, part, reply, search, startTask, submit, type BlockScript, type L3Env } from "./_l3-worker-fixtures";

const editor = { principalId: "user-l3-editor", role: "pcb_editor" as const };
const Q1 = { query: "30A brushless ESC", category: "Drivers" };
const Q2 = { query: "brushless motor speed controller" };
const ESC = part("p-esc", "Offline 30A brushless ESC", "Drivers", ["VIN", "GND", "PWM", "M1", "M2", "M3"]);
const label = (pin: string, labelName: string) => ({ kind: "label", pin, labelName });
const ESC_NETLIST = { components: [{ refDes: "U1", partId: "p-esc", value: "ESC", role: "output" }], connections: [label("U1.VIN", "VBAT"), label("U1.GND", "GND"), label("U1.PWM", "PWM1"), label("U1.M1", "PWM2"), label("U1.M2", "PWM3"), label("U1.M3", "PWM4")], explanation: "One ESC." };
const report = (id: string, queriesTried: unknown[]) => ({ id, name: "report_unfilled_role", input: { role: "brushless ESC", function: "Drive one brushless motor from a PWM signal", keySpecs: ["30 A continuous", "1S input"], queriesTried } });
/** Motor drivers: S1 searches, reports too early (refused), searches again, reports (accepted); at S3 it searches both again and reports,
 *  unless the catalog-guided re-search found the part (its partId is in the seed), then it submits with it. */
const motorScript: BlockScript = ({ turn, strategy, first }) => {
  if (strategy === "S1-baseline") {
    if (turn === 1) return reply([search("call_m_1", Q1.query, Q1.category)]);
    if (turn === 2) return reply([report("call_m_2", [Q1])]);
    if (turn === 3) return reply([search("call_m_3", Q2.query)]);
    return reply([report("call_m_4", [Q1, Q2.query])]);
  }
  if (first.includes("p-esc")) return reply([submit("call_m_submit", ESC_NETLIST)]);
  if (turn === 1) return reply([search("call_s3_1", Q1.query, Q1.category), search("call_s3_2", Q2.query)]);
  return reply([report("call_s3_report", [{ query: Q2.query }, Q1])]);
};
async function parkOnMissingPart(name: string): Promise<{ env: L3Env; model: ScriptedModel; catalog: ReturnType<typeof droneCatalog>; taskId: string }> {
  const catalog = droneCatalog();
  const env = l3Env({ name, repository: new InMemoryDurableWorkflowRepository(), catalog });
  const model = new ScriptedModel(droneScripts({ "Motor drivers": motorScript }), env.time, () => 1_000);
  const task = await startTask(env);
  await drive(env, env.worker({ llm: model }), task.taskId, { until: (current) => current.state === "waiting-for-resource", maxTicks: 40 });
  return { env, model, catalog, taskId: task.taskId };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("[PR-L6] a role the catalog cannot fill (item 8)", () => {
  it("1. an unbacked report is refused with a correction; a backed one routes S1 -> S3 -> S6 (zero model calls there); the roles ride the block, the blocker and the snapshot; the saved blocks stay", { timeout: 60_000 }, async () => {
    const { env, model, catalog, taskId } = await parkOnMissingPart("missing-role");
    const parked = await head(env, taskId);
    // the report naming one recorded search was refused, and the conversation went on
    const s1 = model.requests.filter((request) => /^Block: Motor drivers/.test(typeof request.messages[0]!.content === "string" ? request.messages[0]!.content : "") && request.messages.length === 5);
    const refusal = (s1[0]!.messages[4]!.content as LLMToolResultPart[])[0]!;
    expect(refusal.isError).toBe(true);
    expect(refusal.output).toMatch(/not accepted: it must name at least 2 different search_parts searches this block actually made for the role \(1 of the searches named match a recorded search\)/);
    // the accepted report routed the block to S3 (the reported searches re-run, cache bypassed), then - reported again - to S6
    const motor = model.calls.filter((call) => call.kind === "block" && call.block === "Motor drivers").map((call) => `${call.strategy}#${call.turn}`);
    expect(motor).toEqual(["S1-baseline#1", "S1-baseline#2", "S1-baseline#3", "S1-baseline#4", "S3-catalog-guided#1", "S3-catalog-guided#2"]); // nothing at S6
    expect(catalog.searches.filter((entry) => entry.query === Q1.query).map((entry) => entry.category ?? null)).toEqual(["Drivers", "Drivers", null]); // S1's search, then S3's catalog-guided re-search (in the category, then without it); the S3 conversation's own repeat was a cache hit
    expect(parked.blocks.b3).toMatchObject({ status: "blocked", blocker: "missing_part", strategy: "S6-missing-part", missing: [{ role: "brushless ESC", query: Q1.query, category: "Drivers" }] });
    expect(parked.blocks.b3!.strategyHistory.map((entry) => `${entry.id}:${entry.outcome}`)).toEqual(["S1-baseline:stagnant", "S3-catalog-guided:stagnant", "S6-missing-part:exhausted"]);
    expect(parked.blocks.b1).toMatchObject({ status: "saved" });
    expect(parked.blocks.b2).toMatchObject({ status: "saved" });
    expect(parked.blocker).toMatchObject({ code: "partial_available", blockId: "b3", evidence: { cause: "missing_part", savedBlocks: 2, missing1: `brushless ESC: ${Q1.query} (Drivers)` } });
    const snapshot = buildGenerationTaskSnapshot(parked, { nowMs: env.time.now(), processing: [] });
    expect(snapshot.plan!.blocks.find((block) => block.blockId === "b3")).toMatchObject({ status: "blocked", blocker: "missing_part", missing: [{ role: "brushless ESC" }] });
    expect(snapshot.actions).toEqual(["cancel", "retry-block", "review-partial"]);
    expect(snapshot.retryBlocks).toEqual(["b3"]);
    expect(parked.milestones.some((event) => event.type === "waiting_resource" && event.message.includes('no catalog part for "brushless ESC"'))).toBe(true);
    expect(Object.values(PARTS).map((entry) => entry.partId)).not.toContain("p-esc"); // nothing was made up: the catalog never had the part
  });

  it("2. once the part exists, Retry block finds it at S3 and the design completes with it", { timeout: 60_000 }, async () => {
    const { env, model, catalog, taskId } = await parkOnMissingPart("missing-role-retry");
    catalog.add(ESC, /esc|speed controller/i); // a person added the part
    expect(await env.store.control({ scope: env.scope, taskId, principal: editor, action: "retry-block", clientActionId: "retry-esc", blockId: "b3" })).toMatchObject({ ok: true, task: { state: "queued", blocks: { b3: { status: "queued" } } } });
    const reopened = await head(env, taskId);
    expect(reopened.blocks.b3).not.toHaveProperty("missing"); // re-queued: no longer waiting
    const { task: done } = await drive(env, env.worker({ llm: model }), taskId, { until: (current) => current.state === "awaiting-review", maxTicks: 20 });
    expect(done.blocks.b3).toMatchObject({ status: "saved", strategy: "S3-catalog-guided" });
    const result = await env.store.readResult(env.scope, done);
    expect(result).toMatchObject({ status: "complete" });
    expect(result!.netlist.components.map((component) => component.partId)).toContain("p-esc");
    for (const component of result!.netlist.components) expect(catalog.parts.has(component.partId), component.partId).toBe(true);
  });

  it("3. Review the saved blocks: the partial explanation names the role that was not designed", { timeout: 60_000 }, async () => {
    const { env, model, taskId } = await parkOnMissingPart("missing-role-partial");
    expect(await env.store.control({ scope: env.scope, taskId, principal: editor, action: "review-partial", clientActionId: "partial-esc" })).toMatchObject({ ok: true });
    const { task: done } = await drive(env, env.worker({ llm: model }), taskId, { until: (current) => current.state === "awaiting-review", maxTicks: 10 });
    expect(done.blocks.b3).toMatchObject({ status: "omitted", missing: [{ role: "brushless ESC" }] });
    const result = await env.store.readResult(env.scope, done);
    expect(result).toMatchObject({ status: "partial", omittedBlocks: ["Motor drivers"] });
    expect(result!.explanation).toContain("Not designed (no catalog part was found for these roles):\n- Motor drivers: brushless ESC");
  });
});
