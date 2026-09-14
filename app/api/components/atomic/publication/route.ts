/**
 * GET/POST /api/components/atomic/publication
 *
 * [B19-E E4] Import candidate review and two-person human publication of exact atomic revisions, in the catalog governance
 * project only (OD-37: `SIRKIT_ATOMIC_CATALOG_TENANT_ID` and `SIRKIT_ATOMIC_CATALOG_PROJECT_ID`; either unset refuses every
 * operation).
 *
 *  GET   the project's publication requests (a member read, no-store), with the viewer's server-derived permissions.
 *  POST  { operation: "submit_request" | "resolve_request" | "publish_request" | "withdraw_request" | "withdraw_revision", ... }
 *        submit and withdraw: editors, reviewers, administrators (withdraw: the requester only); resolve (approve | reject):
 *        a reviewer or an administrator; publish: an administrator who did not approve. Humans only.
 *        [B19-E E5] withdraw_revision { revisionId, to: deprecated | superseded | revoked, successorRevisionId?, reason }: an
 *        administrator; only a legal edge; a successor must be a selectable revision of the same logical part.
 *
 * Canonical wrappers: authorization (membership, the policy row's roles, exact-origin CSRF) -> media -> bounded body (64 KB,
 * 10 s) -> forbidden authority keys (a snapshot, assets, facts, values, evidence, a source class or a reviewer stamp). The
 * review is cache-only: no request, approval or publication calls a vendor. A failure answers one fixed sentence.
 */
import { authenticatedJsonRoute, authenticatedRoute } from "@/app/lib/auth/route-handlers";
import { resolveMembershipRepository } from "@/app/lib/auth/identity-runtime";
import { getDurableWorkflowRepository } from "@/app/lib/durable-workflow/runtime";
import { loadCachedExternalObservations } from "@/app/lib/acquisition/offer-cache-observations";
import { bundledKicadLibrary } from "@/app/lib/atomic/authoring";
import { publishPortableAtomicSnapshot, withdrawPublishedAtomicRevision } from "@/app/lib/atomic/server-repository";
import { loadAtomicAuthoringIdentity, loadAtomicLinkTargets, loadAtomicRevisionStatus } from "@/app/lib/atomic/server-catalog";
import { atomicCatalogGovernanceProjectId, atomicCatalogGovernanceTenantId, DurableAtomicPublicationStore, type AtomicPublicationDeps } from "@/app/lib/atomic/publication-review";
import { ATOMIC_PUBLICATION_DEADLINE_MS, ATOMIC_PUBLICATION_FORBIDDEN_BODY_KEYS, ATOMIC_PUBLICATION_MAX_BYTES } from "@/app/lib/atomic/publication-review-contract";
import { handleAtomicPublicationGet, handleAtomicPublicationPost, type AtomicPublicationRouteDeps } from "./handler";

export const runtime = "nodejs";

/** [B19-E E4] composed per request, only after the handler has authorized the caller for the operation */
function routeDeps(): AtomicPublicationRouteDeps {
  return {
    env: process.env,
    review: (): AtomicPublicationDeps => ({
      store: new DurableAtomicPublicationStore(getDurableWorkflowRepository()),
      membership: resolveMembershipRepository(),
      governanceProjectId: atomicCatalogGovernanceProjectId(process.env),
      governanceTenantId: atomicCatalogGovernanceTenantId(process.env), // [B19-E E4 review] gates-1
      library: bundledKicadLibrary(),
      loadObservations: loadCachedExternalObservations,
      loadIdentity: loadAtomicAuthoringIdentity,
      loadLinkTargets: loadAtomicLinkTargets, // [B19-E E4 review] security-unreviewed-links
      loadRevisionStatus: loadAtomicRevisionStatus,
      publish: publishPortableAtomicSnapshot,
      withdraw: withdrawPublishedAtomicRevision, // [B19-E E5] withdraw_revision
    }),
  };
}

// [B19-E E4] canonical wrapper: member read (no CSRF per the policy row), bounded query projection, no-store
export const GET = authenticatedRoute({ query: true }, async ({ context, meta }) => handleAtomicPublicationGet({ context, query: meta.query ?? {} }, routeDeps()));

// [B19-E E4] canonical wrapper: authorization + exact-origin CSRF -> media -> bounded body (64 KB / 10 s) -> forbidden keys
export const POST = authenticatedJsonRoute(
  { maxBytes: ATOMIC_PUBLICATION_MAX_BYTES, deadlineMs: ATOMIC_PUBLICATION_DEADLINE_MS, forbiddenBodyKeys: ATOMIC_PUBLICATION_FORBIDDEN_BODY_KEYS },
  async ({ context, body }) => handleAtomicPublicationPost({ context, body }, routeDeps()),
);
