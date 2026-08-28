/**
 * B15 §C — the sealed bounded PCB-edit proposal
 * (`sirkit.pcb-bounded-edit-proposal.v2`).
 *
 * A PCB-SPECIFIC artifact — never an overload of a schematic schema, and it
 * carries NO schematic-only identity field (no `baseSchematicDigest`). It
 * binds, under one whole-body identity digest: tenant/project/branch, the
 * board instance, the canonical resource id + digest, the PCB revision, the
 * board digest, the history head, the lineage identity, the normalized
 * bounded operations and their digest, the compiled candidate digest, the
 * impact report and its digest, tool identity + version, actor and effective
 * actor, discovery identity, provider provenance, creation time, expiry, and
 * a proposal nonce.
 *
 * Receiving or displaying one mutates NOTHING. A mutable candidate board
 * received from a client or provider is never authority: the seal carries
 * only the candidate DIGEST, and the apply path RECOMPILES from the live
 * board through the same shared compiler and byte-matches the digests.
 */

import { engineeringDigest } from "../../engineering/stable";
import type { ProjectRole } from "../../engineering/types";
import { PRESETS } from "../drc/presets";
import type { DrcRules } from "../drc/types";
import { BOUNDED_EDIT_COMPILE_SCHEMA, BOUNDED_EDIT_IMPACT_LIMITS, type BoundedEditImpactReport } from "./bounded-edit-compiler";
import { BOUNDED_EDIT_LIMITS, parseBoundedEditRequest, type BoundedPcbEditOperation } from "./bounded-edit-operations";

/** [B16.0.1] the CURRENT proposal schema. v1 → v2 because the §E
 *  `authorizationBinding` (verified principal + membership revision) changed
 *  the exposed contract — the stage forbids silently mutating an exposed v1
 *  in place. A v1 artifact refuses with `legacy-authorization-missing` and is
 *  NEVER applied or backfilled with membership authority. */
export const PCB_EDIT_PROPOSAL_SCHEMA = "sirkit.pcb-bounded-edit-proposal.v2" as const;
/** The LEGACY pre-authorization schema — recognized only to refuse precisely. */
export const PCB_EDIT_PROPOSAL_SCHEMA_V1 = "sirkit.pcb-bounded-edit-proposal.v1" as const;
export const PCB_EDIT_PROPOSAL_TTL_MS = 10 * 60 * 1000;
export const PCB_EDIT_APPROVAL_TIER = "topology-or-geometry" as const;

/** [B16.0.1] bumped .v1 → .v2 with the proposal schema (the identity digest
 *  covers the authorization-carrying v2 body). MUST stay byte-identical to
 *  the sealer's copy in `pcb-edit-proposal-sealer.internal.ts`. */
const IDENTITY_DIGEST_SCHEMA = "sirkit.pcb-bounded-edit-proposal-id.v2";
/** MUST match the compiler's digest schemas so verification can recompute. */
const NORMALIZED_OPS_DIGEST_SCHEMA = "sirkit.pcb-bounded-edit-operations.v1";
const IMPACT_DIGEST_SCHEMA = "sirkit.pcb-bounded-edit-impact.v1";

export interface PcbProposalScope {
  tenantId: string;
  projectId: string;
  branchId: string;
  boardInstanceId: string;
}

/** The authorization schema this binding conforms to. Bumping it makes every
 *  proposal sealed under an older authorization contract refuse at verify (the
 *  closed key set + this exact string), so a legacy proposal can never apply. */
export const PCB_PROPOSAL_AUTHORIZATION_SCHEMA = "sirkit.pcb-proposal-authorization.v1" as const;
/** The roles that may APPLY a bounded PCB edit (a viewer/commenter never can). */
export const PCB_APPLY_ROLES: readonly ProjectRole[] = ["pcb_editor", "project_admin"];

/**
 * [B16.0.1 §E] the CLOSED authorization binding sealed into every bounded PCB
 * proposal. It makes the verified principal AND the membership revision the
 * role was resolved at LOAD-BEARING inside the proposal identity (covered by
 * the whole-body digest): the apply-time reauthorization (§F) reloads the live
 * membership and refuses the apply if the principal changed, the role is no
 * longer an apply role, the membership revision moved, or the project scope
 * differs — so a revoked, downgraded, or logged-out author can never apply an
 * already-sealed proposal. `principalId` MUST equal `effectiveActor.actorId`
 * (the verified human the proposal was created for).
 */
export interface PcbProposalAuthorizationBinding {
  authorizationSchema: typeof PCB_PROPOSAL_AUTHORIZATION_SCHEMA;
  /** The verified principal id the proposal was authorized for. */
  principalId: string;
  /** The membership revision the principal's role was resolved at. */
  membershipRevision: string;
  tenantId: string;
  projectId: string;
  branchId: string;
  /** The minimum role required to APPLY — one of PCB_APPLY_ROLES. */
  requiredApplyRole: ProjectRole;
}

/**
 * [B15.3 pre-exposure gate] The EXACT validation policy the proposal was
 * compiled under. Before this field existed, the same board + payload sealed
 * under two DIFFERENT DRC presets produced BYTE-IDENTICAL verifying bodies —
 * the policy was provably unpinned. Now the preset identity, its version,
 * and a canonical digest of the exact `DrcRules` object used at compile time
 * travel inside the sealed body (covered by the whole-body identity digest),
 * and verification RECOMPUTES the rules digest from the in-repo preset
 * registry — a proposal compiled under rules that no longer match the named
 * preset refuses.
 *
 * SCHEMA DECISION (B15.3, SUPERSEDED by B16.0.1): at B15.3 the proposal
 * schema deliberately stayed `sirkit.pcb-bounded-edit-proposal.v1` because
 * the contract had never been exposed. B16.0.1 then EXPOSED the contract and
 * added the §E authorization binding, so the schema is now explicitly
 * versioned: the current schema is `sirkit.pcb-bounded-edit-proposal.v2` and
 * a v1 artifact refuses with `legacy-authorization-missing`.
 */
export interface PcbValidationPolicy {
  /** DRC preset id from the canonical in-repo registry (e.g. "jlcpcb-2l"). */
  presetId: string;
  /** The preset's version at compile time. */
  presetVersion: number;
  /** Canonical digest of the EXACT DrcRules object used for compilation. */
  rulesDigest: string;
  /** The compiler/policy schema the impact was produced under. */
  compileSchema: typeof BOUNDED_EDIT_COMPILE_SCHEMA;
}

const DRC_RULES_DIGEST_SCHEMA = "sirkit.pcb-drc-rules.v1";
const RULES_DIGEST_CACHE = new Map<string, string>();

/**
 * The ONE authority for validation-policy identity, used by BOTH the sealing
 * service (to derive the rules it compiles with) and the verifier (to
 * recompute the pinned identity). Returns null for an unknown preset —
 * callers refuse; nothing is fabricated.
 */
export function resolvePcbValidationPolicy(presetId: string): { policy: PcbValidationPolicy; rules: DrcRules } | null {
  const preset = PRESETS.find((candidate) => candidate.id === presetId);
  if (!preset) return null;
  const cacheKey = `${preset.id}@${preset.version}`;
  let rulesDigest = RULES_DIGEST_CACHE.get(cacheKey);
  if (!rulesDigest) {
    rulesDigest = engineeringDigest({ schema: DRC_RULES_DIGEST_SCHEMA, presetId: preset.id, presetVersion: preset.version, rules: preset.rules });
    RULES_DIGEST_CACHE.set(cacheKey, rulesDigest);
  }
  return {
    policy: { presetId: preset.id, presetVersion: preset.version, rulesDigest, compileSchema: BOUNDED_EDIT_COMPILE_SCHEMA },
    rules: preset.rules,
  };
}

export interface PcbProposalBaseMark {
  /** Canonical resource identity the proposal was derived from. */
  canonicalResource: { resourceId: string; contentDigest: string };
  /** `pcbRevisionId(board)` at proposal time. */
  pcbRevisionId: string;
  /** Semantic board digest at proposal time. */
  boardDigest: string;
  /** PcbHistory head at proposal time (entry count + last label). */
  historyHead: { sequence: number; label: string | null };
  /** Canonical lineage identity of the editing session. */
  lineageId: string;
}

export interface SealedPcbEditProposal {
  schema: typeof PCB_EDIT_PROPOSAL_SCHEMA;
  proposalId: string;
  nonce: string;
  scope: PcbProposalScope;
  base: PcbProposalBaseMark;
  /** [B15.3] the exact validation policy the proposal was compiled under. */
  validationPolicy: PcbValidationPolicy;
  intent: string;
  operations: readonly BoundedPcbEditOperation[];
  operationsDigest: string;
  candidateDigest: string;
  impact: BoundedEditImpactReport;
  impactDigest: string;
  mintedObjectIds: readonly string[];
  tool: { toolId: string; version: string };
  actor: { actorId: string; kind: string };
  effectiveActor: { actorId: string; kind: string };
  /** [B16.0.1 §E] the sealed authorization binding — makes the verified
   *  principal + membership revision load-bearing for apply-time reauth. */
  authorizationBinding: PcbProposalAuthorizationBinding;
  discovery: { digest: string; contextDigest: string };
  provenance: { provider: string; model: string; runId: string | null };
  createdAt: number;
  expiresAt: number;
  approvalTier: typeof PCB_EDIT_APPROVAL_TIER;
}

export const PCB_EDIT_PROPOSAL_KEYS = [
  "schema", "proposalId", "nonce", "scope", "base", "validationPolicy", "intent", "operations",
  "operationsDigest", "candidateDigest", "impact", "impactDigest", "mintedObjectIds",
  "tool", "actor", "effectiveActor", "authorizationBinding", "discovery", "provenance",
  "createdAt", "expiresAt", "approvalTier",
] as const;

/**
 * [B15.1 §G] The compiler result, passed as ONE object. A caller cannot
 * independently supply the pins the seal certifies: the operations, the
 * digests, the impact, and the minted ids all travel together from a single
 * successful `compileBoundedPcbEdit` result.
 */
export interface CompiledPcbEditForSeal {
  request: { intent: string; operations: readonly BoundedPcbEditOperation[] };
  normalizedOperationsDigest: string;
  candidateDigest: string;
  impact: BoundedEditImpactReport;
  impactDigest: string;
  mintedObjectIds: readonly string[];
}

/** The ONE tool identity permitted to seal a bounded PCB edit proposal. */
export const PCB_EDIT_PROPOSAL_TOOL_ID = "sirkit.pcb.propose-bounded-edit" as const;
export const PCB_EDIT_PROPOSAL_TOOL_VERSION = "1.0.0" as const;

/**
 * [B15.2.1 §E] The raw sealer and assembler are NO LONGER exported here.
 * Minting a sealed proposal is possible ONLY through
 * `createSealedPcbEditProposal` (pcb-edit-proposal-service.ts), which runs
 * the compiler internally and calls the module-private raw sealer in
 * `pcb-edit-proposal-sealer.internal.ts`. A caller cannot present a
 * structural `CompiledPcbEditForSeal` as proof the compiler ran, and an
 * AST import gate proves nothing else imports the raw sealer.
 */

export type PcbProposalVerification =
  | { ok: true }
  // [B16.0.1] `legacy-authorization-missing`: a v1 artifact predates the §E
  // authorization binding and refuses PRECISELY — never applied, never
  // backfilled with membership authority.
  | { ok: false; code: "malformed" | "wrong-version" | "legacy-authorization-missing" | "altered" | "expired"; detail: string };

/**
 * INTEGRITY half [B15.1 §G]: schema, closed key set, the exact tool
 * identity, the approval tier, the createdAt/expiresAt relationship and TTL
 * ceiling, `candidateDigest === impact.candidateBoardDigest`, the RECOMPUTED
 * normalized-operations digest (over the sealed base identity), the
 * RECOMPUTED impact digest, and the whole-body identity.
 *
 * The whole-body digest is an integrity CHECKSUM, not independent
 * authenticity: it proves the body was not altered after sealing, and the
 * recomputations above prove the body was internally consistent when it was
 * sealed. Mutation authority remains the human approval capability and
 * trusted reauthorization — never this function.
 *
 * Currency checks (revision / board digest / history head / lineage / scope)
 * need the LIVE session and happen at the serialized apply position.
 */
export function verifySealedPcbEditProposalIntegrity(candidate: unknown): PcbProposalVerification {
  try {
    return verifyInner(candidate);
  } catch {
    // [B15.2 §G/R16] revoked proxies, throwing traps, and cycles refuse.
    return { ok: false, code: "malformed", detail: "The PCB proposal could not be inspected safely." };
  }
}

/**
 * [B15.2.2 §B/R23] COMPLETE closed structural validation of the whole nested
 * proposal, performed BEFORE any digest is recomputed or trusted.
 *
 * B15.2.1 checked the top-level key set, the tool identity, the digests, and
 * the impact's field shapes — but never the types or permitted values of
 * `scope`, `base`, `actor`, `effectiveActor`, `discovery`, `provenance`, or
 * the OPERATIONS themselves. Any body whose checksum was recomputed passed.
 *
 * NOTE (architectural, unchanged): the whole-body digest is an INTEGRITY
 * CHECKSUM — never authenticity and never mutation authority. Human approval
 * capability and live reauthorization remain the authority. This validation
 * closes a STRUCTURAL hole; it does not turn the checksum into a signature.
 */

const MAX_IDENTIFIER = BOUNDED_EDIT_LIMITS.maxIdentifierLength;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const MAX_DIGEST_CHARS = 256;

type ShapeResult = { ok: true } | { ok: false; detail: string };
const shapeOk: ShapeResult = { ok: true };
const shapeBad = (detail: string): ShapeResult => ({ ok: false, detail });

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Exactly these keys, no more, no fewer. */
function exactKeys(value: unknown, keys: readonly string[], label: string): ShapeResult {
  if (!isPlainRecord(value)) return shapeBad(`${label} is not a plain object.`);
  const present = Object.keys(value);
  for (const key of present) if (!keys.includes(key)) return shapeBad(`${label} carries an unknown field (${key.slice(0, 40)}).`);
  for (const key of keys) if (!(key in value)) return shapeBad(`${label} is missing ${key}.`);
  return shapeOk;
}

function boundedId(value: unknown, label: string): ShapeResult {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_IDENTIFIER || !IDENTIFIER_PATTERN.test(value)) {
    return shapeBad(`${label} is not a well-formed bounded identifier.`);
  }
  return shapeOk;
}

function boundedDigest(value: unknown, label: string): ShapeResult {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_DIGEST_CHARS) {
    return shapeBad(`${label} is not a bounded digest string.`);
  }
  return shapeOk;
}

function boundedText(value: unknown, label: string, max: number): ShapeResult {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    return shapeBad(`${label} is not a bounded non-empty string.`);
  }
  return shapeOk;
}

function safeInteger(value: unknown, label: string, min: number, max: number): ShapeResult {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value < min || value > max) {
    return shapeBad(`${label} is not a finite integer within its permitted range.`);
  }
  return shapeOk;
}

function first(...results: ShapeResult[]): ShapeResult {
  for (const result of results) if (!result.ok) return result;
  return shapeOk;
}

/** The complete nested proposal shape. Total: never throws. */
function validateProposalShape(proposal: Record<string, unknown>): ShapeResult {
  // proposalId + nonce
  const idCheck = first(
    boundedId(proposal.proposalId, "proposalId"),
    boundedId(proposal.nonce, "nonce"),
  );
  if (!idCheck.ok) return idCheck;
  if (typeof proposal.proposalId !== "string" || !proposal.proposalId.startsWith("pprop-")) {
    return shapeBad("proposalId does not carry the PCB proposal prefix.");
  }

  // scope — exact keys, all bounded identifiers
  const scopeKeys = exactKeys(proposal.scope, ["tenantId", "projectId", "branchId", "boardInstanceId"], "scope");
  if (!scopeKeys.ok) return scopeKeys;
  const scope = proposal.scope as Record<string, unknown>;
  const scopeTypes = first(
    boundedId(scope.tenantId, "scope.tenantId"),
    boundedId(scope.projectId, "scope.projectId"),
    boundedId(scope.branchId, "scope.branchId"),
    boundedId(scope.boardInstanceId, "scope.boardInstanceId"),
  );
  if (!scopeTypes.ok) return scopeTypes;

  // base + canonicalResource + historyHead + lineageId
  const baseKeys = exactKeys(proposal.base, ["canonicalResource", "pcbRevisionId", "boardDigest", "historyHead", "lineageId"], "base");
  if (!baseKeys.ok) return baseKeys;
  const base = proposal.base as Record<string, unknown>;
  const resourceKeys = exactKeys(base.canonicalResource, ["resourceId", "contentDigest"], "base.canonicalResource");
  if (!resourceKeys.ok) return resourceKeys;
  const resource = base.canonicalResource as Record<string, unknown>;
  const headKeys = exactKeys(base.historyHead, ["sequence", "label"], "base.historyHead");
  if (!headKeys.ok) return headKeys;
  const head = base.historyHead as Record<string, unknown>;
  const baseTypes = first(
    boundedId(resource.resourceId, "base.canonicalResource.resourceId"),
    boundedDigest(resource.contentDigest, "base.canonicalResource.contentDigest"),
    boundedDigest(base.pcbRevisionId, "base.pcbRevisionId"),
    boundedDigest(base.boardDigest, "base.boardDigest"),
    safeInteger(head.sequence, "base.historyHead.sequence", 0, Number.MAX_SAFE_INTEGER),
    boundedId(base.lineageId, "base.lineageId"),
  );
  if (!baseTypes.ok) return baseTypes;
  if (head.label !== null && (typeof head.label !== "string" || head.label.length > BOUNDED_EDIT_LIMITS.maxStringLength)) {
    return shapeBad("base.historyHead.label must be null or a bounded string.");
  }

  // validationPolicy — [B15.3] exact closed shape, then INTEGRITY-pinned
  // against the canonical in-repo preset registry: the named preset must
  // exist, its version must match, and the sealed rules digest must equal
  // the digest RECOMPUTED from the registry's rules for that preset. A
  // proposal compiled under rules that no longer match its named preset
  // refuses — stale policy can never verify.
  const policyKeys = exactKeys(proposal.validationPolicy, ["presetId", "presetVersion", "rulesDigest", "compileSchema"], "validationPolicy");
  if (!policyKeys.ok) return policyKeys;
  const policy = proposal.validationPolicy as Record<string, unknown>;
  const policyTypes = first(
    boundedId(policy.presetId, "validationPolicy.presetId"),
    safeInteger(policy.presetVersion, "validationPolicy.presetVersion", 0, Number.MAX_SAFE_INTEGER),
    boundedDigest(policy.rulesDigest, "validationPolicy.rulesDigest"),
  );
  if (!policyTypes.ok) return policyTypes;
  if (policy.compileSchema !== BOUNDED_EDIT_COMPILE_SCHEMA) {
    return shapeBad("validationPolicy.compileSchema is not the authoritative bounded-edit compile schema.");
  }
  const resolvedPolicy = resolvePcbValidationPolicy(policy.presetId as string);
  if (!resolvedPolicy) return shapeBad("validationPolicy names an unknown DRC validation preset.");
  if (resolvedPolicy.policy.presetVersion !== policy.presetVersion) {
    return shapeBad("validationPolicy.presetVersion does not match the canonical preset registry.");
  }
  if (resolvedPolicy.policy.rulesDigest !== policy.rulesDigest) {
    return shapeBad("validationPolicy.rulesDigest does not match the canonical rules for its named preset.");
  }

  // intent + operations — through the CANONICAL bounded-operation parser, so
  // every sealed operation is proven to be a supported, normalized operation.
  const parsed = parseBoundedEditRequest({ intent: proposal.intent, operations: proposal.operations });
  if (!parsed.ok) return shapeBad(`operations are not a valid bounded edit request (${parsed.refusal.code}: ${parsed.refusal.detail})`);
  if (JSON.stringify(parsed.request.operations) !== JSON.stringify(proposal.operations)) {
    return shapeBad("operations are not in their canonical normalized form.");
  }

  // digests
  const digests = first(
    boundedDigest(proposal.operationsDigest, "operationsDigest"),
    boundedDigest(proposal.candidateDigest, "candidateDigest"),
    boundedDigest(proposal.impactDigest, "impactDigest"),
  );
  if (!digests.ok) return digests;

  // mintedObjectIds — bounded, unique, well-formed. [B15.2.3] length-first
  // snapshot so a lying proxy length can never drive unbounded iteration.
  const minted = boundedSnapshot(proposal.mintedObjectIds, "mintedObjectIds", BOUNDED_EDIT_LIMITS.maxArrayLength);
  if (!minted.ok) return shapeBad(minted.detail);
  const mintedSeen = new Set<string>();
  for (const entry of minted.entries) {
    const ok = boundedId(entry, "mintedObjectIds entry");
    if (!ok.ok) return ok;
    if (mintedSeen.has(entry as string)) return shapeBad("mintedObjectIds contains a duplicate.");
    mintedSeen.add(entry as string);
  }

  // impact — [B15.2.3 R24] the complete CLOSED impact-certificate contract,
  // aligned with the producer, including one summary line per operation.
  const impactShape = validateImpactShape(proposal.impact, parsed.request.operations.length);
  if (!impactShape.ok) return shapeBad(impactShape.detail);

  // tool / actor / effectiveActor / discovery / provenance
  const toolKeys = exactKeys(proposal.tool, ["toolId", "version"], "tool");
  if (!toolKeys.ok) return toolKeys;
  const tool = proposal.tool as Record<string, unknown>;
  if (tool.toolId !== PCB_EDIT_PROPOSAL_TOOL_ID || tool.version !== PCB_EDIT_PROPOSAL_TOOL_VERSION) {
    return shapeBad("tool does not name the one identity permitted to seal bounded PCB edits.");
  }
  for (const key of ["actor", "effectiveActor"] as const) {
    const actorKeys = exactKeys(proposal[key], ["actorId", "kind"], key);
    if (!actorKeys.ok) return actorKeys;
    const actor = proposal[key] as Record<string, unknown>;
    const actorTypes = first(boundedId(actor.actorId, `${key}.actorId`), boundedId(actor.kind, `${key}.kind`));
    if (!actorTypes.ok) return actorTypes;
  }

  // authorizationBinding — [B16.0.1 §E] exact closed shape, the exact
  // authorization schema, bounded principal/revision, scope AGREEMENT with the
  // proposal scope, a permitted apply role, and principalId === the verified
  // effectiveActor. A legacy proposal without this field refuses at the closed
  // key set above; a tampered binding refuses here (before any digest trust).
  const authzKeys = exactKeys(
    proposal.authorizationBinding,
    ["authorizationSchema", "principalId", "membershipRevision", "tenantId", "projectId", "branchId", "requiredApplyRole"],
    "authorizationBinding",
  );
  if (!authzKeys.ok) return authzKeys;
  const authz = proposal.authorizationBinding as Record<string, unknown>;
  if (authz.authorizationSchema !== PCB_PROPOSAL_AUTHORIZATION_SCHEMA) {
    return shapeBad("authorizationBinding.authorizationSchema is not the authoritative PCB proposal authorization schema.");
  }
  const authzTypes = first(
    boundedId(authz.principalId, "authorizationBinding.principalId"),
    boundedId(authz.membershipRevision, "authorizationBinding.membershipRevision"),
    boundedId(authz.tenantId, "authorizationBinding.tenantId"),
    boundedId(authz.projectId, "authorizationBinding.projectId"),
    boundedId(authz.branchId, "authorizationBinding.branchId"),
  );
  if (!authzTypes.ok) return authzTypes;
  if (!(PCB_APPLY_ROLES as readonly string[]).includes(authz.requiredApplyRole as string)) {
    return shapeBad("authorizationBinding.requiredApplyRole is not a permitted PCB apply role.");
  }
  const boundScope = proposal.scope as Record<string, unknown>;
  if (authz.tenantId !== boundScope.tenantId || authz.projectId !== boundScope.projectId || authz.branchId !== boundScope.branchId) {
    return shapeBad("authorizationBinding scope does not match the proposal scope.");
  }
  if (authz.principalId !== (proposal.effectiveActor as Record<string, unknown>).actorId) {
    return shapeBad("authorizationBinding.principalId does not match the verified effective actor.");
  }

  const discoveryKeys = exactKeys(proposal.discovery, ["digest", "contextDigest"], "discovery");
  if (!discoveryKeys.ok) return discoveryKeys;
  const discovery = proposal.discovery as Record<string, unknown>;
  const discoveryTypes = first(
    boundedDigest(discovery.digest, "discovery.digest"),
    boundedDigest(discovery.contextDigest, "discovery.contextDigest"),
  );
  if (!discoveryTypes.ok) return discoveryTypes;
  const provenanceKeys = exactKeys(proposal.provenance, ["provider", "model", "runId"], "provenance");
  if (!provenanceKeys.ok) return provenanceKeys;
  const provenance = proposal.provenance as Record<string, unknown>;
  const provenanceTypes = first(
    boundedText(provenance.provider, "provenance.provider", BOUNDED_EDIT_LIMITS.maxStringLength),
    boundedText(provenance.model, "provenance.model", BOUNDED_EDIT_LIMITS.maxStringLength),
  );
  if (!provenanceTypes.ok) return provenanceTypes;
  if (provenance.runId !== null) {
    const runId = boundedId(provenance.runId, "provenance.runId");
    if (!runId.ok) return runId;
  }

  // times + tier
  const times = first(
    safeInteger(proposal.createdAt, "createdAt", 0, Number.MAX_SAFE_INTEGER),
    safeInteger(proposal.expiresAt, "expiresAt", 0, Number.MAX_SAFE_INTEGER),
  );
  if (!times.ok) return times;
  if (proposal.approvalTier !== PCB_EDIT_APPROVAL_TIER) return shapeBad("approvalTier was altered.");
  return shapeOk;
}

/**
 * [B15.2.3 R24] The CLOSED impact-certificate contract, aligned with the one
 * authoritative producer (`compileBoundedPcbEdit`):
 *
 * - `impact.schema` must be exactly `BOUNDED_EDIT_COMPILE_SCHEMA`;
 * - exact key sets at every nested boundary (impact, drc, connectivity,
 *   routingCompletion, readiness) — unknown or missing keys refuse;
 * - every count is a finite, safe, nonnegative integer; routed ≤ total and
 *   `unrouted === total - routed` on both sides; percentages are finite
 *   within 0–100; `delta === afterPercent - beforePercent` exactly, under
 *   the producer's own IEEE subtraction (deterministically reproducible);
 * - every array is bounded by the PRODUCER-exported
 *   `BOUNDED_EDIT_IMPACT_LIMITS`, with per-entry contracts (bounded ids for
 *   object/violation/layer ids, bounded strings for text, safe nonnegative
 *   integers for net ids);
 * - set-produced arrays carry the producer's canonical order — strictly
 *   ascending (unique + sorted): changedObjectIds, newViolationIds,
 *   resolvedViolationIds lexically; affectedNetIds numerically;
 *   affectedLayers lexically. `operationSummaries`, `ruleChanges` and
 *   `warnings` keep SUBMITTED order (semantically meaningful) and are never
 *   sort-checked; operationSummaries carries exactly one line per operation;
 * - readiness is exactly `{ state: "unavailable", reason: <bounded text> }`;
 * - array lengths are validated BEFORE any element is read, so a proxy that
 *   lies about its length can never drive unbounded iteration.
 *
 * This remains STRUCTURAL validation feeding an integrity checksum — never
 * authenticity, never mutation authority.
 */

const IMPACT_MAX_ENTRIES = BOUNDED_EDIT_IMPACT_LIMITS.maxArrayEntries;
const IMPACT_MAX_TEXT = BOUNDED_EDIT_IMPACT_LIMITS.maxTextLength;

const IMPACT_KEYS = [
  "schema", "changedObjectIds", "operationSummaries", "drc", "connectivity",
  "routingCompletion", "readiness", "ruleChanges", "affectedNetIds",
  "affectedLayers", "candidateBoardDigest", "warnings",
] as const;
const IMPACT_DRC_KEYS = [
  "beforeErrors", "afterErrors", "beforeWarnings", "afterWarnings",
  "newViolationIds", "resolvedViolationIds",
] as const;
const IMPACT_CONNECTIVITY_KEYS = [
  "beforeRoutedNets", "afterRoutedNets", "beforeTotalNets", "afterTotalNets",
  "beforeUnrouted", "afterUnrouted", "beforeShorts", "afterShorts",
] as const;
const IMPACT_ROUTING_KEYS = ["beforePercent", "afterPercent", "delta"] as const;
const IMPACT_READINESS_KEYS = ["state", "reason"] as const;

type SnapshotResult = { ok: true; entries: unknown[] } | { ok: false; detail: string };

/**
 * Hostile-safe bounded array snapshot: the length is read ONCE and validated
 * BEFORE any element access, so a lying `length` trap can never drive
 * unbounded iteration, and later trap behavior cannot change what was
 * validated (checks below run on the snapshot).
 */
function boundedSnapshot(value: unknown, label: string, maxEntries: number): SnapshotResult {
  if (!Array.isArray(value)) return { ok: false, detail: `${label} is not an array.` };
  const length: unknown = (value as { length: unknown }).length;
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 || length > maxEntries) {
    return { ok: false, detail: `${label} is not a bounded array (at most ${maxEntries} entries).` };
  }
  const entries: unknown[] = [];
  for (let index = 0; index < length; index += 1) entries.push((value as unknown[])[index]);
  return { ok: true, entries };
}

/** Producer sets are emitted `[...set].sort()` — strictly ascending ⇒ unique + sorted. */
function ascendingStrings(entries: readonly unknown[], label: string): ShapeResult {
  for (let index = 1; index < entries.length; index += 1) {
    if (!((entries[index - 1] as string) < (entries[index] as string))) {
      return shapeBad(`${label} is not unique and sorted in the producer's canonical order.`);
    }
  }
  return shapeOk;
}

function ascendingNumbers(entries: readonly unknown[], label: string): ShapeResult {
  for (let index = 1; index < entries.length; index += 1) {
    if (!((entries[index - 1] as number) < (entries[index] as number))) {
      return shapeBad(`${label} is not unique and numerically sorted in the producer's canonical order.`);
    }
  }
  return shapeOk;
}

function boundedCount(value: unknown, label: string): ShapeResult {
  return safeInteger(value, label, 0, Number.MAX_SAFE_INTEGER);
}

function boundedPercent(value: unknown, label: string): ShapeResult {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    return shapeBad(`${label} is not a finite percentage within 0–100.`);
  }
  return shapeOk;
}

function boundedIdArray(value: unknown, label: string, sorted: boolean): ShapeResult {
  const snapshot = boundedSnapshot(value, label, IMPACT_MAX_ENTRIES);
  if (!snapshot.ok) return shapeBad(snapshot.detail);
  for (const entry of snapshot.entries) {
    const ok = boundedId(entry, `${label} entry`);
    if (!ok.ok) return ok;
  }
  return sorted ? ascendingStrings(snapshot.entries, label) : shapeOk;
}

function boundedTextArray(value: unknown, label: string): ShapeResult {
  const snapshot = boundedSnapshot(value, label, IMPACT_MAX_ENTRIES);
  if (!snapshot.ok) return shapeBad(snapshot.detail);
  for (const entry of snapshot.entries) {
    const ok = boundedText(entry, `${label} entry`, IMPACT_MAX_TEXT);
    if (!ok.ok) return ok;
  }
  return shapeOk;
}

/** The complete closed impact-certificate shape. Total: never throws on plain data. */
function validateImpactShape(impact: unknown, operationCount: number): ShapeResult {
  const impactKeys = exactKeys(impact, IMPACT_KEYS, "impact");
  if (!impactKeys.ok) return impactKeys;
  const record = impact as Record<string, unknown>;

  // The exact authoritative compile schema — never merely "a string".
  if (record.schema !== BOUNDED_EDIT_COMPILE_SCHEMA) {
    return shapeBad("impact.schema is not the authoritative bounded-edit compile schema.");
  }

  // changedObjectIds — bounded ids, producer-canonical: unique + lexically sorted.
  const changed = boundedIdArray(record.changedObjectIds, "impact.changedObjectIds", true);
  if (!changed.ok) return changed;

  // operationSummaries — SUBMITTED order (never sort-checked); the producer
  // emits exactly one line per operation.
  const summaries = boundedSnapshot(record.operationSummaries, "impact.operationSummaries", IMPACT_MAX_ENTRIES);
  if (!summaries.ok) return shapeBad(summaries.detail);
  if (summaries.entries.length !== operationCount) {
    return shapeBad("impact.operationSummaries does not carry exactly one line per sealed operation.");
  }
  for (const entry of summaries.entries) {
    const ok = boundedText(entry, "impact.operationSummaries entry", IMPACT_MAX_TEXT);
    if (!ok.ok) return ok;
  }

  // drc — exact keys, safe nonnegative counts, canonical sorted violation ids.
  const drcKeys = exactKeys(record.drc, IMPACT_DRC_KEYS, "impact.drc");
  if (!drcKeys.ok) return drcKeys;
  const drc = record.drc as Record<string, unknown>;
  const drcCounts = first(
    boundedCount(drc.beforeErrors, "impact.drc.beforeErrors"),
    boundedCount(drc.afterErrors, "impact.drc.afterErrors"),
    boundedCount(drc.beforeWarnings, "impact.drc.beforeWarnings"),
    boundedCount(drc.afterWarnings, "impact.drc.afterWarnings"),
    boundedIdArray(drc.newViolationIds, "impact.drc.newViolationIds", true),
    boundedIdArray(drc.resolvedViolationIds, "impact.drc.resolvedViolationIds", true),
  );
  if (!drcCounts.ok) return drcCounts;

  // connectivity — exact keys, safe nonnegative counts, and the producer's
  // arithmetic: routed ≤ total, unrouted === total − routed (exact on safe
  // integers) on both sides.
  const connectivityKeys = exactKeys(record.connectivity, IMPACT_CONNECTIVITY_KEYS, "impact.connectivity");
  if (!connectivityKeys.ok) return connectivityKeys;
  const connectivity = record.connectivity as Record<string, unknown>;
  const connectivityCounts = first(
    ...IMPACT_CONNECTIVITY_KEYS.map((key) => boundedCount(connectivity[key], `impact.connectivity.${key}`)),
  );
  if (!connectivityCounts.ok) return connectivityCounts;
  const beforeRouted = connectivity.beforeRoutedNets as number;
  const afterRouted = connectivity.afterRoutedNets as number;
  const beforeTotal = connectivity.beforeTotalNets as number;
  const afterTotal = connectivity.afterTotalNets as number;
  if (beforeRouted > beforeTotal || afterRouted > afterTotal) {
    return shapeBad("impact.connectivity reports more routed nets than total nets.");
  }
  if (connectivity.beforeUnrouted !== beforeTotal - beforeRouted || connectivity.afterUnrouted !== afterTotal - afterRouted) {
    return shapeBad("impact.connectivity unrouted counts do not equal total minus routed.");
  }

  // routingCompletion — finite 0–100 percentages; delta is EXACTLY the
  // producer's own subtraction (IEEE-deterministic), bounded to ±100.
  const routingKeys = exactKeys(record.routingCompletion, IMPACT_ROUTING_KEYS, "impact.routingCompletion");
  if (!routingKeys.ok) return routingKeys;
  const routing = record.routingCompletion as Record<string, unknown>;
  const percents = first(
    boundedPercent(routing.beforePercent, "impact.routingCompletion.beforePercent"),
    boundedPercent(routing.afterPercent, "impact.routingCompletion.afterPercent"),
  );
  if (!percents.ok) return percents;
  const delta = routing.delta;
  if (typeof delta !== "number" || !Number.isFinite(delta) || delta < -100 || delta > 100
    || delta !== (routing.afterPercent as number) - (routing.beforePercent as number)) {
    return shapeBad("impact.routingCompletion.delta is not exactly afterPercent minus beforePercent within ±100.");
  }

  // readiness — exactly { state: "unavailable", reason } [B15.1 §F].
  const readinessKeys = exactKeys(record.readiness, IMPACT_READINESS_KEYS, "impact.readiness");
  if (!readinessKeys.ok) return readinessKeys;
  const readiness = record.readiness as Record<string, unknown>;
  if (readiness.state !== "unavailable") {
    return shapeBad("impact.readiness.state must be exactly \"unavailable\" — the compiler never certifies readiness.");
  }
  const reason = boundedText(readiness.reason, "impact.readiness.reason", IMPACT_MAX_TEXT);
  if (!reason.ok) return reason;

  // ruleChanges + warnings — SUBMITTED order, bounded text.
  const texts = first(
    boundedTextArray(record.ruleChanges, "impact.ruleChanges"),
    boundedTextArray(record.warnings, "impact.warnings"),
  );
  if (!texts.ok) return texts;

  // affectedNetIds — finite, safe, nonnegative INTEGERS (never NaN, Infinity
  // or fractions), producer-canonical: unique + numerically sorted.
  const netIds = boundedSnapshot(record.affectedNetIds, "impact.affectedNetIds", IMPACT_MAX_ENTRIES);
  if (!netIds.ok) return shapeBad(netIds.detail);
  for (const entry of netIds.entries) {
    const ok = safeInteger(entry, "impact.affectedNetIds entry", 0, Number.MAX_SAFE_INTEGER);
    if (!ok.ok) return ok;
  }
  const netOrder = ascendingNumbers(netIds.entries, "impact.affectedNetIds");
  if (!netOrder.ok) return netOrder;

  // affectedLayers — bounded layer identifiers, producer-canonical: unique +
  // lexically sorted. (Board membership needs the LIVE board and is enforced
  // at compile and at the serialized apply position.)
  const layers = boundedIdArray(record.affectedLayers, "impact.affectedLayers", true);
  if (!layers.ok) return layers;

  // candidateBoardDigest — bounded digest string; its EQUALITY with the
  // top-level candidateDigest is preserved at its existing later position.
  return boundedDigest(record.candidateBoardDigest, "impact.candidateBoardDigest");
}

function verifyInner(candidate: unknown): PcbProposalVerification {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    return { ok: false, code: "malformed", detail: "The PCB proposal is not an object." };
  }
  const proposal = candidate as Record<string, unknown>;
  // [B16.0.1] a LEGACY v1 artifact refuses FIRST with its precise code: v1
  // predates the §E membership authorization binding, so it can never carry
  // (and must never be backfilled with) membership authority.
  if (proposal.schema === PCB_EDIT_PROPOSAL_SCHEMA_V1) {
    return { ok: false, code: "legacy-authorization-missing", detail: "This is a v1 bounded PCB-edit proposal; v1 predates the membership authorization binding and can no longer be applied. Regenerate the proposal." };
  }
  if (proposal.schema !== PCB_EDIT_PROPOSAL_SCHEMA) {
    return { ok: false, code: "wrong-version", detail: "This artifact is not a current sealed bounded PCB-edit proposal." };
  }
  for (const key of Object.keys(proposal)) {
    if (!(PCB_EDIT_PROPOSAL_KEYS as readonly string[]).includes(key)) {
      return { ok: false, code: "malformed", detail: `The PCB proposal carries an unknown field (${key.slice(0, 40)}).` };
    }
  }
  for (const key of PCB_EDIT_PROPOSAL_KEYS) {
    if (proposal[key] === undefined) {
      return { ok: false, code: "malformed", detail: `The PCB proposal is missing the required field (${key}).` };
    }
  }
  if (proposal.approvalTier !== PCB_EDIT_APPROVAL_TIER) {
    return { ok: false, code: "altered", detail: "The PCB proposal's approval tier was altered." };
  }
  const sealed = proposal as unknown as SealedPcbEditProposal;

  // [B15.2.2 §B/R23] the COMPLETE nested shape is validated BEFORE any digest
  // is recomputed or trusted — exact key sets, types, bounds, permitted
  // values, and every operation through the canonical bounded parser.
  const shape = validateProposalShape(proposal);
  if (!shape.ok) return { ok: false, code: "malformed", detail: shape.detail };

  // [R7] the tool identity is EXACT — a foreign tool can never seal one.
  if (sealed.tool?.toolId !== PCB_EDIT_PROPOSAL_TOOL_ID || sealed.tool?.version !== PCB_EDIT_PROPOSAL_TOOL_VERSION) {
    return { ok: false, code: "altered", detail: "The PCB proposal names a tool identity that cannot seal bounded PCB edits." };
  }
  // [R7] the certified candidate digest must AGREE with the impact report.
  if (sealed.candidateDigest !== sealed.impact?.candidateBoardDigest) {
    return { ok: false, code: "altered", detail: "The PCB proposal's candidate digest disagrees with its impact report." };
  }
  // [R7] RECOMPUTE the digests the seal claims to certify.
  const recomputedOperations = engineeringDigest({
    schema: NORMALIZED_OPS_DIGEST_SCHEMA,
    base: sealed.base?.pcbRevisionId,
    operations: sealed.operations,
  });
  if (recomputedOperations !== sealed.operationsDigest) {
    return { ok: false, code: "altered", detail: "The PCB proposal's operations digest does not match its operations." };
  }
  const recomputedImpact = engineeringDigest({ schema: IMPACT_DIGEST_SCHEMA, impact: sealed.impact });
  if (recomputedImpact !== sealed.impactDigest) {
    return { ok: false, code: "altered", detail: "The PCB proposal's impact digest does not match its impact report." };
  }
  // Time relationship and TTL ceiling.
  if (typeof sealed.createdAt !== "number" || typeof sealed.expiresAt !== "number"
    || !Number.isFinite(sealed.createdAt) || !Number.isFinite(sealed.expiresAt)
    || sealed.expiresAt <= sealed.createdAt
    || sealed.expiresAt - sealed.createdAt > PCB_EDIT_PROPOSAL_TTL_MS) {
    return { ok: false, code: "altered", detail: "The PCB proposal's validity window is malformed or exceeds the maximum TTL." };
  }
  // Minted ids must be a subset of the impact's changed objects.
  const changed = new Set(sealed.impact?.changedObjectIds ?? []);
  for (const minted of sealed.mintedObjectIds ?? []) {
    if (!changed.has(minted)) {
      return { ok: false, code: "altered", detail: "The PCB proposal claims a minted object its impact report does not change." };
    }
  }
  const { proposalId, ...body } = sealed as unknown as Record<string, unknown>;
  const recomputed = `pprop-${engineeringDigest({ schema: IDENTITY_DIGEST_SCHEMA, body }).slice(5, 21)}`;
  if (recomputed !== proposalId) {
    return { ok: false, code: "altered", detail: "The PCB proposal's sealed identity does not match its contents." };
  }
  return { ok: true };
}

export function isPcbEditProposalExpired(proposal: SealedPcbEditProposal, now: number): boolean {
  return now >= proposal.expiresAt;
}
