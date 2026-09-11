// @vitest-environment jsdom
/**
 * [B18-C review 3] Q8 — the confirmation card for a replay grant says WHAT it
 * undoes or redoes instead of "0 operations" (a replay carries a reference,
 * not operations; the confirmed replay applies the referenced record's own
 * operations in one transaction). A builder grant still shows its count.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GrantedExecutionDialog } from "../GrantedExecutionDialog";
import type { PublicExecutionGrant } from "@/app/lib/engineering/execution-grant";

afterEach(cleanup);

function grant(over: { family: string; operationCount: number; replay?: Record<string, unknown> }): PublicExecutionGrant {
  return {
    grantId: `xg-${"1".repeat(32)}`,
    binding: {
      operation: { family: over.family },
      proposal: { operationCount: over.operationCount, preview: { before: "R3 at (8.000, 5.000) mm", after: "R3 at (6.000, 5.000) mm", warnings: [] }, ...(over.replay ? { replay: over.replay } : {}) },
      base: { pcb: { pcbRevisionId: "pcb2-0123456789abcdef0123456789", headSequence: 7, validationPolicy: { presetId: "default", presetVersion: "1" } } },
      scope: { projectId: "p", branchId: "main" },
      instruction: { excerpt: "Could you undo that?" },
      expiresAt: "2026-09-11T12:10:00.000Z",
    },
  } as unknown as PublicExecutionGrant;
}
const noop = (): void => undefined;

describe("B18-C review 3 Q8 — the replay confirmation card", () => {
  it("says which change a replay undoes instead of '0 operations'; a builder grant still shows its operation count", () => {
    render(<GrantedExecutionDialog grant={grant({ family: "pcb.undo-redo-canonical", operationCount: 0, replay: { direction: "undo", referencedTransactionId: "tx:move-1", referencedGrantId: `xg-${"2".repeat(32)}` } })} note={null} busy={false} disableReason={null} onConfirm={noop} onCancel={noop} />);
    const card = screen.getByTestId("granted-execution-card").textContent ?? "";
    expect(card).toMatch(/undo of the assistant's latest change/);
    expect(card).not.toMatch(/0 operations/);
    cleanup();
    render(<GrantedExecutionDialog grant={grant({ family: "pcb.move-footprint", operationCount: 1 })} note={null} busy={false} disableReason={null} onConfirm={noop} onCancel={noop} />);
    expect(screen.getByTestId("granted-execution-card").textContent ?? "").toMatch(/pcb\.move-footprint, 1 operation\b/);
  });
});
