/**
 * [B22-C] The computation evidence aggregate `computation.evidence.v1` (discovery D22-12, D22-13; OD-141..OD-143; runbook B22-C
 * :932 "runs are reproducible or honestly marked numerically/environment dependent", :933 "results are evidence, not automatic
 * schematic/PCB authority"). One silent durable aggregate per evidence subject (a SPICE run), on the durable-workflow substrate:
 *
 *  - scoped by tenant/project/branch and keyed by the evidence id through `durableWorkflowId`; one replay partition per evidence id;
 *  - closed: a document is a validated typed summary (the scalars, each waveform's points and the SHA-256 of its values), the
 *    runtime profile's id and SHA-256 digest with the observed install digest and the seed, each model library by its content
 *    reference (`artifact://sha256/<hex>`), the SHA-256 of each raw artifact, the labels `diagnostic_only` and
 *    `environment_dependent`, `authority: "evidence_only"`, and the input bound to the server's SHA-256 of the submitted, validated
 *    snapshot - "bound to a submitted snapshot" (OD-142), never a server-held schematic revision and never authority;
 *  - explicitly encoded (OD-143): a number in a summary is a closed state - `finite` with its value, `nan`, `positive_infinity`,
 *    `negative_infinity` or `absent` - so the record's `durableWorkflowDigest` (SHA-256) never meets a raw non-finite number (CD-10
 *    digests a not-evaluated NaN band as JSON `null`; the substrate refuses one outright). CD-10's FNV digests stay identity keys;
 *  - revisioned and idempotent: every append is a compare-and-set on the aggregate revision (`stale_revision` otherwise) under the
 *    idempotency key of the evidence id and the document digest, so a retried append writes nothing new;
 *  - digest-bound: every load recomputes the record digest and the document digest and re-validates the document, refusing any
 *    disagreement with one closed error;
 *  - silent: NO outbox effect, ever (nothing consumes evidence as a command).
 *
 * The repository is INJECTED, as the B21 orchestration store's is: this module never imports the durable runtime or the database.
 * No route binds it in B22-C (the job store takes it as an optional seam; a stated deviation recorded on the page): the in-process
 * SPICE run records carry the same document, digest-bound, labelled `not_recorded`. [B22-C review] coverage-7: the snapshot the job
 * store hashes holds the server-derived scope with the submitted project, run plan and parts (OD-142's default, as applied).
 *
 * Retirement (9.5 item 23): the unwired CD-10 tables (`simulation_runs`, `simulation_waveform_artifacts` and the rest of
 * `drizzle/0018`) are NOT reused - their unique indexes key on FNV digests and nothing writes them; they stay in the schema,
 * unwired, and removing them is a migration left to the owner.
 */
import { createHash } from "node:crypto";
import { canonicalDurableScope, durableAggregateIdentity, durableScopeKey, durableWorkflowDigest, durableWorkflowId } from "../durable-workflow/stable";
import type { DurableAggregateIdentity, DurableAggregateRecord, DurableWorkflowRepository, DurableWorkflowScope } from "../durable-workflow/types";
import type { RunRecord } from "../spice/types";

export const COMPUTATION_EVIDENCE_AGGREGATE_TYPE = "computation.evidence.v1" as const;
export const COMPUTATION_EVIDENCE_SCHEMA = "sirkit.computation-evidence.v1" as const;
export const COMPUTATION_EVIDENCE_RECORD_SCHEMA = "sirkit.computation-evidence-record.v1" as const;
export const EVIDENCE_INPUT_BINDING = "bound to a submitted snapshot" as const;
export const EVIDENCE_LABELS = Object.freeze(["diagnostic_only", "environment_dependent"] as const);
export const EVIDENCE_SCOPE_SUFFIX = "computation-evidence" as const;
/** Generous bounds: a document a legitimate run produces always fits (the run's own bounds hold it far below them); they keep a stored
 *  record finite, never a reason to drop a real run's evidence. */
export const EVIDENCE_BOUNDS = Object.freeze({ maxTextChars: 4_096, maxScalars: 100_000, maxWaveforms: 100_000, maxModelLibraries: 10_000, maxRawArtifacts: 8 });
const RAW_ROLES = Object.freeze(["executed-netlist", "ngspice-ascii-raw"] as const);

export type EncodedNumber =
  | { readonly state: "finite"; readonly value: number }
  | { readonly state: "nan" }
  | { readonly state: "positive_infinity" }
  | { readonly state: "negative_infinity" }
  | { readonly state: "absent" };
export interface ComputationEvidenceDocument {
  readonly schema: typeof COMPUTATION_EVIDENCE_SCHEMA;
  readonly kind: "spice-run";
  readonly subjectId: string;
  readonly labels: readonly string[];
  readonly authority: "evidence_only";
  readonly input: { readonly binding: typeof EVIDENCE_INPUT_BINDING; readonly snapshotSha256: string };
  readonly profile: { readonly profileId: string; readonly profileDigest: string | null; readonly installDigest: string | null; readonly seed: string | null };
  readonly modelLibraries: ReadonlyArray<{ readonly id: string; readonly contentRef: string }>;
  readonly rawArtifacts: ReadonlyArray<{ readonly role: (typeof RAW_ROLES)[number]; readonly sha256: string; readonly bytes: number | null }>;
  readonly summary: {
    readonly scalars: ReadonlyArray<{ readonly name: string; readonly unit: string; readonly status: string; readonly value: EncodedNumber }>;
    readonly waveforms: ReadonlyArray<{ readonly name: string; readonly unit: string; readonly xName: string; readonly xUnit: string; readonly points: number; readonly valuesSha256: string }>;
  };
}

// ── the explicit encoding (OD-143) ──────────────────────────────────────────────────────────────────────────────────────

/** [B22-C] A number as a closed state; anything that is not a number is `absent`. */
export function encodeEvidenceNumber(value: unknown): EncodedNumber {
  if (typeof value !== "number") return { state: "absent" };
  if (Number.isNaN(value)) return { state: "nan" };
  if (value === Number.POSITIVE_INFINITY) return { state: "positive_infinity" };
  if (value === Number.NEGATIVE_INFINITY) return { state: "negative_infinity" };
  return { state: "finite", value: value === 0 ? 0 : value };
}
const valueToken = (value: number): string => (Number.isNaN(value) ? "nan" : value === Number.POSITIVE_INFINITY ? "inf" : value === Number.NEGATIVE_INFINITY ? "-inf" : String(value === 0 ? 0 : value));
/** [B22-C] The text a waveform's values are hashed over: one token per value, a closed word for a non-finite one, never `null`. */
export function evidenceValuesText(x: readonly number[], y: readonly number[]): string {
  return `x:${x.map(valueToken).join(",")};y:${y.map(valueToken).join(",")}`;
}
const byCodeUnits = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
/** [B22-C] Canonical JSON with object keys sorted, absent members dropped and a non-finite number written as a closed marker. */
export function canonicalEvidenceText(value: unknown): string {
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value === 0 ? 0 : value) : `{"$number":"${valueToken(value)}"}`;
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((item) => (item === undefined ? "null" : canonicalEvidenceText(item))).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort(byCodeUnits).map((key) => `${JSON.stringify(key)}:${canonicalEvidenceText(record[key])}`).join(",")}}`;
}
const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");
/** [B22-C] OD-142: the server's SHA-256 of the submitted, validated snapshot (64 hex characters). */
export function submittedSnapshotDigest(snapshot: unknown): string {
  return sha256(canonicalEvidenceText(snapshot));
}

// ── the closed document ─────────────────────────────────────────────────────────────────────────────────────────────────

const HEX64 = /^[0-9a-f]{64}$/;
const INSTALL_DIGEST = /^sirkit-install-tree-sha256\/1:[0-9a-f]{64}$/;
const CONTENT_REF = /^artifact:\/\/sha256\/[0-9a-f]{64}$/;
const NUL = String.fromCharCode(0); // the one character a stored text may not hold (PostgreSQL text refuses it)
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, allowEmpty = false): boolean => typeof value === "string" && (allowEmpty || value.length > 0) && value.length <= EVIDENCE_BOUNDS.maxTextChars && !value.includes(NUL);
const count = (value: unknown): boolean => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
function keysAre(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const present = Object.keys(value);
  return present.length === keys.length && keys.every((key) => present.includes(key));
}
function encodedNumberOk(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.state === "finite") return keysAre(value, ["state", "value"]) && typeof value.value === "number" && Number.isFinite(value.value);
  return ["nan", "positive_infinity", "negative_infinity", "absent"].includes(value.state as string) && keysAre(value, ["state"]);
}
function listOk(value: unknown, bound: number, item: (entry: unknown) => boolean): boolean {
  return Array.isArray(value) && value.length <= bound && value.every(item);
}

/** [B22-C] The closed document's problems (JSON paths); empty when it is a valid evidence document. */
export function validateEvidenceDocument(candidate: unknown): string[] {
  const problems: string[] = [];
  const doc = candidate as Record<string, unknown>;
  if (!keysAre(candidate, ["schema", "kind", "subjectId", "labels", "authority", "input", "profile", "modelLibraries", "rawArtifacts", "summary"])) return ["$"];
  if (doc.schema !== COMPUTATION_EVIDENCE_SCHEMA) problems.push("$.schema");
  if (doc.kind !== "spice-run") problems.push("$.kind");
  if (!text(doc.subjectId)) problems.push("$.subjectId");
  if (!Array.isArray(doc.labels) || doc.labels.length !== EVIDENCE_LABELS.length || !EVIDENCE_LABELS.every((label, index) => (doc.labels as unknown[])[index] === label)) problems.push("$.labels");
  if (doc.authority !== "evidence_only") problems.push("$.authority");
  if (!keysAre(doc.input, ["binding", "snapshotSha256"]) || doc.input.binding !== EVIDENCE_INPUT_BINDING || typeof doc.input.snapshotSha256 !== "string" || !HEX64.test(doc.input.snapshotSha256)) problems.push("$.input");
  const profile = doc.profile;
  if (!keysAre(profile, ["profileId", "profileDigest", "installDigest", "seed"]) || !text(profile.profileId) || !(profile.profileDigest === null || (typeof profile.profileDigest === "string" && HEX64.test(profile.profileDigest))) || !(profile.installDigest === null || (typeof profile.installDigest === "string" && INSTALL_DIGEST.test(profile.installDigest))) || !(profile.seed === null || text(profile.seed))) problems.push("$.profile");
  if (!listOk(doc.modelLibraries, EVIDENCE_BOUNDS.maxModelLibraries, (entry) => keysAre(entry, ["id", "contentRef"]) && text(entry.id) && typeof entry.contentRef === "string" && CONTENT_REF.test(entry.contentRef))) problems.push("$.modelLibraries");
  if (!listOk(doc.rawArtifacts, EVIDENCE_BOUNDS.maxRawArtifacts, (entry) => keysAre(entry, ["role", "sha256", "bytes"]) && (RAW_ROLES as readonly unknown[]).includes(entry.role) && typeof entry.sha256 === "string" && HEX64.test(entry.sha256) && (entry.bytes === null || count(entry.bytes)))) problems.push("$.rawArtifacts");
  const summary = doc.summary;
  if (!keysAre(summary, ["scalars", "waveforms"])) problems.push("$.summary");
  else {
    // [B22-C review] regressions-4: a scalar's name is the measurement's or specification's, which the studio lets a user clear - an
    // empty name is evidence like any other (bounded, no NUL); a refused document fails the run itself (the job store), never silently
    if (!listOk(summary.scalars, EVIDENCE_BOUNDS.maxScalars, (entry) => keysAre(entry, ["name", "unit", "status", "value"]) && text(entry.name, true) && text(entry.unit, true) && text(entry.status) && encodedNumberOk(entry.value))) problems.push("$.summary.scalars");
    if (!listOk(summary.waveforms, EVIDENCE_BOUNDS.maxWaveforms, (entry) => keysAre(entry, ["name", "unit", "xName", "xUnit", "points", "valuesSha256"]) && text(entry.name) && text(entry.unit, true) && text(entry.xName) && text(entry.xUnit, true) && count(entry.points) && typeof entry.valuesSha256 === "string" && HEX64.test(entry.valuesSha256))) problems.push("$.summary.waveforms");
  }
  return problems;
}
/** [B22-C] The document's `durableWorkflowDigest` (SHA-256 over the substrate's canonical JSON; every number in it is finite). */
export function evidenceDocumentDigest(document: ComputationEvidenceDocument): string {
  return durableWorkflowDigest(document);
}

/**
 * [B22-C] The evidence document of a completed SPICE run, built on the server from the run's validated result and manifest: its
 * typed summary, the runtime profile, the model libraries by content reference, the raw artifacts' SHA-256 and the snapshot
 * binding. A run with no manifest, or whose document does not validate, has no evidence.
 */
export function buildSpiceRunEvidence(input: { readonly run: RunRecord; readonly snapshotSha256: string }): { ok: true; document: ComputationEvidenceDocument; documentDigest: string } | { ok: false; problems: string[] } {
  const { run } = input;
  const manifest = run.manifest;
  if (!manifest) return { ok: false, problems: ["$.manifest"] };
  const runner = manifest.simulator?.runner;
  const document: ComputationEvidenceDocument = {
    schema: COMPUTATION_EVIDENCE_SCHEMA,
    kind: "spice-run",
    subjectId: run.id,
    labels: [...EVIDENCE_LABELS],
    authority: "evidence_only",
    input: { binding: EVIDENCE_INPUT_BINDING, snapshotSha256: input.snapshotSha256 },
    profile: { profileId: runner?.profileId ?? "", profileDigest: runner?.profileDigest ?? null, installDigest: runner?.installDigest ?? null, seed: runner?.seed ?? null },
    modelLibraries: Object.entries(manifest.modelChecksums ?? {}).sort(([a], [b]) => byCodeUnits(a, b)).map(([id, digest]) => ({ id, contentRef: `artifact://sha256/${digest}` })),
    rawArtifacts: [{ role: "executed-netlist" as const, sha256: manifest.netlistChecksum, bytes: null }, ...(manifest.rawOutput ? [{ role: "ngspice-ascii-raw" as const, sha256: manifest.rawOutput.sha256, bytes: manifest.rawOutput.bytes }] : [])],
    summary: {
      scalars: run.scalars.map((scalar) => ({ name: scalar.name, unit: scalar.unit ?? "", status: scalar.status, value: encodeEvidenceNumber(scalar.value) })),
      waveforms: run.waveforms.map((waveform) => ({ name: waveform.name, unit: waveform.unit, xName: waveform.xName, xUnit: waveform.xUnit, points: waveform.x.length, valuesSha256: sha256(evidenceValuesText(waveform.x, waveform.y)) })),
    },
  };
  const problems = validateEvidenceDocument(document);
  return problems.length ? { ok: false, problems } : { ok: true, document, documentDigest: evidenceDocumentDigest(document) };
}

// ── the store ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface EvidenceAppendRequest { readonly scope: DurableWorkflowScope; readonly evidenceId: string; readonly expectedRevision: number; readonly document: ComputationEvidenceDocument; readonly at: string }
export type EvidenceAppendResult =
  | { ok: true; revision: number; recordDigest: string; documentDigest: string; replayed: boolean }
  | { ok: false; code: "stale_revision"; currentRevision: number }
  | { ok: false; code: "invalid_document"; problems: string[] };
export interface LoadedEvidence { readonly revision: number; readonly recordDigest: string; readonly documentDigest: string; readonly document: ComputationEvidenceDocument; readonly at: string }
export interface ComputationEvidenceStore {
  append(request: EvidenceAppendRequest): Promise<EvidenceAppendResult>;
  /** The head record, every digest re-verified; null when nothing was written for that id in that scope. */
  load(scope: DurableWorkflowScope, evidenceId: string): Promise<LoadedEvidence | null>;
  /** Every revision in order, each re-verified. */
  history(scope: DurableWorkflowScope, evidenceId: string): Promise<LoadedEvidence[]>;
}
interface StoredEvidence { schema: typeof COMPUTATION_EVIDENCE_RECORD_SCHEMA; evidenceId: string; revision: number; at: string; documentDigest: string; document: ComputationEvidenceDocument }

/** [B22-C] A stored record that fails its digest or document check: one closed error, nothing returned. */
export class ComputationEvidenceIntegrityError extends Error {
  readonly code = "EVIDENCE_DIGEST_MISMATCH" as const;
  constructor() {
    super("EVIDENCE_DIGEST_MISMATCH: a stored computation evidence record failed its digest or document check; nothing was returned");
    this.name = "ComputationEvidenceIntegrityError";
  }
}

export function evidenceAggregateKey(scope: DurableWorkflowScope, evidenceId: string): string {
  return durableWorkflowId("computation-evidence", { ...canonicalDurableScope(scope), evidenceId });
}
export function evidenceScopeKey(scope: DurableWorkflowScope, evidenceId: string): string {
  return durableScopeKey(scope, `${EVIDENCE_SCOPE_SUFFIX}:${evidenceId}`);
}
const identityOf = (scope: DurableWorkflowScope, evidenceId: string): DurableAggregateIdentity => durableAggregateIdentity(scope, COMPUTATION_EVIDENCE_AGGREGATE_TYPE, evidenceAggregateKey(scope, evidenceId));
function digestOrNull(value: unknown): string | null {
  try {
    return durableWorkflowDigest(value);
  } catch {
    return null;
  }
}
function verified(record: DurableAggregateRecord<object>, evidenceId: string): LoadedEvidence {
  const payload = record.payload as Partial<StoredEvidence>;
  const ok = record.aggregateType === COMPUTATION_EVIDENCE_AGGREGATE_TYPE
    && isRecord(payload) && payload.schema === COMPUTATION_EVIDENCE_RECORD_SCHEMA && payload.evidenceId === evidenceId && payload.revision === record.revision
    && digestOrNull(payload) === record.recordDigest
    && typeof payload.documentDigest === "string" && digestOrNull(payload.document) === payload.documentDigest
    && validateEvidenceDocument(payload.document).length === 0 && payload.document!.subjectId === evidenceId;
  if (!ok) throw new ComputationEvidenceIntegrityError();
  return { revision: record.revision, recordDigest: record.recordDigest, documentDigest: payload.documentDigest!, document: payload.document!, at: payload.at! };
}

/** [B22-C] The store over an injected durable-workflow repository (in-memory in tests; PostgreSQL when a composition root binds it). */
export function createComputationEvidenceStore(repository: DurableWorkflowRepository): ComputationEvidenceStore {
  return Object.freeze({
    async append(request: EvidenceAppendRequest): Promise<EvidenceAppendResult> {
      const problems = validateEvidenceDocument(request.document);
      if (!text(request.evidenceId)) problems.push("$.evidenceId");
      else if (problems.length === 0 && request.document.subjectId !== request.evidenceId) problems.push("$.subjectId");
      if (!count(request.expectedRevision)) problems.push("$.expectedRevision");
      if (typeof request.at !== "string" || !Number.isFinite(Date.parse(request.at))) problems.push("$.at");
      if (problems.length) return { ok: false, code: "invalid_document", problems };
      const scope = canonicalDurableScope(request.scope);
      const documentDigest = evidenceDocumentDigest(request.document);
      const payload: StoredEvidence = { schema: COMPUTATION_EVIDENCE_RECORD_SCHEMA, evidenceId: request.evidenceId, revision: request.expectedRevision + 1, at: request.at, documentDigest, document: request.document };
      try {
        const committed = await repository.commit({
          scope,
          scopeKey: evidenceScopeKey(scope, request.evidenceId),
          idempotencyKey: `computation-evidence:${request.evidenceId}:${documentDigest}`,
          operations: [{ aggregateType: COMPUTATION_EVIDENCE_AGGREGATE_TYPE, aggregateKey: evidenceAggregateKey(scope, request.evidenceId), expectedRevision: request.expectedRevision, payload, recordDigest: durableWorkflowDigest(payload) }],
          outbox: [], // silent: no effect, ever
          result: { evidenceId: request.evidenceId, documentDigest },
          committedAt: request.at,
        });
        const record = committed.records[0]!;
        return { ok: true, revision: record.revision, recordDigest: record.recordDigest, documentDigest, replayed: committed.idempotent };
      } catch (error) {
        if (error instanceof Error && error.message === "DW_OPTIMISTIC_REVISION_CONFLICT") {
          const head = await repository.loadHead(identityOf(scope, request.evidenceId));
          return { ok: false, code: "stale_revision", currentRevision: head?.revision ?? 0 };
        }
        throw error;
      }
    },
    async load(scope: DurableWorkflowScope, evidenceId: string): Promise<LoadedEvidence | null> {
      const head = await repository.loadHead(identityOf(scope, evidenceId));
      return head ? verified(head, evidenceId) : null;
    },
    async history(scope: DurableWorkflowScope, evidenceId: string): Promise<LoadedEvidence[]> {
      return (await repository.history(identityOf(scope, evidenceId))).map((record) => verified(record, evidenceId)).sort((a, b) => a.revision - b.revision);
    },
  });
}
