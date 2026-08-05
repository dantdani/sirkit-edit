import type {
  ClaimState,
  EngineeringClaim,
  EvidenceRef,
  ExtractionMethod,
  LicenseRecord,
  SourceIdentity,
  SourceRecord,
} from "./types";
import { assertBoundedSExpression, assertPermittedRedirect, assertPermittedUrl, redactSecrets } from "./security";
import { contentId, sha256 } from "./stable";

export type IngestionStage =
  | "quarantine"
  | "parse"
  | "normalize"
  | "validate"
  | "reconcile"
  | "review"
  | "publish"
  | "rejected";

const NEXT: Record<IngestionStage, IngestionStage[]> = {
  quarantine: ["parse", "rejected"],
  parse: ["normalize", "rejected"],
  normalize: ["validate", "rejected"],
  validate: ["reconcile", "rejected"],
  reconcile: ["review", "rejected"],
  review: ["publish", "rejected"],
  publish: [],
  rejected: [],
};

export interface IngestionEvent {
  at: string;
  from: IngestionStage;
  to: IngestionStage;
  actor: string;
  reason: string;
}

export interface QuarantinedObject {
  id: string;
  contentHash: string;
  mediaType: string;
  bytes: number;
  sourceRecordId: string;
  state: IngestionStage;
  createdAt: string;
  events: IngestionEvent[];
  diagnostics: string[];
  licenseDisposition: LicenseRecord["rawRedistribution"];
  derivedDisposition: LicenseRecord["derivedRedistribution"];
  exportDisposition: LicenseRecord["exportDisposition"];
  confidential: boolean;
}

export function quarantineText(input: {
  content: string;
  mediaType: string;
  sourceRecordId: string;
  license: LicenseRecord;
  confidential?: boolean;
  now?: Date;
}): QuarantinedObject {
  if (/kicad|s-expression|sexpr/i.test(input.mediaType)) assertBoundedSExpression(input.content);
  const hash = sha256(input.content);
  return Object.freeze({
    id: contentId("quarantine", hash),
    contentHash: hash,
    mediaType: input.mediaType,
    bytes: Buffer.byteLength(input.content, "utf8"),
    sourceRecordId: input.sourceRecordId,
    state: "quarantine" as const,
    createdAt: (input.now ?? new Date()).toISOString(),
    events: [],
    diagnostics: [],
    licenseDisposition: input.license.rawRedistribution,
    derivedDisposition: input.license.derivedRedistribution,
    exportDisposition: input.license.exportDisposition,
    confidential: input.confidential ?? false,
  });
}

export function advanceIngestion(object: QuarantinedObject, to: IngestionStage, actor: string, reason: string, now = new Date()): QuarantinedObject {
  if (!NEXT[object.state].includes(to)) throw new Error(`Illegal ingestion transition ${object.state} -> ${to}`);
  if (to === "publish" && (actor.startsWith("llm:") || actor.startsWith("ocr:"))) throw new Error("LLM/OCR extractors cannot publish or approve");
  const dispositions = [object.licenseDisposition, object.derivedDisposition, object.exportDisposition];
  if (to === "publish" && dispositions.some((item) => item === "unknown" || item === "prohibited" || item === "private_review_only")) {
    throw new Error(`License disposition ${dispositions.join("/")} blocks publication`);
  }
  return Object.freeze({
    ...object,
    state: to,
    events: [...object.events, { at: now.toISOString(), from: object.state, to, actor, reason }],
  });
}

export function extractedClaim(input: Omit<EngineeringClaim, "state"> & {
  method: ExtractionMethod;
  requestedState?: ClaimState;
}): EngineeringClaim {
  const { method, requestedState, ...claim } = input;
  const untrusted = method === "llm" || method === "ocr";
  if (input.evidenceIds.length === 0) throw new Error("Extracted claims require a source locator/evidence record");
  return {
    ...claim,
    // A model/parser suggestion begins inferred. Review creates a new claim or
    // explicit human-reviewed evidence; it cannot request its own trust state.
    state: untrusted ? "inferred" : requestedState ?? "source_backed",
  };
}

export interface SourceFetchPage {
  records: unknown[];
  nextCursor?: string;
  sourceRevision: string;
}

export interface SourceAdapter {
  readonly id: string;
  readonly source: SourceIdentity;
  readonly allowedHosts: string[];
  fetchPage(request: { cursor?: string; signal: AbortSignal }): Promise<SourceFetchPage>;
}

export class SourceAdapterError extends Error {
  constructor(
    public readonly code: "rate_limited" | "timeout" | "authentication" | "not_found" | "schema_changed" | "malformed" | "network",
    message: string,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "SourceAdapterError";
  }
}

/** Fetch all pages with an enforced deadline; adapters never receive secrets in domain objects. */
export async function collectAdapterPages(
  adapter: SourceAdapter,
  timeoutMs = 15_000,
  retry: { maxRetries?: number; wait?: (milliseconds: number) => Promise<void> } = {},
): Promise<SourceFetchPage[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const pages: SourceFetchPage[] = [];
    let cursor: string | undefined;
    const seen = new Set<string>();
    do {
      let page: SourceFetchPage | undefined;
      const maxRetries = Math.max(0, Math.min(5, retry.maxRetries ?? 2));
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          page = await adapter.fetchPage({ cursor, signal: controller.signal });
          break;
        } catch (error) {
          const typed = error instanceof SourceAdapterError ? error : null;
          const retryable = typed?.code === "rate_limited" || typed?.code === "timeout" || typed?.code === "network";
          if (!retryable || attempt === maxRetries) throw error;
          const waitMs = Math.min(5_000, Math.max(0, typed.retryAfterMs ?? 100 * 2 ** attempt));
          if (retry.wait) await retry.wait(waitMs);
          else await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
        }
      }
      if (!page) throw new Error("Source adapter produced no page");
      pages.push(page);
      cursor = page.nextCursor;
      if (cursor && seen.has(cursor)) throw new Error("Adapter pagination cursor loop");
      if (cursor) seen.add(cursor);
      if (pages.length > 10_000) throw new Error("Adapter pagination limit exceeded");
    } while (cursor);
    return pages;
  } catch (error) {
    throw new Error(redactSecrets(error instanceof Error ? error.message : "Source adapter failed"));
  } finally {
    clearTimeout(timer);
  }
}

/** Helper for network adapters: validates original URL and every redirect. */
export function validateFetchChain(initial: string, redirects: string[], allowedHosts: string[]): URL {
  let current = assertPermittedUrl(initial, allowedHosts);
  for (const redirect of redirects) current = assertPermittedRedirect(current, redirect, allowedHosts);
  return current;
}

export function makeSourceRecord(input: {
  source: SourceIdentity;
  content: string;
  revision: string;
  locator: string;
  mediaType: string;
  retrievedAt?: Date;
  expiresAt?: Date;
  confidential?: boolean;
}): SourceRecord {
  const hash = sha256(input.content);
  return {
    id: `source_record_${sha256(`${input.source.id}|${input.revision}|${hash}`)}`,
    sourceId: input.source.id,
    revision: input.revision,
    contentHash: hash,
    retrievedAt: (input.retrievedAt ?? new Date()).toISOString(),
    expiresAt: input.expiresAt?.toISOString(),
    locator: input.locator,
    mediaType: input.mediaType,
    rawObjectId: contentId("raw", hash),
    confidential: input.confidential ?? false,
  };
}

export function makeEvidence(input: {
  sourceRecord: SourceRecord;
  locator: string;
  method: ExtractionMethod;
  extractorVersion: string;
  extractedAt?: Date;
  confidence?: number;
}): EvidenceRef {
  if (!input.locator.trim()) throw new Error("Evidence locator is required");
  return {
    id: `evidence_${sha256(`${input.sourceRecord.id}|${input.locator}|${input.method}|${input.extractorVersion}`)}`,
    sourceRecordId: input.sourceRecord.id,
    locator: input.locator,
    extractionMethod: input.method,
    extractorVersion: input.extractorVersion,
    extractedAt: (input.extractedAt ?? new Date()).toISOString(),
    confidence: input.confidence,
  };
}
