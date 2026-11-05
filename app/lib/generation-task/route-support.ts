/**
 * [PR-L, 2026-10-17] Runbook L.4, increment 4 (task-worker-contract.md section 6): what the six generation-task route files share - the
 * JSON answer (`no-store` on every response), the store-unavailable refusal, the trusted principal, and the server-sent event stream of
 * `GET /api/generation-tasks/[id]/events`.
 *
 * The event stream (section 6.3): the route has already authorized the caller and resolved the task in the trusted scope (a foreign or
 * unknown id was the uniform 404 before any stream existed). The stream polls the STORE every `pollMs` (cross-process by construction:
 * a worker in another process commits, this stream reads), sends every new milestone as `event: milestone` with `id: <seq>` (the durable
 * cursor; `Last-Event-ID` resumes after it), the snapshot as `event: snapshot` whenever it changed (liveness, activity, state), a comment
 * heartbeat every `heartbeatMs` (liveness of the stream only, never invented progress), and closes at a terminal state or after
 * `maxOpenMs`; the client reconnects with its cursor. A subscriber that disconnects only stops this poll: the task is never cancelled by
 * it.
 */
import type { TrustedRequestContext } from "../auth/types";
import type { DurableWorkflowScope } from "../durable-workflow/types";
import type { GenerationTaskAnswer, GenerationTaskPrincipal, GenerationTaskService } from "./service";
import type { GenerationTaskSnapshot } from "./snapshot";

export const GENERATION_NO_STORE = Object.freeze({ "Cache-Control": "no-store" });

export function generationAnswer(answer: GenerationTaskAnswer): Response {
  return Response.json(answer.body, { status: answer.status, headers: GENERATION_NO_STORE });
}

/** No durable task store here (normal mode without `DATABASE_URL`): nothing is accepted, nothing is pretended. */
export function generationStoreUnavailable(): Response {
  return Response.json({ ok: false, code: "GENERATION_TASK_STORE_UNAVAILABLE", error: "The durable generation task store is not configured on this server (DATABASE_URL is not set), so no design task can be accepted or read. Nothing was started." }, { status: 503, headers: GENERATION_NO_STORE });
}

export function generationNotFound(): Response {
  return Response.json({ ok: false, code: "GENERATION_TASK_NOT_FOUND", error: "No such design task in this project." }, { status: 404, headers: GENERATION_NO_STORE });
}

/** The trusted principal of a request (role and membership revision are server-derived). */
export function generationPrincipalOf(context: TrustedRequestContext): GenerationTaskPrincipal {
  return { principalId: context.principalId, role: context.actor.role, membershipRevision: context.membershipRevision };
}

export interface GenerationEventStreamOptions {
  service: GenerationTaskService;
  scope: DurableWorkflowScope;
  taskId: string;
  after: number;
  /** the request's signal: the subscriber went away */
  signal?: AbortSignal;
  pollMs?: number;
  heartbeatMs?: number;
  maxOpenMs?: number;
}

const snapshotKey = (task: GenerationTaskSnapshot): string => JSON.stringify([task.state, task.phase, task.liveness, task.updatedAt, task.eventCursor, task.activity, task.actions, task.blocker?.code ?? null]);

/** The SSE body: milestones, snapshots and heartbeats from the store until a terminal state, the open bound or a disconnect. */
export function generationEventStream(options: GenerationEventStreamOptions): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const pollMs = options.pollMs ?? 1_000, heartbeatMs = options.heartbeatMs ?? 15_000, maxOpenMs = options.maxOpenMs ?? 120_000;
  let cursor = options.after, lastKey = "", closed = false;
  let pollHandle: ReturnType<typeof setTimeout> | null = null, heartbeatHandle: ReturnType<typeof setInterval> | null = null, openHandle: ReturnType<typeof setTimeout> | null = null;
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
  const stop = (): void => {
    if (closed) return;
    closed = true;
    if (pollHandle) clearTimeout(pollHandle);
    if (heartbeatHandle) clearInterval(heartbeatHandle);
    if (openHandle) clearTimeout(openHandle);
    options.signal?.removeEventListener("abort", stop);
    try { controllerRef?.close(); } catch { /* already closed */ }
  };
  const send = (text: string): void => { if (!closed) { try { controllerRef?.enqueue(encoder.encode(text)); } catch { stop(); } } };
  const poll = async (): Promise<void> => {
    if (closed) return;
    let terminal = false, more = false;
    try {
      const answer = await options.service.events(options.scope, options.taskId, { after: cursor, limit: 50 });
      if (answer.status !== 200) { send(`event: refused\ndata: ${JSON.stringify({ code: answer.body.code ?? "GENERATION_TASK_NOT_FOUND" })}\n\n`); stop(); return; }
      const body = answer.body as { events: Array<{ seq: number }>; cursor: number; hasMore: boolean; gap: boolean; task: GenerationTaskSnapshot };
      for (const event of body.events) send(`id: ${event.seq}\nevent: milestone\ndata: ${JSON.stringify(event)}\n\n`);
      cursor = body.cursor;
      more = body.hasMore;
      const key = snapshotKey(body.task);
      if (key !== lastKey || body.gap) { lastKey = key; send(`event: snapshot\ndata: ${JSON.stringify({ task: body.task, gap: body.gap, cursor })}\n\n`); }
      terminal = body.task.terminal;
    } catch {
      send(`event: unavailable\ndata: {}\n\n`); // the store did not answer this poll: the client keeps its cursor and polls again
    }
    if (terminal) { stop(); return; }
    if (!closed) pollHandle = setTimeout(() => { void poll(); }, more ? 0 : pollMs);
  };
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      if (options.signal?.aborted) { stop(); return; }
      options.signal?.addEventListener("abort", stop, { once: true });
      send(`retry: 2000\n\n`);
      heartbeatHandle = setInterval(() => send(`: heartbeat\n\n`), heartbeatMs);
      openHandle = setTimeout(stop, maxOpenMs);
      void poll();
    },
    cancel() { stop(); },
  });
}

export function generationEventStreamResponse(stream: ReadableStream<Uint8Array>): Response {
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store, no-transform", Connection: "keep-alive" } });
}
