import { tierSatisfies } from "./policy";
import { assertCandidateDigest, findingSort, mappingDigest, mappingId, normalizedCandidate, resultTechnicalPayload } from "./stable";
import { MAPPING_RESULT_VERSION, MAPPING_VERIFIER_ID, MAPPING_VERIFIER_VERSION, type CoverageSummary, type EvidenceAssessment, type MappingAmbiguity, type MappingConflict, type MappingContext, type MappingFinding, type MappingLayer, type MappingVerificationPolicy, type MappingVerificationRequest, type MappingVerificationResult, type MappingVerificationStatus, type MappingVerificationTier, type PhysicalTerminalMappingCandidate } from "./types";

function finding(input: { code: string; layer: MappingLayer; message: string; expected?: string; observed?: string; severity?: MappingFinding["severity"]; blocking?: boolean; pins?: string[]; terminals?: string[]; pads?: string[]; edges?: string[]; evidence?: string[]; fields?: string[]; remediation?: MappingFinding["remediationCategory"]; causedBy?: string[]; rule?: string }): MappingFinding {
  const blocking = input.blocking ?? true;
  const technical = { code: input.code, layer: input.layer, symbolPinIds: [...new Set(input.pins ?? [])].sort(), packageTerminalIds: [...new Set(input.terminals ?? [])].sort(), footprintPadIds: [...new Set(input.pads ?? [])].sort(), edgeIds: [...new Set(input.edges ?? [])].sort(), evidenceRefs: [...new Set(input.evidence ?? [])].sort(), fieldRefs: [...new Set(input.fields ?? [])].sort(), expected: input.expected ?? "valid current evidence-backed mapping", observed: input.observed ?? "requirement not satisfied", remediationCategory: input.remediation ?? "identity", causedBy: [...new Set(input.causedBy ?? [])].sort(), ruleVersion: input.rule ?? "sirkit.mapping-rules/1" };
  return { ...technical, findingId: mappingId("mapping-finding", technical), severity: input.severity ?? (blocking ? "blocking" : "warning"), blocking, message: input.message, verifierVersion: MAPPING_VERIFIER_VERSION, helpKey: `mapping-verification/${input.code.toLowerCase()}` };
}

function conflict(code: string, identities: string[], evidence: string[], message: string): MappingConflict { const base = { code, identityRefs: [...new Set(identities)].sort(), evidenceRefs: [...new Set(evidence)].sort(), message }; return { ...base, conflictId: mappingId("mapping-conflict", base) }; }
function ambiguity(code: string, alternatives: string[], evidence: string[], message: string): MappingAmbiguity { const base = { code, alternatives: [...new Set(alternatives)].sort(), evidenceRefs: [...new Set(evidence)].sort(), message }; return { ...base, ambiguityId: mappingId("mapping-ambiguity", base) }; }

function coverage(requiredIds: string[], accountedIds: Set<string>, explicitIds: Set<string>): CoverageSummary {
  const required = [...new Set(requiredIds)].sort(), missingIds = required.filter((id) => !accountedIds.has(id) && !explicitIds.has(id));
  const accounted = required.filter((id) => accountedIds.has(id)).length, explicitlyUnmapped = required.filter((id) => explicitIds.has(id)).length;
  return { total: required.length, required: required.length, accounted, explicitlyUnmapped, missing: missingIds.length, coveragePercent: required.length ? Math.round(((accounted + explicitlyUnmapped) / required.length) * 100_000) / 1_000 : 100, missingIds };
}

function evidenceAssessment(context: MappingContext, candidate: PhysicalTerminalMappingCandidate, policy: MappingVerificationPolicy, findings: MappingFinding[]): EvidenceAssessment {
  const used = new Set([...candidate.evidenceRefs, ...candidate.symbolToTerminalEdges.flatMap((item) => item.evidenceRefs), ...candidate.terminalToPadEdges.flatMap((item) => item.evidenceRefs), ...candidate.directSymbolToPadEdges.flatMap((item) => item.evidenceRefs), ...candidate.equivalenceClasses.flatMap((item) => item.evidenceRefs), ...candidate.explicitUnmappedItems.flatMap((item) => item.evidenceRefs)]);
  const byId = new Map(context.evidence.map((item) => [item.evidenceId, item]));
  for (const id of used) if (!byId.has(id)) findings.push(finding({ code: "MV_EVIDENCE_REFERENCE_MISSING", layer: "evidence", message: "A mapping assertion references unavailable evidence.", evidence: [id], remediation: "evidence" }));
  const items = [...used].map((id) => byId.get(id)).filter((item): item is NonNullable<typeof item> => Boolean(item));
  const current = items.filter((item) => item.freshness === "current").length, stale = items.filter((item) => item.freshness === "stale").length, unavailable = items.filter((item) => item.freshness === "unavailable").length, conflicting = items.filter((item) => item.freshness === "conflicting").length, reviewed = items.filter((item) => item.reviewed).length, authoritative = items.filter((item) => policy.acceptedEvidenceClasses.includes(item.sourceClass)).length;
  if (stale) findings.push(finding({ code: "MV_EVIDENCE_STALE", layer: "evidence", message: "Mapping evidence is stale for the current dependency snapshot.", evidence: items.filter((item) => item.freshness === "stale").map((item) => item.evidenceId), remediation: "freshness" }));
  if (unavailable) findings.push(finding({ code: "MV_EVIDENCE_UNAVAILABLE", layer: "evidence", message: "Mapping evidence content is unavailable.", evidence: items.filter((item) => item.freshness === "unavailable").map((item) => item.evidenceId), remediation: "evidence" }));
  if (conflicting) findings.push(finding({ code: "MV_EVIDENCE_CONFLICT", layer: "evidence", message: "Current evidence contains incompatible assertions.", evidence: items.filter((item) => item.freshness === "conflicting").map((item) => item.evidenceId), remediation: "conflict" }));
  if (policy.requireReviewedEvidence && items.some((item) => !item.reviewed)) findings.push(finding({ code: "MV_EVIDENCE_UNREVIEWED", layer: "evidence", message: "Machine/imported evidence assertions require authorized review.", evidence: items.filter((item) => !item.reviewed).map((item) => item.evidenceId), remediation: "evidence" }));
  if (items.length === 0) findings.push(finding({ code: "MV_EVIDENCE_MISSING", layer: "evidence", message: "Count, number, name, and order agreement are not mapping evidence.", remediation: "evidence" }));
  if (authoritative !== items.length && items.length) findings.push(finding({ code: "MV_EVIDENCE_SOURCE_UNACCEPTED", layer: "evidence", message: "One or more evidence source classes are not authoritative under this policy.", evidence: items.filter((item) => !policy.acceptedEvidenceClasses.includes(item.sourceClass)).map((item) => item.evidenceId), remediation: "evidence" }));
  const sufficient = items.length > 0 && current === items.length && reviewed === items.length && authoritative === items.length && stale === 0 && unavailable === 0 && conflicting === 0;
  return { total: items.length, current, stale, unavailable, conflicting, reviewed, authoritative, sufficient, reasonCodes: findings.filter((item) => item.layer === "evidence" && item.blocking).map((item) => item.code).sort() };
}

function statusFrom(findings: MappingFinding[], conflicts: MappingConflict[], ambiguities: MappingAmbiguity[], evidence: EvidenceAssessment): MappingVerificationStatus {
  const codes = new Set(findings.filter((item) => item.blocking).map((item) => item.code));
  if (conflicts.length || [...codes].some((code) => code.includes("CONFLICT"))) return "conflicting";
  if (ambiguities.length || [...codes].some((code) => code.includes("AMBIGU"))) return "ambiguous";
  if ([...codes].some((code) => code.includes("STALE") || code.includes("DEPENDENCY"))) return "stale_dependency";
  if ([...codes].some((code) => code.includes("UNSUPPORTED") || code.includes("PARSER"))) return "unsupported_construct";
  if ([...codes].some((code) => code.includes("POLARITY") || code.includes("FUNCTION") || code.includes("DNC") || code.includes("SHORT") || code.includes("THERMAL"))) return "electrically_inconsistent";
  if (!evidence.sufficient || [...codes].some((code) => code.includes("EVIDENCE") || code.includes("SUGGESTION") || code.includes("HEURISTIC"))) return "evidence_insufficient";
  if ([...codes].some((code) => code.includes("MISSING") || code.includes("COVERAGE") || code.includes("UNACCOUNTED"))) return "incomplete";
  if (codes.size) return "structurally_invalid";
  return "verified";
}

function candidateTier(context: MappingContext, candidate: PhysicalTerminalMappingCandidate, evidence: EvidenceAssessment): MappingVerificationTier | undefined {
  if (!evidence.sufficient || ["number_equality_candidate", "legacy_direct", "ai_extracted", "api_extraction", "vendor_library", "generated_relationship"].includes(candidate.origin)) return undefined;
  if (candidate.compatibilityMode === "three_layer_exact" && context.exactPartIdentity && candidate.exactPartIdentity?.exactPartId === context.exactPartIdentity.exactPartId) return "exact_part";
  if (candidate.compatibilityMode === "three_layer_package_family" && candidate.packageIdentity.packageRevisionId === context.packageIdentity.packageRevisionId) return "package_family";
  if (candidate.compatibilityMode === "curated_pair") return "curated_pair";
  if (candidate.compatibilityMode === "limited_direct_pair") return "limited_direct_pair";
  return undefined;
}

export class DeterministicMappingVerifier {
  verify(request: MappingVerificationRequest, context: MappingContext, rawCandidate: PhysicalTerminalMappingCandidate, policy: MappingVerificationPolicy): MappingVerificationResult {
    if (request.contextId !== context.contextId || request.mappingCandidateId !== rawCandidate.mappingCandidateId) throw new Error("MV_REQUEST_CONTEXT_CANDIDATE_MISMATCH");
    assertCandidateDigest(rawCandidate);
    const candidate = normalizedCandidate(rawCandidate), findings: MappingFinding[] = [], conflicts: MappingConflict[] = [], ambiguities: MappingAmbiguity[] = [];
    for (const diagnostic of context.diagnostics) {
      findings.push(finding({ code: diagnostic.code, layer: diagnostic.code.includes("FOOTPRINT") ? "footprint_pad" : diagnostic.code.includes("TERMINAL") ? "package_terminal" : "symbol", message: diagnostic.message, blocking: diagnostic.blocking, pins: diagnostic.identityRefs, remediation: diagnostic.code.includes("CONFLICT") ? "conflict" : "parser" }));
      if (diagnostic.code.includes("CONFLICT")) conflicts.push(conflict(diagnostic.code, diagnostic.identityRefs, [], diagnostic.message));
    }
    if (candidate.dependencyDigest !== context.dependencySnapshot.dependencyDigest) findings.push(finding({ code: "MV_DEPENDENCY_DIGEST_MISMATCH", layer: "scope", message: "Candidate dependencies do not match the frozen context.", expected: context.dependencySnapshot.dependencyDigest, observed: candidate.dependencyDigest, remediation: "freshness" }));
    if (candidate.scope.tenantId !== context.scope.tenantId || candidate.scope.projectId !== context.scope.projectId || candidate.scope.branchId !== context.scope.branchId || candidate.scope.componentInstanceId !== context.scope.componentInstanceId || candidate.scope.assemblyVariantId !== context.scope.assemblyVariantId) findings.push(finding({ code: "MV_SCOPE_MISMATCH", layer: "scope", message: "Candidate is outside the frozen authorized component/variant scope." }));
    if (candidate.symbolIdentity.versionId !== context.symbolIdentity.versionId || candidate.symbolIdentity.contentDigest !== context.symbolIdentity.contentDigest) findings.push(finding({ code: "MV_SYMBOL_IDENTITY_MISMATCH", layer: "symbol", message: "Candidate symbol identity/revision differs from the frozen asset." }));
    if (candidate.footprintIdentity.versionId !== context.footprintIdentity.versionId || candidate.footprintIdentity.contentDigest !== context.footprintIdentity.contentDigest) findings.push(finding({ code: "MV_FOOTPRINT_IDENTITY_MISMATCH", layer: "footprint_pad", message: "Candidate footprint identity/digest differs from the frozen asset." }));
    if (candidate.packageIdentity.packageRevisionId !== context.packageIdentity.packageRevisionId || candidate.packageIdentity.packageIdentityId !== context.packageIdentity.packageIdentityId) findings.push(finding({ code: "MV_PACKAGE_IDENTITY_MISMATCH", layer: "package_terminal", message: "Candidate package revision differs from the frozen package facts." }));
    if (Boolean(candidate.exactPartIdentity) !== Boolean(context.exactPartIdentity) || candidate.exactPartIdentity?.atomicPartRevisionId !== context.exactPartIdentity?.atomicPartRevisionId) findings.push(finding({ code: "MV_EXACT_PART_IDENTITY_MISMATCH", layer: "scope", message: "Candidate exact-part revision differs from the frozen context." }));

    const pins = new Map(context.symbolPins.map((item) => [item.stablePinId, item])), terminals = new Map(context.packageTerminals.map((item) => [item.stableTerminalId, item])), pads = new Map(context.footprintPads.map((item) => [item.stablePadId, item]));
    const allEdges = [...candidate.symbolToTerminalEdges, ...candidate.terminalToPadEdges, ...candidate.directSymbolToPadEdges];
    const edgeIds = allEdges.map((item) => item.edgeId);
    if (new Set(edgeIds).size !== edgeIds.length) findings.push(finding({ code: "MV_EDGE_ID_DUPLICATE", layer: "scope", message: "Mapping graph contains duplicate edge identities.", edges: edgeIds }));
    if (allEdges.length > policy.maxEdges) findings.push(finding({ code: "MV_EDGE_LIMIT_EXCEEDED", layer: "scope", message: "Mapping graph exceeds the bounded edge limit.", observed: String(allEdges.length), expected: String(policy.maxEdges) }));

    for (const edge of candidate.symbolToTerminalEdges) {
      const pin = pins.get(edge.symbolPinId), terminal = terminals.get(edge.packageTerminalId);
      if (!pin) findings.push(finding({ code: "MV_SYMBOL_EDGE_ENDPOINT_MISSING", layer: "symbol_to_terminal", message: "Symbol-to-terminal edge references an absent logical pin.", pins: [edge.symbolPinId], edges: [edge.edgeId], remediation: "coverage" }));
      if (!terminal) findings.push(finding({ code: "MV_TERMINAL_EDGE_ENDPOINT_MISSING", layer: "symbol_to_terminal", message: "Symbol-to-terminal edge references an absent package terminal.", terminals: [edge.packageTerminalId], edges: [edge.edgeId], remediation: "coverage" }));
      if (!pin || !terminal) continue;
      if (pin.functionClass !== "unknown" && terminal.functionClass !== "unknown" && pin.functionClass !== terminal.functionClass) findings.push(finding({ code: "MV_FUNCTION_CONTRADICTION", layer: "symbol_to_terminal", message: "Logical pin and manufacturer terminal functions contradict.", expected: pin.functionClass, observed: terminal.functionClass, pins: [pin.stablePinId], terminals: [terminal.stableTerminalId], edges: [edge.edgeId], remediation: "function" }));
      if (edge.assertedFunction !== "unknown" && ((pin.functionClass !== "unknown" && edge.assertedFunction !== pin.functionClass) || (terminal.functionClass !== "unknown" && edge.assertedFunction !== terminal.functionClass))) findings.push(finding({ code: "MV_EDGE_FUNCTION_ASSERTION_CONTRADICTION", layer: "symbol_to_terminal", message: "Edge function assertion contradicts an endpoint.", edges: [edge.edgeId], remediation: "function" }));
      if (pin.polarityRole !== "unknown" && pin.polarityRole !== "none" && terminal.polarityRole !== "unknown" && terminal.polarityRole !== "none" && pin.polarityRole !== terminal.polarityRole) findings.push(finding({ code: "MV_POLARITY_ORIENTATION_REVERSED", layer: "symbol_to_terminal", message: "Polarity or orientation-sensitive terminal mapping is reversed.", pins: [pin.stablePinId], terminals: [terminal.stableTerminalId], edges: [edge.edgeId], remediation: "polarity" }));
      if (terminal.connectionRequirement === "must_not_connect" && pin.mappingRequirement === "required") findings.push(finding({ code: "MV_DNC_TERMINAL_CONNECTED", layer: "symbol_to_terminal", message: "A do-not-connect terminal is mapped to an active logical pin.", pins: [pin.stablePinId], terminals: [terminal.stableTerminalId], remediation: "no_connect" }));
    }

    for (const edge of candidate.terminalToPadEdges) {
      const terminal = terminals.get(edge.packageTerminalId), pad = pads.get(edge.footprintPadId);
      if (!terminal) findings.push(finding({ code: "MV_TERMINAL_EDGE_ENDPOINT_MISSING", layer: "terminal_to_pad", message: "Terminal-to-pad edge references an absent package terminal.", terminals: [edge.packageTerminalId], edges: [edge.edgeId], remediation: "coverage" }));
      if (!pad) findings.push(finding({ code: "MV_PAD_EDGE_ENDPOINT_MISSING", layer: "terminal_to_pad", message: "Terminal-to-pad edge references an absent exact footprint pad.", pads: [edge.footprintPadId], edges: [edge.edgeId], remediation: "coverage" }));
      if (!terminal || !pad) continue;
      if (["mechanical", "mounting"].includes(pad.classification) && !["mechanical", "mounting"].includes(terminal.classification)) findings.push(finding({ code: "MV_MECHANICAL_PAD_MISCLASSIFIED", layer: "terminal_to_pad", message: "An electrical terminal is mapped to a mechanical pad.", terminals: [terminal.stableTerminalId], pads: [pad.stablePadId], remediation: "mechanical" }));
      if (terminal.classification === "thermal_exposed" && pad.classification !== "thermal_exposed") findings.push(finding({ code: "MV_THERMAL_EXPOSED_PAD_CONTRADICTION", layer: "terminal_to_pad", message: "An exposed/thermal terminal is not mapped to an explicitly classified thermal pad.", terminals: [terminal.stableTerminalId], pads: [pad.stablePadId], remediation: "thermal" }));
      if (terminal.classification === "shield" && pad.classification !== "shield" && pad.classification !== "mechanical") findings.push(finding({ code: "MV_SHIELD_PAD_CONTRADICTION", layer: "terminal_to_pad", message: "Shield/chassis terminal is mapped to an incompatible pad classification.", terminals: [terminal.stableTerminalId], pads: [pad.stablePadId], remediation: "function" }));
    }

    if (candidate.compatibilityMode !== "limited_direct_pair" && candidate.directSymbolToPadEdges.length) findings.push(finding({ code: "MV_DIRECT_EDGE_MODE_INVALID", layer: "direct_pair", message: "Direct symbol-to-pad edges require explicit limited-direct mode." }));
    if (candidate.compatibilityMode === "limited_direct_pair" && !policy.allowedLimitedDirectRisks.includes(context.riskClass)) findings.push(finding({ code: "MV_LIMITED_DIRECT_RISK_FORBIDDEN", layer: "direct_pair", message: "Limited direct-pair verification is forbidden for this component risk class.", remediation: "evidence" }));
    for (const edge of candidate.directSymbolToPadEdges) {
      if (!pins.has(edge.symbolPinId)) findings.push(finding({ code: "MV_SYMBOL_EDGE_ENDPOINT_MISSING", layer: "direct_pair", message: "Direct edge references an absent logical pin.", pins: [edge.symbolPinId], edges: [edge.edgeId], remediation: "coverage" }));
      if (!pads.has(edge.footprintPadId)) findings.push(finding({ code: "MV_PAD_EDGE_ENDPOINT_MISSING", layer: "direct_pair", message: "Direct edge references an absent footprint pad.", pads: [edge.footprintPadId], edges: [edge.edgeId], remediation: "coverage" }));
    }

    const terminalInbound = new Map<string, typeof candidate.symbolToTerminalEdges>();
    for (const edge of candidate.symbolToTerminalEdges) terminalInbound.set(edge.packageTerminalId, [...(terminalInbound.get(edge.packageTerminalId) ?? []), edge]);
    for (const [terminalId, edges] of terminalInbound) if (edges.length > 1 && edges.some((item) => item.relationship !== "multiple_representations_to_terminal" && item.relationship !== "equivalent_permutation")) findings.push(finding({ code: "MV_ILLEGAL_MANY_TO_ONE_SHORT", layer: "symbol_to_terminal", message: "Distinct logical pins converge on one terminal without an explicit commoning relationship.", terminals: [terminalId], pins: edges.map((item) => item.symbolPinId), edges: edges.map((item) => item.edgeId), remediation: "cardinality" }));
    const padInbound = new Map<string, typeof candidate.terminalToPadEdges>();
    for (const edge of candidate.terminalToPadEdges) padInbound.set(edge.footprintPadId, [...(padInbound.get(edge.footprintPadId) ?? []), edge]);
    for (const [padId, edges] of padInbound) if (edges.length > 1 && edges.some((item) => item.relationship !== "terminals_to_common_exposed_pad" && item.relationship !== "equivalent_permutation")) findings.push(finding({ code: "MV_ILLEGAL_TERMINAL_SHORT", layer: "terminal_to_pad", message: "Distinct package terminals converge on one pad without documented commoning.", terminals: edges.map((item) => item.packageTerminalId), pads: [padId], edges: edges.map((item) => item.edgeId), remediation: "cardinality" }));

    const allIdentityIds = new Set([...pins.keys(), ...terminals.keys(), ...pads.keys()]);
    for (const equivalence of candidate.equivalenceClasses) {
      const missing = equivalence.memberIds.filter((id) => !allIdentityIds.has(id));
      if (missing.length) findings.push(finding({ code: "MV_EQUIVALENCE_MEMBER_MISSING", layer: "equivalence", message: "Equivalence class references absent identities.", pins: missing, remediation: "equivalence" }));
      if (!equivalence.evidenceRefs.length) findings.push(finding({ code: "MV_EQUIVALENCE_EVIDENCE_MISSING", layer: "equivalence", message: "Electrical interchangeability requires explicit current evidence.", remediation: "equivalence" }));
      if (context.riskClass !== "symmetric_two_terminal_nonpolar") findings.push(finding({ code: "MV_EQUIVALENCE_RISK_CONTRADICTION", layer: "equivalence", message: "This component risk class cannot inherit passive terminal symmetry.", remediation: "equivalence" }));
      for (const permutation of equivalence.allowedPermutations) if (permutation.length !== equivalence.memberIds.length || permutation.some((id) => !equivalence.memberIds.includes(id))) findings.push(finding({ code: "MV_EQUIVALENCE_PERMUTATION_INVALID", layer: "equivalence", message: "Equivalence permutation is incomplete or contains a non-member.", remediation: "equivalence" }));
    }

    const validExplicit = candidate.explicitUnmappedItems.filter((item) => {
      const pin = item.layer === "symbol" ? pins.get(item.itemId) : undefined;
      const terminal = item.layer === "package_terminal" ? terminals.get(item.itemId) : undefined;
      const pad = item.layer === "footprint_pad" ? pads.get(item.itemId) : undefined;
      if (!pin && !terminal && !pad) {
        findings.push(finding({ code: "MV_UNMAPPED_ITEM_ENDPOINT_MISSING", layer: item.layer, message: "Explicit unmapped disposition references an identity outside the frozen context.", pins: item.layer === "symbol" ? [item.itemId] : [], terminals: item.layer === "package_terminal" ? [item.itemId] : [], pads: item.layer === "footprint_pad" ? [item.itemId] : [], evidence: item.evidenceRefs, remediation: "coverage" }));
        return false;
      }
      const valid = pin
        ? pin.mappingRequirement !== "required" || (pin.functionClass === "no_connect" && item.disposition === "no_connect")
        : terminal
          ? terminal.connectionRequirement !== "required" && (terminal.connectionRequirement !== "must_not_connect" || item.disposition === "do_not_connect")
          : Boolean(pad && (["mechanical", "mounting"].includes(pad.classification) ? ["mechanical", "mounting"].includes(item.disposition) : ["no_connect", "do_not_connect", "reserved", "test", "unpopulated"].includes(pad.classification) && item.disposition === pad.classification));
      if (!valid) findings.push(finding({ code: "MV_UNMAPPED_DISPOSITION_CONTRADICTS_IDENTITY", layer: item.layer, message: "An explicit unmapped disposition cannot waive a required electrical identity.", pins: pin ? [pin.stablePinId] : [], terminals: terminal ? [terminal.stableTerminalId] : [], pads: pad ? [pad.stablePadId] : [], evidence: item.evidenceRefs, remediation: "coverage" }));
      return valid;
    });
    const explicitSymbol = new Set(validExplicit.filter((item) => item.layer === "symbol").map((item) => item.itemId));
    const explicitTerminal = new Set(validExplicit.filter((item) => item.layer === "package_terminal").map((item) => item.itemId));
    const explicitPad = new Set(validExplicit.filter((item) => item.layer === "footprint_pad").map((item) => item.itemId));
    const mappedPins = new Set([...candidate.symbolToTerminalEdges.map((item) => item.symbolPinId), ...candidate.directSymbolToPadEdges.map((item) => item.symbolPinId)]), mappedTerminalsIn = new Set(candidate.symbolToTerminalEdges.map((item) => item.packageTerminalId)), mappedTerminalsOut = new Set(candidate.terminalToPadEdges.map((item) => item.packageTerminalId)), mappedPads = new Set([...candidate.terminalToPadEdges.map((item) => item.footprintPadId), ...candidate.directSymbolToPadEdges.map((item) => item.footprintPadId)]);
    const requiredPins = context.symbolPins.filter((item) => item.mappingRequirement === "required").map((item) => item.stablePinId);
    const requiredTerminals = context.packageTerminals.filter((item) => item.connectionRequirement === "required" || item.connectionRequirement === "must_not_connect").map((item) => item.stableTerminalId);
    const requiredPads = context.footprintPads.filter((item) => !["mechanical", "mounting"].includes(item.classification)).map((item) => item.stablePadId);
    const symbolCoverage = coverage(requiredPins, mappedPins, explicitSymbol), packageTerminalCoverage = coverage(requiredTerminals, new Set([...mappedTerminalsIn].filter((id) => mappedTerminalsOut.has(id))), explicitTerminal), footprintPadCoverage = coverage(requiredPads, mappedPads, explicitPad);
    if (symbolCoverage.missing) findings.push(finding({ code: "MV_SYMBOL_COVERAGE_INCOMPLETE", layer: "symbol", message: "One or more required logical pins are unaccounted.", pins: symbolCoverage.missingIds, remediation: "coverage" }));
    if (packageTerminalCoverage.missing) findings.push(finding({ code: "MV_TERMINAL_COVERAGE_INCOMPLETE", layer: "package_terminal", message: "One or more required package terminals are unaccounted.", terminals: packageTerminalCoverage.missingIds, remediation: "coverage" }));
    if (footprintPadCoverage.missing) findings.push(finding({ code: "MV_PAD_COVERAGE_INCOMPLETE", layer: "footprint_pad", message: "One or more electrical footprint pads are unaccounted.", pads: footprintPadCoverage.missingIds, remediation: "coverage" }));
    for (const pad of context.footprintPads.filter((item) => ["mechanical", "mounting"].includes(item.classification))) if (!explicitPad.has(pad.stablePadId)) findings.push(finding({ code: "MV_MECHANICAL_PAD_DISPOSITION_MISSING", layer: "footprint_pad", message: "Every mechanical/mounting pad requires an explicit non-electrical disposition.", pads: [pad.stablePadId], remediation: "mechanical" }));

    if (["number_equality_candidate", "legacy_direct"].includes(candidate.origin)) {
      findings.push(finding({ code: "MV_UNSAFE_HEURISTIC_ORIGIN", layer: "evidence", message: "Number/name/order-derived or legacy mappings remain unverified candidates.", remediation: "evidence" }));
      ambiguities.push(ambiguity("MV_MAPPING_AUTHORITY_AMBIGUOUS", ["manufacturer terminal table", "human-reviewed curated mapping"], candidate.evidenceRefs, "Equal counts, names, numbers, or order do not select one authoritative physical mapping."));
    }
    if (["ai_extracted", "api_extraction"].includes(candidate.origin)) findings.push(finding({ code: "MV_MACHINE_SUGGESTION_UNVERIFIED", layer: "evidence", message: "AI/OCR/API extraction confidence cannot establish verification or approval.", remediation: "evidence" }));
    const evidence = evidenceAssessment(context, candidate, policy, findings);
    const conflictingEvidence = context.evidence.filter((item) => item.freshness === "conflicting" && evidence.total > 0);
    if (conflictingEvidence.length) conflicts.push(conflict("MV_EVIDENCE_CONFLICT", [context.packageIdentity.packageRevisionId, context.footprintIdentity.versionId], conflictingEvidence.map((item) => item.evidenceId), "Current evidence contains incompatible physical-terminal assertions."));
    let tier = candidateTier(context, candidate, evidence);
    if (tier && tier !== "limited_direct_pair") {
      const required = policy.minimumTierByRisk[context.riskClass];
      if (required === "unsupported") findings.push(finding({ code: "MV_RISK_CLASS_UNSUPPORTED", layer: "scope", message: "This component risk class is outside the verified policy profile.", remediation: "evidence" }));
      else if (!tierSatisfies(tier, required)) findings.push(finding({ code: "MV_VERIFICATION_TIER_INSUFFICIENT", layer: "evidence", message: "The strongest defensible verification tier is below the policy requirement.", expected: required, observed: tier, remediation: "evidence" }));
    }
    findings.sort(findingSort);
    if (findings.length > policy.maxFindings) throw new Error("MV_FINDING_LIMIT_EXCEEDED");
    let status = statusFrom(findings, conflicts, ambiguities, evidence);
    if (status === "verified" && tier === "limited_direct_pair") status = "verified_limited";
    if (status !== "verified" && status !== "verified_limited") tier = undefined;
    const technical = { resultSchemaVersion: MAPPING_RESULT_VERSION, status, ...(tier ? { tier } : {}), mappingCandidateId: candidate.mappingCandidateId, candidateDigest: candidate.candidateDigest, dependencySnapshot: context.dependencySnapshot, symbolCoverage, packageTerminalCoverage, footprintPadCoverage, findings, conflicts: conflicts.sort((a, b) => a.conflictId.localeCompare(b.conflictId)), ambiguities: ambiguities.sort((a, b) => a.ambiguityId.localeCompare(b.ambiguityId)), ...((status === "verified" || status === "verified_limited") ? { normalizedMapping: candidate } : {}), evidenceAssessment: evidence, policyId: policy.policyId, policyVersion: policy.version, verifierId: MAPPING_VERIFIER_ID, verifierVersion: MAPPING_VERIFIER_VERSION, parserVersions: context.dependencySnapshot.parserVersions, claims: { selectsFootprint: false as const, approvesMapping: false as const, mutatesSchematic: false as const, mutatesPcb: false as const, certifiesLandPatternGeometry: false as const } };
    const resultDigest = mappingDigest(resultTechnicalPayload(technical));
    return { ...technical, verificationId: mappingId("mapping-verification", resultDigest), resultDigest, requestId: request.requestId, evaluatedAt: request.requestedAt };
  }
}
