/**
 * B16-B — RLS and membership policies are EXECUTABLE (evaluated by PostgreSQL,
 * not merely represented in TypeScript), and the ownership CHECK constraints
 * behave correctly under SQL three-valued logic. Runs on the disposable
 * in-process PostgreSQL in the default suite.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadMigrationManifest } from "../migrations/manifest";
import { migrateDatabase } from "../migrations/runner";
import { captureSchemaSnapshot, verifyMembershipAndOwnership } from "../migrations/verify-schema";
import { disposablePostgres, PLATFORM_GRANT_SQL, type DisposablePostgres } from "../disposable-postgres";

const U1 = "11111111-1111-1111-1111-111111111111", U2 = "22222222-2222-2222-2222-222222222222", U3 = "33333333-3333-3333-3333-333333333333";
let db: DisposablePostgres;

beforeAll(async () => {
  db = await disposablePostgres();
  await migrateDatabase(db, { manifest: loadMigrationManifest() });
  await db.exec(PLATFORM_GRANT_SQL);
  await db.exec(`
    INSERT INTO project_members VALUES ('m1','tenant-a','proj-1','${U1}','admin','active',1,now(),now(),'operator');
    INSERT INTO project_members VALUES ('m2','tenant-a','proj-1','${U2}','viewer','active',1,now(),now(),'operator');
    INSERT INTO project_members VALUES ('m3','tenant-a','proj-1','${U3}','viewer','revoked',1,now(),now(),'operator');
    INSERT INTO project_members VALUES ('m4','tenant-b','proj-9','${U1}','editor','active',1,now(),now(),'operator');
  `);
}, 60_000);
afterAll(async () => { await db?.close(); });

describe("B16-B §catalog criteria — membership, ownership, RLS, policies, indexes", () => {
  it("every runbook criterion holds against the catalog of the migrated database", async () => {
    const rows = verifyMembershipAndOwnership(await captureSchemaSnapshot(db));
    const failed = rows.filter((row) => !row.ok);
    expect(failed, JSON.stringify(failed, null, 1)).toEqual([]);
    expect(rows.length).toBeGreaterThanOrEqual(24);
    expect(rows.filter((row) => row.id.startsWith("policy.")).map((row) => row.id)).toEqual(["policy.project_members.project_members_self_select.caller-bound"]);
  });
});

describe("B16-B §RLS is executable", () => {
  it("an authenticated user reads ONLY their own ACTIVE memberships (across tenants they belong to), never another user's", async () => {
    const seen = await db.asAuthenticated(U1, (runner) => runner.query<{ membership_id: string }>("SELECT membership_id FROM project_members ORDER BY membership_id"));
    expect(seen.map((row) => row.membership_id)).toEqual(["m1", "m4"]);
    const other = await db.asAuthenticated(U2, (runner) => runner.query<{ membership_id: string }>("SELECT membership_id FROM project_members ORDER BY membership_id"));
    expect(other.map((row) => row.membership_id)).toEqual(["m2"]);
  });

  it("a revoked membership is invisible to its own user; no subject sees nothing", async () => {
    expect(await db.asAuthenticated(U3, (runner) => runner.query("SELECT membership_id FROM project_members"))).toEqual([]);
    expect(await db.asAuthenticated(null, (runner) => runner.query("SELECT membership_id FROM project_members"))).toEqual([]);
  });

  it("an authenticated user can never grant, escalate, or revoke membership (no write policy exists)", async () => {
    await expect(db.asAuthenticated(U2, (runner) => runner.exec(`INSERT INTO project_members VALUES ('m9','tenant-a','proj-1','${U2}','admin','active',1,now(),now(),'self')`))).rejects.toThrow(/row-level security/);
    await db.asAuthenticated(U2, (runner) => runner.exec("UPDATE project_members SET role = 'admin' WHERE membership_id = 'm2'"));
    await db.asAuthenticated(U2, (runner) => runner.exec("DELETE FROM project_members WHERE membership_id = 'm1'"));
    const rows = await db.query<{ membership_id: string; role: string }>("SELECT membership_id, role FROM project_members ORDER BY membership_id");
    expect(rows).toEqual([{ membership_id: "m1", role: "admin" }, { membership_id: "m2", role: "viewer" }, { membership_id: "m3", role: "viewer" }, { membership_id: "m4", role: "editor" }]);
  });

  it("the trusted server path (superuser / service role, RLS bypassed) sees every row", async () => {
    expect((await db.query<{ n: string }>("SELECT count(*)::text AS n FROM project_members"))[0]!.n).toBe("4");
  });
});

describe("B16-B §CHECK constraints under three-valued logic", () => {
  it("membership CHECKs refuse an unknown role/state, a non-positive version and blank identities", async () => {
    await expect(db.exec(`INSERT INTO project_members VALUES ('x1','t','p','${U1}','owner','active',1,now(),now(),'op')`)).rejects.toThrow(/project_members_role_check/);
    await expect(db.exec(`INSERT INTO project_members VALUES ('x2','t','p','${U1}','admin','pending',1,now(),now(),'op')`)).rejects.toThrow(/project_members_state_check/);
    await expect(db.exec(`INSERT INTO project_members VALUES ('x3','t','p','${U1}','admin','active',0,now(),now(),'op')`)).rejects.toThrow(/project_members_version_check/);
    await expect(db.exec(`INSERT INTO project_members VALUES ('x4','   ','p','${U1}','admin','active',1,now(),now(),'op')`)).rejects.toThrow(/project_members_identity_check/);
    await expect(db.exec(`INSERT INTO project_members VALUES ('x5','t','p','${U1}','admin','active',1,now(),now(),NULL)`)).rejects.toThrow(/not-null|null value/i);
    await expect(db.exec(`INSERT INTO project_members VALUES ('m1-dup','tenant-a','proj-1','${U1}','viewer','active',1,now(),now(),'op')`)).rejects.toThrow(/project_members_tenant_project_user_uniq/);
  });

  it("bom ownership is all-or-nothing: fully NULL (quarantined legacy) and fully owned rows pass; a PARTIALLY owned row is refused (IS NOT NULL makes the disjunct FALSE, not UNKNOWN)", async () => {
    const insert = (tenant: string | null, project: string | null, branch: string | null) => db.exec(`INSERT INTO bom_snapshots (project_key, snapshot_data, bom_meta, tenant_id, project_id, branch_id) VALUES ('k', '[]'::jsonb, '{}'::jsonb, ${tenant === null ? "NULL" : `'${tenant}'`}, ${project === null ? "NULL" : `'${project}'`}, ${branch === null ? "NULL" : `'${branch}'`})`);
    await insert(null, null, null);
    await insert("t", "p", "b");
    await expect(insert("t", null, null)).rejects.toThrow(/bom_snapshots_ownership_complete_check/);
    await expect(insert("t", "p", null)).rejects.toThrow(/bom_snapshots_ownership_complete_check/);
    await expect(insert(null, "p", "b")).rejects.toThrow(/bom_snapshots_ownership_complete_check/);
    await expect(insert("t", "p", "  ")).rejects.toThrow(/bom_snapshots_ownership_complete_check/);
    expect((await db.query<{ n: string }>("SELECT count(*)::text AS n FROM bom_snapshots"))[0]!.n).toBe("2");
  });
});
