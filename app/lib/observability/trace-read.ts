/**
 * [B24-C3] D24-26, OD-211: the operator's READ mode of B24-C2's purge CLI (`scripts/retention-purge.ts --read`) - the pure core. The
 * four stored trace kinds - B24-C1's run trace and LLM call record, B24-C2's attribution and B21-E2b's specialist trace - are read back
 * through their own stores' verified readers (digest recomputed, document re-validated: `run-trace-store.ts`, `llm-call-record-store.ts`,
 * `run-trace-attribution.ts`, `agent/orchestration/trace-attribution.ts`) over a READ-ONLY adapter of the durable-workflow repository and
 * written as ONE JSON document (`sirkit.trace-read-export.v1`) to the CLI's stdout. No route, MCP tool, agent tool or UI reads a stored
 * trace (OD-211), and no access record is written (OD-111 stands: `accessAudit: "not_recorded"`).
 *
 *  - read-only by construction: the adapter reaches `listHeads`, `history`, `loadHead` and `loadRecord` only (the SELECT-only methods of
 *    `durable-workflow/server-repository.ts`); `commit`, `claimOutbox`, `completeOutbox` and `failOutbox` reject TRACE_READ_WRITE_REFUSED,
 *    `getReplay` and `listOutbox` TRACE_READ_METHOD_REFUSED (they would hand out replay results and outbox payloads of every aggregate type
 *    in the scope); the core imports neither the retention port nor its purge;
 *  - closed kinds: `run-trace`, `run-trace-attribution`, `llm-call-record`, `specialist-trace`; any other `--kind` is `read_kind_unknown`
 *    before any repository call - the orchestration run and resume records, the grants and their index, the autonomy setting, the provider
 *    exchange and the computation evidence are not traces or hold text, and no store of theirs is imported here;
 *  - B16-A's read policy (`app/api/pcb-sync/manufacturing-summary.ts`): every entry is `ok`, `absent`, `corrupt` (a bounded code - never a
 *    payload, a thrown message or a stack) or `withheld` (a rendering the redaction authority's `containsSecretShapedText` or the call
 *    record's key-shape rule flags is never printed); the whole document is checked again before it is written;
 *  - bounds: `--limit` 1..100 aggregates (default 20); the output is capped at 1 MiB UTF-8 by dropping whole records from the end
 *    (`truncated`, `omitted`); the WHOLE read has a 30 s deadline from its first repository call (and so has each call within it), and a
 *    deadline or a driver error after the first repository call answers `read_unavailable` (exit 3) with the code and no driver text;
 *  - a production runtime (the purge's predicate) refuses without `--acknowledge-unaudited-read` (`read_production_unacknowledged`).
 *
 * The core reads nothing of the process environment and imports no provider SDK, no durable runtime, no database client and no schema: the
 * CLI passes in the repository (`repositoryFor`), the environment record, the loader of `.env.local`, the clock and the production
 * predicate, and `runTraceReadCli` is the whole CLI but for those (b24-c3-trace-read pins it with an empty environment). Never run by the
 * builder against a live database (OD-191, LB-14): its only runs are b24-c3-trace-read's (in memory) and b24-c3-trace-read-pglite's (a
 * disposable in-process PostgreSQL).
 */
import { containsSecretShapedText } from "../agent/redaction";
import { DurableOrchestrationTraceStore, ORCHESTRATION_TRACE_AGGREGATE_TYPE, specialistTraceIdentity } from "../agent/orchestration/trace-attribution";
import { canonicalDurableScope, durableWorkflowId } from "../durable-workflow/stable";
import type { DurableAggregateIdentity, DurableWorkflowRepository, DurableWorkflowScope } from "../durable-workflow/types";
import { secretShaped } from "./llm-call-record";
import { DurableLlmCallRecordStore, LLM_CALL_AGGREGATE_TYPE, llmCallAggregateKey } from "./llm-call-record-store";
import { DurableRunTraceAttributionStore, RUN_TRACE_ATTRIBUTION_AGGREGATE_TYPE, runTraceAttributionAggregateKey } from "./run-trace-attribution";
import { DurableRunTraceStore, RUN_TRACE_AGGREGATE_TYPE, runTraceAggregateKey } from "./run-trace-store";

export const TRACE_READ_EXPORT_SCHEMA = "sirkit.trace-read-export.v1" as const;
/** The readable kinds, each one store's aggregate type; anything else is `read_kind_unknown`. */
export const TRACE_READ_KINDS = Object.freeze(["run-trace", "run-trace-attribution", "llm-call-record", "specialist-trace"] as const);
export type TraceReadKind = (typeof TRACE_READ_KINDS)[number];
export const TRACE_READ_AGGREGATE_TYPES: Readonly<Record<TraceReadKind, string>> = Object.freeze({
  "run-trace": RUN_TRACE_AGGREGATE_TYPE,
  "run-trace-attribution": RUN_TRACE_ATTRIBUTION_AGGREGATE_TYPE,
  "llm-call-record": LLM_CALL_AGGREGATE_TYPE,
  "specialist-trace": ORCHESTRATION_TRACE_AGGREGATE_TYPE,
});
/** `--run` selects one aggregate of the kinds keyed by a run id; the two keyed by a trace id or a call id are listed instead. */
export const TRACE_READ_RUN_SELECTABLE_KINDS: readonly TraceReadKind[] = Object.freeze(["run-trace", "specialist-trace"]);
/** At most this many aggregates per read: the default and the ceiling (the purge's own range, 1..10000 default 1,000, is untouched). */
export const TRACE_READ_LIMITS = Object.freeze({ default: 20, max: 100 });
export const TRACE_READ_BOUNDS = Object.freeze({ maxOutputBytes: 1_048_576, readDeadlineMs: 30_000 });
export const TRACE_READ_EXIT = Object.freeze({ ok: 0, failed: 1, refused: 2, unavailable: 3 });
export const TRACE_READ_FLAGS = Object.freeze(["--read", "--kind", "--tenant", "--project", "--branch", "--run", "--limit", "--acknowledge-unaudited-read"] as const);
/** B24-C2's purge-only flags (its closed set less the shared `--limit`): beside `--read` each is refused before any repository call. */
export const TRACE_READ_PURGE_ONLY_FLAGS = Object.freeze(["--apply", "--confirm", "--as-of"] as const);
export const TRACE_READ_WRITE_REFUSED = "TRACE_READ_WRITE_REFUSED" as const;
export const TRACE_READ_METHOD_REFUSED = "TRACE_READ_METHOD_REFUSED" as const;
export const TRACE_READ_ACCESS_AUDIT = "not_recorded" as const;
/** The export's closed keys, in order. */
export const TRACE_READ_EXPORT_KEYS = Object.freeze(["schema", "generatedAt", "target", "scope", "kind", "accessAudit", "records", "refused", "truncated", "omitted"] as const);
export const TRACE_READ_ENTRY_STATUSES = Object.freeze(["ok", "absent", "corrupt", "withheld", "unavailable"] as const);
export type TraceReadRefusedStatus = Exclude<(typeof TRACE_READ_ENTRY_STATUSES)[number], "ok">;
/** The codes the core itself writes on a refused entry (a corrupt entry otherwise carries its store's bounded code). */
export const TRACE_READ_ENTRY_CODES = Object.freeze({ absent: "TRACE_READ_ABSENT", withheld: "TRACE_READ_SECRET_SHAPED", keyMismatch: "TRACE_READ_KEY_MISMATCH", headMismatch: "TRACE_READ_HEAD_MISMATCH", failed: "TRACE_READ_FAILED", unavailable: "read_unavailable" });
export type TraceReadRefusalCode = "read_argument_unknown" | "read_argument_repeated" | "read_argument_missing" | "read_argument_malformed" | "read_arguments_conflict" | "read_kind_unknown" | "read_scope_invalid" | "read_run_unsupported" | "read_database_url_missing" | "read_production_unacknowledged";

export interface TraceReadCommand { readonly kind: TraceReadKind; readonly scope: DurableWorkflowScope; readonly runId: string | null; readonly limit: number; readonly acknowledge: boolean }
export type TraceReadArguments = { readonly ok: true; readonly command: TraceReadCommand } | { readonly ok: false; readonly code: TraceReadRefusalCode; readonly message: string };
export interface TraceReadRecordEntry { readonly key: string; readonly revision: number; readonly recordDigest: string; readonly document: unknown }
export interface TraceReadRefusedEntry { readonly key: string; readonly revision: number | null; readonly status: TraceReadRefusedStatus; readonly code: string }
export interface TraceReadExport {
  schema: typeof TRACE_READ_EXPORT_SCHEMA;
  generatedAt: string;
  /** host:port/database only */
  target: string;
  scope: DurableWorkflowScope;
  kind: TraceReadKind;
  accessAudit: typeof TRACE_READ_ACCESS_AUDIT;
  records: TraceReadRecordEntry[];
  refused: TraceReadRefusedEntry[];
  truncated: boolean;
  omitted: number;
}
export interface TraceReadResult { readonly document: TraceReadExport; readonly text: string; readonly exit: number }
export interface TraceReadCliDeps {
  readonly argv: readonly string[];
  /** the environment record (the CLI passes the process's; a test passes `{}`) - `DATABASE_URL` is the one name read */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** loads `.env.local` into `env` (the CLI passes `loadEnvLocal`); called after the arguments parsed, as `scripts/db-migrate.ts` does */
  readonly loadEnv: () => void;
  /** the one JSON document */
  readonly stdout: (text: string) => void;
  readonly stderr: (line: string) => void;
  /** the repository over the database `url` names (the CLI constructs the PostgreSQL one; `url` is never printed) */
  readonly repositoryFor: (url: string) => DurableWorkflowRepository;
  readonly now: () => Date;
  /** the purge's predicate (A1's staging or production profile, or NODE_ENV production), evaluated after `loadEnv` */
  readonly productionRuntime: () => boolean;
}

/** A read that did not complete: a repository call's deadline, or a driver error. The cause is never attached or printed. */
export class TraceReadUnavailableError extends Error {
  readonly code = TRACE_READ_ENTRY_CODES.unavailable;
  constructor(readonly reason: "deadline" | "driver") {
    super(TRACE_READ_ENTRY_CODES.unavailable);
    this.name = "TraceReadUnavailableError";
  }
}

const VALUED = new Set<string>(["--kind", "--tenant", "--project", "--branch", "--run", "--limit"]);
const BARE = new Set<string>(["--read", "--acknowledge-unaudited-read"]);
const REQUIRED = ["--kind", "--tenant", "--project", "--branch"] as const;
const MISSING: Readonly<Record<string, string>> = {
  "--kind": `--kind needs one of ${TRACE_READ_KINDS.join(", ")}.`,
  "--tenant": "--tenant needs the tenant id of the scope.",
  "--project": "--project needs the project id of the scope.",
  "--branch": "--branch needs the branch id of the scope.",
  "--run": "--run needs a run id.",
  "--limit": `--limit needs a count of aggregates, 1 to ${TRACE_READ_LIMITS.max}.`,
};
/** C1's id rule: a run id the stores key on. */
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const INTEGER = /^(?:0|[1-9]\d*)$/;
/** A thrown error's bounded code (B16-A's read policy): never a free-text message. */
const BOUNDED_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
const encoder = new TextEncoder();

/** The redaction authority's denylist and the call record's key shapes (a PEM marker among them), over a rendering. */
export function secretShapedRendering(text: string): boolean {
  return containsSecretShapedText(text) || secretShaped(text);
}
/** Does this argv select the read mode? (`scripts/retention-purge.ts` dispatches on it before the purge parser sees the arguments.) */
export function selectsTraceRead(argv: readonly string[]): boolean {
  return argv.includes("--read");
}

/** Parse the read mode's closed flags; a refusal names its code and nothing of the environment or of a value. Total. */
export function parseTraceReadArguments(argv: readonly string[]): TraceReadArguments {
  const refuse = (code: TraceReadRefusalCode, message: string): TraceReadArguments => ({ ok: false, code, message });
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (token === "--") continue;
    if ((TRACE_READ_PURGE_ONLY_FLAGS as readonly string[]).includes(token)) return refuse("read_arguments_conflict", `${token} is a purge flag; it cannot stand beside --read.`);
    if (VALUED.has(token)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) return refuse("read_argument_missing", MISSING[token]!);
      if (values.has(token)) return refuse("read_argument_repeated", `${token} is given twice.`);
      values.set(token, value);
      index += 1;
      continue;
    }
    if (BARE.has(token)) {
      if (flags.has(token)) return refuse("read_argument_repeated", `${token} is given twice.`);
      flags.add(token);
      continue;
    }
    return refuse("read_argument_unknown", token.startsWith("--") ? `unknown flag ${token.slice(0, 40)}.` : "an argument that is no flag's value.");
  }
  if (!flags.has("--read")) return refuse("read_argument_missing", "--read selects the read mode.");
  for (const flag of REQUIRED) if (!values.has(flag)) return refuse("read_argument_missing", MISSING[flag]!);
  for (const [flag, value] of values) if (value.length > 512 || secretShapedRendering(value)) return refuse("read_argument_malformed", `${flag}'s value is too long or secret-shaped; it is not echoed.`);
  const kindText = values.get("--kind")!;
  if (!(TRACE_READ_KINDS as readonly string[]).includes(kindText)) return refuse("read_kind_unknown", `--kind must be one of ${TRACE_READ_KINDS.join(", ")}.`);
  const kind = kindText as TraceReadKind;
  let scope: DurableWorkflowScope;
  try {
    scope = canonicalDurableScope({ tenantId: values.get("--tenant")!, projectId: values.get("--project")!, branchId: values.get("--branch")! });
  } catch {
    return refuse("read_scope_invalid", "--tenant, --project and --branch must each be a non-blank id the durable substrate accepts (no control character, at most 512 characters).");
  }
  const runId = values.get("--run") ?? null;
  if (runId !== null) {
    if (!ID.test(runId)) return refuse("read_argument_malformed", "--run is not a run id of the stores' id rule.");
    if (!TRACE_READ_RUN_SELECTABLE_KINDS.includes(kind)) return refuse("read_run_unsupported", `--run selects a run-id-keyed aggregate (${TRACE_READ_RUN_SELECTABLE_KINDS.join(", ")}); ${kind} is keyed otherwise - list it without --run.`);
    if (kind === "specialist-trace" && specialistTraceIdentity(runId) === null) return refuse("read_run_unsupported", "--run for specialist-trace is the per-task run id <parentRunId>:<index>-<role>; list without --run to find a coordinator run's tasks.");
  }
  let limit: number = TRACE_READ_LIMITS.default;
  const limitText = values.get("--limit");
  if (limitText !== undefined) {
    if (!INTEGER.test(limitText)) return refuse("read_argument_malformed", "--limit is not a whole number.");
    limit = Number.parseInt(limitText, 10);
    if (limit < 1 || limit > TRACE_READ_LIMITS.max) return refuse("read_argument_malformed", `--limit must be 1 to ${TRACE_READ_LIMITS.max}.`);
  }
  return { ok: true, command: { kind, scope, runId, limit, acknowledge: flags.has("--acknowledge-unaudited-read") } };
}

/** `work` under a deadline (each repository call, and the whole read); a late answer or a rejection is TraceReadUnavailableError (an inner one is kept with its reason), never the driver's text. */
function withDeadline<T>(work: () => Promise<T>, deadlineMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; reject(new TraceReadUnavailableError("deadline")); } }, deadlineMs);
    Promise.resolve().then(work).then(
      (value) => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } },
      (error: unknown) => { if (!settled) { settled = true; clearTimeout(timer); reject(error instanceof TraceReadUnavailableError ? error : new TraceReadUnavailableError("driver")); } },
    );
  });
}

/** The repository as the read mode sees it: four SELECT-only methods under a deadline; every other method rejects. */
export function readOnlyTraceRepository(repository: DurableWorkflowRepository, options: { readonly deadlineMs?: number } = {}): DurableWorkflowRepository {
  const deadlineMs = options.deadlineMs ?? TRACE_READ_BOUNDS.readDeadlineMs;
  const refuseWrite = async (): Promise<never> => { throw new Error(TRACE_READ_WRITE_REFUSED); };
  const refuseMethod = async (): Promise<never> => { throw new Error(TRACE_READ_METHOD_REFUSED); };
  return {
    loadHead<T extends object = object>(identity: DurableAggregateIdentity) { return withDeadline(() => repository.loadHead<T>(identity), deadlineMs); },
    listHeads<T extends object = object>(input: { aggregateType: string; scope: DurableWorkflowScope; limit?: number }) { return withDeadline(() => repository.listHeads<T>(input), deadlineMs); },
    loadRecord<T extends object = object>(scope: DurableWorkflowScope, recordId: string) { return withDeadline(() => repository.loadRecord<T>(scope, recordId), deadlineMs); },
    history<T extends object = object>(identity: DurableAggregateIdentity) { return withDeadline(() => repository.history<T>(identity), deadlineMs); },
    getReplay: refuseMethod,
    listOutbox: refuseMethod,
    commit: refuseWrite,
    claimOutbox: refuseWrite,
    completeOutbox: refuseWrite,
    failOutbox: refuseWrite,
  };
}

type Loaded = { readonly revision: number; readonly recordDigest: string; readonly record: unknown };
interface KindReader {
  readonly aggregateType: string;
  /** the aggregate's selector as its head payload names it (a run id, a trace id, a call id), or null */
  readonly selectorOf: (payload: unknown) => string | null;
  readonly keyOf: (scope: DurableWorkflowScope, selector: string) => string;
  /** the store's verified read of one aggregate: its records in revision order, empty when absent; throws its one closed error */
  readonly read: (scope: DurableWorkflowScope, selector: string) => Promise<Loaded[]>;
}
const stringField = (payload: unknown, name: string): string | null => {
  if (payload === null || typeof payload !== "object") return null;
  const value = (payload as Record<string, unknown>)[name];
  return typeof value === "string" ? value : null;
};
/** The specialist trace's aggregate key as `DurableOrchestrationTraceStore` derives it (its key function is module-local; b24-c3-trace-read 1 pins the two equal). */
export function specialistTraceAggregateKey(scope: DurableWorkflowScope, runId: string): string {
  return durableWorkflowId("agent-orchestration-trace", { tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId, runId });
}
function readers(repository: DurableWorkflowRepository): Readonly<Record<TraceReadKind, KindReader>> {
  const runTraces = new DurableRunTraceStore(repository);
  const attributions = new DurableRunTraceAttributionStore(repository);
  const calls = new DurableLlmCallRecordStore(repository);
  const specialists = new DurableOrchestrationTraceStore(repository);
  return {
    "run-trace": { aggregateType: RUN_TRACE_AGGREGATE_TYPE, selectorOf: (payload) => stringField(payload, "runId"), keyOf: runTraceAggregateKey, read: (scope, runId) => runTraces.history(scope, runId) },
    "run-trace-attribution": { aggregateType: RUN_TRACE_ATTRIBUTION_AGGREGATE_TYPE, selectorOf: (payload) => stringField(payload, "traceId"), keyOf: runTraceAttributionAggregateKey, read: async (scope, traceId) => { const entry = await attributions.load(scope, traceId); return entry === null ? [] : [entry]; } },
    "llm-call-record": { aggregateType: LLM_CALL_AGGREGATE_TYPE, selectorOf: (payload) => stringField(payload, "callId"), keyOf: llmCallAggregateKey, read: async (scope, callId) => { const entry = await calls.load(scope, callId); return entry === null ? [] : [entry]; } },
    "specialist-trace": { aggregateType: ORCHESTRATION_TRACE_AGGREGATE_TYPE, selectorOf: (payload) => stringField(payload, "runId"), keyOf: specialistTraceAggregateKey, read: (scope, runId) => specialists.history(scope, runId) },
  };
}
/** The bounded code of a store's thrown integrity error (its `code`, or a message that IS a code), else TRACE_READ_FAILED. */
function boundedCode(error: unknown): string {
  try {
    const code = error !== null && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
    if (typeof code === "string" && BOUNDED_CODE.test(code)) return code;
    const message = error instanceof Error ? error.message : "";
    if (BOUNDED_CODE.test(message)) return message;
  } catch {
    /* a hostile thrown value renders as the generic code */
  }
  return TRACE_READ_ENTRY_CODES.failed;
}
const refused = (key: string, revision: number | null, status: TraceReadRefusedStatus, code: string): TraceReadRefusedEntry => ({ key, revision, status, code });

/** Every record of the kind in the scope (or of the one aggregate `--run` names), each through its store's verified reader. */
async function collect(repository: DurableWorkflowRepository, command: TraceReadCommand): Promise<{ records: TraceReadRecordEntry[]; refused: TraceReadRefusedEntry[] }> {
  const reader = readers(repository)[command.kind];
  const scope = command.scope;
  const records: TraceReadRecordEntry[] = [];
  const refusals: TraceReadRefusedEntry[] = [];
  const admit = (key: string, loaded: readonly Loaded[]): void => {
    for (const entry of loaded) {
      const record: TraceReadRecordEntry = { key, revision: entry.revision, recordDigest: entry.recordDigest, document: entry.record };
      if (secretShapedRendering(JSON.stringify(record))) refusals.push(refused(key, entry.revision, "withheld", TRACE_READ_ENTRY_CODES.withheld));
      else records.push(record);
    }
  };
  const rethrowUnavailable = (error: unknown): void => { if (error instanceof TraceReadUnavailableError) throw error; };
  if (command.runId !== null) {
    const key = reader.keyOf(scope, command.runId);
    try {
      const loaded = await reader.read(scope, command.runId);
      if (loaded.length === 0) refusals.push(refused(key, null, "absent", TRACE_READ_ENTRY_CODES.absent));
      else admit(key, loaded);
    } catch (error) {
      rethrowUnavailable(error);
      refusals.push(refused(key, null, "corrupt", boundedCode(error)));
    }
    return { records, refused: refusals };
  }
  const heads = await repository.listHeads({ aggregateType: reader.aggregateType, scope, limit: command.limit });
  for (const head of heads) {
    const selector = reader.selectorOf(head.payload);
    let expectedKey: string | null = null;
    try { expectedKey = selector === null ? null : reader.keyOf(scope, selector); } catch { expectedKey = null; }
    if (selector === null || expectedKey !== head.aggregateKey) { refusals.push(refused(head.aggregateKey, head.revision, "corrupt", TRACE_READ_ENTRY_CODES.keyMismatch)); continue; }
    let loaded: Loaded[];
    try {
      loaded = await reader.read(scope, selector);
    } catch (error) {
      rethrowUnavailable(error);
      refusals.push(refused(head.aggregateKey, head.revision, "corrupt", boundedCode(error)));
      continue;
    }
    const last = loaded.at(-1);
    if (last === undefined || last.revision !== head.revision || last.recordDigest !== head.recordDigest) { refusals.push(refused(head.aggregateKey, head.revision, "corrupt", TRACE_READ_ENTRY_CODES.headMismatch)); continue; }
    admit(head.aggregateKey, loaded);
  }
  return { records, refused: refusals };
}

/** The document rendered within the byte cap: whole records dropped from the end, never cut. */
function renderBounded(document: TraceReadExport, maxOutputBytes: number): string {
  let text = JSON.stringify(document);
  while (encoder.encode(text).length > maxOutputBytes && document.records.length > 0) {
    document.records.pop();
    document.omitted += 1;
    document.truncated = true;
    text = JSON.stringify(document);
  }
  return text;
}

/** The pure read: the export document, its rendering and the exit code (0 every entry ok or absent; 1 any corrupt or withheld; 3 unavailable). */
export async function readTraceExport(input: { readonly repository: DurableWorkflowRepository; readonly command: TraceReadCommand; readonly target: string; readonly now: () => Date; readonly bounds?: { readonly maxOutputBytes?: number; readonly readDeadlineMs?: number } }): Promise<TraceReadResult> {
  const bounds = { ...TRACE_READ_BOUNDS, ...input.bounds };
  const base = (): TraceReadExport => ({ schema: TRACE_READ_EXPORT_SCHEMA, generatedAt: input.now().toISOString(), target: input.target, scope: { ...input.command.scope }, kind: input.command.kind, accessAudit: TRACE_READ_ACCESS_AUDIT, records: [], refused: [], truncated: false, omitted: 0 });
  try {
    // [B24-C3 review fix, 2026-10-09] the deadline is on the WHOLE read - one clock from the first repository call - as well as on each call the adapter makes
    const collected = await withDeadline(() => collect(readOnlyTraceRepository(input.repository, { deadlineMs: bounds.readDeadlineMs }), input.command), bounds.readDeadlineMs);
    const collectedCount = collected.records.length; // every record collected, before the cap drops any ([B24-C3 review fix, 2026-10-09]: a withheld document's `omitted` counted the records the cap had left)
    const document: TraceReadExport = { ...base(), records: collected.records, refused: collected.refused };
    const text = renderBounded(document, bounds.maxOutputBytes);
    if (secretShapedRendering(text)) {
      // the second check: a rendering the per-record check let through is withheld whole (every collected record, kept or dropped, is omitted); the operator's own scope and target stand
      const withheld: TraceReadExport = { ...base(), refused: [refused(input.command.kind, null, "withheld", TRACE_READ_ENTRY_CODES.withheld)], truncated: true, omitted: collectedCount };
      return { document: withheld, text: JSON.stringify(withheld), exit: TRACE_READ_EXIT.failed };
    }
    const failed = document.refused.some((entry) => entry.status === "corrupt" || entry.status === "withheld");
    return { document, text, exit: failed ? TRACE_READ_EXIT.failed : TRACE_READ_EXIT.ok };
  } catch {
    // a deadline, a driver error, or anything else that stopped the read: one document with the code and no driver text
    const document: TraceReadExport = { ...base(), refused: [refused(input.command.kind, null, "unavailable", TRACE_READ_ENTRY_CODES.unavailable)] };
    return { document, text: JSON.stringify(document), exit: TRACE_READ_EXIT.unavailable };
  }
}

/** The database URL as host:port/database (`scripts/db-migrate.ts`'s rule): never its user or password. */
export function redactedTraceReadTarget(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}:${parsed.port || "5432"}${parsed.pathname}`;
  } catch {
    return "<unparseable url>";
  }
}

/** The read mode's CLI: 2 refused before any repository call, 3 unavailable, 1 any corrupt or withheld record, 0 otherwise. Never throws. */
export async function runTraceReadCli(deps: TraceReadCliDeps): Promise<number> {
  const refuse = (code: TraceReadRefusalCode, message: string): number => { deps.stderr(`REFUSED ${code}: ${message} - nothing was read.`); return TRACE_READ_EXIT.refused; };
  const parsed = parseTraceReadArguments(deps.argv);
  if (!parsed.ok) return refuse(parsed.code, parsed.message);
  const command = parsed.command;
  try {
    deps.loadEnv();
    const url = deps.env.DATABASE_URL;
    if (typeof url !== "string" || url.length === 0) return refuse("read_database_url_missing", "DATABASE_URL is not set (add it to .env.local or the environment).");
    if (deps.productionRuntime() && !command.acknowledge) return refuse("read_production_unacknowledged", "this is a production runtime (A1 profile staging or production, or NODE_ENV production) and no access audit is recorded (OD-211, OD-111); pass --acknowledge-unaudited-read to read anyway.");
    const target = redactedTraceReadTarget(url);
    let repository: DurableWorkflowRepository;
    try {
      repository = deps.repositoryFor(url);
    } catch {
      const document: TraceReadExport = { schema: TRACE_READ_EXPORT_SCHEMA, generatedAt: deps.now().toISOString(), target, scope: { ...command.scope }, kind: command.kind, accessAudit: TRACE_READ_ACCESS_AUDIT, records: [], refused: [refused(command.kind, null, "unavailable", TRACE_READ_ENTRY_CODES.unavailable)], truncated: false, omitted: 0 };
      deps.stdout(JSON.stringify(document));
      deps.stderr(`FAILED ${TRACE_READ_ENTRY_CODES.unavailable}: the repository could not be opened; nothing of the driver's message is printed.`);
      return TRACE_READ_EXIT.unavailable;
    }
    const result = await readTraceExport({ repository, command, target, now: deps.now });
    deps.stdout(result.text);
    const counts = (status: TraceReadRefusedStatus): number => result.document.refused.filter((entry) => entry.status === status).length;
    if (result.exit === TRACE_READ_EXIT.unavailable) deps.stderr(`FAILED ${TRACE_READ_ENTRY_CODES.unavailable}: the read did not complete (a deadline or a driver error after the first repository call); nothing of the driver's message is printed.`);
    else deps.stderr(`trace-read ${command.kind}: records ${result.document.records.length}; refused ${result.document.refused.length} (absent ${counts("absent")}, corrupt ${counts("corrupt")}, withheld ${counts("withheld")}); truncated ${result.document.truncated} (omitted ${result.document.omitted}); access audit ${TRACE_READ_ACCESS_AUDIT}`);
    return result.exit;
  } catch {
    deps.stderr(`FAILED ${TRACE_READ_ENTRY_CODES.unavailable}: the read did not complete; nothing of the error is printed.`);
    return TRACE_READ_EXIT.unavailable;
  }
}
