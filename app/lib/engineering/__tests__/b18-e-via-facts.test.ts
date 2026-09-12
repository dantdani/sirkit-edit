/**
 * [B18-E E13] Scenario 2, part 2 — the via facts the model never had, and a board it can walk them on.
 *
 * E12 made the two human surfaces truthful. What the discovery also measured is that the model could not PLAN this
 * scenario at all, for three separate reasons:
 *
 *  - vias exist only on a ROUTED board, and every recorded routed board's full snapshot exceeds the loop's 60,000-character
 *    result budget, so the read that carries net names returns `output_too_large_for_model`;
 *  - the snapshot's via rows strip `padstackId`, and the snapshot carries no padstack library at all — so the fact that
 *    decides the whole outcome (a bound via takes its geometry FROM its padstack) was invisible, and the only padstacks a
 *    bound via could be retargeted onto were invisible too;
 *  - the B18-C harness board has no vias, no power rail and no padstacks, so nothing could be walked end to end.
 *
 * This pins the bounded via read that answers exactly those facts, and the harness board that carries them in the shape a
 * board LOAD actually leaves: a rail named as the browser fixture names it (`/root/VCC`, never the literal "5V" the person
 * says), every via bound to a seeded padstack.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildViaSnapshot, MAX_VIAS, MAX_VIA_NETS } from "../../pcb/ai/vias";
import { buildAIPcbSnapshot } from "../../pcb/ai/snapshot";
import { MAX_RESULT_CHARS } from "../../agent/loop";
import { createEmptyBoard, type PcbBoard } from "../../pcb/types";
import { ensureBoardPadstacks } from "../../pcb/padstack/migrate";
import { pcbRevisionId } from "../../pcb/revision";
import { getPreset, DEFAULT_PRESET_ID } from "../../pcb/drc/presets";
import { compileBoundedPcbEdit } from "../../pcb/proposal/bounded-edit-compiler";
import { assembleAgentRunContext } from "../../agent/context";
import { createAgentToolGateway } from "../../agent/gateway";
import { runAgentLoop } from "../../agent/loop";
import { DEFAULT_AGENT_BUDGET, type AgentRunEvent, type AgentStep, type ProviderAgentAdapter } from "../../agent/contracts";
import { AGENT_SYSTEM_PROMPT } from "../../prompts";
import { toolLineLabel } from "../../project/chat-run-view";
import { sirkitToolRegistry } from "../tool-catalog";
import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS } from "../agent-exposure";
import { fixtureBoard, POWER_NET_NAME } from "./b18c-harness";

const VIA_TOOL = "sirkit.pcb.via-inspect";
const LAYERS: ["copperTop", "copperBottom"] = ["copperTop", "copperBottom"];
const RULES = getPreset(DEFAULT_PRESET_ID).rules;

describe("[B18-E E13] the bounded via read answers what a via plan needs", () => {
  it("resolves a net name to its vias EXACTLY, and a name that matches nothing is a truthful no-match that still lists the nets", () => {
    const board = fixtureBoard({ vias: true });
    // What the person says. There is no net called this, and the read does not go looking for one that is nearly it.
    const asked = buildViaSnapshot(board, { netName: "5 V" });
    expect(asked.requestedNetName).toBe("5 V");
    expect(asked.net, "no net is named 5 V — the read says so rather than guessing").toBeNull();
    expect(asked.vias, "and it never answers with some other net's vias").toEqual([]);
    expect(asked.netsWithVias.map((net) => `${net.name}:${net.viaCount}`).sort()).toEqual([`${POWER_NET_NAME}:3`, "NET_1:1"]);

    // What the board calls it. Case and surrounding space are forgiven; the name itself is not reinterpreted.
    const resolved = buildViaSnapshot(board, { netName: `  ${POWER_NET_NAME.toLowerCase()}  ` });
    expect(resolved.net).toEqual({ netId: 3, name: POWER_NET_NAME });
    expect(resolved.vias.map((via) => via.id)).toEqual(["via-vcc-1", "via-vcc-2", "via-vcc-3"]);
    expect(resolved.viaCount).toBe(3);
  });

  it("every via carries the padstack it takes its geometry FROM, and the library is the complete set a bound via can be retargeted onto", () => {
    const board = fixtureBoard({ vias: true });
    const read = buildViaSnapshot(board, { netName: POWER_NET_NAME, boardRevisionId: pcbRevisionId(board) });
    for (const via of read.vias) {
      expect(via.padstack, `${via.id} is bound after a load`).not.toBeNull();
      expect(via.padstack).toMatchObject({ outerMm: 0.6, drillMm: 0.3 });
      expect({ diameterMm: via.diameterMm, drillMm: via.drillMm }, "the via states the padstack's geometry").toEqual({ diameterMm: 0.6, drillMm: 0.3 });
    }
    // The requested 0.7/0.35 is not a padstack that exists, so the read tells the model the request is unreachable BEFORE
    // it proposes — which is the whole point of this increment.
    expect(read.viaPadstacks.some((padstack) => padstack.outerMm === 0.7 && padstack.drillMm === 0.35)).toBe(false);
    expect(read.viaPadstacks.map((padstack) => `${padstack.outerMm}/${padstack.drillMm}`).sort()).toEqual(["0.6/0.3", "0.8/0.4", "1.2/0.6"]);
    expect(read.viaPadstackCount).toBe(3);
    expect(read.boardRevisionId).toBe(pcbRevisionId(board));
  });

  it("what the read says is what the compiler then does: bound vias refuse the resize, and a retarget onto a listed padstack compiles", () => {
    const board = fixtureBoard({ vias: true });
    const read = buildViaSnapshot(board, { netName: POWER_NET_NAME });
    const compile = (operations: unknown[]) => compileBoundedPcbEdit({ board, rules: RULES, baseIdentity: pcbRevisionId(board), payload: { intent: "the 5 V vias", operations } });
    const resize = compile(read.vias.map((via) => ({ kind: "update_via", viaId: via.id, sizeNm: 700_000, drillNm: 350_000 })));
    expect(resize).toMatchObject({ ok: false, code: "padstack-bound" });
    const target = read.viaPadstacks.find((padstack) => padstack.outerMm === 0.8)!;
    const retarget = compile(read.vias.map((via) => ({ kind: "update_via", viaId: via.id, padstackId: target.id })));
    if (!retarget.ok) throw new Error(`${retarget.code}: ${retarget.detail}`);
    expect(retarget.candidate.vias.filter((via) => via.padstackId === target.id).map((via) => via.id)).toEqual(["via-vcc-1", "via-vcc-2", "via-vcc-3"]);
    expect(retarget.impact.operationSummaries[0]).toBe(`Update via via-vcc-1 — padstack ${target.name} (0.800 mm pad / 0.400 mm drill)`);
  });

  it("carries vias and padstacks ONLY — no tracks, pads, zones, footprints or validations — and every list is capped beside its true count", () => {
    const board = createEmptyBoard();
    board.outline = { kind: "rect", width: 200_000_000, height: 200_000_000, origin: { x: 0, y: 0 } };
    for (let index = 1; index <= MAX_VIA_NETS + 5; index += 1) board.nets.push({ id: index, name: `N${index}` });
    for (let index = 0; index < MAX_VIAS + 7; index += 1) board.vias.push({ id: `v${index}`, at: { x: 1_000_000 * index, y: 1_000_000 }, size: 600_000, drill: 300_000, netId: 1, layers: LAYERS });
    for (let index = 2; index <= MAX_VIA_NETS + 5; index += 1) board.vias.push({ id: `n${index}`, at: { x: 1_000_000, y: 2_000_000 * index }, size: 600_000, drill: 300_000, netId: index, layers: LAYERS });
    const read = buildViaSnapshot(board, { netName: "N1" });
    expect(read.vias).toHaveLength(MAX_VIAS);
    expect(read.viaCount, "the true count is always stated, so a cap is never mistaken for the whole net").toBe(MAX_VIAS + 7);
    expect(read.netsWithVias).toHaveLength(MAX_VIA_NETS);
    expect(read.netsWithViasCount).toBe(MAX_VIA_NETS + 5);
    expect(Object.keys(read).sort()).toEqual(["boardRevisionId", "net", "netsWithVias", "netsWithViasCount", "requestedNetName", "viaCount", "viaPadstackCount", "viaPadstacks", "vias", "units"].sort());
    expect(Object.keys(read.vias[0]).sort()).toEqual(["diameterMm", "drillMm", "endLayerId", "id", "locked", "padstack", "positionMm", "startLayerId"].sort());
  });

  it("fits the model's result budget on the ROUTED boards where the full snapshot does not — the reason it exists", () => {
    const fixture = JSON.parse(readFileSync("e2e/fixtures/blinker-route-fixture.json", "utf8")) as { entries: Record<string, { candidate: PcbBoard }> };
    const routed = Object.entries(fixture.entries).map(([key, entry]) => ({ key, board: entry.candidate }));
    expect(routed.length).toBeGreaterThan(0);
    for (const { key, board } of routed) {
      const loaded = { ...board, vias: board.vias.map((via) => ({ ...via })), padstacks: board.padstacks ? [...board.padstacks] : undefined } as PcbBoard;
      ensureBoardPadstacks(loaded);
      const snapshotChars = JSON.stringify({ ok: true, output: { snapshot: buildAIPcbSnapshot(loaded) } }).length;
      const netsWithVias = buildViaSnapshot(loaded).netsWithVias;
      expect(netsWithVias.length, key).toBeGreaterThan(0);
      const viaChars = JSON.stringify({ ok: true, output: { vias: buildViaSnapshot(loaded, { netName: netsWithVias[0].name }) } }).length;
      expect(snapshotChars, `${key}: the full snapshot is over the budget (that is why this read exists)`).toBeGreaterThan(MAX_RESULT_CHARS);
      expect(viaChars, `${key}: the via read must fit`).toBeLessThan(MAX_RESULT_CHARS / 10);
      // And on a real routed board every via is bound, so the resize this scenario asks for is refused there too.
      const read = buildViaSnapshot(loaded, { netName: netsWithVias[0].name });
      expect(read.vias.every((via) => via.padstack !== null), key).toBe(true);
    }
  });
});

describe("[B18-E E13] the read is a reviewed Tier 0 exposure and nothing more", () => {
  it("is in the one reviewed exposure list, is read-class, and answers through the real gateway over the canonical board", async () => {
    expect(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS).toContain(VIA_TOOL);
    const descriptor = sirkitToolRegistry().list().find((item) => item.toolId === VIA_TOOL)!;
    expect(descriptor).toMatchObject({ operationClass: "read", agentExposed: true, sideEffects: "none", callability: "callable" });
    expect(descriptor.executionMode, "a read is never a granted execution").toBeUndefined();

    const board = fixtureBoard({ vias: true });
    const assembly = assembleAgentRunContext({ tenantId: "local", projectId: "p18e13", branchId: "main", board });
    if (!assembly.ok) throw new Error(assembly.reason);
    const before = pcbRevisionId(board);
    const gateway = createAgentToolGateway(sirkitToolRegistry(), { now: () => 4_000_000 });
    const outcome = await gateway.invoke({ runId: "run-e13", provider: "anthropic", toolId: VIA_TOOL, version: "1.0.0", args: { netName: POWER_NET_NAME }, context: assembly.context, timeoutMs: 5_000 });
    expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
    const answered = (outcome as unknown as { output: { vias: { net: { name: string } | null; vias: unknown[] } } }).output.vias;
    expect(answered.net).toMatchObject({ name: POWER_NET_NAME });
    expect(answered.vias).toHaveLength(3);
    expect(pcbRevisionId(board), "a read mutates nothing").toBe(before);
  });

  it("without a board there is nothing to read: the run toolset withholds it, exactly as it withholds the other board reads", () => {
    const assembly = assembleAgentRunContext({ tenantId: "local", projectId: "p18e13", branchId: "main" });
    if (!assembly.ok) throw new Error(assembly.reason);
    expect(assembly.context.canonicalState).toBeNull();
  });
});

// ─── the whole of scenario 2, read first, through the real loop and gateway ──

interface ScriptStep { tool: string; args: unknown }

/** The model's own view: `handed` collects exactly the result text each call was answered with, in order. */
function scriptedAdapter(script: readonly ScriptStep[], answer: string, handed: string[]): ProviderAgentAdapter {
  let index = 0;
  const step = (): AgentStep => {
    const next = script[index];
    index += 1;
    if (!next) return { text: answer, toolCalls: [], stopReason: "end", usage: {}, model: "scripted", continuation: { provider: "anthropic", state: null } };
    return { text: "", toolCalls: [{ callId: `call-${index}`, providerName: providerNameOf(next.tool), argumentsText: JSON.stringify(next.args) }], stopReason: "tool_use", usage: {}, model: "scripted", continuation: { provider: "anthropic", state: null } };
  };
  return {
    provider: "anthropic",
    async start() { return step(); },
    async continueWith(input) { for (const result of input.results) handed.push(result.outputText); return step(); },
  };
}

/** The provider name the registry publishes for a tool id (the wire name the scripted model must call). */
function providerNameOf(toolId: string): string {
  return toolId.replace(/\./g, "_");
}

async function runScript(board: PcbBoard, script: readonly ScriptStep[], answer: string): Promise<{ events: AgentRunEvent[]; results: string[]; revisionAfter: string }> {
  const handed: string[] = [];
  const assembly = assembleAgentRunContext({
    tenantId: "local", projectId: "p18e13", branchId: "main", board,
    pcbProposalBasis: { historyHeadSequence: 0, historyHeadLabel: null, lineageId: "lin-b18-e13", activeDrcPresetId: DEFAULT_PRESET_ID },
  });
  if (!assembly.ok) throw new Error(assembly.reason);
  const registry = sirkitToolRegistry();
  const events: AgentRunEvent[] = [];
  const result = await runAgentLoop(
    { runId: "run-e13-loop", provider: "anthropic", history: [], userMessage: "Change every via on the 5 V net to 0.7 mm diameter and 0.35 mm drill.", budget: DEFAULT_AGENT_BUDGET },
    {
      adapter: scriptedAdapter(script, answer, handed),
      gateway: createAgentToolGateway(registry, { now: () => 5_000_000 }),
      registry, context: assembly.context, system: AGENT_SYSTEM_PROMPT,
      emit: (event) => events.push(event), contextWarnings: assembly.warnings,
    },
  );
  expect(result.status).toBe("completed");
  return { events, results: handed, revisionAfter: pcbRevisionId(assembly.context.canonicalState!.pcb) };
}

describe("[B18-E E13] scenario 2 planned from the facts, through the real loop", () => {
  it("the verbatim '5 V net' finds no such net, the board's own name resolves it, and the requested pair is then known to be unreachable", async () => {
    const board = fixtureBoard({ vias: true });
    const before = pcbRevisionId(board);
    const { events, results, revisionAfter } = await runScript(board, [
      { tool: "sirkit.pcb.via-inspect", args: { netName: "5 V" } },
      { tool: "sirkit.pcb.via-inspect", args: { netName: POWER_NET_NAME } },
    ], `There is no net called "5 V" on this board. Its vias are on ${POWER_NET_NAME}, and all three are bound to a 0.6/0.3 padstack, so 0.7/0.35 is not something I can propose.`);
    const noMatch = JSON.parse(results[0]) as { ok: boolean; output: { vias: { net: unknown; netsWithVias: Array<{ name: string }> } } };
    expect(noMatch.ok).toBe(true);
    expect(noMatch.output.vias.net, "the model is told plainly that the name matched nothing").toBeNull();
    expect(noMatch.output.vias.netsWithVias.map((net) => net.name)).toContain(POWER_NET_NAME);
    const resolved = JSON.parse(results[1]) as { output: { vias: { vias: Array<{ padstack: { outerMm: number } | null }>; viaPadstacks: Array<{ outerMm: number; drillMm: number }> } } };
    expect(resolved.output.vias.vias.every((via) => via.padstack !== null), "the model can see the binding before it proposes").toBe(true);
    expect(resolved.output.vias.viaPadstacks.some((padstack) => padstack.outerMm === 0.7 && padstack.drillMm === 0.35), "and that the requested pair is not on offer").toBe(false);
    expect(events.filter((event) => event.type === "pcb_proposal_ready" || event.type === "execution_grant_ready"), "reading is all that happened").toHaveLength(0);
    expect(revisionAfter).toBe(before);
  });

  it("a proposal built FROM the read seals the only lawful change — the retarget — and the resize the sentence asked for is refused with its reason", async () => {
    const board = fixtureBoard({ vias: true });
    const read = buildViaSnapshot(board, { netName: POWER_NET_NAME });
    const target = read.viaPadstacks.find((padstack) => padstack.outerMm === 0.8)!;

    const sealed = await runScript(board, [
      { tool: "sirkit.pcb.via-inspect", args: { netName: POWER_NET_NAME } },
      { tool: "sirkit.pcb.propose-bounded-edit", args: { intent: `retarget the ${POWER_NET_NAME} vias`, operations: read.vias.map((via) => ({ kind: "update_via", viaId: via.id, padstackId: target.id })) } },
    ], "The nearest change I can make is a proposal for you to review.");
    expect(sealed.events.filter((event) => event.type === "pcb_proposal_ready")).toHaveLength(1);
    expect(sealed.revisionAfter, "a sealed proposal changes nothing").toBe(pcbRevisionId(board));

    const blocked = await runScript(board, [
      { tool: "sirkit.pcb.via-inspect", args: { netName: POWER_NET_NAME } },
      { tool: "sirkit.pcb.propose-bounded-edit", args: { intent: "resize the vias", operations: read.vias.map((via) => ({ kind: "update_via", viaId: via.id, sizeNm: 700_000, drillNm: 350_000 })) } },
    ], "I could not prepare that change.");
    expect(blocked.events.filter((event) => event.type === "pcb_proposal_ready")).toHaveLength(0);
    const finished = blocked.events.filter((event) => event.type === "tool_finished").at(-1) as { ok: boolean; status: string; reason?: string };
    expect(finished).toMatchObject({ ok: false, status: "proposal_blocked" });
    expect(finished.reason, "[E12] the page shows the reason itself").toMatch(/bound to padstack/);
    expect(toolLineLabel(finished as unknown as Record<string, unknown>)).toContain("nothing was changed");
  });
});
