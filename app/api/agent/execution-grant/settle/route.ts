/**
 * [B18-B] `POST /api/agent/execution-grant/settle` — the browser reports what
 * the canonical executor did with a CONSUMED grant. The report is recorded as
 * `browser-attested` (the commit authority is the editor's serialized
 * executor); the server binds it to the SAME attempt and commitment it
 * consumed, refuses everything else, accepts the truthful late `committed`
 * after a lazy `consumed_unsettled` retirement, and answers the awaiting chat
 * run from the settled record only. Closed body; the actor is the trusted
 * principal and must own the grant.
 */
import { authenticatedJsonRoute } from "@/app/lib/auth/route-handlers";
import { resolveExecutionGrantStore } from "@/app/lib/execution-grant/store";
import { settleExecutionGrant, type SettleRequest } from "@/app/lib/execution-grant/settle";
import { SETTLEMENT_OUTCOMES, isAttemptId, isGrantId } from "@/app/lib/engineering/execution-grant";
import { ENGINEERING_DIGEST_PATTERN as DIGEST, EXECUTION_GRANT_AUTHORITY_SHAPED_KEYS } from "@/app/lib/execution-grant/route-contract";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const BODY_KEYS: ReadonlySet<string> = new Set(["grantId", "grantDigest", "attemptId", "commitment", "settlement"]);
const SETTLEMENT_KEYS: ReadonlySet<string> = new Set(["outcome", "transactionId", "revisionBefore", "revisionAfter", "headSequenceAfter", "changeSetDigest", "receiptDigest", "validations", "undoEligible"]);
const MAX_ID = 200;

function refusal(status: number, code: string, error: string, extra: Record<string, unknown> = {}): Response {
  return Response.json({ ok: false, code, error, ...extra }, { status, headers: NO_STORE });
}
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const nullableString = (value: unknown, max = MAX_ID): value is string | null => value === null || (typeof value === "string" && value.length > 0 && value.length <= max);
const nullableInteger = (value: unknown): value is number | null => value === null || (Number.isSafeInteger(value) && (value as number) >= 0);

export function parseSettleRequest(body: Record<string, unknown>): { ok: true; request: SettleRequest } | { ok: false; response: Response } {
  const keys = Object.keys(body);
  const claims = keys.filter((key) => EXECUTION_GRANT_AUTHORITY_SHAPED_KEYS.has(key)).sort();
  if (claims.length > 0) return { ok: false, response: refusal(400, "EXECUTION_GRANT_AUTHORITY_CLAIM", "The request carries an authority-shaped key; the actor and the grant's binding come only from the trusted session and the stored grant.", { fields: claims }) };
  const unknown = keys.filter((key) => !BODY_KEYS.has(key)).sort();
  if (unknown.length > 0) return { ok: false, response: refusal(400, "EXECUTION_GRANT_UNKNOWN_FIELD", "The request carries an undeclared key.", { fields: unknown }) };
  if (!isGrantId(body.grantId) || typeof body.grantDigest !== "string" || !DIGEST.test(body.grantDigest) || !isAttemptId(body.attemptId) || typeof body.commitment !== "string" || !DIGEST.test(body.commitment)) {
    return { ok: false, response: refusal(400, "EXECUTION_GRANT_BODY_INVALID", "grantId, grantDigest, attemptId and commitment must be the handles the grant was consumed with.") };
  }
  const s = body.settlement;
  if (!isRecord(s)) return { ok: false, response: refusal(400, "EXECUTION_GRANT_BODY_INVALID", "settlement must be an object.") };
  const settlementUnknown = Object.keys(s).filter((key) => !SETTLEMENT_KEYS.has(key)).sort();
  if (settlementUnknown.length > 0) return { ok: false, response: refusal(400, "EXECUTION_GRANT_UNKNOWN_FIELD", "The settlement carries an undeclared key.", { fields: settlementUnknown }) };
  if (typeof s.outcome !== "string" || !(SETTLEMENT_OUTCOMES as readonly string[]).includes(s.outcome)) return { ok: false, response: refusal(400, "EXECUTION_GRANT_BODY_INVALID", `settlement.outcome must be one of ${SETTLEMENT_OUTCOMES.join(", ")}.`) };
  if (typeof s.undoEligible !== "boolean") return { ok: false, response: refusal(400, "EXECUTION_GRANT_BODY_INVALID", "settlement.undoEligible must be a boolean.") };
  const transactionId = s.transactionId ?? null, revisionBefore = s.revisionBefore ?? null, revisionAfter = s.revisionAfter ?? null, headSequenceAfter = s.headSequenceAfter ?? null, changeSetDigest = s.changeSetDigest ?? null, receiptDigest = s.receiptDigest ?? null, validations = s.validations ?? null;
  if (!nullableString(transactionId) || !nullableString(revisionBefore) || !nullableString(revisionAfter) || !nullableInteger(headSequenceAfter) || !nullableString(changeSetDigest) || !nullableString(receiptDigest)) {
    return { ok: false, response: refusal(400, "EXECUTION_GRANT_BODY_INVALID", "settlement identifiers must be bounded strings (or null) and headSequenceAfter an integer (or null).") };
  }
  let drc: SettleRequest["settlement"]["validations"] = null;
  if (validations !== null) {
    if (!isRecord(validations) || Object.keys(validations).join(",") !== "drc" || !isRecord(validations.drc) || Object.keys(validations.drc).sort().join(",") !== "ran,violations" || typeof validations.drc.ran !== "boolean" || !Number.isSafeInteger(validations.drc.violations) || (validations.drc.violations as number) < 0) {
      return { ok: false, response: refusal(400, "EXECUTION_GRANT_BODY_INVALID", "settlement.validations must be { drc: { ran, violations } } or null.") };
    }
    drc = { drc: { ran: validations.drc.ran, violations: validations.drc.violations as number } };
  }
  if (s.outcome === "committed" && (transactionId === null || revisionAfter === null)) return { ok: false, response: refusal(400, "EXECUTION_GRANT_BODY_INVALID", "A committed settlement must name the transaction and the revision after.") };
  return { ok: true, request: { grantId: body.grantId, grantDigest: body.grantDigest, attemptId: body.attemptId, commitment: body.commitment, settlement: { outcome: s.outcome as SettleRequest["settlement"]["outcome"], transactionId, revisionBefore, revisionAfter, headSequenceAfter, changeSetDigest, receiptDigest, validations: drc, undoEligible: s.undoEligible } } };
}

export const POST = authenticatedJsonRoute({ maxBytes: 16_384, deadlineMs: 10_000 }, async ({ context, body }): Promise<Response> => {
  const parsed = parseSettleRequest(body);
  if (!parsed.ok) return parsed.response;
  if (context.actor.actorKind !== "human") return refusal(403, "EXECUTION_GRANT_HUMAN_REQUIRED", "Only the human session principal the grant was issued to may settle it.");
  try {
    const outcome = await settleExecutionGrant({ store: resolveExecutionGrantStore(), scope: { tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId }, principalId: context.principalId, now: Date.now(), request: parsed.request });
    if (outcome.ok) return Response.json({ ok: true, grant: outcome.grant, idempotent: outcome.idempotent, late: outcome.late }, { headers: NO_STORE });
    switch (outcome.status) {
      case "forged": return refusal(404, "EXECUTION_GRANT_UNKNOWN", "Unknown grant.");
      case "invalid_settlement": return refusal(400, "EXECUTION_GRANT_BODY_INVALID", outcome.message);
      case "not_consumed": case "wrong_attempt": case "wrong_commitment": case "terminal": case "conflict":
        return refusal(409, `EXECUTION_GRANT_${outcome.status.toUpperCase()}`, outcome.message, { grant: outcome.grant });
      default: return refusal(503, "EXECUTION_GRANT_UNAVAILABLE", "The stored grant could not be verified; nothing was changed.");
    }
  } catch {
    return refusal(503, "EXECUTION_GRANT_UNAVAILABLE", "The execution grant store is unavailable; nothing was changed.");
  }
});
