// @vitest-environment jsdom
/**
 * [B18-D I5] The confirmation card (chat-execution-ux.md §1 items 1–5 and 9; §2 R1-3 and R1-4): "what changes" shows
 * only digest-covered content — the tier, the family, the preview, the targets as references and the exact operations;
 * everything else (why a confirmation is required, what you asked, the scope, the minter's note) sits in a separate
 * "As issued by the server" block and never inside the change. The card stays inert (no inputs; Confirm and Cancel take
 * no arguments), renders any grant shape without throwing, and keeps its pinned copy.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GrantedExecutionDialog } from "../GrantedExecutionDialog";
import type { PublicExecutionGrant } from "@/app/lib/engineering/execution-grant";
import type { PcbBoard } from "@/app/lib/pcb/types";

afterEach(cleanup);

const board = { footprints: [{ id: "fp-r3", ref: "R3" }] } as unknown as PcbBoard;
function grant(over: { operations?: unknown[]; noTargets?: boolean } = {}): PublicExecutionGrant {
  return {
    grantId: `xg-${"1".repeat(32)}`,
    binding: {
      operation: { family: "pcb.move-footprint", tier: 1, decision: "preview_then_confirm", autonomy: { mode: "proposal_only", revision: 1 } },
      targets: over.noTargets ? undefined : { resolvedFrom: "named", objectIds: ["fp-r3"], netIds: [], kinds: ["footprint"] },
      proposal: { operationCount: 1, operations: over.operations ?? [{ kind: "move_footprint", footprintId: "fp-r3", at: { x: 52_000_000, y: 47_480_000 } }], preview: { before: "R3 at (50.000, 47.480) mm", after: "R3 at (52.000, 47.480) mm", warnings: [] } },
      base: { pcb: { pcbRevisionId: "pcb2-0123456789abcdef0123456789", headSequence: 7, validationPolicy: { presetId: "jlcpcb-2l", presetVersion: "2" } } },
      scope: { projectId: "proj-SCOPE-MARK", branchId: "main" },
      instruction: { excerpt: "EXCERPT-MARK please move it", explicit: { proven: false, grammarId: "pcb.move-footprint", grammarVersion: "1.4.0", coverage: "unproven", derivedOperationsDigest: null } },
      expiresAt: "2026-09-11T12:10:00.000Z",
    },
  } as unknown as PublicExecutionGrant;
}
const noop = (): void => undefined;
const text = (testId: string): string => screen.getByTestId(testId).textContent ?? "";

describe("B18-D I5 — the confirmation card", () => {
  it("the change block shows only digest-covered content: tier, family, preview, targets as references and the exact operations", () => {
    render(<GrantedExecutionDialog grant={grant()} note={null} busy={false} disableReason={null} onConfirm={noop} onCancel={noop} board={board} />);
    const change = text("granted-execution-change");
    expect(text("granted-execution-tier")).toBe("Tier 1 · reversible edit");
    expect(change).toContain("pcb.move-footprint");
    expect(text("granted-execution-preview")).toContain("After R3 at (52.000, 47.480) mm");
    expect(text("granted-execution-targets")).toBe("Targets R3 · Nets named: none");
    expect(text("granted-execution-operations")).toBe("Place R3 at (52.000, 47.480) mm");
  });

  it("what you asked, why a confirmation is required, the scope and the note sit in the 'As issued by the server' block — never inside the change", () => {
    render(<GrantedExecutionDialog grant={grant()} note="NOTE-MARK retry guard" busy={false} disableReason={null} onConfirm={noop} onCancel={noop} board={board} />);
    const change = text("granted-execution-change");
    const context = text("granted-execution-context");
    expect(context).toContain("As issued by the server");
    expect(text("granted-execution-reason")).toBe("Required — NOTE-MARK retry guard");
    expect(context).toContain("You asked (as recorded): “EXCERPT-MARK please move it”");
    expect(context).toContain("proj-SCOPE-MARK");
    expect(text("granted-execution-note")).toBe("NOTE-MARK retry guard");
    for (const mark of ["EXCERPT-MARK", "NOTE-MARK", "proj-SCOPE-MARK", "Required —", "As issued"]) expect(change, mark).not.toContain(mark);
  });

  it("renders any grant shape without throwing: a hostile operation is 'not displayable'; the minimal grant shape still renders", () => {
    render(<GrantedExecutionDialog grant={grant({ operations: [{ kind: 42 }] })} note={null} busy={false} disableReason={null} onConfirm={noop} onCancel={noop} />);
    expect(text("granted-execution-operations")).toBe("operation ? (not displayable)");
    cleanup();
    render(<GrantedExecutionDialog grant={grant({ noTargets: true })} note={null} busy={false} disableReason={null} onConfirm={noop} onCancel={noop} />);
    expect(text("granted-execution-targets")).toBe("Targets (not displayable) · Nets named: (not displayable)");
    expect(text("granted-execution-card")).toMatch(/pcb\.move-footprint, 1 operation\b/);
  });

  it("stays inert: no inputs; Confirm and Cancel take no arguments; a disable reason blocks Confirm; the pinned copy is kept", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const { rerender } = render(<GrantedExecutionDialog grant={grant()} note={null} busy={false} disableReason={null} onConfirm={onConfirm} onCancel={onCancel} board={board} />);
    expect(document.body.querySelectorAll("input, textarea, select, [contenteditable]").length).toBe(0);
    const card = text("granted-execution-card");
    expect(card).toContain("Nothing has been changed yet.");
    expect(card).toContain("exactly ONE canonical PCB transaction");
    fireEvent.click(screen.getByTestId("granted-execution-confirm"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith();
    fireEvent.click(screen.getByText("Cancel — change nothing"));
    expect(onCancel).toHaveBeenCalledWith();
    rerender(<GrantedExecutionDialog grant={grant()} note={null} busy={false} disableReason="the live board changed since the grant was issued — ask again." onConfirm={onConfirm} onCancel={onCancel} board={board} />);
    expect((screen.getByTestId("granted-execution-confirm") as HTMLButtonElement).disabled).toBe(true);
    expect(text("granted-execution-disable-reason")).toContain("the live board changed");
  });
});

describe("B18-D review — a disabled Confirm is described by its reason", () => {
  it("aria-describedby points at the visible reason", () => {
    render(<GrantedExecutionDialog grant={grant()} note={null} busy={false} disableReason="the board changed since the assistant prepared it" onConfirm={() => undefined} onCancel={() => undefined} />);
    const confirm = screen.getByTestId("granted-execution-confirm") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    const reason = screen.getByTestId("granted-execution-disable-reason");
    expect(reason.textContent).toContain("the board changed since the assistant prepared it");
    expect(confirm.getAttribute("aria-describedby")).toBe(reason.id);
  });
});
