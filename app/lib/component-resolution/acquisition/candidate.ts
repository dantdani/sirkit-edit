/**
 * [PR-M, 2026-10-18] Section M2 (design M2.3): the DURABLE LIBRARY CANDIDATE - aggregate `atomic.acquisition-candidate.v1` in the source
 * project's (tenant, project, branch) scope, CAS-guarded with idempotency keys, on the injected `DurableWorkflowRepository`. It is what
 * an acquisition produced, kept whether or not anyone reviews it:
 *
 *  - the target identity (the catalog part, its KiCad symbol / footprint, the stated MPN, package and mounting) and the instances;
 *  - every object it rests on (role, SHA-256, size, locator, pinned ref, retrieval time, source) - the bytes live in the object store;
 *  - the parsed assets (version id, semantic hash, validation state, diagnostic codes, the symbol's pins, the footprint's pads);
 *  - the validation report and its digest; the licence, attribution and retention; whether it is fixture evidence;
 *  - its state: validated | conflicting | unsupported -> handed-off -> in-review -> published | rejected | withdrawn (append-only history).
 * A candidate is never authority: only a published atomic revision is.
 */
import { durableAggregateIdentity, durableScopeKey } from "../../durable-workflow/stable";
import type { DurableWorkflowRepository, DurableWorkflowScope } from "../../durable-workflow/types";
import { canonicalJson, sha256 } from "../../atomic/stable";
import type { LicenseRecord } from "../../atomic/types";
import type { CadValidationReport } from "../../acquisition/cad-validation";
import type { CadSourceId } from "../../acquisition/cad-source-registry";

export const ACQUISITION_CANDIDATE_AGGREGATE = "atomic.acquisition-candidate.v1" as const;
export const ACQUISITION_CANDIDATE_SCHEMA = "sirkit.acquisition-candidate.v1" as const;
export const CANDIDATE_ID = /^acquisition-candidate:[0-9a-f]{32}$/;

export type AcquisitionCandidateState = "validated" | "conflicting" | "unsupported" | "handed-off" | "in-review" | "published" | "rejected" | "withdrawn";
const TRANSITIONS: Readonly<Record<AcquisitionCandidateState, readonly AcquisitionCandidateState[]>> = Object.freeze({
  validated: ["handed-off"], conflicting: [], unsupported: [], "handed-off": ["in-review", "published", "rejected", "withdrawn"], "in-review": ["published", "rejected", "withdrawn"], published: ["withdrawn"], rejected: [], withdrawn: [],
});

/** What an acquisition is for: derived on the server from the verified sheet and the server catalog, never from a body. */
export interface AcquisitionTarget {
  componentIds: string[];
  refDes: string[];
  value: string;
  catalogPartId: string;
  catalogMpn: string | null;
  symbol: { library: string; name: string };
  footprint: { library: string; name: string } | null;
  exactMpn: string | null;
  packageCode: string | null;
  mounting: "smd" | "through_hole" | null;
}

export type CandidateObjectRole = "symbol-file" | "symbol-parent" | "symbol-library" | "footprint" | "datasheet";
export interface CandidateObjectRef { role: CandidateObjectRole; sha256: string; byteLength: number; mediaType: string; locator: string; ref: string | null; retrievedAt: string; sourceId: CadSourceId | "composed"; library: string | null; name: string }

export interface AcquisitionCandidate {
  schema: typeof ACQUISITION_CANDIDATE_SCHEMA;
  candidateId: string;
  target: AcquisitionTarget;
  sourceId: CadSourceId;
  registryVersion: string;
  objects: CandidateObjectRef[];
  /** the object the publication reads for the symbol (the composed library when the symbol extends a parent) */
  symbolObject: string | null;
  footprintObject: string | null;
  datasheetObject: string | null;
  symbol: null | { library: string; name: string; versionId: string; semanticHash: string; validationState: string; diagnostics: string[]; pins: Array<{ number: string; name: string; electricalType: string }> };
  footprint: null | { library: string; name: string; versionId: string; semanticHash: string; validationState: string; diagnostics: string[]; mountingTechnology: string; electricalPads: string[] };
  pinTable: null | { part: string; fixture: boolean; packageCode: string | null; mounting: "smd" | "through_hole" | null; rows: Array<{ number: string; function: string; pads: string[] }>; sourceClass: string };
  missing: string[];
  report: CadValidationReport;
  licence: { record: LicenseRecord; attribution: string; link: string | null; retention: "indefinite"; pinTableLicence: LicenseRecord | null };
  fixtureEvidence: boolean;
  state: AcquisitionCandidateState;
  history: Array<{ at: string; to: AcquisitionCandidateState; by: string; note: string }>;
  createdAt: string;
}

export function acquisitionCandidateId(target: AcquisitionTarget, sourceId: string, objects: readonly CandidateObjectRef[], reportDigest: string): string {
  return `acquisition-candidate:${sha256(canonicalJson({ part: target.catalogPartId, symbol: target.symbol, footprint: target.footprint, exactMpn: target.exactMpn, packageCode: target.packageCode, mounting: target.mounting, sourceId, objects: objects.map((object) => [object.role, object.sha256]), reportDigest })).slice(0, 32)}`;
}

export class AcquisitionCandidateError extends Error {
  constructor(readonly code: "ACQUISITION_CANDIDATE_NOT_FOUND" | "ACQUISITION_CANDIDATE_TRANSITION_REFUSED" | "ACQUISITION_CANDIDATE_CONTENDED", detail: string = code) {
    super(detail);
    this.name = "AcquisitionCandidateError";
  }
}

export class DurableAcquisitionCandidateStore {
  constructor(private readonly repository: DurableWorkflowRepository) {}

  private identity(scope: DurableWorkflowScope, candidateId: string) { return durableAggregateIdentity(scope, ACQUISITION_CANDIDATE_AGGREGATE, candidateId); }

  /** Store a new candidate; the same candidate again (same id) answers the stored one (idempotent). */
  async put(scope: DurableWorkflowScope, candidate: AcquisitionCandidate, committedAt: string): Promise<AcquisitionCandidate> {
    const existing = await this.repository.loadHead<AcquisitionCandidate>(this.identity(scope, candidate.candidateId));
    if (existing) return structuredClone(existing.payload);
    try {
      await this.repository.commit({ scope, scopeKey: durableScopeKey(scope, "acquisition-candidates"), idempotencyKey: `acquisition-candidate:put:${candidate.candidateId}`, operations: [{ aggregateType: ACQUISITION_CANDIDATE_AGGREGATE, aggregateKey: candidate.candidateId, expectedRevision: 0, payload: candidate }], outbox: [], result: { candidateId: candidate.candidateId }, committedAt });
    } catch (error) {
      if (!(error instanceof Error && error.message === "DW_OPTIMISTIC_REVISION_CONFLICT")) throw error;
    }
    return this.get(scope, candidate.candidateId);
  }

  /** Read one candidate; unknown, malformed and foreign ids are the same refusal. */
  async get(scope: DurableWorkflowScope, candidateId: string): Promise<AcquisitionCandidate> {
    if (typeof candidateId !== "string" || !CANDIDATE_ID.test(candidateId)) throw new AcquisitionCandidateError("ACQUISITION_CANDIDATE_NOT_FOUND");
    const head = await this.repository.loadHead<AcquisitionCandidate>(this.identity(scope, candidateId));
    if (!head || head.payload.schema !== ACQUISITION_CANDIDATE_SCHEMA || head.payload.candidateId !== candidateId) throw new AcquisitionCandidateError("ACQUISITION_CANDIDATE_NOT_FOUND");
    return structuredClone(head.payload);
  }

  /** One legal state edge (CAS); a repeat of the edge already taken is idempotent. */
  async transition(scope: DurableWorkflowScope, candidateId: string, to: AcquisitionCandidateState, input: { by: string; note: string; at: string }): Promise<AcquisitionCandidate> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const head = await this.repository.loadHead<AcquisitionCandidate>(this.identity(scope, candidateId));
      if (!head) throw new AcquisitionCandidateError("ACQUISITION_CANDIDATE_NOT_FOUND");
      const current = head.payload;
      if (current.state === to) return structuredClone(current);
      if (!TRANSITIONS[current.state].includes(to)) throw new AcquisitionCandidateError("ACQUISITION_CANDIDATE_TRANSITION_REFUSED", `${current.state} -> ${to}`);
      const next: AcquisitionCandidate = { ...structuredClone(current), state: to, history: [...current.history, { at: input.at, to, by: input.by, note: input.note.slice(0, 300) }].slice(-32) };
      try {
        await this.repository.commit({ scope, scopeKey: durableScopeKey(scope, "acquisition-candidates"), idempotencyKey: `acquisition-candidate:${candidateId}:${head.revision}:${to}`, operations: [{ aggregateType: ACQUISITION_CANDIDATE_AGGREGATE, aggregateKey: candidateId, expectedRevision: head.revision, payload: next }], outbox: [], result: { candidateId, to }, committedAt: input.at });
        return next;
      } catch (error) {
        if (error instanceof Error && error.message === "DW_OPTIMISTIC_REVISION_CONFLICT") continue;
        throw error;
      }
    }
    throw new AcquisitionCandidateError("ACQUISITION_CANDIDATE_CONTENDED");
  }
}
