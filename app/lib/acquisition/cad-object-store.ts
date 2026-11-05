/**
 * [PR-M, 2026-10-18] Section M2 (runbook M.3 items 3 and 5, design M2.3): the DURABLE home of acquired bytes before (and while) a
 * candidate is reviewed - aggregate `atomic.acquired-object.v1` on the injected `DurableWorkflowRepository` (the generation-task store's
 * pattern: this module never imports the durable runtime or a database client), keyed by the bytes' SHA-256 inside one
 * (tenant, project, branch) scope.
 *
 *  - The payload holds the exact text, its byte length and media type, and the provenance of every retrieval that produced those bytes:
 *    the CAD source and registry version, the locator (an origin + path, never a query string), the pinned ref, the retrieval time and
 *    the licence. Content is DEDUPLICATED by bytes within the scope; a second source or ref yielding the same bytes adds a provenance
 *    row (CAS) - versioned by source identity in the record, never a second copy.
 *  - Every read RE-HASHES the text (CAD_OBJECT_INTEGRITY on a mismatch), and an unknown hash, a malformed hash and another scope's
 *    object are the SAME refusal (CAD_OBJECT_NOT_FOUND): the repository is scoped, and nothing here lists across scopes.
 *  - Content whose retention class is not `indefinite`, or whose licence is not redistributable on all three dispositions, is REFUSED
 *    (CAD_OBJECT_RETENTION_REFUSED / CAD_OBJECT_LICENCE_REFUSED): durable workflow history is append-only and cannot honour a deletion,
 *    so a datasheet PDF or a 3D model needs the deletable blob table of OD-M2-7 first.
 * Raw vendor blobs and credentials never go to Git: this store is the database (or the fixture runtime's in-memory repository).
 */
import { durableAggregateIdentity, durableScopeKey } from "../durable-workflow/stable";
import type { DurableWorkflowRepository, DurableWorkflowScope } from "../durable-workflow/types";
import { canonicalJson, sha256 } from "../atomic/stable";
import type { LicenseRecord } from "../atomic/types";
import type { CadAssetKind, CadRetentionClass, CadSourceId } from "./cad-source-registry";

export const CAD_OBJECT_AGGREGATE = "atomic.acquired-object.v1" as const;
export const CAD_OBJECT_SCHEMA = "sirkit.acquired-object.v1" as const;
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_PROVENANCE = 32;

export interface AcquiredObjectProvenance {
  sourceId: CadSourceId | "composed";
  registryVersion: string;
  /** origin + path, or a local checkout path; never a query string */
  locator: string;
  /** the pinned commit the bytes were read at (null for a composition or a pin table without one) */
  ref: string | null;
  retrievedAt: string;
  /** the objects a composed text was assembled from (their SHA-256), in order */
  composedFrom?: string[];
  /** the bytes' line endings as stored (a local checkout follows the operator's git configuration) */
  lineEndings: "lf" | "crlf" | "mixed" | "none";
}

export interface AcquiredObject {
  schema: typeof CAD_OBJECT_SCHEMA;
  sha256: string;
  byteLength: number;
  kind: CadAssetKind | "symbol-library";
  mediaType: string;
  text: string;
  license: LicenseRecord;
  retention: CadRetentionClass;
  provenance: AcquiredObjectProvenance[];
}

export class CadObjectStoreError extends Error {
  constructor(readonly code: "CAD_OBJECT_NOT_FOUND" | "CAD_OBJECT_INTEGRITY" | "CAD_OBJECT_RETENTION_REFUSED" | "CAD_OBJECT_LICENCE_REFUSED" | "CAD_OBJECT_INVALID" | "CAD_OBJECT_CONTENDED", detail: string = code) {
    super(detail);
    this.name = "CadObjectStoreError";
  }
}

export function lineEndingsOf(text: string): AcquiredObjectProvenance["lineEndings"] {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/\n/g) ?? []).length - crlf;
  if (crlf === 0 && lf === 0) return "none";
  return crlf === 0 ? "lf" : lf === 0 ? "crlf" : "mixed";
}

const redistributable = (license: LicenseRecord): boolean => [license.rawRedistribution, license.derivedRedistribution, license.exportDisposition].every((item) => item === "redistributable");

export class DurableAcquiredObjectStore {
  constructor(private readonly repository: DurableWorkflowRepository) {}

  private identity(scope: DurableWorkflowScope, hash: string) {
    return durableAggregateIdentity(scope, CAD_OBJECT_AGGREGATE, `acquired-object:${hash}`);
  }

  /** Store (or deduplicate) one object. Returns the stored object and whether this call added bytes or a provenance row. */
  async put(scope: DurableWorkflowScope, input: { text: string; kind: AcquiredObject["kind"]; mediaType: string; license: LicenseRecord; retention: CadRetentionClass; provenance: Omit<AcquiredObjectProvenance, "lineEndings">; committedAt: string }): Promise<{ object: AcquiredObject; created: boolean }> {
    if (typeof input.text !== "string") throw new CadObjectStoreError("CAD_OBJECT_INVALID", "the object is not text");
    if (input.retention !== "indefinite") throw new CadObjectStoreError("CAD_OBJECT_RETENTION_REFUSED", `retention ${input.retention} cannot be honoured by append-only history; a deletable blob store is OD-M2-7`);
    if (!redistributable(input.license)) throw new CadObjectStoreError("CAD_OBJECT_LICENCE_REFUSED", `licence ${input.license.id} is not redistributable on all three dispositions (OD-M2-11)`);
    const hash = sha256(input.text);
    const provenance: AcquiredObjectProvenance = { ...input.provenance, lineEndings: lineEndingsOf(input.text) };
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const head = await this.repository.loadHead<AcquiredObject>(this.identity(scope, hash));
      const current = head ? this.verified(head.payload, hash) : null;
      const known = current?.provenance.some((row) => canonicalJson(row) === canonicalJson(provenance)) ?? false;
      if (current && known) return { object: current, created: false };
      const next: AcquiredObject = current
        ? { ...current, provenance: [...current.provenance, provenance].slice(-MAX_PROVENANCE) }
        : { schema: CAD_OBJECT_SCHEMA, sha256: hash, byteLength: Buffer.byteLength(input.text, "utf8"), kind: input.kind, mediaType: input.mediaType, text: input.text, license: structuredClone(input.license), retention: input.retention, provenance: [provenance] };
      try {
        await this.repository.commit({
          scope, scopeKey: durableScopeKey(scope, "acquired-objects"), idempotencyKey: `acquired-object:${hash}:${head?.revision ?? 0}:${sha256(canonicalJson(provenance)).slice(0, 16)}`,
          operations: [{ aggregateType: CAD_OBJECT_AGGREGATE, aggregateKey: `acquired-object:${hash}`, expectedRevision: head?.revision ?? 0, payload: next }],
          outbox: [], result: { sha256: hash }, committedAt: input.committedAt,
        });
        return { object: next, created: !current };
      } catch (error) {
        if (error instanceof Error && error.message === "DW_OPTIMISTIC_REVISION_CONFLICT") continue;
        throw error;
      }
    }
    throw new CadObjectStoreError("CAD_OBJECT_CONTENDED");
  }

  /** Read one object by its SHA-256, re-hashed; unknown, malformed and foreign are the same refusal. */
  async get(scope: DurableWorkflowScope, hash: string): Promise<AcquiredObject> {
    if (typeof hash !== "string" || !SHA256.test(hash)) throw new CadObjectStoreError("CAD_OBJECT_NOT_FOUND");
    const head = await this.repository.loadHead<AcquiredObject>(this.identity(scope, hash));
    if (!head) throw new CadObjectStoreError("CAD_OBJECT_NOT_FOUND");
    return this.verified(head.payload, hash);
  }

  /** Whether the scope holds the object (same verification as `get`). */
  async has(scope: DurableWorkflowScope, hash: string): Promise<boolean> {
    try { await this.get(scope, hash); return true; } catch (error) { if (error instanceof CadObjectStoreError && error.code === "CAD_OBJECT_NOT_FOUND") return false; throw error; }
  }

  private verified(payload: AcquiredObject, hash: string): AcquiredObject {
    if (!payload || payload.schema !== CAD_OBJECT_SCHEMA || typeof payload.text !== "string" || sha256(payload.text) !== hash || payload.sha256 !== hash || Buffer.byteLength(payload.text, "utf8") !== payload.byteLength) throw new CadObjectStoreError("CAD_OBJECT_INTEGRITY", "the stored object does not hash to its key");
    return structuredClone(payload);
  }
}
