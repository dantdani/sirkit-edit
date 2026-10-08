/**
 * [B24-A4] Default-deny row security (D24-3 offline, OD-192), proven on PGlite only - never on a live database.
 *
 *  1. the census (red on 3cd7d6e): on a database migrated through the manifest every `public` table has row security - the
 *     migration ledger too, read from pg_class because the snapshot leaves it out (verify-schema.ts:29) - none is forced, and
 *     `verifyDefaultDenyRls` and `verifyMembershipAndOwnership` hold; 0031's list is exactly the catalog's tables but
 *     `project_members`, plus the ledger, and it is registered last;
 *  2. counterexample (red on 3cd7d6e: both roles read the seeded row): with the platform's default grants emulated (INFERRED,
 *     `_b24-a4-data-api.ts`), `anon` and `authenticated` read zero rows of seeded tables and every insert is refused;
 *  3. the `project_members` self-select is unchanged (b16-b-rls-membership.test.ts:40-50): a user reads only their own active
 *     rows, `anon` reads none, and nobody writes;
 *  4. a non-superuser owner (NOLOGIN NOSUPERUSER NOBYPASSRLS) reads and writes the tables it owns - the owner bypass the server's
 *     role relies on (INFERRED for the real platform, LB-14); control, on its own instance: after a test-only FORCE on one table the
 *     same role reads zero rows there, so the case is not vacuous (the PGlite session is a superuser, which bypasses even FORCE);
 *  5. every `pgTable(` declaration in schema.ts carries `.enableRLS()` (143), and schema.ts keeps its line count at 3cd7d6e;
 *  6. a guard, green on 3cd7d6e: no statement in any `.sql` file under drizzle/ (drizzle/rollback/ included) starts with GRANT,
 *     REVOKE or CREATE ROLE or contains FORCE ROW LEVEL SECURITY or BYPASSRLS - comment lines and quoted literals dropped, so 0025's,
 *     0027's and 0030's prose and CHECK literals never trip it;
 *  7. 0031's header states the owner bypass (INFERRED, LB-14), the owner's pre-apply step and where its DOWN is; it has no policy,
 *     no FORCE, no role and no grant;
 *  8. `verifyDefaultDenyRls` refuses a database through 0030 (every table named), a forced table, and a policy off `project_members`;
 *  9. a planted 0031 variant with a GRANT is refused, as is each other forbidden form; a comment, a CHECK literal and DISABLE are not.
 *     [B24-A4 review, 2026-10-08] The guard reads each statement whole, not only its start: a role or grant inside a DO block, dynamic
 *     SQL (EXECUTE of a literal naming one), CREATE USER/GROUP, ALTER ROLE/USER/GROUP, ALTER DEFAULT PRIVILEGES, and statements behind
 *     a block comment or an apostrophe in an inline comment are refused (comments and literals are tokenised, not pattern-blanked).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import { loadMigrationManifest, splitMigrationStatements, truncateManifest, MIGRATION_LEDGER_TABLE } from "../../../db/migrations/manifest";
import { migrateDatabase } from "../../../db/migrations/runner";
import { captureSchemaSnapshot, verifyDefaultDenyRls, verifyMembershipAndOwnership } from "../../../db/migrations/verify-schema";
import { disposablePostgres, PLATFORM_GRANT_SQL, type DisposablePostgres } from "../../../db/disposable-postgres";
import { DATA_API_GRANT_EMULATION_SQL, DATA_API_ROLES, asRole, rowsSeenAs } from "./_b24-a4-data-api";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8").replaceAll(`${CR}${NEWLINE}`, NEWLINE);
const MIGRATION_0031 = "drizzle/0031_rls_default_deny.sql";
/** schema.ts's line count at 3cd7d6e: `.enableRLS()` goes on each declaration's closing line, so no line moves. */
const SCHEMA_LINES_AT_BASE = 1_502;
const U1 = "11111111-1111-1111-1111-111111111111", U2 = "22222222-2222-2222-2222-222222222222";

const open: DisposablePostgres[] = [];
async function migrated(count?: number): Promise<DisposablePostgres> {
  const db = await disposablePostgres();
  open.push(db);
  const manifest = loadMigrationManifest();
  await migrateDatabase(db, { manifest: count === undefined ? manifest : truncateManifest(manifest, count) });
  return db;
}
afterEach(async () => { for (const db of open.splice(0)) await db.close(); });

/** Seed one row in three ordinary tables (one with no primary key) and two memberships, as the superuser. */
async function seed(db: DisposablePostgres): Promise<void> {
  await db.exec(`
    INSERT INTO bom_snapshots (project_key, snapshot_data, bom_meta, tenant_id, project_id, branch_id) VALUES ('k', '[]'::jsonb, '{}'::jsonb, 't', 'p', 'b');
    INSERT INTO libraries (name, main_category) VALUES ('Device', 'Passives');
    INSERT INTO architecture_candidates (candidate_id, tenant_id, project_id, branch_id, lineage_id, revision, candidate_digest, problem_digest, structural_signature, status, candidate) VALUES ('c1', 't', 'p', 'b', 'l1', 1, 'cd1', 'pd1', 's1', 'proposed', '{}'::jsonb);
    INSERT INTO project_members VALUES ('m1','t','p','${U1}','admin','active',1,now(),now(),'operator');
    INSERT INTO project_members VALUES ('m2','t','p','${U2}','viewer','revoked',1,now(),now(),'operator');
  `);
}
const SEEDED = ["bom_snapshots", "libraries", "architecture_candidates"] as const;
const INSERTS: Record<(typeof SEEDED)[number], string> = {
  bom_snapshots: "INSERT INTO bom_snapshots (project_key, snapshot_data, bom_meta) VALUES ('x', '[]'::jsonb, '{}'::jsonb)",
  libraries: "INSERT INTO libraries (name, main_category) VALUES ('Planted', 'X')",
  architecture_candidates: "INSERT INTO architecture_candidates (candidate_id, tenant_id, project_id, branch_id, lineage_id, revision, candidate_digest, problem_digest, structural_signature, status, candidate) VALUES ('c9', 't', 'p', 'b', 'l9', 1, 'cd9', 'pd9', 's9', 'proposed', '{}'::jsonb)",
};

/** The ALTER TABLE list of a migration text, in file order. */
const alteredTables = (text: string): string[] => [...text.matchAll(/^ALTER TABLE "([a-z0-9_]+)" ENABLE ROW LEVEL SECURITY;$/gm)].map((match) => match[1]!);

/** [B24-A4 review, 2026-10-08] One SQL text tokenised: its code with every comment (`--` to the line's end, nested block comments)
 *  removed and every single-quoted literal (an `E'...'` one with its backslash escapes) replaced by `''`, plus the literals' contents.
 *  Dollar-quoted text stays code: it is a DO block's body here, and reading it as code fails closed. */
function sqlCode(text: string): { code: string; literals: string[] } {
  let code = "";
  const literals: string[] = [];
  for (let index = 0; index < text.length; ) {
    const two = text.slice(index, index + 2);
    if (two === "--") {
      const end = text.indexOf(NEWLINE, index);
      index = end === -1 ? text.length : end;
    } else if (two === "/*") {
      let depth = 0;
      do {
        if (text.startsWith("/*", index)) { depth += 1; index += 2; } else if (text.startsWith("*/", index)) { depth -= 1; index += 2; } else index += 1;
      } while (depth > 0 && index < text.length);
      code += " ";
    } else if (text[index] === "'") {
      const escaped = /[eE]$/.test(code) && !/[A-Za-z0-9_][eE]$/.test(code);
      let literal = "";
      index += 1;
      while (index < text.length) {
        if (escaped && text[index] === "\\") { literal += text.slice(index, index + 2); index += 2; continue; }
        if (text[index] === "'") { if (text[index + 1] === "'") { literal += "'"; index += 2; continue; } index += 1; break; }
        literal += text[index];
        index += 1;
      }
      literals.push(literal);
      code += "''";
    } else {
      code += text[index];
      index += 1;
    }
  }
  return { code, literals };
}

/** Role and privilege statements, anywhere in a statement (case-insensitive): GRANT, REVOKE, CREATE/ALTER ROLE, USER or GROUP,
 *  ALTER DEFAULT PRIVILEGES, FORCE ROW LEVEL SECURITY, BYPASSRLS. */
const FORBIDDEN_ROLE_FORMS = /\bGRANT\b|\bREVOKE\b|\b(?:CREATE|ALTER)\s+(?:ROLE|USER|GROUP)\b|\bALTER\s+DEFAULT\s+PRIVILEGES\b|\bFORCE\s+ROW\s+LEVEL\s+SECURITY\b|\bBYPASSRLS\b/i;

/** The guard's reading of one SQL text: statements (split as the runner splits, then on `;`), comments and literals dropped by
 *  `sqlCode`; a statement holding a forbidden form ANYWHERE - not only at its start, so a DO block's body counts - is returned, and
 *  so is dynamic SQL (EXECUTE) whose literal names one. ([B24-A4 review, 2026-10-08]: was a statement-start match over
 *  pattern-blanked text, which missed a DO block, CREATE USER, ALTER DEFAULT PRIVILEGES, a block comment and an inline apostrophe.) */
function forbiddenRoleStatements(text: string): string[] {
  const hits: string[] = [];
  for (const chunk of splitMigrationStatements(text)) {
    const { code, literals } = sqlCode(chunk);
    for (const statement of code.split(";").map((part) => part.trim()).filter(Boolean)) {
      if (FORBIDDEN_ROLE_FORMS.test(statement)) hits.push(statement.replace(/\s+/g, " ").slice(0, 120));
    }
    if (/\bEXECUTE\b/i.test(code)) for (const literal of literals) if (FORBIDDEN_ROLE_FORMS.test(literal)) hits.push(`EXECUTE '${literal.replace(/\s+/g, " ").slice(0, 100)}'`);
  }
  return hits;
}

function sqlFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sqlFiles(full, out);
    else if (entry.endsWith(".sql")) out.push(relative(ROOT, full).split(sep).join("/"));
  }
  return out;
}

describe("[B24-A4] default-deny row security (D24-3 offline, OD-192)", () => {
  it("1. the census (red on 3cd7d6e): every public table, the ledger included (read from pg_class), has row security and none is forced; verifyDefaultDenyRls and verifyMembershipAndOwnership hold; 0031's list is the catalog's tables but project_members, plus the ledger", { timeout: 120_000 }, async () => {
    const db = await migrated();
    const catalog = await db.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>("SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname");
    expect(catalog.length).toBe(144); // 143 schema tables + the runner's ledger
    expect(catalog.filter((row) => !row.relrowsecurity).map((row) => row.relname)).toEqual([]);
    expect(catalog.filter((row) => row.relforcerowsecurity).map((row) => row.relname)).toEqual([]);
    expect(catalog.some((row) => row.relname === MIGRATION_LEDGER_TABLE)).toBe(true);
    const snapshot = await captureSchemaSnapshot(db);
    expect(verifyDefaultDenyRls(snapshot).filter((row) => !row.ok)).toEqual([]);
    expect(verifyMembershipAndOwnership(snapshot).filter((row) => !row.ok)).toEqual([]);
    const manifest = loadMigrationManifest();
    expect(manifest.entries.at(-1)?.name).toBe("0031_rls_default_deny");
    const listed = alteredTables(read(MIGRATION_0031));
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual(catalog.map((row) => row.relname).filter((name) => name !== "project_members").sort());
    expect(listed.at(-1)).toBe(MIGRATION_LEDGER_TABLE);
  });

  it("2. counterexample (red on 3cd7d6e, where both roles read the seeded row): with the platform's default grants emulated, anon and authenticated read zero rows of every seeded table and every insert is refused", { timeout: 120_000 }, async () => {
    const db = await migrated();
    await db.exec(DATA_API_GRANT_EMULATION_SQL);
    await seed(db);
    for (const role of DATA_API_ROLES) {
      for (const table of SEEDED) expect(await rowsSeenAs(db, role, table), `${role} reads ${table}`).toBe(0);
      for (const table of SEEDED) await expect(asRole(db, role, () => db.exec(INSERTS[table])), `${role} inserts into ${table}`).rejects.toThrow(/row-level security/);
    }
    // the superuser (the owner here) still sees every seeded row, and the refused inserts left nothing
    for (const table of SEEDED) expect((await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`))[0]!.n, table).toBe(1);
  });

  it("3. the project_members self-select is unchanged (b16-b-rls-membership.test.ts:40-50): a user reads only their own active row, anon reads none, nobody writes", { timeout: 120_000 }, async () => {
    const db = await migrated();
    await db.exec(PLATFORM_GRANT_SQL);
    await db.exec(DATA_API_GRANT_EMULATION_SQL);
    await seed(db);
    expect((await db.asAuthenticated(U1, (runner) => runner.query<{ membership_id: string }>("SELECT membership_id FROM project_members ORDER BY membership_id"))).map((row) => row.membership_id)).toEqual(["m1"]);
    expect(await db.asAuthenticated(U2, (runner) => runner.query("SELECT membership_id FROM project_members"))).toEqual([]);
    expect(await rowsSeenAs(db, "anon", "project_members")).toBe(0);
    await expect(db.asAuthenticated(U1, (runner) => runner.exec(`INSERT INTO project_members VALUES ('m9','t','p','${U1}','admin','active',1,now(),now(),'self')`))).rejects.toThrow(/row-level security/);
    const policies = (await captureSchemaSnapshot(db)).policies.map((policy) => `${policy.table}.${policy.name} ${policy.command} ${policy.roles.join(",")}`);
    expect(policies).toEqual(["project_members.project_members_self_select SELECT authenticated"]);
  });

  it("4. a non-superuser owner (NOLOGIN NOSUPERUSER NOBYPASSRLS) reads and writes the tables it owns; control: after a test-only FORCE on one table, on its own instance, the same role reads zero rows there", { timeout: 180_000 }, async () => {
    const OWNER_SQL = "CREATE ROLE sirkit_test_owner NOLOGIN NOSUPERUSER NOBYPASSRLS; ALTER TABLE bom_snapshots OWNER TO sirkit_test_owner; ALTER TABLE libraries OWNER TO sirkit_test_owner;";
    const db = await migrated();
    await seed(db);
    await db.exec(OWNER_SQL);
    expect((await db.query<{ rolsuper: boolean; rolbypassrls: boolean }>("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'sirkit_test_owner'"))[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    await asRole(db, "sirkit_test_owner", async () => { await db.exec(INSERTS.bom_snapshots); await db.exec(INSERTS.libraries); });
    expect(await rowsSeenAs(db, "sirkit_test_owner", "bom_snapshots")).toBe(2);
    expect(await rowsSeenAs(db, "sirkit_test_owner", "libraries")).toBe(2);
    const control = await migrated();
    await seed(control);
    await control.exec(`${OWNER_SQL} ALTER TABLE libraries FORCE ROW LEVEL SECURITY;`);
    expect(await rowsSeenAs(control, "sirkit_test_owner", "libraries")).toBe(0);
    expect(await rowsSeenAs(control, "sirkit_test_owner", "bom_snapshots")).toBe(1);
    await expect(asRole(control, "sirkit_test_owner", () => control.exec(INSERTS.libraries))).rejects.toThrow(/row-level security/);
  });

  it("5. every pgTable( declaration in schema.ts carries .enableRLS() (143), on its closing line: schema.ts keeps its 1,502 lines", () => {
    const text = read("app/lib/db/schema.ts");
    expect(text.split(NEWLINE).length - 1).toBe(SCHEMA_LINES_AT_BASE);
    const source = ts.createSourceFile("schema.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const declarations: Array<{ name: string; rls: boolean }> = [];
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "pgTable") {
        const parent = node.parent;
        const rls = ts.isPropertyAccessExpression(parent) && parent.name.text === "enableRLS" && ts.isCallExpression(parent.parent) && parent.parent.arguments.length === 0;
        const name = node.arguments[0] && ts.isStringLiteral(node.arguments[0]) ? node.arguments[0].text : "?";
        declarations.push({ name, rls });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(declarations).toHaveLength(143);
    expect(declarations.filter((declaration) => !declaration.rls).map((declaration) => declaration.name)).toEqual([]);
    expect((text.match(/\.enableRLS\(\)/g) ?? []).length).toBe(143);
  });

  it("6. a guard (green on 3cd7d6e): no statement in any .sql file under drizzle/, drizzle/rollback/ included, grants, revokes, creates a role, forces row security or names BYPASSRLS - comment lines and literals dropped", () => {
    const files = sqlFiles(join(ROOT, "drizzle"));
    expect(files.length).toBeGreaterThanOrEqual(31);
    const hits = files.flatMap((file) => forbiddenRoleStatements(read(file)).map((hit) => `${file}: ${hit}`));
    expect(hits).toEqual([]);
    // a plain word match would be red for ever: these files already say grant, revoke and revoked in prose or literals
    for (const file of ["drizzle/0025_footprint_binding_integrity.sql", "drizzle/0027_project_membership.sql", "drizzle/0030_atomic_revision_status_events.sql"]) expect(read(file), file).toMatch(/grant|revok/i);
  });

  it("7. 0031's header states the owner bypass (INFERRED, LB-14), the owner's pre-apply step and its way back; it carries no policy, no FORCE, no role and no grant - only ENABLE ROW LEVEL SECURITY, one per listed table", () => {
    const text = read(MIGRATION_0031);
    const header = text.split(NEWLINE).filter((line) => line.startsWith("--")).join(NEWLINE);
    for (const fact of ["owner", "INFERRED", "LB-14", "pre-apply", "rolbypassrls", "relowner", "drizzle/rollback/0031_rls_default_deny.down.sql", "--rollback 0031_rls_default_deny", "OD-192"]) expect(header, fact).toContain(fact);
    const statements = splitMigrationStatements(text).map((chunk) => chunk.split(NEWLINE).filter((line) => !line.startsWith("--")).join(NEWLINE).trim()).filter(Boolean);
    expect(statements.every((statement) => /^ALTER TABLE "[a-z0-9_]+" ENABLE ROW LEVEL SECURITY;$/.test(statement)), statements.find((statement) => !/^ALTER TABLE "[a-z0-9_]+" ENABLE ROW LEVEL SECURITY;$/.test(statement))).toBe(true);
    expect(statements).toHaveLength(143);
    expect(statements.join(NEWLINE)).not.toMatch(/POLICY|GRANT|REVOKE|ROLE\b|FORCE|BYPASSRLS/i);
  });

  it("8. verifyDefaultDenyRls refuses a database through 0030 (every table named), a forced table, and a policy off project_members", { timeout: 180_000 }, async () => {
    const before = await migrated(31);
    const failed = verifyDefaultDenyRls(await captureSchemaSnapshot(before)).filter((row) => !row.ok).map((row) => row.id);
    expect(failed).toHaveLength(142);
    expect(failed).toContain("default-deny.rls.bom_snapshots");
    expect(failed).not.toContain("default-deny.rls.project_members");
    const db = await migrated();
    await db.exec("ALTER TABLE libraries FORCE ROW LEVEL SECURITY; CREATE POLICY libraries_open ON libraries FOR SELECT TO authenticated USING (true);");
    const ids = verifyDefaultDenyRls(await captureSchemaSnapshot(db)).filter((row) => !row.ok).map((row) => row.id).sort();
    // the open policy also breaks verifyMembershipAndOwnership's caller-bound rule, which the default-deny check carries as one row
    expect(ids).toEqual(["default-deny.membership-and-ownership", "default-deny.not-forced.libraries", "default-deny.policies-only-on-project_members"]);
  });

  it("9. a planted 0031 variant with a GRANT is refused, as is each other forbidden form; a comment, a CHECK literal and DISABLE are not", () => {
    const base = read(MIGRATION_0031);
    const planted = (statement: string): string => `${base}${NEWLINE}--> statement-breakpoint${NEWLINE}${statement}${NEWLINE}`;
    expect(forbiddenRoleStatements(planted("GRANT SELECT ON x TO anon;"))).toEqual(["GRANT SELECT ON x TO anon"]);
    for (const statement of ["revoke all on x from anon;", "CREATE ROLE sirkit_app LOGIN;", "ALTER TABLE \"x\" FORCE ROW LEVEL SECURITY;", "ALTER ROLE sirkit_app BYPASSRLS;", "ALTER TABLE \"x\" ENABLE ROW LEVEL SECURITY; GRANT ALL ON x TO authenticated;"]) {
      expect(forbiddenRoleStatements(planted(statement)), statement).toHaveLength(1);
    }
    for (const harmless of ["-- grant select on x to anon (a comment)", "ALTER TABLE \"x\" ADD CONSTRAINT x_state CHECK (state IN ('revoked', 'GRANT'));", "ALTER TABLE \"x\" DISABLE ROW LEVEL SECURITY;"]) {
      expect(forbiddenRoleStatements(planted(harmless)), harmless).toEqual([]);
    }
    // [B24-A4 review, 2026-10-08] the forms a statement-start match missed: a role or a grant inside a DO block (the idiom of
    // _b24-a4-data-api.ts itself, and DO blocks are a migration form here, 0024 and 0025), dynamic SQL, CREATE USER, ALTER ROLE,
    // ALTER DEFAULT PRIVILEGES, a statement behind a block comment, and one hidden by an apostrophe in an inline comment
    const forbidden = [
      DATA_API_GRANT_EMULATION_SQL.split(NEWLINE).find((line) => line.startsWith("DO $$"))!,
      "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sirkit_app') THEN CREATE ROLE sirkit_app NOLOGIN; END IF; END $$;",
      "DO $$ BEGIN GRANT SELECT ON x TO anon; END $$;",
      "DO $$ BEGIN EXECUTE 'GRANT SELECT ON x TO anon'; END $$;",
      "DO $$ BEGIN EXECUTE format('GRANT SELECT ON %I TO anon', 'x'); END $$;",
      "CREATE USER sirkit_app LOGIN;",
      "create group sirkit_apps;",
      "ALTER ROLE authenticated SET statement_timeout = 0;",
      "ALTER USER sirkit_app NOLOGIN;",
      "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO anon;",
      "/* a block comment */ GRANT SELECT ON x TO anon;",
      `ALTER TABLE "x" ENABLE ROW LEVEL SECURITY; -- the owner's step${NEWLINE}GRANT SELECT ON x TO anon; -- it's planted`,
    ];
    for (const statement of forbidden) expect(forbiddenRoleStatements(planted(statement)).length, statement).toBeGreaterThan(0);
    for (const harmless of ["-- it's a comment that says grant select on x to anon", "/* grant select on x to anon */", "ALTER TABLE \"x\" ADD COLUMN \"grantee_note\" text;", "COMMENT ON TABLE \"x\" IS 'revoke and grant are only words here';", "DO $$ BEGIN RAISE EXCEPTION USING MESSAGE = 'grant revoked'; END $$;"]) {
      expect(forbiddenRoleStatements(planted(harmless)), harmless).toEqual([]);
    }
  });
});
