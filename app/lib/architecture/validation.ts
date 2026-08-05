import { architectureDigest, architectureId } from "./stable";
import type {
  ArchitectureCandidateProposal,
  ArchitectureDiagnostic,
  ArchitectureProblem,
  SystemArchitectureCandidate,
} from "./types";
import { ARCHITECTURE_PROPOSAL_SCHEMA_VERSION, ARCHITECTURE_SCHEMA_VERSION } from "./types";
import { validateRequirementPredicate } from "../requirements/validation";

const LIMITS = { blocks: 256, ports: 512, flows: 512, modes: 64, transitions: 256, domains: 64, boundaries: 128, responsibilities: 256, resources: 512, risks: 256, questions: 128, hierarchyDepth: 12 } as const;
const TOP_LEVEL_KEYS = new Set(["schemaVersion", "proposalId", "problemDigest", "lineageId", "title", "summary", "patternRefs", "blocks", "ports", "flows", "modes", "transitions", "domains", "boundaries", "responsibilities", "resources", "risks", "architectureQuestions", "assumptions"]);
const ITEM_KEYS: Record<string, Set<string>> = {
  blocks: new Set(["localId", "parentLocalId", "role", "label", "description", "requirementRefs", "patternRuleRefs", "ownerKind"]),
  ports: new Set(["localId", "blockLocalId", "role", "label", "direction", "flowKind", "required", "requirementRefs"]),
  flows: new Set(["localId", "role", "label", "flowKind", "producerPortLocalId", "consumerPortLocalIds", "requirementRefs", "modeLocalIds", "dependencyClass"]),
  modes: new Set(["localId", "label", "description", "initial", "safeState", "terminal", "requirementRefs"]),
  transitions: new Set(["localId", "fromModeLocalId", "toModeLocalId", "trigger", "guard", "response", "requirementRefs"]),
  domains: new Set(["localId", "kind", "label", "blockLocalIds", "requirementRefs"]),
  boundaries: new Set(["localId", "kind", "label", "domainLocalIds", "crossingFlowLocalIds", "requirementRefs"]),
  responsibilities: new Set(["localId", "role", "ownerKind", "blockLocalIds", "requirementRefs", "verificationObligationRefs"]),
  resources: new Set(["localId", "blockLocalId", "dimension", "allocation", "evidenceState", "rationale", "requirementRefs"]),
  risks: new Set(["localId", "category", "description", "likelihood", "impact", "mitigation", "requirementRefs"]),
  architectureQuestions: new Set(["localId", "question", "blocking", "requirementRefs"]),
};
const FORBIDDEN_KEYS = /(^|_)(part(number)?|mpn|manufacturer|symbol|footprint|pin|pad|net|bom|coordinate|x|y|voltage_value|resistance|capacitance)(_|$)/i;
const FORBIDDEN_VALUES = /\b(STM32|ESP32|ATmega|nRF5|TPS\d|LM\d{2,}|SN74|AD\d{3,}|LTC\d|MCP\d|KiCad|QFN|BGA|0402|0603|0805)\b/i;
const STRING_FIELDS = new Set(["role", "label", "description", "ownerKind", "blockLocalId", "direction", "flowKind", "producerPortLocalId", "dependencyClass", "fromModeLocalId", "toModeLocalId", "trigger", "response", "kind", "category", "likelihood", "impact", "mitigation", "question", "dimension", "evidenceState", "rationale"]);
const BOOLEAN_FIELDS = new Set(["required", "initial", "safeState", "terminal", "blocking"]);
const FLOW_KINDS = new Set(["power", "energy", "analog", "data", "control", "clock", "reset", "debug", "thermal", "mechanical"]);
const OWNER_KINDS = new Set(["system", "hardware", "firmware", "software", "mechanical", "manufacturing", "external_authority", "user"]);

function diag(code: string, message: string, objectRefs: string[] = [], requirementRefs: string[] = []): ArchitectureDiagnostic {
  return { diagnosticId: architectureId("architecture-diagnostic", { code, message, objectRefs, requirementRefs }), code, severity: "error", message, objectRefs: [...objectRefs].sort(), requirementRefs: [...requirementRefs].sort(), nextActions: ["Correct the architecture proposal and validate again"] };
}

function duplicateIds(items: Array<{ localId: string }>): string[] {
  const seen = new Set<string>(); const duplicates = new Set<string>();
  for (const item of items) { if (seen.has(item.localId)) duplicates.add(item.localId); seen.add(item.localId); }
  return [...duplicates].sort();
}

function allRequirementRefs(proposal: ArchitectureCandidateProposal): string[] {
  return [proposal.blocks, proposal.ports, proposal.flows, proposal.modes, proposal.transitions, proposal.domains, proposal.boundaries, proposal.responsibilities, proposal.resources, proposal.risks, proposal.architectureQuestions].flatMap((items) => items.flatMap((item) => item.requirementRefs));
}

function hierarchyDepth(blockId: string, parents: Map<string, string | null>): number {
  let cursor: string | null | undefined = blockId; let depth = 0; const visited = new Set<string>();
  while (cursor !== null && cursor !== undefined) { if (visited.has(cursor)) return Number.POSITIVE_INFINITY; visited.add(cursor); cursor = parents.get(cursor); depth += 1; }
  return depth;
}

function reachableModes(initial: string, transitions: ArchitectureCandidateProposal["transitions"]): Set<string> {
  const reached = new Set([initial]); let changed = true;
  while (changed) { changed = false; for (const edge of transitions) if (reached.has(edge.fromModeLocalId) && !reached.has(edge.toModeLocalId)) { reached.add(edge.toModeLocalId); changed = true; } }
  return reached;
}

function dependencyCycles(proposal: ArchitectureCandidateProposal): string[][] {
  const portBlock = new Map(proposal.ports.map((item) => [item.localId, item.blockLocalId]));
  const edges = proposal.flows.filter((item) => item.dependencyClass === "normal").flatMap((flow) => flow.consumerPortLocalIds.map((consumer) => [portBlock.get(flow.producerPortLocalId), portBlock.get(consumer)] as const)).filter((edge): edge is readonly [string, string] => Boolean(edge[0] && edge[1] && edge[0] !== edge[1]));
  const adjacency = new Map<string, string[]>(); edges.forEach(([from, to]) => adjacency.set(from, [...(adjacency.get(from) ?? []), to]));
  const cycles: string[][] = []; const visiting = new Set<string>(); const visited = new Set<string>(); const path: string[] = [];
  function visit(node: string): void { if (visiting.has(node)) { const index = path.indexOf(node); cycles.push([...path.slice(index), node]); return; } if (visited.has(node)) return; visiting.add(node); path.push(node); for (const next of adjacency.get(node) ?? []) visit(next); path.pop(); visiting.delete(node); visited.add(node); }
  proposal.blocks.forEach((item) => visit(item.localId)); return cycles;
}

export function validateArchitectureProposal(proposal: ArchitectureCandidateProposal, problem: ArchitectureProblem): ArchitectureDiagnostic[] {
  const diagnostics: ArchitectureDiagnostic[] = [];
  if (proposal.schemaVersion !== ARCHITECTURE_PROPOSAL_SCHEMA_VERSION) diagnostics.push(diag("PROPOSAL_SCHEMA_UNSUPPORTED", "The architecture proposal schema is unsupported."));
  if (proposal.problemDigest !== problem.deterministicDigest) diagnostics.push(diag("PROPOSAL_PROBLEM_DIGEST_MISMATCH", "The proposal was not produced for the exact current architecture problem."));
  const unknownTop = Object.keys(proposal as unknown as Record<string, unknown>).filter((key) => !TOP_LEVEL_KEYS.has(key));
  if (unknownTop.length) diagnostics.push(diag("PROPOSAL_UNKNOWN_FIELDS", `Unsupported top-level fields: ${unknownTop.sort().join(", ")}.`));
  let invalidCollectionShape = false;
  for (const [collection, allowed] of Object.entries(ITEM_KEYS)) {
    const value = (proposal as unknown as Record<string, unknown>)[collection];
    if (!Array.isArray(value)) { invalidCollectionShape = true; diagnostics.push(diag("PROPOSAL_COLLECTION_REQUIRED", `${collection} must be an array.`)); continue; }
    for (const item of value) if (!item || typeof item !== "object" || Array.isArray(item)) { invalidCollectionShape = true; diagnostics.push(diag("PROPOSAL_ITEM_OBJECT_REQUIRED", `${collection} entries must be objects.`)); } else {
      const record = item as Record<string, unknown>;
      const unknown = Object.keys(record).filter((key) => !allowed.has(key));
      if (unknown.length) diagnostics.push(diag("PROPOSAL_ITEM_UNKNOWN_FIELDS", `${collection} contains unsupported fields: ${unknown.sort().join(", ")}.`, [String((item as { localId?: string }).localId ?? collection)]));
      const referenceFields = ["requirementRefs", "patternRuleRefs", "consumerPortLocalIds", "modeLocalIds", "blockLocalIds", "domainLocalIds", "crossingFlowLocalIds", "verificationObligationRefs"];
      const badRefs = referenceFields.filter((field) => field in record && (!Array.isArray(record[field]) || !(record[field] as unknown[]).every((entry) => typeof entry === "string")));
      const badStrings = [...STRING_FIELDS].filter((field) => field in record && typeof record[field] !== "string"); const badBooleans = [...BOOLEAN_FIELDS].filter((field) => field in record && typeof record[field] !== "boolean");
      const badNullableIds = ["parentLocalId"].filter((field) => field in record && record[field] !== null && typeof record[field] !== "string"); const badGuard = "guard" in record && record.guard !== null && typeof record.guard !== "string";
      if (typeof record.localId !== "string" || badRefs.length || badStrings.length || badBooleans.length || badNullableIds.length || badGuard) { invalidCollectionShape = true; diagnostics.push(diag("PROPOSAL_ITEM_SHAPE_INVALID", `${collection} contains invalid identity, scalar, or reference-list fields.`, [String(record.localId ?? collection)])); }
    }
  }
  if (!Array.isArray(proposal.patternRefs) || !proposal.patternRefs.every((item) => typeof item === "string") || !Array.isArray(proposal.assumptions) || !proposal.assumptions.every((item) => typeof item === "string")) { invalidCollectionShape = true; diagnostics.push(diag("PROPOSAL_TOP_LEVEL_SHAPE_INVALID", "patternRefs and assumptions must be string arrays.")); }
  function scan(value: unknown, path = "proposal"): void {
    if (typeof value === "string" && FORBIDDEN_VALUES.test(value)) diagnostics.push(diag("PROPOSAL_CONCRETE_IMPLEMENTATION_FORBIDDEN", `Concrete implementation identifier found at ${path}.`));
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) return value.forEach((item, index) => scan(item, `${path}[${index}]`));
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) { if (FORBIDDEN_KEYS.test(key)) diagnostics.push(diag("PROPOSAL_FORBIDDEN_FIELD", `Field '${key}' is not permitted in architecture proposals.`, [path])); scan(child, `${path}.${key}`); }
  }
  scan(proposal);
  if (invalidCollectionShape) return diagnostics.sort((left, right) => left.code.localeCompare(right.code) || left.diagnosticId.localeCompare(right.diagnosticId));
  if (typeof proposal.proposalId !== "string" || !proposal.proposalId.trim() || typeof proposal.lineageId !== "string" || !proposal.lineageId.trim() || typeof proposal.title !== "string" || !proposal.title.trim() || typeof proposal.summary !== "string" || !proposal.summary.trim()) diagnostics.push(diag("PROPOSAL_IDENTITY_REQUIRED", "Proposal identity, lineage, title, and summary are required."));
  for (const [collection, limit] of Object.entries(LIMITS).filter(([name]) => name !== "hierarchyDepth")) {
    const count = ((proposal as unknown as Record<string, unknown[]>)[collection] ?? []).length;
    if (count > limit) diagnostics.push(diag("PROPOSAL_RESOURCE_LIMIT", `${collection} count ${count} exceeds ${limit}.`));
  }
  if (!proposal.blocks?.length) diagnostics.push(diag("ARCHITECTURE_ROOT_REQUIRED", "At least one system block is required."));
  const collections = [proposal.blocks, proposal.ports, proposal.flows, proposal.modes, proposal.transitions, proposal.domains, proposal.boundaries, proposal.responsibilities, proposal.resources, proposal.risks, proposal.architectureQuestions];
  const allIds = collections.flatMap((items) => items.map((item) => item.localId));
  if (new Set(allIds).size !== allIds.length) diagnostics.push(diag("LOCAL_ID_REUSE", "Candidate-local IDs must be unique across every architecture object."));
  if (allIds.some((id) => !/^[a-z][a-z0-9_-]{0,63}$/.test(id))) diagnostics.push(diag("LOCAL_ID_INVALID", "Local IDs must use lower-case semantic slugs no longer than 64 characters."));
  if (duplicateIds(proposal.blocks).length) diagnostics.push(diag("DUPLICATE_BLOCK_ID", "Block local IDs must be unique."));

  const blockIds = new Set(proposal.blocks.map((item) => item.localId));
  if (proposal.blocks.some((item) => !OWNER_KINDS.has(item.ownerKind)) || proposal.ports.some((item) => !["input", "output", "bidirectional"].includes(item.direction) || !FLOW_KINDS.has(item.flowKind)) || proposal.flows.some((item) => !FLOW_KINDS.has(item.flowKind) || !["normal", "bootstrap", "fault_response"].includes(item.dependencyClass)) || proposal.responsibilities.some((item) => !OWNER_KINDS.has(item.ownerKind)) || proposal.domains.some((item) => !["power", "clock", "reset", "trust", "thermal", "mechanical", "ownership"].includes(item.kind)) || proposal.boundaries.some((item) => !["isolation", "protection", "trust", "thermal", "mechanical", "organizational"].includes(item.kind)) || proposal.resources.some((item) => !["power", "energy", "cost", "area", "latency", "bandwidth", "thermal", "memory", "compute", "io"].includes(item.dimension) || !["pass", "fail", "unknown", "unsupported", "not_evaluated", "stale", "external_review_planned"].includes(item.evidenceState)) || proposal.risks.some((item) => !["feasibility", "integration", "verification", "safety", "schedule", "sourcing", "complexity"].includes(item.category) || !["low", "medium", "high", "unknown"].includes(item.likelihood) || !["low", "medium", "high", "critical"].includes(item.impact))) diagnostics.push(diag("PROPOSAL_ENUM_INVALID", "The proposal contains an unsupported enum value."));
  const roots = proposal.blocks.filter((item) => item.parentLocalId === null);
  if (roots.length !== 1) diagnostics.push(diag("ARCHITECTURE_ROOT_CARDINALITY", `Exactly one root block is required; found ${roots.length}.`, roots.map((item) => item.localId)));
  const parents = new Map(proposal.blocks.map((item) => [item.localId, item.parentLocalId]));
  for (const block of proposal.blocks) if (block.parentLocalId !== null && !blockIds.has(block.parentLocalId)) diagnostics.push(diag("BLOCK_PARENT_NOT_FOUND", `Parent '${block.parentLocalId}' does not exist.`, [block.localId]));
  for (const block of proposal.blocks) { const depth = hierarchyDepth(block.localId, parents); if (!Number.isFinite(depth)) diagnostics.push(diag("BLOCK_HIERARCHY_CYCLE", "Block hierarchy contains a cycle.", [block.localId])); else if (depth > LIMITS.hierarchyDepth) diagnostics.push(diag("BLOCK_HIERARCHY_TOO_DEEP", `Block hierarchy exceeds depth ${LIMITS.hierarchyDepth}.`, [block.localId])); }

  const portById = new Map(proposal.ports.map((item) => [item.localId, item]));
  for (const port of proposal.ports) if (!blockIds.has(port.blockLocalId)) diagnostics.push(diag("PORT_BLOCK_NOT_FOUND", "Port owner block does not exist.", [port.localId, port.blockLocalId]));
  for (const flow of proposal.flows) {
    const producer = portById.get(flow.producerPortLocalId);
    if (!producer) diagnostics.push(diag("FLOW_PRODUCER_NOT_FOUND", "Flow producer port does not exist.", [flow.localId, flow.producerPortLocalId]));
    else if (producer.direction === "input") diagnostics.push(diag("FLOW_PRODUCER_DIRECTION_INVALID", "An input-only port cannot produce a flow.", [flow.localId, producer.localId]));
    if (!flow.consumerPortLocalIds.length) diagnostics.push(diag("FLOW_CONSUMER_REQUIRED", "Every flow needs at least one consumer.", [flow.localId]));
    for (const id of flow.consumerPortLocalIds) { const consumer = portById.get(id); if (!consumer) diagnostics.push(diag("FLOW_CONSUMER_NOT_FOUND", "Flow consumer port does not exist.", [flow.localId, id])); else { if (consumer.direction === "output") diagnostics.push(diag("FLOW_CONSUMER_DIRECTION_INVALID", "An output-only port cannot consume a flow.", [flow.localId, id])); if (consumer.flowKind !== flow.flowKind) diagnostics.push(diag("FLOW_KIND_MISMATCH", "Consumer and flow kinds must match.", [flow.localId, id])); } }
    if (producer && producer.flowKind !== flow.flowKind) diagnostics.push(diag("FLOW_KIND_MISMATCH", "Producer and flow kinds must match.", [flow.localId, producer.localId]));
  }
  const connectedPorts = new Set(proposal.flows.flatMap((item) => [item.producerPortLocalId, ...item.consumerPortLocalIds]));
  for (const port of proposal.ports) if (port.required && !connectedPorts.has(port.localId)) diagnostics.push(diag("REQUIRED_PORT_UNCONNECTED", "A required port is not connected by a flow.", [port.localId]));
  const childCount = new Map<string, number>(); proposal.blocks.forEach((item) => { if (item.parentLocalId) childCount.set(item.parentLocalId, (childCount.get(item.parentLocalId) ?? 0) + 1); });
  const portCount = new Map<string, number>(); proposal.ports.forEach((item) => portCount.set(item.blockLocalId, (portCount.get(item.blockLocalId) ?? 0) + 1));
  for (const block of proposal.blocks) if (block.parentLocalId !== null && !(childCount.get(block.localId) || portCount.get(block.localId) || block.requirementRefs.length || block.patternRuleRefs.length)) diagnostics.push(diag("ORPHAN_BLOCK", "A non-root block must own behavior, an interface, a requirement, or a pattern rule.", [block.localId]));

  const modeIds = new Set(proposal.modes.map((item) => item.localId));
  const initials = proposal.modes.filter((item) => item.initial);
  if (proposal.modes.length && initials.length !== 1) diagnostics.push(diag("MODE_INITIAL_CARDINALITY", `Exactly one initial mode is required; found ${initials.length}.`));
  for (const edge of proposal.transitions) if (!modeIds.has(edge.fromModeLocalId) || !modeIds.has(edge.toModeLocalId)) diagnostics.push(diag("MODE_TRANSITION_REFERENCE_INVALID", "Mode transition endpoint does not exist.", [edge.localId]));
  if (initials.length === 1) { const reached = reachableModes(initials[0].localId, proposal.transitions); for (const mode of proposal.modes) if (!reached.has(mode.localId)) diagnostics.push(diag("MODE_UNREACHABLE", "Mode is unreachable from the initial state.", [mode.localId])); }
  for (const mode of proposal.modes) if (!mode.terminal && !proposal.transitions.some((item) => item.fromModeLocalId === mode.localId)) diagnostics.push(diag("MODE_DEAD_END", "A non-terminal mode has no outgoing transition.", [mode.localId]));
  if (problem.requiredModeVocabulary.length && !proposal.modes.some((item) => item.safeState)) diagnostics.push(diag("SAFE_STATE_REQUIRED", "A safe state is required when the requirements define operating modes."));
  for (const required of problem.requiredModeVocabulary) if (!proposal.modes.some((item) => item.label.toLowerCase() === required.toLowerCase() || item.localId === required.toLowerCase().replace(/[^a-z0-9]+/g, "_"))) diagnostics.push(diag("REQUIRED_MODE_MISSING", `Required mode '${required}' is not represented.`));

  const domainIds = new Set(proposal.domains.map((item) => item.localId)); const flowIds = new Set(proposal.flows.map((item) => item.localId));
  for (const domain of proposal.domains) for (const block of domain.blockLocalIds) if (!blockIds.has(block)) diagnostics.push(diag("DOMAIN_BLOCK_NOT_FOUND", "Domain references an unknown block.", [domain.localId, block]));
  for (const boundary of proposal.boundaries) { for (const domain of boundary.domainLocalIds) if (!domainIds.has(domain)) diagnostics.push(diag("BOUNDARY_DOMAIN_NOT_FOUND", "Boundary references an unknown domain.", [boundary.localId, domain])); for (const flow of boundary.crossingFlowLocalIds) if (!flowIds.has(flow)) diagnostics.push(diag("BOUNDARY_FLOW_NOT_FOUND", "Boundary references an unknown crossing flow.", [boundary.localId, flow])); }
  for (const responsibility of proposal.responsibilities) for (const block of responsibility.blockLocalIds) if (!blockIds.has(block)) diagnostics.push(diag("RESPONSIBILITY_BLOCK_NOT_FOUND", "Responsibility references an unknown block.", [responsibility.localId, block]));
  for (const resource of proposal.resources) if (!blockIds.has(resource.blockLocalId)) diagnostics.push(diag("RESOURCE_BLOCK_NOT_FOUND", "Resource envelope references an unknown block.", [resource.localId, resource.blockLocalId]));
  for (const resource of proposal.resources) if (resource.allocation && validateRequirementPredicate(resource.allocation).length) diagnostics.push(diag("RESOURCE_ALLOCATION_PREDICATE_INVALID", validateRequirementPredicate(resource.allocation).join(" "), [resource.localId], resource.requirementRefs));
  const knownRequirements = new Set(problem.requirements.map((item) => item.requirementId));
  for (const ref of allRequirementRefs(proposal)) if (!knownRequirements.has(ref)) diagnostics.push(diag("REQUIREMENT_REFERENCE_NOT_FOUND", "Architecture object references a requirement outside the exact problem revision.", [], [ref]));
  const knownObligations = new Set(problem.verificationObligations.map((item) => item.obligationId));
  for (const responsibility of proposal.responsibilities) for (const ref of responsibility.verificationObligationRefs) if (!knownObligations.has(ref)) diagnostics.push(diag("VERIFICATION_OBLIGATION_NOT_FOUND", "Responsibility references an unknown verification obligation.", [responsibility.localId]));
  for (const cycle of dependencyCycles(proposal)) diagnostics.push(diag("UNDECLARED_DEPENDENCY_CYCLE", "Normal dependency graph contains a cycle; explicit bootstrap or fault-response semantics are required.", cycle));
  return [...new Map(diagnostics.map((item) => [item.diagnosticId, item])).values()].sort((left, right) => left.code.localeCompare(right.code) || left.diagnosticId.localeCompare(right.diagnosticId));
}

export function validateSystemArchitectureCandidate(candidate: SystemArchitectureCandidate, problem?: ArchitectureProblem): string[] {
  const errors: string[] = [];
  if (candidate.schemaVersion !== ARCHITECTURE_SCHEMA_VERSION) errors.push("ARCHITECTURE_SCHEMA_UNSUPPORTED");
  if (!candidate.candidateId || !candidate.projectId || !candidate.branchId || !candidate.lineageId || candidate.revision < 1) errors.push("ARCHITECTURE_IDENTITY_INVALID");
  if (problem && (candidate.projectId !== problem.projectId || candidate.branchId !== problem.branchId || candidate.provenance.problemDigest !== problem.deterministicDigest)) errors.push("ARCHITECTURE_PROBLEM_SCOPE_MISMATCH");
  if (candidate.deterministicDigest !== architectureDigest({ ...candidate, deterministicDigest: undefined })) errors.push("ARCHITECTURE_DIGEST_MISMATCH");
  if (candidate.status === "selected") errors.push("CANDIDATE_SELECTION_MUST_BE_PROJECT_DECISION");
  return errors.sort();
}
