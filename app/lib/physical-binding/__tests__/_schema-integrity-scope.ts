/**
 * [B24-A4] D24-12, OD-201: the run scope of the opt-in PostgreSQL physical-binding suite (schema-integrity.test.ts).
 *
 * Every row that suite writes carries the run's own tenant prefix (`runScopePrefix`), and its cleanup - moved here from
 * schema-integrity.test.ts:52-60, where five unscoped DELETEs emptied five tables, foreign tenants and the audit table included -
 * deletes only the run's rows, in one transaction, by prefix equality on `tenant_id` (`left(tenant_id, length($1)) = $1`, never LIKE,
 * whose `_` and `%` are wildcards). `physical_readiness_assessments` has no `tenant_id` (drizzle/0022_footprint_binding_stage01.sql,
 * no later ALTER), so its rows go first, by the run's revisions. The binding foreign keys are deferred, so the order inside the
 * transaction only has to leave nothing dangling at commit. `b24-a4-test-isolation` follows this file in its write census.
 *
 * Also the physical-binding aggregate the suite (and the B24-A4 PGlite suites) seed: one candidate, its set, its audit event, one
 * migration record and one readiness assessment, built in memory and committed through the repository under test.
 */
import type { MigrationExecutor } from "../../db/migrations/runner";
import { evaluatePhysicalReadiness } from "../readiness";
import { InMemoryPhysicalBindingRepository, PhysicalBindingService, type PhysicalBindingCommitRequest } from "../repository";
import { physicalBindingDigest } from "../stable";
import type { PhysicalBindingMigrationRecord } from "../types";
import { exactCandidate } from "./fixtures";

/** A run-unique tenant prefix: `<label>.<pid>.<time>.<random>.` (the physical-binding id alphabet: letters, digits and `._:@/+-`). */
export function runScopePrefix(label = "si"): string {
  return `${label}.${process.pid}.${Date.now().toString(36)}.${Math.floor(Math.random() * 36 ** 6).toString(36)}.`;
}

/** The run's rows, and only them: five deletes in one transaction. */
export async function clearRunScope(executor: Pick<MigrationExecutor, "transaction">, prefix: string): Promise<void> {
  if (prefix.length < 8) throw new Error("clearRunScope: a run-unique prefix of at least 8 characters");
  await executor.transaction(async (tx) => {
    await tx.query("DELETE FROM physical_readiness_assessments WHERE binding_revision_id IN (SELECT revision_id FROM physical_binding_revisions WHERE left(tenant_id, length($1)) = $1)", [prefix]);
    await tx.query("DELETE FROM physical_binding_audit_events WHERE left(tenant_id, length($1)) = $1", [prefix]);
    await tx.query("DELETE FROM physical_binding_migration_records WHERE left(tenant_id, length($1)) = $1", [prefix]);
    await tx.query("DELETE FROM physical_binding_sets WHERE left(tenant_id, length($1)) = $1", [prefix]);
    await tx.query("DELETE FROM physical_binding_revisions WHERE left(tenant_id, length($1)) = $1", [prefix]);
  });
}

/** One physical-binding aggregate for `tenantId` (the migration key carries the tenant too: it is the table's primary key). */
export async function physicalBindingAggregate(suffix: string, tenantId: string): Promise<PhysicalBindingCommitRequest> {
  const candidate = exactCandidate(`component-${suffix}`, { candidateKeySuffix: suffix, scopeOverrides: { tenantId } });
  const created = await new PhysicalBindingService(new InMemoryPhysicalBindingRepository()).createCandidate(candidate, `create-${suffix}`);
  const assessment = evaluatePhysicalReadiness(candidate, { assessedAt: candidate.createdAt });
  const migrationBase = {
    schemaVersion: "sirkit.physical-binding-migration.v1" as const,
    migrationKey: `migration-${tenantId}${suffix}`,
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
