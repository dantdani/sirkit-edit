/**
 * [PR-L, 2026-10-17] Runbook L.4, increment 4 (task-worker-contract.md section 6.1): the durable generation task of a project.
 *
 *   POST /api/generation-tasks  start or attach: `{ clientRequestId, prompt, provider?, base: { schematicDigest, recipe, headMark? } }`
 *                               -> 202 `{ task, attached }` as soon as the start is DURABLY accepted (the design runs in a worker, not in
 *                               this request); the same clientRequestId again attaches to the same task (a lost 202 is recovered);
 *                               409 GENERATION_TASK_ACTIVE (with the running task) / IDEMPOTENCY_KEY_REUSED; 503 when no durable store or
 *                               no provider is configured (nothing accepted)
 *   GET  /api/generation-tasks  the scope's active task (what a reload or a project switch reattaches to) and its recent task refs
 *
 * Canonical wrappers only: authorization (identity, live membership, role, exact-origin CSRF on POST) before the bounded body; the scope
 * and the principal come from the trusted context, never the body.
 */
import { authenticatedJsonRoute, authenticatedRoute } from "@/app/lib/auth/route-handlers";
import { generationProviderServable } from "@/app/lib/generation-task/provider-servable"; // [PR-L, 2026-10-17] the servable rule without the generation import: this route never runs the build loop
import { resolveGenerationTaskService } from "@/app/lib/generation-task/runtime";
import { GENERATION_TASK_START_MAX_BYTES, generationScopeOf } from "@/app/lib/generation-task/service";
import { generationAnswer, generationNotFound, generationPrincipalOf, generationStoreUnavailable } from "@/app/lib/generation-task/route-support";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = authenticatedJsonRoute({ maxBytes: GENERATION_TASK_START_MAX_BYTES, deadlineMs: 10_000 }, async ({ context, body }) => {
  const service = resolveGenerationTaskService({ providerServable: (provider) => generationProviderServable(provider) });
  if (!service) return generationStoreUnavailable();
  const scope = generationScopeOf(context);
  if (!scope) return generationNotFound();
  return generationAnswer(await service.start(scope, generationPrincipalOf(context), body));
});

export const GET = authenticatedRoute(undefined, async ({ context }) => {
  const service = resolveGenerationTaskService({ providerServable: (provider) => generationProviderServable(provider) });
  if (!service) return generationStoreUnavailable();
  const scope = generationScopeOf(context);
  if (!scope) return generationNotFound();
  return generationAnswer(await service.list(scope));
});
