import { cancelRun, getRun } from "@/app/lib/spice/server/job-store";
import { authenticatedRoute } from "@/app/lib/auth/route-handlers";
import { runNotFound, spiceRunScopeFromContext } from "../_scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// [B16.0.23] canonical wrapper — all-members read, header-less query selector
// via the wrapper; the run id arrives ONLY through the declared bounded route
// parameter. A foreign or missing run is the uniform non-oracle 404.
export const GET = authenticatedRoute({ querySelector: true, routeParams: ["id"] }, ({ context, params }) => {
  const run = getRun(params!.id, spiceRunScopeFromContext(context));
  return run ? Response.json({ ok: true, run }, { headers: { "Cache-Control": "no-store" } }) : runNotFound();
});

// [B16.0.2 §B] authorize (role + CSRF) BEFORE touching the cancellation
// authority; a foreign-scope run is a uniform 404 and is never cancelled.
// [B16.0.23] canonical wrapper — WRITE_EDITORS + exact-origin CSRF enforced
// inside the wrapper; cancellation stays explicit, owner-only, and 409 once
// the run is already terminal.
export const DELETE = authenticatedRoute({ routeParams: ["id"] }, ({ context, params }) => {
  const scope = spiceRunScopeFromContext(context), id = params!.id;
  if (!getRun(id, scope)) return runNotFound();
  return cancelRun(id, scope)
    ? Response.json({ ok: true, run: getRun(id, scope) }, { headers: { "Cache-Control": "no-store" } })
    : Response.json({ ok: false, error: "Run has already finished" }, { status: 409, headers: { "Cache-Control": "no-store" } });
});
