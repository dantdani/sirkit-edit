/**
 * [B20 B3] The durable read bundle (D-2, D-3; OD-67): the approved durable authority adapter (`resource-envelopes.ts`
 * trust boundary) that turns the project's DURABLE server board into a sealed read bundle for a principal with no browser.
 *
 *  - The board is the current generation of the lineage rooted at `board:<projectId>` (`DurableBoardLineageStore.
 *    resolveCurrent`), loaded through `DurablePcbSyncRepository.getBoardHead`, whose record digest is re-verified on every
 *    load; its shape is checked by a local duplicate of the agent's board predicate and its structure by
 *    `validatePcbBoardStructure`, and a validator throw is an invalid board (the agent's rule, `agent/context.ts`).
 *  - The canonical state holds the board and no schematic, so its canonical revision is what a read is pinned to.
 *  - Only the resource kinds a read binding declares are built: canonical state from the board, the DRC and fabrication
 *    presets from the static catalog (sealed `catalog`, as the B05.1 replay fixtures do), component authority from the
 *    server-owned B13 source for the components the board's synchronized footprints name, under the agent's bounds.
 *  - Nothing here writes: `readOnlyDurableWorkflow` refuses every write (and the outbox listing) without delegating.
 *
 * MCP-free: nothing here imports an agent, MCP, auth, route or provider module (b20-b3-import-gates G2). Every function
 * returns a closed outcome and never throws; the read-only view's rejecting methods are the one documented exception (S4).
 */
import type { DurableAggregateIdentity, DurableWorkflowRepository, DurableWorkflowScope } from "../durable-workflow/types";
import { PCB_BOARD_ASSEMBLY_VARIANT_ID, PCB_BOARD_HIERARCHY_PATH, pcbBoardInstanceId } from "../pcb/board-identity";
import { getPreset } from "../pcb/drc/presets";
import { getFabPreset } from "../pcb/fab/presets";
import type { PcbBoard } from "../pcb/types";
import { DurableBoardLineageStore } from "../pcb-sync/board-lineage";
import { DurablePcbSyncRepository } from "../pcb-sync/durable";
import { loadRunComponentAuthority, type ComponentAuthoritySourceDeps } from "./component-authority-source";
import type { ComponentAuthorityRecord, ComponentCatalogCandidate } from "./component-authority";
import { validatePcbBoardStructure } from "./pcb-board-structure";
import { buildReadResourceBundle, sealResourceEnvelope, type ReadAuthorityResourceEnvelope, type ReadResourceBundle, type ReadResourceKind } from "./resource-envelopes";
import { computeProjectRevision } from "./revision";
import { engineeringDigest } from "./stable";
import { resolveReadBinding } from "./tool-bindings-readonly";
import type { ToolDescriptor } from "./tool-registry";
import { STAGE10_SCHEMA_VERSION, type CanonicalProjectState } from "./types";

// ── Bounds ─────────────────────────────────────────────────────────────────────

export const DURABLE_BOARD_READ_DEADLINE_MS = 5_000;
export const DURABLE_AUTHORITY_DEADLINE_MS = 5_000;
/** The agent's component bound (`component-authority-source.ts` MAX_AUTHORITY_COMPONENTS), judged before any sort. */
export const DURABLE_AUTHORITY_MAX_COMPONENTS = 512;
/** The agent's record and candidate bounds (`agent/context.ts` MAX_AUTHORITY_RECORDS / MAX_AUTHORITY_CANDIDATES). */
export const DURABLE_AUTHORITY_MAX_RECORDS = 512;
export const DURABLE_AUTHORITY_MAX_CANDIDATES = 512;
export const DURABLE_READ_BOUNDS = Object.freeze({
  DURABLE_BOARD_READ_DEADLINE_MS,
  DURABLE_AUTHORITY_DEADLINE_MS,
  DURABLE_AUTHORITY_MAX_COMPONENTS,
  DURABLE_AUTHORITY_MAX_RECORDS,
  DURABLE_AUTHORITY_MAX_CANDIDATES,
});
const BOUND_CEILINGS: Readonly<Record<keyof typeof DURABLE_READ_BOUNDS, number>> = Object.freeze({
  DURABLE_BOARD_READ_DEADLINE_MS: 60_000,
  DURABLE_AUTHORITY_DEADLINE_MS: 60_000,
  DURABLE_AUTHORITY_MAX_COMPONENTS: 4_096,
  DURABLE_AUTHORITY_MAX_RECORDS: 4_096,
  DURABLE_AUTHORITY_MAX_CANDIDATES: 4_096,
});

/** S3: exactly the five bounds, each a safe integer in [1, its ceiling] (NaN, Infinity, negative, zero, fractional refused). */
export function validateDurableReadBounds(value: unknown): string[] {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return ["the bounds are not an object"];
    const record = value as Record<string, unknown>;
    const errors: string[] = [];
    const names = Object.keys(BOUND_CEILINGS);
    for (const key of Object.keys(record)) if (!names.includes(key)) errors.push(`unknown bound ${key.slice(0, 64)}`);
    for (const [name, ceiling] of Object.entries(BOUND_CEILINGS)) {
      const bound = record[name];
      if (typeof bound !== "number" || !Number.isSafeInteger(bound) || bound < 1 || bound > ceiling) errors.push(`${name} must be a safe integer in [1, ${ceiling}]`);
    }
    return errors;
  } catch {
    return ["the bounds could not be read"];
  }
}

/** The kinds this adapter can seal from durable state; a binding that REQUIRES any other kind is not servable. */
export const DURABLE_BUILDABLE_RESOURCE_KINDS = Object.freeze(["canonical-state", "drc-rules", "drc-preset", "fab-preset", "component-authority-records"] as const);
/** A current board id: the lineage root `board:<projectId>` or a derived generation `<root>@r<n>` (board-identity.ts). */
export const DURABLE_BOARD_ID_PATTERN = /^board:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}(@r[0-9]{1,6})?$/;
export const DURABLE_READ_ONLY_VIEW_ERROR = "DW_READ_ONLY_VIEW" as const;
export const DURABLE_READ_PRODUCER = "durable-read-bundle-assembler" as const;
export const DURABLE_READ_PRODUCER_VERSION = "1.0.0" as const;
/** The request-scope id rule (the one `trusted-request-context.ts` applies; restated because auth/* is out of reach here). */
const SCOPE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const BOARD_AGGREGATE_ERRORS = Object.freeze(["PS_BOARD_RECORD_DIGEST_MISMATCH", "PS_BOARD_LINEAGE_DIGEST_MISMATCH"]);

// ── The read-only view ─────────────────────────────────────────────────────────

const readOnlyRefusal = (): Promise<never> => Promise.reject(new Error(DURABLE_READ_ONLY_VIEW_ERROR));

/**
 * The durable repository with its reads delegated and every write refused: `commit`, `claimOutbox`, `completeOutbox` and
 * `failOutbox` reject with DW_READ_ONLY_VIEW without delegating, and so does `listOutbox` — a read, refused for least
 * privilege. These rejecting methods are the documented exception to the never-throw rule (S4).
 */
export function readOnlyDurableWorkflow(workflow: DurableWorkflowRepository): DurableWorkflowRepository {
  return Object.freeze({
    loadHead: async <T extends object = object>(identity: DurableAggregateIdentity) => workflow.loadHead<T>(identity),
    listHeads: async <T extends object = object>(input: { aggregateType: string; scope: DurableWorkflowScope; limit?: number }) => workflow.listHeads<T>(input),
    loadRecord: async <T extends object = object>(scope: DurableWorkflowScope, recordId: string) => workflow.loadRecord<T>(scope, recordId),
    history: async <T extends object = object>(identity: DurableAggregateIdentity) => workflow.history<T>(identity),
    getReplay: async <TResult extends object = object>(scope: DurableWorkflowScope, scopeKey: string, idempotencyKey: string) => workflow.getReplay<TResult>(scope, scopeKey, idempotencyKey),
    commit: readOnlyRefusal,
    claimOutbox: readOnlyRefusal,
    completeOutbox: readOnlyRefusal,
    failOutbox: readOnlyRefusal, renewOutboxLease: readOnlyRefusal, // [PR-L, 2026-10-17] S2 lease renewal is a write: refused like the four above (kept on this line so the cited lines below do not move)
    listOutbox: readOnlyRefusal,
  }) as DurableWorkflowRepository;
}

// ── The board reader ───────────────────────────────────────────────────────────

export interface DurableReadScope {
  readonly tenantId: string;
  readonly projectId: string;
  readonly branchId: string;
}
export interface DurableBoardHead {
  readonly boardId: string;
  /** the pcb2 semantic content revision */
  readonly revision: string;
  /** the pb1 sha256 board digest */
  readonly digest: string;
  /** the durable aggregate revision (recorded; a content-identical republish moves it and leaves a read valid) */
  readonly aggregateRevision: number;
}
export type DurableBoardLoad =
  | { readonly status: "found"; readonly head: DurableBoardHead; readonly board: PcbBoard }
  | { readonly status: "not_found" }
  | { readonly status: "unavailable" }
  | { readonly status: "corrupt" }
  | { readonly status: "invalid" };
/**
 * [B20 B3 review] A durable work tracker: called once, synchronously, when a load starts repository reads, it returns the
 * callback the reader calls exactly once when those reads have themselves settled — possibly after `load` answered at its
 * deadline or on the signal, because a durable query is not cancellable. The MCP read pipeline holds its admission slot
 * until then (read-call.ts), so its caps bound outstanding database work, not only answered calls.
 */
export type DurableWorkTracker = () => () => void;
export interface DurableBoardReader {
  load(scope: DurableReadScope, signal?: AbortSignal, deadlineMs?: number, track?: DurableWorkTracker): Promise<DurableBoardLoad>;
}

const NOT_FOUND: DurableBoardLoad = Object.freeze({ status: "not_found" });
const UNAVAILABLE: DurableBoardLoad = Object.freeze({ status: "unavailable" });
const CORRUPT: DurableBoardLoad = Object.freeze({ status: "corrupt" });
const INVALID: DurableBoardLoad = Object.freeze({ status: "invalid" });

/** The agent's board predicate (`agent/context.ts` isBoardShape, private there), restated: stackup 2 or 4 and the five arrays. */
function isDurableBoardShape(value: unknown): value is PcbBoard {
  if (typeof value !== "object" || value === null) return false;
  const board = value as Record<string, unknown>;
  return (board.stackup === 2 || board.stackup === 4) && Array.isArray(board.nets) && Array.isArray(board.footprints) && Array.isArray(board.tracks) && Array.isArray(board.vias) && Array.isArray(board.zones);
}

/** Whether a board would become canonical state: the shape, then the whole-board structural validation; a throw rejects. */
export function durableBoardAccepted(value: unknown): value is PcbBoard {
  try {
    if (!isDurableBoardShape(value)) return false;
    return validatePcbBoardStructure(value).length === 0;
  } catch {
    return false;
  }
}

function scopeOf(value: unknown): DurableReadScope | null {
  try {
    if (typeof value !== "object" || value === null) return null;
    const { tenantId, projectId, branchId } = value as Record<string, unknown>;
    for (const id of [tenantId, projectId, branchId]) if (typeof id !== "string" || !SCOPE_ID_PATTERN.test(id)) return null;
    return { tenantId: tenantId as string, projectId: projectId as string, branchId: branchId as string };
  } catch {
    return null;
  }
}
const positiveDeadline = (value: unknown, fallback: number): number => (typeof value === "number" && Number.isSafeInteger(value) && value >= 1 ? Math.min(value, fallback) : fallback);

/** Resolve the current board of the project's lineage and load it, digest-verified and validated (never races, never throws). */
async function loadCurrentBoard(workflow: DurableWorkflowRepository, scope: DurableReadScope): Promise<DurableBoardLoad> {
  try {
    const lineage = await new DurableBoardLineageStore(workflow).resolveCurrent(scope, pcbBoardInstanceId(scope.projectId));
    const boardId = lineage.currentBoardId;
    if (typeof boardId !== "string" || !DURABLE_BOARD_ID_PATTERN.test(boardId)) return INVALID;
    const head = await new DurablePcbSyncRepository(workflow).getBoardHead({ ...scope, boardId });
    if (head === null) return NOT_FOUND;
    const { record, aggregateRevision } = head;
    if (record.tenantId !== scope.tenantId || record.projectId !== scope.projectId || record.branchId !== scope.branchId || record.boardId !== boardId) return CORRUPT;
    if (typeof record.revision !== "string" || typeof record.digest !== "string" || !Number.isSafeInteger(aggregateRevision) || aggregateRevision < 1) return CORRUPT;
    if (!durableBoardAccepted(record.board)) return INVALID;
    return Object.freeze({ status: "found", head: Object.freeze({ boardId, revision: record.revision, digest: record.digest, aggregateRevision }), board: record.board });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return BOARD_AGGREGATE_ERRORS.includes(message) ? CORRUPT : UNAVAILABLE; // PS_BOARD_LINEAGE_TOO_DEEP and every throw: unavailable
  }
}

/** Start tracked work: the tracker's end callback (idempotent), or a no-op when there is no tracker or it fails. Never throws. */
export function startTrackedWork(track: DurableWorkTracker | undefined): () => void {
  let end: unknown = null;
  try {
    end = typeof track === "function" ? track() : null;
  } catch {
    end = null;
  }
  let open = true;
  return () => {
    if (!open) return;
    open = false;
    try {
      if (typeof end === "function") (end as () => void)();
    } catch {
      // a failing tracker never alters the answer
    }
  };
}

/**
 * The durable board reader over one (read-only) workflow. `load` validates the scope, resolves and loads the current board,
 * and races it against its deadline (at most `deadlineMs`, 5 000 ms by default) and the signal: exactly one settlement, a late
 * settlement or rejection ignored. It never rejects. [B20 B3 review] The repository reads it starts are reported to `track`,
 * and their end only once they settle — before the answer when they win the race, after it when the deadline or the signal
 * does (the queries cannot be cancelled, so the caller's caps must keep counting them).
 */
export function createDurableBoardReader(workflow: DurableWorkflowRepository, options: { deadlineMs?: number } = {}): DurableBoardReader {
  const ownDeadline = positiveDeadline(options?.deadlineMs, DURABLE_BOARD_READ_DEADLINE_MS);
  const reader: DurableBoardReader = {
    load(scopeInput: DurableReadScope, signal?: AbortSignal, deadlineMs?: number, track?: DurableWorkTracker): Promise<DurableBoardLoad> {
      const scope = scopeOf(scopeInput);
      if (scope === null) return Promise.resolve(UNAVAILABLE);
      try {
        if (signal?.aborted) return Promise.resolve(UNAVAILABLE);
      } catch {
        return Promise.resolve(UNAVAILABLE);
      }
      const limit = positiveDeadline(deadlineMs, ownDeadline);
      return new Promise<DurableBoardLoad>((resolve) => {
        let settled = false;
        const onAbort = (): void => settle(UNAVAILABLE);
        function settle(value: DurableBoardLoad): void {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          try { signal?.removeEventListener("abort", onAbort); } catch { /* a hostile signal is ignored */ }
          resolve(value);
        }
        const timer = setTimeout(() => settle(UNAVAILABLE), limit);
        try { signal?.addEventListener("abort", onAbort, { once: true }); } catch { settle(UNAVAILABLE); return; }
        const endWork = startTrackedWork(track);
        loadCurrentBoard(workflow, scope).then((value) => { endWork(); settle(value); }, () => { endWork(); settle(UNAVAILABLE); });
      });
    },
  };
  return reader;
}

// ── Canonical state, revision and the post-check ───────────────────────────────

/** The canonical state of a durable read: exactly the agent's shape for a board with no schematic (`agent/context.ts`). */
export function durableCanonicalState(scope: DurableReadScope, board: PcbBoard): CanonicalProjectState {
  return { schemaVersion: STAGE10_SCHEMA_VERSION, tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId, pcb: board, pinnedAssets: [] };
}
/** The revision a durable read is pinned to: the canonical state digest (`eng1-`; FNV, not a security primitive). */
export function durableBoundRevision(state: CanonicalProjectState): string {
  return computeProjectRevision(state).canonicalStateDigest;
}

export type DurablePostCheck = "unchanged" | "changed" | "unavailable";

/**
 * The durable post-check (B05's post-verification extended to durable state): re-resolve and re-load, then compare the board
 * id, the pcb2 revision and the pb1 sha256 digest. The aggregate revision is recorded but not compared: a content-identical
 * republish leaves the read valid. A board that is gone is `changed`; a reader that fails is `unavailable`. The reads it starts
 * are reported to `track` like a load's.
 */
export async function durableBoardUnchanged(reader: DurableBoardReader, scope: DurableReadScope, head: DurableBoardHead, signal?: AbortSignal, deadlineMs?: number, track?: DurableWorkTracker): Promise<DurablePostCheck> {
  try {
    const expected = { boardId: head.boardId, revision: head.revision, digest: head.digest };
    if (typeof expected.boardId !== "string" || typeof expected.revision !== "string" || typeof expected.digest !== "string") return "unavailable";
    const load = await reader.load(scope, signal, deadlineMs, track);
    if (load.status === "not_found") return "changed";
    if (load.status !== "found") return "unavailable";
    return load.head.boardId === expected.boardId && load.head.revision === expected.revision && load.head.digest === expected.digest ? "unchanged" : "changed";
  } catch {
    return "unavailable";
  }
}

// ── Component authority ────────────────────────────────────────────────────────

/**
 * The component instances a board names: the unique `syncIdentity.componentInstanceId` of its synchronized footprints
 * (board-only footprints name none), sorted. The footprint count and the collected count are judged against the bound
 * BEFORE any sort; over it, null (the resource is withheld).
 */
export function durableComponentInstanceIds(board: PcbBoard): string[] | null {
  try {
    const footprints = board.footprints;
    if (!Array.isArray(footprints) || footprints.length > DURABLE_AUTHORITY_MAX_COMPONENTS) return null;
    const seen = new Set<string>();
    for (const footprint of footprints) {
      const id = (footprint as { syncIdentity?: { componentInstanceId?: unknown } } | null)?.syncIdentity?.componentInstanceId;
      if (typeof id === "string" && id.length > 0) seen.add(id);
      if (seen.size > DURABLE_AUTHORITY_MAX_COMPONENTS) return null;
    }
    const ids = [...seen];
    if (ids.length > DURABLE_AUTHORITY_MAX_COMPONENTS) return null;
    return ids.sort();
  } catch {
    return null;
  }
}

/** The agent's guard over server-owned records (`agent/context.ts`): bounded arrays, every record an object with a componentId. */
export function durableAuthorityGuard(value: unknown): { records: readonly ComponentAuthorityRecord[]; candidates: readonly ComponentCatalogCandidate[] } | null {
  try {
    if (typeof value !== "object" || value === null) return null;
    const supplied = value as { records?: unknown; candidates?: unknown };
    const records = supplied.records;
    const candidates = supplied.candidates ?? [];
    if (!Array.isArray(records) || records.length > DURABLE_AUTHORITY_MAX_RECORDS || !Array.isArray(candidates) || candidates.length > DURABLE_AUTHORITY_MAX_CANDIDATES) return null;
    if (records.some((record) => typeof record !== "object" || record === null || (record as ComponentAuthorityRecord).componentId === undefined)) return null;
    return { records: records as ComponentAuthorityRecord[], candidates: candidates as ComponentCatalogCandidate[] };
  } catch {
    return null;
  }
}

// ── The bundle ─────────────────────────────────────────────────────────────────

export interface AssembleDurableReadBundleInput {
  readonly scope: DurableReadScope;
  readonly loaded: { readonly head: DurableBoardHead; readonly board: PcbBoard };
  readonly descriptor: ToolDescriptor;
  /** resolves the server-owned component-authority source; called only when the binding declares that kind */
  readonly componentAuthority?: (() => ComponentAuthoritySourceDeps | null) | null;
  readonly signal?: AbortSignal;
  readonly deadlineMs?: number;
}
export type DurableBundleAssembly =
  | { readonly status: "assembled"; readonly bundle: ReadResourceBundle; readonly revision: string; readonly kinds: readonly ReadResourceKind[] }
  | { readonly status: "not_servable" };
const NOT_SERVABLE: DurableBundleAssembly = Object.freeze({ status: "not_servable" });

async function loadAuthority(input: AssembleDurableReadBundleInput, scope: DurableReadScope, board: PcbBoard, revision: string): Promise<{ records: readonly ComponentAuthorityRecord[]; candidates: readonly ComponentCatalogCandidate[] } | null> {
  const componentInstanceIds = durableComponentInstanceIds(board);
  if (componentInstanceIds === null) return null;
  let source: ComponentAuthoritySourceDeps | null = null;
  try {
    source = typeof input.componentAuthority === "function" ? input.componentAuthority() : null;
  } catch {
    source = null;
  }
  if (!source) return null;
  const deadline = positiveDeadline(input.deadlineMs, DURABLE_AUTHORITY_DEADLINE_MS);
  try {
    const loaded = await loadRunComponentAuthority(source, {
      scope: { ...scope, boardInstanceId: pcbBoardInstanceId(scope.projectId) },
      canonicalRevision: revision,
      componentInstanceIds,
      hierarchyPath: PCB_BOARD_HIERARCHY_PATH,
      assemblyVariantId: PCB_BOARD_ASSEMBLY_VARIANT_ID,
      ...(input.signal ? { signal: input.signal } : {}),
    }, deadline);
    return durableAuthorityGuard(loaded);
  } catch {
    return null;
  }
}

/**
 * Seal the bundle of exactly the kinds the descriptor's read binding declares (required and optional). A required kind this
 * adapter cannot build answers `not_servable`; an optional one is left out (the readiness netlist). Component authority that
 * cannot be loaded is left out, so the read service refuses `missing_resource`. Never rejects.
 */
export async function assembleDurableReadBundle(input: AssembleDurableReadBundleInput): Promise<DurableBundleAssembly> {
  try {
    const scope = scopeOf(input?.scope);
    const board = input?.loaded?.board;
    if (scope === null || !durableBoardAccepted(board)) return NOT_SERVABLE;
    const resolution = resolveReadBinding(input.descriptor);
    if (resolution.state !== "resolved") return NOT_SERVABLE;
    const buildable = DURABLE_BUILDABLE_RESOURCE_KINDS as readonly string[];
    if (resolution.binding.requiredResources.some((kind) => !buildable.includes(kind))) return NOT_SERVABLE;
    const kinds = [...resolution.binding.requiredResources, ...(resolution.binding.optionalResources ?? [])].filter((kind) => buildable.includes(kind));
    const state = durableCanonicalState(scope, board);
    const revision = durableBoundRevision(state);
    const common = { tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId, authorityStatus: "verified" as const, sourceCanonicalRevision: revision, freshness: "current" as const };
    const canonical = sealResourceEnvelope({ ...common, resourceId: `canonical:${scope.projectId}`, kind: "canonical-state", authoritySource: "durable-server-board", sourceVersion: revision, producer: DURABLE_READ_PRODUCER, producerVersion: DURABLE_READ_PRODUCER_VERSION, content: state });
    // the preset the agent picks for the same board (agent/context.ts presetId): static server code, sealed as catalog authority
    const presetId = board.stackup === 4 ? "jlcpcb-4l" : "jlcpcb-2l";
    const auxiliary: ReadAuthorityResourceEnvelope[] = [];
    if (kinds.includes("drc-rules") || kinds.includes("drc-preset")) {
      const drc = getPreset(presetId);
      if (kinds.includes("drc-rules")) auxiliary.push(sealResourceEnvelope({ ...common, resourceId: `drc-rules:${presetId}`, kind: "drc-rules", authoritySource: "catalog", sourceVersion: presetId, producer: "pcb/drc/presets", producerVersion: String(drc.version), content: drc.rules }));
      if (kinds.includes("drc-preset")) auxiliary.push(sealResourceEnvelope({ ...common, resourceId: `drc-preset:${presetId}`, kind: "drc-preset", authoritySource: "catalog", sourceVersion: presetId, producer: "pcb/drc/presets", producerVersion: String(drc.version), content: drc }));
    }
    if (kinds.includes("fab-preset")) {
      const fab = getFabPreset(presetId);
      auxiliary.push(sealResourceEnvelope({ ...common, resourceId: `fab-preset:${presetId}`, kind: "fab-preset", authoritySource: "catalog", sourceVersion: presetId, producer: "pcb/fab/presets", producerVersion: String(fab.version), content: fab }));
    }
    if (kinds.includes("component-authority-records")) {
      const authority = await loadAuthority(input, scope, board, revision);
      if (authority !== null) {
        const content = { records: authority.records, candidates: authority.candidates };
        auxiliary.push(sealResourceEnvelope({
          ...common,
          resourceId: `component-authority:${scope.projectId}`,
          kind: "component-authority-records",
          authoritySource: "durable-server-board",
          sourceVersion: engineeringDigest({ schema: "sirkit.component-authority-records.v1", records: content.records, candidates: content.candidates }),
          producer: "component-authority-source",
          producerVersion: "1.0.0",
          content,
        }));
      }
    }
    const bundle = buildReadResourceBundle(canonical, auxiliary);
    return Object.freeze({ status: "assembled", bundle, revision, kinds: Object.freeze([...kinds]) });
  } catch {
    return NOT_SERVABLE;
  }
}
