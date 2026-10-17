import { createHash } from "node:crypto";
import type { DurableAggregateIdentity, DurableOutboxEvent, DurableWorkflowScope } from "./types";
import { compareCodePoints } from "@/app/lib/stable-compare";

const UNORDERED_KEYS = new Set(["evidenceRefs", "sourceRefs", "dependencyRefs", "componentInstanceIds", "stage2DependencyKeys", "assemblyVariantIds"]);
function canonical(value: unknown, key?: string): unknown {
  if (typeof value === "string") return value.normalize("NFC");
  if (typeof value === "number") { if (!Number.isFinite(value)) throw new Error("DW_NON_FINITE_NUMBER"); return Object.is(value, -0) ? 0 : value; }
  if (Array.isArray(value)) { const items = value.map((item) => canonical(item)); return key && UNORDERED_KEYS.has(key) ? [...items].sort((a, b) => compareCodePoints(JSON.stringify(a), JSON.stringify(b))) : items; }
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, child]) => child !== undefined).sort(([a], [b]) => compareCodePoints(a, b)).map(([childKey, child]) => [childKey, canonical(child, childKey)]));
  return value;
}
function id(value: string, code: string): string { const next = value?.normalize("NFC").trim(); if (!next || next.length > 512 || /[\u0000-\u001f\u007f]/.test(next)) throw new Error(code); return next; }

export function durableWorkflowJson(value: unknown): string { return JSON.stringify(canonical(value)); }
export function durableWorkflowDigest(value: unknown): string { return `dw1-${createHash("sha256").update(durableWorkflowJson(value)).digest("hex")}`; }
export function durableWorkflowId(kind: string, value: unknown): string { return `${kind}:${durableWorkflowDigest(value).slice(4, 36)}`; }
export function canonicalDurableScope(scope: DurableWorkflowScope): DurableWorkflowScope { return { tenantId: id(scope?.tenantId, "DW_TENANT_ID_INVALID"), projectId: id(scope?.projectId, "DW_PROJECT_ID_INVALID"), branchId: id(scope?.branchId, "DW_BRANCH_ID_INVALID") }; }
export function durableAggregateIdentity(scope: DurableWorkflowScope, aggregateType: string, aggregateKey: string): DurableAggregateIdentity { return { scope: canonicalDurableScope(scope), aggregateType: id(aggregateType, "DW_AGGREGATE_TYPE_INVALID"), aggregateKey: id(aggregateKey, "DW_AGGREGATE_KEY_INVALID") }; }
export function durableAggregateHeadId(identity: DurableAggregateIdentity): string { const value = durableAggregateIdentity(identity.scope, identity.aggregateType, identity.aggregateKey); return durableWorkflowId("durable-head", value); }
export function durableAggregateMapKey(identity: DurableAggregateIdentity): string { return durableWorkflowJson(durableAggregateIdentity(identity.scope, identity.aggregateType, identity.aggregateKey)); }
export function durableScopeKey(scope: DurableWorkflowScope, suffix = "project"): string { return durableWorkflowId("durable-scope", { ...canonicalDurableScope(scope), suffix: id(suffix, "DW_SCOPE_SUFFIX_INVALID") }); }
export function durableEventContractKey(eventType: string, eventVersion: number): string { if (!Number.isSafeInteger(eventVersion) || eventVersion < 1) throw new Error("DW_EVENT_VERSION_INVALID"); return `${id(eventType, "DW_EVENT_TYPE_INVALID")}@${eventVersion}`; }
export function durableOutboxEventDigest(event: Pick<DurableOutboxEvent, "eventId" | "scope" | "ownerAggregateType" | "ownerAggregateKey" | "ownerAggregateRevision" | "eventType" | "eventVersion" | "topic" | "idempotencyKey" | "payloadDigest">): string { const scope = canonicalDurableScope(event.scope); return durableWorkflowDigest({ branchId: scope.branchId, eventId: id(event.eventId, "DW_EVENT_ID_INVALID"), eventType: id(event.eventType, "DW_EVENT_TYPE_INVALID"), eventVersion: event.eventVersion, idempotencyKey: id(event.idempotencyKey, "DW_IDEMPOTENCY_KEY_INVALID"), ownerAggregateKey: id(event.ownerAggregateKey, "DW_OWNER_KEY_INVALID"), ownerAggregateRevision: event.ownerAggregateRevision, ownerAggregateType: id(event.ownerAggregateType, "DW_OWNER_TYPE_INVALID"), payloadDigest: id(event.payloadDigest, "DW_PAYLOAD_DIGEST_INVALID"), projectId: scope.projectId, tenantId: scope.tenantId, topic: id(event.topic, "DW_TOPIC_INVALID") }); }
/** [PR-L, 2026-10-17] S1: an effect's dispatch time - `committedAt` (as given) when absent; otherwise a parseable instant at or after
 *  it, normalized to ISO form. Shared by both repositories so they refuse and normalize identically. */
export function durableOutboxAvailableAt(availableAt: string | undefined, committedAt: string): string { if (availableAt === undefined) return committedAt; const at = typeof availableAt === "string" ? Date.parse(availableAt) : Number.NaN, committed = Date.parse(committedAt); if (!Number.isFinite(at) || !Number.isFinite(committed) || at < committed) throw new Error("DW_OUTBOX_AVAILABLE_AT_INVALID"); return new Date(at).toISOString(); }
export function assertDurableOutboxEvent(event: DurableOutboxEvent): void { if (!Number.isSafeInteger(event.ownerAggregateRevision) || event.ownerAggregateRevision < 1) throw new Error("DW_EVENT_OWNER_REVISION_INVALID"); durableEventContractKey(event.eventType, event.eventVersion); if (durableWorkflowDigest(event.payload) !== event.payloadDigest) throw new Error("DW_OUTBOX_PAYLOAD_DIGEST_MISMATCH"); if (durableOutboxEventDigest(event) !== event.eventDigest) throw new Error("DW_OUTBOX_EVENT_DIGEST_MISMATCH"); }
