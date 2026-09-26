/**
 * [B21 A review] REAL sealed artifacts of the four proposed-action families, produced by the PRODUCTION sealers (never a synthetic
 * shape): a Tier 1 proposal (`sealTier1Proposal`), a component-replacement proposal (`assembleReplacementProposal`, the only caller of
 * its sealer), a bounded PCB edit proposal (`createSealedPcbEditProposal`, the only minting path) and a routing layout candidate
 * (`produceRoutingCandidate`). The contracts suite wraps each one verbatim, so the contract is proven against what a specialist
 * really produces - the earlier fixture-only proof missed that three families carry an authorization binding at their top level.
 * Not a test file. Fixtures copied from the families' own suites (b16-0-1, b14-1, b15-2-3, b17-e); the head marks are hand-built
 * in the canonical mark grammar (`lin1-` lineage, `eng1-` digest) because no session is needed to seal.
 */
import { kicadPinWorldPos } from "@/app/lib/geometry";
import type { ComponentAuthorityRecord } from "@/app/lib/engineering/component-authority";
import { buildAuthorizationBinding } from "@/app/lib/engineering/proposal-authorization";
import type { PublishedSymbolPinFacts } from "@/app/lib/engineering/replacement-pin-facts";
import { assembleReplacementProposal, replacementHeadDigestFor } from "@/app/lib/engineering/replacement-proposal-assembler";
import type { SealedReplacementProposal } from "@/app/lib/engineering/replacement-proposals";
import { schematicStateDigest } from "@/app/lib/engineering/schematic-model";
import { compileTier1Proposal } from "@/app/lib/engineering/schematic-plans";
import { sealTier1Proposal, type SealedTier1Proposal, type Tier1ProposalHeadMark } from "@/app/lib/engineering/schematic-proposals";
import { engineeringDigest } from "@/app/lib/engineering/stable";
import type { KicadPin } from "@/app/lib/kicad/types";
import { makeBoard, makeInstance, makeResistorDef } from "@/app/lib/pcb/__tests__/autoplace-fixture";
import { produceRoutingCandidate, type RoutingLayoutCandidate } from "@/app/lib/pcb/candidates/layout-candidate";
import { DEFAULT_PRESET_ID } from "@/app/lib/pcb/drc/presets";
import { createSealedPcbEditProposal } from "@/app/lib/pcb/proposal/pcb-edit-proposal-service";
import type { SealedPcbEditProposal } from "@/app/lib/pcb/proposal/sealed-pcb-edit-proposal";
import { pcbRevisionId } from "@/app/lib/pcb/revision";
import { createEmptyBoard, type PcbBoard, type Track } from "@/app/lib/pcb/types";
import type { SchematicState } from "@/lib/schematic-types";

export const SCOPE = { tenantId: "local", projectId: "p21-sealed", branchId: "main" } as const;
export const NOW = 1_700_000_000_000;
export const PRINCIPAL = "user-fixture";

/** A canonical head mark in the mark grammar the sealers validate (`validateSchematicCanonicalMark`); the replacement assembler
 *  binds the mark's digest to its own reference content (`replacementHeadDigestFor`), the Tier 1 sealer to the state digest. */
export function headMarkFor(canonicalStateDigest: string): Tier1ProposalHeadMark {
  return { lineageId: `lin1-${engineeringDigest({ fixture: "lineage" }).slice(5)}`, headSequence: 0, canonicalStateDigest };
}

// ── Tier 1 (b16-0-1's recipe) ───────────────────────────────────────────────

export function sealedTier1Proposal(): SealedTier1Proposal {
  const state: SchematicState = {
    components: [
      { id: "R1", type: "resistor", x: 100, y: 100, rotation: 0, value: "1k" },
      { id: "R2", type: "resistor", x: 100, y: 300, rotation: 0, value: "2k" },
    ],
    wires: [],
  };
  const compilation = compileTier1Proposal(state, { ops: [{ op: "set-value", target: "R1", value: "4k7" }], pinsByPartId: new Map() });
  const outcome = sealTier1Proposal({
    state, compilation, provenance: { provider: "anthropic", note: "n", instruction: "i" }, now: NOW,
    scope: { ...SCOPE, headMark: headMarkFor(schematicStateDigest(state)) },
    authorization: buildAuthorizationBinding({ principalId: PRINCIPAL, membershipRevision: "membership:rev-7", scope: SCOPE }),
  });
  if (outcome.kind !== "sealed") throw new Error(`the Tier 1 fixture must seal: ${JSON.stringify(outcome.blockers)}`);
  return outcome.proposal;
}

// ── Component replacement (b14-1's recipe) ──────────────────────────────────

function pin(number: string, name: string, xMm: number): KicadPin {
  return { number, name, type: "passive", position: { x: xMm, y: 0 }, orientation: 0, length: 2.54 };
}
export const PART_PINS: readonly KicadPin[] = [pin("1", "A", -2.5), pin("2", "B", 2.5)];
const U1 = { id: "u1-id", partId: "lib:part-a", x: 300, y: 100, rotation: 0 as const, refDes: "U1", value: "MCU", atomicPartRevisionId: "rev-old", symbolAssetVersionId: "sym-old" };
export function replacementState(): SchematicState {
  const pin1 = kicadPinWorldPos(U1, PART_PINS[0]!);
  return { components: [], kicadComponents: [{ ...U1 }], wires: [{ id: "w1", vertices: [{ x: pin1.x - 60, y: pin1.y }, pin1] }], netLabels: [] };
}
export function authorityRecord(): ComponentAuthorityRecord {
  return {
    authorityRecordId: "auth:u1-id", componentId: "u1-id", projectId: SCOPE.projectId, authorityRevision: "rev-new",
    selectedPart: { mpn: "lib:part-b", manufacturer: "Fixture Semiconductor", provenance: "physical-binding" },
    lifecycle: "selected", approval: "approved", freshness: "current", conflict: "none",
    footprintAsset: "available", mappingVerification: "verified",
    exactAuthority: { atomicPartRevisionId: "rev-new", mpn: "lib:part-b", manufacturer: "Fixture Semiconductor", symbolAssetVersionId: "sym-new", footprintAssetVersionId: "fp-new", mappingCertificateId: "cert-new", selectionRecordId: "sel-new" },
    evidenceRefs: ["binding:fixture:u1-id"],
  };
}
export function pinFacts(rev: string, symbol: string, certificateId = "cert-new"): PublishedSymbolPinFacts {
  const ids = PART_PINS.map((entry) => `pin-${entry.number}`);
  return {
    atomicPartRevisionId: rev, symbolAssetVersionId: symbol, pins: [...PART_PINS],
    certificate: { id: certificateId, symbolVersionId: symbol, footprintVersionId: "fp-new", symbolPinIds: ids, missingTerminalIds: [], missingSymbolPinIds: [], missingPadNumbers: [], ambiguous: [], state: "approved" },
    symbolPinIds: ids,
  };
}

export function sealedReplacementProposal(): SealedReplacementProposal {
  const state = replacementState();
  const outcome = assembleReplacementProposal({
    state, componentId: "u1-id",
    authority: { records: [authorityRecord()], candidates: [] },
    scope: { ...SCOPE, headMark: headMarkFor(replacementHeadDigestFor(state, SCOPE)) },
    authorization: buildAuthorizationBinding({ principalId: PRINCIPAL, scope: SCOPE }),
    currentPinFacts: pinFacts("rev-old", "sym-old", "cert-old"),
    targetPinFacts: pinFacts("rev-new", "sym-new"),
    provenance: { provider: "openai", note: "n", instruction: "i" },
    now: NOW,
  });
  if (outcome.kind !== "sealed") throw new Error(`the replacement fixture must seal: ${JSON.stringify(outcome)}`);
  return outcome.proposal;
}

// ── Bounded PCB edit (b15-2-3's recipe) ─────────────────────────────────────

export function sealedPcbEditProposal(): SealedPcbEditProposal {
  const board = createEmptyBoard();
  board.outline = { kind: "rect", width: 100_000_000, height: 80_000_000, origin: { x: 0, y: 0 } };
  board.nets.push({ id: 1, name: "NET1" });
  board.tracks = [{ id: "t1", layer: "copperTop", width: 400_000, start: { x: 10_000_000, y: 10_000_000 }, end: { x: 20_000_000, y: 10_000_000 }, netId: 1 }];
  const created = createSealedPcbEditProposal({
    payload: { intent: "widen NET1", operations: [{ kind: "update_track", trackId: "t1", widthNm: 500_000 }] },
    board, validationPolicy: { presetId: DEFAULT_PRESET_ID },
    scope: { ...SCOPE, boardInstanceId: "board-1" },
    base: { canonicalResource: { resourceId: "canonical:p21-sealed", contentDigest: "d" }, historyHead: { sequence: 0, label: null }, lineageId: "lin-x" },
    actor: { actorId: "agent:anthropic", kind: "ai" }, effectiveActor: { actorId: PRINCIPAL, kind: "human" },
    discovery: { digest: "x", contextDigest: "y" }, provenance: { provider: "anthropic", model: "agent-tool-loop", runId: "run-1" },
    nonce: "n0n6e0000000000a", now: NOW,
  });
  if (!created.ok) throw new Error(`the PCB fixture must seal: ${created.code} ${created.detail}`);
  return created.proposal;
}

// ── Routing layout candidate (b17-e's recipe) ───────────────────────────────

const MM = 1_000_000;
export const track = (id: string, netId: number, x1: number, y1: number, x2: number, y2: number, extra: Partial<Track> = {}): Track => ({ id, layer: "copperTop", netId, start: { x: x1 * MM, y: y1 * MM }, end: { x: x2 * MM, y: y2 * MM }, width: 250_000, ...extra } as Track);
export function routedBoard(): PcbBoard {
  const def = makeResistorDef();
  const b = makeBoard(40, 30, [
    makeInstance("r1", def, { x: 5, y: 5 }, { "1": 1, "2": 2 }),
    makeInstance("r2", def, { x: 30, y: 22 }, { "1": 1, "2": 0 }),
    makeInstance("r3", def, { x: 8, y: 24 }, { "1": 2, "2": 0 }),
  ], 2);
  b.tracks = [track("t-auto-1", 1, 5, 5, 30, 22, { source: "autorouter" }), track("t-locked-1", 1, 5, 5, 5, 10, { source: "human", locked: true })];
  return b;
}

export function sealedLayoutCandidate(): RoutingLayoutCandidate {
  const board = routedBoard();
  const candidate = produceRoutingCandidate({
    board, producer: "agent", netIds: [1], clock: () => "2026-09-24T12:00:00.000Z",
    response: {
      ok: true, sourceRevision: pcbRevisionId(board), routeAttemptId: "ra-1",
      routes: { tracks: [track("n1-a", 1, 5, 5, 20, 20, { source: "autorouter" }), track("n1-b", 1, 20, 20, 30, 22, { source: "autorouter" })], vias: [] },
      job: { status: "partial" }, completion: { acceptedPasses: 1, passes: [], failures: [] },
      stats: { elapsedMs: 120, tracksImported: 2, viasImported: 0 }, engine: { name: "Freerouting", version: "2.1" },
    },
  });
  if ("ok" in candidate) throw new Error(`the layout fixture must seal: ${candidate.code}`);
  return candidate;
}

/** The four, keyed by family, as plain records for the wrap. */
export function sealedArtifacts(): { tier1: SealedTier1Proposal; replacement: SealedReplacementProposal; pcb: SealedPcbEditProposal; layout: RoutingLayoutCandidate } {
  return { tier1: sealedTier1Proposal(), replacement: sealedReplacementProposal(), pcb: sealedPcbEditProposal(), layout: sealedLayoutCandidate() };
}
