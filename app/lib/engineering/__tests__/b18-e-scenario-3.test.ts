/**
 * [B18-E E10] Scenario 3 — "Add horizontal and vertical dimensions for the board and mounting holes."
 *
 * Through the REAL loop, gateway, registry, minter and ritual, driven by the scripted agent, which plans the way a model
 * would have to: it READS the board first (board-inspect) and dimensions what the snapshot actually returned — the outline
 * it states, and the footprints it classifies as mounting holes (OD-21: a footprint whose pads are all non-plated holes).
 *
 * What must hold:
 *  - dimensions are Tier 1 but CONFIRMATION-ONLY (OD-11): even under `execute_explicit_tier1` the grant is
 *    `preview_then_confirm`, nothing is auto-run, and the head does not move until a human confirms;
 *  - the operations are exactly the board's own extents — no coordinate the agent invented;
 *  - the blinker fixture has NO mounting holes, so the run dimensions the board and adds nothing for holes: the honest
 *    answer to half the sentence is "there are none", never an invented hole.
 */
import { describe, expect, it } from "vitest";
import { FixtureAgentAdapter, boardFacts, planFixtureInstruction } from "../../agent/fixture-agent-adapter";
import { buildAIPcbSnapshot } from "../../pcb/ai/snapshot";
import { buildMechanicalSnapshot } from "../../pcb/ai/mechanical";
import { composition, headOf, runWithAdapter } from "./b18c-harness";

const SENTENCE = "Add horizontal and vertical dimensions for the board and mounting holes.";
const NM_PER_MM = 1_000_000;

describe("[B18-E E10] scenario 3 — dimensioning what the board actually says", () => {
  it("the snapshot and the bounded mechanical read classify mounting holes by OD-21's rule; the blinker fixture has none", async () => {
    const c = await composition("execute_explicit_tier1");
    const snapshot = buildAIPcbSnapshot(c.history.committedPresent) as unknown as { board: { outline: { width: number; height: number } }; footprints: Array<{ reference: string; mountingHole: unknown }> };
    expect(snapshot.footprints.length).toBeGreaterThan(0);
    for (const footprint of snapshot.footprints) expect(typeof footprint.mountingHole, footprint.reference).toBe("boolean");
    expect(snapshot.footprints.filter((footprint) => footprint.mountingHole === true), "the fixture board carries no non-plated-hole footprint").toEqual([]);
    expect(snapshot.board.outline.width).toBeGreaterThan(0);
    expect(snapshot.board.outline.height).toBeGreaterThan(0);
    // [B18-E E11] the bounded read states the same two facts and stays small: no nets, tracks, pads, zones or validations.
    const mechanical = buildMechanicalSnapshot(c.history.committedPresent, { boardRevisionId: "rev-1" });
    expect(mechanical.mountingHoles).toEqual([]);
    expect(mechanical.mountingHoleCount).toBe(0);
    expect(mechanical.outline.widthMm).toBeGreaterThan(0);
    expect(mechanical.outline.heightMm).toBeGreaterThan(0);
    const fullChars = JSON.stringify(snapshot).length, boundedChars = JSON.stringify(mechanical).length;
    expect(boundedChars, `the bounded read is a fraction of the full snapshot (${boundedChars} vs ${fullChars} characters)`).toBeLessThan(fullChars / 20);
  }, 30_000);

  it("the plan reads the board first and builds its dimensions from the snapshot's own outline", async () => {
    const plan = planFixtureInstruction(SENTENCE);
    expect(plan.kind).toBe("board-then");
    const facts = boardFacts(JSON.stringify({ output: { mechanical: { units: "mm", outline: { kind: "rect", originMm: { x: 10, y: 20 }, widthMm: 30, heightMm: 40, pointsMm: [], pointCount: 0 }, mountingHoles: [{ id: "fp-h1", reference: "H1", positionMm: { x: 12, y: 22 } }], mountingHoleCount: 1 } } }));
    expect(facts.outline).toEqual({ originMm: { x: 10, y: 20 }, widthMm: 30, heightMm: 40 });
    expect(facts.mountingHoles).toEqual([{ id: "fp-h1", reference: "H1", positionMm: { x: 12, y: 22 } }]);
    const built = (plan as Extract<ReturnType<typeof planFixtureInstruction>, { kind: "board-then" }>).build(facts);
    expect("toolId" in built && built.toolId).toBe("sirkit.pcb.dimension");
    const edits = ("args" in built ? built.args.edits : []) as Array<Record<string, unknown>>;
    expect(edits).toHaveLength(3); // the two board dimensions, then one per hole the snapshot named
    expect(edits[0]).toMatchObject({ op: "add", kind: "horizontal", a: { x: 10 * NM_PER_MM, y: 20 * NM_PER_MM }, b: { x: 40 * NM_PER_MM, y: 20 * NM_PER_MM } });
    expect(edits[1]).toMatchObject({ op: "add", kind: "vertical", a: { x: 10 * NM_PER_MM, y: 20 * NM_PER_MM }, b: { x: 10 * NM_PER_MM, y: 60 * NM_PER_MM } });
    expect(edits.every((edit) => edit.offsetNm !== 0), "a dimension line must stand clear of what it measures").toBe(true);
    // [B18-E E11] the read the plan depends on can be refused (the full snapshot exceeded the model budget on the real board,
    // which is why the bounded mechanical read exists): the plan then says so instead of inventing coordinates.
    const oversized = boardFacts(JSON.stringify({ ok: false, status: "output_too_large_for_model", note: "The tool result exceeded the model transfer budget; ask a narrower question." }));
    expect(oversized, "a refused or oversized read is answered in words, never guessed around").toEqual({ outline: null, mountingHoles: [] });
    // a board with no outline is answered in words, never dimensioned at invented coordinates
    expect((plan as Extract<ReturnType<typeof planFixtureInstruction>, { kind: "board-then" }>).build({ outline: null, mountingHoles: [] })).toMatchObject({ reply: expect.stringContaining("no outline") });
  });

  it("end to end under EXPLICIT autonomy: one confirmation-only grant over the board's real extents; nothing commits by itself", async () => {
    const c = await composition("execute_explicit_tier1");
    const head = headOf(c).headSequence;
    const snapshot = buildAIPcbSnapshot(c.history.committedPresent) as unknown as { board: { outline: { origin: { x: number; y: number }; width: number; height: number } } };
    const outline = snapshot.board.outline;
    const run = await runWithAdapter(c, new FixtureAgentAdapter("openai"), { message: SENTENCE });

    expect(run.grants, "one side-effecting artifact per run").toHaveLength(1);
    const grant = run.grants[0]!;
    expect(grant.binding.operation.family).toBe("pcb.dimension");
    expect(grant.binding.operation.tier).toBe(1);
    expect(grant.binding.operation.decision, "OD-11: dimensions always ask, even under explicit autonomy").toBe("preview_then_confirm");
    expect(grant.binding.operation.requiresHumanApproval).toBe(true);
    expect(run.rituals, "a confirmation-only change is never auto-run").toEqual([]);
    expect(headOf(c).headSequence, "nothing is committed until a human confirms").toBe(head);

    const operations = grant.binding.proposal.operations as Array<{ kind: string; dimension?: { kind?: string; a?: { x: number; y: number }; b?: { x: number; y: number } } }>;
    expect(operations.map((operation) => operation.kind)).toEqual(["add_dimension", "add_dimension"]); // the fixture has no holes
    const left = Math.round(outline.origin.x * NM_PER_MM), top = Math.round(outline.origin.y * NM_PER_MM);
    const right = Math.round((outline.origin.x + outline.width) * NM_PER_MM), bottom = Math.round((outline.origin.y + outline.height) * NM_PER_MM);
    expect(operations[0]!.dimension).toMatchObject({ kind: "horizontal", a: { x: left, y: top }, b: { x: right, y: top } });
    expect(operations[1]!.dimension).toMatchObject({ kind: "vertical", a: { x: left, y: top }, b: { x: left, y: bottom } });
    // the board was READ before it was dimensioned: the snapshot tool ran first in this very run
    const started = run.events.filter((event) => event.type === "tool_started").map((event) => String((event as { toolId?: unknown }).toolId));
    expect(started).toEqual(["sirkit.pcb.mechanical-inspect", "sirkit.pcb.dimension"]);
  }, 40_000);
});
