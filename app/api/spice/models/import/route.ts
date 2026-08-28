import { importModelText } from "@/app/lib/spice/models";
import { sha256 } from "@/app/lib/spice/server/manifest";
import type { ModelAsset } from "@/app/lib/spice/types";
import { authenticatedJsonRoute } from "@/app/lib/auth/route-handlers";

export const runtime = "nodejs";

/** [B16.0.2 §D] a model file's text travels in the body. */
const MAX_BODY_BYTES = 4_000_000;
const BODY_DEADLINE_MS = 20_000;

// [B16.0.23] canonical wrapper — authorization (WRITE_EDITORS + exact-origin
// CSRF) + the bounded 4 MB / 20 s JSON read inside the wrapper. The import is
// a stateless candidate VALIDATION transform: structural checks, forbidden
// directive/traversal screens, and the server-computed sha256 checksum — it
// persists nothing, certifies nothing, and never marks a model verified for
// merely parsing.
export const POST = authenticatedJsonRoute<{ fileName?: string; content?: string; metadata?: Partial<Pick<ModelAsset, "manufacturer" | "mpn" | "category" | "provenance" | "license" | "redistribution">> }>(
  { maxBytes: MAX_BODY_BYTES, deadlineMs: BODY_DEADLINE_MS },
  ({ body }) => {
  if (typeof body.fileName !== "string" || typeof body.content !== "string") return Response.json({ ok: false, error: "fileName and content are required" }, { status: 400 });
  try {
    const report = importModelText(body.fileName, body.content, body.metadata);
    report.candidate.checksum = sha256(body.content);
    return Response.json({ ok: true, report });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 422 });
  }
  });
