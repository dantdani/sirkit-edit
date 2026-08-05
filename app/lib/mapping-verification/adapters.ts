import type { PortableAtomicSnapshot, SourceClass } from "../atomic/types";
import { KICAD_ASSET_PARSER_VERSION } from "../atomic/kicad-assets";
import { mappingDigest, mappingId, candidateTechnicalPayload, normalizedCandidate } from "./stable";
import { MAPPING_CANDIDATE_VERSION, MAPPING_CONTEXT_VERSION, MAPPING_VERIFIER_VERSION, type ExactPartIdentity, type FootprintPad, type LogicalSymbolPin, type MappingContext, type MappingEvidence, type MappingFunctionClass, type MappingItemClassification, type MappingRiskClass, type MappingScope, type PackageIdentity, type PackageTerminal, type PhysicalTerminalMappingCandidate } from "./types";

export const PACKAGE_TERMINAL_FACT_PARSER_VERSION = "sirkit.package-terminal-facts/1" as const;

export interface PackageTerminalFactInput {
  terminalId: string;
  designator: string;
  function: string;
  functionClass: MappingFunctionClass;
  classification: MappingItemClassification;
  connectionRequirement: PackageTerminal["connectionRequirement"];
  alternateFunctions?: string[];
  commonGroup?: string;
  polarityRole?: PackageTerminal["polarityRole"];
  evidenceRefs: string[];
  sourceRevision: string;
  freshness: PackageTerminal["freshness"];
}

export interface MappingContextBuildInput {
  scope: MappingScope;
  snapshot: PortableAtomicSnapshot;
  packageIdentity: PackageIdentity;
  terminals: PackageTerminalFactInput[];
  riskClass: MappingRiskClass;
  symbolFunctions: Record<string, { functionClass: MappingFunctionClass; polarityRole?: LogicalSymbolPin["polarityRole"]; mappingRequirement?: LogicalSymbolPin["mappingRequirement"]; alternateFunctions?: string[]; evidenceRefs?: string[]; stackedGroup?: string }>;
  padClassifications?: Record<string, { classification: MappingItemClassification; propertyRefs?: string[] }>;
  policy: { policyId: string; policyVersion: string };
}

function normalizedIdentifier(value: string): string { return value.normalize("NFC").trim().toLocaleUpperCase("en-US"); }
function sourceClass(value: SourceClass): MappingEvidence["sourceClass"] {
  if (value === "manufacturer_datasheet" || value === "manufacturer_cad" || value === "manufacturer_application_note" || value === "official_kicad_library" || value === "organization_authored" || value === "human_reviewed") return value;
  if (value === "ocr_extraction" || value === "llm_suggestion") return value;
  if (value === "third_party_cad" || value === "distributor_catalog") return "vendor_library";
  return "other";
}

function evidenceFromSnapshot(snapshot: PortableAtomicSnapshot): MappingEvidence[] {
  const recordById = new Map(snapshot.sourceRecords.map((item) => [item.id, item]));
  const sourceById = new Map(snapshot.sources.map((item) => [item.id, item]));
  return snapshot.evidence.map((item) => {
    const record = recordById.get(item.sourceRecordId), source = record ? sourceById.get(record.sourceId) : undefined;
    const freshness = !record ? "unavailable" as const : record.expiresAt && Date.parse(record.expiresAt) <= Date.parse(snapshot.capturedAt) ? "stale" as const : "current" as const;
    return { evidenceId: item.id, sourceRecordId: item.sourceRecordId, sourceClass: source ? sourceClass(source.sourceClass) : "other", contentDigest: record?.contentHash ?? "missing", revision: record?.revision ?? "missing", locator: item.locator, assertionKind: "mapping_edge" as const, extractionMethod: item.extractionMethod, extractorVersion: item.extractorVersion, reviewed: Boolean(item.reviewerId && item.reviewedAt), ...(item.reviewerId ? { reviewerId: item.reviewerId } : {}), freshness, confidential: record?.confidential ?? true };
  }).sort((a, b) => a.evidenceId.localeCompare(b.evidenceId));
}

function exactPartIdentity(snapshot: PortableAtomicSnapshot): ExactPartIdentity | undefined {
  if (!snapshot.exactPart || !snapshot.atomicRevision.exactPartId) return undefined;
  return { atomicPartRevisionId: snapshot.atomicRevision.id, exactPartId: snapshot.exactPart.id, manufacturerId: snapshot.exactPart.manufacturerId, exactMpnDigest: mappingDigest({ manufacturerId: snapshot.exactPart.manufacturerId, exactMpn: snapshot.exactPart.exactMpn }) };
}

export function buildMappingContext(input: MappingContextBuildInput): MappingContext {
  const diagnostics: MappingContext["diagnostics"] = [];
  const symbol = input.snapshot.symbol, footprint = input.snapshot.footprint;
  if (!footprint) throw new Error("MV_FOOTPRINT_ASSET_MISSING");
  if (symbol.validationState !== "valid") diagnostics.push({ code: "MV_SYMBOL_PARSER_UNSUPPORTED", blocking: true, message: "Symbol parser retained an unsupported or lossy construct.", identityRefs: [symbol.versionId] });
  if (footprint.validationState !== "valid") diagnostics.push({ code: "MV_FOOTPRINT_PARSER_UNSUPPORTED", blocking: true, message: "Footprint parser retained an unsupported or lossy construct.", identityRefs: [footprint.versionId] });

  const pinGroups = new Map<string, typeof symbol.pins>();
  for (const pin of symbol.pins) {
    const number = normalizedIdentifier(pin.number);
    pinGroups.set(number, [...(pinGroups.get(number) ?? []), pin]);
  }
  const symbolPins: LogicalSymbolPin[] = [...pinGroups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([number, representations]) => {
    const fact = input.symbolFunctions[number] ?? input.symbolFunctions[representations[0]!.id];
    const types = new Set(representations.map((item) => item.electricalType)), names = new Set(representations.map((item) => normalizedIdentifier(item.name)));
    if (!number) diagnostics.push({ code: "MV_SYMBOL_PIN_NUMBER_MISSING", blocking: true, message: "A symbol pin has no stable published number.", identityRefs: representations.map((item) => item.id) });
    if (types.size > 1 || names.size > 1) diagnostics.push({ code: "MV_MULTI_UNIT_PIN_CONFLICT", blocking: true, message: "Representations of one physical symbol pin disagree.", identityRefs: representations.map((item) => item.id) });
    return { stablePinId: mappingId("logical-pin", { symbol: symbol.versionId, number }), symbolVersionId: symbol.versionId, rawNumber: representations[0]!.number, normalizedNumber: number, rawName: representations[0]!.name, normalizedName: normalizedIdentifier(representations[0]!.name), electricalType: representations[0]!.electricalType, functionClass: fact?.functionClass ?? "unknown", polarityRole: fact?.polarityRole ?? "unknown", hidden: representations.some((item) => item.hidden), representations: representations.map((item) => ({ sourcePinId: item.id, unit: item.unit, bodyStyle: item.bodyStyle, alternate: `body-${item.bodyStyle}`, hidden: item.hidden })).sort((a, b) => a.unit - b.unit || a.bodyStyle - b.bodyStyle || a.sourcePinId.localeCompare(b.sourcePinId)), ...(fact?.stackedGroup ? { stackedGroup: fact.stackedGroup } : {}), alternateFunctions: [...new Set(fact?.alternateFunctions ?? [])].sort(), mappingRequirement: fact?.mappingRequirement ?? (representations[0]!.electricalType === "no_connect" ? "optional" : "required"), evidenceRefs: [...new Set(fact?.evidenceRefs ?? [])].sort() };
  });

  const packageTerminals: PackageTerminal[] = input.terminals.map((item) => ({ stableTerminalId: item.terminalId, packageRevisionId: input.packageIdentity.packageRevisionId, ...(input.packageIdentity.exactPartId ? { exactPartId: input.packageIdentity.exactPartId } : {}), rawDesignator: item.designator, normalizedDesignator: normalizedIdentifier(item.designator), rawFunction: item.function, normalizedFunction: normalizedIdentifier(item.function), functionClass: item.functionClass, classification: item.classification, connectionRequirement: item.connectionRequirement, alternateFunctions: [...new Set(item.alternateFunctions ?? [])].sort(), ...(item.commonGroup ? { commonGroup: item.commonGroup } : {}), polarityRole: item.polarityRole ?? "unknown", evidenceRefs: [...new Set(item.evidenceRefs)].sort(), sourceRevision: item.sourceRevision, freshness: item.freshness })).sort((a, b) => a.stableTerminalId.localeCompare(b.stableTerminalId));
  if (new Set(packageTerminals.map((item) => item.stableTerminalId)).size !== packageTerminals.length) diagnostics.push({ code: "MV_PACKAGE_TERMINAL_ID_DUPLICATE", blocking: true, message: "Package terminal facts contain duplicate identities.", identityRefs: packageTerminals.map((item) => item.stableTerminalId) });

  const numberCounts = new Map<string, number>();
  for (const pad of footprint.pads) numberCounts.set(normalizedIdentifier(pad.number), (numberCounts.get(normalizedIdentifier(pad.number)) ?? 0) + 1);
  const footprintPads: FootprintPad[] = footprint.pads.map((pad) => {
    const fact = input.padClassifications?.[pad.id], number = normalizedIdentifier(pad.number);
    const classification = fact?.classification ?? (pad.mechanical || pad.padType === "np_thru_hole" || number === "" ? "mechanical" : "electrical");
    return { stablePadId: pad.id, footprintVersionId: footprint.versionId, rawNumber: pad.number, normalizedNumber: number, padType: pad.padType, layers: [...pad.layers].sort(), classification, ...((numberCounts.get(number) ?? 0) > 1 ? { repeatedPadGroup: mappingId("repeated-pad", { footprint: footprint.versionId, number }) } : {}), ...(pad.drillNm !== undefined ? { drillNm: pad.drillNm } : {}), ...(pad.plated !== undefined ? { plated: pad.plated } : {}), propertyRefs: [...new Set(fact?.propertyRefs ?? [])].sort() };
  }).sort((a, b) => a.stablePadId.localeCompare(b.stablePadId));
  if (new Set(footprintPads.map((item) => item.stablePadId)).size !== footprintPads.length) diagnostics.push({ code: "MV_FOOTPRINT_PAD_ID_DUPLICATE", blocking: true, message: "Footprint parser produced duplicate pad identities.", identityRefs: footprintPads.map((item) => item.stablePadId) });

  const evidence = evidenceFromSnapshot(input.snapshot);
  const symbolIdentity = { logicalAssetId: symbol.logicalAssetId, versionId: symbol.versionId, contentDigest: symbol.contentHash, semanticDigest: symbol.semanticHash, formatVersion: symbol.formatVersion, parserVersion: KICAD_ASSET_PARSER_VERSION };
  const footprintIdentity = { logicalAssetId: footprint.logicalAssetId, versionId: footprint.versionId, contentDigest: footprint.contentHash, semanticDigest: footprint.semanticHash, formatVersion: footprint.formatVersion, parserVersion: KICAD_ASSET_PARSER_VERSION };
  const exactPart = exactPartIdentity(input.snapshot);
  const evidenceDigests = evidence.map((item) => mappingDigest(item)).sort();
  const dependencyBase = { scopeDigest: mappingDigest(input.scope), symbolVersionId: symbol.versionId, symbolContentDigest: symbol.contentHash, symbolSemanticDigest: symbol.semanticHash, ...(exactPart ? { exactPartRevisionId: exactPart.atomicPartRevisionId } : {}), packageRevisionId: input.packageIdentity.packageRevisionId, footprintVersionId: footprint.versionId, footprintContentDigest: footprint.contentHash, footprintSemanticDigest: footprint.semanticHash, evidenceDigests, parserVersions: { symbol: KICAD_ASSET_PARSER_VERSION, footprint: KICAD_ASSET_PARSER_VERSION, packageTerminal: PACKAGE_TERMINAL_FACT_PARSER_VERSION }, policyId: input.policy.policyId, policyVersion: input.policy.policyVersion, verifierVersion: MAPPING_VERIFIER_VERSION };
  const dependencySnapshot = { ...dependencyBase, dependencyDigest: mappingDigest(dependencyBase) };
  const base = { contextSchemaVersion: MAPPING_CONTEXT_VERSION, scope: structuredClone(input.scope), riskClass: input.riskClass, symbolIdentity, ...(exactPart ? { exactPartIdentity: exactPart } : {}), packageIdentity: structuredClone(input.packageIdentity), footprintIdentity, symbolPins, packageTerminals, footprintPads, evidence, dependencySnapshot, diagnostics: diagnostics.sort((a, b) => a.code.localeCompare(b.code) || a.identityRefs.join("\0").localeCompare(b.identityRefs.join("\0"))) };
  return { ...base, contextId: mappingId("mapping-context", base) };
}

export function createMappingCandidate(input: Omit<PhysicalTerminalMappingCandidate, "mappingSchemaVersion" | "mappingCandidateId" | "candidateDigest">): PhysicalTerminalMappingCandidate {
  const draft = normalizedCandidate({ ...structuredClone(input), mappingSchemaVersion: MAPPING_CANDIDATE_VERSION, mappingCandidateId: "pending", candidateDigest: "pending" });
  const candidateDigest = mappingDigest(candidateTechnicalPayload(draft));
  return { ...draft, mappingCandidateId: mappingId("mapping-candidate", candidateDigest), candidateDigest };
}

export function createNumberEqualityCandidate(context: MappingContext): PhysicalTerminalMappingCandidate {
  const terminals = new Map(context.packageTerminals.map((item) => [item.normalizedDesignator, item]));
  const pads = new Map(context.footprintPads.map((item) => [item.normalizedNumber, item]));
  const symbolToTerminalEdges = context.symbolPins.flatMap((pin) => {
    const terminal = terminals.get(pin.normalizedNumber);
    if (!terminal) return [];
    const base = { relationship: "exact_one_to_one" as const, assertedFunction: "unknown" as const, orientationSignificant: false, evidenceRefs: [], origin: "number_equality_candidate" as const, ruleVersion: "sirkit.number-equality-candidate/1", conditions: [], assemblyVariantIds: [context.scope.assemblyVariantId], lifecycle: "candidate" as const, symbolPinId: pin.stablePinId, packageTerminalId: terminal.stableTerminalId };
    return [{ ...base, edgeId: mappingId("mapping-edge", base) }];
  });
  const terminalToPadEdges = context.packageTerminals.flatMap((terminal) => {
    const pad = pads.get(terminal.normalizedDesignator);
    if (!pad) return [];
    const base = { relationship: "exact_one_to_one" as const, assertedFunction: "unknown" as const, orientationSignificant: false, evidenceRefs: [], origin: "number_equality_candidate" as const, ruleVersion: "sirkit.number-equality-candidate/1", conditions: [], assemblyVariantIds: [context.scope.assemblyVariantId], lifecycle: "candidate" as const, packageTerminalId: terminal.stableTerminalId, footprintPadId: pad.stablePadId };
    return [{ ...base, edgeId: mappingId("mapping-edge", base) }];
  });
  return createMappingCandidate({ scope: context.scope, symbolIdentity: context.symbolIdentity, ...(context.exactPartIdentity ? { exactPartIdentity: context.exactPartIdentity } : {}), packageIdentity: context.packageIdentity, footprintIdentity: context.footprintIdentity, compatibilityMode: "three_layer_exact", symbolToTerminalEdges, terminalToPadEdges, directSymbolToPadEdges: [], equivalenceClasses: [], explicitUnmappedItems: context.footprintPads.filter((item) => item.classification === "mechanical" || item.classification === "mounting").map((item) => ({ itemId: item.stablePadId, layer: "footprint_pad" as const, disposition: item.classification === "mounting" ? "mounting" as const : "mechanical" as const, evidenceRefs: [], reason: "Parser classified this pad as non-electrical." })), evidenceRefs: [], origin: "number_equality_candidate", dependencyDigest: context.dependencySnapshot.dependencyDigest });
}
