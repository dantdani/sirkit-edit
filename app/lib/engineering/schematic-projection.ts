/**
 * B06.2/B06.3 — projection-mark validation and reconciliation decision table.
 *
 * Pure functions deciding how a SavedProject PROJECTION (localStorage state +
 * its `schematicCanonicalMark`) reconciles against the DURABLE canonical
 * envelope on reload.
 *
 * B06.3 — the durable envelope is the EXCLUSIVE lineage authority. A mark is
 * lineage evidence ONLY when the envelope carries a valid lineage id, the
 * mark names THAT lineage, and its sequence/digest match an actual position
 * in that lineage's log. A foreign-lineage mark never resumes, never
 * rebases, never selects the executor lineage, and never counts as a
 * verified older mark — even when its sequence and digest happen to equal
 * the envelope head. Marks are structurally validated (schema-exact) before
 * any of this; malformed marks are downgraded to untrusted projection data.
 */

import type { ProjectPersistenceEnvelope } from "./types";

export interface SchematicCanonicalMark {
  lineageId: string;
  headSequence: number;
  canonicalStateDigest: string;
}

const DIGEST_PATTERN = /^eng1-[0-9a-f]{8,}$/;
const LINEAGE_PATTERN = /^lin1-[0-9a-f]{8,}$/;
const MARK_KEYS = ["lineageId", "headSequence", "canonicalStateDigest"] as const;

/**
 * Structural validation of an untrusted mark (arbitrary JSON from
 * localStorage). Schema-exact: the three documented fields, nothing else.
 * Anything malformed is downgraded to "no mark" — untrusted projection
 * data, never a lever over the canonical head.
 */
export function validateSchematicCanonicalMark(value: unknown): SchematicCanonicalMark | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  for (const key of Object.keys(candidate)) if (!(MARK_KEYS as readonly string[]).includes(key)) return null;
  if (typeof candidate.lineageId !== "string" || !LINEAGE_PATTERN.test(candidate.lineageId)) return null;
  if (typeof candidate.headSequence !== "number" || !Number.isSafeInteger(candidate.headSequence) || candidate.headSequence < 0) return null;
  if (typeof candidate.canonicalStateDigest !== "string" || !DIGEST_PATTERN.test(candidate.canonicalStateDigest)) return null;
  return { lineageId: candidate.lineageId, headSequence: candidate.headSequence, canonicalStateDigest: candidate.canonicalStateDigest };
}

/** Validated-envelope lineage, or null when absent/malformed (pre-B06.3 legacy). */
export function envelopeLineage(envelope: Pick<ProjectPersistenceEnvelope, "lineageId">): string | null {
  return envelope.lineageId !== undefined && LINEAGE_PATTERN.test(envelope.lineageId) ? envelope.lineageId : null;
}

/** How the projection mark participated in the decision. */
export type MarkStatus =
  | "verified"            // same lineage, position-verified
  | "absent"              // no mark / malformed (downgraded to untrusted)
  | "foreign-discarded"   // names another lineage — never lineage evidence
  | "lineage-unverifiable"; // envelope has no valid lineage to verify against

export type ProjectionDecision =
  /** Projection state IS the canonical head — resume it (envelope lineage
   *  ALWAYS; a foreign mark is discarded and the mismatch recorded). */
  | { action: "resume"; markStatus: MarkStatus }
  /** Same-lineage mark proves the projection saw the exact current head and
   *  carries later legacy edits — the documented rebase path. */
  | { action: "rebase-local-newer"; markStatus: "verified" }
  /** The projection is verifiably older (or unverified) — canonical wins;
   *  the projection is preserved as an untrusted backup, never adopted. */
  | { action: "recover-canonical"; reason: "verified-older-mark" | "untrusted-projection"; markStatus: MarkStatus }
  /** Impossible or conflicting persistence states — preserve BOTH sides and
   *  require an explicit recovery choice; overwrite neither. */
  | { action: "conflict"; reason: "foreign-lineage-mark" | "mark-ahead-of-envelope" | "mark-digest-mismatch" | "mark-position-unverifiable"; markStatus: MarkStatus };

export interface ProjectionDecisionInput {
  /** UI digest of the SavedProject projection state. */
  projectionDigest: string;
  /** UI digest of the envelope head's projected schematic. */
  headUiDigest: string;
  /** VALIDATED durable envelope lineage (null = legacy envelope; the caller
   *  migrates legacy envelopes BEFORE deciding, so null only means the
   *  migration could not run — marks are then never lineage evidence). */
  envelopeLineageId: string | null;
  /** Envelope head sequence + canonical digest. */
  headSequence: number;
  headCanonicalDigest: string;
  /** canonicalStateDigest at each committed sequence: index 0 = genesis,
   *  index k = state after transaction k. Length = headSequence + 1. */
  sequenceDigests: readonly string[];
  /** Validated mark, or null when absent/malformed (untrusted). */
  mark: SchematicCanonicalMark | null;
}

/**
 * The B06.3 decision table. Every branch is deterministic and fail-closed:
 *
 * 0. mark lineage ≠ envelope lineage             → the mark is FOREIGN:
 *      projection == head                        → resume (mark discarded)
 *      projection ≠ head                         → conflict (foreign-lineage-mark)
 *                                                  — including the exact case
 *                                                  where the foreign mark's
 *                                                  sequence AND digest equal
 *                                                  the envelope head
 * 1. projection == head                          → resume
 * 2. same-lineage mark == exact current head     → rebase-local-newer
 * 3. same-lineage mark at a verified OLDER
 *    log position                                → recover-canonical
 * 4. mark sequence AHEAD of the envelope         → conflict (preserve both)
 * 5. same-sequence/wrong-digest, unverifiable
 *    position                                    → conflict (preserve both)
 *    absent/malformed mark                       → recover-canonical
 *                                                  (untrusted projection,
 *                                                   preserved as backup)
 */
export function decideProjectionReconciliation(input: ProjectionDecisionInput): ProjectionDecision {
  const mark = input.mark;
  const lineage = input.envelopeLineageId;
  const markStatus: MarkStatus = mark === null ? "absent" : lineage === null ? "lineage-unverifiable" : mark.lineageId !== lineage ? "foreign-discarded" : "verified";

  if (input.projectionDigest === input.headUiDigest) {
    // The projection IS the head — resume on the ENVELOPE lineage. A foreign
    // mark is discarded (recorded by the caller), never adopted.
    return { action: "resume", markStatus };
  }
  if (mark === null) return { action: "recover-canonical", reason: "untrusted-projection", markStatus: "absent" };
  if (lineage === null) {
    // Defensive impossible-path (callers migrate legacy envelopes before
    // deciding): with no validated envelope lineage, the mark can never be
    // lineage authority — downgrade it and let the canonical head win.
    return { action: "recover-canonical", reason: "untrusted-projection", markStatus: "lineage-unverifiable" };
  }
  if (mark.lineageId !== lineage) {
    // A mark naming ANOTHER lineage is affirmative evidence of divergent
    // history — NEVER rebase/recover on it, even when its sequence and
    // digest equal the envelope head.
    return { action: "conflict", reason: "foreign-lineage-mark", markStatus };
  }
  if (mark.headSequence > input.headSequence) {
    // A projection claiming to be AHEAD of durable history is a rollback or
    // fabrication either way — never auto-resolve.
    return { action: "conflict", reason: "mark-ahead-of-envelope", markStatus };
  }
  if (mark.headSequence === input.headSequence) {
    if (mark.canonicalStateDigest === input.headCanonicalDigest) return { action: "rebase-local-newer", markStatus: "verified" };
    return { action: "conflict", reason: "mark-digest-mismatch", markStatus };
  }
  // Older sequence: the mark must name the ACTUAL digest at that log
  // position in THIS lineage; a fabricated mark cannot, and fails closed.
  const recorded = input.sequenceDigests[mark.headSequence];
  if (recorded === undefined || recorded !== mark.canonicalStateDigest) {
    return { action: "conflict", reason: "mark-position-unverifiable", markStatus };
  }
  return { action: "recover-canonical", reason: "verified-older-mark", markStatus: "verified" };
}

/** Extract per-sequence canonical digests from a durable envelope. */
export function envelopeSequenceDigests(envelope: ProjectPersistenceEnvelope): string[] {
  const log = envelope.transactionLog;
  if (log.length === 0) return [envelope.snapshotRevision.canonicalStateDigest];
  const digests = [log[0].transaction.baseRevision.canonicalStateDigest];
  for (const record of log) digests.push(record.resultingRevision?.canonicalStateDigest ?? "");
  return digests;
}

// ─── B06.3 — lifecycle-aware mark persistence ────────────────────────────────

export type SchematicSessionLifecycleForMark = "unopened" | "hydrating" | "ready" | "conflicted" | "unavailable";

/**
 * The SavedProject patch fragment for the canonical mark, by session
 * lifecycle. Project patches MERGE, so omitting the field would silently
 * KEEP a previously stored mark — a non-ready session must therefore
 * explicitly CLEAR it (`undefined` deletes the stored key):
 *
 *  - ready    → save the exact head mark together with the exact state;
 *  - hydrating / conflicted / unavailable → clear the active mark (the
 *    stored state can no longer claim to have adopted any canonical head;
 *    prior marks survive only as untrusted conflict evidence elsewhere);
 *  - unopened → leave untouched (no session has judged the head yet).
 */
export function schematicMarkPatch(
  lifecycle: SchematicSessionLifecycleForMark,
  mark: SchematicCanonicalMark | null,
): { schematicCanonicalMark?: SchematicCanonicalMark | undefined } {
  if (lifecycle === "ready" && mark) return { schematicCanonicalMark: mark };
  if (lifecycle === "unopened") return {};
  return { schematicCanonicalMark: undefined };
}
