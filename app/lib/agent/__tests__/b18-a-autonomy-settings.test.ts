/**
 * [B18-A] The autonomy-setting repository contract: default proposal-only,
 * admin-only compare-and-set writes, one audit change per accepted write,
 * no-op on the same mode, stale revisions and foreign roles refused with the
 * current setting, scopes isolated.
 */
import { describe, expect, it } from "vitest";
import { InMemoryAgentAutonomyRepository, refuseAutonomyWrite, type AutonomyWriteRequest } from "../autonomy-settings";
import { defaultAutonomySetting } from "../../engineering/permission-tiers";

const SCOPE = { tenantId: "local", projectId: "p18" };
const ADMIN = { principalId: "admin-1", membershipRevision: "m7", role: "project_admin" as const };
const EDITOR = { principalId: "editor-1", membershipRevision: "m3", role: "pcb_editor" as const };
const T0 = "2026-09-10T12:00:00.000Z";
const write = (over: Partial<AutonomyWriteRequest> = {}): AutonomyWriteRequest => ({ scope: SCOPE, mode: "execute_explicit_tier1", expectedRevision: 0, actor: ADMIN, at: T0, ...over });

describe("B18-A — the agent autonomy repository", () => {
  it("reads the default (proposal_only, revision 0) for a project that was never written; scopes are isolated", async () => {
    const repo = new InMemoryAgentAutonomyRepository();
    expect(await repo.get(SCOPE)).toEqual(defaultAutonomySetting(SCOPE));
    expect(await repo.set(write())).toMatchObject({ ok: true, unchanged: false, setting: { mode: "execute_explicit_tier1", revision: 1 } });
    expect(await repo.get({ tenantId: "local", projectId: "other" })).toMatchObject({ mode: "proposal_only", revision: 0 });
    expect(await repo.get({ tenantId: "t2", projectId: "p18" })).toMatchObject({ mode: "proposal_only", revision: 0 });
  });

  it("an accepted write bumps the revision, stamps the trusted actor and records ONE audit change; the same mode again is a no-op", async () => {
    const repo = new InMemoryAgentAutonomyRepository();
    const first = await repo.set(write());
    expect(first).toMatchObject({ ok: true, setting: { mode: "execute_explicit_tier1", revision: 1, updatedAt: T0, updatedBy: ADMIN }, change: { schema: "sirkit.agent-autonomy-change.v1", fromMode: "proposal_only", toMode: "execute_explicit_tier1", revision: 1, at: T0, actor: ADMIN } });
    const again = await repo.set(write({ expectedRevision: 1 }));
    expect(again).toMatchObject({ ok: true, unchanged: true, change: null, setting: { revision: 1 } });
    const back = await repo.set(write({ mode: "proposal_only", expectedRevision: 1, at: "2026-09-10T12:05:00.000Z" }));
    expect(back).toMatchObject({ ok: true, setting: { mode: "proposal_only", revision: 2 } });
    expect((await repo.changes(SCOPE)).map((change) => `${change.fromMode}->${change.toMode}@${change.revision}`)).toEqual(["proposal_only->execute_explicit_tier1@1", "execute_explicit_tier1->proposal_only@2"]);
    expect(await repo.changes(SCOPE, 1)).toHaveLength(1);
  });

  it("refuses a non-administrator, a stale revision and an unknown mode — each with the current setting and no change", async () => {
    const repo = new InMemoryAgentAutonomyRepository();
    expect(await repo.set(write({ actor: EDITOR }))).toMatchObject({ ok: false, code: "forbidden", current: { mode: "proposal_only", revision: 0 } });
    expect(await repo.set(write({ expectedRevision: 3 }))).toMatchObject({ ok: false, code: "stale_revision", current: { revision: 0 } });
    expect(await repo.set(write({ mode: "execute_everything" as never }))).toMatchObject({ ok: false, code: "invalid_mode" });
    expect(await repo.get(SCOPE)).toMatchObject({ mode: "proposal_only", revision: 0 });
    expect(await repo.changes(SCOPE)).toEqual([]);
    // The shared prelude is what every implementation runs first.
    expect(refuseAutonomyWrite(write({ actor: { ...ADMIN, role: "reviewer" } }), defaultAutonomySetting(SCOPE))).toMatchObject({ ok: false, code: "forbidden" });
    expect(refuseAutonomyWrite(write(), defaultAutonomySetting(SCOPE))).toBeNull();
  });

  it("returned settings are copies: mutating a result never changes the stored setting", async () => {
    const repo = new InMemoryAgentAutonomyRepository();
    const result = await repo.set(write());
    if (!result.ok) throw new Error("expected ok");
    (result.setting as { mode: string }).mode = "proposal_only";
    expect(await repo.get(SCOPE)).toMatchObject({ mode: "execute_explicit_tier1", revision: 1 });
  });
});
