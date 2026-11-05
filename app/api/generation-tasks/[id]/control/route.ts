/**
 * [PR-L, 2026-10-17] Runbook L.4, increment 4 (task-worker-contract.md sections 2 and 6.1): POST /api/generation-tasks/[id]/control -
 * `{ action, clientActionId, blockId?, review?, liveBase? }` with `action` one of cancel, pause, resume, extend-allowance, retry-block,
 * review-partial, record-review, report-base. Whoever may start a design may stop it (the policy row's editor roles); every transition is
 * judged by the durable store (`409 GENERATION_TASK_STATE_CONFLICT` otherwise); one `clientActionId` names one action (a repeat answers
 * the same result). Cancel is DURABLE: no new slice starts, the running slice is aborted at its next control poll, and its late result
 * is fenced out. Answers the task's snapshot.
 */
import { authenticatedJsonRoute } from "@/app/lib/auth/route-handlers";
import { generationProviderServable } from "@/app/lib/generation-task/provider-servable"; // [PR-L, 2026-10-17] the servable rule without the generation import: this route never runs the build loop
import { resolveGenerationTaskService } from "@/app/lib/generation-task/runtime";
import { generationScopeOf } from "@/app/lib/generation-task/service";
import { generationAnswer, generationNotFound, generationPrincipalOf, generationStoreUnavailable } from "@/app/lib/generation-task/route-support";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = authenticatedJsonRoute({ routeParams: ["id"], maxBytes: 8_000, deadlineMs: 10_000 }, async ({ context, body, params }) => {
  const service = resolveGenerationTaskService({ providerServable: (provider) => generationProviderServable(provider) });
  if (!service) return generationStoreUnavailable();
  const scope = generationScopeOf(context);
  if (!scope) return generationNotFound();
  return generationAnswer(await service.control(scope, generationPrincipalOf(context), params!.id!, body));
});
