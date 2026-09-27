/**
 * [B21 A] The canonical provider-neutral orchestration contracts: `sirkit.specialist-request.v1` and
 * `sirkit.specialist-result.v1` as plain frozen data with closed key sets, and the two validators that turn an untrusted
 * document into an independent, deep-frozen, digest-bound snapshot or exactly one closed refusal.
 *
 * What a specialist exchanges is DATA with zero authority: a result is a proposal-and-evidence object with no standing of
 * its own. Nothing here mints, applies, binds, certifies or publishes anything, and nothing here names the modules that do
 * (the import gate walks this module's closure; the contracts suite reads it as text). The order of judgement is fixed:
 * capture first (no accessor, hook, proxy, symbol key or foreign prototype survives), then the closed key sets and the
 * key-name denylist, then every bounded scalar and closed vocabulary, and only then the digests. No provider SDK type
 * appears anywhere; a document carrying provider state, hidden reasoning or a credential-shaped NAME is refused by name
 * before its content is read, and a credential-shaped VALUE is refused in every text, every id and every string of a wrapped
 * artifact's interior (a result is persisted, OD-111). A wrapped artifact is the sealer's structure: its names and strings
 * are scanned at every level, its shape is bound by its digest and verified by its family in B21-D.
 */
import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS, NEVER_EXPOSED_TOOL_PATTERNS } from "../../engineering/agent-exposure";
import type { Tier1ProposalHeadMark } from "../../engineering/schematic-proposals";
import { engineeringDigest } from "../../engineering/stable";
import type { AgentRunBudget, PcbProposalBasis } from "../contracts";
import { capturePlainJson, type DeepReadonly, type PlainJsonValue } from "../plain-capture";
import { containsTokenAnchoredSecretShapedText, foldFieldName, isCredentialShapedName, redactPathSegment } from "../redaction";

// ─── Schema ids and closed vocabularies (spelled as data, never imported from a provider) ────────────────────────────────

export const SPECIALIST_REQUEST_SCHEMA = "sirkit.specialist-request.v1" as const;
export const SPECIALIST_RESULT_SCHEMA = "sirkit.specialist-result.v1" as const;

/** The nine roles (runbook B21-C) in the runbook's order; a role is added only when its inputs, outputs and tools are distinct and testable. */
export const SPECIALIST_ROLES = Object.freeze([
  "coordinator", "requirements-analyst", "circuit-topology", "component-sourcing-evidence", "schematic",
  "pcb-placement-routing", "verification-critic", "manufacturing-readiness-reviewer", "cost-latency-router",
] as const);
export type SpecialistRole = (typeof SPECIALIST_ROLES)[number];

/** The four sealed artifact kinds a proposed action may wrap, by their LIVE schema ids (pinned to the sealers by the suite).
 *  The payload rides verbatim; its family's own integrity and currency verifiers run in B21-D, never here. */
export const PROPOSED_ACTION_KINDS = Object.freeze([
  "sirkit.schematic-tier1-proposal.v3", "sirkit.schematic-replacement-proposal.v2", "sirkit.pcb-bounded-edit-proposal.v2", "sirkit.layout-candidate.v1",
] as const);
export type ProposedActionKind = (typeof PROPOSED_ACTION_KINDS)[number];

export const EVIDENCE_KINDS = Object.freeze(["readiness-report", "qualification-authority", "atomic-evidence", "resource-envelope", "trace-event"] as const);
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];
/** The atomic catalog's SourceClass members (pinned to that union by the suite) plus `deterministic_verifier`, the one class
 *  only an in-process verifier (DRC, connectivity, readiness, parity) produces. What each class may PROVE is B21-D's rule
 *  (the B19 classes stand: sourcing never proves engineering, unreviewed llm / ocr / external observation is quarantined). */
export const EVIDENCE_SOURCE_CLASSES = Object.freeze([
  "manufacturer_datasheet", "manufacturer_cad", "manufacturer_application_note", "official_kicad_library", "distributor_catalog",
  "third_party_cad", "organization_authored", "cad_geometry_inference", "ocr_extraction", "llm_suggestion", "human_reviewed",
  "external_mcp_tool", "deterministic_verifier",
] as const);
export type EvidenceSourceClass = (typeof EVIDENCE_SOURCE_CLASSES)[number];
export const EVIDENCE_EXTRACTION_METHODS = Object.freeze(["manual", "structured_api", "kicad_parser", "deterministic_inference", "ocr", "llm"] as const);
export type EvidenceExtractionMethod = (typeof EVIDENCE_EXTRACTION_METHODS)[number];
export const CONFIDENCE_LEVELS = Object.freeze(["low", "medium", "high"] as const);
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];
export const RISK_SEVERITIES = Object.freeze(["low", "medium", "high"] as const);
export type RiskSeverity = (typeof RISK_SEVERITIES)[number];
/** The result's content keys, sorted: what a request may require of a result. */
export const REQUIRED_OUTPUT_NAMES = Object.freeze(["assumptions", "confidence", "evidence", "proposedActions", "requiredTools", "risks", "summary", "unresolvedQuestions", "validationRequests"] as const);
export type RequiredOutputName = (typeof REQUIRED_OUTPUT_NAMES)[number];
/** The loop's six budget fields plus the two token counts - reported, never priced (OD-107's DAG wall time is a scheduler cap, not a field here). */
export const AGENT_BUDGET_KEYS = Object.freeze(["maxModelSteps", "maxToolCalls", "perToolTimeoutMs", "runDeadlineMs", "maxIdenticalCalls", "executionSettlementTimeoutMs", "maxInputTokens", "maxOutputTokens"] as const);
/** [B21 A review] The deterministic verifiers a `ValidationRequest` may bind - B21-D runs them by id with no model - as a closed
 *  subset of the reviewed exposure list: the two validators, the readiness report and the two revision inspections. Never an
 *  execution, never a view-session control, never an external read (nothing deterministic follows from those). Wider is a
 *  reviewed pin move (parity, the canonical validator and the netlist proof have no exposed id today). */
export const VALIDATION_BINDING_TOOL_IDS = Object.freeze([
  "sirkit.manufacturing.readiness-inspect", "sirkit.pcb.revision-inspect", "sirkit.project.canonical-revision-inspect",
  "sirkit.validation.connectivity-verify", "sirkit.validation.drc-run",
] as const);

export const ORCHESTRATION_BOUNDS = Object.freeze({
  maxSummaryChars: 4_000,
  maxTextChars: 1_000,
  maxArrayEntries: 32,
  maxAllowedToolIds: 32,
  maxIdChars: 128,
  /** the capture's serialized bound for one document (the capture's own per-string and node bounds apply below it) */
  maxSerializedChars: 1_000_000,
});

/** The capsule denylist's EXACT keys, spelled here as data (OD-131): a stored orchestration record's own keys and every typed
 *  record are capsule-clean (a wrapped artifact's interior is the sealer's; it carries `state`, and is exempt below its top level). */
export const CAPSULE_DENYLIST_KEYS = Object.freeze(["state", "response", "request", "body", "headers", "client", "sdk", "openai", "anthropic", "token"] as const);
/** Folded stems no key may contain, at any level of any document: no chain of thought is ever stored (runbook :801). */
export const REASONING_SHAPED_STEMS = Object.freeze(["reasoning", "thinking", "continuation", "chainofthought"] as const);
/** [B21 A review] The names the sealers DECLARE that the shared credential classifier would otherwise refuse: the closed
 *  authorization binding of the Tier 1 and replacement families (`authorization`), of the bounded PCB family
 *  (`authorizationBinding`) and the bindings' own `authorizationSchema`. A declared name is a verified principal plus the
 *  membership revision its role was resolved at - never a credential. Inside a WRAPPED ARTIFACT only, a declared name is
 *  exempt from the NAME check (the B11.3 rule for descriptor-declared names); its VALUE is still scanned. The suite pins the
 *  set to the real sealed artifacts, so a newly declared credential-shaped name or a stale exemption fails visibly. */
export const SEALED_ARTIFACT_DECLARED_NAMES = Object.freeze(["authorization", "authorizationBinding", "authorizationSchema"] as const);
const DENYLIST_FOLDED: ReadonlySet<string> = new Set(CAPSULE_DENYLIST_KEYS.map(foldFieldName));
const DECLARED_FOLDED: ReadonlySet<string> = new Set(SEALED_ARTIFACT_DECLARED_NAMES.map(foldFieldName));

/** The closed refusal vocabulary; the validators return exactly one of these and never throw on hostile input. */
export const ORCHESTRATION_REFUSALS = Object.freeze([
  "not_captured", "not_an_object", "schema_mismatch", "unknown_key", "missing_key", "forbidden_key_name",
  "invalid_type", "invalid_integer", "invalid_id", "invalid_digest", "invalid_timestamp", "invalid_text", "text_too_long", "secret_shaped_text", "array_too_long", "list_not_sorted",
  "unknown_role", "invalid_confidence", "invalid_severity", "unknown_evidence_kind", "unknown_source_class", "unknown_extraction_method", "unknown_required_output",
  "allowed_tool_ids_invalid", "tool_request_not_permitted", "validation_binding_not_permitted",
  "action_kind_unknown", "action_schema_mismatch", "artifact_digest_mismatch",
] as const);
export type OrchestrationRefusal = (typeof ORCHESTRATION_REFUSALS)[number];

// ─── The contracts ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** The one revision vocabulary: the loop's own head mark and PCB basis, never a new one. */
export interface RevisionBoundProjectScope {
  tenantId: string;
  projectId: string;
  branchId: string;
  canonicalRevisionDigest: string;
  schematicHeadMark?: Tier1ProposalHeadMark;
  pcbBasis?: PcbProposalBasis;
}
export interface AgentBudget extends AgentRunBudget {
  maxInputTokens: number;
  maxOutputTokens: number;
}
export interface ContextReference { id: string; digest: string }
export interface SpecialistRequest {
  schema: typeof SPECIALIST_REQUEST_SCHEMA;
  taskId: string;
  role: SpecialistRole;
  objective: string;
  scope: RevisionBoundProjectScope;
  contextRefs: readonly ContextReference[];
  /** A4L list semantics: sorted, duplicate-free, at most 32, every id in the reviewed exposure list; a malformed list refuses the whole request. */
  allowedToolIds: readonly string[];
  budget: AgentBudget;
  requiredOutputs: readonly RequiredOutputName[];
  deadlineAt: string;
}
/** A sealed artifact's payload, verbatim: the sealer's structure, bound by the digest; its names and strings are judged at every level. */
export interface OpaqueArtifactPayload<Kind extends ProposedActionKind = ProposedActionKind> { readonly schema: Kind; readonly [key: string]: PlainJsonValue }
export type ProposedAction = { [Kind in ProposedActionKind]: { kind: Kind; payload: OpaqueArtifactPayload<Kind>; artifactDigest: string } }[ProposedActionKind];
export interface EvidenceReference {
  kind: EvidenceKind;
  id: string;
  digest: string;
  sourceClass: EvidenceSourceClass;
  extractionMethod?: EvidenceExtractionMethod;
  reviewed: boolean;
}
export interface ToolRequest { toolId: string; version: string; reason: string }
export interface Assumption { id: string; statement: string; evidenceIds: readonly string[] }
export interface StructuredRisk { id: string; severity: RiskSeverity; statement: string; mitigation: string | null }
export interface StructuredQuestion { id: string; question: string; blocking: boolean }
/** `bindingToolId` is one of `VALIDATION_BINDING_TOOL_IDS`: a deterministic verification, never a request for anything else. */
export interface ValidationRequest { bindingToolId: string; baseRevision: string }
export interface SpecialistResult {
  schema: typeof SPECIALIST_RESULT_SCHEMA;
  role: SpecialistRole;
  summary: string;
  proposedActions: readonly ProposedAction[];
  assumptions: readonly Assumption[];
  evidence: readonly EvidenceReference[];
  requiredTools: readonly ToolRequest[];
  risks: readonly StructuredRisk[];
  unresolvedQuestions: readonly StructuredQuestion[];
  validationRequests: readonly ValidationRequest[];
  confidence: ConfidenceLevel;
}

declare const VALIDATED_BRAND: unique symbol;
/** The validated, independent, deep-frozen snapshot the validators produce; the only shape the durable record accepts. */
export type ValidatedSpecialistRequest = DeepReadonly<SpecialistRequest> & { readonly [VALIDATED_BRAND]: typeof SPECIALIST_REQUEST_SCHEMA };
export type ValidatedSpecialistResult = DeepReadonly<SpecialistResult> & { readonly [VALIDATED_BRAND]: typeof SPECIALIST_RESULT_SCHEMA };
export type OrchestrationSchema = typeof SPECIALIST_REQUEST_SCHEMA | typeof SPECIALIST_RESULT_SCHEMA;
export type OrchestrationValidation<T> =
  | { ok: true; value: T; digest: string }
  | { ok: false; refusal: OrchestrationRefusal; path: string };

// ─── Key sets (closed; checked before any digest) ────────────────────────────────────────────────────────────────────────

const REQUEST_KEYS = ["schema", "taskId", "role", "objective", "scope", "contextRefs", "allowedToolIds", "budget", "requiredOutputs", "deadlineAt"] as const;
const RESULT_KEYS = ["schema", "role", "summary", "proposedActions", "assumptions", "evidence", "requiredTools", "risks", "unresolvedQuestions", "validationRequests", "confidence"] as const;
const SCOPE_KEYS = ["tenantId", "projectId", "branchId", "canonicalRevisionDigest"] as const;
const SCOPE_OPTIONAL_KEYS = ["schematicHeadMark", "pcbBasis"] as const;
const HEAD_MARK_KEYS = ["lineageId", "headSequence", "canonicalStateDigest"] as const;
const PCB_BASIS_KEYS = ["historyHeadSequence", "historyHeadLabel", "lineageId", "activeDrcPresetId"] as const;
const CONTEXT_REF_KEYS = ["id", "digest"] as const;
const ACTION_KEYS = ["kind", "payload", "artifactDigest"] as const;
const ASSUMPTION_KEYS = ["id", "statement", "evidenceIds"] as const;
const EVIDENCE_KEYS = ["kind", "id", "digest", "sourceClass", "reviewed"] as const;
const EVIDENCE_OPTIONAL_KEYS = ["extractionMethod"] as const;
const TOOL_REQUEST_KEYS = ["toolId", "version", "reason"] as const;
const RISK_KEYS = ["id", "severity", "statement", "mitigation"] as const;
const QUESTION_KEYS = ["id", "question", "blocking"] as const;
const VALIDATION_REQUEST_KEYS = ["bindingToolId", "baseRevision"] as const;

// ─── Scalars ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DIGEST_PATTERN = /^eng1-[0-9a-f]{16}$/;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
/** every control, format and line-separator character except LF and TAB (bidirectional overrides and zero-width characters are
 *  hostile in a summary; a soft hyphen or a joiner refuses too - the availability cost is recorded on the page and in OD-131) */
const FORBIDDEN_TEXT_CHARACTER = /(?![\t\n])[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const EXPOSED: ReadonlySet<string> = new Set(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS);

/** The id grammar AND no credential-shaped value: the grammar admits a provider key's characters, so every id is scanned too. */
export function isOrchestrationId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value) && !containsTokenAnchoredSecretShapedText(value);
}
export function isOrchestrationDigest(value: unknown): value is string {
  return typeof value === "string" && DIGEST_PATTERN.test(value);
}
/** UTC, millisecond precision, round-trip exact (`2026-13-40T...` never parses back to itself). */
export function isOrchestrationTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !TIMESTAMP_PATTERN.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}
/** The structural tool gate (D21-1): only an id of the reviewed exposure list that matches no never-exposed pattern is ever permitted. */
export function isPermittedOrchestrationToolId(value: unknown): value is string {
  return typeof value === "string" && EXPOSED.has(value) && !NEVER_EXPOSED_TOOL_PATTERNS.some((pattern) => pattern.test(value));
}
/** A key name no orchestration document may carry: the capsule's exact keys, a reasoning-shaped stem, or the shared credential classifier's verdict - case- and separator-folded. */
export function isForbiddenOrchestrationKeyName(name: string): boolean {
  const folded = foldFieldName(name);
  if (DENYLIST_FOLDED.has(folded)) return true;
  if (REASONING_SHAPED_STEMS.some((stem) => folded.includes(stem))) return true;
  return isCredentialShapedName(name);
}
/** A key name inside a WRAPPED ARTIFACT: a reasoning-shaped stem anywhere; the capsule's exact keys at every level, except `state`
 *  below the artifact's top level (a bounded-edit impact certificate carries `readiness.state`; no sealer declares any other capsule
 *  key anywhere - case 13 measures it); the credential classifier at every level, except for a declared name where the sealers put
 *  it - at the artifact's top level, or directly inside a declared parent (`authorization.authorizationSchema`,
 *  `authorizationBinding.authorizationSchema`). [B21 A lead] narrowed from "declared anywhere, capsule keys at the top only". */
export function isForbiddenSealedArtifactKeyName(name: string, depth: number, underDeclaredParent: boolean): boolean {
  const folded = foldFieldName(name);
  if (DENYLIST_FOLDED.has(folded) && !(folded === "state" && depth > 0)) return true;
  if (REASONING_SHAPED_STEMS.some((stem) => folded.includes(stem))) return true;
  const declaredHere = DECLARED_FOLDED.has(folded) && (depth === 0 || underDeclaredParent);
  return !declaredHere && isCredentialShapedName(name);
}

// ─── The refusal channel ─────────────────────────────────────────────────────────────────────────────────────────────────

class Refusal extends Error {
  constructor(readonly refusal: OrchestrationRefusal, readonly path: string) {
    super(refusal);
  }
}
function refuse(refusal: OrchestrationRefusal, path: string): never {
  throw new Refusal(refusal, path);
}
const at = (path: string, key: string): string => `${path}.${redactPathSegment(key)}`;
const item = (path: string, index: number): string => `${path}[${index}]`;
/** the capture's first issue is `<label>: <reason>`; the label is the path */
function issuePath(issues: readonly string[]): string {
  const first = issues[0] ?? "$";
  const cut = first.indexOf(": ");
  return cut > 0 ? first.slice(0, cut) : "$";
}
const includes = (vocabulary: readonly string[], value: string): boolean => vocabulary.includes(value);

type Plain = PlainJsonValue | undefined;
type PlainRecord = Record<string, PlainJsonValue>;
function isRecord(value: Plain): value is PlainRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function recordAt(value: Plain, path: string): PlainRecord {
  if (!isRecord(value)) refuse("invalid_type", path);
  return value;
}
/** closed key set: every name judged (forbidden first, then unknown), then every required key present */
function checkKeys(record: PlainRecord, path: string, required: readonly string[], optional: readonly string[] = []): void {
  const present = Object.keys(record);
  for (const key of present) {
    if (isForbiddenOrchestrationKeyName(key)) refuse("forbidden_key_name", at(path, key));
    if (!required.includes(key) && !optional.includes(key)) refuse("unknown_key", at(path, key));
  }
  for (const key of required) if (!present.includes(key)) refuse("missing_key", at(path, key));
}
function list(value: Plain, path: string, max: number = ORCHESTRATION_BOUNDS.maxArrayEntries): PlainJsonValue[] {
  if (!Array.isArray(value)) refuse("invalid_type", path);
  if (value.length > max) refuse("array_too_long", path);
  return value;
}
function each(value: Plain, path: string, one: (entry: PlainJsonValue, entryPath: string) => void): void {
  list(value, path).forEach((entry, index) => one(entry, item(path, index)));
}
/** the value rules every string obeys, wherever it sits: no control or format character, no credential-shaped value */
function string(value: string, path: string): void {
  if (FORBIDDEN_TEXT_CHARACTER.test(value)) refuse("invalid_text", path);
  if (containsTokenAnchoredSecretShapedText(value)) refuse("secret_shaped_text", path);
}
function text(value: Plain, path: string, max: number): string {
  if (typeof value !== "string") refuse("invalid_type", path);
  if (value.length > max) refuse("text_too_long", path);
  string(value, path);
  return value;
}
/** The text rule as a verdict, for callers that keep their own refusal vocabulary (the durable record). */
export function judgeOrchestrationText(value: unknown, max: number): OrchestrationRefusal | null {
  try {
    text(value as Plain, "$", max);
    return null;
  } catch (error) {
    if (error instanceof Refusal) return error.refusal;
    throw error;
  }
}
function word(value: Plain, path: string): string {
  if (typeof value !== "string") refuse("invalid_type", path);
  return value;
}
/** the id grammar, then the value scan: a key-shaped id is a credential wherever it sits, never merely a malformed id */
function id(value: Plain, path: string): string {
  const name = word(value, path);
  if (!ID_PATTERN.test(name)) refuse("invalid_id", path);
  if (containsTokenAnchoredSecretShapedText(name)) refuse("secret_shaped_text", path);
  return name;
}
function digest(value: Plain, path: string): string {
  if (!isOrchestrationDigest(word(value, path))) refuse("invalid_digest", path);
  return value as string;
}
function integer(value: Plain, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) refuse("invalid_integer", path);
  return value;
}
function flag(value: Plain, path: string): boolean {
  if (typeof value !== "boolean") refuse("invalid_type", path);
  return value;
}
function role(value: Plain, path: string): SpecialistRole {
  const name = word(value, path);
  if (!includes(SPECIALIST_ROLES, name)) refuse("unknown_role", path);
  return name as SpecialistRole;
}
function toolId(value: Plain, path: string): string {
  const name = word(value, path);
  if (!isPermittedOrchestrationToolId(name)) refuse("tool_request_not_permitted", path);
  return name;
}
function sorted(entries: readonly string[], path: string): void {
  for (let index = 1; index < entries.length; index += 1) if (!(entries[index - 1]! < entries[index]!)) refuse("list_not_sorted", path);
}

// ─── The request ─────────────────────────────────────────────────────────────────────────────────────────────────────────

function scope(value: Plain, path: string): void {
  const record = recordAt(value, path);
  checkKeys(record, path, SCOPE_KEYS, SCOPE_OPTIONAL_KEYS);
  id(record.tenantId, at(path, "tenantId"));
  id(record.projectId, at(path, "projectId"));
  id(record.branchId, at(path, "branchId"));
  digest(record.canonicalRevisionDigest, at(path, "canonicalRevisionDigest"));
  if (record.schematicHeadMark !== undefined) {
    const markPath = at(path, "schematicHeadMark");
    const mark = recordAt(record.schematicHeadMark, markPath);
    checkKeys(mark, markPath, HEAD_MARK_KEYS);
    id(mark.lineageId, at(markPath, "lineageId"));
    integer(mark.headSequence, at(markPath, "headSequence"));
    digest(mark.canonicalStateDigest, at(markPath, "canonicalStateDigest"));
  }
  if (record.pcbBasis !== undefined) {
    const basisPath = at(path, "pcbBasis");
    const basis = recordAt(record.pcbBasis, basisPath);
    checkKeys(basis, basisPath, PCB_BASIS_KEYS);
    integer(basis.historyHeadSequence, at(basisPath, "historyHeadSequence"));
    if (basis.historyHeadLabel !== null) text(basis.historyHeadLabel, at(basisPath, "historyHeadLabel"), ORCHESTRATION_BOUNDS.maxTextChars);
    id(basis.lineageId, at(basisPath, "lineageId"));
    id(basis.activeDrcPresetId, at(basisPath, "activeDrcPresetId"));
  }
}
function contextReference(value: PlainJsonValue, path: string): void {
  const record = recordAt(value, path);
  checkKeys(record, path, CONTEXT_REF_KEYS);
  id(record.id, at(path, "id"));
  digest(record.digest, at(path, "digest"));
}
/** A4L semantics: a list that is not an array, over the bound, unsorted, duplicated, or naming a non-string, an unexposed or a never-exposed id admits NOTHING - the whole request is refused. */
function allowedToolIds(value: Plain, path: string): void {
  const sound = Array.isArray(value)
    && value.length <= ORCHESTRATION_BOUNDS.maxAllowedToolIds
    && value.every((entry, index) => isPermittedOrchestrationToolId(entry) && (index === 0 || (value[index - 1] as string) < entry));
  if (!sound) refuse("allowed_tool_ids_invalid", path);
}
function budget(value: Plain, path: string): void {
  const record = recordAt(value, path);
  checkKeys(record, path, AGENT_BUDGET_KEYS);
  for (const key of AGENT_BUDGET_KEYS) integer(record[key], at(path, key));
}
function requiredOutputs(value: Plain, path: string): void {
  const names = list(value, path).map((entry, index) => {
    const entryPath = item(path, index);
    const name = word(entry, entryPath);
    if (isForbiddenOrchestrationKeyName(name)) refuse("forbidden_key_name", entryPath);
    if (!includes(REQUIRED_OUTPUT_NAMES, name)) refuse("unknown_required_output", entryPath);
    return name;
  });
  sorted(names, path);
}
function timestamp(value: Plain, path: string): void {
  if (!isOrchestrationTimestamp(word(value, path))) refuse("invalid_timestamp", path);
}

// ─── The result ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A wrapped artifact, walked in full: every key name judged by the artifact rule (its depth and whether its parent is a declared
 *  name distinguished) and every string by the value rules, in key order and before any digest; the shape is the sealer's and
 *  stays bound by the digest. */
function sealedArtifact(value: PlainJsonValue, path: string, depth: number, underDeclaredParent: boolean): void {
  if (typeof value === "string") {
    string(value, path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => sealedArtifact(entry, item(path, index), depth + 1, false));
    return;
  }
  if (!isRecord(value)) return;
  for (const key of Object.keys(value)) {
    if (isForbiddenSealedArtifactKeyName(key, depth, underDeclaredParent)) refuse("forbidden_key_name", at(path, key));
    sealedArtifact(value[key] as PlainJsonValue, at(path, key), depth + 1, DECLARED_FOLDED.has(foldFieldName(key)));
  }
}
function proposedAction(value: PlainJsonValue, path: string): void {
  const record = recordAt(value, path);
  checkKeys(record, path, ACTION_KEYS);
  const kindPath = at(path, "kind");
  const kind = word(record.kind, kindPath);
  if (!includes(PROPOSED_ACTION_KINDS, kind)) refuse("action_kind_unknown", kindPath);
  const payloadPath = at(path, "payload");
  const payload = recordAt(record.payload, payloadPath);
  // the payload's names and strings are judged at every level, the sealers' declared names exempt from the name check only
  sealedArtifact(payload, payloadPath, 0, false);
  if (payload.schema !== kind) refuse("action_schema_mismatch", at(payloadPath, "schema"));
  const digestPath = at(path, "artifactDigest");
  const artifactDigest = digest(record.artifactDigest, digestPath);
  // recomputed over the verbatim payload: A binds the structure to its digest; B21-D runs the family's own verifiers
  if (engineeringDigest(payload) !== artifactDigest) refuse("artifact_digest_mismatch", digestPath);
}
function assumption(value: PlainJsonValue, path: string): void {
  const record = recordAt(value, path);
  checkKeys(record, path, ASSUMPTION_KEYS);
  id(record.id, at(path, "id"));
  text(record.statement, at(path, "statement"), ORCHESTRATION_BOUNDS.maxTextChars);
  each(record.evidenceIds, at(path, "evidenceIds"), id);
}
function evidenceReference(value: PlainJsonValue, path: string): void {
  const record = recordAt(value, path);
  checkKeys(record, path, EVIDENCE_KEYS, EVIDENCE_OPTIONAL_KEYS);
  const kindPath = at(path, "kind");
  if (!includes(EVIDENCE_KINDS, word(record.kind, kindPath))) refuse("unknown_evidence_kind", kindPath);
  id(record.id, at(path, "id"));
  digest(record.digest, at(path, "digest"));
  const sourcePath = at(path, "sourceClass");
  if (!includes(EVIDENCE_SOURCE_CLASSES, word(record.sourceClass, sourcePath))) refuse("unknown_source_class", sourcePath);
  if (record.extractionMethod !== undefined) {
    const methodPath = at(path, "extractionMethod");
    if (!includes(EVIDENCE_EXTRACTION_METHODS, word(record.extractionMethod, methodPath))) refuse("unknown_extraction_method", methodPath);
  }
  flag(record.reviewed, at(path, "reviewed"));
}
function toolRequest(value: PlainJsonValue, path: string): void {
  const record = recordAt(value, path);
  checkKeys(record, path, TOOL_REQUEST_KEYS);
  toolId(record.toolId, at(path, "toolId"));
  id(record.version, at(path, "version"));
  text(record.reason, at(path, "reason"), ORCHESTRATION_BOUNDS.maxTextChars);
}
function risk(value: PlainJsonValue, path: string): void {
  const record = recordAt(value, path);
  checkKeys(record, path, RISK_KEYS);
  id(record.id, at(path, "id"));
  const severityPath = at(path, "severity");
  if (!includes(RISK_SEVERITIES, word(record.severity, severityPath))) refuse("invalid_severity", severityPath);
  text(record.statement, at(path, "statement"), ORCHESTRATION_BOUNDS.maxTextChars);
  if (record.mitigation !== null) text(record.mitigation, at(path, "mitigation"), ORCHESTRATION_BOUNDS.maxTextChars);
}
function question(value: PlainJsonValue, path: string): void {
  const record = recordAt(value, path);
  checkKeys(record, path, QUESTION_KEYS);
  id(record.id, at(path, "id"));
  text(record.question, at(path, "question"), ORCHESTRATION_BOUNDS.maxTextChars);
  flag(record.blocking, at(path, "blocking"));
}
function validationRequest(value: PlainJsonValue, path: string): void {
  const record = recordAt(value, path);
  checkKeys(record, path, VALIDATION_REQUEST_KEYS);
  // the structural gate first (a never-exposed id is never a tool request), then the closed verifier set
  const bindingPath = at(path, "bindingToolId");
  if (!includes(VALIDATION_BINDING_TOOL_IDS, toolId(record.bindingToolId, bindingPath))) refuse("validation_binding_not_permitted", bindingPath);
  digest(record.baseRevision, at(path, "baseRevision"));
}
function confidence(value: Plain, path: string): void {
  if (!includes(CONFIDENCE_LEVELS, word(value, path))) refuse("invalid_confidence", path);
}

// ─── Validation: capture, walk, digest, register ─────────────────────────────────────────────────────────────────────────

/** validated snapshot -> its schema and whole-body digest; identity-keyed, so a clone or the caller's object is never vouched for */
const VALIDATED = new WeakMap<object, { schema: OrchestrationSchema; digest: string }>();

function validate<T>(schema: OrchestrationSchema, input: unknown, walk: (root: PlainRecord) => void): OrchestrationValidation<T> {
  const captured = capturePlainJson(input, "$", ORCHESTRATION_BOUNDS.maxSerializedChars);
  try {
    if (!captured.ok) refuse("not_captured", issuePath(captured.issues));
    const root = captured.value;
    if (!isRecord(root)) refuse("not_an_object", "$");
    if (!Object.keys(root).includes("schema")) refuse("missing_key", "$.schema");
    if (root.schema !== schema) refuse("schema_mismatch", "$.schema");
    walk(root);
    const wholeBody = engineeringDigest({ schema, body: root });
    VALIDATED.set(root, { schema, digest: wholeBody });
    return { ok: true, value: root as unknown as T, digest: wholeBody };
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, refusal: error.refusal, path: error.path };
    throw error;
  }
}

export function validateSpecialistRequest(input: unknown): OrchestrationValidation<ValidatedSpecialistRequest> {
  return validate(SPECIALIST_REQUEST_SCHEMA, input, (root) => {
    checkKeys(root, "$", REQUEST_KEYS);
    id(root.taskId, "$.taskId");
    role(root.role, "$.role");
    text(root.objective, "$.objective", ORCHESTRATION_BOUNDS.maxTextChars);
    scope(root.scope, "$.scope");
    each(root.contextRefs, "$.contextRefs", contextReference);
    allowedToolIds(root.allowedToolIds, "$.allowedToolIds");
    budget(root.budget, "$.budget");
    requiredOutputs(root.requiredOutputs, "$.requiredOutputs");
    timestamp(root.deadlineAt, "$.deadlineAt");
  });
}

export function validateSpecialistResult(input: unknown): OrchestrationValidation<ValidatedSpecialistResult> {
  return validate(SPECIALIST_RESULT_SCHEMA, input, (root) => {
    checkKeys(root, "$", RESULT_KEYS);
    role(root.role, "$.role");
    text(root.summary, "$.summary", ORCHESTRATION_BOUNDS.maxSummaryChars);
    each(root.proposedActions, "$.proposedActions", proposedAction);
    each(root.assumptions, "$.assumptions", assumption);
    each(root.evidence, "$.evidence", evidenceReference);
    each(root.requiredTools, "$.requiredTools", toolRequest);
    each(root.risks, "$.risks", risk);
    each(root.unresolvedQuestions, "$.unresolvedQuestions", question);
    each(root.validationRequests, "$.validationRequests", validationRequest);
    confidence(root.confidence, "$.confidence");
  });
}

/** The schema and whole-body digest of a snapshot one of the validators produced, or null for any other value (a clone included). */
export function validatedDigestOf(value: unknown): { schema: OrchestrationSchema; digest: string } | null {
  if (typeof value !== "object" || value === null) return null;
  const known = VALIDATED.get(value);
  return known ? { schema: known.schema, digest: known.digest } : null;
}

/** [B21 E2 lead] Every key name the specialist documents DECLARE (the request, the result and each nested record): a refusal path made
 *  only of these names and array indices is server text; a path through any other key is model text (`run-events.ts` withholds it). */
export const SPECIALIST_DECLARED_KEYS: readonly string[] = Object.freeze([...new Set<string>([...REQUEST_KEYS, ...RESULT_KEYS, ...SCOPE_KEYS, ...SCOPE_OPTIONAL_KEYS, ...HEAD_MARK_KEYS, ...PCB_BASIS_KEYS, ...CONTEXT_REF_KEYS, ...AGENT_BUDGET_KEYS, ...ACTION_KEYS, ...ASSUMPTION_KEYS, ...EVIDENCE_KEYS, ...EVIDENCE_OPTIONAL_KEYS, ...TOOL_REQUEST_KEYS, ...RISK_KEYS, ...QUESTION_KEYS, ...VALIDATION_REQUEST_KEYS])]);
