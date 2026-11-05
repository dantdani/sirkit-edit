/**
 * GET/POST /api/parts/acquisitions
 *
 * [PR-M, 2026-10-18] Section M2 (design M2.1): the page's parity with the agent's `sirkit.parts.acquisition-start` /
 * `sirkit.parts.acquisition-status` - the durable, schematic-scoped CAD acquisition task of a project (works BEFORE any PCB exists):
 * start or attach, read the task and its public progress, cancel / resume / check the review again, "Send for component review" (a human),
 * and the applied receipt with the server-recomputed preflight; plus the catalog governance project's component review inbox.
 *
 * Canonical wrappers only: authorization (identity, live membership, the policy row's roles, exact-origin CSRF on POST) BEFORE the bounded
 * body (512 KiB: the verified schematic snapshot, 15 s); forbidden authority keys refused by the wrapper; the scope and principal come
 * from the trusted context, never the body. This route mutates no design, calls no CAD source itself (the worker does, in its own slice)
 * and reaches no network client: the task's network-free composition (task/runtime.ts), never the worker's (task/worker-runtime.ts).
 */
import { authenticatedJsonRoute, authenticatedRoute } from "@/app/lib/auth/route-handlers";
import { resolveComponentResolutionRuntime } from "@/app/lib/component-resolution/task/runtime";
import { CAD_ACQUISITION_DEADLINE_MS, CAD_ACQUISITION_MAX_BYTES } from "@/app/lib/acquisition/cad-acquisition-contract";
import { resolveCatalogInspectionPort } from "../../chat/catalog-inspection-runtime";
import { handleAcquisitionGet, handleAcquisitionPost, type AcquisitionRouteDeps } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Top-level body keys that could only claim authority or carry bytes; the canonical wrapper refuses them before the handler runs. */
const FORBIDDEN_BODY_KEYS = ["snapshot", "assets", "facts", "sourceClass", "evidence", "reviewerId", "reviewedAt", "approval", "board", "bytes", "content", "url"] as const;

const deps: AcquisitionRouteDeps = { runtime: resolveComponentResolutionRuntime, catalog: resolveCatalogInspectionPort };

export const GET = authenticatedRoute({ query: true }, async ({ context, meta }) => handleAcquisitionGet({ context, query: meta.query ?? {} }, deps));

export const POST = authenticatedJsonRoute(
  { maxBytes: CAD_ACQUISITION_MAX_BYTES, deadlineMs: CAD_ACQUISITION_DEADLINE_MS, forbiddenBodyKeys: FORBIDDEN_BODY_KEYS },
  async ({ context, body }) => handleAcquisitionPost({ context, body }, deps),
);
