/**
 * [B18-B] `/api/agent/execution-grant` — the one-shot CONSUMPTION of a
 * server-minted execution grant (D18-9) and the owner's read of it.
 *
 *  GET  ?grantId=…  the caller's OWN grant (public projection, lazy expiry
 *                   applied); a foreign or unknown id is 404 — the route is
 *                   never an existence oracle.
 *  POST             tender (burn) or cancel a grant the caller was issued.
 *
 * Nothing here mints: grants come only from the `/api/chat` composition root
 * (app/lib/execution-grant/mint.ts). The canonical wrapper proves the
 * principal, the ACTIVE membership and the role (policy rows: pcb_editor /
 * project_admin; same-origin CSRF on POST) BEFORE these callbacks. The
 * callback re-binds the grant to the SAME principal, session and membership
 * revision, refuses forged handles with zero writes, and burns an issued grant
 * exactly once with the exact retirement reason when any later check fails.
 * Nothing in the body can name an actor, role, capability, scope, decision or
 * explicitness — those come from the trusted context and the stored grant.
 */
import { authenticatedJsonRoute, authenticatedRoute } from "@/app/lib/auth/route-handlers";
import { resolveAgentAutonomyRepository } from "@/app/lib/agent/autonomy-store";
import { resolveExecutionGrantStore } from "@/app/lib/execution-grant/store";
import { consumeExecutionGrant, loadOwnGrant, type ConsumeRequest, type ConsumeTender } from "@/app/lib/execution-grant/consume";
import { CANCEL_RETIREMENT_REASONS, isAttemptId, isGrantId } from "@/app/lib/engineering/execution-grant";
import { ENGINEERING_DIGEST_PATTERN as DIGEST, EXECUTION_GRANT_AUTHORITY_SHAPED_KEYS } from "@/app/lib/execution-grant/route-contract";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const TENDER_KEYS: ReadonlySet<string> = new Set(["kind", "grantId", "grantDigest", "attemptId", "tender"]);
const CANCEL_KEYS: ReadonlySet<string> = new Set(["kind", "grantId", "grantDigest", "reason"]);
const TENDER_BLOCK_KEYS: ReadonlySet<string> = new Set(["operationsDigest", "commitment", "confirmation", "live"]);
const LIVE_KEYS: ReadonlySet<string> = new Set(["pcbRevisionId", "headSequence", "lineageId", "selectionDigest"]);
// [B18-D review 2, B18-E E2] the retirement names what happened: the user's cancel, a replaced session or preview, the editor's
// checks refusing it, or the drift itself — one shared vocabulary (CANCEL_RETIREMENT_REASONS, inside the closed
// RETIREMENT_REASONS). A cancel retires only an ISSUED grant (a consumed one retires only with the consumed reasons — the store
// refuses the rest).
const CANCEL_REASONS: ReadonlySet<string> = new Set(CANCEL_RETIREMENT_REASONS);
const MAX_ID = 200;

function refusal(status: number, code: string, error: string, extra: Record<string, unknown> = {}): Response {
  return Response.json({ ok: false, code, error, ...extra }, { status, headers: NO_STORE });
}
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const optionalString = (value: unknown, max = MAX_ID): value is string | null | undefined => value === undefined || value === null || (typeof value === "string" && value.length > 0 && value.length <= max);
const optionalInteger = (value: unknown): value is number | null | undefined => value === undefined || value === null || (Number.isSafeInteger(value) && (value as number) >= 0);

function authorityShaped(keys: string[]): string[] {
  return keys.filter((key) => EXECUTION_GRANT_AUTHORITY_SHAPED_KEYS.has(key)).sort();
}

/** The closed request grammar: exactly one of the two kinds, every key declared, every value bounded. */
export function parseExecutionGrantRequest(body: Record<string, unknown>): { ok: true; request: ConsumeRequest } | { ok: false; response: Response } {
  const keys = Object.keys(body);
  const claims = authorityShaped(keys);
  if (claims.length > 0) return { ok: false, response: refusal(400, "EXECUTION_GRANT_AUTHORITY_CLAIM", "The request carries an authority-shaped key; the actor, role, membership, scope and decision come only from the trusted session and the stored grant.", { fields: claims }) };
  if (body.kind !== "tender" && body.kind !== "cancel") return { ok: false, response: refusal(400, "EXECUTION_GRANT_BODY_INVALID", "kind must be tender or cancel.") };
  const allowed = body.kind === "tender" ? TENDER_KEYS : CANCEL_KEYS;
  const unknown = keys.filter((key) => !allowed.has(key)).sort();
  if (unknown.length > 0) return { ok: false, response: refusal(400, "EXECUTION_GRANT_UNKNOWN_FIELD", "The request carries an undeclared key.", { fields: unknown }) };
  if (!isGrantId(body.grantId) || typeof body.grantDigest !== "string" || !DIGEST.test(body.grantDigest)) return { ok: false, response: refusal(400, "EXECUTION_GRANT_BODY_INVALID", "grantId and grantDigest must be the handle the grant was issued with.") };
  if (body.kind === "cancel") {
    if (typeof body.reason !== "string" || !CANCEL_REASONS.has(body.reason)) return { ok: false, response: refusal(400, "EXECUTION_GRANT_BODY_INVALID", `reason must be one of ${[...CANCEL_REASONS].join(", ")}.`) };
    return { ok: true, request: { kind: "cancel", grantId: body.grantId, grantDigest: body.grantDigest, reason: body.reason as Extract<ConsumeRequest, { kind: "cancel" }>["reason"] } };
  }
  if (!isAttemptId(body.attemptId)) return { ok: false, response: refusal(400, "EXECUTION_GRANT_BODY_INVALID", "attemptId must be the prepared attempt id.") };
  const tender = body.tender;
  if (!isRecord(tender)) return { ok: false, response: refusal(400, "EXECUTION_GRANT_BODY_INVALID", "tender must be an object.") };
  const tenderClaims = authorityShaped(Object.keys(tender));
  if (tenderClaims.length > 0) return { ok: false, response: refusal(400, "EXECUTION_GRANT_AUTHORITY_CLAIM", "The tender carries an authority-shaped key.", { fields: tenderClaims }) };
  const tenderUnknown = Object.keys(tender).filter((key) => !TENDER_BLOCK_KEYS.has(key)).sort();
  if (tenderUnknown.length > 0) return { ok: false, response: refusal(400, "EXECUTION_GRANT_UNKNOWN_FIELD", "The tender carries an undeclared key.", { fields: tenderUnknown }) };
  if (typeof tender.operationsDigest !== "string" || !DIGEST.test(tender.operationsDigest)) return { ok: false, response: refusal(400, "EXECUTION_GRANT_BODY_INVALID", "tender.operationsDigest must be the operations digest of the grant's proposal.") };
  if (typeof tender.commitment !== "string" || !DIGEST.test(tender.commitment)) return { ok: false, response: refusal(400, "EXECUTION_GRANT_BODY_INVALID", "tender.commitment must be the prepared commitment digest.") };
  let confirmation: ConsumeTender["confirmation"] = null;
  if (tender.confirmation !== undefined && tender.confirmation !== null) {
    const c = tender.confirmation;
    if (!isRecord(c) || Object.keys(c).sort().join(",") !== "actionId,previewDigest" || typeof c.actionId !== "string" || c.actionId.length === 0 || c.actionId.length > MAX_ID || typeof c.previewDigest !== "string" || !DIGEST.test(c.previewDigest)) {
      return { ok: false, response: refusal(400, "EXECUTION_GRANT_BODY_INVALID", "tender.confirmation must be { actionId, previewDigest } or null.") };
    }
    confirmation = { actionId: c.actionId, previewDigest: c.previewDigest };
  }
  let live: ConsumeTender["live"] = null;
  if (tender.live !== undefined && tender.live !== null) {
    const l = tender.live;
    if (!isRecord(l) || Object.keys(l).some((key) => !LIVE_KEYS.has(key)) || !optionalString(l.pcbRevisionId) || !optionalInteger(l.headSequence) || !optionalString(l.lineageId) || !optionalString(l.selectionDigest)) {
      return { ok: false, response: refusal(400, "EXECUTION_GRANT_BODY_INVALID", "tender.live may carry only pcbRevisionId, headSequence, lineageId and selectionDigest.") };
    }
    live = { pcbRevisionId: l.pcbRevisionId ?? null, headSequence: l.headSequence ?? null, lineageId: l.lineageId ?? null, selectionDigest: l.selectionDigest ?? null };
  }
  return { ok: true, request: { kind: "tender", grantId: body.grantId, grantDigest: body.grantDigest, attemptId: body.attemptId, tender: { operationsDigest: tender.operationsDigest, commitment: tender.commitment, confirmation, live } } };
}

export const GET = authenticatedRoute({ query: true }, async ({ context, meta }): Promise<Response> => {
  const grantId = meta.query?.grantId;
  if (!isGrantId(grantId)) return refusal(400, "EXECUTION_GRANT_BODY_INVALID", "grantId must be the handle the grant was issued with.");
  try {
    const grant = await loadOwnGrant(resolveExecutionGrantStore(), { tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId }, context.principalId, grantId, Date.now());
    if (!grant) return refusal(404, "EXECUTION_GRANT_UNKNOWN", "Unknown grant.");
    return Response.json({ ok: true, grant }, { headers: NO_STORE });
  } catch {
    return refusal(503, "EXECUTION_GRANT_UNAVAILABLE", "The execution grant store is unavailable; nothing was read.");
  }
});

export const POST = authenticatedJsonRoute({ maxBytes: 65_536, deadlineMs: 10_000 }, async ({ context, body }): Promise<Response> => {
  const parsed = parseExecutionGrantRequest(body);
  if (!parsed.ok) return parsed.response;
  // Human truth: only the session principal the grant was issued to may tender it (workers and agents never do) — refused before any store read.
  if (context.actor.actorKind !== "human") return refusal(403, "EXECUTION_GRANT_HUMAN_REQUIRED", "Only the human session principal the grant was issued to may tender or cancel it.");
  const scope = { tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId };
  try {
    const outcome = await consumeExecutionGrant({
      store: resolveExecutionGrantStore(), scope,
      principal: { principalId: context.principalId, role: context.actor.role, membershipRevision: context.membershipRevision, sessionIdentity: context.sessionIdentity, actorKind: context.actor.actorKind },
      autonomy: () => resolveAgentAutonomyRepository().get({ tenantId: context.tenantId, projectId: context.projectId }),
      now: Date.now(), request: parsed.request,
    });
    if (outcome.ok) {
      if ("cancelled" in outcome) return Response.json({ ok: true, cancelled: true, grant: outcome.grant }, { headers: NO_STORE });
      return Response.json({ ok: true, grant: outcome.grant, consumption: outcome.consumption, live: outcome.live, idempotent: outcome.idempotent }, { headers: NO_STORE });
    }
    switch (outcome.status) {
      case "forged": return refusal(404, "EXECUTION_GRANT_UNKNOWN", "Unknown grant.");
      case "replayed": return refusal(409, "EXECUTION_GRANT_REPLAYED", outcome.message, { grant: outcome.grant });
      case "terminal": return refusal(409, "EXECUTION_GRANT_TERMINAL", outcome.message, { grant: outcome.grant });
      case "retired": return refusal(409, "EXECUTION_GRANT_RETIRED", outcome.message, { reason: outcome.reason, grant: outcome.grant });
      case "conflict": return refusal(409, "EXECUTION_GRANT_CONFLICT", outcome.message, { reason: outcome.reason, grant: outcome.grant });
      default: return refusal(503, "EXECUTION_GRANT_UNAVAILABLE", "The stored grant could not be verified; nothing was changed.");
    }
  } catch {
    return refusal(503, "EXECUTION_GRANT_UNAVAILABLE", "The execution grant store is unavailable; nothing was changed.");
  }
});
