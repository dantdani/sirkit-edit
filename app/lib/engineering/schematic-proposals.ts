/**
 * B06.1 / B09.1 — sealed tier-1 schematic proposals (V2: scope- and
 * lineage-sealed).
 *
 * The proposal/apply boundary for provider-suggested tier-1 edits:
 *
 *  - Receiving provider output MUTATES NOTHING. The response is compiled
 *    (deterministically, all-or-nothing) into canonical operations and
 *    sealed into an immutable, digest-pinned proposal — or blocked with
 *    the complete list of blockers.
 *  - [B09.1] The sealed artifact carries an IMMUTABLE SCOPE IDENTITY —
 *    tenantId/projectId/branchId plus the authoritative
 *    SchematicEditorSession head mark (lineageId, headSequence,
 *    canonicalStateDigest) — and that identity participates in the sealed
 *    proposal ID. A byte-identical schematic in a different project,
 *    branch, or lineage — or the same lineage after the head advanced and
 *    returned to the same schematic digest — can NEVER satisfy
 *    verification. The mark is a scope LABEL for sealing; it never mints
 *    authority (verification happens against the CURRENT ready session).
 *  - Only an explicit human "Apply exact proposal" action executes it, via
 *    the trusted interactive schematic session; apply re-verifies scope
 *    identity, head mark, base digest, operations digest, proposal
 *    identity, and expiry — and the session rechecks the head mark again
 *    INSIDE its serialized command boundary. Stale, altered, expired,
 *    foreign-scope, and V1 artifacts are rejected. Cancel discards
 *    without mutation.
 */

import type { SchematicState } from "@/lib/schematic-types";
import { schematicStateDigest } from "./schematic-model";
import { validateSchematicCanonicalMark } from "./schematic-projection";
import type { Tier1Blocker, Tier1CompilationResult, Tier1ProposalImpacts } from "./schematic-plans";
import { isWellFormedAuthorizationBinding, type SchematicProposalAuthorizationBinding } from "./proposal-authorization";
import { engineeringDigest } from "./stable";
import type { EngineeringOperation } from "./types";

/** [B16.0.1 §E] current sealed-proposal schema: V3 adds the CLOSED
 *  authorization binding (verified principal + membership revision + scope +
 *  required apply role) as a load-bearing part of the sealed identity.
 *  Because the V2 contract was already exposed, V3 is an EXPLICIT new schema
 *  version: V2 artifacts (which lack the binding) refuse application with the
 *  precise code `legacy-authorization-missing` — membership authority is
 *  never guessed or backfilled into an old artifact — and V1 artifacts remain
 *  refused as wrong-version. */
export const TIER1_PROPOSAL_SCHEMA = "sirkit.schematic-tier1-proposal.v3" as const;
export const TIER1_PROPOSAL_SCHEMA_V2 = "sirkit.schematic-tier1-proposal.v2" as const;
export const TIER1_PROPOSAL_SCHEMA_V1 = "sirkit.schematic-tier1-proposal.v1" as const;

/** Proposals expire; an expired proposal can only be regenerated, not applied. */
export const TIER1_PROPOSAL_TTL_MS = 10 * 60 * 1000;

/** The authoritative canonical head mark (SchematicEditorSession.headMark). */
export interface Tier1ProposalHeadMark {
  lineageId: string;
  headSequence: number;
  canonicalStateDigest: string;
}

/** Immutable scope identity sealed into every V2 proposal. */
export interface Tier1ProposalScope {
  tenantId: string;
  projectId: string;
  branchId: string;
  headMark: Tier1ProposalHeadMark;
}

export interface SealedTier1Proposal {
  schema: typeof TIER1_PROPOSAL_SCHEMA;
  proposalId: string;
  /** [B09.1] the sealed scope identity — part of the identity digest. */
  scope: Tier1ProposalScope;
  /** [B16.0.1 §E] the closed authorization binding — the verified principal,
   *  the membership revision the role was resolved at, the scope, and the
   *  required apply role. Load-bearing: apply-time reauthorization compares
   *  the LIVE membership against it and refuses on any divergence. */
  authorization: SchematicProposalAuthorizationBinding;
  /** UI-projection digest of the schematic the proposal was compiled against. */
  baseSchematicDigest: string;
  /** The EXACT canonical operations the apply will submit — nothing else. */
  operations: readonly EngineeringOperation[];
  operationsDigest: string;
  impacts: Tier1ProposalImpacts;
  /** Safe provider provenance: which brain proposed it and its display note.
   *  Never authority, never executable content. */
  provenance: { provider: string; note: string; instruction: string };
  createdAt: number;
  expiresAt: number;
}

export type Tier1ProposalOutcome =
  | { kind: "sealed"; proposal: SealedTier1Proposal }
  | { kind: "blocked"; blockers: Tier1Blocker[] };

function computeOperationsDigest(baseSchematicDigest: string, operations: readonly EngineeringOperation[]): string {
  return engineeringDigest({ schema: "sirkit.schematic-tier1-operations.v1", base: baseSchematicDigest, operations });
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

const SCOPE_KEYS = ["tenantId", "projectId", "branchId", "headMark"] as const;
const SCOPE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/**
 * [B09.2] scope validation reuses the CANONICAL mark validator
 * (`validateSchematicCanonicalMark`: exact mark keys, lin1-lineage format,
 * eng1-digest format, nonnegative safe-integer sequence) — no weaker
 * duplicate exists. The scope itself must carry EXACTLY the four scope
 * keys with well-formed project/branch/tenant identifiers.
 */
export function isWellFormedProposalScope(scope: unknown): scope is Tier1ProposalScope {
  if (typeof scope !== "object" || scope === null || Array.isArray(scope)) return false;
  const value = scope as Record<string, unknown>;
  for (const key of Object.keys(value)) if (!(SCOPE_KEYS as readonly string[]).includes(key)) return false;
  if (typeof value.tenantId !== "string" || !SCOPE_ID_PATTERN.test(value.tenantId)) return false;
  if (typeof value.projectId !== "string" || !SCOPE_ID_PATTERN.test(value.projectId)) return false;
  if (typeof value.branchId !== "string" || !SCOPE_ID_PATTERN.test(value.branchId)) return false;
  return validateSchematicCanonicalMark(value.headMark) !== null;
}

/** Seal a compiled proposal against the exact state AND scope it was
 *  compiled from. [B09.1] the scope identity is REQUIRED — a missing or
 *  malformed scope/head mark fails closed instead of sealing. */
export function sealTier1Proposal(input: {
  state: SchematicState;
  compilation: Tier1CompilationResult;
  provenance: { provider: string; note: string; instruction: string };
  now: number;
  scope: Tier1ProposalScope;
  /** [B16.0.1 §E] the server-verified authorization binding. Its scope must
   *  AGREE with the proposal scope; a malformed or foreign-scope binding
   *  blocks the seal (fail closed, nothing changed). */
  authorization: SchematicProposalAuthorizationBinding;
}): Tier1ProposalOutcome {
  if (!isWellFormedProposalScope(input.scope)) {
    return { kind: "blocked", blockers: [{ code: "delete-plan-refused", detail: "No authoritative project scope / canonical head mark is available — the proposal cannot be sealed. Nothing was changed." }] };
  }
  if (!isWellFormedAuthorizationBinding(input.authorization)
    || input.authorization.tenantId !== input.scope.tenantId
    || input.authorization.projectId !== input.scope.projectId
    || input.authorization.branchId !== input.scope.branchId) {
    return { kind: "blocked", blockers: [{ code: "delete-plan-refused", detail: "No verified authorization binding matching the project scope is available — the proposal cannot be sealed. Nothing was changed." }] };
  }
  if (!input.compilation.ok) {
    return { kind: "blocked", blockers: input.compilation.blockers.map((blocker) => ({ ...blocker })) };
  }
  const baseSchematicDigest = schematicStateDigest(input.state);
  const operations = structuredClone(input.compilation.operations);
  const digest = computeOperationsDigest(baseSchematicDigest, operations);
  const body = {
    schema: TIER1_PROPOSAL_SCHEMA,
    scope: structuredClone(input.scope),
    authorization: structuredClone(input.authorization),
    baseSchematicDigest,
    operations,
    operationsDigest: digest,
    impacts: structuredClone(input.compilation.impacts),
    provenance: { provider: input.provenance.provider, note: input.provenance.note, instruction: input.provenance.instruction },
    createdAt: input.now,
    expiresAt: input.now + TIER1_PROPOSAL_TTL_MS,
  };
  const proposal: SealedTier1Proposal = deepFreeze({
    ...body,
    proposalId: `prop-${engineeringDigest({ schema: "sirkit.schematic-tier1-proposal-id.v3", body }).slice(5)}`,
  });
  return { kind: "sealed", proposal };
}

export type ProposalVerification =
  | { ok: true }
  | { ok: false; code: "malformed" | "wrong-version" | "legacy-authorization-missing" | "altered" | "stale-base" | "foreign-scope" | "stale-head" | "expired"; detail: string };

/**
 * [B12.1] INTEGRITY-ONLY half of sealed-proposal verification: schema
 * version, structural shape, and both sealed digests (operations digest and
 * the whole-body identity digest). No currency (scope/head/expiry/base)
 * checks — those require the live session identity and happen at the
 * serialized execution position. The one-shot registry may be consulted
 * ONLY for artifacts that pass this authentication: an altered body must
 * never inherit another artifact's consumed status or receipt.
 */
export function verifySealedTier1ProposalIntegrity(proposal: SealedTier1Proposal): ProposalVerification {
  if ((proposal as { schema?: unknown }).schema === TIER1_PROPOSAL_SCHEMA_V1) {
    return { ok: false, code: "wrong-version", detail: "This is a V1 proposal artifact; V1 proposals are no longer applicable. Regenerate the proposal." };
  }
  // [B16.0.1 §E] a V2 artifact predates the authorization binding: membership
  // authority is never guessed or backfilled into an old artifact — it refuses
  // with the PRECISE legacy code and must be regenerated.
  if ((proposal as { schema?: unknown }).schema === TIER1_PROPOSAL_SCHEMA_V2) {
    return { ok: false, code: "legacy-authorization-missing", detail: "This V2 proposal predates the membership authorization binding and can no longer be applied. Regenerate the proposal." };
  }
  if (proposal.schema !== TIER1_PROPOSAL_SCHEMA || !Array.isArray(proposal.operations) || proposal.operations.length === 0 || !isWellFormedProposalScope(proposal.scope)) {
    return { ok: false, code: "malformed", detail: "The proposal is structurally invalid." };
  }
  // [B16.0.1 §E] the binding must be well-formed, agree with the sealed scope,
  // and (being inside the body) is covered by the identity digest below.
  if (!isWellFormedAuthorizationBinding(proposal.authorization)
    || proposal.authorization.tenantId !== proposal.scope.tenantId
    || proposal.authorization.projectId !== proposal.scope.projectId
    || proposal.authorization.branchId !== proposal.scope.branchId) {
    return { ok: false, code: "malformed", detail: "The proposal's authorization binding is missing, malformed, or disagrees with its scope." };
  }
  const recomputedOps = computeOperationsDigest(proposal.baseSchematicDigest, proposal.operations);
  if (recomputedOps !== proposal.operationsDigest) {
    return { ok: false, code: "altered", detail: "The proposal's operations no longer match its sealed operation digest." };
  }
  const { proposalId, ...body } = proposal;
  const recomputedId = `prop-${engineeringDigest({ schema: "sirkit.schematic-tier1-proposal-id.v3", body }).slice(5)}`;
  if (recomputedId !== proposalId) {
    return { ok: false, code: "altered", detail: "The proposal's identity digest does not match its content (scope/head/authorization fields included)." };
  }
  return { ok: true };
}

/**
 * Apply-time verification — run IMMEDIATELY before submitting the sealed
 * operations, against the schematic state AND the current ready session's
 * scope/head identity. [B09.1] every check fails closed:
 *  - wrong schema version (V1) → wrong-version;
 *  - operations/identity digest mismatch → altered;
 *  - tenant/project/branch or lineage mismatch → foreign-scope;
 *  - head sequence / canonical head digest mismatch (including the same
 *    lineage returning to an identical schematic digest at a LATER head)
 *    → stale-head;
 *  - expiry → expired; schematic digest mismatch → stale-base.
 * The final race is closed again inside the SchematicEditorSession
 * serialized queue via the request's expectedHeadMark.
 * [B12.1] integrity checks live in `verifySealedTier1ProposalIntegrity`
 * (run first here, and independently run BEFORE any one-shot registry
 * lookup by the approved-mutation service).
 */
export function verifySealedTier1Proposal(proposal: SealedTier1Proposal, input: {
  currentSchematicDigest: string;
  now: number;
  expectedScope: Tier1ProposalScope;
}): ProposalVerification {
  const integrity = verifySealedTier1ProposalIntegrity(proposal);
  if (!integrity.ok) return integrity;
  if (!isWellFormedProposalScope(input.expectedScope)) {
    return { ok: false, code: "foreign-scope", detail: "No authoritative current scope/head identity is available to verify against." };
  }
  const sealed = proposal.scope;
  const expected = input.expectedScope;
  if (sealed.tenantId !== expected.tenantId || sealed.projectId !== expected.projectId || sealed.branchId !== expected.branchId) {
    return { ok: false, code: "foreign-scope", detail: "The proposal was sealed for a different tenant/project/branch. Nothing was changed." };
  }
  if (sealed.headMark.lineageId !== expected.headMark.lineageId) {
    return { ok: false, code: "foreign-scope", detail: "The proposal was sealed against a different schematic lineage. Nothing was changed." };
  }
  if (sealed.headMark.headSequence !== expected.headMark.headSequence || sealed.headMark.canonicalStateDigest !== expected.headMark.canonicalStateDigest) {
    return { ok: false, code: "stale-head", detail: "The canonical schematic head moved after this proposal was created (even an identical-looking schematic is a different head). Regenerate it from the current schematic." };
  }
  if (input.now > proposal.expiresAt) {
    return { ok: false, code: "expired", detail: "The proposal has expired; regenerate it from the current schematic." };
  }
  if (input.currentSchematicDigest !== proposal.baseSchematicDigest) {
    return { ok: false, code: "stale-base", detail: "The schematic changed after this proposal was created; regenerate it from the current schematic." };
  }
  return { ok: true };
}
