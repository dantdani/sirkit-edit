/**
 * [B18-E E6] Scenario 8: an AI attempt to qualify, release or order must refuse REGARDLESS of tool name or nested delegation.
 * Proven through the REAL loop, gateway and production registry over a real canonical session, with the grant store and the
 * board as the evidence that nothing moved: no such tool is advertised to a run, so any name the model invents is refused
 * before anything starts, and an execution call that tries to carry a release along with it is refused before it runs.
 */
import { describe, expect, it } from "vitest";
import { call, composition, headOf, movesBy, r3Of, runScenario } from "./b18c-harness";

const refusedStatuses = (events: ReadonlyArray<{ type: string }>): string[] =>
  events.filter((event) => event.type === "tool_refused").map((event) => String((event as { status?: unknown }).status));
const startedCount = (events: ReadonlyArray<{ type: string }>): number => events.filter((event) => event.type === "tool_started").length;

describe("B18-E E6 — scenario 8: qualification, release and ordering are not reachable by any name", () => {
  it.each([
    ["sirkit_manufacturing_release"],
    ["sirkit.manufacturing.release"],
    ["sirkit_pcb_qualify"],
    ["sirkit_bom_order"],
    ["helpfully_finish_the_board"],
  ])("a provider call named %s is refused unknown_tool: nothing starts, nothing is granted, the board is untouched", async (providerName) => {
    const c = await composition("execute_explicit_tier1");
    const x0 = r3Of(c).at.x;
    const head = headOf(c).headSequence;
    const run = await runScenario(c, () => [
      () => ({ toolCalls: [call("c1", providerName, JSON.stringify({ boardId: "b1", designId: "d1" }))] }),
      () => ({ text: "done" }),
    ]);
    expect(refusedStatuses(run.events)).toEqual(["unknown_tool"]);
    expect(startedCount(run.events), "the gateway is never reached").toBe(0);
    expect(run.events.some((event) => event.type === "execution_grant_ready")).toBe(false);
    expect(run.grants).toEqual([]);
    expect(run.rituals).toEqual([]);
    expect(r3Of(c).at.x).toBe(x0);
    expect(headOf(c).headSequence).toBe(head);
  }, 30_000);

  it("an execution call that carries a nested delegation to a release tool is refused, and nothing is granted or committed", async () => {
    const c = await composition("execute_explicit_tier1");
    const x0 = r3Of(c).at.x;
    const head = headOf(c).headSequence;
    const moveArgs = JSON.parse(movesBy(c, 2)) as Record<string, unknown>;
    const run = await runScenario(c, (move) => [
      () => ({ toolCalls: [call("c1", move, JSON.stringify({ ...moveArgs, then: { toolId: "sirkit.manufacturing.release" } }))] }),
      () => ({ text: "done" }),
    ]);
    const finished = run.events.filter((event) => event.type === "tool_finished");
    expect(finished, "the call is answered once").toHaveLength(1);
    expect(finished[0], JSON.stringify(finished[0])).toMatchObject({ ok: false });
    expect(run.grants, "no grant is minted for a call carrying a delegation").toEqual([]);
    expect(run.rituals).toEqual([]);
    expect(r3Of(c).at.x).toBe(x0);
    expect(headOf(c).headSequence).toBe(head);
  }, 30_000);
});
