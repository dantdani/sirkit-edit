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

