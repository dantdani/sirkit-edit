/**
 * B06/B06.1 — deterministic schematic replay + connectivity evidence.
 *
 * Builds the committed artifact JSON from the ACTUAL kernel: every fixture
 * runs the real planners, the real authority adapter, and
 * `applyEngineeringOperations`, records the operations, exact inverses, and
 * semantic digests, and PROVES round-trip identity (apply → inverse-apply
 * reproduces the digest-identical base model). Everything here is pure and
 * timestamp-free, so the artifacts are reproducible byte-for-byte and CI
 * tests pin them to the implementation.
 *
 * Regenerate with: npx tsx scripts/generate-b06-schematic-artifacts.ts
 *   (writes artifacts/ai-control-plane-b06/schematic-replay-fixtures.json and
 *    artifacts/ai-control-plane-b06-1/replacement-connectivity-fixtures.json)
 */

import type { SchematicState } from "@/lib/schematic-types";
import type { KicadPin } from "../kicad/types";
import { createEmptyBoard } from "../pcb/types";
import { applyEngineeringOperations } from "./operations";
import type { ComponentAuthorityRecord } from "./component-authority";
import { buildReadResourceBundle, sealResourceEnvelope, type ReadResourceBundle } from "./resource-envelopes";
import { computeProjectRevision } from "./revision";
import { consumeReplacementAuthority, type VerifiedReplacementAuthority } from "./schematic-authority.internal";
import { schematicSemanticDigest, toCanonicalSchematic } from "./schematic-model";
import { compileTier1Proposal, planSchematicDelete, planSchematicReplacement } from "./schematic-plans";
import { decideProjectionReconciliation, schematicMarkPatch, type ProjectionDecision, type ProjectionDecisionInput } from "./schematic-projection";
import { diffSchematicGraphOps } from "./schematic-graph";
import type { CanonicalProjectState, EngineeringOperation } from "./types";

function pin(number: string, name: string, xMm: number, yMm = 0): KicadPin {
  return { number, name, type: "passive", position: { x: xMm, y: yMm }, orientation: 0, length: 2.54 };
}

const PART_A_PINS: readonly KicadPin[] = [pin("1", "A", -2.5), pin("2", "B", 2.5)];
const PART_B_PINS: readonly KicadPin[] = [pin("1", "A", -2.5), pin("2", "B", 2.5)];
const PART_C_PINS: readonly KicadPin[] = [pin("1", "X", -2.5), pin("2", "Y", 2.5)];
const PART_D_PINS: readonly KicadPin[] = [pin("3", "A", -5), pin("4", "B", 5)];

const SCOPE = { tenantId: "tenant-fixture", projectId: "project-b06-fixture", branchId: "main" } as const;

/** The same connected fixture family the B06/B06.1 test suites exercise. */
export function fixtureState(): SchematicState {
  return {
    components: [
      { id: "R1", type: "resistor", x: 100, y: 100, rotation: 0, value: "1k" },
      { id: "R2", type: "resistor", x: 100, y: 300, rotation: 0, value: "2k" },
    ],
    kicadComponents: [
      { id: "u1-id", partId: "lib:part-a", x: 300, y: 100, rotation: 0, refDes: "U1", value: "10k", atomicPartRevisionId: "rev-old", mappingCertificateId: "cert-old" },
    ],
    wires: [
      { id: "w1", vertices: [{ x: 130, y: 100 }, { x: 280, y: 100 }] },
      { id: "w2", vertices: [{ x: 500, y: 400 }, { x: 560, y: 400 }] },
      { id: "w4", vertices: [{ x: 130, y: 50 }, { x: 130, y: 100 }, { x: 130, y: 150 }] },
    ],
    netLabels: [
      { id: "l1", position: { x: 320, y: 100 }, name: "VOUT", kind: "label", orientation: 0 },
      { id: "l2", position: { x: 500, y: 400 }, name: "VOUT", kind: "label", orientation: 0 },
    ],
  };
}

type FixtureScope = { tenantId: string; projectId: string; branchId: string };

function project(state: SchematicState, scope: FixtureScope = SCOPE): CanonicalProjectState {
  return { schemaVersion: "sirkit.engineering.v1", ...scope, pcb: createEmptyBoard(), schematic: toCanonicalSchematic(state), pinnedAssets: [] };
}

/** A VALID B05.1 authority bundle authorizing u1-id → lib:part-b (rev-new). */
export function fixtureAuthorityBundle(state: SchematicState, scope: FixtureScope = SCOPE): ReadResourceBundle {
  const canonicalProject = project(state, scope);
  const canonicalRevision = computeProjectRevision(canonicalProject).canonicalStateDigest;
  const record: ComponentAuthorityRecord = {
    authorityRecordId: "auth:u1-id",
    componentId: "u1-id",
    projectId: scope.projectId,
    authorityRevision: "rev-new",
    selectedPart: { mpn: "lib:part-b", manufacturer: "Fixture Semiconductor", provenance: "physical-binding" },
    lifecycle: "selected",
    approval: "approved",
    freshness: "current",
    conflict: "none",
    footprintAsset: "available",
    mappingVerification: "verified",
    // [B13] the server-owned exact target identity the verified replacement
    // derives its installed asset IDs from (never caller-chosen).
    exactAuthority: {
      atomicPartRevisionId: "rev-new",
      mpn: "lib:part-b",
      manufacturer: "Fixture Semiconductor",
      symbolAssetVersionId: "sym-new",
      footprintAssetVersionId: "fp-new",
      mappingCertificateId: "cert-new",
      selectionRecordId: "sel-new",
    },
    evidenceRefs: ["binding:fixture:u1-id"],
  };
  const canonicalEnvelope = sealResourceEnvelope({
    resourceId: "res:canonical:fixture",
    kind: "canonical-state",
    ...scope,
    authoritySource: "local-working-copy",
    authorityStatus: "verified",
    sourceVersion: "fixture-1",
    sourceCanonicalRevision: canonicalRevision,
    producer: "b06.1-fixture",
    producerVersion: "1.0.0",
    freshness: "current",
    content: canonicalProject,
  });
  const authorityEnvelope = sealResourceEnvelope({
    resourceId: "res:component-authority:fixture",
    kind: "component-authority-records",
    ...scope,
    authoritySource: "durable-server-board",
    authorityStatus: "verified",
    sourceVersion: "authority-1",
    sourceCanonicalRevision: canonicalRevision,
    producer: "b06.1-fixture",
    producerVersion: "1.0.0",
    freshness: "current",
    content: { records: [record], candidates: [] },
  });
  return buildReadResourceBundle(canonicalEnvelope, [authorityEnvelope]);
}

/** Consume the fixture bundle into branded verified authority (or throw). */
export function fixtureVerifiedAuthority(state: SchematicState, scope: FixtureScope = SCOPE): VerifiedReplacementAuthority {
  const consumed = consumeReplacementAuthority({
    bundle: fixtureAuthorityBundle(state, scope),
    scope,
    expectedCanonicalRevision: computeProjectRevision(project(state, scope)).canonicalStateDigest,
    componentId: "u1-id",
    targetPartId: "lib:part-b",
    target: { atomicPartRevisionId: "rev-new", mappingCertificateId: "cert-new", selectionRecordId: "sel-new" },
  });
  if (!consumed.ok) throw new Error(`fixture authority consumption failed: ${consumed.code} — ${consumed.detail}`);
  return consumed.authority;
}

export interface SchematicReplayFixture {
  fixtureId: string;
  description: string;
  commandId: string;
  operations: EngineeringOperation[];
  inverseOperations: EngineeringOperation[];
  baseSchematicDigest: string;
  resultSchematicDigest: string;
  /** apply(operations) then apply(inverse) reproduces baseSchematicDigest. */
  inverseRoundTripExact: boolean;
  plan?: unknown;
}

export interface SchematicRefusalFixture {
  fixtureId: string;
  description: string;
  refusal: string;
  detail: string;
}

export interface SchematicReplayEvidence {
  schema: "sirkit.b06-schematic-replay-fixtures.v2";
  stateDigest: string;
  fixtures: SchematicReplayFixture[];
  refusals: SchematicRefusalFixture[];
}

function roundTrip(base: CanonicalProjectState, operations: readonly EngineeringOperation[]): { inverse: EngineeringOperation[]; resultDigest: string; exact: boolean } {
  const applied = applyEngineeringOperations(base, operations);
  const reverted = applyEngineeringOperations(applied.project, applied.inverseOperations);
  const digestOf = (candidate: CanonicalProjectState) => schematicSemanticDigest(toCanonicalSchematic(candidate.schematic as never));
  return {
    inverse: applied.inverseOperations,
    resultDigest: digestOf(applied.project),
    exact: digestOf(reverted.project) === digestOf(base),
  };
}

export function buildSchematicReplayEvidence(): SchematicReplayEvidence {
  const state = fixtureState();
  const base = project(state);
  const baseDigest = schematicSemanticDigest(toCanonicalSchematic(state));
  const fixtures: SchematicReplayFixture[] = [];
  const refusals: SchematicRefusalFixture[] = [];

  // 1. Connected kicad delete with deterministic incident cleanup.
  const deletePlan = planSchematicDelete(state, { family: "kicad", componentId: "u1-id" }, PART_A_PINS);
  if (deletePlan.ok) {
    const trip = roundTrip(base, [deletePlan.operation]);
    fixtures.push({ fixtureId: "delete-connected-kicad", description: "Delete U1: removes wire w1 (endpoint on pin 1) and label l1 (on pin 2); w4 (interior vertex) and same-name label l2 survive. Inverse restores at exact indices.", commandId: "schematic.delete-component", operations: [deletePlan.operation], inverseOperations: trip.inverse, baseSchematicDigest: baseDigest, resultSchematicDigest: trip.resultDigest, inverseRoundTripExact: trip.exact, plan: deletePlan.plan });
  }

  // 2. VERIFIED pin-identical replacement — authority consumed from a valid
  // B05.1 resource bundle via the internal adapter; identity + ALL authority
  // fields replaced together; consumed resource ids/digests recorded in the
  // plan AND the operation (durable provenance).
  const verifiedPlan = planSchematicReplacement(state, {
    componentId: "u1-id",
    target: { partId: "lib:part-b", pins: PART_B_PINS, authority: fixtureVerifiedAuthority(state) },
    currentPins: PART_A_PINS,
  });
  if (verifiedPlan.ok) {
    const trip = roundTrip(base, [verifiedPlan.operation]);
    fixtures.push({ fixtureId: "replace-verified-bundle-authority", description: "Replace U1 with a verified pin-identical part. Authority was consumed from a validated B05.1 component-authority bundle (never a caller assertion); stale rev-old/cert-old cannot survive; consumed resource ids+digests travel in the operation.", commandId: "schematic.replace-component", operations: [verifiedPlan.operation], inverseOperations: trip.inverse, baseSchematicDigest: baseDigest, resultSchematicDigest: trip.resultDigest, inverseRoundTripExact: trip.exact, plan: verifiedPlan.plan });
  }

  // 3. Explicit pin-renumbering replacement — wire endpoint AND net-label
  // moves (label l1 rides pin 2 to its mapped position), exactly inverted.
  const mappedPlan = planSchematicReplacement(state, {
    componentId: "u1-id",
    target: { partId: "lib:part-d", pins: PART_D_PINS },
    currentPins: PART_A_PINS,
    explicitPinMapping: [{ fromPin: "1", toPin: "3" }, { fromPin: "2", toPin: "4" }],
  });
  if (mappedPlan.ok) {
    const trip = roundTrip(base, [mappedPlan.operation]);
    fixtures.push({ fixtureId: "replace-explicit-mapping-with-label-move", description: "Replace U1 with a renumbered part via an explicit 1→3/2→4 mapping: wire w1's endpoint AND net label VOUT (l1, on pin 2) move to the mapped pin positions; authority is cleared (none supplied). Inverse moves both back.", commandId: "schematic.replace-component", operations: [mappedPlan.operation], inverseOperations: trip.inverse, baseSchematicDigest: baseDigest, resultSchematicDigest: trip.resultDigest, inverseRoundTripExact: trip.exact, plan: mappedPlan.plan });
  }

  // 4. Property edit + transform as one atomic batch.
  const batch: EngineeringOperation[] = [
    { operationId: "op:fix-props", schemaVersion: 1, units: "px", kind: "schematic_set_component_properties", family: "kicad", componentId: "u1-id", patch: { value: "22k", refDes: "U9" } },
    { operationId: "op:fix-move", schemaVersion: 1, units: "px", kind: "schematic_transform_component", family: "kicad", componentId: "u1-id", x: 400, y: 200, rotation: 90 },
  ];
  const propsTrip = roundTrip(base, batch);
  fixtures.push({ fixtureId: "properties-and-transform", description: "Set U1 value+refDes then move/rotate it in one transaction; inverses restore both exactly.", commandId: "schematic.set-property + schematic.move-rotate", operations: batch, inverseOperations: propsTrip.inverse, baseSchematicDigest: baseDigest, resultSchematicDigest: propsTrip.resultDigest, inverseRoundTripExact: propsTrip.exact });

  // 5. Tier-1 AI proposal compiled all-or-nothing to one canonical batch.
  const tier1 = compileTier1Proposal(state, {
    ops: [
      { op: "set-value", target: "R1", value: "4.7k" },
      { op: "rename", target: "U1", refDes: "U9" },
      { op: "delete", target: "R2" },
    ],
    pinsByPartId: new Map([["lib:part-a", PART_A_PINS]]),
  });
  if (tier1.ok) {
    const tier1Trip = roundTrip(base, tier1.operations);
    fixtures.push({ fixtureId: "tier1-batch", description: "AI tier-1 proposal (set-value + kicad rename + delete) compiled by the all-or-nothing compiler into one atomic transaction, applied only via the sealed-proposal boundary.", commandId: "schematic.edit-tier1-propose → schematic.edit-tier1-apply", operations: tier1.operations, inverseOperations: tier1Trip.inverse, baseSchematicDigest: baseDigest, resultSchematicDigest: tier1Trip.resultDigest, inverseRoundTripExact: tier1Trip.exact });
  }

  // Structured refusals — fail-closed evidence.
  const pinCount = planSchematicReplacement(state, { componentId: "u1-id", target: { partId: "lib:part-c", pins: PART_C_PINS }, currentPins: PART_A_PINS });
  if (!pinCount.ok) refusals.push({ fixtureId: "refuse-pin-count-only", description: "Same pin COUNT but different pin names is never implicit compatibility.", refusal: pinCount.refusal, detail: pinCount.detail });
  const callerClaim = planSchematicReplacement(state, { componentId: "u1-id", target: { partId: "lib:part-b", pins: PART_B_PINS, authority: { status: "verified-atomic", atomicPartRevisionId: "rev-x" } as never }, currentPins: PART_A_PINS });
  if (!callerClaim.ok) refusals.push({ fixtureId: "refuse-caller-claimed-verified", description: "A plain caller-supplied verified-atomic object is never authority — only the internal bundle adapter can mint it.", refusal: callerClaim.refusal, detail: callerClaim.detail });
  const forgedIds = planSchematicReplacement(state, { componentId: "u1-id", target: { partId: "lib:part-b", pins: PART_B_PINS, authority: { status: "catalog-unverified", atomicPartRevisionId: "rev-x" } as never }, currentPins: PART_A_PINS });
  if (!forgedIds.ok) refusals.push({ fixtureId: "refuse-forged-atomic-identifiers", description: "Atomic identifiers on a catalog-unverified marker are refused, never promoted.", refusal: forgedIds.refusal, detail: forgedIds.detail });
  const noPins = planSchematicDelete(state, { family: "kicad", componentId: "u1-id" });
  if (!noPins.ok) refusals.push({ fixtureId: "refuse-delete-without-pins", description: "A kicad delete without supplied catalog pin data cannot compute deterministic cleanup and is refused.", refusal: noPins.refusal, detail: noPins.detail });
  const dropped = planSchematicReplacement(state, { componentId: "u1-id", target: { partId: "lib:part-e", pins: [pin("2", "B", 2.5)] }, currentPins: PART_A_PINS, explicitPinMapping: [{ fromPin: "2", toPin: "2" }] });
  if (!dropped.ok) refusals.push({ fixtureId: "refuse-unacknowledged-drop", description: "Losing a connected pin requires explicit acknowledgement.", refusal: dropped.refusal, detail: dropped.detail });
  const theoryRename = compileTier1Proposal(state, { ops: [{ op: "set-value", target: "R1", value: "9k" }, { op: "rename", target: "R2", refDes: "R9" }], pinsByPartId: new Map() });
  if (!theoryRename.ok) refusals.push({ fixtureId: "refuse-tier1-theory-rename-blocks-all", description: "A theory id-rename is unsupported and blocks the COMPLETE tier-1 proposal — the valid set-value never executes.", refusal: theoryRename.blockers[0].code, detail: theoryRename.blockers.map((blocker) => blocker.detail).join(" ") });

  return { schema: "sirkit.b06-schematic-replay-fixtures.v2", stateDigest: baseDigest, fixtures, refusals };
}

export function renderSchematicReplayEvidence(): string {
  return JSON.stringify(buildSchematicReplayEvidence(), null, 2) + "\n";
}

// ─── B06.1 — replacement connectivity evidence ───────────────────────────────

export interface ReplacementConnectivityEvidence {
  schema: "sirkit.b06-1-replacement-connectivity-fixtures.v1";
  fixtures: SchematicReplayFixture[];
  refusals: SchematicRefusalFixture[];
  /** Verified-authority consumption audit for the bundle fixture. */
  authorityConsumption: {
    consumedResources: Array<{ resourceId: string; contentDigest: string }>;
    manifestDigest: string;
  };
}

export function buildReplacementConnectivityEvidence(): ReplacementConnectivityEvidence {
  const state = fixtureState();
  const base = project(state);
  const baseDigest = schematicSemanticDigest(toCanonicalSchematic(state));
  const fixtures: SchematicReplayFixture[] = [];
  const refusals: SchematicRefusalFixture[] = [];

  // Label-ONLY connectivity (pin 2 has label l1 and no wire) moved safely
  // with the explicit mapping; wire w1 (pin 1) moves too; exact inverse.
  const mapped = planSchematicReplacement(state, {
    componentId: "u1-id",
    target: { partId: "lib:part-d", pins: PART_D_PINS },
    currentPins: PART_A_PINS,
    explicitPinMapping: [{ fromPin: "1", toPin: "3" }, { fromPin: "2", toPin: "4" }],
  });
  if (mapped.ok) {
    const trip = roundTrip(base, [mapped.operation]);
    fixtures.push({ fixtureId: "label-only-connection-moves-safely", description: "Pin 2's connection is label-only (VOUT/l1). The mapped replacement moves the label with the pin; the connection is reported preserved ONLY because the label move is part of the atomic operation, and undo restores its exact position.", commandId: "schematic.replace-component", operations: [mapped.operation], inverseOperations: trip.inverse, baseSchematicDigest: baseDigest, resultSchematicDigest: trip.resultDigest, inverseRoundTripExact: trip.exact, plan: mapped.plan });
  }

  // Acknowledged drop of a label-connected pin: explicit, warned, refused
  // without acknowledgement.
  const onePin = [pin("1", "A", -2.5)];
  const droppedRefused = planSchematicReplacement(state, { componentId: "u1-id", target: { partId: "lib:part-f", pins: onePin }, currentPins: PART_A_PINS, explicitPinMapping: [{ fromPin: "1", toPin: "1" }] });
  if (!droppedRefused.ok) refusals.push({ fixtureId: "refuse-dropped-label-connectivity", description: "Dropping the label-connected pin 2 without acknowledgement refuses the whole replacement.", refusal: droppedRefused.refusal, detail: droppedRefused.detail });
  const droppedAcknowledged = planSchematicReplacement(state, { componentId: "u1-id", target: { partId: "lib:part-f", pins: onePin }, currentPins: PART_A_PINS, explicitPinMapping: [{ fromPin: "1", toPin: "1" }], acknowledgeDroppedPins: ["2"] });
  if (droppedAcknowledged.ok) {
    const trip = roundTrip(base, [droppedAcknowledged.operation]);
    fixtures.push({ fixtureId: "acknowledged-drop-strands-label-explicitly", description: "With pin 2's drop explicitly acknowledged, the replacement proceeds; the stranded VOUT label is surfaced in the plan warnings, never silently preserved.", commandId: "schematic.replace-component", operations: [droppedAcknowledged.operation], inverseOperations: trip.inverse, baseSchematicDigest: baseDigest, resultSchematicDigest: trip.resultDigest, inverseRoundTripExact: trip.exact, plan: droppedAcknowledged.plan });
  }

  const authority = fixtureVerifiedAuthority(state);
  return {
    schema: "sirkit.b06-1-replacement-connectivity-fixtures.v1",
    fixtures,
    refusals,
    authorityConsumption: {
      consumedResources: authority.consumedResources.map((entry) => ({ ...entry })),
      manifestDigest: fixtureAuthorityBundle(state).manifestDigest,
    },
  };
}

export function renderReplacementConnectivityEvidence(): string {
  return JSON.stringify(buildReplacementConnectivityEvidence(), null, 2) + "\n";
}

// ─── B06.2 — projection-reconciliation recovery evidence ─────────────────────

export interface RecoveryEvidence {
  schema: "sirkit.b06-2-recovery-fixtures.v1";
  scenarios: Array<{
    scenarioId: string;
    description: string;
    input: ProjectionDecisionInput;
    decision: ProjectionDecision;
  }>;
}

/**
 * Deterministic decision-table evidence: each scenario runs the REAL
 * `decideProjectionReconciliation` used by the session on reload.
 */
const AUTHORITATIVE_LINEAGE = "lin1-1234567890abcdef";
const FOREIGN_LINEAGE = "lin1-feedfacefeedface";

export function buildRecoveryEvidence(): RecoveryEvidence {
  const digests = ["eng1-aaaaaaaa00000000", "eng1-bbbbbbbb11111111", "eng1-cccccccc22222222"];
  const head = { envelopeLineageId: AUTHORITATIVE_LINEAGE, headSequence: 2, headCanonicalDigest: digests[2], sequenceDigests: digests, headUiDigest: "eng1-ffffffff00000000" };
  const mark = (headSequence: number, canonicalStateDigest: string, lineageId = AUTHORITATIVE_LINEAGE) => ({ lineageId, headSequence, canonicalStateDigest });
  const scenarios: RecoveryEvidence["scenarios"] = [
    { scenarioId: "resume-exact-head", description: "Projection state IS the canonical head — resumed regardless of mark.", input: { ...head, projectionDigest: head.headUiDigest, mark: null } },
    { scenarioId: "rebase-local-newer", description: "Same-lineage mark exactly matches the current head; differing projection = later legacy edits — documented rebase path.", input: { ...head, projectionDigest: "eng1-11ff11ff11ff11ff", mark: mark(2, digests[2]) } },
    { scenarioId: "recover-verified-older", description: "Same-lineage mark verifiably names an OLDER log position — canonical head wins.", input: { ...head, projectionDigest: "eng1-11ff11ff11ff11ff", mark: mark(1, digests[1]) } },
    { scenarioId: "recover-untrusted-no-mark", description: "No/malformed mark — untrusted projection; canonical wins, projection preserved as backup.", input: { ...head, projectionDigest: "eng1-11ff11ff11ff11ff", mark: null } },
    { scenarioId: "conflict-mark-ahead", description: "Mark claims a sequence NEWER than durable history — preserve both, explicit recovery required.", input: { ...head, projectionDigest: "eng1-11ff11ff11ff11ff", mark: mark(9, "eng1-dddddddd33333333") } },
    { scenarioId: "conflict-same-seq-wrong-digest", description: "Same lineage and sequence, different canonical digest — divergent history; fail closed.", input: { ...head, projectionDigest: "eng1-11ff11ff11ff11ff", mark: mark(2, "eng1-dddddddd33333333") } },
    { scenarioId: "conflict-unverifiable-position", description: "Older sequence whose digest matches no recorded log position — fabricated mark; fail closed.", input: { ...head, projectionDigest: "eng1-11ff11ff11ff11ff", mark: mark(1, "eng1-dddddddd33333333") } },
  ].map((scenario) => ({ ...scenario, decision: decideProjectionReconciliation(scenario.input) }));
  return { schema: "sirkit.b06-2-recovery-fixtures.v1", scenarios };
}

export function renderRecoveryEvidence(): string {
  return JSON.stringify(buildRecoveryEvidence(), null, 2) + "\n";
}

// ─── B06.3 — lineage-authentication recovery evidence ────────────────────────

export interface LineageRecoveryEvidence {
  schema: "sirkit.b06-3-lineage-recovery-fixtures.v1";
  scenarios: RecoveryEvidence["scenarios"];
  /** Lifecycle → mark-persistence patch behavior (autosave contract). */
  markPersistence: Array<{ lifecycle: string; withMark: unknown; result: "saves-mark" | "clears-mark" | "untouched" }>;
}

export function buildLineageRecoveryEvidence(): LineageRecoveryEvidence {
  const digests = ["eng1-aaaaaaaa00000000", "eng1-bbbbbbbb11111111", "eng1-cccccccc22222222"];
  const head = { envelopeLineageId: AUTHORITATIVE_LINEAGE, headSequence: 2, headCanonicalDigest: digests[2], sequenceDigests: digests, headUiDigest: "eng1-ffffffff00000000" };
  const scenarios: RecoveryEvidence["scenarios"] = [
    { scenarioId: "conflict-foreign-mark-head-exact", description: "THE B06.2-missed case: a FOREIGN-lineage mark whose sequence AND digest equal the envelope head, with differing projection content — never rebase-local-newer; conflict, both sides preserved.", input: { ...head, projectionDigest: "eng1-11ff11ff11ff11ff", mark: { lineageId: FOREIGN_LINEAGE, headSequence: 2, canonicalStateDigest: digests[2] } } },
    { scenarioId: "conflict-foreign-mark-older-verified-position", description: "A foreign-lineage mark naming a REAL older position of this lineage still conflicts — foreign marks are never verified-older evidence.", input: { ...head, projectionDigest: "eng1-11ff11ff11ff11ff", mark: { lineageId: FOREIGN_LINEAGE, headSequence: 1, canonicalStateDigest: digests[1] } } },
    { scenarioId: "resume-discards-foreign-mark", description: "Projection content equals the canonical head but the mark is foreign — resume on the ENVELOPE lineage; the mark is discarded and the mismatch recorded.", input: { ...head, projectionDigest: head.headUiDigest, mark: { lineageId: FOREIGN_LINEAGE, headSequence: 2, canonicalStateDigest: digests[2] } } },
    { scenarioId: "recover-when-lineage-unverifiable", description: "Defensive: with no validated envelope lineage (migration could not run), a mark is never lineage evidence — untrusted projection, canonical wins.", input: { ...head, envelopeLineageId: null, projectionDigest: "eng1-11ff11ff11ff11ff", mark: { lineageId: AUTHORITATIVE_LINEAGE, headSequence: 2, canonicalStateDigest: digests[2] } } },
  ].map((scenario) => ({ ...scenario, decision: decideProjectionReconciliation(scenario.input) }));
  const sampleMark = { lineageId: AUTHORITATIVE_LINEAGE, headSequence: 2, canonicalStateDigest: digests[2] };
  const markPersistence: LineageRecoveryEvidence["markPersistence"] = (["unopened", "hydrating", "ready", "conflicted", "unavailable"] as const).map((lifecycle) => {
    const patch = schematicMarkPatch(lifecycle, lifecycle === "ready" ? sampleMark : null);
    const result = !("schematicCanonicalMark" in patch) ? "untouched" as const : patch.schematicCanonicalMark === undefined ? "clears-mark" as const : "saves-mark" as const;
    return { lifecycle, withMark: "schematicCanonicalMark" in patch ? patch.schematicCanonicalMark ?? null : "(absent)", result };
  });
  return { schema: "sirkit.b06-3-lineage-recovery-fixtures.v1", scenarios, markPersistence };
}

export function renderLineageRecoveryEvidence(): string {
  return JSON.stringify(buildLineageRecoveryEvidence(), null, 2) + "\n";
}

// ─── B07 — schematic graph replay evidence ───────────────────────────────────

export interface GraphReplayEvidence {
  schema: "sirkit.b07-schematic-graph-replay-fixtures.v1";
  fixtures: SchematicReplayFixture[];
}

/** B07 graph fixtures: every batch is generated by the REAL graph diff and
 *  proven exactly invertible over the real kernel. */
export function buildGraphReplayEvidence(): GraphReplayEvidence {
  const state = fixtureState();
  const base = project(state);
  const baseDigest = schematicSemanticDigest(toCanonicalSchematic(state));
  const canonical = toCanonicalSchematic(state);
  const fixtures: SchematicReplayFixture[] = [];
  const push = (fixtureId: string, description: string, commandId: string, operations: EngineeringOperation[]): void => {
    const trip = roundTrip(base, operations);
    fixtures.push({ fixtureId, description, commandId, operations, inverseOperations: trip.inverse, baseSchematicDigest: baseDigest, resultSchematicDigest: trip.resultDigest, inverseRoundTripExact: trip.exact });
  };

  // Wire add + delete (indexed, order-exact).
  push("wire-add", "Add a wire segment at the end of the collection; inverse is an indexed delete.", "schematic.connect",
    diffSchematicGraphOps(canonical, { wires: [...state.wires, { id: "w-new", vertices: [{ x: 0, y: 0 }, { x: 30, y: 0 }] }] }));
  push("wire-delete-middle", "Delete the MIDDLE wire; the inverse restores it at its exact index (order survives undo).", "schematic.connect",
    diffSchematicGraphOps(canonical, { wires: state.wires.filter((w) => w.id !== "w2") }));
  push("wire-geometry-endpoint", "Move one endpoint of w1; inverse restores the prior vertex array exactly.", "schematic.connect",
    diffSchematicGraphOps(canonical, { wires: state.wires.map((w) => (w.id === "w1" ? { ...w, vertices: [{ x: 130, y: 100 }, { x: 300, y: 100 }] } : w)) }));
  push("wire-geometry-interior", "Move the INTERIOR vertex of w4; endpoints untouched.", "schematic.connect",
    diffSchematicGraphOps(canonical, { wires: state.wires.map((w) => (w.id === "w4" ? { ...w, vertices: [w.vertices[0], { x: 140, y: 100 }, w.vertices[2]] } : w)) }));
  // Labels.
  push("label-add-move-delete", "Add one label, move+rotate another, delete a third — one atomic batch.", "schematic.connect",
    diffSchematicGraphOps(canonical, {
      netLabels: [
        { ...state.netLabels![0], position: { x: 330, y: 110 }, orientation: 90 as const },
        { id: "l-new", position: { x: 600, y: 600 }, name: "VIN", kind: "label" as const, orientation: 0 as const },
      ],
    }));
  // Theory identity: rename via display refDes (stable id untouched); the
  // inverse restores ABSENCE (refDes: null) digest-exactly.
  push("theory-rename-display", "Rename theory R1 (display refDes) — the stable id never changes; the inverse clears the override, restoring field absence digest-exactly.", "schematic.set-property",
    diffSchematicGraphOps(canonical, { components: state.components.map((c) => (c.id === "R1" ? { ...c, refDes: "RSENSE" } : c)) }));
  // Gesture batch: component transform + attached wire endpoint + label move
  // in ONE transaction.
  push("gesture-drag-batch", "One completed drag gesture: component transform + attached wire geometry + label move commit as ONE transaction with one exact inverse batch.", "schematic.move-rotate",
    diffSchematicGraphOps(canonical, {
      components: state.components.map((c) => (c.id === "R1" ? { ...c, x: 200, y: 200 } : c)),
      wires: state.wires.map((w) => (w.id === "w1" ? { ...w, vertices: [{ x: 230, y: 200 }, { x: 280, y: 100 }] } : w)),
      netLabels: state.netLabels!.map((l) => (l.id === "l2" ? { ...l, position: { x: 520, y: 420 } } : l)),
    }));
  // Component placement (theory): stable UUID id + minted display reference.
  push("theory-placement", "Place a theory component: immutable stable id + editable display reference; inverse is a plain delete.", "schematic.add-component",
    diffSchematicGraphOps(canonical, { components: [...state.components, { id: "uuid-new-1", type: "capacitor", x: 400, y: 400, rotation: 0 as const, value: "100n", refDes: "C1" }] }));

  return { schema: "sirkit.b07-schematic-graph-replay-fixtures.v1", fixtures };
}

export function renderGraphReplayEvidence(): string {
  return JSON.stringify(buildGraphReplayEvidence(), null, 2) + "\n";
}
