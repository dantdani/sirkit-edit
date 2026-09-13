/**
 * /api/bom/notifications — [B16.0.2 §B] project-owned notifications.
 *
 * GET    ?unreadOnly=true|false         → list (dismissed excluded) for the
 *        caller's trusted project scope
 * PATCH  { id, readAt?, dismissedAt? }   → mark ONE notification OWNED by the
 *        caller's scope (a foreign/legacy id is a uniform 404, never touched)
 *        { markAllRead: true }           → mark all unread in the caller's scope
 * DELETE { olderThan? }                  → bulk cleanup inside the caller's scope
 *
 * The body may carry NO projectKey / tenant / project / branch / actor claim
 * (refused); ownership is the server-derived trusted scope, always.
 */

import { resolveBomRepository } from "@/app/lib/bom/snapshot-repository";
import { bomFailure } from "../_failure"; // [B19-B I2] a failure is reported, never repeated
import { authenticatedJsonRoute, authenticatedRoute } from "@/app/lib/auth/route-handlers";
import { BOM_FORBIDDEN_BODY_KEYS, bomNotFound, bomOwnershipScope } from "../_scope";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 16_000;
const BODY_DEADLINE_MS = 10_000;

function forbiddenClaim(body: Record<string, unknown>): Response | null {
  for (const key of BOM_FORBIDDEN_BODY_KEYS) {
    if (key in body) return Response.json({ ok: false, code: "AUTH_AUTHORITATIVE_INPUT_FORBIDDEN", error: `\`${key}\` is server-derived and may not be supplied.` }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  return null;
}

// [B16.0.11] canonical wrapper — the callback sees ONLY the bounded, frozen
// query projection (meta.query), never the raw URL or Request.
export const GET = authenticatedRoute({ query: true }, async ({ context, meta }): Promise<Response> => {
  const scope = bomOwnershipScope(context);
  const unreadOnly = meta.query?.unreadOnly === "true";
  try {
    const notifications = await resolveBomRepository().listNotifications(scope, { unreadOnly, limit: 200 });
    return Response.json({ ok: true, notifications }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return bomFailure("api/bom/notifications", err);
  }
});

/** Coerce an incoming timestamp value (ISO string / null) to a Date or null. */
function toDate(v: unknown): Date | null {
  if (v === null) return null;
  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export const PATCH = authenticatedJsonRoute({ maxBytes: MAX_BODY_BYTES, deadlineMs: BODY_DEADLINE_MS }, async ({ context, body }): Promise<Response> => {
  const scope = bomOwnershipScope(context);
  const claim = forbiddenClaim(body);
  if (claim) return claim;

  try {
    const repo = resolveBomRepository();

    // Bulk "mark all as read" — inside the caller's trusted scope only.
    if (body.markAllRead === true) {
      const updated = await repo.markAllNotificationsRead(scope, new Date());
      return Response.json({ ok: true, updated }, { headers: { "Cache-Control": "no-store" } });
    }

    if (typeof body.id !== "string" || body.id.trim() === "") {
      return Response.json({ ok: false, error: "`id` is required." }, { status: 400 });
    }

    const patch: { readAt?: Date | null; dismissedAt?: Date | null } = {};
    if ("readAt" in body) patch.readAt = body.readAt === undefined ? new Date() : toDate(body.readAt);
    if ("dismissedAt" in body) patch.dismissedAt = body.dismissedAt === undefined ? new Date() : toDate(body.dismissedAt);
    if (Object.keys(patch).length === 0) {
      return Response.json({ ok: false, error: "Nothing to update." }, { status: 400 });
    }

    // The predicate is (id AND full trusted scope): a foreign or legacy row is
    // never updated and is reported as a uniform 404.
    const changed = await repo.updateNotification(scope, body.id, patch);
    if (!changed) return bomNotFound("Notification");
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return bomFailure("api/bom/notifications", err);
  }
});

// [B16.0.11 §B] DELETE reads a bounded JSON body — the corrected target is
// authenticatedJsonRoute (current behavior is authoritative).
export const DELETE = authenticatedJsonRoute({ maxBytes: MAX_BODY_BYTES, deadlineMs: BODY_DEADLINE_MS }, async ({ context, body }): Promise<Response> => {
  const scope = bomOwnershipScope(context);
  const claim = forbiddenClaim(body);
  if (claim) return claim;

  try {
    const olderThan = toDate(body.olderThan);
    const deleted = await resolveBomRepository().deleteNotifications(scope, olderThan ? { olderThan } : {});
    return Response.json({ ok: true, deleted }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return bomFailure("api/bom/notifications", err);
  }
});
