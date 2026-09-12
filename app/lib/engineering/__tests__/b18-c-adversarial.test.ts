/**
 * [B18-C I9] Scenario 7 — adversarial conditions a granted execution refuses
 * with nothing committed (the B18-B suites pin the server side already: an
 * altered proposal, a membership revision or role change, forged ids at the
 * route, mint idempotency and cancellation — [B18-E E0] not a revocation after
 * the mint or a provider's re-emitted call, which B18-E proves):
 *
 *  - a change OUTSIDE the semantic revision between the mint and the Confirm
 *    (an unused padstack definition) is refused `stale-revision`: the revision
 *    alone cannot see it, but the editor board is no longer the canonical head
 *    (the lineage digest covers every board field but derived zone fills), so
 *    the whole-board digest the grant pins is already enforced by the head
 *    check — no separate digest check (which would add only false refusals);
 *  - a forged grant arriving at the page is dropped by the SAFE receiver, and
 *    the ritual refuses it before anything durable;
 *  - every B18-C family resolves its targets by NAME, never from the selection:
 *    a selection change between mint and tender cannot alter what executes.
 */
import { describe, expect, it } from "vitest";
import { mmToNm } from "../../pcb/units";
import { pcbRevisionId } from "../../pcb/revision";
import { executionBoardDigest } from "../execution-grant";
import { DEFAULT_SILK_STROKE_NM, DEFAULT_SILK_TEXT_HEIGHT_NM } from "../../pcb/silk/types";
import { DIMENSION_DEFAULTS } from "../../pcb/dimensions/commands";
import { buildExecutionOperations, type ExecutionPlan } from "../execution-operations";
import { receiveExecutionGrantReadyEvent } from "../../project/execution-grant-events";
import { tenderConfirmedExecution } from "../../project/granted-execution-controller.internal";
import { SCOPE, call, composition, fixtureBoard, headOf, movesBy, r3Of, ritual, runScenario, type Composed } from "./b18c-harness";

const moveScript = (c: Composed) => (move: string) => [() => ({ toolCalls: [call("c1", move, movesBy(c, 2))] }), () => ({ text: "done" })];

describe("B18-C I9 — adversarial conditions (scenario 7)", () => {
  it("a change outside the semantic revision between the mint and the Confirm is refused by the head check (the revision cannot see it; the whole-board digest could) — nothing committed, no journal entry", async () => {
    const c = await composition("proposal_only");
    const { grants } = await runScenario(c, moveScript(c));
    const grant = grants[0]!;
    c.history.applyDerived("an unused padstack definition", (draft) => {
      (draft.padstacks ??= []).push({ id: "ps-unused", name: "Via 0.8/0.4", kind: "via", outerNm: 800_000, drillNm: 400_000, tented: true, zoneConnect: "solid" });
    });
    expect(pcbRevisionId(c.history.committedPresent)).toBe(grant.binding.base.pcb!.pcbRevisionId); // the revision cannot see it
    expect(executionBoardDigest(c.history.committedPresent)).not.toBe(grant.binding.base.pcb!.boardDigest); // the pinned whole-board digest can
    const x0 = r3Of(c).at.x;
    expect(await tenderConfirmedExecution(ritual(c, grant))).toMatchObject({ ok: false, code: "stale-revision", message: expect.stringMatching(/not the canonical session head/) });
    expect(await c.journal.lookupByGrant(grant.grantId)).toMatchObject({ kind: "absent" });
    expect(r3Of(c).at.x).toBe(x0);
  }, 30_000);

  it("a forged grant is dropped by the page's SAFE receiver and refused by the ritual before anything durable", async () => {
    const c = await composition("proposal_only");
    const { grants, events } = await runScenario(c, moveScript(c));
    const event = JSON.parse(JSON.stringify(events.find((item) => item.type === "execution_grant_ready"))) as { grant: { binding: { proposal: { preview: { after: string } } } } };
    event.grant.binding.proposal.preview.after = "R3 at (0.000, 0.000) mm"; // what the human would be shown, forged
    expect(receiveExecutionGrantReadyEvent(event as never)).toBeNull();
    const forged = JSON.parse(JSON.stringify(grants[0]!)) as typeof grants[number];
    forged.binding.proposal.preview.after = "R3 at (0.000, 0.000) mm";
    const head = headOf(c).headSequence;
    expect(await tenderConfirmedExecution(ritual(c, forged))).toMatchObject({ ok: false, code: "grant-invalid" });
    expect(await c.journal.lookupByGrant(forged.grantId)).toMatchObject({ kind: "absent" });
    expect((await c.store.load(SCOPE, forged.grantId, c.now()))!.record.state.status).toBe("issued");
    expect(headOf(c).headSequence).toBe(head);
  }, 30_000);

  it("every B18-C family resolves its targets by NAME — a live selection that differs from anything cannot alter what executes", async () => {
    const board = fixtureBoard();
    const [r3, r4] = ["R3", "R4"].map((ref) => board.footprints.find((f) => f.ref === ref)!);
    const plans: Array<[string, ExecutionPlan]> = [
      ["move", { family: "pcb.move-footprint", moves: [{ footprintId: r3!.id, x: r3!.at.x + mmToNm(1), y: r3!.at.y }] }],
      ["rotate/flip", { family: "pcb.rotate-side-footprint", targets: [{ footprintId: r3!.id, rotationDeg: 90, side: "top" }] }],
      ["arrange", { family: "pcb.arrange", mode: "align", footprintIds: [r3!.id, r4!.id], edge: "left" }],
      ["silk text", { family: "pcb.silkscreen-text", edits: [{ op: "add", text: "REV B", layer: "silkTop", atNm: { x: mmToNm(10), y: mmToNm(10) }, heightNm: DEFAULT_SILK_TEXT_HEIGHT_NM, strokeWidthNm: DEFAULT_SILK_STROKE_NM }] }],
      ["dimension", { family: "pcb.dimension", edits: [{ op: "add", kind: "horizontal", a: { x: mmToNm(5), y: mmToNm(20) }, b: { x: mmToNm(15), y: mmToNm(20) }, offsetNm: mmToNm(2), ...DIMENSION_DEFAULTS }] }],
    ];
    for (const [label, plan] of plans) {
      const built = buildExecutionOperations(board, plan);
      if (!built.ok) throw new Error(`${label}: ${built.message}`);
      expect(built.targets, label).toMatchObject({ resolvedFrom: "named", selectionDigest: null });
    }
    const c = await composition("proposal_only");
    const { grants } = await runScenario(c, moveScript(c));
    const x0 = r3Of(c).at.x;
    expect(await tenderConfirmedExecution({ ...ritual(c, grants[0]!), liveSelectionDigest: () => "eng1-a-different-selection" })).toMatchObject({ ok: true, status: "committed" });
    expect(r3Of(c).at.x).toBe(x0 + mmToNm(2));
  }, 30_000);
});
