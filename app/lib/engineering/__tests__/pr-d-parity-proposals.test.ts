/**
 * [PR-D] UI/AI parity for the proposal tools (D.6, D.10 (b)).
 *
 *  - `sirkit.pcb.propose-bounded-edit` has ONE sealer and ONE compiler on both
 *    sides: the AI's tool call seals through `createSealedPcbEditProposal`
 *    (gateway → handlePcbProposeTool), and the human-gated review / apply
 *    RECOMPILES the sealed operations through `compileBoundedPcbEdit` against
 *    the live board and byte-matches every sealed digest
 *    (approved-pcb-mutations.ts:445-461). This suite proves the review's
 *    recompile byte-matches the AI's seal, and that the proposal's candidate
 *    digest IS the revision the editor's own direct move produces — the
 *    proposal describes exactly what the inspector would have done.
 *  - `sirkit.placement.propose` shares ONE producer (`runPlacementCandidate`)
 *    with the preview route and the editor's own candidates; no byte-equal
 *    PROPOSAL digest is claimed and the reason is stated: the candidate's
 *    identity carries its producer and creation time and the engine is
 *    time-bounded. What IS shared (the problem the engine solves from the
 *    board) is pinned.
 *  - The two schematic proposal tools have NO UI producer (the editor only
 *    reviews and applies sealed proposals; it never seals one), so there is no
 *    UI/AI pair to compare — stated here, pinned by the B09/B14 suites.
 */
import { describe, expect, it } from "vitest";
import { mmToNm } from "../../pcb/units";
import { pcbRevisionId } from "../../pcb/revision";
import { compileEdits } from "../../pcb/edit/apply";
import { DEFAULT_PRESET_ID } from "../../pcb/drc/presets";
import { compileBoundedPcbEdit } from "../../pcb/proposal/bounded-edit-compiler";
import { resolvePcbValidationPolicy, verifySealedPcbEditProposalIntegrity } from "../../pcb/proposal/sealed-pcb-edit-proposal";
import { layoutCandidateIntact, runPlacementCandidate } from "../../pcb/candidates/layout-candidate";
import { sirkitToolRegistry } from "../tool-catalog";
import { ACTION_COVERAGE_REGISTRY } from "../action-registry";
import { PROJECT, fixtureBoard, headOf, runContext } from "./b18c-harness";
import { composeFrom, footprintOf, gatewayFor, invokeTool, mark, pair, spyMinter, uiCommit } from "./fixtures/pr-d-parity-harness";

const PROPOSE_TOOL = "sirkit.pcb.propose-bounded-edit";
const PLACEMENT_TOOL = "sirkit.placement.propose";

describe("PR-D parity (b) — the bounded PCB proposal: one sealer, one compiler, the review byte-matches the AI's seal", () => {
  it("the AI's sealed proposal passes the review's integrity check, its recompile against the live board byte-matches every sealed digest, and its candidate digest IS the revision the editor's own set-position produces; sealing moved nothing", async () => {
    const p = await pair();
    const r3 = footprintOf(p.ai, "R3");
    const target = { x: r3.at.x + mmToNm(2), y: r3.at.y };
    const m = spyMinter(p.ai);
    const context = runContext(p.ai);
    const outcome = await invokeTool(p.ai, gatewayFor(p.ai, m.minter), PROPOSE_TOOL, { intent: "move R3 2 mm to the right", operations: [{ kind: "move_footprint", footprintId: r3.id, to: target }] }, "call-propose", context);
    expect(outcome).toMatchObject({ kind: "pcb-proposal", ok: true });
    if (outcome.kind !== "pcb-proposal") throw new Error("unreachable");
    const proposal = outcome.proposal;
    // Nothing moved: a proposal is an inert artifact (no transaction, no head advance, the minter never asked).
    expect(mark(p.ai)).toEqual(p.start);
    expect(m.calls()).toBe(0);
    // The proposal pins the run's base: the live revision, the canonical head and the session lineage.
    const head = headOf(p.ai);
    expect(proposal.base).toMatchObject({ pcbRevisionId: p.start.revision, historyHead: { sequence: head.headSequence }, lineageId: head.lineageId });
    expect(proposal.actor).toMatchObject({ kind: "ai" });
    expect(proposal.effectiveActor).toMatchObject({ kind: "human" });
    // The review's structural check (PcbEditor.tsx:1491, pcb-proposal-events.ts:44) accepts it.
    expect(verifySealedPcbEditProposalIntegrity(proposal)).toMatchObject({ ok: true });
    // The review's recompile (approved-pcb-mutations.ts:445-461) through the SAME compiler byte-matches the AI's seal.
    const policy = resolvePcbValidationPolicy(DEFAULT_PRESET_ID)!;
    expect(proposal.validationPolicy.rulesDigest).toBe(policy.policy.rulesDigest);
    const recompiled = compileBoundedPcbEdit({ board: p.ai.history.committedPresent, rules: policy.rules, baseIdentity: proposal.base.pcbRevisionId, payload: { intent: proposal.intent, operations: proposal.operations } });
    expect(recompiled.ok).toBe(true);
    if (!recompiled.ok) return;
    expect(recompiled.normalizedOperationsDigest).toBe(proposal.operationsDigest);
    expect(recompiled.candidateDigest).toBe(proposal.candidateDigest);
    expect(recompiled.impactDigest).toBe(proposal.impactDigest);
    expect(recompiled.mintedObjectIds).toEqual(proposal.mintedObjectIds);
    // The editor's own direct move produces EXACTLY the proposal's candidate: the proposal describes the inspector's effect.
    await uiCommit(p.ui, [{ op: "set-position", ref: { kind: "footprint", id: r3.id }, atNm: target }]);
    expect(pcbRevisionId(p.ui.history.committedPresent)).toBe(proposal.candidateDigest);
    expect(headOf(p.ui).headSequence).toBe(p.start.head + 1);
  }, 60_000);

  it("the same invalid input refuses the proposal and the editor alike: a locked footprint is a structured blocker on the AI side and a validator refusal on the UI side; an unknown footprint likewise; nothing is sealed, nothing moves", async () => {
    const board = fixtureBoard();
    board.footprints.find((f) => f.ref === "R4")!.locked = true;
    const c = await composeFrom(board);
    const r4 = footprintOf(c, "R4");
    const start = mark(c);
    const m = spyMinter(c);
    const gateway = gatewayFor(c, m.minter);
    const context = runContext(c);
    const locked = await invokeTool(c, gateway, PROPOSE_TOOL, { intent: "move the locked part", operations: [{ kind: "move_footprint", footprintId: r4.id, to: { x: r4.at.x + mmToNm(1), y: r4.at.y } }] }, "call-locked", context);
    expect(locked).toMatchObject({ kind: "proposal-blocked", ok: false });
    if (locked.kind === "proposal-blocked") expect(locked.blockers[0]!.detail).toMatch(/lock/i);
    const unknown = await invokeTool(c, gateway, PROPOSE_TOOL, { intent: "move a ghost", operations: [{ kind: "move_footprint", footprintId: "fp-nope", to: { x: 0, y: 0 } }] }, "call-unknown", context);
    expect(unknown).toMatchObject({ kind: "proposal-blocked", ok: false });
    // The editor's own gate refuses the same two inputs (validate.ts); the AI side cannot propose what the editor refuses.
    expect(compileEdits(c.history.committedPresent, [{ op: "set-position", ref: { kind: "footprint", id: r4.id }, atNm: { x: r4.at.x + mmToNm(1), y: r4.at.y } }]).errors[0]).toMatch(/R4 is locked/);
    expect(compileEdits(c.history.committedPresent, [{ op: "set-position", ref: { kind: "footprint", id: "fp-nope" }, atNm: { x: 0, y: 0 } }]).errors[0]).toMatch(/No footprint fp-nope/);
    expect(mark(c)).toEqual(start);
    expect(m.calls()).toBe(0);
  }, 60_000);
});

describe("PR-D parity (b) — the placement proposal: one shared producer, no byte-equal proposal digest claimed", () => {
  it("the AI's candidate comes from the SAME producer the preview route and the editor use (runPlacementCandidate), solves the SAME problem derived from the board and leaves the board untouched; its identity carries the producer and the creation time, so a UI candidate cannot be byte-equal — stated, not papered over", async () => {
    const c = await composeFrom(fixtureBoard());
    const start = mark(c);
    const registry = sirkitToolRegistry();
    const descriptor = registry.get(PLACEMENT_TOOL)!;
    expect(descriptor.binding).toMatchObject({ status: "bound-proposal", module: "app/lib/pcb/candidates/layout-candidate.ts", symbol: "runPlacementCandidate" });
    const route = ACTION_COVERAGE_REGISTRY.find((record) => record.id === "placement.preview-api")!;
    expect(route.sources).toContain("app/lib/pcb/candidates/layout-candidate.ts");
    expect(route.notes).toMatch(/the editor produces its own candidates in a worker/);
    const m = spyMinter(c);
    const outcome = await invokeTool(c, gatewayFor(c, m.minter), PLACEMENT_TOOL, { candidateCount: 2, maxIterations: 20 }, "call-place", runContext(c));
    expect(outcome).toMatchObject({ kind: "layout-candidate", ok: true, candidate: { kind: "placement", producer: "agent", base: { revision: start.revision } } });
    if (outcome.kind !== "layout-candidate" || outcome.candidate.kind !== "placement") throw new Error("unreachable");
    expect(layoutCandidateIntact(outcome.candidate)).toBe(true);
    expect(mark(c)).toEqual(start);
    expect(m.calls()).toBe(0);
    // The editor-side equivalent over the same board and request: the same problem, a different producer and creation time.
    const editor = runPlacementCandidate({ board: c.history.committedPresent, request: { producer: "editor", projectId: PROJECT, candidateCount: 2, maxIterations: 20, timeoutMs: 10_000 }, clock: () => new Date(c.now()).toISOString() });
    expect(editor.candidate).not.toBeNull();
    if (!editor.candidate) return;
    expect(editor.candidate.problem).toEqual(outcome.candidate.problem);
    expect(editor.candidate.base.revision).toBe(outcome.candidate.base.revision);
    expect(editor.candidate.producer).not.toBe(outcome.candidate.producer);
    // The candidate digest covers producer and createdAt (layout-candidate.ts seal), so the two artifacts are never byte-equal by construction.
    expect(editor.candidate.digest).not.toBe(outcome.candidate.digest);
  }, 60_000);
});
