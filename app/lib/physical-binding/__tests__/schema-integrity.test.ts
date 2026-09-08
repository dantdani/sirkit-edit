import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres, { type PendingQuery, type Row } from "postgres";
import { getSqlClient } from "../../db/client";
import { databaseQualification } from "../../db/test-qualification";
import { evaluatePhysicalReadiness } from "../readiness";
import { InMemoryPhysicalBindingRepository, PhysicalBindingService, type PhysicalBindingCommitRequest } from "../repository";
import { PostgresPhysicalBindingRepository } from "../server-repository";
import { physicalBindingDigest } from "../stable";
import type { PhysicalBindingMigrationRecord } from "../types";
import { ACTOR, exactCandidate, transition } from "./fixtures";

// B16-B item 5 (LB-4): opt-in via SIRKIT_DB_QUALIFICATION=1 + SIRKIT_DB_QUALIFICATION_URL — never .env.local, never DATABASE_URL.
const databaseUrl = databaseQualification().url;
if (databaseUrl) process.env.DATABASE_URL = databaseUrl;
const sql = databaseUrl ? postgres(databaseUrl, { max: 2, prepare: false, onnotice: () => {} }) : null;
const live = describe.runIf(Boolean(databaseUrl));
// Integration tests over the Supabase session pooler: each commit is several
// network round trips, so the 5 s unit-test default is far too tight.
const DB_TEST_TIMEOUT_MS = 60_000;

const foreignKeys = [
  "physical_binding_set_selected_revision_fk",
  "physical_binding_audit_set_owner_fk",
  "physical_binding_audit_from_revision_owner_fk",
  "physical_binding_audit_to_revision_owner_fk",
  "physical_binding_migration_revision_owner_fk",
  "physical_readiness_revision_owner_fk",
] as const;

const checks = [
  "physical_binding_revision_number_check",
  "physical_binding_revision_lifecycle_check",
  "physical_binding_revision_approval_check",
  "physical_binding_revision_technical_check",
  "physical_binding_revision_freshness_check",
  "physical_binding_revision_conflict_check",
  "physical_binding_revision_applicability_check",
  "physical_binding_revision_identity_check",
  "physical_binding_set_revision_number_check",
  "physical_binding_set_identity_check",
  "physical_binding_audit_action_check",
  "physical_binding_audit_identity_check",
  "physical_binding_migration_status_check",
  "physical_binding_migration_identity_check",
  "physical_readiness_layout_state_check",
  "physical_readiness_manufacturing_state_check",
  "physical_readiness_identity_check",
] as const;

async function clearPhysicalBindingTables(): Promise<void> {
  await sql!.begin(async (tx) => {
    await tx`DELETE FROM physical_binding_audit_events`;
    await tx`DELETE FROM physical_readiness_assessments`;
    await tx`DELETE FROM physical_binding_migration_records`;
    await tx`DELETE FROM physical_binding_sets`;
    await tx`DELETE FROM physical_binding_revisions`;
  });
}

async function aggregate(suffix = "b07"): Promise<PhysicalBindingCommitRequest> {
  const candidate = exactCandidate(`component-${suffix}`, { candidateKeySuffix: suffix });
  const memory = new InMemoryPhysicalBindingRepository();
  const created = await new PhysicalBindingService(memory).createCandidate(candidate, `create-${suffix}`);
  const assessment = evaluatePhysicalReadiness(candidate, { assessedAt: candidate.createdAt });
  const migrationBase = {
    schemaVersion: "sirkit.physical-binding-migration.v1" as const,
    migrationKey: `migration-${suffix}`,
    tenantId: candidate.scope.tenantId,
    projectId: candidate.scope.projectId,
    branchId: candidate.scope.branchId,
    componentInstanceId: candidate.scope.componentInstanceId,
    sourceSchemaVersion: "legacy.v1",
    candidateRevisionId: candidate.revisionId,
    status: "migrated" as const,
    dryRun: false,
    diagnosticCodes: [],
    createdAt: candidate.createdAt,
  };
  const migration: PhysicalBindingMigrationRecord = { ...migrationBase, recordDigest: physicalBindingDigest(migrationBase) };
  const state = { ...created, migrationRecords: [migration], assessments: [assessment] };
  const event = state.auditEvents[0]!;
  return { setId: state.set.setId, expectedRevision: 0, idempotencyKey: event.idempotencyKey, requestDigest: event.requestDigest!, state };
}

async function expectConstraint(query: PendingQuery<Row[]>, name: string): Promise<void> {
  try {
    await query;
    expect.fail(`Expected PostgreSQL constraint ${name}`);
  } catch (error) {
    expect(error).toMatchObject({ constraint_name: name });
  }
}

async function seedValid(suffix: string): Promise<PhysicalBindingCommitRequest> {
  const commit = await aggregate(suffix);
  await new PostgresPhysicalBindingRepository().commit(commit);
  return commit;
}

describe("migration 0025 identity", () => {
  it("is the unique journal successor and keeps SQL/Drizzle constraint names aligned", () => {
    const journal = JSON.parse(readFileSync(join(process.cwd(), "drizzle/meta/_journal.json"), "utf8")) as { entries: Array<{ idx: number; tag: string }> };
    const entries = journal.entries.filter((entry) => entry.tag === "0025_footprint_binding_integrity");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ idx: 25, tag: "0025_footprint_binding_integrity" });
    // 0025 must immediately succeed 0024. Asserted by position relative to
    // 0025 itself rather than to the end of the journal, so adding a later
    // migration cannot break a claim about 0024 → 0025 ordering.
    const index = journal.entries.findIndex((entry) => entry.tag === "0025_footprint_binding_integrity");
    expect(journal.entries[index - 1]?.tag).toBe("0024_footprint_binding_durable_workflow_hardening");
    const migration = readFileSync(join(process.cwd(), "drizzle/0025_footprint_binding_integrity.sql"), "utf8");
    const schema = readFileSync(join(process.cwd(), "app/lib/db/schema.ts"), "utf8");
    for (const name of [...foreignKeys, ...checks]) {
      expect(migration).toContain(name);
      expect(schema).toContain(name);
    }
    for (const marker of ["PB0025_SELECTED_REVISION_OWNER_INVALID", "PB0025_AUDIT_SET_OWNER_INVALID", "PB0025_AUDIT_REVISION_OWNER_INVALID", "PB0025_MIGRATION_REVISION_OWNER_INVALID", "PB0025_ASSESSMENT_REVISION_OWNER_INVALID"]) expect(migration).toContain(marker);
  });
});

live("PostgreSQL physical-binding relational integrity", () => {
  beforeEach(clearPhysicalBindingTables, DB_TEST_TIMEOUT_MS);
  afterAll(async () => {
    await sql?.end({ timeout: 1 });
    await getSqlClient().end({ timeout: 1 });
  });

  it("installs the exact deferred foreign keys and authoritative check constraints", { timeout: DB_TEST_TIMEOUT_MS }, async () => {
    const constraints = await sql!<{ conname: string; contype: string; condeferrable: boolean; condeferred: boolean; confdeltype: string; confupdtype: string; definition: string }[]>`
      SELECT conname, contype, condeferrable, condeferred, confdeltype, confupdtype, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint WHERE conname IN ${sql!([...foreignKeys, ...checks])} ORDER BY conname
    `;
    expect(constraints).toHaveLength(foreignKeys.length + checks.length);
    for (const name of foreignKeys) {
      const constraint = constraints.find((item) => item.conname === name)!;
      expect(constraint).toMatchObject({ contype: "f", condeferrable: true, condeferred: true, confdeltype: "a", confupdtype: "a" });
      expect(constraint.definition).toContain("FOREIGN KEY");
    }
    for (const name of checks) expect(constraints.find((item) => item.conname === name)?.contype).toBe("c");
  });

  it("preserves head-last repository publication, immutable retry, selection, audit, migration, and readiness writes", { timeout: DB_TEST_TIMEOUT_MS }, async () => {
    const commit = await aggregate("valid");
    const repository = new PostgresPhysicalBindingRepository();
    const first = await repository.commit(commit);
    const replay = await repository.commit(structuredClone(commit));
    expect(first.duplicate).toBe(false);
    expect(replay.duplicate).toBe(true);

    const candidate = commit.state.bindings[0]!;
    const selected = await new PhysicalBindingService(repository).transition(commit.setId, {
      ...transition(candidate, 1, "select", ACTOR),
      decisionEvidenceRefs: [candidate.evidenceRefs[0]!],
    });
    expect(selected.set.effectiveSelectedRevisionId).toBe(selected.bindings[0]!.revisionId);
    expect(selected.bindings[0]!.lifecycleState).toBe("selected");

    const counts = await sql!<{ revisions: number; sets: number; audits: number; migrations: number; assessments: number }[]>`
      SELECT
        (SELECT count(*)::int FROM physical_binding_revisions) AS revisions,
        (SELECT count(*)::int FROM physical_binding_sets) AS sets,
        (SELECT count(*)::int FROM physical_binding_audit_events) AS audits,
        (SELECT count(*)::int FROM physical_binding_migration_records) AS migrations,
        (SELECT count(*)::int FROM physical_readiness_assessments) AS assessments
    `;
    expect(counts[0]).toEqual({ revisions: 2, sets: 1, audits: 2, migrations: 1, assessments: 1 });
  });

  it("rejects non-positive revisions and every invalid persisted state vocabulary", { timeout: DB_TEST_TIMEOUT_MS }, async () => {
    await seedValid("states");
    await expectConstraint(sql!`UPDATE physical_binding_revisions SET revision = 0`, "physical_binding_revision_number_check");
    await expectConstraint(sql!`UPDATE physical_binding_sets SET revision = -1`, "physical_binding_set_revision_number_check");
    await expectConstraint(sql!`UPDATE physical_binding_revisions SET lifecycle_state = 'invented'`, "physical_binding_revision_lifecycle_check");
    await expectConstraint(sql!`UPDATE physical_binding_revisions SET approval_state = 'invented'`, "physical_binding_revision_approval_check");
    await expectConstraint(sql!`UPDATE physical_binding_revisions SET technical_state = 'invented'`, "physical_binding_revision_technical_check");
    await expectConstraint(sql!`UPDATE physical_binding_revisions SET freshness_state = 'invented'`, "physical_binding_revision_freshness_check");
    await expectConstraint(sql!`UPDATE physical_binding_revisions SET conflict_state = 'invented'`, "physical_binding_revision_conflict_check");
    await expectConstraint(sql!`UPDATE physical_binding_revisions SET applicability_state = 'invented'`, "physical_binding_revision_applicability_check");
    await expectConstraint(sql!`UPDATE physical_binding_audit_events SET action = 'invented'`, "physical_binding_audit_action_check");
    await expectConstraint(sql!`UPDATE physical_binding_migration_records SET status = 'invented'`, "physical_binding_migration_status_check");
    await expectConstraint(sql!`UPDATE physical_readiness_assessments SET layout_state = 'invented'`, "physical_readiness_layout_state_check");
    await expectConstraint(sql!`UPDATE physical_readiness_assessments SET manufacturing_state = 'invented'`, "physical_readiness_manufacturing_state_check");
  });

  it("rejects orphan and cross-scope selected revisions", { timeout: DB_TEST_TIMEOUT_MS }, async () => {
    await seedValid("selected");
    await expectConstraint(sql!`UPDATE physical_binding_sets SET effective_selected_revision_id = 'missing-revision'`, "physical_binding_set_selected_revision_fk");
    await sql!.unsafe(`
      INSERT INTO physical_binding_revisions
      SELECT 'cross-scope-revision', binding_id || '-cross', lineage_id || '-cross', 1,
        'tenant-other', project_id, branch_id, board_instance_id, component_instance_id, variant_scope_digest,
        technical_digest, record_digest || '-cross', lifecycle_state, approval_state, technical_state,
        freshness_state, conflict_state, applicability_state, binding, created_at, created_by
      FROM physical_binding_revisions LIMIT 1
    `);
    await expectConstraint(sql!`UPDATE physical_binding_sets SET effective_selected_revision_id = 'cross-scope-revision'`, "physical_binding_set_selected_revision_fk");
  });

  it("rejects orphan or mismatched audit, migration, and assessment owners", { timeout: DB_TEST_TIMEOUT_MS }, async () => {
    await seedValid("owners");
    await expectConstraint(sql!`UPDATE physical_binding_audit_events SET aggregate_set_id = 'missing-set'`, "physical_binding_audit_set_owner_fk");
    await expectConstraint(sql!`UPDATE physical_binding_audit_events SET from_revision_id = 'missing-revision'`, "physical_binding_audit_from_revision_owner_fk");
    await expectConstraint(sql!`UPDATE physical_binding_audit_events SET to_revision_id = 'missing-revision'`, "physical_binding_audit_to_revision_owner_fk");
    await expectConstraint(sql!`UPDATE physical_binding_migration_records SET candidate_revision_id = 'missing-revision'`, "physical_binding_migration_revision_owner_fk");
    await expectConstraint(sql!`UPDATE physical_readiness_assessments SET binding_record_digest = 'wrong-digest'`, "physical_readiness_revision_owner_fk");
  });

  it("rolls back valid early rows when a deferred owner violation fails at commit", { timeout: DB_TEST_TIMEOUT_MS }, async () => {
    const commit = await seedValid("rollback");
    await expect(sql!.begin(async (tx) => {
      await tx.unsafe(`
        INSERT INTO physical_binding_revisions
        SELECT 'rollback-revision', binding_id || '-rollback', lineage_id || '-rollback', 1,
          tenant_id, project_id, branch_id, board_instance_id, component_instance_id, variant_scope_digest,
          technical_digest, record_digest || '-rollback', lifecycle_state, approval_state, technical_state,
          freshness_state, conflict_state, applicability_state, binding, created_at, created_by
        FROM physical_binding_revisions LIMIT 1
      `);
      await tx`UPDATE physical_binding_sets SET effective_selected_revision_id = 'missing-at-commit' WHERE set_id = ${commit.setId}`;
    })).rejects.toMatchObject({ constraint_name: "physical_binding_set_selected_revision_fk" });
    expect((await sql!<{ count: number }[]>`SELECT count(*)::int AS count FROM physical_binding_revisions WHERE revision_id = 'rollback-revision'`)[0]!.count).toBe(0);
    expect((await sql!<{ selected: string | null }[]>`SELECT effective_selected_revision_id AS selected FROM physical_binding_sets WHERE set_id = ${commit.setId}`)[0]!.selected).toBeNull();
  });
});
