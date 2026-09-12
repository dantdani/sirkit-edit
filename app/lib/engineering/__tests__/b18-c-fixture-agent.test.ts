/**
 * [B18-C I10a] The browser harness's SCRIPTED agent
 * (app/lib/agent/fixture-agent-adapter.ts):
 *
 *  - reachable ONLY through `agentAdapterFor` under the fixture runtime AND
 *    `SIRKIT_FIXTURE_AGENT=scripted` — never in production, never without the
 *    opt-in — and nothing else in production code constructs it (source scan);
 *  - its script turns whole instructions into the tool calls a model would
 *    make; a target it cannot see in the selection is refused in words and
 *    nothing is called;
 *  - end to end through the REAL loop, gateway, minter and ritual: "Move R3
 *    2 mm to the right." with R3 selected under execute_explicit_tier1 —
 *    selection.inspect, then an explicit move that commits ONE transaction.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { agentAdapterFor } from "../../agent/adapters";
import { FixtureAgentAdapter, planFixtureInstruction, FIXTURE_INTERIM_TEXT } from "../../agent/fixture-agent-adapter";
import type { ProviderToolDeclaration } from "../../agent/contracts";
import { mmToNm } from "../../pcb/units";
import { composition, headOf, POWER_NET_NAME, r3Of, runWithAdapter } from "./b18c-harness";

const SAVED_ENV = { ...process.env };
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in SAVED_ENV)) delete process.env[key];
  Object.assign(process.env, SAVED_ENV);
});
function setEnv(values: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
function productionSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "node_modules" || name === "__tests__" || name.startsWith(".")) return [];
    if (statSync(path).isDirectory()) return productionSources(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}
const tool = (providerName: string, toolId: string): ProviderToolDeclaration => ({ providerName, toolId, version: "1.0.0", description: "", inputSchema: {} });
/** [B18-E E7] the `tool_finished` event for one tool id, as the run emitted it. */
const finishedOf = (run: { events: readonly { type: string }[] }, toolId: string): Record<string, unknown> | undefined =>
  run.events.find((event) => event.type === "tool_finished" && (event as { toolId?: unknown }).toolId === toolId) as Record<string, unknown> | undefined;

describe("B18-C I10a — the gate", () => {
  it("agentAdapterFor returns the scripted agent only under the fixture runtime AND the opt-in; never in production", () => {
    setEnv({ SIRKIT_FIXTURE_RUNTIME: undefined, SIRKIT_FIXTURE_AGENT: undefined });
    expect(agentAdapterFor("openai")).not.toBeInstanceOf(FixtureAgentAdapter);
    setEnv({ SIRKIT_FIXTURE_AGENT: "scripted" });
    expect(agentAdapterFor("openai")).not.toBeInstanceOf(FixtureAgentAdapter); // no fixture runtime
    setEnv({ SIRKIT_FIXTURE_RUNTIME: "blinker", SIRKIT_AUTH_MODE: "local_dev", SIRKIT_FIXTURE_AGENT: undefined });
    expect(agentAdapterFor("openai")).not.toBeInstanceOf(FixtureAgentAdapter); // no opt-in
    setEnv({ SIRKIT_FIXTURE_AGENT: "scripted" });
    const scripted = agentAdapterFor("anthropic");
    expect(scripted).toBeInstanceOf(FixtureAgentAdapter);
    expect(scripted.provider).toBe("anthropic");
    setEnv({ NODE_ENV: "production" });
    expect(agentAdapterFor("openai")).not.toBeInstanceOf(FixtureAgentAdapter); // production never honours the fixture runtime
  });

  it("nothing but agentAdapterFor constructs the scripted agent in production code", () => {
    const constructors = productionSources(join(process.cwd(), "app")).filter((file) => readFileSync(file, "utf8").includes("new FixtureAgentAdapter("));
    expect(constructors.map((file) => file.slice(process.cwd().length + 1).replaceAll("\\", "/"))).toEqual(["app/lib/agent/adapters.ts"]);
  });
});

describe("B18-C I10a — the script", () => {
  it("whole instructions become the tool calls a model would make; an unselected target is refused in words and nothing is called", async () => {
    expect(planFixtureInstruction("Move R3 2 mm to the right.")).toMatchObject({ kind: "select-then", ref: "R3" });
    expect(planFixtureInstruction("Flip R3 to the bottom.")).toMatchObject({ kind: "select-then", ref: "R3" });
    expect(planFixtureInstruction("Add silkscreen text REV B at 10, 10.")).toMatchObject({ kind: "call", toolId: "sirkit.pcb.silkscreen-text", args: { edits: [{ op: "add", text: "REV B", layer: "silkTop", atNm: { x: 10_000_000, y: 10_000_000 } }] } });
    expect(planFixtureInstruction("Undo that.")).toMatchObject({ kind: "call", toolId: "sirkit.pcb.undo-redo-granted", args: { direction: "undo" } });
    expect(planFixtureInstruction("Redo.")).toMatchObject({ kind: "call", toolId: "sirkit.pcb.undo-redo-granted", args: { direction: "redo" } });
    expect(planFixtureInstruction("What is on the board?")).toMatchObject({ kind: "reply" });

    const tools = [tool("sel", "sirkit.selection.inspect"), tool("mv", "sirkit.pcb.move-footprint"), tool("rs", "sirkit.pcb.rotate-side-footprint")];
    const adapter = new FixtureAgentAdapter("openai");
    const first = await adapter.start({ system: "", history: [], userMessage: "Move R3 2 mm to the right.", tools });
    expect(first.toolCalls).toEqual([{ callId: "fx-1", providerName: "sel", argumentsText: "{}" }]);
    const selection = JSON.stringify({ ok: true, output: { items: [{ kind: "footprint", id: "fp-r3", ref: "R3", x: 5_000_000, y: 6_000_000, side: "top", units: "nm" }] } });
    const second = await adapter.continueWith({ continuation: first.continuation, results: [{ callId: "fx-1", outputText: selection, isError: false }], tools });
    expect(second.toolCalls[0]).toMatchObject({ callId: "fx-2", providerName: "mv" });
    expect(second.text).toBe(FIXTURE_INTERIM_TEXT); // [B18-D I6] an execution call carries interim text (it never reaches the answer)
    expect(JSON.parse(second.toolCalls[0]!.argumentsText)).toEqual({ moves: [{ footprintId: "fp-r3", x: 7_000_000, y: 6_000_000 }] });
    const third = await adapter.continueWith({ continuation: second.continuation, results: [{ callId: "fx-2", outputText: JSON.stringify({ ok: true, status: "executed" }), isError: false }], tools });
    expect(third).toMatchObject({ toolCalls: [], text: expect.stringMatching(/executed/) });

    const flip = new FixtureAgentAdapter("openai");
    await flip.start({ system: "", history: [], userMessage: "Flip R3 to the bottom.", tools });
    const flipped = await flip.continueWith({ continuation: first.continuation, results: [{ callId: "fx-1", outputText: selection, isError: false }], tools });
    expect(JSON.parse(flipped.toolCalls[0]!.argumentsText)).toEqual({ targets: [{ footprintId: "fp-r3", rotationDeg: null, side: "bottom" }] });

    const unseen = new FixtureAgentAdapter("openai");
    await unseen.start({ system: "", history: [], userMessage: "Move R3 2 mm to the right.", tools });
    const refused = await unseen.continueWith({ continuation: first.continuation, results: [{ callId: "fx-1", outputText: JSON.stringify({ ok: true, output: { items: [] } }), isError: false }], tools });
    expect(refused).toMatchObject({ toolCalls: [], text: expect.stringMatching(/not selected/) });
    expect(await new FixtureAgentAdapter("openai").start({ system: "", history: [], userMessage: "Undo that.", tools })).toMatchObject({ toolCalls: [], text: expect.stringMatching(/not available/) });
  });
});

describe("B18-C I10a — end to end through the real loop", () => {
  it("'Move R3 2 mm to the right.' with R3 selected under execute_explicit_tier1: selection.inspect, then an explicit move that commits ONE transaction", async () => {
    const c = await composition("execute_explicit_tier1");
    const r3 = r3Of(c);
    const x0 = r3.at.x;
    const before = headOf(c).headSequence;
    const run = await runWithAdapter(c, new FixtureAgentAdapter("openai"), { message: "Move R3 2 mm to the right.", selection: { refs: [{ kind: "footprint", id: r3.id }], primary: { kind: "footprint", id: r3.id } } });
    expect(run.grants[0]!.binding.operation).toMatchObject({ family: "pcb.move-footprint", decision: "execute_explicit" });
    expect(run.rituals[0], JSON.stringify(run.rituals[0])).toMatchObject({ ok: true, status: "committed" });
    expect(r3Of(c).at.x).toBe(x0 + mmToNm(2));
    expect(headOf(c).headSequence).toBe(before + 1);
  }, 30_000);

  it("[B18-E E3] the same sentence again is previewed with the retry note, and the board moves only once", async () => {
    const c = await composition("execute_explicit_tier1");
    const r3 = r3Of(c);
    const x0 = r3.at.x;
    const selection = { refs: [{ kind: "footprint" as const, id: r3.id }], primary: { kind: "footprint" as const, id: r3.id } };
    const first = await runWithAdapter(c, new FixtureAgentAdapter("openai"), { message: "Move R3 2 mm to the right.", selection });
    expect(first.grants[0]!.binding.operation.decision).toBe("execute_explicit");
    expect(r3Of(c).at.x).toBe(x0 + mmToNm(2));
    const head = headOf(c).headSequence;
    const again = await runWithAdapter(c, new FixtureAgentAdapter("openai"), { message: "Move R3 2 mm to the right.", selection: { refs: [{ kind: "footprint" as const, id: r3.id }], primary: { kind: "footprint" as const, id: r3.id } } });
    expect(again.grants[0]!.binding.operation.decision, "an identical instruction that already executed asks first").toBe("preview_then_confirm");
    expect(again.rituals, "nothing runs until the human confirms").toEqual([]);
    expect(r3Of(c).at.x, "the board moved once").toBe(x0 + mmToNm(2));
    expect(headOf(c).headSequence).toBe(head);
  }, 40_000);

  it("[B18-E E3] with nothing selected the scripted agent asks for a selection: no grant, no change", async () => {
    const c = await composition("execute_explicit_tier1");
    const x0 = r3Of(c).at.x;
    const head = headOf(c).headSequence;
    const run = await runWithAdapter(c, new FixtureAgentAdapter("openai"), { message: "Move R3 2 mm to the right." });
    expect(run.grants).toEqual([]);
    expect(run.rituals).toEqual([]);
    expect(r3Of(c).at.x).toBe(x0);
    expect(headOf(c).headSequence).toBe(head);
  }, 30_000);
});

describe("[B18-E E7] the scripted agent's refusal scripts", () => {
  it("plans a Tier 3 attempt as a raw provider name, a delegation inside a real edit, and the same call twice", () => {
    expect(planFixtureInstruction("Release the board.")).toMatchObject({ kind: "forged", providerName: "sirkit_manufacturing_release" });
    expect(planFixtureInstruction("Qualify the board.")).toMatchObject({ kind: "forged", providerName: "sirkit_pcb_qualify" });
    expect(planFixtureInstruction("Order the parts.")).toMatchObject({ kind: "forged", providerName: "sirkit_bom_order" });
    expect(planFixtureInstruction("Move R3 2 mm to the right, then release the board.")).toMatchObject({ kind: "select-then", ref: "R3" });
    expect(planFixtureInstruction("Add silkscreen text REV C at 10, 10 twice.")).toMatchObject({ kind: "twice", toolId: "sirkit.pcb.silkscreen-text" });
    expect(planFixtureInstruction("Move R3 2 mm to the right.")).toMatchObject({ kind: "select-then" }); // the plain scripts are unchanged
  });

  it("emits the forged name even though the run never advertised it, and still claims success in interim text", async () => {
    const tools = [tool("sel", "sirkit.selection.inspect"), tool("mv", "sirkit.pcb.move-footprint")];
    const step = await new FixtureAgentAdapter("openai").start({ system: "", history: [], userMessage: "Release the board.", tools });
    expect(step.toolCalls).toEqual([{ callId: "fx-1", providerName: "sirkit_manufacturing_release", argumentsText: JSON.stringify({ boardId: "b1", designId: "d1" }) }]);
    expect(step.text, "the claim exists, so the proof can show it never reaches the answer").toBe(FIXTURE_INTERIM_TEXT);
  });

  it("end to end: a Tier 3 attempt is refused unknown_tool with no grant and no change", async () => {
    const c = await composition("execute_explicit_tier1");
    const x0 = r3Of(c).at.x;
    const head = headOf(c).headSequence;
    const run = await runWithAdapter(c, new FixtureAgentAdapter("openai"), { message: "Release the board." });
    expect(run.grants).toEqual([]);
    expect(run.rituals).toEqual([]);
    expect(run.events.filter((event) => event.type === "tool_refused").map((event) => String((event as { status?: unknown }).status))).toEqual(["unknown_tool"]);
    // [B18-E E9] the run still ENDS in words (the browser waits for this sentence), and the sentence is not the claim
    expect(String((run.events.find((event) => event.type === "run_completed") as { finalText?: unknown } | undefined)?.finalText)).toBe("(fixture agent) the tool answered unknown_tool.");
    expect(r3Of(c).at.x).toBe(x0);
    expect(headOf(c).headSequence).toBe(head);
  }, 30_000);

  it("end to end: an edit carrying a delegation dies on the tool's own argument contract, and the same call twice yields ONE grant", async () => {
    const c = await composition("execute_explicit_tier1");
    const r3 = r3Of(c);
    const head = headOf(c).headSequence;
    const selection = { refs: [{ kind: "footprint" as const, id: r3.id }], primary: { kind: "footprint" as const, id: r3.id } };
    const delegated = await runWithAdapter(c, new FixtureAgentAdapter("openai"), { message: "Move R3 2 mm to the right, then release the board.", selection });
    // The smuggled `then` never reaches an authority decision: move-footprint's own argument
    // contract rejects the unknown key, so the edit the sentence really asked for is lost too.
    expect(finishedOf(delegated, "sirkit.pcb.move-footprint")).toMatchObject({ ok: false, status: "invalid_input" });
    expect(delegated.events.some((event) => event.type === "tool_started" && (event as { toolId?: unknown }).toolId === "sirkit.manufacturing.release"), "the delegate was never started as a tool").toBe(false);
    expect(delegated.grants, "a delegation mints nothing").toEqual([]);
    expect(r3Of(c).at.x).toBe(r3.at.x);
    expect(headOf(c).headSequence).toBe(head);

    const twice = await runWithAdapter(c, new FixtureAgentAdapter("openai"), { message: "Add silkscreen text REV C at 10, 10 twice." });
    expect(twice.grants, "one side-effecting artifact per run").toHaveLength(1);
    expect(twice.grants[0]!.binding.operation.decision, "a silkscreen add has no explicit grammar, so it waits for the human").toBe("preview_then_confirm");
    expect(twice.rituals, "a preview is not auto-run").toEqual([]);
    expect(twice.events.filter((event) => event.type === "tool_refused").map((event) => String((event as { status?: unknown }).status))).toEqual(["execution_exists"]);
    expect(headOf(c).headSequence, "nothing is committed until the human confirms").toBe(head);
  }, 40_000);
});

// ─── [B18-E E14] scenario 2: the scripted agent reads the vias, then says what is actually possible ──────────────────

describe("[B18-E E14] the scripted agent's via plan (scenario 2)", () => {
  const SENTENCE = "Change every via on the 5 V net to 0.7 mm diameter and 0.35 mm drill.";
  /** The run's final sentence — what the person actually reads. */
  const answerOf = (run: { events: readonly { type: string }[] }): string =>
    String((run.events.find((event) => event.type === "run_completed") as { finalText?: unknown } | undefined)?.finalText ?? "");

  it("reads the net FIRST — the plan is a call to the bounded via read carrying the name the person used, nothing else", () => {
    const planned = planFixtureInstruction(SENTENCE);
    expect(planned.kind).toBe("via-then");
    expect((planned as { netName: string }).netName, "the name is taken from the sentence, never re-spelled").toBe("5 V");
    expect(planFixtureInstruction("Use the Power via 0.8/0.4 padstack for every via on the /root/VCC net").kind).toBe("via-then");
  });

  it("the verbatim sentence on a board with no such net: the nets that DO carry vias are named, nothing is called, nothing changes", async () => {
    const c = await composition("execute_explicit_tier1", { vias: true });
    const head = headOf(c).headSequence;
    const run = await runWithAdapter(c, new FixtureAgentAdapter("openai"), { message: SENTENCE });
    expect(finishedOf(run, "sirkit.pcb.via-inspect"), "the read ran").toMatchObject({ ok: true });
    expect(run.events.some((event) => event.type === "pcb_proposal_ready"), "nothing was proposed").toBe(false);
    expect(run.grants, "and nothing was granted — via edits are never Tier 1").toEqual([]);
    const answer = answerOf(run);
    expect(answer).toContain('no net called "5 V"');
    expect(answer, "it names what the board actually has").toContain(POWER_NET_NAME);
    expect(answer).toContain("Nothing was changed");
    expect(headOf(c).headSequence).toBe(head);
  }, 30_000);

  it("asked by the board's OWN net name, it refuses truthfully: the vias take their geometry from a padstack, and 0.7/0.35 is not one that exists", async () => {
    const c = await composition("execute_explicit_tier1", { vias: true });
    const head = headOf(c).headSequence;
    const run = await runWithAdapter(c, new FixtureAgentAdapter("openai"), { message: `Change every via on the ${POWER_NET_NAME} net to 0.7 mm diameter and 0.35 mm drill.` });
    const answer = answerOf(run);
    expect(answer).toContain("take their size and drill from a padstack");
    expect(answer, "the padstack the vias are bound to is named").toContain("Via 0.6/0.3");
    expect(answer, "so are the ones that do exist, so the person can choose").toContain("Power via 0.8/0.4");
    expect(answer, "and where the fork lives — a human step, never the agent's").toContain("create-padstack");
    expect(run.events.some((event) => event.type === "pcb_proposal_ready"), "a refusal proposes nothing").toBe(false);
    expect(run.grants).toEqual([]);
    expect(headOf(c).headSequence).toBe(head);
  }, 30_000);

  it("the lawful ask — retarget onto a padstack that exists — seals ONE Tier 2 proposal whose review states the geometry, and still changes nothing", async () => {
    const c = await composition("execute_explicit_tier1", { vias: true });
    const head = headOf(c).headSequence;
    const run = await runWithAdapter(c, new FixtureAgentAdapter("openai"), { message: `Use the Power via 0.8/0.4 padstack for every via on the ${POWER_NET_NAME} net` });
    const ready = run.events.filter((event) => event.type === "pcb_proposal_ready");
    expect(ready, "exactly one sealed proposal").toHaveLength(1);
    expect(run.grants, "a Tier 2 proposal is never a grant").toEqual([]);
    const proposal = (ready[0] as unknown as { proposal: { operations: unknown[]; impact: { operationSummaries: string[] } } }).proposal;
    expect(proposal.operations).toHaveLength(3);
    expect(proposal.impact.operationSummaries, "[E12] the human reads the numbers they are approving").toEqual([
      "Update via via-vcc-1 — padstack Power via 0.8/0.4 (0.800 mm pad / 0.400 mm drill)",
      "Update via via-vcc-2 — padstack Power via 0.8/0.4 (0.800 mm pad / 0.400 mm drill)",
      "Update via via-vcc-3 — padstack Power via 0.8/0.4 (0.800 mm pad / 0.400 mm drill)",
    ]);
    expect(headOf(c).headSequence, "sealing a proposal commits nothing").toBe(head);
  }, 30_000);

  it("a board with no vias at all is answered as such, and a padstack the board does not have is named as missing", async () => {
    const c = await composition("execute_explicit_tier1");
    const empty = await runWithAdapter(c, new FixtureAgentAdapter("openai"), { message: SENTENCE });
    expect(answerOf(empty)).toContain("no vias at all");
    const withVias = await composition("execute_explicit_tier1", { vias: true });
    const missing = await runWithAdapter(withVias, new FixtureAgentAdapter("openai"), { message: `Use the Gold via padstack for every via on the ${POWER_NET_NAME} net` });
    expect(answerOf(missing)).toContain('no padstack called "Gold via"');
    expect(answerOf(missing), "and it lists the ones it has").toContain("Power via 0.8/0.4");
    expect(missing.events.some((event) => event.type === "pcb_proposal_ready")).toBe(false);
  }, 40_000);
});
