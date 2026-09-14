/**
 * POST /api/components/revision-status
 *
 * Body:  { revisionIds: string[] }   (at most 500 bounded atomic revision ids)
 * [B19-E E5] A project member reads the catalog status of the atomic revisions the project pins: published, deprecated,
 * superseded (with its successor) or revoked, whether each is selectable for a new binding and pinnable by an existing one
 * (OD-38), and "unpublished" for an id that names no published revision. A read: nothing is written and no quota is spent.
 * [B19-E E5 review] Each answer also names the first selectable revision of its successor chain (at most MAX_SUCCESSOR_HOPS
 * further status reads, one per hop for all ids).
 *
 * Canonical wrapper: authorization (member + exact-origin CSRF) -> media -> bounded body (16 KB / 10 s); the body is closed and
 * every id must match the replacement-authority REVISION_PATTERN before the catalog is read. A failure answers one fixed
 * sentence.
 */
import { authenticatedJsonRoute } from "@/app/lib/auth/route-handlers";
import { loadAtomicRevisionStatus } from "@/app/lib/atomic/server-catalog";
import { ATOMIC_REVISION_ID_PATTERN, ATOMIC_REVISION_STATUS_MAX_BYTES, ATOMIC_REVISION_STATUS_MAX_IDS, atomicRevisionStatusView, resolveSuccessorChains } from "@/app/lib/atomic/revision-status";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const FAILURE_MESSAGE = "The revision status could not be read. Try again; if it persists, the server log has the details.";

function invalid(detail: string): Response {
  return Response.json({ ok: false, code: "REVISION_STATUS_INPUT_INVALID", error: "The request body is malformed.", detail: [detail] }, { status: 400, headers: NO_STORE });
}

// [B19-E E5] canonical wrapper: authorization (member + exact-origin CSRF) -> media -> bounded body (16 KB / 10 s)
export const POST = authenticatedJsonRoute({ maxBytes: ATOMIC_REVISION_STATUS_MAX_BYTES, deadlineMs: 10_000 }, async ({ body }): Promise<Response> => {
  if (Object.keys(body).some((key) => key !== "revisionIds")) return invalid("undeclared field");
  const ids = body.revisionIds;
  if (!Array.isArray(ids) || ids.length > ATOMIC_REVISION_STATUS_MAX_IDS) return invalid("revisionIds");
  if (!ids.every((id): id is string => typeof id === "string" && ATOMIC_REVISION_ID_PATTERN.test(id))) return invalid("revisionIds");
  const unique = [...new Set(ids)];
  if (unique.length === 0) return Response.json({ ok: true, statuses: [] }, { headers: NO_STORE });
  try {
    const statuses = await loadAtomicRevisionStatus(unique);
    // [B19-E E5 review] a named successor may itself be withdrawn: name the first selectable revision of each chain (bounded hops)
    const chains = await resolveSuccessorChains(loadAtomicRevisionStatus, statuses);
    return Response.json({ ok: true, statuses: unique.map((id) => atomicRevisionStatusView(id, statuses.get(id), chains.get(id))) }, { headers: NO_STORE });
  } catch (error) {
    console.error(`[api/components/revision-status] failed: ${error instanceof Error ? error.name : "non-error rejection"}`);
    return Response.json({ ok: false, error: FAILURE_MESSAGE }, { status: 500, headers: NO_STORE });
  }
});
