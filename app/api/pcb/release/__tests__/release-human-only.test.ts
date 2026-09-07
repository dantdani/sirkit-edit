/**
 * B16.1C §E/§H.7 — manufacturing release is a HUMAN project administrator's
 * act. The route policy already restricts the membership role; this pins the
 * explicit actor-kind refusal for any future actor minting (AI, automation,
 * migration) BEFORE any durable read, and the project_admin-only role gate.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { injectAuthorizedPrincipal, resetInjectedIdentity } from "@/app/lib/auth/test-support";

const scopeActor = vi.hoisted(() => ({ actorKind: "human" as string, role: "project_admin" as string }));
vi.mock("@/app/api/pcb-sync/_scope", async (orig) => {
  const actual = await orig() as Record<string, unknown>;
  return { ...actual, pcbSyncScopeFromContext: (context: { tenantId: string; projectId: string; branchId: string; actor: Record<string, unknown> }) => ({ tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId, actor: { ...context.actor, actorKind: scopeActor.actorKind, role: scopeActor.role } }) };
});
const getHead = vi.hoisted(() => vi.fn());
vi.mock("@/app/lib/pcb/fab/authority-store", async (orig) => ({ ...(await orig() as object), DurableManufacturingAuthorityStore: class { getHead = getHead; } }));
vi.mock("@/app/lib/durable-workflow/runtime", () => ({ getDurableWorkflowRepository: () => ({}) }));
const getBoardHead = vi.hoisted(() => vi.fn());
vi.mock("@/app/api/pcb-sync/route", () => ({ stage3Repository: { getBoardHead }, stage3BindingRepository: { listSelectedPeers: vi.fn(async () => []) } }));
const releasePackage = vi.hoisted(() => vi.fn());
vi.mock("@/app/lib/pcb/fab/release-gate", async (orig) => ({ ...(await orig() as object), releaseManufacturingPackage: releasePackage }));

import { POST as release } from "../route";

const SEL = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": "proj-1", "x-sirkit-branch-id": "main" };
const req = () => new Request("http://localhost/api/pcb/release", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...SEL }, body: JSON.stringify({ designId: "d1", boardId: "b1" }) });

afterEach(() => { resetInjectedIdentity(); getHead.mockReset(); getBoardHead.mockReset(); releasePackage.mockReset(); scopeActor.actorKind = "human"; scopeActor.role = "project_admin"; });

describe("POST /api/pcb/release — human administrator only", () => {
  it.each([["ai"], ["automation"], ["system_migration"]])("an authenticated admin membership whose actor kind is %s is refused with MFG_RELEASE_HUMAN_REQUIRED before any durable read", async (kind) => {
    injectAuthorizedPrincipal({ userId: "u-admin", tenantId: "local", projectId: "proj-1", role: "admin" });
    scopeActor.actorKind = kind;
    const response = await release(req());
    expect(response.status).toBe(403);
    const body = await response.json() as { code: string; correlationId: string };
    expect(body.code).toBe("MFG_RELEASE_HUMAN_REQUIRED");
    expect(body.correlationId).toBeTruthy();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(getHead).not.toHaveBeenCalled();
    expect(getBoardHead).not.toHaveBeenCalled();
    expect(releasePackage).not.toHaveBeenCalled();
  });

  it("a human whose derived role is not project_admin is refused even if the membership policy let the request through", async () => {
    injectAuthorizedPrincipal({ userId: "u-admin", tenantId: "local", projectId: "proj-1", role: "admin" });
    scopeActor.role = "pcb_editor";
    const response = await release(req());
    expect(response.status).toBe(403);
    expect((await response.json() as { code: string }).code).toBe("MFG_RELEASE_HUMAN_REQUIRED");
    expect(getHead).not.toHaveBeenCalled();
  });

  it("a human project_admin reaches the durable authority read (404 when nothing is qualified)", async () => {
    injectAuthorizedPrincipal({ userId: "u-admin", tenantId: "local", projectId: "proj-1", role: "admin" });
    getHead.mockResolvedValueOnce(null);
    const response = await release(req());
    expect(response.status).toBe(404);
    expect((await response.json() as { code: string }).code).toBe("MFG_AUTHORITY_NOT_FOUND");
    expect(getHead).toHaveBeenCalledWith({ tenantId: "local", projectId: "proj-1", branchId: "main", designId: "d1", boardId: "b1" });
    expect(releasePackage).not.toHaveBeenCalled();
  });
});
