/**
 * [B18-E E16] The defect scenario 4's browser proof found: a sealed replacement could never be applied on a real project.
 *
 * Measured in the running application. The chat sealed a replacement, the review dialog rendered it correctly, and
 * "Apply exact replacement" was refused with "Fresh server authority or the recompiled plan no longer matches the reviewed
 * proposal; regenerate it." The apply recompiles the proposal from FRESH authority and requires a byte match of
 * `operationDigest` (`approved-replacement-mutations.ts`), and the two sides did not match.
 *
 * The cause is not the authority itself — it is HOW MUCH of it each caller loaded:
 *
 *  - the seal (`/api/chat`) loads authority for EVERY component in the schematic, because the run may inspect any of them;
 *  - the apply (`/api/replacement-authority`) loads it for the ONE component being replaced.
 *
 * Both record sets are sealed verbatim into the authority resource envelope, whose content digest feeds the grant id,
 * which is embedded in the canonical operation — so the same replacement, from the same board and the same authority,
 * digests differently depending on how many OTHER components the caller happened to load. On any project with more than
 * one bound component (the browser journey has nine) every apply was refused. Single-record unit fixtures on both sides
 * hid it.
 *
 * The fix makes the bundle depend on the replacement, not on the caller's breadth: only the target component's records
 * and candidates are sealed. Nothing else about the authority, the target or the evidence changes.
 */
import { describe, expect, it } from "vitest";
import type { SchematicState } from "@/lib/schematic-types";
import type { KicadPin } from "@/app/lib/kicad/types";
import { assembleReplacementProposal, replacementHeadDigestFor } from "../replacement-proposal-assembler";
import type { PublishedSymbolPinFacts } from "../replacement-pin-facts";
import type { ComponentAuthorityRecord } from "../component-authority";
import { FIXTURE_AUTHORITY_VARIANT, FIXTURE_EXACT, validApprovedAggregate } from "./_authority-fixtures";
import { loadComponentAuthorityRecords } from "../component-authority-source";
import { buildAuthorizationBinding } from "../proposal-authorization";
import { matchingAtomicConfirmer } from "./_authority-fixtures";

const SCOPE = { tenantId: "tenant-1", projectId: "project-1", branchId: "main" } as const;
const COMPONENT = "u1-id";
const OTHER = "u2-id";

function pin(number: string, name: string, xMm: number): KicadPin {
  return { number, name, type: "passive", position: { x: xMm, y: 0 }, orientation: 0, length: 2.54 };
}
const PINS: readonly KicadPin[] = [pin("1", "A", -2.5), pin("2", "B", 2.5)];
function pinFacts(rev: string, symbol: string, certificateId: string): PublishedSymbolPinFacts {
  const ids = PINS.map((entry) => `pin-${entry.number}`);
  return {
    atomicPartRevisionId: rev, symbolAssetVersionId: symbol, pins: [...PINS],
    certificate: { id: certificateId, symbolVersionId: symbol, footprintVersionId: FIXTURE_EXACT.footprintAssetVersionId, symbolPinIds: ids, missingTerminalIds: [], missingSymbolPinIds: [], missingPadNumbers: [], ambiguous: [], state: "approved" },
    symbolPinIds: ids,
  };
}
const CURRENT_FACTS = pinFacts("rev-current", "sym-current", "cert-current");
const TARGET_FACTS = pinFacts(FIXTURE_EXACT.atomicPartRevisionId, FIXTURE_EXACT.symbolAssetVersionId, FIXTURE_EXACT.mappingCertificateId);

const SCHEMATIC: SchematicState = {
  components: [], wires: [], netLabels: [],
  kicadComponents: [
    { id: COMPONENT, partId: "lib:part-a", x: 300, y: 100, rotation: 0, refDes: "U1", value: "MCU", atomicPartRevisionId: "rev-current", symbolAssetVersionId: "sym-current" },
    { id: OTHER, partId: "lib:part-b", x: 500, y: 100, rotation: 0, refDes: "U2", value: "REG", atomicPartRevisionId: "rev-current", symbolAssetVersionId: "sym-current" },
  ],
};

const BOARD_SCOPE = { ...SCOPE, boardInstanceId: "board-1", hierarchyPath: ["root"], assemblyVariantIds: [FIXTURE_AUTHORITY_VARIANT] };

/** The records a caller loads when it asks for N components — exactly what the two production callers differ in. */
async function recordsFor(componentIds: readonly string[]): Promise<readonly ComponentAuthorityRecord[]> {
  const aggregates = new Map<string, Awaited<ReturnType<typeof validApprovedAggregate>>>();
  for (const id of componentIds) aggregates.set(id, await validApprovedAggregate(id, { scopeOverrides: { ...BOARD_SCOPE, componentInstanceId: id } }));
  const loaded = await loadComponentAuthorityRecords(
    {
      bindings: { async loadForComponent(scope) { const one = aggregates.get(scope.componentInstanceId); return one ? [one] : []; } },
      atomic: matchingAtomicConfirmer(),
    },
    {
      scope: { tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, branchId: SCOPE.branchId, boardInstanceId: BOARD_SCOPE.boardInstanceId },
      canonicalRevision: replacementHeadDigestFor(SCHEMATIC, SCOPE),
      componentInstanceIds: [...componentIds],
      hierarchyPath: BOARD_SCOPE.hierarchyPath,
      assemblyVariantId: FIXTURE_AUTHORITY_VARIANT,
    },
  );
  if (loaded.status !== "loaded") throw new Error(`authority did not load: ${JSON.stringify(loaded)}`);
  return loaded.records;
}

function seal(records: readonly ComponentAuthorityRecord[]) {
  return assembleReplacementProposal({
    state: SCHEMATIC,
    componentId: COMPONENT,
    authority: { records, candidates: [] },
    scope: { ...SCOPE, headMark: { lineageId: "lin1-a9e2470c11bd8833", headSequence: 3, canonicalStateDigest: replacementHeadDigestFor(SCHEMATIC, SCOPE) } },
    authorization: buildAuthorizationBinding({ principalId: "u-1", membershipRevision: "mbr-1", scope: { ...SCOPE } }),
    currentPinFacts: CURRENT_FACTS,
    targetPinFacts: TARGET_FACTS,
    provenance: { provider: "openai", note: "", instruction: "replace U1" },
    now: 1_000_000,
  });
}

describe("[B18-E E16] a sealed replacement applies whatever else the caller loaded", () => {
  it("the SAME replacement digests the same whether the caller loaded one component's authority or every component's", async () => {
    // The seal (/api/chat) loads every component in the schematic; the apply (/api/replacement-authority) loads one.
    const sealed = seal(await recordsFor([COMPONENT, OTHER]));
    const recompiled = seal(await recordsFor([COMPONENT]));
    if (sealed.kind !== "sealed" || recompiled.kind !== "sealed") throw new Error(`${JSON.stringify(sealed)} / ${JSON.stringify(recompiled)}`);
    // This is exactly the comparison the apply performs before it commits.
    expect(recompiled.proposal.operationDigest, "the operation is the same replacement either way").toBe(sealed.proposal.operationDigest);
    expect(recompiled.proposal.impactDigest).toBe(sealed.proposal.impactDigest);
    expect(recompiled.proposal.authorityResource.contentDigest, "and so is the authority it consumed").toBe(sealed.proposal.authorityResource.contentDigest);
  });

  it("the authority it consumes is the target's own: another component's record can neither change nor contribute to it", async () => {
    const sealed = seal(await recordsFor([COMPONENT, OTHER]));
    if (sealed.kind !== "sealed") throw new Error(sealed.kind);
    const alone = seal(await recordsFor([COMPONENT]));
    if (alone.kind !== "sealed") throw new Error(alone.kind);
    expect(sealed.proposal.consumedAuthorityDigest).toBe(alone.proposal.consumedAuthorityDigest);
    expect(sealed.proposal.target).toEqual(alone.proposal.target);
  });

  it("a caller that loaded NO authority for the target still fails closed — narrowing never invents a record", async () => {
    const blockedResult = seal(await recordsFor([OTHER]));
    expect(blockedResult.kind).toBe("blocked");
  });
});
