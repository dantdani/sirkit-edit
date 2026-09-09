import { and, eq, inArray, isNotNull, or } from "drizzle-orm";
import { getDb } from "../db/client";
import {
  physicalBindingAuditEvents,
  physicalBindingMigrationRecords,
  physicalBindingRevisions,
  physicalBindingSets,
  physicalReadinessAssessments,
} from "../db/schema";
import { physicalBindingDigest } from "./stable";
import { assertPhysicalBindingReplay, type PhysicalBindingAggregateState, type PhysicalBindingCommitRequest, type PhysicalBindingRepository } from "./repository";
import { compareCodePoints } from "@/app/lib/stable-compare";

import { fixtureContainer } from "../fixture-runtime/container";
import { fixtureRuntimeEnabled } from "../fixture-runtime/mode";
function date(value: string, code: string): Date {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error(code);
  return parsed;
}

function required(value: string | undefined, code: string): string {
  if (!value?.trim()) throw new Error(code);
  return value;
}

export type PhysicalBindingImmutableRowFamily = "binding" | "audit" | "migration" | "assessment";

function persistenceValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(persistenceValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, persistenceValue(child)]));
  return value;
}

export function assertImmutablePhysicalBindingRow(family: PhysicalBindingImmutableRowFamily, intended: unknown, existing: unknown): void {
  if (!existing || physicalBindingDigest(persistenceValue(intended)) !== physicalBindingDigest(persistenceValue(existing))) {
    throw new Error(`PB_IMMUTABLE_${family.toUpperCase()}_CONFLICT`);
  }
}

function bindingRow(binding: PhysicalBindingAggregateState["bindings"][number]) {
  return {
    revisionId: binding.revisionId, bindingId: binding.bindingId, lineageId: binding.lineageId, revision: binding.revision,
    tenantId: binding.scope.tenantId, projectId: binding.scope.projectId, branchId: binding.scope.branchId, boardInstanceId: binding.scope.boardInstanceId, componentInstanceId: binding.scope.componentInstanceId,
    variantScopeDigest: physicalBindingDigest(binding.scope.assemblyVariantIds), technicalDigest: binding.technicalDigest, recordDigest: binding.recordDigest,
    lifecycleState: binding.lifecycleState, approvalState: binding.approval.state, technicalState: binding.technicalValidation.state, freshnessState: binding.freshness.state, conflictState: binding.conflict.state, applicabilityState: binding.applicabilityState,
    binding, createdAt: date(binding.createdAt, "PB_BINDING_TIMESTAMP_INVALID"), createdBy: binding.createdBy.actorId,
  };
}

function auditRow(event: PhysicalBindingAggregateState["auditEvents"][number]) {
  return { eventId: event.eventId, aggregateSetId: required(event.aggregateSetId, "PB_AUDIT_SET_OWNER_REQUIRED"), fromRevisionId: required(event.fromRevisionId, "PB_AUDIT_FROM_REVISION_REQUIRED"), toRevisionId: required(event.toRevisionId, "PB_AUDIT_TO_REVISION_REQUIRED"), tenantId: event.tenantId, projectId: event.projectId, branchId: event.branchId, componentInstanceId: event.componentInstanceId, bindingId: event.bindingId, action: event.action, idempotencyKey: event.idempotencyKey, eventDigest: event.eventDigest, event, occurredAt: date(event.occurredAt, "PB_AUDIT_TIMESTAMP_INVALID") };
}

function migrationRow(record: PhysicalBindingAggregateState["migrationRecords"][number]) {
  return { migrationKey: record.migrationKey, tenantId: record.tenantId, projectId: record.projectId, branchId: record.branchId, componentInstanceId: record.componentInstanceId, sourceSchemaVersion: record.sourceSchemaVersion, candidateRevisionId: record.candidateRevisionId, status: record.status, dryRun: record.dryRun, recordDigest: record.recordDigest, record, createdAt: date(record.createdAt, "PB_MIGRATION_TIMESTAMP_INVALID") };
}

function assessmentRow(assessment: PhysicalBindingAggregateState["assessments"][number]) {
  return { assessmentId: assessment.assessmentId, bindingRevisionId: assessment.bindingRevisionId, bindingRecordDigest: assessment.bindingRecordDigest, policyVersion: assessment.policyVersion, layoutState: assessment.layout, manufacturingState: assessment.manufacturing, assessmentDigest: assessment.assessmentDigest, assessment, assessedAt: date(assessment.assessedAt, "PB_ASSESSMENT_TIMESTAMP_INVALID") };
}

/** PostgreSQL adapter. Immutable revisions/audits are insert-only; the small set head is the optimistic-lock row. */
export class PostgresPhysicalBindingRepository implements PhysicalBindingRepository {
  constructor() {
    // [B16-C §5] every server composition root constructs its own adapter over the same
    // PostgreSQL; under the env-gated fixture runtime (non-production, local_dev only) all of
    // them resolve to ONE shared in-memory store so a dev server can host the browser proof.
    if (fixtureRuntimeEnabled()) return fixtureContainer().physicalBindingRepository as unknown as PostgresPhysicalBindingRepository;
  }
  async load(setId: string): Promise<PhysicalBindingAggregateState | null> {
    const db = getDb();
    const setRow = (await db.select().from(physicalBindingSets).where(eq(physicalBindingSets.setId, setId)).limit(1))[0];
    if (!setRow) return null;
    const revisionIds = setRow.bindingSet.candidateRevisionIds;
    const [bindingRows, auditRows, migrationRows, assessmentRows] = await Promise.all([
      revisionIds.length ? db.select().from(physicalBindingRevisions).where(inArray(physicalBindingRevisions.revisionId, revisionIds)) : [],
      db.select().from(physicalBindingAuditEvents).where(eq(physicalBindingAuditEvents.aggregateSetId, setRow.setId)),
      revisionIds.length ? db.select().from(physicalBindingMigrationRecords).where(inArray(physicalBindingMigrationRecords.candidateRevisionId, revisionIds)) : [],
      revisionIds.length ? db.select().from(physicalReadinessAssessments).where(inArray(physicalReadinessAssessments.bindingRevisionId, revisionIds)) : [],
    ]);
    return {
      set: setRow.bindingSet,
      bindings: bindingRows.map((row) => row.binding).sort((a, b) => compareCodePoints(a.revisionId, b.revisionId)),
      auditEvents: auditRows.map((row) => row.event).sort((a, b) => compareCodePoints(a.occurredAt, b.occurredAt) || compareCodePoints(a.eventId, b.eventId)),
      migrationRecords: migrationRows.map((row) => row.record).sort((a, b) => compareCodePoints(a.migrationKey, b.migrationKey)),
      assessments: assessmentRows.map((row) => row.assessment).sort((a, b) => compareCodePoints(a.assessedAt, b.assessedAt) || compareCodePoints(a.assessmentId, b.assessmentId)),
    };
  }

  async findForComponentVariant(scope: Omit<PhysicalBindingAggregateState["set"]["scope"], "assemblyVariantIds"> & { assemblyVariantId: string }): Promise<PhysicalBindingAggregateState[]> {
    const db = getDb();
    const rows = await db.select({ setId: physicalBindingSets.setId }).from(physicalBindingSets).where(and(
      eq(physicalBindingSets.tenantId, scope.tenantId), eq(physicalBindingSets.projectId, scope.projectId), eq(physicalBindingSets.branchId, scope.branchId),
      eq(physicalBindingSets.boardInstanceId, scope.boardInstanceId), eq(physicalBindingSets.componentInstanceId, scope.componentInstanceId),
    ));
    const loaded = await Promise.all(rows.map((row) => this.load(row.setId)));
    return loaded.filter((state): state is PhysicalBindingAggregateState => Boolean(state))
      .filter((state) => state.set.scope.hierarchyPath.join("\0") === scope.hierarchyPath.join("\0") && (state.set.scope.assemblyVariantIds.length === 0 || state.set.scope.assemblyVariantIds.includes(scope.assemblyVariantId)))
      .sort((a, b) => compareCodePoints(a.set.setId, b.set.setId));
  }

  async listSelectedPeers(scope: PhysicalBindingAggregateState["set"]["scope"]): Promise<PhysicalBindingAggregateState["bindings"]> {
    const db = getDb();
    const sets = await db.select({ revisionId: physicalBindingSets.effectiveSelectedRevisionId }).from(physicalBindingSets).where(and(
      eq(physicalBindingSets.tenantId, scope.tenantId), eq(physicalBindingSets.projectId, scope.projectId), eq(physicalBindingSets.branchId, scope.branchId),
      eq(physicalBindingSets.boardInstanceId, scope.boardInstanceId), eq(physicalBindingSets.componentInstanceId, scope.componentInstanceId), isNotNull(physicalBindingSets.effectiveSelectedRevisionId),
    ));
    const revisionIds = sets.map((row) => row.revisionId).filter((value): value is string => Boolean(value));
    if (!revisionIds.length) return [];
    const rows = await db.select({ binding: physicalBindingRevisions.binding }).from(physicalBindingRevisions).where(inArray(physicalBindingRevisions.revisionId, revisionIds));
    return rows.map((row) => row.binding).sort((a, b) => compareCodePoints(a.revisionId, b.revisionId));
  }

  async commit(input: PhysicalBindingCommitRequest): Promise<{ state: PhysicalBindingAggregateState; duplicate: boolean }> {
    const db = getDb();
    const scope = input.state.set.scope;
    const findReplay = async () => (await db.select().from(physicalBindingAuditEvents).where(and(eq(physicalBindingAuditEvents.tenantId, scope.tenantId), eq(physicalBindingAuditEvents.projectId, scope.projectId), eq(physicalBindingAuditEvents.branchId, scope.branchId), eq(physicalBindingAuditEvents.idempotencyKey, input.idempotencyKey))).limit(1))[0];
    const duplicate = await findReplay();
    if (duplicate) {
      assertPhysicalBindingReplay(duplicate.event, input);
      const intended = input.state.auditEvents.find((event) => event.idempotencyKey === input.idempotencyKey);
      if (intended) assertImmutablePhysicalBindingRow("audit", auditRow(intended), duplicate);
      const state = await this.load(input.setId);
      if (!state) throw new Error("PB_IDEMPOTENT_COMMIT_STATE_MISSING");
      return { state, duplicate: true };
    }
    try {
      await db.transaction(async (tx) => {
        const current = (await tx.select({ revision: physicalBindingSets.revision }).from(physicalBindingSets).where(eq(physicalBindingSets.setId, input.setId)).limit(1))[0];
        const actualRevision = current?.revision ?? 0;
        if (actualRevision !== input.expectedRevision) throw new Error(`PB_OPTIMISTIC_LOCK_CONFLICT:${actualRevision}`);

        // Immutable families are insert-only. Batch-insert each family once;
        // rows the insert skipped must already exist byte-for-byte (any
        // non-identical conflict — same primary key OR any secondary unique
        // index — fails the digest comparison and throws the same
        // PB_IMMUTABLE_*_CONFLICT the per-row probe raised).
        {
          const intendedRows = input.state.bindings.map(bindingRow);
          const inserted = intendedRows.length ? await tx.insert(physicalBindingRevisions).values(intendedRows).onConflictDoNothing().returning({ id: physicalBindingRevisions.revisionId }) : [];
          const insertedIds = new Set(inserted.map((row) => row.id));
          const missing = intendedRows.filter((row) => !insertedIds.has(row.revisionId));
          if (missing.length) {
            const existingRows = await tx.select().from(physicalBindingRevisions).where(inArray(physicalBindingRevisions.revisionId, missing.map((row) => row.revisionId)));
            const byId = new Map(existingRows.map((row) => [row.revisionId, row]));
            for (const intended of missing) assertImmutablePhysicalBindingRow("binding", intended, byId.get(intended.revisionId));
          }
        }
        {
          const intendedRows = input.state.auditEvents.map(auditRow);
          const inserted = intendedRows.length ? await tx.insert(physicalBindingAuditEvents).values(intendedRows).onConflictDoNothing().returning({ id: physicalBindingAuditEvents.eventId }) : [];
          const insertedIds = new Set(inserted.map((row) => row.id));
          const missing = intendedRows.filter((row) => !insertedIds.has(row.eventId));
          if (missing.length) {
            const existingRows = await tx.select().from(physicalBindingAuditEvents).where(or(
              inArray(physicalBindingAuditEvents.eventId, missing.map((row) => row.eventId)),
              and(eq(physicalBindingAuditEvents.tenantId, scope.tenantId), eq(physicalBindingAuditEvents.projectId, scope.projectId), eq(physicalBindingAuditEvents.branchId, scope.branchId), inArray(physicalBindingAuditEvents.idempotencyKey, missing.map((row) => row.idempotencyKey))),
            ));
            for (const intended of missing) {
              const existing = existingRows.find((row) => row.eventId === intended.eventId) ?? existingRows.find((row) => row.idempotencyKey === intended.idempotencyKey);
              if (existing?.idempotencyKey === input.idempotencyKey) assertPhysicalBindingReplay(existing.event, input);
              assertImmutablePhysicalBindingRow("audit", intended, existing);
            }
          }
        }
        {
          const intendedRows = input.state.migrationRecords.map(migrationRow);
          const inserted = intendedRows.length ? await tx.insert(physicalBindingMigrationRecords).values(intendedRows).onConflictDoNothing().returning({ id: physicalBindingMigrationRecords.migrationKey }) : [];
          const insertedIds = new Set(inserted.map((row) => row.id));
          const missing = intendedRows.filter((row) => !insertedIds.has(row.migrationKey));
          if (missing.length) {
            const existingRows = await tx.select().from(physicalBindingMigrationRecords).where(inArray(physicalBindingMigrationRecords.migrationKey, missing.map((row) => row.migrationKey)));
            const byId = new Map(existingRows.map((row) => [row.migrationKey, row]));
            for (const intended of missing) assertImmutablePhysicalBindingRow("migration", intended, byId.get(intended.migrationKey));
          }
        }
        {
          const intendedRows = input.state.assessments.map(assessmentRow);
          const inserted = intendedRows.length ? await tx.insert(physicalReadinessAssessments).values(intendedRows).onConflictDoNothing().returning({ id: physicalReadinessAssessments.assessmentId }) : [];
          const insertedIds = new Set(inserted.map((row) => row.id));
          const missing = intendedRows.filter((row) => !insertedIds.has(row.assessmentId));
          if (missing.length) {
            const existingRows = await tx.select().from(physicalReadinessAssessments).where(inArray(physicalReadinessAssessments.assessmentId, missing.map((row) => row.assessmentId)));
            const byId = new Map(existingRows.map((row) => [row.assessmentId, row]));
            for (const intended of missing) assertImmutablePhysicalBindingRow("assessment", intended, byId.get(intended.assessmentId));
          }
        }

        const setValues = {
          setId: input.state.set.setId, tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId, boardInstanceId: scope.boardInstanceId, componentInstanceId: scope.componentInstanceId,
          variantScopeDigest: physicalBindingDigest(scope.assemblyVariantIds), revision: input.state.set.revision, effectiveSelectedRevisionId: input.state.set.effectiveSelectedRevisionId,
          recordDigest: input.state.set.recordDigest, bindingSet: input.state.set, updatedAt: date(input.state.set.updatedAt, "PB_SET_TIMESTAMP_INVALID"),
        };
        if (current) {
          const updated = await tx.update(physicalBindingSets).set(setValues).where(and(eq(physicalBindingSets.setId, input.setId), eq(physicalBindingSets.revision, input.expectedRevision))).returning({ setId: physicalBindingSets.setId });
          if (updated.length !== 1) throw new Error("PB_OPTIMISTIC_LOCK_CONFLICT");
        } else await tx.insert(physicalBindingSets).values(setValues);
      });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("PB_OPTIMISTIC_LOCK_CONFLICT")) {
        const replay = await findReplay();
        if (replay) {
          assertPhysicalBindingReplay(replay.event, input);
          const intended = input.state.auditEvents.find((event) => event.idempotencyKey === input.idempotencyKey);
          if (intended) assertImmutablePhysicalBindingRow("audit", auditRow(intended), replay);
          const state = await this.load(input.setId);
          if (!state) throw new Error("PB_IDEMPOTENT_COMMIT_STATE_MISSING");
          return { state, duplicate: true };
        }
      }
      throw error;
    }
    // The transaction committed exactly input.state (optimistic lock verified
    // inside it), so the durable state IS input.state — mirroring the
    // in-memory reference repository, return it without a re-read.
    return { state: structuredClone(input.state), duplicate: false };
  }
}
