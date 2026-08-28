/**
 * B14 §G — the replacement review surface (case 53): the dialog displays the
 * complete reviewed identity/impact, states that nothing has changed, and
 * Apply requires an EXPLICIT click through this trusted channel (disabled
 * while busy; never inferred from provider text). The page wiring is
 * source-gated as a supplementary tripwire.
 */

// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ReplacementReviewDialog } from "../ReplacementReviewDialog";
import { REPLACEMENT_PROPOSAL_SCHEMA, type SealedReplacementProposal } from "@/app/lib/engineering/replacement-proposals";
import { buildAuthorizationBinding } from "@/app/lib/engineering/proposal-authorization";

function proposal(): SealedReplacementProposal {
  return {
    // B16.0.1: the current schema constant (v2 — carries the authorization binding).
    schema: REPLACEMENT_PROPOSAL_SCHEMA,
    proposalId: "rprop-abcdef1234567890",
    scope: { tenantId: "local", projectId: "p", branchId: "main", headMark: { lineageId: "lin1-aaaaaaaaaaaaaaaa", headSequence: 3, canonicalStateDigest: "eng1-bbbbbbbbbbbbbbbb" } },
    // B16.0.1 §E: the sealed proposal type requires the authorization binding.
    authorization: buildAuthorizationBinding({ principalId: "user-fixture", scope: { tenantId: "local", projectId: "p", branchId: "main" } }),
    baseSchematicDigest: "eng1-cccccccccccccccc",
    componentInstanceId: "u1-id",
    expectedCurrentPartId: "lib:part-a",
    target: { partId: "lib:part-b", manufacturer: "Fixture Semiconductor", atomicPartRevisionId: "rev-new", symbolAssetVersionId: "sym-new", footprintAssetVersionId: "fp-new", mappingCertificateId: "cert-new" },
    operation: { operationId: "op:x", schemaVersion: 1, units: "px", kind: "schematic_replace_component", componentId: "u1-id", expectedCurrentPartId: "lib:part-a", replacement: { partId: "lib:part-b" }, pinMapping: [], wireEndpointMoves: [], netLabelMoves: [] } as never,
    operationDigest: "eng1-dddddddddddddddd",
    impact: { mode: "pin-identical-substitution", mappingEvidence: "exact-pin-identity+certificate", pinMapping: [{ fromPin: "1", toPin: "1" }], preservedConnections: ["1"], droppedConnections: [], wireEndpointMoves: [], netLabelMoves: [], downstream: ["PCB sync invalidates"], warnings: [] },
    impactDigest: "eng1-eeeeeeeeeeeeeeee",
    authorityResource: { resourceId: "component-authority:p", contentDigest: "eng1-ffffffffffffffff" },
    canonicalResource: { resourceId: "replacement-canonical:p", contentDigest: "eng1-1111111111111111" },
    resourceManifestDigest: "eng1-2222222222222222",
    consumedAuthorityDigest: "eng1-3333333333333333",
    provenance: { provider: "openai", note: "n", instruction: "i" },
    createdAt: 1, expiresAt: 10 * 60 * 1000,
    approvalTier: "destructive",
  };
}

describe("B14 §G — replacement review dialog", () => {
  it("53. displays the reviewed identity/impact, states nothing changed, and applies ONLY on explicit click", () => {
    let applied = 0;
    let canceled = 0;
    render(
      <ReplacementReviewDialog
        proposal={proposal()} busy={false} componentLabel="U1" currentPartLabel="lib:part-a"
        onApply={() => { applied += 1; }} onCancel={() => { canceled += 1; }}
      />,
    );
    expect(screen.getByText(/Nothing has been/)).toBeTruthy();
    expect(screen.getByText("lib:part-b")).toBeTruthy();
    expect(screen.getByText(/Fixture Semiconductor/)).toBeTruthy();
    expect(screen.getByText(/0 dropped/)).toBeTruthy();
    // Rendering the proposal NEVER applies it — only the explicit click does.
    expect(applied).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Apply exact replacement" }));
    expect(applied).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: /Cancel/ }));
    expect(canceled).toBe(1);
    cleanup();
  });

  it("the Apply button is disabled while executing", () => {
    let applied = 0;
    render(
      <ReplacementReviewDialog
        proposal={proposal()} busy={true} componentLabel="U1" currentPartLabel="lib:part-a"
        onApply={() => { applied += 1; }} onCancel={() => {}}
      />,
    );
    const button = screen.getByRole("button", { name: "Applying…" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(applied).toBe(0);
    cleanup();
  });

  it("supplementary tripwire: the page wires the dialog to the approved replacement service and discriminates proposal_ready", () => {
    const page = readFileSync(join(process.cwd(), "app/page.tsx"), "utf8");
    expect(page).toContain("approveAndApplyReplacement({");
    expect(page).toContain("receiveReplacementProposalEvent(");
    expect(page).toContain("<ReplacementReviewDialog");
    // B16.0.1: rewritten to the equivalent-or-stronger form — the consumer now
    // discriminates on the imported CURRENT schema constant (v2), so the gate
    // tracks the schema without pinning a stale literal.
    const controller = readFileSync(join(process.cwd(), 'app/lib/project/replacement-proposal-events.ts'), 'utf8');
    expect(controller).toContain('proposal.schema !== REPLACEMENT_PROPOSAL_SCHEMA');
    expect(controller).toContain('import { REPLACEMENT_PROPOSAL_SCHEMA');
    expect(page).toContain("cancelReplacementProposal");
  });
});
