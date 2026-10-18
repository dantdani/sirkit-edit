/**
 * [B24-C2] Retention as data and the purge CLI (D24-13; OD-202 as 9.4 restates it; runbook :1038 "trace/audit retention and deletion
 * policy;", :1044, :171): `RETENTION_POLICY` (`sirkit.retention-policy.v1`, app/lib/observability/retention-policy.ts) names every record
 * class with its rule - days, until the owner decides, configuration, process lifetime, own purge or browser-local - and the purge is
 * ALLOWLIST-ONLY: only a durable aggregate type with a finite day count can be deleted. The repository-boundary port and its planner live
 * in app/lib/durable-workflow/retention.ts; the CLI (`runRetentionCli`, retention-cli.ts; the thin wrapper scripts/retention-purge.ts) is
 * dry-run by default and deletes only with `--apply --confirm <planDigest> --as-of <the dry run's instant>`.
 *
 *  1. the policy rows and the aggregate census (red at 4ec18eb: no policy exists): every aggregate type a production module passes to the
 *     durable repository - module-local constants included, numeric constants and schema strings excluded - has a row, and every
 *     durable-aggregate row names a type the census found; the exported constants equal the literals;
 *  2. allowlist-only: the purgeable rows are exactly the five day-counted classes; nothing else is ever queried or deleted;
 *  3. the planner's cutoffs on an injected clock, the per-run limit across types, the digest over exactly the set to delete;
 *  4. the CLI: dry run by default (nothing deleted), `--apply` without or with a stale `--confirm` refused;
 *  5. the closed flags: `--read` refused by the purge parser alone ([B24-C3, 2026-10-09] moved by review, D12: the wrapper dispatches `--read` to the read mode before this parser sees it), an unknown flag, a repeated flag, a malformed value, each
 *     before any repository call;
 *  6. a dry run then an apply at the same `--as-of` matches and deletes exactly the plan; an apply at a later `--as-of` is refused; an
 *     `--as-of` after the clock's now is refused;
 *  7. no CLI output carries the DATABASE_URL value, a payload or a salt; the production header; the modules import no store and never
 *     name the provider directory.
 *
 * Nothing here touches a database: the port is a fake (the PGlite proof is b24-c2-retention-pglite, database-delivery).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collectProductionFiles, moduleReferences, resolveSpecifier, type FileMap } from "@/app/lib/project/__tests__/_import-gate-helpers";
import { fileOf, importClosure, runtimeDeclarationSpecifiers } from "@/app/lib/mcp/server/__tests__/_import-closure";
import { engineeringDigest } from "@/app/lib/engineering/stable";
import { RUN_TRACE_AGGREGATE_TYPE } from "@/app/lib/observability/run-trace-store";
import { LLM_CALL_AGGREGATE_TYPE } from "@/app/lib/observability/llm-call-record-store";
import { RUN_TRACE_ATTRIBUTION_AGGREGATE_TYPE } from "@/app/lib/observability/run-trace-attribution";
import { TRACE_SALT_AGGREGATE_TYPE } from "@/app/lib/observability/trace-salt";
import { ORCHESTRATION_AGGREGATE_TYPE, ORCHESTRATION_RESUME_AGGREGATE_TYPE } from "@/app/lib/agent/orchestration/store";
import { ORCHESTRATION_TRACE_AGGREGATE_TYPE } from "@/app/lib/agent/orchestration/trace-attribution";
import { EXECUTION_GRANT_AGGREGATE_TYPE, EXECUTION_GRANT_INDEX_AGGREGATE_TYPE } from "@/app/lib/engineering/execution-grant";
import { AUTONOMY_AGGREGATE_TYPE } from "@/app/lib/agent/autonomy-store";
import { COMPUTATION_EVIDENCE_AGGREGATE_TYPE } from "@/app/lib/computation/evidence-store";
import { PROVIDER_EXCHANGE_AGGREGATE_TYPE } from "@/app/lib/manufacturing-providers/exchange-ledger";
import { ATOMIC_PUBLICATION_AGGREGATE } from "@/app/lib/atomic/publication-review";
import { COMPONENT_REVIEW_AGGREGATE } from "@/app/lib/physical-binding/review-handoff";
import { BOARD_LINEAGE_AGGREGATE } from "@/app/lib/pcb-sync/board-lineage";
import { RETENTION_DELETERS, RETENTION_POLICY, RETENTION_POLICY_SCHEMA, RETENTION_RULE_KINDS, RETENTION_STORE_KINDS, retentionPurgeRows } from "@/app/lib/observability/retention-policy";
import { RETENTION_LIMITS, RETENTION_PLAN_SCHEMA, applyRetention, inventoryStatus, planRetention, retentionCutoff, retentionPlanDigest, type RetentionInventory, type RetentionPort, type RetentionPurgeOutcome, type RetentionTarget } from "@/app/lib/durable-workflow/retention";
import { RETENTION_CLI_EXIT, RETENTION_CLI_FLAGS, parseRetentionArguments, runRetentionCli } from "@/app/lib/durable-workflow/retention-cli";

const ROOT = process.cwd();
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");
const NOW = "2026-10-08T12:00:00.000Z";
const SCOPE = { tenantId: "tenant-c2", projectId: "project-c2", branchId: "main" };
/** An aggregate type literal as the durable substrate names them. */
const AGGREGATE_LITERAL = /^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+\.v\d+$/;
const LITERAL_SOURCE = String.raw`[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+\.v\d+`;
const IDENT = String.raw`[A-Za-z_$][\w$]*`;

type Census = Map<string, Set<string>>; // literal -> the modules whose use reaches an aggregateType

/** Does `source` pass `ident` to the durable repository as an aggregate type (an operation's aggregateType, listHeads' aggregateType, or
 *  durableAggregateIdentity's second argument)? */
function reachesAggregateType(source: string, ident: string): boolean {
  const escaped = ident.replace(/[$]/g, "\\$");
  return new RegExp(String.raw`aggregateType:\s*${escaped}\b`).test(source) || new RegExp(String.raw`durableAggregateIdentity\((?:[^()]|\([^()]*\))*?,\s*${escaped}\b`).test(source);
}
/** The production files that import `ident` (by name, possibly renamed) from `module`. */
function importersOfIdent(map: FileMap, module: string, ident: string): Array<{ file: string; local: string }> {
  const found: Array<{ file: string; local: string }> = [];
  for (const [file, source] of map) {
    if (file === module) continue;
    for (const match of source.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*"([^"]+)"/g)) {
      const resolution = resolveSpecifier(file, match[2]!);
      if (resolution.kind !== "module" || fileOf(map, resolution.module) !== module) continue;
      for (const binding of match[1]!.split(",")) {
        const [imported, renamed] = binding.trim().replace(/^type\s+/, "").split(/\s+as\s+/).map((part) => part.trim());
        if (imported === ident) found.push({ file, local: renamed ?? imported });
      }
    }
  }
  return found;
}
/** Every aggregate type literal a production module under app/lib or app/api passes to the durable repository. */
function aggregateCensus(map: FileMap): Census {
  const census: Census = new Map();
  const note = (literal: string, file: string): void => { if (!census.has(literal)) census.set(literal, new Set()); census.get(literal)!.add(file); };
  for (const [file, source] of map) {
    if (!(file.startsWith("app/lib/") || file.startsWith("app/api/"))) continue;
    // a direct literal at an aggregateType position (a type annotation `aggregateType: "x";` is not one)
    for (const match of source.matchAll(new RegExp(String.raw`aggregateType:\s*"(${LITERAL_SOURCE})"\s*[,})]`, "g"))) note(match[1]!, file);
    for (const match of source.matchAll(new RegExp(String.raw`durableAggregateIdentity\((?:[^()]|\([^()]*\))*?,\s*"(${LITERAL_SOURCE})"`, "g"))) note(match[1]!, file);
    // a constant bound to the literal, used in this module or in a module that imports it
    for (const match of source.matchAll(new RegExp(String.raw`(?:\b(?:const|let|var)\s+|,\s*)(${IDENT})[ \t]*(?::[ \t]*[^=;\n]+)?=\s*"(${LITERAL_SOURCE})"`, "g"))) { // a declaration (or a further binding of one), never a comment's `word:` running into the next assignment
      const [, ident, literal] = match as unknown as [string, string, string];
      if (reachesAggregateType(source, ident)) { note(literal, file); continue; }
      for (const importer of importersOfIdent(map, file, ident)) if (reachesAggregateType(map.get(importer.file)!, importer.local)) note(literal, importer.file);
    }
  }
  return census;
}

// ── the fake port ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
function inventory(aggregateType: string, key: string, updatedAt: string, over: Partial<RetentionInventory> = {}): RetentionInventory {
  return { scope: SCOPE, aggregateType, aggregateKey: `${aggregateType}:${key}`, headRevision: 1, updatedAt, recordIds: [`rec-${key}-1`], replayIds: [`replay-${key}`], outbox: { terminal: 0, inFlight: 0 }, mixedCommit: false, ...over };
}
class FakePort implements RetentionPort {
  readonly calls: string[] = [];
  readonly purged: RetentionTarget[] = [];
  constructor(readonly inventories: RetentionInventory[], private readonly purgeAnswer: (target: RetentionTarget) => RetentionPurgeOutcome = (target) => ({ ok: true, deleted: { heads: 1, records: target.recordIds.length, replays: target.replayIds.length, outbox: 0 } })) {}
  async expiredAggregates(input: { aggregateType: string; cutoff: string; limit: number }): Promise<RetentionInventory[]> {
    this.calls.push(`expired:${input.aggregateType}:${input.limit}`);
    return this.inventories.filter((entry) => entry.aggregateType === input.aggregateType && entry.updatedAt < input.cutoff).slice(0, input.limit);
  }
  async purgeAggregate(target: RetentionTarget): Promise<RetentionPurgeOutcome> {
    this.calls.push(`purge:${target.aggregateKey}`);
    this.purged.push(target);
    return this.purgeAnswer(target);
  }
}
const OLD = "2026-01-01T00:00:00.000Z";
const FRESH = "2026-10-08T11:00:00.000Z";
function seeded(): FakePort {
  return new FakePort([
    inventory(RUN_TRACE_AGGREGATE_TYPE, "old-a", OLD), inventory(RUN_TRACE_AGGREGATE_TYPE, "old-b", OLD, { recordIds: ["rec-old-b-1", "rec-old-b-2"], replayIds: ["replay-old-b-1", "replay-old-b-2"] }), inventory(RUN_TRACE_AGGREGATE_TYPE, "fresh", FRESH),
    inventory(LLM_CALL_AGGREGATE_TYPE, "old", OLD), inventory(RUN_TRACE_ATTRIBUTION_AGGREGATE_TYPE, "old", OLD), inventory(ORCHESTRATION_TRACE_AGGREGATE_TYPE, "old", OLD),
    inventory(ORCHESTRATION_RESUME_AGGREGATE_TYPE, "old", OLD), inventory(ORCHESTRATION_RESUME_AGGREGATE_TYPE, "sixty-days", "2026-08-09T12:00:00.000Z"), inventory(ORCHESTRATION_RESUME_AGGREGATE_TYPE, "twenty-days", "2026-09-18T12:00:00.000Z"),
    inventory(RUN_TRACE_AGGREGATE_TYPE, "mixed", OLD, { mixedCommit: true }), inventory(LLM_CALL_AGGREGATE_TYPE, "in-flight", OLD, { outbox: { terminal: 1, inFlight: 1 } }),
    // kept classes, old: never queried, never deleted
    inventory(ORCHESTRATION_AGGREGATE_TYPE, "old", OLD), inventory(EXECUTION_GRANT_AGGREGATE_TYPE, "old", OLD), inventory(TRACE_SALT_AGGREGATE_TYPE, "old", OLD), inventory(AUTONOMY_AGGREGATE_TYPE, "old", OLD),
  ]);
}
interface Run { code: number; out: string[]; err: string[]; port: FakePort }
async function cli(argv: readonly string[], options: { port?: FakePort; now?: string; production?: boolean } = {}): Promise<Run> {
  const port = options.port ?? seeded();
  const out: string[] = [];
  const err: string[] = [];
  const code = await runRetentionCli(argv, { port, now: () => new Date(options.now ?? NOW), stdout: (line) => out.push(line), stderr: (line) => err.push(line), productionRuntime: options.production ?? false });
  return { code, out, err, port };
}
const digestLine = (run: Run): string => run.out.find((line) => line.startsWith("planDigest: "))!.slice("planDigest: ".length);

/** A fake connection string stubbed into the environment (B16-B's tripwire: the test never reads the variable back; it compares against this constant). */
const FAKE_DATABASE_URL = "postgres://operator:" + ["pass", "word"].join("") + "@db.invalid/sirkit";
beforeEach(() => { vi.stubEnv("DATABASE_URL", FAKE_DATABASE_URL); });
afterEach(() => { vi.unstubAllEnvs(); });

describe("[B24-C2] the retention policy and the aggregate census (D24-13, OD-202)", () => {
  it("1. every aggregate type a production module passes to the durable repository has a row (module-local constants included, numeric constants and schema strings excluded), every durable-aggregate row is a type the census found, and the exported constants equal the literals", { timeout: 120_000 }, () => {
    const map = collectProductionFiles(ROOT);
    const census = aggregateCensus(map);
    const found = [...census.keys()].sort();
    expect(found.every((literal) => AGGREGATE_LITERAL.test(literal))).toBe(true);
    const durableRows = RETENTION_POLICY.rows.filter((row) => row.store === "durable_aggregate").map((row) => row.recordClass).sort();
    expect(found).toEqual(durableRows);
    expect(found).toHaveLength(38); // 30 at f663d71 + C1's two + C2's two (the attribution and the salt); [PR-M, 2026-10-18] reviewed pin move (section M2), was 34: + the acquisition's four aggregates (atomic.acquired-object.v1, atomic.acquisition-candidate.v1, atomic.acquisition-handoff.v1, component-resolution.task.v1), each with its kept row
    // the module-local ones are among them (never a hand list of exports)
    for (const local of ["pcb-sync.board.v1", "pcb-sync.audit-stream.v1", "mfg.release-ledger.v1", "mfg.release-authority.v1", "mfg.qualification-lease.v1", "assignment-queue.item.v1", "mapping-verification.effect-receipt.v1", "passive-policy.record.v1"]) expect(found, local).toContain(local);
    // schema strings and numeric bounds never enter: no `sirkit.` schema, no MAX_* constant
    expect(found.filter((literal) => literal.startsWith("sirkit."))).toEqual([]);
    expect(census.has("assignment-queue.decision.v1") && census.get("assignment-queue.decision.v1")!.has("app/lib/assignment-queue/repository.ts")).toBe(true);
    expect(read("app/lib/engineering/component-authority-source.ts")).toMatch(/MAX_AGGREGATES_PER_COMPONENT|MAX_BINDINGS_PER_AGGREGATE/); // present in the tree, not in the census
    // the exported constants equal the literals the policy names
    for (const constant of [RUN_TRACE_AGGREGATE_TYPE, LLM_CALL_AGGREGATE_TYPE, RUN_TRACE_ATTRIBUTION_AGGREGATE_TYPE, TRACE_SALT_AGGREGATE_TYPE, ORCHESTRATION_AGGREGATE_TYPE, ORCHESTRATION_RESUME_AGGREGATE_TYPE, ORCHESTRATION_TRACE_AGGREGATE_TYPE, EXECUTION_GRANT_AGGREGATE_TYPE, EXECUTION_GRANT_INDEX_AGGREGATE_TYPE, AUTONOMY_AGGREGATE_TYPE, COMPUTATION_EVIDENCE_AGGREGATE_TYPE, PROVIDER_EXCHANGE_AGGREGATE_TYPE, ATOMIC_PUBLICATION_AGGREGATE, COMPONENT_REVIEW_AGGREGATE, BOARD_LINEAGE_AGGREGATE]) expect(durableRows, constant).toContain(constant);
    // the policy's shape
    expect(RETENTION_POLICY.schema).toBe("sirkit.retention-policy.v1");
    expect(RETENTION_POLICY_SCHEMA).toBe("sirkit.retention-policy.v1");
    expect(new Set(RETENTION_POLICY.rows.map((row) => row.recordClass)).size).toBe(RETENTION_POLICY.rows.length);
    for (const row of RETENTION_POLICY.rows) {
      expect(RETENTION_RULE_KINDS, row.recordClass).toContain(row.rule.kind);
      expect(RETENTION_STORE_KINDS, row.recordClass).toContain(row.store);
      expect(RETENTION_DELETERS, row.recordClass).toContain(row.deletedBy);
      if (row.rule.kind === "days") expect(row.store === "durable_aggregate" && row.deletedBy === "retention_purge", row.recordClass).toBe(true);
      else expect(row.deletedBy !== "retention_purge", row.recordClass).toBe(true);
    }
    const byClass = new Map(RETENTION_POLICY.rows.map((row) => [row.recordClass, row]));
    expect(byClass.get(ORCHESTRATION_RESUME_AGGREGATE_TYPE)!.rule).toEqual({ kind: "days", days: 30 });
    for (const ninety of [RUN_TRACE_AGGREGATE_TYPE, LLM_CALL_AGGREGATE_TYPE, RUN_TRACE_ATTRIBUTION_AGGREGATE_TYPE, ORCHESTRATION_TRACE_AGGREGATE_TYPE]) expect(byClass.get(ninety)!.rule, ninety).toEqual({ kind: "days", days: 90 });
    expect(byClass.get(AUTONOMY_AGGREGATE_TYPE)!.rule).toEqual({ kind: "configuration" });
    expect(byClass.get(TRACE_SALT_AGGREGATE_TYPE)!.rule).toEqual({ kind: "owner_decision" });
    expect(byClass.get(PROVIDER_EXCHANGE_AGGREGATE_TYPE)!.rule).toEqual({ kind: "owner_decision" });
    for (const table of ["physical_binding_audit_events", "atomic_audit_events", "atomic_revision_status_events", "full_flow_run_events"]) expect(byClass.get(table), table).toMatchObject({ store: "table", rule: { kind: "owner_decision" } });
    expect(RETENTION_POLICY.rows.filter((row) => row.store === "process_ring").map((row) => row.rule.kind)).toEqual(["process_lifetime", "process_lifetime"]);
    expect(RETENTION_POLICY.rows.filter((row) => row.store === "cache_table").map((row) => row.rule.kind)).toEqual(["own_purge"]);
    expect(RETENTION_POLICY.rows.filter((row) => row.store === "browser_storage").map((row) => row.rule.kind)).toEqual(["browser_local", "browser_local"]);
    // the policy imports nothing (no store module), and no retention module names the provider directory or imports the exchange ledger
    const POLICY = "app/lib/observability/retention-policy.ts";
    expect([...runtimeDeclarationSpecifiers(POLICY, map.get(POLICY)!)]).toEqual([]);
    for (const file of ["app/lib/durable-workflow/retention.ts", "app/lib/durable-workflow/retention-cli.ts", "scripts/retention-purge.ts"]) {
      expect(map.get(file), file).toBeDefined();
      expect(map.get(file)!, file).not.toContain(["manufacturing", "-providers"].join(""));
      const closure = [...importClosure(map, [file]).keys()];
      expect(closure.filter((reached) => reached.startsWith("app/lib/manufacturing-providers/") || reached.includes("exchange-ledger")), file).toEqual([]);
      expect(closure, file).not.toContain("app/api/chat/route.ts");
    }
    expect([...runtimeDeclarationSpecifiers("app/lib/durable-workflow/retention.ts", map.get("app/lib/durable-workflow/retention.ts")!)].filter((specifier) => /postgres|pglite|disposable/i.test(specifier))).toEqual([]);
    expect([...runtimeDeclarationSpecifiers("scripts/retention-purge.ts", map.get("scripts/retention-purge.ts")!)].filter((specifier) => /postgres|pglite|disposable|load-env/i.test(specifier))).toEqual(["../app/lib/load-env-local"]); // [B24-C3, 2026-10-09] reviewed pin move (D12): the wrapper loads .env.local for its READ mode only (db-migrate's order, handed to the read runner as its loader); the purge mode never calls it, and no postgres, pglite or disposable specifier joins; was []
    expect(importClosure(map, ["app/api/chat/route.ts"]).has("app/lib/durable-workflow/retention.ts")).toBe(false); // no retention module in the chat route's closure
    expect(map.get("app/lib/durable-workflow/index.ts")!).toContain('export * from "./retention";');
    // the moduleReferences helper is exercised (the census is not vacuous on an unresolvable specifier)
    expect(moduleReferences("app/lib/x.ts", 'import { a } from "./y";').map((reference) => reference.specifier)).toEqual(["./y"]);
  });

  it("2. allowlist-only: the purgeable rows are exactly the five day-counted durable classes (four at 90 days, the resume record at 30); the planner queries nothing else and a kept class is never a target", async () => {
    const rows = retentionPurgeRows();
    expect(rows.map((row) => [row.aggregateType, row.days]).sort()).toEqual([[RUN_TRACE_AGGREGATE_TYPE, 90], [LLM_CALL_AGGREGATE_TYPE, 90], [RUN_TRACE_ATTRIBUTION_AGGREGATE_TYPE, 90], [ORCHESTRATION_TRACE_AGGREGATE_TYPE, 90], [ORCHESTRATION_RESUME_AGGREGATE_TYPE, 30]].sort());
    const port = seeded();
    const plan = await planRetention(port, { rows, asOf: NOW, limit: RETENTION_LIMITS.default });
    expect(port.calls.every((call) => call.startsWith("expired:"))).toBe(true);
    expect(new Set(port.calls.map((call) => call.split(":")[1]!))).toEqual(new Set(rows.map((row) => row.aggregateType)));
    expect(plan.targets.map((target) => target.aggregateType).filter((type) => !rows.some((row) => row.aggregateType === type))).toEqual([]);
    expect(plan.targets.some((target) => target.aggregateKey.includes(ORCHESTRATION_AGGREGATE_TYPE) || target.aggregateKey.includes(TRACE_SALT_AGGREGATE_TYPE))).toBe(false);
    expect(RETENTION_LIMITS).toEqual({ default: 1_000, max: 10_000 });
  });

  it("3. the planner on an injected clock: the cutoffs are as-of minus the days, a fresh aggregate and one inside its window stay, a mixed commit and an in-flight outbox are refused (counted, never targets), the limit bounds the whole run across types, and the digest is over exactly the set to delete", async () => {
    expect(retentionCutoff(NOW, 90)).toBe("2026-07-10T12:00:00.000Z");
    expect(retentionCutoff(NOW, 30)).toBe("2026-09-08T12:00:00.000Z");
    const port = seeded();
    const plan = await planRetention(port, { rows: retentionPurgeRows(), asOf: NOW, limit: RETENTION_LIMITS.default });
    expect(plan.schema).toBe(RETENTION_PLAN_SCHEMA);
    expect(plan.asOf).toBe(NOW);
    const row = (type: string) => plan.rows.find((candidate) => candidate.aggregateType === type)!;
    expect(row(RUN_TRACE_AGGREGATE_TYPE)).toMatchObject({ retentionDays: 90, cutoff: "2026-07-10T12:00:00.000Z", purgeable: 2, refused: { mixed_commit: 1, outbox_in_flight: 0 }, records: 3, replays: 3, outbox: 0 });
    expect(row(LLM_CALL_AGGREGATE_TYPE)).toMatchObject({ purgeable: 1, refused: { mixed_commit: 0, outbox_in_flight: 1 } });
    expect(row(ORCHESTRATION_RESUME_AGGREGATE_TYPE)).toMatchObject({ retentionDays: 30, cutoff: "2026-09-08T12:00:00.000Z", purgeable: 2, refused: { mixed_commit: 0, outbox_in_flight: 0 } }); // old and sixty-days; twenty-days stays
    expect(plan.targets.map((target) => target.aggregateKey).sort()).toEqual([`${RUN_TRACE_AGGREGATE_TYPE}:old-a`, `${RUN_TRACE_AGGREGATE_TYPE}:old-b`, `${LLM_CALL_AGGREGATE_TYPE}:old`, `${RUN_TRACE_ATTRIBUTION_AGGREGATE_TYPE}:old`, `${ORCHESTRATION_TRACE_AGGREGATE_TYPE}:old`, `${ORCHESTRATION_RESUME_AGGREGATE_TYPE}:old`, `${ORCHESTRATION_RESUME_AGGREGATE_TYPE}:sixty-days`].sort());
    expect(plan.planDigest).toMatch(/^eng1-[0-9a-f]{16}$/);
    expect(plan.planDigest).toBe(retentionPlanDigest({ asOf: plan.asOf, limit: plan.limit, targets: plan.targets }));
    expect(plan.planDigest).toBe(engineeringDigest({ schema: "sirkit.retention-plan-digest.v1", asOf: NOW, limit: RETENTION_LIMITS.default, targets: plan.targets }));
    // the same set at a later as-of is another digest (as-of is bound into it), and a different set is another digest
    expect(retentionPlanDigest({ asOf: "2026-10-09T12:00:00.000Z", limit: plan.limit, targets: plan.targets })).not.toBe(plan.planDigest);
    expect(retentionPlanDigest({ asOf: plan.asOf, limit: plan.limit, targets: plan.targets.slice(1) })).not.toBe(plan.planDigest);
    expect(retentionPlanDigest({ asOf: plan.asOf, limit: plan.limit, targets: plan.targets.map((target, index) => (index === 0 ? { ...target, headRevision: 2 } : target)) })).not.toBe(plan.planDigest);
    // the limit bounds the run: 3 aggregates in all, in policy order, and the later types see the remaining budget
    const bounded = await planRetention(new FakePort(seeded().inventories), { rows: retentionPurgeRows(), asOf: NOW, limit: 3 });
    expect(bounded.targets).toHaveLength(3);
    expect(bounded.limit).toBe(3);
    const statuses = seeded().inventories.map((entry) => inventoryStatus(entry));
    expect(statuses.filter((status) => status === "mixed_commit")).toHaveLength(1);
    expect(statuses.filter((status) => status === "outbox_in_flight")).toHaveLength(1);
    expect(inventoryStatus(inventory(RUN_TRACE_AGGREGATE_TYPE, "both", OLD, { mixedCommit: true, outbox: { terminal: 0, inFlight: 2 } }))).toBe("outbox_in_flight"); // the in-flight refusal first: nothing of it may move
    expect(inventoryStatus(inventory(RUN_TRACE_AGGREGATE_TYPE, "done", OLD, { outbox: { terminal: 3, inFlight: 0 } }))).toBe("purgeable");
  });
});

describe("[B24-C2] the purge CLI (OD-202; dry run by default, confirmation always required)", () => {
  it("4. a dry run by default: it prints the header, the as-of, the limit, the runtime, one line per class with the counts and the cutoff, and the planDigest; nothing is deleted; `--apply` without `--confirm` and with a stale `--confirm` are refused with exit 2 and delete nothing", async () => {
    const dry = await cli([]);
    expect(dry.code).toBe(RETENTION_CLI_EXIT.ok);
    expect(dry.port.purged).toEqual([]);
    expect(dry.out[0]).toBe("retention-purge: dry run (nothing is deleted)");
    expect(dry.out).toContain(`as-of: ${NOW}`);
    expect(dry.out).toContain(`limit: ${RETENTION_LIMITS.default}`);
    expect(dry.out).toContain("runtime: non-production");
    expect(dry.out.find((line) => line.startsWith(`${RUN_TRACE_AGGREGATE_TYPE} `))).toBe(`${RUN_TRACE_AGGREGATE_TYPE} (90 days, cutoff 2026-07-10T12:00:00.000Z): aggregates 2 purgeable, 1 refused (mixed_commit 1, outbox_in_flight 0); records 3; replays 3; outbox 0`);
    expect(dry.out.find((line) => line.startsWith(`${ORCHESTRATION_RESUME_AGGREGATE_TYPE} `))).toContain("(30 days, cutoff 2026-09-08T12:00:00.000Z): aggregates 2 purgeable");
    expect(digestLine(dry)).toMatch(/^eng1-[0-9a-f]{16}$/);
    expect(dry.out.at(-1)).toBe(`nothing was deleted (dry run): to delete exactly this set, run --apply --confirm ${digestLine(dry)} --as-of ${NOW}`);
    expect(dry.err).toEqual([]);
    const noConfirm = await cli(["--apply", "--as-of", NOW]);
    expect(noConfirm.code).toBe(RETENTION_CLI_EXIT.refused);
    expect(noConfirm.port.calls).toEqual([]);
    expect(noConfirm.err.join(" ")).toContain("RETENTION_ARGUMENT_MISSING");
    const stale = await cli(["--apply", "--confirm", "eng1-0000000000000000", "--as-of", NOW]);
    expect(stale.code).toBe(RETENTION_CLI_EXIT.refused);
    expect(stale.port.purged).toEqual([]);
    expect(stale.err.join(" ")).toContain("RETENTION_CONFIRMATION_MISMATCH");
    expect(stale.err.join(" ")).toContain("nothing was deleted");
    expect(stale.out.some((line) => line.startsWith("planDigest: "))).toBe(true); // the current digest is printed, so the operator can confirm it
  });

  it("5. the closed flags: --read is refused by the PURGE parser alone ([B24-C3, 2026-10-09] reviewed pin move, D12: scripts/retention-purge.ts dispatches --read to the read mode before this parser sees it, and --read beside a purge flag is refused there before any repository call, b24-c3-trace-read 6), an unknown flag, a stray word, a repeated flag, a malformed --limit or --as-of, --confirm without --apply and --apply without --as-of are each refused with exit 2 BEFORE any repository call", async () => {
    expect([...RETENTION_CLI_FLAGS]).toEqual(["--apply", "--confirm", "--limit", "--as-of"]);
    for (const [argv, code] of [
      [["--read"], "RETENTION_ARGUMENT_UNKNOWN"], [["--read", "run-1"], "RETENTION_ARGUMENT_UNKNOWN"], [["--force"], "RETENTION_ARGUMENT_UNKNOWN"], [["apply"], "RETENTION_ARGUMENT_UNKNOWN"],
      [["--limit", "5", "--limit", "6"], "RETENTION_ARGUMENT_REPEATED"], [["--apply", "--apply", "--confirm", "eng1-0000000000000000", "--as-of", NOW], "RETENTION_ARGUMENT_REPEATED"],
      [["--limit", "0"], "RETENTION_ARGUMENT_MALFORMED"], [["--limit", "10001"], "RETENTION_ARGUMENT_MALFORMED"], [["--limit", "abc"], "RETENTION_ARGUMENT_MALFORMED"], [["--limit", "1.5"], "RETENTION_ARGUMENT_MALFORMED"], [["--limit"], "RETENTION_ARGUMENT_MISSING"],
      [["--as-of", "yesterday"], "RETENTION_ARGUMENT_MALFORMED"], [["--as-of", "2026-10-08"], "RETENTION_ARGUMENT_MALFORMED"], [["--as-of"], "RETENTION_ARGUMENT_MISSING"],
      [["--confirm", "eng1-0000000000000000"], "RETENTION_ARGUMENTS_CONFLICT"], [["--apply", "--confirm", "eng1-0000000000000000"], "RETENTION_ARGUMENT_MISSING"], [["--apply", "--confirm", "nonsense", "--as-of", NOW], "RETENTION_ARGUMENT_MALFORMED"],
    ] as const) {
      const run = await cli(argv);
      expect(run.code, argv.join(" ")).toBe(RETENTION_CLI_EXIT.refused);
      expect(run.port.calls, argv.join(" ")).toEqual([]);
      expect(run.err.join(" "), argv.join(" ")).toContain(code);
      expect(run.err.join(" "), argv.join(" ")).toContain("nothing was deleted");
      const parsed = parseRetentionArguments(argv);
      expect(parsed.ok, argv.join(" ")).toBe(false);
    }
    expect(parseRetentionArguments([])).toEqual({ ok: true, command: { apply: false, confirm: null, limit: RETENTION_LIMITS.default, asOf: null } });
    expect(parseRetentionArguments(["--limit", "10000", "--as-of", NOW])).toEqual({ ok: true, command: { apply: false, confirm: null, limit: 10_000, asOf: NOW } });
    expect(parseRetentionArguments(["--", "--limit", "1"])).toMatchObject({ ok: true, command: { limit: 1 } }); // a bare separator is ignored, as db-migrate's parser does
  });

  it("6. a dry run then an apply at the same --as-of matches and deletes exactly the plan (the counts printed); an apply at a later --as-of is refused as a mismatch; an --as-of after the clock's now is refused before any repository call; a target whose head moved is refused by the port and counted, never a partial chain", async () => {
    const port = seeded();
    const dry = await cli(["--as-of", NOW], { port });
    const digest = digestLine(dry);
    const applied = await cli(["--apply", "--confirm", digest, "--as-of", NOW], { port });
    expect(applied.code).toBe(RETENTION_CLI_EXIT.ok);
    expect(applied.out[0]).toBe("retention-purge: APPLY");
    expect(applied.port.purged.map((target) => target.aggregateKey).sort()).toEqual([`${RUN_TRACE_AGGREGATE_TYPE}:old-a`, `${RUN_TRACE_AGGREGATE_TYPE}:old-b`, `${LLM_CALL_AGGREGATE_TYPE}:old`, `${RUN_TRACE_ATTRIBUTION_AGGREGATE_TYPE}:old`, `${ORCHESTRATION_TRACE_AGGREGATE_TYPE}:old`, `${ORCHESTRATION_RESUME_AGGREGATE_TYPE}:old`, `${ORCHESTRATION_RESUME_AGGREGATE_TYPE}:sixty-days`].sort());
    expect(applied.out.at(-1)).toBe("deleted: aggregates 7, records 8, replays 8, outbox 0; refused: mixed_commit 0, outbox_in_flight 0, head_moved 0, not_found 0");
    const later = await cli(["--apply", "--confirm", digest, "--as-of", "2026-10-08T12:00:01.000Z"], { port: seeded(), now: "2026-10-08T12:00:02.000Z" });
    expect(later.code).toBe(RETENTION_CLI_EXIT.refused);
    expect(later.port.purged).toEqual([]);
    expect(later.err.join(" ")).toContain("RETENTION_CONFIRMATION_MISMATCH");
    const future = await cli(["--as-of", "2026-10-08T12:00:01.000Z"], { now: NOW });
    expect(future.code).toBe(RETENTION_CLI_EXIT.refused);
    expect(future.port.calls).toEqual([]);
    expect(future.err.join(" ")).toContain("RETENTION_AS_OF_IN_FUTURE");
    // a head that moved between the dry run and the apply: the port refuses that aggregate, the CLI counts it and deletes the rest
    const moved = new FakePort(seeded().inventories, (target) => (target.aggregateKey.endsWith(":old-a") ? { ok: false, code: "head_moved" } : { ok: true, deleted: { heads: 1, records: target.recordIds.length, replays: target.replayIds.length, outbox: 0 } }));
    const movedDry = await cli(["--as-of", NOW], { port: moved });
    const movedApply = await cli(["--apply", "--confirm", digestLine(movedDry), "--as-of", NOW], { port: moved });
    expect(movedApply.code).toBe(RETENTION_CLI_EXIT.ok);
    expect(movedApply.out.at(-1)).toBe("deleted: aggregates 6, records 7, replays 7, outbox 0; refused: mixed_commit 0, outbox_in_flight 0, head_moved 1, not_found 0");
    const result = await applyRetention(moved, await planRetention(moved, { rows: retentionPurgeRows(), asOf: NOW, limit: 1_000 }));
    expect(result.refused.head_moved).toBe(1);
  });

  it("7. no CLI output carries the DATABASE_URL value, a payload or a salt (the fake port's inventories hold none, and the CLI prints counts, cutoffs and digests only); a production runtime says so in its header; the modules take the database only through getDb()", async () => {
    const url = FAKE_DATABASE_URL; // the value the environment holds for this case (stubbed in beforeEach), never read back
    expect(url).toContain("db.invalid");
    for (const argv of [[], ["--apply", "--confirm", "eng1-0000000000000000", "--as-of", NOW], ["--read"]]) {
      const run = await cli(argv, { production: true });
      const printed = [...run.out, ...run.err].join(String.fromCharCode(10));
      expect(printed).not.toContain(url);
      expect(printed).not.toContain(["pass", "word"].join(""));
      expect(printed).not.toContain("db.invalid");
      expect(printed).not.toContain("rec-old");
      expect(printed).not.toMatch(/[0-9a-f]{64}/);
      if (argv.length === 0) expect(run.out).toContain("runtime: production (A1 profile staging or production, or NODE_ENV production)");
    }
    const port = read("app/lib/durable-workflow/retention.ts");
    expect(port).toContain('from "../db/client"');
    expect(port).toContain("getDb().transaction(");
    expect(port).not.toMatch(/new\s+PostgresDurableWorkflowRepository\s*\(/); // D11: the port issues its own statements; it constructs no repository
    const script = read("scripts/retention-purge.ts");
    expect(script).toContain("runRetentionCli(");
    expect(script).toContain("new PostgresRetentionPort()");
    expect(script).toMatch(/repositoryFor: \(\) => new PostgresDurableWorkflowRepository\(\)/); // [B24-C3, 2026-10-09] reviewed pin move (D11): the read mode's repository, constructed in the wrapper only and handed to the read-only adapter; was not.toMatch
    expect(script).not.toContain("DATABASE_URL");
    expect(script.match(/loadEnvLocal/g)).toHaveLength(2); // [B24-C3, 2026-10-09] reviewed pin move (D12): imported and handed to the read runner only (`loadEnv: loadEnvLocal`); the purge mode still loads no .env.local; was not.toContain
    expect(read("package.json")).not.toContain("retention-purge"); // no package.json script
    expect(read(".env.example")).not.toMatch(/RETENTION/); // no environment name
  });
});
