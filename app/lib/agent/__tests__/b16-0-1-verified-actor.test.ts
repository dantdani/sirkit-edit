/**
 * B16.0.1 §D — the verified principal is load-bearing in the agent run (R3/R4).
 *
 * Before B16.0.1, `assembleAgentRunContext` bound EVERY run to the local-only
 * owner (`local-user` / `project_admin`), discarding whatever the /api/chat
 * trusted-context resolver had verified. These tests prove the assembler now
 * binds the run actor — id, real membership role, membership revision, auth
 * class, source — to the supplied verified principal, and that the local-only
 * build actor remains only when no verified principal is supplied.
 */

import { describe, expect, it } from "vitest";
import { assembleAgentRunContext, createLocalOnlyActor } from "../context";

const SCOPE = { tenantId: "local", projectId: "proj-1", branchId: "main" };

describe("B16.0.1 §D — verified actor propagation", () => {
  it("without a verified principal, the run keeps the documented local-only build actor", () => {
    const assembly = assembleAgentRunContext({ ...SCOPE });
    expect(assembly.ok).toBe(true);
    if (!assembly.ok) return;
    expect(assembly.context.actor).toEqual(createLocalOnlyActor());
    expect(assembly.context.actor.actorId).toBe("local-user");
    expect(assembly.context.discovery.actorId).toBe("local-user");
  });

  it("a Supabase-verified principal binds the run actor to THAT identity + membership revision", () => {
    const assembly = assembleAgentRunContext({
      ...SCOPE,
      verifiedActor: { principalId: "user-alice", actorRole: "pcb_editor", membershipRevision: "membership:rev-9", authMethod: "supabase_cookie" },
    });
    expect(assembly.ok).toBe(true);
    if (!assembly.ok) return;
    const actor = assembly.context.actor;
    expect(actor.actorId).toBe("user-alice");
    expect(actor.actorRole).toBe("pcb_editor");
    expect(actor.membershipRevision).toBe("membership:rev-9");
    expect(actor.source).toBe("verified-session");
    expect(actor.authClass).toBe("supabase_cookie");
    // The discovery context (which gates tools) rides the SAME verified identity.
    expect(assembly.context.discovery.actorId).toBe("user-alice");
    expect(assembly.context.discovery.actorRole).toBe("pcb_editor");
    // Read-surface capability only — the run is a read + propose ceiling.
    expect([...actor.grantedCapabilities]).toEqual(["read_project"]);
  });

  it("a downgraded viewer is bound as a viewer (real role gates the propose surface)", () => {
    const assembly = assembleAgentRunContext({
      ...SCOPE,
      verifiedActor: { principalId: "user-viewer", actorRole: "viewer", membershipRevision: "membership:rev-1", authMethod: "supabase_cookie" },
    });
    expect(assembly.ok).toBe(true);
    if (!assembly.ok) return;
    expect(assembly.context.actor.actorRole).toBe("viewer");
    expect(assembly.context.discovery.actorRole).toBe("viewer");
  });

  it("a worker principal is marked verified-worker; local_dev stays the honest local-only source", () => {
    const worker = assembleAgentRunContext({ ...SCOPE, verifiedActor: { principalId: "sirkit-workflow-worker", actorRole: "automation", membershipRevision: "worker", authMethod: "worker_secret" } });
    const localDev = assembleAgentRunContext({ ...SCOPE, verifiedActor: { principalId: "local-dev-principal", actorRole: "project_admin", membershipRevision: "local-dev", authMethod: "local_dev" } });
    expect(worker.ok && worker.context.actor.source).toBe("verified-worker");
    // local_dev: identity resolved, but honestly the unauthenticated local build.
    expect(localDev.ok && localDev.context.actor.source).toBe("local-only");
    expect(localDev.ok && localDev.context.actor.actorId).toBe("local-dev-principal");
  });
});
