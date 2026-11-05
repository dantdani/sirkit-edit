/**
 * [PR-M, 2026-10-18] Runbook section M.2.5: the same-origin FRESH-FACTS endpoint of a component RESOLUTION apply - the server half of
 * the one-shot channel (app/lib/component-resolution/resolution-reauthorization.ts `createResolutionReauthorization`), the sibling of
 * the B14 replacement reauthorization endpoint (app/api/replacement-authority/route.ts) with the canonical refusal envelopes.
 *
 * READ / PROVE ONLY. It reads, NOW, the server-owned facts a reviewed resolution batch is recompiled from - every catalog part the
 * batch is decided on (the shared catalog detail read through the chat route's catalog port) and the published, never-withdrawn
 * evidence and catalog status of every asserted revision (the revision evidence port) - through `loadFreshResolutionFacts`
 * (app/lib/component-resolution/facts-loader.ts), the SAME loader and ports the proposal was assembled from. It never mutates the
 * schematic, executes no command, opens no session and writes nothing.
 *
 * AUTHORIZATION FIRST: the canonical wrapper (`authenticatedJsonRoute`) completes authentication, ACTIVE project membership, the exact
 * editor roles of the route policy and exact-origin CSRF before the bounded body (16,384 bytes, 10 s) is read; a revoked, foreign or
 * downgraded member is refused there, so the channel answers null and the apply refuses `authority-unavailable` - membership is
 * re-proved at commit time by this exchange as well as by the controller's live reauthorization. The tenant, project and branch come
 * ONLY from the trusted context; a body `scope` is an optional post-authentication cross-check that must byte-match it (403 otherwise)
 * and never selects data.
 *
 * What the body may name is closed: the proposal id, the batch items (instance id, its current part, the candidate part and the
 * asserted revision), the part ids and the correlation nonce. They are LOOKUP KEYS only: the answered facts grant nothing - the apply
 * recompiles the WHOLE batch from them and byte-matches the reviewed operations and impact (a withdrawn candidate, a changed catalog
 * link or changed evidence refuses there). The response echoes the nonce, the proposal id and the trusted scope (`binding`) so the
 * channel correlates it to its own request (replay defence, never server authentication). Provider/model code never calls this
 * endpoint; only the page's review controller does, through the channel.
 */
import { authenticatedJsonRoute } from "@/app/lib/auth/route-handlers";
import { loadFreshResolutionFacts, MAX_FRESH_FACT_PARTS } from "@/app/lib/component-resolution/facts-loader";
import { MAX_RESOLUTION_ITEMS, RESOLUTION_PROPOSAL_ID_PREFIX } from "@/app/lib/component-resolution/resolution-proposal";
import { resolveCatalogInspectionPort } from "../chat/catalog-inspection-runtime";
import { resolveRevisionEvidencePort } from "../chat/revision-evidence-runtime";

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const REVISION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/+\-]{0,511}$/;
/** the platform-random correlation nonce (as the B14 endpoint) */
const NONCE_PATTERN = /^[A-Za-z0-9]{16,128}$/;
const PROPOSAL_ID_PATTERN = new RegExp(`^${RESOLUTION_PROPOSAL_ID_PREFIX}[A-Za-z0-9._:-]{1,160}$`);
const BODY_KEYS = ["scope", "proposalId", "items", "partIds", "nonce"] as const;
const ITEM_KEYS = ["componentInstanceId", "currentPartId", "candidatePartId", "atomicPartRevisionId"] as const;
const RESOLUTION_AUTHORITY_MAX_BODY_BYTES = 16_384;
const REQUEST_READ_DEADLINE_MS = 10_000;
/** The server's own budget for the reads: under the channel's 10 s hard deadline, so a slow catalog answers 503 before the client gives up. */
const RESOLUTION_FACTS_BUDGET_MS = 8_000;

const NO_STORE = { "Cache-Control": "no-store" } as const;
const refuse = (status: number, code: string, error: string): Response => Response.json({ ok: false, code, error }, { status, headers: NO_STORE });
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export const POST = authenticatedJsonRoute(
  { maxBytes: RESOLUTION_AUTHORITY_MAX_BODY_BYTES, deadlineMs: REQUEST_READ_DEADLINE_MS, exposeAbortSignal: true },
  async ({ context, body, signal }) => {
    const trustedScope = { tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId };
    for (const key of Object.keys(body)) {
      if (!(BODY_KEYS as readonly string[]).includes(key)) return refuse(400, "RESOLUTION_AUTHORITY_UNEXPECTED_KEY", `unexpected request key "${key.slice(0, 40)}" - browser-supplied authority, asset identities and pin lists are refused`);
    }
    const nonce = body.nonce;
    if (typeof nonce !== "string" || !NONCE_PATTERN.test(nonce)) return refuse(400, "RESOLUTION_AUTHORITY_NONCE_REQUIRED", "a well-formed request nonce is required");
    if ("scope" in body) {
      const scope = body.scope;
      if (!isRecord(scope)) return refuse(400, "RESOLUTION_AUTHORITY_SCOPE_INVALID", "scope must be an object");
      for (const key of Object.keys(scope)) if (!["tenantId", "projectId", "branchId"].includes(key)) return refuse(400, "RESOLUTION_AUTHORITY_SCOPE_INVALID", `unexpected scope key "${key.slice(0, 40)}"`);
      if (scope.tenantId !== trustedScope.tenantId || scope.projectId !== trustedScope.projectId || scope.branchId !== trustedScope.branchId) {
        return refuse(403, "RESOLUTION_AUTHORITY_SCOPE_MISMATCH", "the request scope does not match the authenticated project scope");
      }
    }
    const proposalId = body.proposalId;
    if (typeof proposalId !== "string" || !PROPOSAL_ID_PATTERN.test(proposalId)) return refuse(400, "RESOLUTION_AUTHORITY_PROPOSAL_INVALID", "proposalId must name a sealed component resolution proposal");
    const rawItems = body.items;
    if (!Array.isArray(rawItems) || rawItems.length === 0 || rawItems.length > MAX_RESOLUTION_ITEMS) return refuse(400, "RESOLUTION_AUTHORITY_ITEMS_INVALID", `items is a list of 1-${MAX_RESOLUTION_ITEMS} batch items`);
    const items: Array<{ componentInstanceId: string; currentPartId: string; candidatePartId: string; atomicPartRevisionId: string }> = [];
    for (const raw of rawItems as unknown[]) {
      if (!isRecord(raw)) return refuse(400, "RESOLUTION_AUTHORITY_ITEMS_INVALID", "each item is an object");
      for (const key of Object.keys(raw)) if (!(ITEM_KEYS as readonly string[]).includes(key)) return refuse(400, "RESOLUTION_AUTHORITY_ITEMS_INVALID", `an item carries only ${ITEM_KEYS.join(", ")} (not "${key.slice(0, 40)}")`);
      const { componentInstanceId, currentPartId, candidatePartId, atomicPartRevisionId } = raw;
      if (typeof componentInstanceId !== "string" || !ID_PATTERN.test(componentInstanceId) || typeof currentPartId !== "string" || !ID_PATTERN.test(currentPartId) || typeof candidatePartId !== "string" || !ID_PATTERN.test(candidatePartId)) return refuse(400, "RESOLUTION_AUTHORITY_ITEMS_INVALID", "an item's instance and part ids must be well-formed identifiers");
      if (typeof atomicPartRevisionId !== "string" || !REVISION_PATTERN.test(atomicPartRevisionId)) return refuse(400, "RESOLUTION_AUTHORITY_ITEMS_INVALID", "an item's atomicPartRevisionId must be a bounded identifier");
      items.push({ componentInstanceId, currentPartId, candidatePartId, atomicPartRevisionId });
    }
    const rawPartIds = body.partIds;
    if (!Array.isArray(rawPartIds) || rawPartIds.length === 0 || rawPartIds.length > MAX_FRESH_FACT_PARTS || !rawPartIds.every((id): id is string => typeof id === "string" && ID_PATTERN.test(id))) {
      return refuse(400, "RESOLUTION_AUTHORITY_PARTS_INVALID", `partIds is a list of 1-${MAX_FRESH_FACT_PARTS} well-formed catalog part ids`);
    }

    // The ports the proposal was assembled from (fail closed): the catalog part read and the published revision evidence.
    const catalog = resolveCatalogInspectionPort() ?? undefined;
    const evidence = catalog ? resolveRevisionEvidencePort() : undefined; // the evidence port alone: this endpoint never reaches the catalog search (no provider, no model)
    if (!catalog || !evidence) return refuse(503, "RESOLUTION_AUTHORITY_UNAVAILABLE", "no catalog and published revision evidence can be read on this server; the resolution cannot be re-verified");
    const facts = await loadFreshResolutionFacts({
      catalog, evidence,
      request: { items, partIds: rawPartIds },
      context: { scope: trustedScope, runId: `apply:${proposalId}`.slice(0, 200), budgetMs: RESOLUTION_FACTS_BUDGET_MS, ...(signal ? { signal } : {}) },
    });
    if (!facts) return refuse(503, "RESOLUTION_AUTHORITY_UNAVAILABLE", "fresh catalog facts or published revision evidence could not be read; the resolution cannot be re-verified");
    return Response.json({ ok: true, parts: facts.parts, evidence: facts.evidence, status: facts.status, binding: { nonce, proposalId, scope: trustedScope } }, { headers: NO_STORE });
  },
);
