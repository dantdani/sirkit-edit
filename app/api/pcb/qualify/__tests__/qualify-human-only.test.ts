/**
 * [B18-E E6] Scenario 8's route half: qualification is a HUMAN act. No agent tool binds this route — the gateway exposes none
 * and the family is Tier 3 — so this is defence in depth: it pins the explicit actor-kind refusal for any future actor minting
 * (AI, automation, migration) BEFORE any durable read, exactly as the release route already states it, and leaves humans alone.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { injectAuthorizedPrincipal, resetInjectedIdentity } from "@/app/lib/auth/test-support";

const scopeActor = vi.hoisted(() => ({ actorKind: "human" as string, role: "project_admin" as string }));
vi.mock("@/app/api/pcb-sync/_scope", async (orig) => {
  const actual = await orig() as Record<string, unknown>;
  return { ...actual, pcbSyncScopeFromContext: (context: { tenantId: string; projectId: string; branchId: string; actor: Record<string, unknown> }) => ({ tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId, actor: { ...context.actor, actorKind: scopeActor.actorKind, role: scopeActor.role } }) };
});
vi.mock("@/app/lib/durable-workflow/runtime", () => ({ getDurableWorkflowRepository: () => ({}) }));
const getBoardHead = vi.hoisted(() => vi.fn());
vi.mock("@/app/api/pcb-sync/route", () => ({ stage3Repository: { getBoardHead }, stage3BindingRepository: { listSelectedPeers: vi.fn(async () => []) }, stage3SnapshotProvider: { get: vi.fn() } }));
const acquire = vi.hoisted(() => vi.fn());
vi.mock("@/app/lib/pcb/fab/qualification-lease", async (orig) => ({ ...(await orig() as object), DurableQualificationLease: class { acquire = acquire; } }));

import { POST as qualify } from "../route";

const SEL = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": "proj-1", "x-sirkit-branch-id": "main" };
const post = (body: unknown) => new Request("http://localhost/api/pcb/qualify", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...SEL }, body: JSON.stringify(body) });

afterEach(() => { resetInjectedIdentity(); getBoardHead.mockReset(); acquire.mockReset(); scopeActor.actorKind = "human"; scopeActor.role = "project_admin"; });

describe("POST /api/pcb/qualify — a human act", () => {
  it.each([["ai"], ["automation"], ["system_migration"]])("an authorized membership whose actor kind is %s is refused MFG_QUALIFY_HUMAN_REQUIRED before any durable read", async (kind) => {
    injectAuthorizedPrincipal({ userId: "u-admin", tenantId: "local", projectId: "proj-1", role: "admin" });
    scopeActor.actorKind = kind;
    const response = await qualify(post({ designId: "d1", boardId: "b1" }));
    expect(response.status).toBe(403);
    const body = await response.json() as { code: string; correlationId: string };
    expect(body.code).toBe("MFG_QUALIFY_HUMAN_REQUIRED");
    expect(body.correlationId).toBeTruthy();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(getBoardHead, "no durable board read").not.toHaveBeenCalled();
    expect(acquire, "no qualification lease").not.toHaveBeenCalled();
  });

  it("a human actor passes the kind check and is refused later on the request's own merits", async () => {
    injectAuthorizedPrincipal({ userId: "u-admin", tenantId: "local", projectId: "proj-1", role: "admin" });
    const response = await qualify(post({}));
    expect((await response.json() as { code: string }).code).toBe("MFG_API_SCOPE_REQUIRED");
    expect(acquire).not.toHaveBeenCalled();
  });
});
