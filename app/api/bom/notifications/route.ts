/**
 * /api/bom/notifications
 *
 * GET    ?projectKey=...&unreadOnly=true|false  → list (dismissed excluded)
 * PATCH  { id, readAt?, dismissedAt? }           → mark one read/dismissed
 *        { projectKey, markAllRead: true }        → mark all unread as read
 * DELETE { projectKey, olderThan? }              → bulk cleanup
 */

import { and, desc, eq, isNull, lt } from "drizzle-orm";
import { getDb } from "@/app/lib/db/client";
import { bomNotifications } from "@/app/lib/db/schema";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const projectKey = params.get("projectKey")?.trim() ?? "";
  if (projectKey === "") {
    return Response.json({ ok: false, error: "`projectKey` is required." }, { status: 400 });
  }
  const unreadOnly = params.get("unreadOnly") === "true";

  try {
    const where = unreadOnly
      ? and(
          eq(bomNotifications.projectKey, projectKey),
          isNull(bomNotifications.dismissedAt),
          isNull(bomNotifications.readAt),
        )
      : and(eq(bomNotifications.projectKey, projectKey), isNull(bomNotifications.dismissedAt));

    const notifications = await getDb()
      .select()
      .from(bomNotifications)
      .where(where)
      .orderBy(desc(bomNotifications.createdAt))
      .limit(200);

    return Response.json({ ok: true, notifications });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}

type PatchBody = {
  id?: unknown;
  projectKey?: unknown;
  markAllRead?: unknown;
  readAt?: unknown;
  dismissedAt?: unknown;
};

/** Coerce an incoming timestamp value (ISO string / null) to a Date or null. */
function toDate(v: unknown): Date | null {
  if (v === null) return null;
  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export async function PATCH(req: Request): Promise<Response> {
  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const db = getDb();

    // Bulk "mark all as read" for a project.
    if (body.markAllRead === true && typeof body.projectKey === "string") {
      await db
        .update(bomNotifications)
        .set({ readAt: new Date() })
        .where(
          and(eq(bomNotifications.projectKey, body.projectKey), isNull(bomNotifications.readAt)),
        );
      return Response.json({ ok: true });
    }

    if (typeof body.id !== "string") {
      return Response.json({ ok: false, error: "`id` is required." }, { status: 400 });
    }

    const patch: { readAt?: Date | null; dismissedAt?: Date | null } = {};
    if ("readAt" in body) patch.readAt = body.readAt === undefined ? new Date() : toDate(body.readAt);
    if ("dismissedAt" in body) {
      patch.dismissedAt = body.dismissedAt === undefined ? new Date() : toDate(body.dismissedAt);
    }
    if (Object.keys(patch).length === 0) {
      return Response.json({ ok: false, error: "Nothing to update." }, { status: 400 });
    }

    await db.update(bomNotifications).set(patch).where(eq(bomNotifications.id, body.id));
    return Response.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}

type DeleteBody = { projectKey?: unknown; olderThan?: unknown };

export async function DELETE(req: Request): Promise<Response> {
  let body: DeleteBody;
  try {
    body = (await req.json()) as DeleteBody;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.projectKey !== "string" || body.projectKey.trim() === "") {
    return Response.json({ ok: false, error: "`projectKey` is required." }, { status: 400 });
  }

  try {
    const olderThan = toDate(body.olderThan);
    const where = olderThan
      ? and(eq(bomNotifications.projectKey, body.projectKey), lt(bomNotifications.createdAt, olderThan))
      : eq(bomNotifications.projectKey, body.projectKey);
    await getDb().delete(bomNotifications).where(where);
    return Response.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
