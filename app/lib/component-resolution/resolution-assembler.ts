/**
 * [PR-M, 2026-10-17] Section M.2.4-M.2.5: the SERVER-SIDE assembler of the unresolved-component resolution proposal, and the
 * apply-time recompiler (the same function, the same inputs, fresh facts). Pure composition over facts the caller read from the
 * server (catalog parts, published revision evidence and status): it never reads a browser pin list or a model's mapping.
 *
 * Per batch: every item names a stable KiCad instance id (a Theory symbol is not resolved in place; an already-resolved instance
 * belongs to the narrower B14 exact replacement), the candidate catalog part and the exact revision the model saw (an assertion
 * that must equal the revision the part links for the instance's value); the instance's current pins come from its catalog symbol
 * with the sheet's nets (`inspectSchematicInstances`) - when they cannot be established the item blocks with the exact missing
 * evidence and the existing missing-facts / draft-request work item; the candidate must be COMPATIBLE (`evaluateCompatibility`).
 * Then, for the whole batch: the deterministic catalog resolution authority bundle (the empty-board reference projection of the
 * schematic B14 uses for its grant domain - an internal digest helper, never a PCB - plus ONE catalog-sourced authority envelope
 * listing every item's server-derived target); one fresh runtime grant per item; the ONE planning algorithm
 * (`planSchematicReplacement`) with the PROVED mapping as its explicit pin mapping (same-part binding keeps the identity mapping);
 * zero dropped connections; no wire end or label moved by two items; and a CONNECTIVITY PROOF - the sheet's whole net partition,
 * with every resolved pin mapped through its item's mapping, is identical before and after (unaffected nets included). Only then
 * is the batch sealed. Proposal-time grants are retired before the artifact leaves; the apply retains its fresh grants and owns
 * their retirement.
 */
import type { KicadComponentInstance, SchematicState } from "@/lib/schematic-types";
import type { KicadPin } from "../kicad/types";
import type { AtomicRevisionStatus } from "../atomic/revision-status";
import { consumeCatalogResolutionAuthority, retireReplacementAuthorityGrant, CATALOG_RESOLUTION_AUTHORITY_SCHEMA, type CatalogResolutionAuthorityEntry } from "../engineering/schematic-authority.internal";
import { planSchematicReplacement } from "../engineering/schematic-plans";
import { consumedAuthorityDigestFor, replacementHeadDigestFor } from "../engineering/replacement-proposal-assembler";
import { buildReadResourceBundle, sealResourceEnvelope, type ReadResourceBundle } from "../engineering/resource-envelopes";
import { computeProjectRevision } from "../engineering/revision";
import { toCanonicalSchematic } from "../engineering/schematic-model";
import type { SchematicProposalAuthorizationBinding } from "../engineering/proposal-authorization";
import type { Tier1ProposalScope } from "../engineering/schematic-proposals";
import { engineeringDigest } from "../engineering/stable";
import { STAGE10_SCHEMA_VERSION, type EngineeringOperation } from "../engineering/types";
import { createEmptyBoard } from "../pcb/types";
import { buildNetlist, type PcbNetlist } from "../pcb/netlist-bridge";
import { candidateLinkFor, candidateRevisionFactsOf, currentInstanceFactsOf } from "./candidate-search";
import { evaluateCompatibility, type ResolutionRequirement } from "./compatibility";
import type { PublishedRevisionEvidence } from "./evidence";
import { inspectSchematicInstances, netlistLookupOf, type CatalogPartLoad } from "./instance-facts";
import { MAX_RESOLUTION_ITEMS, sealResolutionProposal, type ResolutionImpact, type ResolutionItem, type SealedResolutionProposal } from "./resolution-proposal";

export const RESOLUTION_ASSEMBLER_VERSION = "1.0.0" as const;
const CONNECTIVITY_SCHEMA = "sirkit.component-resolution-connectivity.v1";
/** The existing work items an item without trusted current-pin evidence is handed to (never a guessed mapping). */
export const MISSING_EVIDENCE_WORK_ITEMS = Object.freeze(["sirkit.parts.missing-facts (the instance's missing-facts checklist)", "sirkit.parts.draft-request (an unverified draft request a human files)"] as const);

export interface ResolutionRequestItem { componentId: string; candidatePartId: string; atomicPartRevisionId: string }

/** The server facts the assembler decides on, as the ports answered them (keyed lookups only). */
export interface ResolutionFacts {
  parts: ReadonlyMap<string, CatalogPartLoad>;
  evidence: Readonly<Record<string, PublishedRevisionEvidence | null>>;
  status: Readonly<Record<string, AtomicRevisionStatus>>;
}

export type ResolutionBlockerCode =
  | "empty-batch" | "batch-too-large" | "duplicate-instance" | "unknown-component" | "theory-component-unsupported" | "already-resolved"
  | "current-pin-evidence-unavailable" | "candidate-unavailable" | "candidate-revision-mismatch" | "candidate-not-compatible" | "candidate-unresolved"
  | "canonical-head-mismatch" | "authority-consumption-refused" | "replacement-plan-refused" | "batch-conflict" | "connectivity-not-preserved";
export interface ResolutionBlocker { code: ResolutionBlockerCode; componentId: string | null; detail: string; missingEvidence?: string[]; workItems?: readonly string[] }

export type ResolutionAssemblyOutcome = { kind: "sealed"; proposal: SealedResolutionProposal } | { kind: "blocked"; blockers: ResolutionBlocker[] };

/** The catalog parts a batch is decided on: every KiCad part on the sheet (the connectivity proof covers unaffected nets too) and
 *  every candidate - one deterministic set, so the proposal and the apply's recompile read exactly the same facts. */
export const MAX_RESOLUTION_SHEET_PARTS = 128;
export function resolutionPartIdsFor(state: SchematicState, items: readonly ResolutionRequestItem[]): string[] {
  return [...new Set([...(state.kicadComponents ?? []).map((instance) => instance.partId), ...items.map((item) => item.candidatePartId)])].sort();
}

/** The SAME reference content the B14 grant domain uses (empty board + canonical schematic): an internal digest helper only. */
function referenceContent(state: SchematicState, scope: { tenantId: string; projectId: string; branchId: string }) {
  return { schemaVersion: STAGE10_SCHEMA_VERSION, tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId, pcb: createEmptyBoard(), schematic: toCanonicalSchematic(state), pinnedAssets: [] };
}

/** The deterministic catalog resolution authority bundle: rebuilt byte-identically at apply time from the same state and facts. */
export function buildResolutionAuthorityBundle(input: { state: SchematicState; scope: Tier1ProposalScope; entries: readonly CatalogResolutionAuthorityEntry[] }): ReadResourceBundle {
  const { tenantId, projectId, branchId } = input.scope;
  const content = referenceContent(input.state, input.scope);
  const revision = computeProjectRevision(content).canonicalStateDigest;
  const canonical = sealResourceEnvelope({ resourceId: `resolution-canonical:${projectId}`, kind: "canonical-state", tenantId, projectId, branchId, authoritySource: "local-working-copy", authorityStatus: "verified", sourceVersion: revision, sourceCanonicalRevision: revision, producer: "component-resolution-assembler", producerVersion: RESOLUTION_ASSEMBLER_VERSION, freshness: "current", content });
  const authority = sealResourceEnvelope({
    resourceId: `catalog-resolution-authority:${projectId}`, kind: "component-authority-records", tenantId, projectId, branchId,
    authoritySource: "catalog", authorityStatus: "verified", sourceVersion: revision, sourceCanonicalRevision: revision,
    producer: "component-resolution-assembler", producerVersion: RESOLUTION_ASSEMBLER_VERSION, freshness: "current",
    content: { schema: CATALOG_RESOLUTION_AUTHORITY_SCHEMA, resolutions: [...input.entries].sort((a, b) => a.componentId.localeCompare(b.componentId)) },
  });
  return buildReadResourceBundle(canonical, [authority]);
}

/** The sheet's net partition with each resolved pin renamed through its item's mapping; unnamed nets compare by membership only. */
export function connectivityPartition(netlist: PcbNetlist, pinMaps: ReadonlyMap<string, ReadonlyMap<string, string>>): Array<{ name: string | null; members: string[] }> {
  return netlist.nets
    .map((net) => ({
      name: net.name.startsWith("N$") ? null : net.name,
      members: net.nodes.map((node) => `${node.componentId}\u0000${pinMaps.get(node.componentId)?.get(node.pinNumber) ?? node.pinNumber}`).sort(),
    }))
    .sort((a, b) => (a.members[0] ?? "").localeCompare(b.members[0] ?? "") || (a.name ?? "").localeCompare(b.name ?? ""));
}

export function connectivityDigestOf(partition: ReturnType<typeof connectivityPartition>): string {
  return engineeringDigest({ schema: CONNECTIVITY_SCHEMA, partition });
}

/** The state the batch would produce: identities installed, the planned wire ends and labels moved (nothing else touched). */
export function simulateResolvedState(state: SchematicState, operations: readonly EngineeringOperation[]): SchematicState {
  const next = structuredClone(state);
  for (const operation of operations) {
    if (operation.kind !== "schematic_replace_component") continue;
    const component = (next.kicadComponents ?? []).find((item) => item.id === operation.componentId);
    if (!component) continue;
    component.partId = operation.replacement.partId;
    component.atomicPartRevisionId = operation.replacement.atomicPartRevisionId;
    component.symbolAssetVersionId = operation.replacement.symbolAssetVersionId;
    component.footprintAssetVersionId = operation.replacement.footprintAssetVersionId;
    component.mappingCertificateId = operation.replacement.mappingCertificateId;
    component.selectionRecordId = operation.replacement.selectionRecordId;
    for (const move of operation.wireEndpointMoves) {
      const wire = next.wires.find((item) => item.id === move.wireId);
      if (!wire || wire.vertices.length === 0) continue;
      wire.vertices[move.end === "start" ? 0 : wire.vertices.length - 1] = { ...move.to };
    }
    for (const move of operation.netLabelMoves) {
      const label = (next.netLabels ?? []).find((item) => item.id === move.labelId);
      if (label) label.position = { ...move.to };
    }
  }
  return next;
}

export function assembleResolutionProposal(input: {
  state: SchematicState;
  scope: Tier1ProposalScope;
  authorization: SchematicProposalAuthorizationBinding;
  items: readonly ResolutionRequestItem[];
  requirement: ResolutionRequirement;
  facts: ResolutionFacts;
  provenance: { provider: string; note: string; instruction: string };
  now: number;
  /** Apply-time recompilation keeps the minted grants registered and reports their ids (the caller retires them). */
  retainGrants?: (grantIds: string[]) => void;
}): ResolutionAssemblyOutcome {
  const { state, items } = input;
  const blockers: ResolutionBlocker[] = [];
  const block = (code: ResolutionBlockerCode, componentId: string | null, detail: string, extra?: Partial<ResolutionBlocker>): ResolutionAssemblyOutcome => ({ kind: "blocked", blockers: [...blockers, { code, componentId, detail: `${detail} Nothing was changed.`, ...extra }] });
  if (items.length === 0) return block("empty-batch", null, "A resolution names at least one instance.");
  if (items.length > MAX_RESOLUTION_ITEMS) return block("batch-too-large", null, `A resolution batch names at most ${MAX_RESOLUTION_ITEMS} instances.`);
  if (new Set(items.map((item) => item.componentId)).size !== items.length) return block("duplicate-instance", null, "A resolution batch names each instance once.");

  const partIds = resolutionPartIdsFor(state, items);
  if (partIds.length > MAX_RESOLUTION_SHEET_PARTS) return block("batch-too-large", null, `The sheet uses ${partIds.length} distinct catalog parts; a resolution is decided over at most ${MAX_RESOLUTION_SHEET_PARTS}.`);
  // ONLY the deterministic part set is read, whatever else the facts carry (the apply's fresh facts are filtered the same way)
  const parts = new Map<string, CatalogPartLoad>(partIds.flatMap((partId) => (input.facts.parts.has(partId) ? [[partId, input.facts.parts.get(partId)!] as const] : [])));
  const inspection = inspectSchematicInstances({ state, targets: items.map((item) => item.componentId), parts });
  const kicad = state.kicadComponents ?? [];
  type Prepared = { request: ResolutionRequestItem; instance: KicadComponentInstance; item: Omit<ResolutionItem, "wireEndpointMoves" | "netLabelMoves">; entry: CatalogResolutionAuthorityEntry; targetPins: KicadPin[]; currentPins: KicadPin[]; explicit: boolean };
  const prepared: Prepared[] = [];
  for (const request of items) {
    const instance = kicad.find((candidate) => candidate.id === request.componentId);
    if (!instance) {
      if (state.components.some((candidate) => candidate.id === request.componentId)) return block("theory-component-unsupported", request.componentId, "A Theory symbol is not resolved in place: place the catalog part with a published revision instead.");
      return block("unknown-component", request.componentId, `No KiCad component instance with the stable id ${request.componentId.slice(0, 64)} exists in the current schematic (a reference designator is not a mutation target).`);
    }
    const facts = inspection.instances.find((entry) => entry.componentId === instance.id)!;
    if (facts.resolution.state === "resolved") return block("already-resolved", instance.id, `${instance.refDes} already carries a published exact revision and its symbol asset; replacing a qualified part is the exact replacement proposal (sirkit.schematic.propose-component-replacement), not a resolution.`);
    const current = currentInstanceFactsOf(facts);
    if (!current || current.pins.length === 0) {
      return block("current-pin-evidence-unavailable", instance.id, `${instance.refDes}'s connected pins cannot be established from trusted evidence: its catalog part ${instance.partId.slice(0, 64)} is ${facts.catalog.state === "loaded" ? "a symbol without pins" : facts.catalog.reason ?? "unavailable"}.`, {
        missingEvidence: ["the current symbol's pins (number, name, electrical type) from the server catalog part the instance was placed from", "the sheet connectivity on those pins"],
        workItems: MISSING_EVIDENCE_WORK_ITEMS,
      });
    }
    const candidateLoad = parts.get(request.candidatePartId);
    if (!candidateLoad || candidateLoad.state !== "found") return block("candidate-unavailable", instance.id, `The candidate catalog part ${request.candidatePartId.slice(0, 64)} could not be read from the server catalog.`);
    const link = candidateLinkFor(candidateLoad.detail, instance.value);
    if (link.kind !== "link") return block("candidate-unresolved", instance.id, link.kind === "withdrawn" ? `The candidate's published revision for value key "${link.valueKey}" was withdrawn.` : `The candidate links no published exact revision for ${instance.refDes}'s value "${instance.value.slice(0, 32)}".`);
    if (link.link.revisionId !== request.atomicPartRevisionId) return block("candidate-revision-mismatch", instance.id, `The asserted revision ${request.atomicPartRevisionId.slice(0, 80)} is not the one candidate ${request.candidatePartId.slice(0, 64)} links for this value (${link.link.revisionId.slice(0, 80)}); an assertion never chooses the target.`);
    const status = Object.hasOwn(input.facts.status, link.link.revisionId) ? input.facts.status[link.link.revisionId]! : null;
    const evidence = Object.hasOwn(input.facts.evidence, link.link.revisionId) ? input.facts.evidence[link.link.revisionId]! : null;
    const candidate = candidateRevisionFactsOf({ detail: candidateLoad.detail, valueKey: link.valueKey, link: link.link, status, evidence });
    const verdict = evaluateCompatibility({ current, candidate, requirement: input.requirement });
    if (verdict.verdict !== "compatible" || !verdict.mapping || !evidence || !evidence.exactPart || verdict.equivalence === null) {
      return block(verdict.verdict === "incompatible" ? "candidate-not-compatible" : "candidate-unresolved", instance.id, `${instance.refDes} -> ${request.candidatePartId.slice(0, 64)}: ${verdict.reasons.map((reason) => `${reason.code}: ${reason.detail}`).join("; ") || "the candidate's exact part identity is unknown"}.`);
    }
    const target = { catalogPartId: candidateLoad.detail.id, valueKey: link.valueKey, exactMpn: evidence.exactPart.exactMpn, manufacturer: evidence.exactPart.manufacturerName ?? evidence.exactPart.manufacturerId, atomicPartRevisionId: link.link.revisionId, symbolAssetVersionId: link.link.symbolVersionId, footprintAssetVersionId: link.link.footprintVersionId, mappingCertificateId: link.link.mappingCertificateId, footprintFullName: link.link.footprintFullName, evidenceDigest: evidence.digest };
    const currentPins = (parts.get(instance.partId) as Extract<CatalogPartLoad, { state: "found" }>).detail.pins as KicadPin[];
    prepared.push({
      request,
      instance,
      targetPins: evidence.plannerPins,
      currentPins,
      explicit: verdict.mode === "part-replacement",
      entry: { componentId: instance.id, catalogPartId: target.catalogPartId, valueKey: target.valueKey, atomicPartRevisionId: target.atomicPartRevisionId, symbolAssetVersionId: target.symbolAssetVersionId, footprintAssetVersionId: target.footprintAssetVersionId, mappingCertificateId: target.mappingCertificateId, exactMpn: target.exactMpn, manufacturer: target.manufacturer, evidenceDigest: target.evidenceDigest, selectable: true },
      item: {
        componentInstanceId: instance.id,
        refDes: instance.refDes,
        value: instance.value,
        current: { partId: instance.partId, atomicPartRevisionId: instance.atomicPartRevisionId ?? null, symbolAssetVersionId: instance.symbolAssetVersionId ?? null, missing: facts.resolution.missing },
        target,
        mode: verdict.mode,
        mapping: verdict.mapping,
        permutation: verdict.permutation,
        equivalence: verdict.equivalence,
        nets: current.pins.filter((pin) => pin.netName !== null).map((pin) => ({ pin: pin.number, net: pin.netName! })),
        warnings: verdict.warnings,
        evidence: verdict.evidence,
      },
    });
  }

  // ── The ONE digest domain the grants bind: the session's head canonical-state digest must be this schematic's reference. ──
  const referenceDigest = replacementHeadDigestFor(state, input.scope);
  if (referenceDigest !== input.scope.headMark.canonicalStateDigest) return block("canonical-head-mismatch", null, "The run context's schematic does not sit at the claimed canonical head; regenerate from the current schematic.");
  const bundle = buildResolutionAuthorityBundle({ state, scope: input.scope, entries: prepared.map((entry) => entry.entry) });
  if (bundle.canonicalState.sourceCanonicalRevision !== referenceDigest) return block("canonical-head-mismatch", null, "The resolution authority bundle does not sit at the session's canonical head digest.");
  const grantIds: string[] = [];
  let retained = false;
  try {
    const operations: EngineeringOperation[] = [];
    const sealedItems: ResolutionItem[] = [];
    const movedEnds = new Set<string>();
    const movedLabels = new Set<string>();
    let consumedResources: Array<{ resourceId: string; contentDigest: string }> = [];
    for (const entry of prepared) {
      const consumed = consumeCatalogResolutionAuthority({ bundle, scope: { tenantId: input.scope.tenantId, projectId: input.scope.projectId, branchId: input.scope.branchId }, expectedCanonicalRevision: input.scope.headMark.canonicalStateDigest, componentId: entry.instance.id, targetPartId: entry.entry.catalogPartId, target: { atomicPartRevisionId: entry.entry.atomicPartRevisionId } });
      if (!consumed.ok) return block("authority-consumption-refused", entry.instance.id, `Resolution authority was refused (${consumed.code}): ${consumed.detail}`);
      grantIds.push(consumed.authority.grantId);
      consumedResources = consumed.authority.consumedResources.map((resource) => ({ ...resource }));
      const planned = planSchematicReplacement(state, {
        componentId: entry.instance.id,
        target: { partId: entry.entry.catalogPartId, pins: entry.targetPins, authority: consumed.authority },
        currentPins: entry.currentPins,
        // the PROVED mapping (by function over the approved certificate) for a part change; a same-part binding keeps the identity
        ...(entry.explicit ? { explicitPinMapping: entry.item.mapping.map((mapping) => ({ fromPin: mapping.fromPin, toPin: mapping.toPin })) } : {}),
      });
      if (!planned.ok) return block("replacement-plan-refused", entry.instance.id, `${planned.refusal}: ${planned.detail}`);
      if (planned.plan.droppedConnections.length > 0) return block("replacement-plan-refused", entry.instance.id, "The plan reports dropped connections; a resolution never drops a connected pin.");
      for (const move of planned.plan.wireEndpointMoves) {
        const key = `${move.wireId}\u0000${move.end}`;
        if (movedEnds.has(key)) return block("batch-conflict", entry.instance.id, `Wire ${move.wireId.slice(0, 64)}'s ${move.end} would be moved by two items of the batch.`);
        movedEnds.add(key);
      }
      for (const move of planned.plan.netLabelMoves) {
        if (movedLabels.has(move.labelId)) return block("batch-conflict", entry.instance.id, `Net label ${move.labelName.slice(0, 32)} would be moved by two items of the batch.`);
        movedLabels.add(move.labelId);
      }
      operations.push(planned.operation);
      sealedItems.push({ ...entry.item, wireEndpointMoves: planned.plan.wireEndpointMoves.map((move) => ({ wireId: move.wireId, end: move.end, to: { ...move.to } })), netLabelMoves: planned.plan.netLabelMoves.map((move) => ({ labelId: move.labelId, labelName: move.labelName, from: { ...move.from }, to: { ...move.to } })), warnings: [...entry.item.warnings, ...planned.plan.warnings] });
    }

    // ── The connectivity proof: the whole sheet's net partition is unchanged, resolved pins mapped through their mapping. ──
    const pinMaps = new Map(sealedItems.map((item) => [item.componentInstanceId, new Map(item.mapping.map((mapping) => [mapping.fromPin, mapping.toPin] as const))] as const));
    const before = connectivityPartition(buildNetlist(state, netlistLookupOf(parts)), pinMaps);
    const after = connectivityPartition(buildNetlist(simulateResolvedState(state, operations), netlistLookupOf(parts)), new Map());
    const beforeDigest = connectivityDigestOf(before);
    const afterDigest = connectivityDigestOf(after);
    if (beforeDigest !== afterDigest) return block("connectivity-not-preserved", null, "The resolved sheet's nets would differ from the current sheet's (a pin would join or leave a net); the batch is refused.");

    const authorityEnvelope = bundle.auxiliary.find((envelope) => envelope.kind === "component-authority-records")!;
    const impact: ResolutionImpact = {
      items: sealedItems,
      connectivityDigest: afterDigest,
      unaffectedComponents: kicad.length + state.components.length - sealedItems.length,
      downstream: [
        "each resolved instance now names a published exact revision (symbol, footprint, approved mapping); Prepare PCB re-runs its preflight on the new identities",
        "physical-binding qualification for each componentInstanceId is established by Prepare PCB's bind step and its review, never by this change",
        "an existing pcb-sync plan or board for these instances goes stale and is recomputed (fail closed at preflight)",
        "the BOM regroups by the new exact parts; manufacturing readiness recomputes",
      ],
    };
    const proposal = sealResolutionProposal({
      state,
      scope: input.scope,
      authorization: input.authorization,
      requirement: input.requirement,
      impact,
      operations,
      authorityResource: { resourceId: authorityEnvelope.resourceId, contentDigest: authorityEnvelope.contentDigest },
      canonicalResource: { resourceId: bundle.canonicalState.resourceId, contentDigest: bundle.canonicalState.contentDigest },
      resourceManifestDigest: bundle.manifestDigest,
      consumedAuthorityDigest: consumedAuthorityDigestFor(consumedResources),
      provenance: input.provenance,
      now: input.now,
    });
    if (input.retainGrants) {
      retained = true;
      input.retainGrants([...grantIds]);
    }
    return { kind: "sealed", proposal };
  } finally {
    if (!retained) for (const grantId of grantIds) retireReplacementAuthorityGrant(grantId);
  }
}
