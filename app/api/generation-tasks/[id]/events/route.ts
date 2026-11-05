/**
 * [PR-L, 2026-10-17] Runbook L.4, increment 4 (task-worker-contract.md section 6.3): GET /api/generation-tasks/[id]/events - the task's
 * ordered public milestones after a durable cursor (`after=<seq>&limit<=50`): a JSON page `{ events, cursor, hasMore, gap, task }`, or,
 * with `Accept: text/event-stream`, a server-sent stream of milestones, snapshots and heartbeats (resumed after `Last-Event-ID`). The SPICE
 * events route is the precedent: authorization and the scoped task lookup run BEFORE any stream exists (a foreign or unknown id is the
 * uniform 404), the project selector may travel in the query (EventSource cannot set headers; it is never authority), and a subscriber
 * disconnect only ends this stream - it never cancels the design.
 */
import { authenticatedRoute } from "@/app/lib/auth/route-handlers";
import { generationProviderServable } from "@/app/lib/generation-task/provider-servable"; // [PR-L, 2026-10-17] the servable rule without the generation import: this route never runs the build loop
import { resolveGenerationTaskService } from "@/app/lib/generation-task/runtime";
import { generationEventsQuery, generationScopeOf } from "@/app/lib/generation-task/service";
import { generationAnswer, generationEventStream, generationEventStreamResponse, generationNotFound, generationStoreUnavailable } from "@/app/lib/generation-task/route-support";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = authenticatedRoute({ querySelector: true, routeParams: ["id"], query: true, safeHeaders: ["accept", "last-event-id"], exposeAbortSignal: true }, async ({ context, params, meta, signal }) => {
  const service = resolveGenerationTaskService({ providerServable: (provider) => generationProviderServable(provider) });
  if (!service) return generationStoreUnavailable();
  const scope = generationScopeOf(context);
  if (!scope) return generationNotFound();
  const id = params!.id!;
  const query = generationEventsQuery(meta.query, meta.headers?.["last-event-id"]);
  if (!query.ok) return generationAnswer(query.answer);
  const first = await service.events(scope, id, { after: query.after, limit: query.limit });
  if (first.status !== 200 || !(meta.headers?.accept ?? "").includes("text/event-stream")) return generationAnswer(first);
  return generationEventStreamResponse(generationEventStream({ service, scope, taskId: id, after: query.after, ...(signal ? { signal } : {}) }));
});
