/**
 * [B16-B] Executable schema verification: what a migrated database ACTUALLY
 * contains (catalog-derived), canonicalized into a fingerprint so a clean
 * database and an upgraded database can be compared exactly, plus the
 * membership / ownership / RLS criteria the runbook names — evaluated against
 * the catalog, not against TypeScript declarations.
 */

import { createHash } from "node:crypto";
import { compareCodePoints } from "../../stable-compare";
import type { MigrationStatementRunner } from "./runner";

export interface SchemaColumn { table: string; name: string; type: string; nullable: boolean; default: string | null }
export interface SchemaConstraint { table: string; name: string; kind: string; definition: string }
export interface SchemaIndex { table: string; name: string; definition: string }
export interface SchemaPolicy { table: string; name: string; permissive: string; roles: string[]; command: string; using: string | null; withCheck: string | null }
export interface SchemaTable { name: string; rlsEnabled: boolean; rlsForced: boolean }

export interface SchemaSnapshot {
  schemaVersion: "sirkit.db-schema-snapshot.v1";
  extensions: string[];
  tables: SchemaTable[];
  columns: SchemaColumn[];
  constraints: SchemaConstraint[];
  indexes: SchemaIndex[];
  policies: SchemaPolicy[];
}

const EXCLUDED_TABLES = new Set(["sirkit_schema_migrations"]);

function sortBy<T>(items: T[], key: (item: T) => string): T[] {
  return [...items].sort((a, b) => compareCodePoints(key(a), key(b)));
}

/** Read the public schema from the catalog. The migration ledger itself is excluded so fingerprints describe the SCHEMA, not the runner. */
export async function captureSchemaSnapshot(runner: MigrationStatementRunner): Promise<SchemaSnapshot> {
  const extensions = (await runner.query<{ extname: string }>("SELECT extname FROM pg_extension ORDER BY extname")).map((row) => row.extname).filter((name) => name !== "plpgsql");
  const tables = (await runner.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
    "SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname",
  )).filter((row) => !EXCLUDED_TABLES.has(row.relname)).map((row): SchemaTable => ({ name: row.relname, rlsEnabled: Boolean(row.relrowsecurity), rlsForced: Boolean(row.relforcerowsecurity) }));
  const columns = (await runner.query<{ table_name: string; column_name: string; data_type: string; udt_name: string; is_nullable: string; column_default: string | null; character_maximum_length: number | null }>(
    "SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default, character_maximum_length FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position",
  )).filter((row) => !EXCLUDED_TABLES.has(row.table_name)).map((row): SchemaColumn => ({ table: row.table_name, name: row.column_name, type: row.data_type === "USER-DEFINED" ? row.udt_name : row.data_type, nullable: row.is_nullable === "YES", default: row.column_default }));
  const constraints = (await runner.query<{ table: string; name: string; kind: string; definition: string }>(
    "SELECT c.conrelid::regclass::text AS table, c.conname AS name, c.contype AS kind, pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'public' ORDER BY 1, 2",
  )).filter((row) => !EXCLUDED_TABLES.has(row.table.replace(/"/g, "")));
  const indexes = (await runner.query<{ tablename: string; indexname: string; indexdef: string }>(
    "SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY tablename, indexname",
  )).filter((row) => !EXCLUDED_TABLES.has(row.tablename)).map((row): SchemaIndex => ({ table: row.tablename, name: row.indexname, definition: row.indexdef }));
  const policies = (await runner.query<{ tablename: string; policyname: string; permissive: string; roles: string[] | string; cmd: string; qual: string | null; with_check: string | null }>(
    "SELECT tablename, policyname, permissive, roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname",
  )).map((row): SchemaPolicy => ({ table: row.tablename, name: row.policyname, permissive: row.permissive, roles: (Array.isArray(row.roles) ? row.roles : String(row.roles).replace(/[{}]/g, "").split(",")).map((role) => role.trim()).sort(compareCodePoints), command: row.cmd, using: row.qual, withCheck: row.with_check }));
  return {
    schemaVersion: "sirkit.db-schema-snapshot.v1",
    extensions: [...extensions].sort(compareCodePoints),
    tables: sortBy(tables, (item) => item.name),
    columns: sortBy(columns, (item) => `${item.table}\0${item.name}`),
    constraints: sortBy(constraints.map((row) => ({ table: row.table.replace(/"/g, ""), name: row.name, kind: row.kind, definition: row.definition })), (item) => `${item.table}\0${item.name}`),
    indexes: sortBy(indexes, (item) => `${item.table}\0${item.name}`),
    policies: sortBy(policies, (item) => `${item.table}\0${item.name}`),
  };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => compareCodePoints(a, b)).map(([key, child]) => [key, canonical(child)]));
  return value;
}

export function schemaFingerprint(snapshot: SchemaSnapshot): string {
  return `schema1-${createHash("sha256").update(JSON.stringify(canonical(snapshot))).digest("hex")}`;
}

export interface SchemaCriterion { id: string; ok: boolean; detail: string }

/**
 * The runbook's B16-B reproduction list, evaluated against the catalog:
 * membership table, ownership columns, non-null/CHECK constraints, RLS
 * enablement, the exact membership policy, required indexes, and that no
 * policy grants cross-tenant or cross-project access.
 */
export function verifyMembershipAndOwnership(snapshot: SchemaSnapshot): SchemaCriterion[] {
  const rows: SchemaCriterion[] = [];
  const has = (id: string, ok: boolean, detail: string) => rows.push({ id, ok, detail });
  const table = (name: string) => snapshot.tables.find((item) => item.name === name);
  const column = (tableName: string, name: string) => snapshot.columns.find((item) => item.table === tableName && item.name === name);
  const constraint = (tableName: string, name: string) => snapshot.constraints.find((item) => item.table === tableName && item.name === name);
  const index = (tableName: string, name: string) => snapshot.indexes.find((item) => item.table === tableName && item.name === name);

  // project membership
  has("membership.table", Boolean(table("project_members")), "project_members exists");
  for (const name of ["membership_id", "tenant_id", "project_id", "user_id", "role", "state", "version", "created_at", "updated_at", "audit_actor_id"]) {
    const col = column("project_members", name);
    has(`membership.column.${name}.not-null`, Boolean(col) && !col!.nullable, `${name} ${col ? (col.nullable ? "NULLABLE" : "NOT NULL") : "missing"}`);
  }
  has("membership.check.role", /IN \('viewer'|ANY \(ARRAY\['viewer'/.test(constraint("project_members", "project_members_role_check")?.definition ?? ""), constraint("project_members", "project_members_role_check")?.definition ?? "missing");
  has("membership.check.state", /'active'/.test(constraint("project_members", "project_members_state_check")?.definition ?? "") && /'revoked'/.test(constraint("project_members", "project_members_state_check")?.definition ?? ""), constraint("project_members", "project_members_state_check")?.definition ?? "missing");
  has("membership.check.version", /version > 0/.test(constraint("project_members", "project_members_version_check")?.definition ?? ""), constraint("project_members", "project_members_version_check")?.definition ?? "missing");
  has("membership.check.identity", /btrim\(membership_id\)/.test(constraint("project_members", "project_members_identity_check")?.definition ?? ""), constraint("project_members", "project_members_identity_check")?.definition ?? "missing");
  has("membership.index.unique", /UNIQUE INDEX .* \(tenant_id, project_id, user_id\)/.test(index("project_members", "project_members_tenant_project_user_uniq")?.definition ?? ""), index("project_members", "project_members_tenant_project_user_uniq")?.definition ?? "missing");
  has("membership.index.lookup", /\(tenant_id, project_id, user_id, state\)/.test(index("project_members", "project_members_lookup_idx")?.definition ?? ""), index("project_members", "project_members_lookup_idx")?.definition ?? "missing");
  has("membership.rls.enabled", table("project_members")?.rlsEnabled === true, `relrowsecurity=${String(table("project_members")?.rlsEnabled)}`);
  const policies = snapshot.policies.filter((item) => item.table === "project_members");
  const selfSelect = policies.find((item) => item.name === "project_members_self_select");
  has("membership.policy.self-select.exact", Boolean(selfSelect) && selfSelect!.command === "SELECT" && selfSelect!.roles.length === 1 && selfSelect!.roles[0] === "authenticated" && /state = 'active'/.test(selfSelect!.using ?? "") && /auth\.uid\(\)/.test(selfSelect!.using ?? "") && /user_id =/.test(selfSelect!.using ?? ""), selfSelect ? `${selfSelect.command} TO ${selfSelect.roles.join(",")} USING ${selfSelect.using}` : "missing");
  has("membership.policy.no-write-policy", policies.every((item) => item.command === "SELECT"), `commands: ${policies.map((item) => item.command).join(",") || "none"}`);

  // bom ownership
  for (const tableName of ["bom_snapshots", "bom_notifications"]) {
    for (const name of ["tenant_id", "project_id", "branch_id"]) has(`ownership.${tableName}.column.${name}`, Boolean(column(tableName, name)), column(tableName, name) ? "present (nullable by design: legacy rows quarantined)" : "missing");
    const check = constraint(tableName, `${tableName}_ownership_complete_check`);
    has(`ownership.${tableName}.check.complete`, Boolean(check) && /tenant_id IS NOT NULL/.test(check!.definition) && /project_id IS NOT NULL/.test(check!.definition) && /branch_id IS NOT NULL/.test(check!.definition) && /btrim\(tenant_id\) <> ''/.test(check!.definition), check?.definition ?? "missing");
    const owner = index(tableName, `${tableName}_owner_idx`);
    has(`ownership.${tableName}.index.owner`, Boolean(owner) && /\(tenant_id, project_id, branch_id/.test(owner!.definition), owner?.definition ?? "missing");
  }

  // no cross-tenant / cross-project grant: every policy must bind the row to the caller
  for (const policy of snapshot.policies) {
    const predicate = `${policy.using ?? ""} ${policy.withCheck ?? ""}`;
    const bound = /auth\.uid\(\)/.test(predicate) && !/\btrue\b/.test(predicate.replace(/= 'active'/g, ""));
    has(`policy.${policy.table}.${policy.name}.caller-bound`, bound, `${policy.table}.${policy.name}: ${predicate.trim() || "(no predicate)"}`);
  }
  return rows;
}

/**
 * [B19-E E3] The append-only withdrawal record (migration 0030), evaluated against the catalog: the columns and their
 * nullability, the withdrawal-state / reason / successor / human-actor checks, the revision, successor and audit keys, and
 * the one-event-per-state unique index.
 */
export function verifyAtomicRevisionStatusEvents(snapshot: SchemaSnapshot): SchemaCriterion[] {
  const rows: SchemaCriterion[] = [];
  const has = (id: string, ok: boolean, detail: string) => rows.push({ id, ok, detail });
  const TABLE = "atomic_revision_status_events";
  const column = (name: string) => snapshot.columns.find((item) => item.table === TABLE && item.name === name);
  const definition = (name: string) => snapshot.constraints.find((item) => item.table === TABLE && item.name === name)?.definition ?? "";

  has("atomic-status.table", snapshot.tables.some((item) => item.name === TABLE), `${TABLE} exists`);
  for (const [name, nullable] of [["id", false], ["revision_id", false], ["to_state", false], ["successor_revision_id", true], ["actor_id", false], ["actor_role", false], ["reason", false], ["at", false], ["audit_event_id", false]] as const) {
    const col = column(name);
    has(`atomic-status.column.${name}`, Boolean(col) && col!.nullable === nullable && (name !== "at" || col!.type === "timestamp with time zone"), col ? `${col.type} ${col.nullable ? "NULL" : "NOT NULL"}` : "missing");
  }
  const toState = definition("atomic_status_event_to_state_check");
  has("atomic-status.check.to-state", ["deprecated", "superseded", "revoked"].every((state) => toState.includes(`'${state}'`)) && !/'published'/.test(toState), toState || "missing");
  has("atomic-status.check.reason", /btrim\(reason\) <> ''/.test(definition("atomic_status_event_reason_check")), definition("atomic_status_event_reason_check") || "missing");
  has("atomic-status.check.successor", /successor_revision_id IS NULL/.test(definition("atomic_status_event_successor_check")) && /successor_revision_id <> revision_id/.test(definition("atomic_status_event_successor_check")), definition("atomic_status_event_successor_check") || "missing");
  const actor = definition("atomic_status_event_actor_check");
  has("atomic-status.check.actor", /llm\|ocr\|agent/.test(actor) && /'publisher'/.test(actor) && /'admin'/.test(actor) && /btrim\(actor_id\) <> ''/.test(actor), actor || "missing");
  for (const [name, target] of [["atomic_status_event_revision_fk", /FOREIGN KEY \(revision_id\) REFERENCES atomic_part_revisions\(id\)/], ["atomic_status_event_successor_fk", /FOREIGN KEY \(successor_revision_id\) REFERENCES atomic_part_revisions\(id\)/], ["atomic_status_event_audit_fk", /FOREIGN KEY \(audit_event_id\) REFERENCES atomic_audit_events\(id\)/]] as const) {
    has(`atomic-status.fk.${name}`, target.test(definition(name)), definition(name) || "missing");
  }
  const unique = snapshot.indexes.find((item) => item.table === TABLE && item.name === "atomic_status_event_revision_state_uniq")?.definition ?? "";
  has("atomic-status.index.revision-state-unique", /UNIQUE INDEX .* \(revision_id, to_state\)/.test(unique), unique || "missing");
  return rows;
}

/**
 * [B24-A4] D24-3, OD-192: default-deny row security (migration 0031), evaluated against the catalog. Every `public` table in the
 * snapshot has row security (the migration ledger, which the snapshot leaves out, is checked from pg_class by
 * `b24-a4-rls-default-deny`); no table has it forced (the owning server role keeps its owner bypass); policies exist only on
 * `project_members`; and `verifyMembershipAndOwnership` still holds, carried as one row.
 */
export function verifyDefaultDenyRls(snapshot: SchemaSnapshot): SchemaCriterion[] {
  const rows: SchemaCriterion[] = [];
  const has = (id: string, ok: boolean, detail: string) => rows.push({ id, ok, detail });
  for (const table of snapshot.tables) has(`default-deny.rls.${table.name}`, table.rlsEnabled, `relrowsecurity=${String(table.rlsEnabled)}`);
  for (const table of snapshot.tables) has(`default-deny.not-forced.${table.name}`, !table.rlsForced, `relforcerowsecurity=${String(table.rlsForced)}`);
  const elsewhere = snapshot.policies.filter((policy) => policy.table !== "project_members").map((policy) => `${policy.table}.${policy.name}`);
  has("default-deny.policies-only-on-project_members", elsewhere.length === 0, elsewhere.length === 0 ? "policies on project_members only" : `policies elsewhere: ${elsewhere.join(", ")}`);
  const membership = verifyMembershipAndOwnership(snapshot).filter((row) => !row.ok).map((row) => row.id);
  has("default-deny.membership-and-ownership", membership.length === 0, membership.length === 0 ? "verifyMembershipAndOwnership holds" : `failing: ${membership.join(", ")}`);
  return rows;
}
