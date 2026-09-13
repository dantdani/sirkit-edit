import type {
  AccessPolicy,
  PrivacyClassification,
  RequirementAuthorityClass,
  RequirementDiagnostic,
  RequirementSourceArtifact,
  RequirementSourceKind,
  RequirementSourceRef,
  SourceLocation,
} from "./types";
import { REQUIREMENTS_SOURCE_SCHEMA_VERSION } from "./types";
import { requirementsDigest, requirementsId } from "./stable";

export const MAX_REQUIREMENTS_SOURCE_BYTES = 1_500_000;

/**
 * [B19-D I5e row 28] The declared unions, checked at runtime. The ingestion route's body is typed only by TypeScript: a source
 * could declare `application/pdf` (accepted as text), or any source kind, authority class, access policy, privacy class or
 * benchmark use, and those values were pinned into the immutable artifact unchecked.
 */
export const REQUIREMENT_SOURCE_MEDIA_TYPES = ["text/plain", "text/markdown", "application/json"] as const satisfies readonly RequirementSourceArtifact["mediaType"][];
export const REQUIREMENT_SOURCE_KINDS = ["direct_user_statement", "structured_project_brief", "uploaded_specification", "existing_project_metadata", "organization_policy_default", "manufacturing_profile", "customer_requirement_document", "benchmark_task_definition", "imported_legacy_constraint", "observed_design_context", "external_regulation_reference", "conversation_message"] as const satisfies readonly RequirementSourceKind[];
export const REQUIREMENT_AUTHORITY_CLASSES = ["project_owner_confirmed", "authorized_stakeholder_confirmed", "organizational_policy", "contractual_customer_source", "manufacturer_component_source", "imported_legacy_data", "ai_proposal", "inferred_observation", "untrusted_reference"] as const satisfies readonly RequirementAuthorityClass[];
export const REQUIREMENT_ACCESS_POLICIES = ["project_private", "organization_private", "restricted", "public"] as const satisfies readonly AccessPolicy[];
export const REQUIREMENT_PRIVACY_CLASSIFICATIONS = ["public", "internal", "confidential", "restricted"] as const satisfies readonly PrivacyClassification[];
export const REQUIREMENT_BENCHMARK_USES = ["forbidden", "explicit_opt_in", "public_allowed"] as const satisfies readonly RequirementSourceArtifact["benchmarkUse"][];

// compile-time: every member of each union is listed (a new member must be added to the runtime list too)
type Exhaustive<List extends readonly string[], Union extends string> = Exclude<Union, List[number]> extends never ? true : never;
const unionsAreExhaustive: [
  Exhaustive<typeof REQUIREMENT_SOURCE_KINDS, RequirementSourceKind>,
  Exhaustive<typeof REQUIREMENT_AUTHORITY_CLASSES, RequirementAuthorityClass>,
  Exhaustive<typeof REQUIREMENT_ACCESS_POLICIES, AccessPolicy>,
  Exhaustive<typeof REQUIREMENT_PRIVACY_CLASSIFICATIONS, PrivacyClassification>,
  Exhaustive<typeof REQUIREMENT_SOURCE_MEDIA_TYPES, RequirementSourceArtifact["mediaType"]>,
  Exhaustive<typeof REQUIREMENT_BENCHMARK_USES, RequirementSourceArtifact["benchmarkUse"]>,
] = [true, true, true, true, true, true];
void unionsAreExhaustive;

export function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}
const MAX_EXCERPT_CHARS = 360;
const INJECTION_PATTERNS = [
  /ignore\s+(?:all\s+)?(?:previous|prior|system)\s+instructions?/i,
  /(?:system|developer)\s+prompt\s*:/i,
  /reveal\s+(?:the\s+)?(?:system|developer)\s+prompt/i,
  /(?:execute|run)\s+(?:this\s+)?(?:command|code|script)/i,
  /override\s+(?:tool|security|authorization|permission)\s+(?:policy|rules?)/i,
];

export interface IngestRequirementSourceInput {
  tenantId: string;
  projectId: string;
  sourceId: string;
  sourceKind: RequirementSourceKind;
  sourceVersion: string;
  title: string;
  authorOrPublisher?: string;
  authorityClass: RequirementAuthorityClass;
  mediaType: RequirementSourceArtifact["mediaType"];
  content: string;
  capturedAt: string;
  accessPolicy: AccessPolicy;
  privacyClassification: PrivacyClassification;
  benchmarkUse?: RequirementSourceArtifact["benchmarkUse"];
  extractionConfidence?: number;
}

function assertIsoDate(value: string, field: string): void {
  if (!value || !Number.isFinite(Date.parse(value))) throw new Error(`${field} must be an ISO date-time.`);
}

function validateJsonDepth(value: unknown, depth = 0): void {
  if (depth > 64) throw new Error("JSON source nesting exceeds 64 levels.");
  if (Array.isArray(value)) {
    if (value.length > 50_000) throw new Error("JSON source array exceeds the item limit.");
    value.forEach((child) => validateJsonDepth(child, depth + 1));
  } else if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 50_000) throw new Error("JSON source object exceeds the property limit.");
    entries.forEach(([, child]) => validateJsonDepth(child, depth + 1));
  }
}

export function normalizeSourceText(content: string, mediaType: RequirementSourceArtifact["mediaType"]): string {
  if (!isOneOf(REQUIREMENT_SOURCE_MEDIA_TYPES, mediaType)) throw new Error("Requirements source media type is not supported (text/plain, text/markdown or application/json).");
  if (typeof content !== "string") throw new Error("Requirements source content must be text.");
  if (new TextEncoder().encode(content).byteLength > MAX_REQUIREMENTS_SOURCE_BYTES) throw new Error("Requirements source exceeds 1,500,000 bytes.");
  if (content.includes("\0")) throw new Error("Requirements source contains a NUL byte.");
  const normalized = content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").normalize("NFC");
  if (mediaType === "application/json") {
    let parsed: unknown;
    try { parsed = JSON.parse(normalized) as unknown; } catch { throw new Error("Requirements JSON source is malformed."); }
    validateJsonDepth(parsed);
  }
  return normalized;
}

export function ingestRequirementSource(input: IngestRequirementSourceInput): RequirementSourceArtifact {
  if (!input.tenantId.trim() || !input.projectId.trim() || !input.sourceId.trim() || !input.sourceVersion.trim()) throw new Error("Tenant, project, source, and source-version identities are required.");
  if (!input.title.trim()) throw new Error("Source title is required.");
  if (!isOneOf(REQUIREMENT_SOURCE_MEDIA_TYPES, input.mediaType)) throw new Error("Requirements source media type is not supported (text/plain, text/markdown or application/json).");
  if (!isOneOf(REQUIREMENT_SOURCE_KINDS, input.sourceKind)) throw new Error("Requirements source kind is not a known source kind.");
  if (!isOneOf(REQUIREMENT_AUTHORITY_CLASSES, input.authorityClass)) throw new Error("Requirements source authority class is not a known authority class.");
  if (!isOneOf(REQUIREMENT_ACCESS_POLICIES, input.accessPolicy)) throw new Error("Requirements source access policy is not a known policy.");
  if (!isOneOf(REQUIREMENT_PRIVACY_CLASSIFICATIONS, input.privacyClassification)) throw new Error("Requirements source privacy classification is not a known classification.");
  if (input.benchmarkUse !== undefined && !isOneOf(REQUIREMENT_BENCHMARK_USES, input.benchmarkUse)) throw new Error("Requirements source benchmark use is not a known value.");
  assertIsoDate(input.capturedAt, "capturedAt");
  if (input.extractionConfidence !== undefined && (input.extractionConfidence < 0 || input.extractionConfidence > 1)) throw new Error("extractionConfidence must be between 0 and 1.");
  const normalizedContent = normalizeSourceText(input.content, input.mediaType);
  const identity = {
    tenantId: input.tenantId,
    projectId: input.projectId,
    sourceId: input.sourceId,
    sourceKind: input.sourceKind,
    sourceVersion: input.sourceVersion,
    title: input.title.trim(),
    authorOrPublisher: input.authorOrPublisher?.trim(),
    authorityClass: input.authorityClass,
    mediaType: input.mediaType,
    normalizedContent,
  };
  return {
    schemaVersion: REQUIREMENTS_SOURCE_SCHEMA_VERSION,
    ...identity,
    immutableArtifactDigest: requirementsDigest({ schema: REQUIREMENTS_SOURCE_SCHEMA_VERSION, ...identity }),
    capturedAt: input.capturedAt,
    accessPolicy: input.accessPolicy,
    privacyClassification: input.privacyClassification,
    benchmarkUse: input.benchmarkUse ?? (input.privacyClassification === "public" ? "public_allowed" : "forbidden"),
    trustBoundary: "untrusted_evidence",
    ...(input.extractionConfidence === undefined ? {} : { extractionConfidence: input.extractionConfidence }),
  };
}

export function registerSourceRevision(existing: readonly RequirementSourceArtifact[], artifact: RequirementSourceArtifact): RequirementSourceArtifact[] {
  const collision = existing.find((item) => item.sourceId === artifact.sourceId && item.sourceVersion === artifact.sourceVersion);
  if (collision && collision.immutableArtifactDigest !== artifact.immutableArtifactDigest) throw new Error(`IMMUTABLE_SOURCE_REVISION_COLLISION:${artifact.sourceId}@${artifact.sourceVersion}`);
  if (collision) return [...existing];
  return [...existing, structuredClone(artifact)].sort((left, right) => left.sourceId.localeCompare(right.sourceId) || left.sourceVersion.localeCompare(right.sourceVersion));
}

function spanText(artifact: RequirementSourceArtifact, location: SourceLocation): string | undefined {
  let text: string | undefined;
  if (location.spanStartEnd) {
    const { start, end } = location.spanStartEnd;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > artifact.normalizedContent.length) throw new Error("Source character span is outside the pinned artifact.");
    text = artifact.normalizedContent.slice(start, end);
  } else if (location.lineRange) {
    const lines = artifact.normalizedContent.split("\n");
    const { start, end } = location.lineRange;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > lines.length) throw new Error("Source line range is outside the pinned artifact.");
    text = lines.slice(start - 1, end).join("\n");
  }
  if (!text) return undefined;
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length <= MAX_EXCERPT_CHARS ? collapsed : `${collapsed.slice(0, MAX_EXCERPT_CHARS - 1)}…`;
}

export function sourceRefForLocation(artifact: RequirementSourceArtifact, location: SourceLocation): RequirementSourceRef {
  const excerpt = spanText(artifact, location);
  return {
    sourceId: artifact.sourceId,
    sourceKind: artifact.sourceKind,
    sourceVersion: artifact.sourceVersion,
    ...(artifact.authorOrPublisher ? { authorOrPublisher: artifact.authorOrPublisher } : {}),
    authorityClass: artifact.authorityClass,
    title: artifact.title,
    immutableArtifactDigest: artifact.immutableArtifactDigest,
    location: structuredClone(location),
    ...(excerpt ? { quotedOrNormalizedExcerpt: excerpt } : {}),
    capturedAt: artifact.capturedAt,
    freshness: { state: "unknown" },
    accessPolicy: artifact.accessPolicy,
  };
}

/** Imported text is always evidence. These diagnostics never execute or reinterpret it as an instruction. */
export function sourceSecurityDiagnostics(artifact: RequirementSourceArtifact): RequirementDiagnostic[] {
  const matches = INJECTION_PATTERNS.flatMap((pattern) => [...artifact.normalizedContent.matchAll(new RegExp(pattern.source, `${pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`}`))]);
  if (!matches.length) return [];
  const ref = sourceRefForLocation(artifact, { spanStartEnd: { start: matches[0].index ?? 0, end: Math.min(artifact.normalizedContent.length, (matches[0].index ?? 0) + matches[0][0].length) } });
  return [{
    diagnosticId: requirementsId("reqdiag", { code: "UNTRUSTED_INSTRUCTION_TEXT", source: artifact.immutableArtifactDigest, offsets: matches.map((item) => item.index) }),
    code: "UNTRUSTED_INSTRUCTION_TEXT",
    severity: "warning",
    requirementIds: [],
    sourceRefs: [ref],
    message: "The pinned source contains instruction-like text. It remains untrusted evidence and cannot change agent, tool, or authorization policy.",
    missingFields: [],
    nextActions: ["Review the cited source span", "Keep source content isolated from system and tool instructions"],
  }];
}

