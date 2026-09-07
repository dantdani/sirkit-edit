/**
 * B16.1B §F — membership migration ↔ runtime schema parity, RLS declaration,
 * and the exact server-derived lookup tuple of the Postgres repository. All
 * offline: the SQL file, the drizzle table definition, and a recording fake
 * database handle. (Whether the migration is APPLIED to a live database is a
 * live check — see `b16-1b-live-qualification.test.ts` and the B16.1B
 * membership-and-rls-proof artifact.)
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const recorder = vi.hoisted(() => ({ where: null as unknown, rows: [] as Array<Record<string, unknown>>, limit: 0 }));
vi.mock("../../db/client", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: (condition: unknown) => ({
          limit: async (n: number) => { recorder.where = condition; recorder.limit = n; return recorder.rows; },
        }),
      }),
    }),
  }),
}));

import { projectMembers } from "../../db/schema";
import { PostgresProjectMembershipRepository } from "../postgres-membership";
import { PROJECT_ROLE_FROM_MEMBERSHIP, projectRoleFromMembership, type ProjectMembershipRecord } from "../project-membership";
import { resolveTrustedRequestContext } from "../trusted-request-context";
import { injectIdentity, injectMembershipRepository, resetInjectedIdentity } from "../test-support";

const ROOT = process.cwd();
const SQL_PATH = join(ROOT, "drizzle", "0027_project_membership.sql");
const sqlText = readFileSync(SQL_PATH, "utf8");
const dialect = new PgDialect();
const cfg = getTableConfig(projectMembers);
const norm = (s: string) => s.replace(/"project_members"\./g, "").replace(/\s+/g, " ").trim().toLowerCase();

afterEach(() => { resetInjectedIdentity(); recorder.where = null; recorder.rows = []; });

describe("B16.1B §F — migration 0027 ↔ drizzle schema parity", () => {
  it("every column (name, type, nullability, default) matches", () => {
    const block = /CREATE TABLE IF NOT EXISTS "project_members" \(([\s\S]*?)\n\);/.exec(sqlText)![1]!;
    const sqlColumns = [...block.matchAll(/^\s*"([a-z_]+)"\s+([a-z ]+?)(?:\s+PRIMARY KEY)?(?:\s+DEFAULT\s+(\S+))?\s+NOT NULL/gm)].map((m) => ({ name: m[1]!, type: m[2]!.trim(), def: m[3] ?? null }));
    expect(sqlColumns.map((c) => c.name)).toEqual(cfg.columns.map((c) => c.name));
    for (const col of cfg.columns) {
      const s = sqlColumns.find((c) => c.name === col.name)!;
      expect(col.notNull, col.name).toBe(true);
      expect(col.getSQLType(), col.name).toBe(s.type);
      expect(col.hasDefault ? String(col.default) : null, col.name).toBe(s.def);
    }
    expect(cfg.columns.find((c) => c.name === "membership_id")!.primary).toBe(true);
    expect(/"membership_id" text PRIMARY KEY NOT NULL/.test(sqlText)).toBe(true);
  });

  it("every CHECK constraint exists by name and the role/state vocabularies match the runtime mapping", () => {
    const sqlChecks = [...sqlText.matchAll(/CONSTRAINT "([a-z_]+)" CHECK/g)].map((m) => m[1]!).sort();
    expect(cfg.checks.map((c) => c.name).sort()).toEqual(sqlChecks);
    const roles = /"role" IN \(([^)]+)\)/.exec(sqlText)![1]!.split(",").map((s) => s.trim().replace(/'/g, ""));
    expect(roles).toEqual(Object.keys(PROJECT_ROLE_FROM_MEMBERSHIP));
    const roleCheck = cfg.checks.find((c) => c.name === "project_members_role_check")!;
    expect(norm(dialect.sqlToQuery(roleCheck.value).sql)).toBe(norm(`"role" IN (${roles.map((r) => `'${r}'`).join(",")})`));
    const states = /"state" IN \(([^)]+)\)/.exec(sqlText)![1]!.split(",").map((s) => s.trim().replace(/'/g, ""));
    expect(states).toEqual(["active", "revoked"]);
  });

  it("the unique (tenant, project, user) index and the lookup index match", () => {
    const sqlIdx = [...sqlText.matchAll(/CREATE (UNIQUE )?INDEX IF NOT EXISTS "([a-z_]+)"\s+ON "project_members" \(([^)]+)\)/g)]
      .map((m) => ({ unique: Boolean(m[1]), name: m[2]!, columns: m[3]!.split(",").map((c) => c.trim().replace(/"/g, "")) }));
    const runtime = cfg.indexes.map((i) => ({ unique: Boolean(i.config.unique), name: i.config.name!, columns: i.config.columns.map((c) => (c as { name: string }).name) }));
    expect(runtime.sort((a, b) => a.name.localeCompare(b.name))).toEqual(sqlIdx.sort((a, b) => a.name.localeCompare(b.name)));
    expect(sqlIdx.find((i) => i.unique)!.columns).toEqual(["tenant_id", "project_id", "user_id"]);
  });

  it("RLS is ENABLED in both, the self-select policy is identical (SELECT, TO authenticated, same predicate), and NO write policy exists for authenticated", () => {
    expect(/ALTER TABLE "project_members" ENABLE ROW LEVEL SECURITY;/.test(sqlText)).toBe(true);
    expect((cfg as unknown as { enableRLS: boolean }).enableRLS).toBe(true);
    const policy = /CREATE POLICY "([a-z_]+)"\s+ON "project_members" FOR (\w+)\s+TO (\w+)\s+USING \(([\s\S]*?)\);/.exec(sqlText)!;
    expect(policy[1]).toBe("project_members_self_select");
    expect(policy[2]).toBe("SELECT");
    expect(policy[3]).toBe("authenticated");
    expect(cfg.policies).toHaveLength(1);
    const runtime = cfg.policies[0]!;
    expect(runtime.name).toBe("project_members_self_select");
    expect(runtime.for).toBe("select");
    expect((runtime.to as { name: string }).name).toBe("authenticated");
    expect(norm(dialect.sqlToQuery(runtime.using as SQL).sql)).toBe(norm(policy[4]!));
    expect(/FOR (INSERT|UPDATE|DELETE|ALL)/.test(sqlText)).toBe(false);
    expect(/\(select auth\.uid\(\)\)::text/.test(policy[4]!)).toBe(true); // authenticated user == row owner, initPlan form
  });

  it("the migration is idempotent and carries a rollback section; drizzle-kit is told the policy role is a Supabase platform role", () => {
    expect(/CREATE TABLE IF NOT EXISTS/.test(sqlText)).toBe(true);
    expect((sqlText.match(/INDEX IF NOT EXISTS/g) ?? []).length).toBe(2);
    expect(/DROP POLICY IF EXISTS "project_members_self_select"/.test(sqlText)).toBe(true);
    expect(/DOWN \(rollback\)/.test(sqlText)).toBe(true);
    const config = readFileSync(join(ROOT, "drizzle.config.ts"), "utf8");
    expect(config).toMatch(/entities:\s*\{\s*roles:\s*\{\s*provider:\s*"supabase"\s*\}\s*\}/);
  });
});

describe("B16.1B §F — PostgresProjectMembershipRepository matches the EXACT server-derived tuple", () => {
  const active: Record<string, unknown> = { membershipId: "m1", tenantId: "tenant-a", projectId: "proj-a", userId: "user-a", role: "editor", state: "active", version: 3, createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-02T00:00:00Z"), auditActorId: "op" };

  it("queries tenant_id AND project_id AND user_id with exactly the input values, LIMIT 1, and maps an active row", async () => {
    recorder.rows = [active];
    const repo = new PostgresProjectMembershipRepository();
    const record = await repo.loadActiveMembership({ tenantId: "tenant-a", projectId: "proj-a", userId: "user-a" });
    const q = dialect.sqlToQuery(recorder.where as SQL);
    expect(norm(q.sql)).toBe(norm('("tenant_id" = $1 and "project_id" = $2 and "user_id" = $3)'));
    expect(q.params).toEqual(["tenant-a", "proj-a", "user-a"]);
    expect(recorder.limit).toBe(1);
    expect(record).toEqual({ tenantId: "tenant-a", projectId: "proj-a", userId: "user-a", role: "editor", state: "active", version: 3, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z", auditActorId: "op" });
  });

  it("a foreign tuple is queried as given (never widened), and a revoked or absent row is null", async () => {
    recorder.rows = [];
    const repo = new PostgresProjectMembershipRepository();
    expect(await repo.loadActiveMembership({ tenantId: "tenant-b", projectId: "proj-b", userId: "user-a" })).toBeNull();
    expect(dialect.sqlToQuery(recorder.where as SQL).params).toEqual(["tenant-b", "proj-b", "user-a"]);
    recorder.rows = [{ ...active, state: "revoked" }];
    expect(await repo.loadActiveMembership({ tenantId: "tenant-a", projectId: "proj-a", userId: "user-a" })).toBeNull();
  });

  it("a malformed stored role fails closed: the repository passes it through and the resolver refuses with 403 AUTH_ROLE_UNMAPPED", async () => {
    expect(projectRoleFromMembership("superuser")).toBeNull();
    expect(projectRoleFromMembership("")).toBeNull();
    injectIdentity({ userId: "user-a" });
    injectMembershipRepository({
      async loadActiveMembership(): Promise<ProjectMembershipRecord | null> {
        return { tenantId: "local", projectId: "proj-a", userId: "user-a", role: "superuser" as ProjectMembershipRecord["role"], state: "active", version: 1, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", auditActorId: "op" };
      },
    });
    const resolved = await resolveTrustedRequestContext(new Request("http://localhost/api/pcb-sync", { headers: { "x-sirkit-project-id": "proj-a" } }));
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) {
      expect(resolved.refusal.response.status).toBe(403);
      expect(await resolved.refusal.response.json()).toMatchObject({ code: "AUTH_ROLE_UNMAPPED" });
    }
  });
});
