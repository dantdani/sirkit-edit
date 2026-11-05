// @vitest-environment jsdom
/**
 * [PR-L6 integration, 2026-10-19] Test-integrity review F5 of increment 6: the resolution review DIALOG's board-impact wiring, rendered.
 *
 * OD-253 item 8: Approve is disabled while the batch's PCB impact loads or cannot be read, with the reason visible, and an assessed
 * impact shows each row's outcome (a footprint change, the re-binding it needs) and what goes stale. The pure view and the controller's
 * fail-closed refusal were tested; the dialog's own wiring (`disabled={busy || approveBlocked !== null}`, the reason line, the rows and
 * the "Goes stale" line) had no render test, and the e2e only reaches the enabled "no PCB" and "unchanged" states.
 *
 *  1. no impact yet, loading and unavailable: Approve is disabled and the reason is shown; Discard stays enabled;
 *  2. an assessed footprint change on a placed board: Approve is enabled, the row carries `data-outcome="footprint_changed"` and says a
 *     re-binding is needed, and the invalidated items are listed.
 *
 * The production view function over a synchronized two-diode board (the m4-board-impact shape); jsdom, no network.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ComponentResolutionReviewDialog } from "../ComponentResolutionReviewDialog";
import { componentResolutionBoardImpactView, type ComponentResolutionReview } from "@/app/lib/project/component-resolution-events";
import { assessResolutionBoardImpact } from "@/app/lib/component-resolution/board-impact";
import { createEmptyBoard, type FootprintInstance, type PcbBoard } from "@/app/lib/pcb/types";
import { schematicEndpointKey, stableNetIdForEndpoints } from "@/app/lib/pcb/integrity";
import { makeBoardRecord } from "@/app/lib/pcb-sync/board";
import { mmToNm } from "@/app/lib/pcb/units";

afterEach(() => cleanup());

const SCOPE = { tenantId: "local", projectId: "m4-dialog", branchId: "main" } as const;
const BOARD_ID = "board:m4-dialog";
const W = { symbolAssetVersionId: "symbolv-d", footprintAssetVersionId: "footprintv-sod123", mappingCertificateId: "map-w" };
const THT = { symbolAssetVersionId: "symbolv-d", footprintAssetVersionId: "footprintv-do35", mappingCertificateId: "map-t" };

/** D1 synchronized with identity W on an unrouted placed board (K on TIMING, A on RA). */
function placedBoard(): PcbBoard {
  const nets = [
    { name: "/root/TIMING", keys: [schematicEndpointKey("kc-d1", "1"), schematicEndpointKey("kc-u1", "6")] },
    { name: "/root/RA", keys: [schematicEndpointKey("kc-d1", "2"), schematicEndpointKey("kc-r1", "2")] },
  ].map((net, index) => ({ id: index + 1, name: net.name, stableId: stableNetIdForEndpoints(net.keys, net.name), endpointKeys: [...net.keys].sort() }));
  const d1: FootprintInstance = {
    id: "kc-d1", ref: "D1", footprintId: W.footprintAssetVersionId,
    def: { libName: "Diode_SMD", name: "D_SOD-123", attributes: { smd: true, throughHole: false, excludeFromPos: false, excludeFromBom: false }, pads: [], graphics: [], bodyBBox: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, models: [], rawSexpr: "" },
    at: { x: mmToNm(20), y: mmToNm(10) }, rotationDeg: 90, side: "top", padNets: { "1": 1, "2": 2 },
    pinPadMappings: [
      { componentInstanceId: "kc-d1", endpointKey: schematicEndpointKey("kc-d1", "1"), symbolPinNumber: "1", padNumbers: ["1"], mappingKind: "electrical", provenance: "library-explicit" },
      { componentInstanceId: "kc-d1", endpointKey: schematicEndpointKey("kc-d1", "2"), symbolPinNumber: "2", padNumbers: ["2"], mappingKind: "electrical", provenance: "library-explicit" },
    ],
    syncIdentity: { componentInstanceId: "kc-d1", bindingRevisionId: "binding-kc-d1", footprintContentDigest: "sha256:sod123", syncPlanId: "plan-1", ...W },
  } as unknown as FootprintInstance;
  return { ...createEmptyBoard(), nets: [createEmptyBoard().nets[0]!, ...nets], footprints: [d1] } as PcbBoard;
}

const REVIEW = {
  proposalId: "cprop-0123456789abcdef", unaffectedComponents: 3, downstream: [], expiresAt: Date.parse("2026-10-19T12:10:00.000Z"),
  items: [{
    componentInstanceId: "kc-d1", refDes: "D1", value: "1N4148", from: "catalog part p-1n4148 (no published exact revision)", to: "1N4148 - DO-35", mode: "part-replacement",
    mapping: ["1 -> 1 cathode (pad 1)", "2 -> 2 anode (pad 2)"], permutation: false, netsKept: ["/root/TIMING", "/root/RA"], warnings: [], established: "pin functions and the package were checked",
    revision: { atomicPartRevisionId: "apr-1n4148-do35", exactMpn: "1N4148", manufacturer: "Example", footprint: "Diode_THT:D_DO-35_SOD27_P7.62mm_Horizontal", catalogPartId: "p-1n4148" },
    polarity: ["cathode: pin 1 -> pin 1 on /root/TIMING"], unchanged: ["its nets"],
  }],
} as unknown as ComponentResolutionReview;

const renderWith = (boardImpact: Parameters<typeof ComponentResolutionReviewDialog>[0]["boardImpact"]) =>
  render(<ComponentResolutionReviewDialog review={REVIEW} boardImpact={boardImpact} busy={false} onApprove={() => undefined} onDiscard={() => undefined} />);

describe("[PR-L6 integration] test-integrity F5: the dialog renders the board impact and gates Approve on it", () => {
  it("1. no impact yet, loading and unavailable: Approve disabled with the visible reason; Discard enabled", () => {
    for (const [impact, reason] of [
      [null, /^Approve is disabled until the batch's PCB impact is assessed\.$/],
      [componentResolutionBoardImpactView({ state: "loading" }), /^Approve is disabled while the project's PCB is read/],
      [componentResolutionBoardImpactView({ state: "unavailable", detail: "PS_NETWORK_UNAVAILABLE: fetch failed" }), /PS_NETWORK_UNAVAILABLE/],
    ] as const) {
      renderWith(impact);
      expect((screen.getByTestId("component-resolution-approve") as HTMLButtonElement).disabled).toBe(true);
      expect(screen.getByTestId("component-resolution-approve-reason").textContent).toMatch(reason);
      expect((screen.getByTestId("component-resolution-discard") as HTMLButtonElement).disabled).toBe(false);
      cleanup();
    }
  });

  it("2. an assessed footprint change: Approve enabled, the row's outcome and its re-binding shown, the invalidated items listed", () => {
    const impact = assessResolutionBoardImpact({
      items: [{ componentInstanceId: "kc-d1", refDes: "D1", target: { footprintFullName: "Diode_THT:D_DO-35_SOD27_P7.62mm_Horizontal", ...THT }, mapping: [{ fromPin: "1", toPin: "1", pads: ["1"] }, { fromPin: "2", toPin: "2", pads: ["2"] }] }],
      basis: { state: "board", boardId: BOARD_ID, record: makeBoardRecord({ ...SCOPE, boardId: BOARD_ID, board: placedBoard(), updatedAt: "2026-10-19T00:00:00.000Z" }), authority: null, latestRelease: null },
    });
    renderWith(componentResolutionBoardImpactView({ state: "assessed", impact }));
    expect((screen.getByTestId("component-resolution-approve") as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByTestId("component-resolution-approve-reason")).toBeNull();
    expect(screen.getByTestId("component-resolution-board-impact").getAttribute("data-state")).toBe("assessed");
    const row = screen.getByTestId("component-resolution-board-impact-row-D1");
    expect(row.getAttribute("data-outcome")).toBe("footprint_changed");
    expect(row.textContent).toContain("re-binding needed");
    expect(screen.getByTestId("component-resolution-board-impact-invalidates").textContent).toMatch(/^Goes stale until Prepare PCB re-runs: .*placement legality.*DRC/);
  });
});
