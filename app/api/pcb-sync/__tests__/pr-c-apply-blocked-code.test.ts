/**
 * [PR-C] A refused Stage 3 apply (`POST /api/pcb-sync`, operation `apply`) names its class: the 409 body carries `code`
 * (the first blocker's code when there is one, else `PS_APPLY_<STATUS>`) and a short human `error`, with the full
 * `result` kept. The 200 path, the opt-in header check and authorization are unchanged.
 *
 * The real handler runs with an injected service whose `apply` resolves the scripted result (no database).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { injectAuthorizedPrincipal, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { createPcbSyncPostHandler } from "@/app/api/pcb-sync/handler";
import type { PcbSynchronizationService } from "@/app/lib/pcb-sync/service";
import { PCB_SYNC_APPLY_RESULT_VERSION, type PcbSyncApplyResult, type PcbSyncIssue } from "@/app/lib/pcb-sync/types";

const SEL = { "x-sirkit-tenant-id": "tenant-1", "x-sirkit-project-id": "project-1", "x-sirkit-branch-id": "main" };
const OPT_IN = { "x-sirkit-pcb-sync-opt-in": "true" };

function post(body: unknown, extra: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/pcb-sync", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...SEL, ...extra }, body: JSON.stringify(body) });
}
function issue(code: string, message: string): PcbSyncIssue {
  return { code, severity: "blocking", blocking: true, scope: "plan", stableIds: [], displayRefs: [], message, remediationCategory: "refresh", evidenceRefs: [], causedBy: [], retryability: "after_refresh", helpKey: "plan-stale" };
}
function applyResult(status: PcbSyncApplyResult["status"], blockers: PcbSyncIssue[] = [], boardChanged = false): PcbSyncApplyResult {
  return { resultSchemaVersion: PCB_SYNC_APPLY_RESULT_VERSION, requestId: "apply-1", status, planId: "plan-1", planDigest: "plan-digest-1", boardChanged, originalBoardRevision: null, operationOutcomes: [], blockers, warnings: [], completedAt: "2026-10-14T00:00:00.000Z" };
}
/** the handler with an injected service whose apply answers `result` */
function handlerFor(result: PcbSyncApplyResult) {
  const apply = vi.fn(async () => result);
  const service = { apply } as unknown as PcbSynchronizationService;
  return { handler: createPcbSyncPostHandler(service, () => "opt_in"), apply };
}
const APPLY_BODY = { operation: "apply", request: { requestSchemaVersion: "sirkit.pcb-sync-apply-request.v1", requestId: "apply-1", designId: "design-1", boardId: "board-1", planId: "plan-1", planDigest: "plan-digest-1", expectedPlanLifecycle: "applicable", confirmation: "apply_exact_plan", idempotencyKey: "apply-key-1", warningAcknowledgements: [], requestedAt: "2026-10-14T00:00:00.000Z" } };

beforeEach(() => { injectAuthorizedPrincipal({ userId: "human-1", tenantId: "tenant-1", projectId: "project-1", role: "admin" }); });
afterEach(() => { resetInjectedIdentity(); });

describe("[PR-C] a refused apply carries its code and a sentence", () => {
  it("blocked_stale with a PS_PLAN_STALE blocker → 409 { ok: false, code: PS_PLAN_STALE, error, result }", async () => {
    const result = applyResult("blocked_stale", [issue("PS_PLAN_STALE", "The plan was computed against snapshot revision 3; the board is at revision 4.")]);
    const { handler, apply } = handlerFor(result);
    const res = await handler(post(APPLY_BODY, OPT_IN));
    expect(res.status).toBe(409);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ ok: false, operation: "apply", boardChanged: false, code: "PS_PLAN_STALE", result: { status: "blocked_stale", blockers: [{ code: "PS_PLAN_STALE" }] } });
    expect(typeof body.error).toBe("string");
    expect(body.error as string).toMatch(/stale/i);
    expect(body.error as string).toContain("snapshot revision 3");
    expect(apply).toHaveBeenCalledTimes(1);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("a refusal without blockers → code PS_APPLY_<STATUS> and a per-status sentence", async () => {
    for (const [status, code, pattern] of [
      ["failed_precommit", "PS_APPLY_FAILED_PRECOMMIT", /before anything was committed/],
      ["blocked_authorization", "PS_APPLY_BLOCKED_AUTHORIZATION", /not authorized/],
      ["recoverable_commit_uncertainty", "PS_APPLY_RECOVERABLE_COMMIT_UNCERTAINTY", /uncertain/],
    ] as const) {
      const { handler } = handlerFor(applyResult(status));
      const res = await handler(post(APPLY_BODY, OPT_IN));
      expect(res.status, status).toBe(409);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body, status).toMatchObject({ ok: false, code, result: { status } });
      expect(body.error as string, status).toMatch(pattern);
    }
  });

  it("the first blocker's code wins over the status, and its message is bounded in the sentence", async () => {
    const { handler } = handlerFor(applyResult("failed_precommit", [issue("PS_FOOTPRINT_UNRESOLVED", "x".repeat(2_000)), issue("PS_OTHER", "second")]));
    const res = await handler(post(APPLY_BODY, OPT_IN));
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("PS_FOOTPRINT_UNRESOLVED");
    expect((body.error as string).length).toBeLessThan(400);
  });
});

describe("[PR-C] the accepted path and the guards are unchanged", () => {
  it.each(["applied", "idempotent_replay"] as const)("%s → 200 with exactly the historical body (no code, no error)", async (status) => {
    const result = applyResult(status, [], true);
    const { handler } = handlerFor(result);
    const res = await handler(post(APPLY_BODY, OPT_IN));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, operation: "apply", boardChanged: true, result });
  });

  it("without the explicit opt-in header the apply is refused before the service (403 PS_APPLY_OPT_IN_REQUIRED)", async () => {
    const { handler, apply } = handlerFor(applyResult("applied"));
    const res = await handler(post(APPLY_BODY));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ ok: false, code: "PS_APPLY_OPT_IN_REQUIRED" });
    expect(apply).not.toHaveBeenCalled();
  });

  it("under observation rollout the apply is refused before the service (403 PS_APPLY_ROLLOUT_BLOCKED)", async () => {
    const apply = vi.fn(async () => applyResult("applied"));
    const handler = createPcbSyncPostHandler({ apply } as unknown as PcbSynchronizationService, () => "observe");
    const res = await handler(post(APPLY_BODY, OPT_IN));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ ok: false, code: "PS_APPLY_ROLLOUT_BLOCKED" });
    expect(apply).not.toHaveBeenCalled();
  });
});
