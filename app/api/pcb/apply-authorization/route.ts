/**
 * POST /api/pcb/apply-authorization — B16.0.1 §F apply-time reauthorization.
 *
 * The ONE narrow, same-origin, READ-ONLY endpoint the PCB approval controller
 * consults immediately before minting a bounded-edit apply capability. It
 * reloads the caller's LIVE project membership from server-owned storage and
 * returns a bounded authorization snapshot: the verified principal id, the
 * server-derived role, and the membership revision the role was resolved at.
 *
 * It performs NO mutation, holds NO apply/commit authority, and is never
 * provider-callable — it only reports who the caller currently is and what
 * their live membership says. The caller compares this against the proposal's
 * sealed §E authorization binding and refuses the apply on any divergence.
 *
 * [B16.0.14 §E] Migrated to the canonical `selectorEnvelopeJsonRoute`. The body
 * carries ONLY a project/branch SELECTOR, never authority: same-origin CSRF is
 * enforced BEFORE the (64 KB / 10 s) bounded read; then the selector is
 * validated and handed to the canonical trusted-context path, which verifies
 * identity, loads LIVE membership, and derives the role SERVER-SIDE. Caller-
 * supplied role/actor/principal/membershipRevision are ignored. Unauthenticated
 * ⇒ 401; no/revoked membership or foreign project ⇒ 403 — a logged-out or
 * removed author fails closed. See the wrapper's truthful-ordering note: full
 * membership authorization necessarily happens AFTER the selector exists.
 */

import { selectorEnvelopeJsonRoute } from "@/app/lib/auth/route-handlers";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 64_000;
/** [B16.0.2 §D] hard total deadline on receiving the (small) selector body. */
const BODY_DEADLINE_MS = 10_000;

export const POST = selectorEnvelopeJsonRoute(
  { maxBytes: MAX_BODY_BYTES, deadlineMs: BODY_DEADLINE_MS },
  async ({ context }): Promise<Response> => {
    return Response.json(
      {
        ok: true,
        principalId: context.principalId,
        role: context.actor.role,
        membershipRevision: context.membershipRevision,
        scope: { tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  },
);
