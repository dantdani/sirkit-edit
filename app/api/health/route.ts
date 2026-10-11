/**
 * GET /api/health
 *
 * [B24-A1] D24-9, OD-198: public liveness. It answers `{ ok: true }` with no-store and reads nothing - no environment, no store, no
 * request data - so it can never disclose a value. Dependency checks are GET /api/ready's, on the worker class.
 */
import { publicRoute } from "@/app/lib/auth/route-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = publicRoute(undefined, () => Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } }));
