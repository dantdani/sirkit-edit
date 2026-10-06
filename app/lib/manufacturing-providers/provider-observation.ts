/**
 * [B23-B3] Steps 6 to 8 of B23-B (runbook :980-982; D23-17, D23-5's staleness half; OD-168, OD-169, OD-185): what a provider's
 * answer may become inside Sirkit.
 *  - Step 6, an EXTERNAL OBSERVATION, never Sirkit proof. An acknowledged attempt of B2's durable record `mfg.provider-exchange.v1`
 *    (`exchange-ledger.ts`; never a raw body: none is stored) becomes a closed `manufacturing_observation` record: the source identity
 *    (provider, operation, receipt id, registry version and row digest, transfer descriptor version), `retrievedAt`, the terms (what
 *    Sirkit keeps of the answer, and the provider's own terms for what Sirkit sends), the freshness, the package and release digests
 *    and the bounded normalized fields, each provider string screened as untrusted (`provider-text-screen.ts`) and withheld whole when
 *    it fails. [B23-B3 review, 2026-10-04] The provider's receipt id is provider text too (security-1): screened alone and first in the
 *    joined reading, null in `source` and named `source.providerReceiptId` in `withheld` when it fails; the observation id still hashes
 *    it. `terms.answerLicense` states what Sirkit may do with the ANSWER: UNKNOWN until a provider's terms are read (coverage-6). An
 *    answer whose provider row a reviewed registry revision withdrew stays listed, stale (`descriptor_moved`) (coverage-2).
 *    `sirkitVerdict` is always `none`: a provider's "accepted" or "pass" is shown as the provider's words and sets nothing;
 *    no readiness, qualification, release or assembled-claim path reaches this module but through GET /api/pcb-sync's composition
 *    root (`b23-b-observation` case 6).
 *  - Step 7, STALENESS (OD-168). Stale at the provider's stated validity (`validUntil`, an instant), else 24 hours after
 *    `retrievedAt`; and at once when the authority head or the release ledger head moves, the board revision OR its authoritative
 *    digest moves (recomputed from the loaded board by the caller, never the pcbSyncDigest a board read carries: D23-17), the board is
 *    superseded or gone, the registry row or the reviewed transfer descriptor moves, the capability profile moves, or the rule-profile
 *    evidence is not a v2 profile's, is expired or is older than 366 days: B1's step-1 checks (`revalidateReleaseAuthority`,
 *    `app/api/pcb/release/route.ts`) as of the read. A stale observation stays listed and labelled stale; it is never current.
 *  - Step 8, NO AUTO-ACCEPT (OD-169). A provider's substitution or design-change suggestion is a closed `providerSuggestion`: shown,
 *    never applied. This module is data and pure functions over an injected read port (`load`): it imports no command, executor or
 *    mutation module, and nothing in it or after it turns a suggestion into a command (`b23-b-no-auto-accept`).
 * The reader is composed by GET /api/pcb-sync (read-only, scoped to the request's project and board, no provider call).
 */
import { durableWorkflowDigest } from "../durable-workflow/stable";
import { MANUFACTURING_RULE_PROFILE_SCHEMA, type ManufacturingRuleProfileEvidence } from "../pcb/fab/release-manifest";
import { ruleProfileEvidenceStatus } from "../pcb/fab/rule-profile";
import { compareCodePoints } from "../stable-compare";
import type { ExchangeAggregate, ExchangeAttempt } from "./exchange-ledger";
import { PROVIDER_REGISTRY_VERSION, PROVIDER_ROWS, type Fact, type ProviderRow } from "./provider-registry";
import { screenProviderText, screenProviderTextsTogether, type ProviderTextScreenReason } from "./provider-text-screen";

export const MANUFACTURING_OBSERVATION_SCHEMA = "sirkit.manufacturing-observation.v1" as const;
export const MANUFACTURING_OBSERVATION_CLASS = "manufacturing_observation" as const;
/** The words every observation is shown with. */
export const MANUFACTURING_OBSERVATION_LABEL = "external observation, not Sirkit proof" as const;
export const PROVIDER_SUGGESTION_SCHEMA = "sirkit.provider-suggestion.v1" as const;
/** OD-168: without a stated validity, an observation is stale this long after `retrievedAt`. */
export const OBSERVATION_DEFAULT_FRESHNESS_MS = 24 * 60 * 60_000;
/** The release route's `RELEASE_PROFILE_EVIDENCE_MAX_AGE_MS` (pinned equal by `b23-b-stale-quote` case 8; that route module composes durable stores at load, so it is not imported here). */
export const OBSERVATION_PROFILE_EVIDENCE_MAX_AGE_MS = 366 * 24 * 60 * 60 * 1000;
/** The kept field a provider states its validity in (an instant); a reviewed transfer descriptor names it among its receipt fields. */
export const OBSERVATION_VALIDITY_FIELD = "validUntil";
/** At most this many observations are listed, newest first; the rest are counted. */
export const OBSERVATION_LIST_MAX = 32;
/** Why an observation is stale (closed), in the order they are reported. */
export const OBSERVATION_STALE_REASONS = Object.freeze(["expired", "authority_unavailable", "authority_moved", "release_unavailable", "ledger_head_moved", "board_unavailable", "board_superseded", "board_revision_moved", "board_digest_moved", "descriptor_moved", "profile_moved", "profile_evidence_invalid", "profile_evidence_expired", "profile_evidence_too_old"] as const);
export type ObservationStaleReason = (typeof OBSERVATION_STALE_REASONS)[number];

/** A reviewed transfer descriptor's identity and version. */
export interface TransferVersion { readonly providerId: string; readonly operationId: string; readonly version: string }
/**
 * The reviewed transfer descriptors' versions: `provider-egress.ts`'s `PROVIDER_TRANSFER_DESCRIPTORS`, none in B23, mirrored here
 * because that module reaches the egress boundary and GET /api/pcb-sync must not (`b23-b-stale-quote` case 7 pins the two equal).
 * With none, no observation can be current in production: its transfer descriptor is not a reviewed one.
 */
export const REVIEWED_TRANSFER_VERSIONS: readonly TransferVersion[] = Object.freeze([]);
/**
 * [B23-B3 review, 2026-10-04] coverage-2: the ids of providers a reviewed registry revision removed from `PROVIDER_ROWS`. Append-only:
 * the revision that removes a row appends its id here, so the answers B2 recorded for it stay listed (stale, `descriptor_moved`) and
 * never vanish; `b23-b-stale-quote` case 12 pins the ids the reader loads as a list that never shrinks. None in B23.
 */
export const OBSERVATION_WITHDRAWN_PROVIDER_IDS: readonly string[] = Object.freeze([]);
/** [B23-B3 review, 2026-10-04] coverage-2: the name an observation shows for a provider whose row is not in the registry it is judged against. */
export const OBSERVATION_UNLISTED_PROVIDER_NAME = "not in the provider registry";
/** [B23-B3 review, 2026-10-04] coverage-6: runbook `:140`'s licensing half for the ANSWER (the registry's `outboundTerms` cover only what Sirkit sends). */
export const OBSERVATION_ANSWER_LICENSE = "UNKNOWN: no provider's terms for what Sirkit may keep, show or pass on of its answers were read (the registry records only the terms for what Sirkit sends; no provider is admitted, OD-160, LB-11)";
/** [B23-B3 review, 2026-10-04] security-1: the name a withheld receipt id is listed under (no kept field can take it: field names hold no '.'). */
export const OBSERVATION_RECEIPT_FIELD = "source.providerReceiptId";
/**
 * The providers whose records the reader loads: [B23-B3 review, 2026-10-04] coverage-2: every registry row, whatever its operations' tiers
 * (a re-tiered operation leaves its recorded answers readable), and every withdrawn id; was: only rows with a `dfm_quote_transfer`
 * operation, so a re-tiered or removed row's answers vanished instead of reading stale.
 */
export const OBSERVATION_PROVIDER_IDS: readonly string[] = Object.freeze([...new Set<string>([...PROVIDER_ROWS.map((row) => row.id), ...OBSERVATION_WITHDRAWN_PROVIDER_IDS])]);

export interface ObservationField { readonly name: string; readonly value: string | number | boolean }
export type ObservationWithheldReason = ProviderTextScreenReason | "joined_directive";
export interface ObservationWithheld { readonly name: string; readonly reason: ObservationWithheldReason }
/** OD-169: a provider's suggestion - shown, never applied. */
export interface ProviderSuggestion {
  readonly schema: typeof PROVIDER_SUGGESTION_SCHEMA;
  readonly kind: "substitution" | "design_change";
  /** the kept field it came in */
  readonly field: string;
  /** its value when the screen let it through; null when withheld */
  readonly text: string | number | boolean | null;
  readonly withheld: ObservationWithheldReason | null;
  readonly disposition: "shown_never_applied";
}
export interface ManufacturingObservation {
  readonly schema: typeof MANUFACTURING_OBSERVATION_SCHEMA;
  readonly observationClass: typeof MANUFACTURING_OBSERVATION_CLASS;
  readonly label: typeof MANUFACTURING_OBSERVATION_LABEL;
  /** a provider's answer never sets a Sirkit verdict */
  readonly sirkitVerdict: "none";
  readonly observationId: string;
  readonly purpose: "dfm" | "quote";
  /** [B23-B3 review, 2026-10-04] `providerReceiptId` is null when the screen withheld it (security-1); `displayName` is `OBSERVATION_UNLISTED_PROVIDER_NAME` for a withdrawn row (coverage-2) */
  readonly source: { readonly providerId: string; readonly displayName: string; readonly operationId: string; readonly providerReceiptId: string | null; readonly registryVersion: string; readonly registryDigest: string; readonly transferVersion: string };
  readonly retrievedAt: string;
  /** what Sirkit keeps of the answer (the exchange record's retention), and the provider's terms for what Sirkit sends (the registry row); [B23-B3 review, 2026-10-04] coverage-6: and under what licence Sirkit may keep, show or pass on the answer (`answerLicense`, UNKNOWN in B23) */
  readonly terms: { readonly kept: "normalized" | "ids_digests_timestamps_only"; readonly providerRetention: string; readonly providerConfidentiality: string; readonly answerLicense: string };
  readonly freshness: { readonly basis: "provider_stated" | "default_24h"; readonly providerValidUntil: string | null; readonly staleAt: string };
  readonly digests: { readonly releaseId: string; readonly archiveSha256: string; readonly outboundPackageDigest: string; readonly requestSha256: string; readonly responseSha256: string };
  readonly capabilityProfile: { readonly profileId: string; readonly version: number };
  readonly fields: readonly ObservationField[];
  readonly withheld: readonly ObservationWithheld[];
  readonly suggestions: readonly ProviderSuggestion[];
}
export type ObservationNormalization = { readonly ok: true; readonly observation: ManufacturingObservation } | { readonly ok: false; readonly reason: "not_an_answer" | "invalid" }; // [B23-B3 review, 2026-10-04] coverage-2: was also "provider_unknown"; a withdrawn row's answer is an observation, stale

/** What an observation is judged against, read by the caller at the same instant (GET /api/pcb-sync's summary). */
export interface ObservationCurrent {
  readonly now: string;
  /** the authority head: its revision and record digest, its board revision and digest, and its stored rule profile */
  readonly authority: null | { readonly revision: number; readonly recordDigest: string; readonly boardRevision: string; readonly boardDigest: string; readonly profile: unknown };
  /** the release ledger's head record */
  readonly latestRelease: null | { readonly releaseId: string; readonly archiveSha256: string; readonly authorityRecordDigest: string; readonly authorityRevision: number; readonly boardRevision: string; readonly boardDigest: string };
  /** the loaded board: its revision, its authoritative digest RECOMPUTED from it (`authoritativeBoardDigest`), and its lineage state */
  readonly board: null | { readonly revision: string; readonly authoritativeDigest: string; readonly superseded: boolean };
}
export interface ObservationStaleness { readonly stale: boolean; readonly reasons: readonly ObservationStaleReason[] }
export interface ManufacturingObservationView extends ManufacturingObservation { readonly stale: boolean; readonly staleReasons: readonly ObservationStaleReason[] }
export interface ManufacturingObservationList { readonly items: readonly ManufacturingObservationView[]; readonly omitted: number }
/** The one read the reader makes: B2's record, re-verified on load (the route composes the durable record). */
export interface ObservationExchangeSource { load(aggregate: ExchangeAggregate): Promise<{ readonly revision: number; readonly attempts: readonly ExchangeAttempt[] } | null> }
export interface ObservationScope { readonly tenantId: string; readonly projectId: string; readonly branchId: string; readonly designId: string; readonly boardId: string }
export type ManufacturingObservationReader = (scope: ObservationScope, current: ObservationCurrent) => Promise<ManufacturingObservationList | null>;

const FIELD_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
/** OD-185: a kept field whose name says it suggests, substitutes, recommends or replaces is a provider suggestion. */
const SUGGESTION_NAME = /suggest|substitut|alternat|recommend|replace/i;
const SUBSTITUTION_NAME = /substitut|alternat|replace/i;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
const factText = (fact: Fact): string => (typeof fact === "string" ? fact : `UNKNOWN: ${fact.reason}`);
/** [B23-B3 review, 2026-10-04] coverage-2: a withdrawn row's terms are no longer on record. */
const UNLISTED_TERMS = "UNKNOWN: the provider's registry row is not in the registry this observation is judged against, so its terms are not on record";

/** Step 6: an acknowledged attempt of B2's record as a closed observation, every provider string screened. Pure; never throws. */
export function normalizeManufacturingObservation(input: { readonly aggregate: ExchangeAggregate; readonly attempt: ExchangeAttempt; readonly registry?: readonly ProviderRow[] }): ObservationNormalization {
  const { aggregate, attempt } = input;
  if (attempt.state !== "acknowledged" || attempt.receipt === null || attempt.response === null || attempt.request === null) return { ok: false, reason: "not_an_answer" };
  // [B23-B3 review, 2026-10-04] coverage-2: a row a reviewed registry revision withdrew still names its answers (stale: descriptor_moved); was: refused
  const row = (input.registry ?? PROVIDER_ROWS).find((candidate) => candidate.id === aggregate.providerId);
  const retrieved = Date.parse(attempt.receipt.retrievedAt);
  if (!Number.isFinite(retrieved)) return { ok: false, reason: "invalid" };
  // every kept field, by name: a scalar shown, a string only past the screen; then the strings shown together, read across their joins
  const shown: ObservationField[] = [];
  const withheld: ObservationWithheld[] = [];
  // [B23-B3 review, 2026-10-04] security-1: the receipt id is the provider's own string (its answer's id field): screened like a field
  const receiptId = attempt.receipt.providerReceiptId;
  const receiptReason = screenProviderText(receiptId);
  if (receiptReason !== null) withheld.push({ name: OBSERVATION_RECEIPT_FIELD, reason: receiptReason });
  for (const [name, value] of Object.entries(attempt.normalized).sort(([a], [b]) => compareCodePoints(a, b))) {
    if (!FIELD_NAME.test(name)) continue;
    if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) { shown.push({ name, value }); continue; }
    const reason = screenProviderText(value);
    if (reason === null) shown.push({ name, value: value as string });
    else withheld.push({ name, reason });
  }
  const strings = shown.filter((field) => typeof field.value === "string" && field.value !== "");
  // [B23-B3 review, 2026-10-04] security-1: the receipt id first, as the panel shows it (its source line precedes the fields)
  if (screenProviderTextsTogether([...(receiptReason === null ? [receiptId] : []), ...strings.map((field) => field.value as string)]) !== "clean") {
    if (receiptReason === null) withheld.push({ name: OBSERVATION_RECEIPT_FIELD, reason: "joined_directive" });
    for (const field of strings) withheld.push({ name: field.name, reason: "joined_directive" });
  }
  const receiptShown = !withheld.some((entry) => entry.name === OBSERVATION_RECEIPT_FIELD);
  const together = new Set(withheld.map((entry) => entry.name));
  const visible = shown.filter((field) => !together.has(field.name));
  withheld.sort((a, b) => compareCodePoints(a.name, b.name));
  // OD-169: a suggestion is its own closed record, shown and never applied
  const suggestionNames = new Set([...visible.map((field) => field.name), ...withheld.map((entry) => entry.name)].filter((name) => SUGGESTION_NAME.test(name)));
  const suggestions: ProviderSuggestion[] = [...suggestionNames].sort(compareCodePoints).map((name) => {
    const field = visible.find((candidate) => candidate.name === name);
    return { schema: PROVIDER_SUGGESTION_SCHEMA, kind: SUBSTITUTION_NAME.test(name) ? "substitution" : "design_change", field: name, text: field ? field.value : null, withheld: withheld.find((entry) => entry.name === name)?.reason ?? null, disposition: "shown_never_applied" };
  });
  const stated = attempt.normalized[OBSERVATION_VALIDITY_FIELD];
  const statedAt = typeof stated === "string" && INSTANT.test(stated) ? Date.parse(stated) : Number.NaN;
  const providerValidUntil = Number.isFinite(statedAt) ? new Date(statedAt).toISOString() : null;
  const observation: ManufacturingObservation = {
    schema: MANUFACTURING_OBSERVATION_SCHEMA,
    observationClass: MANUFACTURING_OBSERVATION_CLASS,
    label: MANUFACTURING_OBSERVATION_LABEL,
    sirkitVerdict: "none",
    observationId: `mfg-observation-${durableWorkflowDigest({ ...aggregate.scope, designId: aggregate.designId, boardId: aggregate.boardId, providerId: aggregate.providerId, idempotencyKey: attempt.idempotencyKey, providerReceiptId: attempt.receipt.providerReceiptId }).slice(4)}`,
    purpose: attempt.purpose,
    source: { providerId: aggregate.providerId, displayName: row ? row.displayName : OBSERVATION_UNLISTED_PROVIDER_NAME, operationId: attempt.operationId, providerReceiptId: receiptShown ? receiptId : null, registryVersion: attempt.descriptor.registryVersion, registryDigest: attempt.descriptor.registryDigest, transferVersion: attempt.descriptor.transferVersion }, // [B23-B3 review, 2026-10-04] security-1, coverage-2
    retrievedAt: attempt.receipt.retrievedAt,
    terms: { kept: attempt.retention, providerRetention: row ? factText(row.outboundTerms.retention) : UNLISTED_TERMS, providerConfidentiality: row ? factText(row.outboundTerms.confidentiality) : UNLISTED_TERMS, answerLicense: OBSERVATION_ANSWER_LICENSE }, // [B23-B3 review, 2026-10-04] coverage-2, coverage-6
    freshness: { basis: providerValidUntil === null ? "default_24h" : "provider_stated", providerValidUntil, staleAt: providerValidUntil ?? new Date(retrieved + OBSERVATION_DEFAULT_FRESHNESS_MS).toISOString() },
    digests: { releaseId: attempt.release.releaseId, archiveSha256: attempt.release.archiveSha256, outboundPackageDigest: attempt.outboundPackageDigest, requestSha256: attempt.request.sha256, responseSha256: attempt.response.sha256 },
    capabilityProfile: { profileId: attempt.capabilityProfile.profileId, version: attempt.capabilityProfile.version },
    fields: visible.filter((field) => !suggestionNames.has(field.name)),
    withheld: withheld.filter((entry) => !suggestionNames.has(entry.name)),
    suggestions,
  };
  return { ok: true, observation: deepFreeze(observation) };
}

/** Step 7 (OD-168): every reason `observation` is stale against `current`, in `OBSERVATION_STALE_REASONS` order. Pure; never throws. */
export function evaluateObservationStaleness(observation: ManufacturingObservation, current: ObservationCurrent, options: { readonly registry?: readonly ProviderRow[]; readonly transferVersions?: readonly TransferVersion[] } = {}): ObservationStaleness {
  const reasons = new Set<ObservationStaleReason>();
  const now = Date.parse(current.now);
  if (!Number.isFinite(now) || now >= Date.parse(observation.freshness.staleAt)) reasons.add("expired");
  const { authority, latestRelease: release, board } = current;
  if (authority === null) reasons.add("authority_unavailable");
  if (release === null) reasons.add("release_unavailable");
  else {
    if (release.releaseId !== observation.digests.releaseId || release.archiveSha256 !== observation.digests.archiveSha256) reasons.add("ledger_head_moved");
    if (authority !== null && (release.authorityRecordDigest !== authority.recordDigest || release.authorityRevision !== authority.revision)) reasons.add("authority_moved");
  }
  if (board === null) reasons.add("board_unavailable");
  else {
    if (board.superseded) reasons.add("board_superseded");
    if ((authority !== null && board.revision !== authority.boardRevision) || (release !== null && board.revision !== release.boardRevision)) reasons.add("board_revision_moved");
    if ((authority !== null && board.authoritativeDigest !== authority.boardDigest) || (release !== null && board.authoritativeDigest !== release.boardDigest)) reasons.add("board_digest_moved");
  }
  const row = (options.registry ?? PROVIDER_ROWS).find((candidate) => candidate.id === observation.source.providerId);
  const transfer = (options.transferVersions ?? REVIEWED_TRANSFER_VERSIONS).some((entry) => entry.providerId === observation.source.providerId && entry.operationId === observation.source.operationId && entry.version === observation.source.transferVersion);
  if (!row || observation.source.registryVersion !== PROVIDER_REGISTRY_VERSION || observation.source.registryDigest !== durableWorkflowDigest(row) || !transfer) reasons.add("descriptor_moved");
  if (authority !== null) {
    const profile = (authority.profile ?? {}) as { readonly schemaVersion?: unknown; readonly profileId?: unknown; readonly version?: unknown; readonly evidence?: unknown };
    if (profile.profileId !== observation.capabilityProfile.profileId || profile.version !== observation.capabilityProfile.version) reasons.add("profile_moved");
    if (profile.schemaVersion !== MANUFACTURING_RULE_PROFILE_SCHEMA) reasons.add("profile_evidence_invalid");
    else {
      const evidence = profile.evidence as ManufacturingRuleProfileEvidence | undefined;
      const status = Number.isFinite(now) ? ruleProfileEvidenceStatus(evidence, current.now) : "missing";
      if (status === "expired") reasons.add("profile_evidence_expired");
      else if (status !== "ok") reasons.add("profile_evidence_invalid");
      else if (now - Date.parse(`${evidence!.retrievedAt}T00:00:00.000Z`) > OBSERVATION_PROFILE_EVIDENCE_MAX_AGE_MS) reasons.add("profile_evidence_too_old");
    }
  }
  const ordered = OBSERVATION_STALE_REASONS.filter((reason) => reasons.has(reason));
  return { stale: ordered.length > 0, reasons: ordered };
}

/** A durable read's failure as a bounded code (B2's integrity error carries one), so the summary reports it, never a message. */
function boundedFailure(error: unknown): unknown {
  const code = (error as { readonly code?: unknown } | null)?.code;
  return typeof code === "string" && /^[A-Z0-9_]+$/.test(code) ? new Error(code) : error;
}

/**
 * The reader GET /api/pcb-sync composes: every board-file provider's exchange record for the board (read through `load` only), each
 * acknowledged answer normalised and judged stale or current against `current`, newest first, at most `OBSERVATION_LIST_MAX` listed.
 * Null when the board has no exchange record at all. Reads; writes nothing; sends nothing. [B23-B3 review, 2026-10-04] coverage-2: "every
 * board-file provider" is now every id in `OBSERVATION_PROVIDER_IDS` (every registry row, any tier, and every withdrawn id).
 */
export function createProviderObservationReader(options: { readonly exchanges: ObservationExchangeSource; readonly registry?: readonly ProviderRow[]; readonly transferVersions?: readonly TransferVersion[] }): ManufacturingObservationReader {
  const registry = options.registry ?? PROVIDER_ROWS;
  const transferVersions = options.transferVersions ?? REVIEWED_TRANSFER_VERSIONS;
  return async (scope, current) => {
    const views: ManufacturingObservationView[] = [];
    let recorded = false;
    for (const providerId of OBSERVATION_PROVIDER_IDS) {
      const aggregate: ExchangeAggregate = { scope: { tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId }, designId: scope.designId, boardId: scope.boardId, providerId };
      let loaded: Awaited<ReturnType<ObservationExchangeSource["load"]>>;
      try {
        loaded = await options.exchanges.load(aggregate);
      } catch (error) {
        throw boundedFailure(error);
      }
      if (loaded === null) continue;
      recorded = true;
      for (const attempt of loaded.attempts) {
        const normalized = normalizeManufacturingObservation({ aggregate, attempt, registry });
        if (!normalized.ok) continue;
        const staleness = evaluateObservationStaleness(normalized.observation, current, { registry, transferVersions });
        views.push(deepFreeze({ ...normalized.observation, stale: staleness.stale, staleReasons: staleness.reasons }));
      }
    }
    if (!recorded) return null;
    views.sort((a, b) => compareCodePoints(b.retrievedAt, a.retrievedAt) || compareCodePoints(a.observationId, b.observationId));
    return deepFreeze({ items: views.slice(0, OBSERVATION_LIST_MAX), omitted: Math.max(0, views.length - OBSERVATION_LIST_MAX) });
  };
}
