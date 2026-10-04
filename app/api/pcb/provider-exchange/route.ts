/**
 * POST /api/pcb/provider-exchange
 *
 * [B23-B1] The provider exchange of a ledgered deterministic release (runbook B23-B steps 1-3, :975-977; D23-6, D23-7; OD-163,
 * OD-164, OD-166, OD-174). One route, two operations named by a closed body field (OD-183):
 *  - `preview` re-runs the release route's revalidation (`revalidateReleaseAuthority`), regenerates the release from the head
 *    authority, finds it in the release ledger, derives exactly what would leave (the Gerber, Excellon and job files and a provider
 *    manifest; never the release manifest, the README, a BOM, a CPL or a distributor value) and answers a sealed plan naming the
 *    provider, the purpose and every file and field, valid for 10 minutes. It sends nothing. [B23-B1 review, 2026-10-04] The board's
 *    file-safe name, which embeds the project id, is in every file name and in the Gerber and job bytes: the plan lists such an id as
 *    carried, beside every metadata field the bytes carry, and lists as kept only an id found in no outbound name or byte.
 *  - `commit` takes the plan's id and digest, an idempotency key and the opt-in header, re-runs the revalidation and the derivation,
 *    and asks admission. No provider is admitted in B23 (no owner account, OD-160; LB-11), so every commit ends refused
 *    `provider_not_admitted` before any byte leaves. [B23-B2] Only past admission does the service send, through provider-egress.ts.
 *
 * Policy: a canonical route with `externalTransfer: true` and `spend: false`, human-only (a trusted session), CSRF, project_admin
 * only, never public (route-policy.ts; `routeVocabularyViolations`). In the callback, before any durable read: authority-shaped
 * keys are refused, then any actor but a human project administrator, then any undeclared key, then a commit without the opt-in.
 */
import { DurableManufacturingAuthorityStore } from "@/app/lib/pcb/fab/authority-store";
import { releaseManufacturingPackage } from "@/app/lib/pcb/fab/release-gate";
import { DurableManufacturingReleaseLedger } from "@/app/lib/pcb/fab/release-ledger";
import { boundedManufacturingFailure } from "@/app/lib/pcb/fab/manufacturing-errors";
import { getDurableWorkflowRepository } from "@/app/lib/durable-workflow/runtime";
import { authenticatedJsonRoute } from "@/app/lib/auth/route-handlers";
import { jsonError } from "@/app/lib/auth/request-security";
import {
  PROVIDER_EXCHANGE_COMMIT_HEADER,
  PROVIDER_EXCHANGE_COMMIT_KEYS,
  PROVIDER_EXCHANGE_COMMIT_OPT_IN,
  PROVIDER_EXCHANGE_FORBIDDEN_KEYS,
  PROVIDER_EXCHANGE_PREVIEW_KEYS,
  ProviderExchangeService,
  providerExchangeRefusal,
  type ProviderExchangePorts,
} from "@/app/lib/manufacturing-providers/provider-exchange"; import { createProviderExchangeLedger } from "@/app/lib/manufacturing-providers/exchange-ledger"; // [B23-B2] appended in place
import { PCB_SYNC_API_DEADLINE_MS, pcbSyncScopeFromContext } from "../../pcb-sync/_scope";
import { revalidateReleaseAuthority } from "../release/route";

export const runtime = "nodejs";
export const maxDuration = 300;

/** The request bodies are a few ids and pins. */
const PROVIDER_EXCHANGE_MAX_BYTES = 16_384;

/** The one process-wide plan store (in memory, OD-183). The environment is read only for admission's off-only operator switch. */
const exchanges = new ProviderExchangeService({ env: process.env });

/** The durable reads and the regeneration the service needs, over the same stores the release route uses. */
function durablePorts(correlationId: string): ProviderExchangePorts {
  const workflow = getDurableWorkflowRepository();
  const store = new DurableManufacturingAuthorityStore(workflow);
  const ledger = new DurableManufacturingReleaseLedger(workflow);
  return {
    revalidate: async (input) => {
      const answer = await revalidateReleaseAuthority({ store, ...input, correlationId });
      if (!answer.ok) return answer;
      const { stored, locator } = answer;
      return { ok: true, locator, authority: { revision: stored.revision, recordDigest: stored.recordDigest, boardRevision: stored.authority.boardRevision, boardDigest: stored.authority.boardDigest } };
    },
    regenerate: (locator) => releaseManufacturingPackage({ locator, loadAuthority: store.loader(locator) }),
    ledger: (scope) => ledger.list(scope), exchangeLedger: createProviderExchangeLedger(workflow), // [B23-B2] the durable exchange record (OD-167), over the same store
  };
}

export const POST = authenticatedJsonRoute({ maxBytes: PROVIDER_EXCHANGE_MAX_BYTES, deadlineMs: PCB_SYNC_API_DEADLINE_MS, safeHeaders: [PROVIDER_EXCHANGE_COMMIT_HEADER] }, async ({ context, body, meta }): Promise<Response> => {
  // authority-shaped keys first (the release route's order): the scope, the actor and the content are the server's, never the body's
  if (PROVIDER_EXCHANGE_FORBIDDEN_KEYS.some((key) => key in body)) return jsonError(400, "AUTH_AUTHORITATIVE_INPUT_FORBIDDEN", "The request body carries a forbidden authoritative field.");
  const scope = pcbSyncScopeFromContext(context);
  const correlationId = context.correlationId;
  const actor = { actorId: scope.actor.actorId, actorKind: scope.actor.actorKind, role: scope.actor.role };
  // a provider exchange is a human project administrator's act; refused before any durable read
  if (actor.actorKind !== "human" || actor.role !== "project_admin") return providerExchangeRefusal("PX_HUMAN_ADMIN_REQUIRED", { correlationId });
  const operation = body.operation;
  if (operation !== "preview" && operation !== "commit") return providerExchangeRefusal("PX_API_OPERATION_REQUIRED", { correlationId });
  const declared = operation === "preview" ? PROVIDER_EXCHANGE_PREVIEW_KEYS : PROVIDER_EXCHANGE_COMMIT_KEYS;
  const unknownFields = Object.keys(body).filter((key) => !declared.has(key)).sort();
  if (unknownFields.length > 0) return providerExchangeRefusal("PX_API_UNKNOWN_FIELD", { correlationId, extra: { fields: unknownFields } });
  if (operation === "commit" && meta.headers?.[PROVIDER_EXCHANGE_COMMIT_HEADER] !== PROVIDER_EXCHANGE_COMMIT_OPT_IN) return providerExchangeRefusal("PX_COMMIT_OPT_IN_REQUIRED", { correlationId });
  try {
    const request = { actor, scope: { tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId }, request: body, ports: durablePorts(correlationId), correlationId };
    const answer = operation === "preview" ? await exchanges.preview(request) : await exchanges.commit(request);
    const headers = { "Cache-Control": "no-store", "X-Sirkit-Correlation-Id": correlationId };
    if (!answer.ok) return Response.json(answer.refusal.body, { status: answer.refusal.status, headers });
    return Response.json({ ok: true, operation, sent: false, plan: answer.plan }, { headers });
  } catch (error) {
    // a thrown durable or release-gate error keeps the release route's bounded envelope (a gate code keeps its public wording)
    return boundedManufacturingFailure(error, "release", correlationId);
  }
});
