/**
 * POST /api/parts/external-search
 *
 * Body:  { query: string; mode: "exact" | "keyword"; limit: 1-5; sources?: registry source ids }
 * [B19-E E2] A member's bounded candidate search of the enabled distributors (DigiKey, Nexar): at most 5 labelled sourcing
 * observations per source, each with an exactMatch flag, and every source's status (available, paused with when to retry,
 * failed, or its registry refusal). Nothing is persisted and nothing here can place, bind or buy a part.
 *
 * A live search spends metered vendor quota, so this is an AUTHENTICATED project read declared as spending provider credit
 * (the /api/bom policy shape, OD-31). Live search is the server's decision for that member, never a body flag; the body is
 * small and bounded; transport- and credential-shaped keys are refused; a failure answers one fixed sentence.
 */
import { authenticatedJsonRoute } from "@/app/lib/auth/route-handlers";
import { redactSecrets } from "@/app/lib/atomic/security";
import { searchExternalCandidates } from "@/app/lib/acquisition/external-search";

export const runtime = "nodejs";

const EXTERNAL_SEARCH_FORBIDDEN_BODY_KEYS = ["live", "forceRefresh", "url", "host", "apiKey", "token"] as const;
const DECLARED_KEYS = new Set(["query", "mode", "limit", "sources"]);
const FAILURE_MESSAGE = "The distributor search could not be completed. Try again; if it persists, the server log has the details.";
const NO_STORE = { "Cache-Control": "no-store" } as const;

function failure(error: unknown): Response {
  const detail = error instanceof Error ? error.message : typeof error === "string" ? error : "non-error rejection";
  const safe = redactSecrets(detail).replace(/\b(password|passwd|pwd|secret|token|apikey|api_key|key)=\S+/gi, "$1=[REDACTED]");
  console.error(`[api/parts/external-search] failed: ${safe.slice(0, 300)}`);
  return Response.json({ ok: false, error: FAILURE_MESSAGE }, { status: 500, headers: NO_STORE });
}

// [B19-E E2] canonical wrapper: authorization (member + same-origin CSRF) -> media -> bounded body (4 KB / 5 s) -> forbidden keys
export const POST = authenticatedJsonRoute({ maxBytes: 4_096, deadlineMs: 5_000, forbiddenBodyKeys: EXTERNAL_SEARCH_FORBIDDEN_BODY_KEYS }, async ({ body, context }): Promise<Response> => {
  const undeclared = Object.keys(body).find((key) => !DECLARED_KEYS.has(key));
  if (undeclared !== undefined) {
    return Response.json({ ok: false, code: "EXTERNAL_SEARCH_BODY_INVALID", error: "The request body carries an undeclared field." }, { status: 400, headers: NO_STORE });
  }
  try {
    const result = await searchExternalCandidates(
      { query: body.query as string, mode: body.mode as "exact" | "keyword", limit: body.limit as number, ...(body.sources === undefined ? {} : { sources: body.sources as never }) },
      // [B19-E E2 review] the memo is the trusted tenant and project's own: no one else learns what was searched, or when
      { live: true, purpose: "interactive", scope: { tenantId: context.tenantId, projectId: context.projectId } },
    );
    return Response.json(result, { status: result.ok ? 200 : 400, headers: NO_STORE });
  } catch (error) {
    return failure(error);
  }
});
