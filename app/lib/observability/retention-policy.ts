/**
 * [B24-C2] D24-13, OD-202 (as discovery 9.4 restates it): the retention and deletion policy AS DATA, `sirkit.retention-policy.v1` -
 * one row per record class, each with the store that holds it, its rule and who deletes it (runbook :1038 "trace/audit retention and
 * deletion policy;"). A row's rule is one of: a finite day count (deleted by the purge CLI, `scripts/retention-purge.ts`, through the
 * repository-boundary port of `app/lib/durable-workflow/retention.ts`), until the owner decides (listed, never purged), configuration
 * (never purged), process lifetime (a ring that dies with the process), its own purge (the distributor offer cache) or browser-local
 * (a store the server never holds).
 *
 * The purge is ALLOWLIST-ONLY: only a durable aggregate type with a finite day count can be deleted (`retentionPurgeRows`); no other
 * class is ever touched. An aggregate expires when its head's `updated_at` is older than its row's cutoff, which holds only for an
 * aggregate that covers one run or one call: every purgeable class here is per run or per trace. It is deleted whole, in one
 * transaction - records, head, the replay rows whose result references only purged records, its terminal outbox rows - or not at all.
 *
 * This module names every aggregate type by its string literal and imports NO store module: `b24-c2-retention` 1 is the census that
 * compares these rows with every aggregate type a production module passes to the durable repository, so a new type fails that test
 * until it has a row here. Stated choices (OD-232): the resume record is deleted whole (OD-202 named its answer text); the MCP and B05
 * traces are rings, not durable stores, so "process lifetime" replaces OD-202's "90 days" for them; the per-scope salt is kept until
 * the owner decides (deleting a scope's salt crypto-shreds every salted digest written under it).
 */

export const RETENTION_POLICY_SCHEMA = "sirkit.retention-policy.v1" as const;
export const RETENTION_RULE_KINDS = Object.freeze(["days", "owner_decision", "configuration", "process_lifetime", "own_purge", "browser_local"] as const);
export type RetentionRuleKind = (typeof RETENTION_RULE_KINDS)[number];
export type RetentionRule = { readonly kind: "days"; readonly days: number } | { readonly kind: Exclude<RetentionRuleKind, "days"> };
export const RETENTION_STORE_KINDS = Object.freeze(["durable_aggregate", "table", "process_ring", "cache_table", "browser_storage"] as const);
export type RetentionStoreKind = (typeof RETENTION_STORE_KINDS)[number];
export const RETENTION_DELETERS = Object.freeze(["retention_purge", "owner", "never", "process_exit", "offer_cache", "browser"] as const);
export type RetentionDeleter = (typeof RETENTION_DELETERS)[number];

export interface RetentionRow {
  /** the aggregate type, the table name, or the ring's or browser store's name */
  readonly recordClass: string;
  readonly store: RetentionStoreKind;
  readonly rule: RetentionRule;
  readonly deletedBy: RetentionDeleter;
  /** where the class is written, and what the rule rests on */
  readonly note: string;
}
export interface RetentionPolicy {
  readonly schema: typeof RETENTION_POLICY_SCHEMA;
  readonly version: string;
  readonly rows: readonly RetentionRow[];
}
export interface RetentionPurgeRow { readonly aggregateType: string; readonly days: number }

const days = (count: number): RetentionRule => ({ kind: "days", days: count });
const OWNER: RetentionRule = { kind: "owner_decision" };
const row = (recordClass: string, store: RetentionStoreKind, rule: RetentionRule, deletedBy: RetentionDeleter, note: string): RetentionRow => Object.freeze({ recordClass, store, rule, deletedBy, note });
const aggregate = (recordClass: string, rule: RetentionRule, deletedBy: RetentionDeleter, note: string): RetentionRow => row(recordClass, "durable_aggregate", rule, deletedBy, note);
const kept = (recordClass: string, note: string): RetentionRow => aggregate(recordClass, OWNER, "owner", note);

export const RETENTION_POLICY: RetentionPolicy = Object.freeze({
  schema: RETENTION_POLICY_SCHEMA,
  version: "1.0.0",
  rows: Object.freeze([
    // 90 days: the run trace, the LLM call record, the attribution and the per-task specialist trace - one aggregate per run, trace or call
    aggregate("agent.run-trace.v1", days(90), "retention_purge", "B24-C1 run-trace-store.ts: one aggregate per scope and run id (a resume's trace at revision 2); the chat route's finalized trace"),
    aggregate("llm.call-record.v1", days(90), "retention_purge", "B24-C1 llm-call-record-store.ts: one aggregate per call id at revision 1; the 22 model-egress paths' calls"),
    aggregate("agent.run-trace-attribution.v1", days(90), "retention_purge", "B24-C2 run-trace-attribution.ts: one aggregate per trace id at revision 1; salted digests, counts, closed classes"),
    aggregate("agent.orchestration-trace.v1", days(90), "retention_purge", "B21-E2b trace-attribution.ts: one aggregate per per-task trace run id; the specialist traces"),
    // 30 days: the resume record, deleted whole (OD-202 named its answer text; the aggregate is per run, so the head-age rule holds)
    aggregate("agent.orchestration-resume.v1", days(30), "retention_purge", "B21-E3 orchestration/store.ts: one aggregate per run id; carries the coordinator's answer (at most 60,000 characters)"),
    // until the owner decides (OD-111, OD-141, OD-167): listed, never purged
    kept("agent.orchestration-run.v1", "B21-A orchestration/store.ts: the durable orchestration record (OD-111: kept until an owner-decided purge exists)"),
    kept("agent.execution-grant.v1", "B18-B execution-grant/store.ts: the execution grants, each with a 240-character redacted instruction excerpt"),
    kept("agent.execution-grant-index.v1", "B18-B execution-grant/store.ts: the per-principal grant index"),
    kept("mfg.release-ledger.v1", "B16-A pcb/fab/release-ledger.ts: the release ledger (the pinned release identities)"),
    kept("computation.evidence.v1", "B22-C computation/evidence-store.ts (OD-141): bound to no route at 4ec18eb"),
    kept("mfg.provider-exchange.v1", "B23-B2 exchange-ledger.ts (OD-167): the provider exchange record; B23-B3's provider observations (OD-168) are projections of it read at GET /api/pcb-sync, so their retention is this record's"),
    kept("agent.trace-salt.v1", "B24-C2 trace-salt.ts: one salt per scope; deleting a scope's salt crypto-shreds every salted digest written under it"),
    kept("pcb-sync.audit-stream.v1", "pcb-sync/durable.ts: the binding audit stream (OD-202's binding audit records)"),
    kept("pb.component-review-request.v1", "physical-binding/review-handoff.ts: the component review requests (OD-202's binding audit records)"),
    kept("atomic.publication-request.v1", "atomic/publication-review.ts: the publication requests (OD-202's catalog audit records)"),
    // engineering state, not trace records: kept until the owner decides
    kept("pcb-sync.board-lineage.v1", "pcb-sync/board-lineage.ts: engineering state (the board lineage)"),
    kept("pcb-sync.board.v1", "pcb-sync/durable.ts: engineering state (the durable board)"),
    kept("pcb-sync.plan.v1", "pcb-sync/durable.ts: engineering state (the sync plan)"),
    kept("pcb-sync.authoritative-snapshot.v1", "pcb-sync/durable.ts: engineering state (the authoritative snapshot)"),
    kept("mfg.release-authority.v1", "pcb/fab/authority-store.ts: engineering state (the release authority)"),
    kept("mfg.qualification-lease.v1", "pcb/fab/qualification-lease.ts: engineering state (the qualification lease)"),
    kept("assignment-queue.source.v1", "assignment-queue/repository.ts: engineering state"),
    kept("assignment-queue.item.v1", "assignment-queue/repository.ts: engineering state"),
    kept("assignment-queue.plan.v1", "assignment-queue/repository.ts: engineering state"),
    kept("assignment-queue.decision.v1", "assignment-queue/repository.ts: engineering state"),
    kept("mapping-verification.record.v1", "mapping-verification/durable.ts: engineering state"),
    kept("mapping-verification.context.v1", "mapping-verification/durable.ts: engineering state"),
    kept("mapping-verification.candidate.v1", "mapping-verification/durable.ts: engineering state"),
    kept("mapping-verification.result.v1", "mapping-verification/durable.ts: engineering state"),
    kept("mapping-verification.effect-receipt.v1", "mapping-verification/durable.ts: engineering state (the effect receipts)"),
    kept("passive-policy.record.v1", "passive-policy/durable.ts: engineering state"),
    kept("passive-policy.context.v1", "passive-policy/durable.ts: engineering state"),
    kept("passive-policy.effect-receipt.v1", "passive-policy/durable.ts: engineering state (the effect receipts)"),
    // configuration: never purged
    aggregate("agent.autonomy-settings.v1", { kind: "configuration" }, "never", "B18-A autonomy-store.ts: the project's agent autonomy setting"),
    // the audit tables (OD-202's binding and catalog audit records) and the CD-13 run events: until the owner decides
    row("physical_binding_audit_events", "table", OWNER, "owner", "drizzle/0022_footprint_binding_stage01.sql: the physical-binding audit events"),
    row("atomic_audit_events", "table", OWNER, "owner", "drizzle/0006_stage05_atomic_component_catalog.sql: the catalog audit events"),
    row("atomic_revision_status_events", "table", OWNER, "owner", "drizzle/0030_atomic_revision_status_events.sql: the revision status events"),
    row("full_flow_run_events", "table", OWNER, "owner", "drizzle/0021_cd13_full_flow_orchestrator.sql: the CD-13 run events"),
    // process lifetime: the per-process rings (nothing durable to purge; OD-202's '90 days' cannot apply to them)
    row("mcp-request-and-read-traces", "process_ring", { kind: "process_lifetime" }, "process_exit", "B20: the MCP request and read trace rings (a bounded per-process ring)"),
    row("b05-read-invocation-traces", "process_ring", { kind: "process_lifetime" }, "process_exit", "B05 engineering/tool-invocation.ts: the read trace ring of at most 500 entries"),
    // its own purge: the distributor offer cache
    row("part_offers", "cache_table", { kind: "own_purge" }, "offer_cache", "distributors/cache.ts purgeExpiredOffers: each source's bounded retention, on the read path at most every five minutes"),
    // browser-local: the server never holds them
    row("spice-studio-ai-audit-log", "browser_storage", { kind: "browser_local" }, "browser", "spice/project.ts aiAuditLog in localStorage: bounded to 200 entries, reason and change set redacted (B24-C2)"),
    row("approved-mutation-journal", "browser_storage", { kind: "browser_local" }, "browser", "engineering/approved-mutation-journal.ts: the Tier 2 approvals in IndexedDB (OD-210: no server record)"),
  ]),
});

/** The allowlist: the durable aggregate types with a finite day count, in policy order. Nothing else is ever purged. */
export function retentionPurgeRows(policy: RetentionPolicy = RETENTION_POLICY): readonly RetentionPurgeRow[] {
  return policy.rows.flatMap((entry) => (entry.store === "durable_aggregate" && entry.rule.kind === "days" && entry.deletedBy === "retention_purge" ? [{ aggregateType: entry.recordClass, days: entry.rule.days }] : []));
}
