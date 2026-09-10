// @vitest-environment jsdom
/**
 * B16-C.1 — the rework plan a human reviews before deriving a new board
 * revision: carry-forward choices are explicit, per-component and per-net
 * outcomes (with proofs and reasons) are shown, deriving needs an explicit
 * acknowledgement of THIS plan (digest-bound) and is impossible while the
 * server says the derivation is blocked.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BoardRevisionDialog } from "../BoardRevisionDialog";
import type { PcbSyncBoardRevisionPreviewResult } from "@/app/lib/pcb-sync/types";

function preview(status: "ready_to_derive" | "blocked" = "ready_to_derive"): PcbSyncBoardRevisionPreviewResult {
  return {
    resultSchemaVersion: "sirkit.pcb-board-revision-preview.v1", requestId: "rev-1", status, evaluatedAt: "2026-09-09T12:00:00.000Z",
    revisionPlan: {
      planSchemaVersion: "sirkit.pcb-board-revision-plan.v1", planId: "plan-1", planDigest: "pb1-plan-digest-0123456789abcdef", scope: { tenantId: "local", projectId: "p", branchId: "main", designId: "design:p" },
      parent: { boardId: "board:p", revision: "pcb2-parent-revision-000000", digest: "pb1-parent", boardClass: "routed", generation: 0, rootBoardId: "board:p" }, derivedBoardId: "board:p@r1", generation: 1,
      snapshot: { snapshotDigest: "s", schematicRevision: "schematic:2", schematicDigest: "sd", netGraphDigest: "ng" }, carry: { copper: true, placement: true, constraints: true },
      components: [
        { componentInstanceId: "c-u1", referenceDesignator: "U1", outcome: "kept", carried: true, reasons: [], parent: null, next: null },
        { componentInstanceId: "c-j2", referenceDesignator: "J2", outcome: "added", carried: false, reasons: ["not on the parent board; the sync plan adds it"], parent: null, next: null },
      ],
      nets: [
        { stableNetId: "n1", displayName: "VCC", outcome: "copper_retained", proof: { parentEndpoints: ["c-u1::1"], nextEndpoints: ["c-u1::1"], equivalent: true, reason: "same stable net, byte-identical canonical endpoint set" }, copper: { tracks: 3, vias: 1, zones: 0 } },
        { stableNetId: "n2", displayName: "SIG", outcome: "copper_stripped", proof: { parentEndpoints: ["c-u1::2"], nextEndpoints: ["c-u1::2", "c-j2::1"], equivalent: false, reason: "endpoint set changed" }, copper: { tracks: 2, vias: 0, zones: 0 } },
      ],
      outline: { changed: false, kind: "rect" }, constraints: { carried: true, parentProgramHash: null, parentNetClassing: false },
      derived: { revision: "pcb2-derived", digest: "pb1-derived", footprints: 1, tracks: 3, vias: 1, zones: 0, boardClass: "routed" },
      summary: { componentsKept: 1, componentsAdded: 1, componentsRemoved: 0, componentsChanged: 0, netsRetained: 1, netsStripped: 1, netsUnrouted: 0, netsAdded: 0, netsRemoved: 0, tracksRetained: 3, tracksStripped: 2, viasRetained: 1, viasStripped: 0, zonesRetained: 0, zonesStripped: 0 },
      humanReviewRequired: true, requalificationRequired: true, confirmation: "derive_board_revision",
    },
    parentPreflight: { status: "blocked_board_risk", blockers: [], stage8Blocked: true },
    derivedPreflight: { status: status === "blocked" ? "blocked_component_resolution" : "ready_to_apply", blockers: status === "blocked" ? [{ code: "PS_COMPONENT_UNRESOLVED", severity: "blocking", blocking: true, scope: "plan", stableIds: [], displayRefs: [], message: "", remediationCategory: "sync_plan", evidenceRefs: [], causedBy: [], retryability: "after_user_action", helpKey: "" } as never] : [], planId: "sync-plan", planDigest: "sync-digest", operations: [{ kind: "add_component_instance", targetStableId: "c-j2", risk: "unrouted_structural" }] },
  };
}

afterEach(() => cleanup());

describe("BoardRevisionDialog (B16-C.1)", () => {
  it("shows the plan, needs an acknowledgement bound to the plan digest, and derives only then", () => {
    const onDerive = vi.fn(), onCarryChange = vi.fn();
    render(<BoardRevisionDialog open preview={preview()} carry={{ copper: true, placement: true, constraints: true }} busy={false} error={null} onCarryChange={onCarryChange} onDerive={onDerive} onDismiss={() => {}} />);
    expect(screen.getByTestId("board-revision-derived-id").textContent).toContain("board:p@r1 (generation 1)");
    expect(screen.getByTestId("board-revision-component-J2").getAttribute("data-outcome")).toBe("added");
    expect(screen.getByTestId("board-revision-net-VCC").getAttribute("data-outcome")).toBe("copper_retained");
    expect(screen.getByTestId("board-revision-net-SIG").textContent).toContain("endpoint set changed");
    expect(screen.getByTestId("board-revision-status").textContent).toContain("ready");
    expect((screen.getByTestId("board-revision-derive") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("board-revision-acknowledge"));
    expect((screen.getByTestId("board-revision-derive") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId("board-revision-derive"));
    expect(onDerive).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("board-revision-carry-copper"));
    expect(onCarryChange).toHaveBeenCalledWith({ copper: false, placement: true, constraints: true });
  });

  it("a blocked derivation cannot be derived even when acknowledged; a refusal is shown", () => {
    render(<BoardRevisionDialog open preview={preview("blocked")} carry={{ copper: true, placement: true, constraints: true }} busy={false} error="Derivation refused: PS_BOARD_SUPERSEDED" onCarryChange={() => {}} onDerive={() => {}} onDismiss={() => {}} />);
    expect(screen.getByTestId("board-revision-status").textContent).toContain("blocked — PS_COMPONENT_UNRESOLVED");
    fireEvent.click(screen.getByTestId("board-revision-acknowledge"));
    expect((screen.getByTestId("board-revision-derive") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("board-revision-error").textContent).toContain("PS_BOARD_SUPERSEDED");
  });
});
