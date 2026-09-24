/**
 * [B20 B3] A — the durable read bundle (D-2, D-3; OD-67): the current generation of the board lineage rooted at
 * `board:<projectId>`, digest re-verified and structurally validated on every load, turned into a sealed read bundle of
 * exactly the kinds a read binding declares — canonical state from the durable board, presets from the static catalog,
 * component authority from the server-owned source — and the post-check that compares the board after the read. Everything
 * runs over the in-memory durable repository (no database); the reader reaches it only through `loadHead`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { assembleAgentRunContext, buildAgentResourceBundle, MAX_AUTHORITY_CANDIDATES, MAX_AUTHORITY_RECORDS } from "../../agent/context";
import { InMemoryDurableWorkflowRepository } from "../../durable-workflow/repository";
import type { DurableAggregateRecord, DurableWorkflowRepository } from "../../durable-workflow/types";
import { pcbBoardInstanceId } from "../../pcb/board-identity";
import { pcbRevisionId } from "../../pcb/revision";
import type { PcbBoard } from "../../pcb/types";
import { boardDigest } from "../../pcb-sync/board";
import { BOARD_LINEAGE_AGGREGATE } from "../../pcb-sync/board-lineage";
import { MAX_AUTHORITY_COMPONENTS } from "../component-authority-source";
import { validatePcbBoardStructure } from "../pcb-board-structure";
import {
  DURABLE_AUTHORITY_DEADLINE_MS,
  DURABLE_AUTHORITY_MAX_CANDIDATES,
  DURABLE_AUTHORITY_MAX_COMPONENTS,
  DURABLE_AUTHORITY_MAX_RECORDS,
  DURABLE_BOARD_ID_PATTERN,
  DURABLE_BOARD_READ_DEADLINE_MS,
  DURABLE_BUILDABLE_RESOURCE_KINDS,
  DURABLE_READ_BOUNDS,
  DURABLE_READ_ONLY_VIEW_ERROR,
  assembleDurableReadBundle,
  createDurableBoardReader,
  durableAuthorityGuard,
  durableBoardAccepted,
  durableBoardUnchanged,
  durableCanonicalState,
  durableComponentInstanceIds,
  readOnlyDurableWorkflow,
  validateDurableReadBounds,
  type DurableBoardLoad,
} from "../durable-read-bundle";
import { validateReadResourceBundle } from "../resource-envelopes";
import { computeProjectRevision } from "../revision";
import { engineeringDigest } from "../stable";
import { sirkitToolRegistry } from "../tool-catalog";
import { consumedRef, resolveReadBinding } from "../tool-bindings-readonly";
import type { ToolDescriptor } from "../tool-registry";
import {
  DURABLE_WORKFLOW_METHODS,
  FIXTURE_SCOPE,
  deriveDurableGeneration,
  durableAuthoritySource,
  durableBoardFixture,
  publishDurableBoard,
  type FixtureScope,
} from "./_durable-board-fixture";

const registry = sirkitToolRegistry();
const descriptor = (toolId: string): ToolDescriptor => registry.get(toolId)!;
const SERVED_READS = [
  "sirkit.component-authority.inspect", "sirkit.manufacturing.readiness-inspect", "sirkit.pcb.board-inspect", "sirkit.pcb.mechanical-inspect",
  "sirkit.pcb.revision-inspect", "sirkit.pcb.via-inspect", "sirkit.project.canonical-revision-inspect", "sirkit.validation.connectivity-verify", "sirkit.validation.drc-run",
];
const HOSTILE_NUMBERS = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, 0, 1.5, 2 ** 53];

/** A workflow whose ten methods are spies over the in-memory repository. */
type Spy = ReturnType<typeof vi.fn>;
function spiedWorkflow(inner = new InMemoryDurableWorkflowRepository()): { workflow: InMemoryDurableWorkflowRepository; spies: Record<string, Spy> } {
  const spies: Record<string, Spy> = {};
  for (const method of DURABLE_WORKFLOW_METHODS) spies[method] = vi.spyOn(inner, method) as unknown as Spy;
  return { workflow: inner, spies };
}
/** A workflow that delegates to `inner` except for loadHead, which `transform` may rewrite (or replace). */
function wrapped(inner: DurableWorkflowRepository, loadHead: (identity: Parameters<DurableWorkflowRepository["loadHead"]>[0]) => Promise<DurableAggregateRecord | null>): DurableWorkflowRepository {
  return new Proxy(inner, { get(target, key) { if (key === "loadHead") return loadHead; const value = Reflect.get(target, key) as unknown; return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value; } });
}
async function seeded(board: PcbBoard = durableBoardFixture(), scope: FixtureScope = FIXTURE_SCOPE) {
  const workflow = new InMemoryDurableWorkflowRepository();
  const record = await publishDurableBoard(workflow, scope, board);
  return { workflow, record };
}
const found = (load: DurableBoardLoad): Extract<DurableBoardLoad, { status: "found" }> => {
  expect(load.status).toBe("found");
  return load as Extract<DurableBoardLoad, { status: "found" }>;
};

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("[B20 B3] A — the durable read bundle", () => {
  it("1. the fixture is a valid board at both stackups; the constants and the buildable kinds are exact; the bounds validator refuses NaN, ±Infinity, -1, 0, 1.5 and 2^53", () => {
    for (const stackup of [2, 4] as const) expect(validatePcbBoardStructure(durableBoardFixture({ stackup }))).toEqual([]);
    expect([DURABLE_BOARD_READ_DEADLINE_MS, DURABLE_AUTHORITY_DEADLINE_MS, DURABLE_AUTHORITY_MAX_COMPONENTS, DURABLE_AUTHORITY_MAX_RECORDS, DURABLE_AUTHORITY_MAX_CANDIDATES]).toEqual([5_000, 5_000, 512, 512, 512]);
    expect(DURABLE_READ_BOUNDS).toEqual({ DURABLE_BOARD_READ_DEADLINE_MS: 5_000, DURABLE_AUTHORITY_DEADLINE_MS: 5_000, DURABLE_AUTHORITY_MAX_COMPONENTS: 512, DURABLE_AUTHORITY_MAX_RECORDS: 512, DURABLE_AUTHORITY_MAX_CANDIDATES: 512 });
    expect(Object.isFrozen(DURABLE_READ_BOUNDS)).toBe(true);
    expect([...DURABLE_BUILDABLE_RESOURCE_KINDS]).toEqual(["canonical-state", "drc-rules", "drc-preset", "fab-preset", "component-authority-records"]);
    expect(Object.isFrozen(DURABLE_BUILDABLE_RESOURCE_KINDS)).toBe(true);
    expect(DURABLE_READ_ONLY_VIEW_ERROR).toBe("DW_READ_ONLY_VIEW");
    expect(validateDurableReadBounds(DURABLE_READ_BOUNDS)).toEqual([]);
    for (const name of Object.keys(DURABLE_READ_BOUNDS)) {
      for (const value of HOSTILE_NUMBERS) expect(validateDurableReadBounds({ ...DURABLE_READ_BOUNDS, [name]: value }).length, `${name}=${value}`).toBeGreaterThan(0);
    }
    for (const value of [null, undefined, 5, "x", [], { ...DURABLE_READ_BOUNDS, extra: 1 }]) expect(validateDurableReadBounds(value).length).toBeGreaterThan(0);
    // the board id rule: the root and a derived generation, nothing else
    for (const id of ["board:proj-mcp", "board:proj-mcp@r1", "board:p@r999999"]) expect(DURABLE_BOARD_ID_PATTERN.test(id), id).toBe(true);
    for (const id of ["board:", "board:p@r1234567", "board:p@rx", "project:p", "board:p q", " board:p", `board:${"p".repeat(129)}`]) expect(DURABLE_BOARD_ID_PATTERN.test(id), id).toBe(false);
  });

  it("2. no board is not_found; a board only in another tenant, project or branch is not_found, and every loadHead stays in the request's scope", async () => {
    const empty = spiedWorkflow();
    expect(await createDurableBoardReader(empty.workflow).load(FIXTURE_SCOPE)).toEqual({ status: "not_found" });
    for (const other of [{ ...FIXTURE_SCOPE, tenantId: "tenant-other" }, { ...FIXTURE_SCOPE, projectId: "proj-other" }, { ...FIXTURE_SCOPE, branchId: "branch-other" }]) {
      const inner = new InMemoryDurableWorkflowRepository();
      await publishDurableBoard(inner, other, durableBoardFixture());
      const { workflow, spies } = spiedWorkflow(inner);
      expect(await createDurableBoardReader(workflow).load(FIXTURE_SCOPE), JSON.stringify(other)).toEqual({ status: "not_found" });
      expect(spies.loadHead).toHaveBeenCalled();
      for (const [identity] of spies.loadHead!.mock.calls as Array<[{ scope: FixtureScope }]>) expect(identity.scope).toEqual(FIXTURE_SCOPE);
    }
  });

  it("3. the root board is found with revision = pcbRevisionId and digest = boardDigest; its aggregate revision is 1, and 2 after a second publish", async () => {
    const board = durableBoardFixture();
    const { workflow } = await seeded(board);
    const reader = createDurableBoardReader(workflow);
    const first = found(await reader.load(FIXTURE_SCOPE));
    expect(first.head).toEqual({ boardId: pcbBoardInstanceId(FIXTURE_SCOPE.projectId), revision: pcbRevisionId(board), digest: boardDigest(board), aggregateRevision: 1 });
    expect(first.board).toEqual(board);
    const next = durableBoardFixture({ variant: 3 });
    await publishDurableBoard(workflow, FIXTURE_SCOPE, next, { expectedRevision: 1 });
    const second = found(await reader.load(FIXTURE_SCOPE));
    expect(second.head).toEqual({ boardId: "board:proj-mcp", revision: pcbRevisionId(next), digest: boardDigest(next), aggregateRevision: 2 });
  });

  it("4. a derived generation loads board:<p>@r1; a chain deeper than 64 is unavailable; a lineage naming a malformed board id is invalid", async () => {
    const { workflow, record } = await seeded();
    const next = durableBoardFixture({ variant: 1 });
    await deriveDurableGeneration(workflow, record, next);
    const loaded = found(await createDurableBoardReader(workflow).load(FIXTURE_SCOPE));
    expect(loaded.head.boardId).toBe("board:proj-mcp@r1");
    expect(loaded.head.revision).toBe(pcbRevisionId(next));
    // 65 derivations: the root and r1..r64 are superseded, so resolving from the root passes the 64-level bound
    const deep = await seeded();
    let parent = deep.record;
    for (let generation = 1; generation <= 65; generation += 1) parent = await deriveDurableGeneration(deep.workflow, parent, durableBoardFixture({ variant: generation % 3 }));
    expect(await createDurableBoardReader(deep.workflow).load(FIXTURE_SCOPE)).toEqual({ status: "unavailable" });
    const malformed = await seeded();
    await deriveDurableGeneration(malformed.workflow, malformed.record, durableBoardFixture({ variant: 1 }), { derivedBoardId: "board:proj-mcp@r1 evil" });
    expect(await createDurableBoardReader(malformed.workflow).load(FIXTURE_SCOPE)).toEqual({ status: "invalid" });
  });

  it("5. tampering is corrupt; a throwing, rejecting or never-settling loadHead is unavailable (5 000 ms); a late rejection after the deadline is handled", async () => {
    const { workflow, record } = await seeded();
    await deriveDurableGeneration(workflow, record, durableBoardFixture({ variant: 1 }));
    const tamper = (mutate: (head: DurableAggregateRecord<Record<string, unknown>>) => void): DurableWorkflowRepository => wrapped(workflow, async (identity) => {
      const head = await workflow.loadHead<Record<string, unknown>>(identity);
      if (head) mutate(head);
      return head;
    });
    const payloadTamper = tamper((head) => { if (head.aggregateType === "pcb-sync.board.v1") ((head.payload.board as PcbBoard).tracks[0]!).width = 999; });
    const digestTamper = tamper((head) => { if (head.aggregateType === "pcb-sync.board.v1") head.recordDigest = "dw1-tampered"; });
    const lineageTamper = tamper((head) => { if (head.aggregateType === BOARD_LINEAGE_AGGREGATE) head.payload.generation = 7; });
    for (const hostile of [payloadTamper, digestTamper, lineageTamper]) expect(await createDurableBoardReader(hostile).load(FIXTURE_SCOPE)).toEqual({ status: "corrupt" });
    const throwing = wrapped(workflow, () => { throw new Error("sync throw"); });
    const rejecting = wrapped(workflow, async () => { throw new Error("async rejection"); });
    for (const hostile of [throwing, rejecting]) expect(await createDurableBoardReader(hostile).load(FIXTURE_SCOPE)).toEqual({ status: "unavailable" });
    vi.useFakeTimers();
    const never = wrapped(workflow, () => new Promise(() => undefined));
    const pending = createDurableBoardReader(never).load(FIXTURE_SCOPE);
    let settled: DurableBoardLoad | null = null;
    void pending.then((value) => { settled = value; });
    await vi.advanceTimersByTimeAsync(4_999);
    expect(settled).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toEqual({ status: "unavailable" });
    // a late rejection: no unhandled rejection, and the answer stays the deadline's (a promise settles once by construction:
    // [B20 B3 review] the deadline itself, the load argument and the abort listener are case 14's)
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const late = wrapped(workflow, () => new Promise((_, reject) => setTimeout(() => reject(new Error("late")), 6_000)));
      const settlements: DurableBoardLoad[] = [];
      const loading = createDurableBoardReader(late).load(FIXTURE_SCOPE);
      void loading.then((value) => settlements.push(value));
      await vi.advanceTimersByTimeAsync(5_000);
      await vi.advanceTimersByTimeAsync(2_000);
      await Promise.resolve();
      expect(settlements).toEqual([{ status: "unavailable" }]);
    } finally {
      vi.useRealTimers();
      await new Promise((resolve) => setImmediate(resolve));
      process.off("unhandledRejection", unhandled);
    }
    expect(unhandled).not.toHaveBeenCalled();
    // an aborted signal is unavailable with no read at all
    const { workflow: spied, spies } = spiedWorkflow(workflow);
    const controller = new AbortController();
    controller.abort();
    expect(await createDurableBoardReader(spied).load(FIXTURE_SCOPE, controller.signal)).toEqual({ status: "unavailable" });
    expect(spies.loadHead).not.toHaveBeenCalled();
  });

  it("6. a structurally invalid board, a non-board payload and a validator throw are invalid; the local shape rule agrees with native over 20 hostile boards", async () => {
    const duplicate = durableBoardFixture();
    duplicate.tracks.push({ ...duplicate.tracks[0]! });
    const nonBoard = { ...durableBoardFixture(), stackup: 3 } as unknown as PcbBoard;
    const validatorThrows = durableBoardFixture() as Partial<PcbBoard>;
    delete validatorThrows.outline;
    for (const board of [duplicate, nonBoard, validatorThrows as PcbBoard]) {
      const { workflow } = await seeded(board);
      expect(await createDurableBoardReader(workflow).load(FIXTURE_SCOPE)).toEqual({ status: "invalid" });
    }
    const valid = durableBoardFixture();
    const hostile: unknown[] = [
      valid, durableBoardFixture({ stackup: 4 }), duplicate, nonBoard, validatorThrows, 5, "board", [], {}, true,
      { ...valid, stackup: "2" }, { ...valid, nets: {} }, { ...valid, footprints: null }, { ...valid, tracks: "t" }, { ...valid, vias: undefined }, { ...valid, zones: 1 },
      { ...valid, texts: undefined }, { ...valid, vias: [{ ...valid.vias[0]!, drill: 700_000 }] }, { ...valid, stackup: 4, tracks: [{ ...valid.tracks[0]!, width: 0 }] }, Object.create(null),
    ];
    expect(hostile).toHaveLength(20);
    for (const [index, board] of hostile.entries()) {
      const native = assembleAgentRunContext({ ...FIXTURE_SCOPE, board });
      expect(native.ok).toBe(true);
      const nativeAccepts = native.ok && native.context.canonicalState !== null;
      expect(durableBoardAccepted(board), `board ${index}`).toBe(nativeAccepts);
    }
    expect(durableBoardAccepted(valid)).toBe(true);
  });

  it("7. the durable canonical state has exactly the six keys and no schematic; its revision equals the agent's for the same board with no schematic", () => {
    for (const stackup of [2, 4] as const) {
      const board = durableBoardFixture({ stackup });
      const state = durableCanonicalState(FIXTURE_SCOPE, board);
      expect(Object.keys(state).sort()).toEqual(["branchId", "pcb", "pinnedAssets", "projectId", "schemaVersion", "tenantId"]);
      expect(state).toEqual({ schemaVersion: "sirkit.engineering.v1", ...FIXTURE_SCOPE, pcb: board, pinnedAssets: [] });
      const native = assembleAgentRunContext({ ...FIXTURE_SCOPE, board });
      if (!native.ok) throw new Error("fixture");
      expect(Object.hasOwn(native.context.canonicalState!, "schematic")).toBe(false);
      expect(computeProjectRevision(state).canonicalStateDigest).toBe(native.context.canonicalRevisionDigest);
    }
  });

  it("8. per binding only the declared kinds are built; readiness carries no netlist; the bundle validates; canonical is durable-server-board, verified and pinned; presets are catalog", async () => {
    const board = durableBoardFixture();
    const { workflow } = await seeded(board);
    const loaded = found(await createDurableBoardReader(workflow).load(FIXTURE_SCOPE));
    const source = await durableAuthoritySource(["sync-u1", "sync-u2"]);
    for (const toolId of SERVED_READS) {
      const binding = resolveReadBinding(descriptor(toolId));
      if (binding.state !== "resolved") throw new Error(toolId);
      const assembled = await assembleDurableReadBundle({ scope: FIXTURE_SCOPE, loaded, descriptor: descriptor(toolId), componentAuthority: () => source });
      expect(assembled.status, toolId).toBe("assembled");
      if (assembled.status !== "assembled") continue;
      const declared = [...binding.binding.requiredResources, ...(binding.binding.optionalResources ?? [])].filter((kind) => (DURABLE_BUILDABLE_RESOURCE_KINDS as readonly string[]).includes(kind));
      expect(assembled.bundle.manifest.map((entry) => entry.kind).sort(), toolId).toEqual([...declared].sort());
      expect(validateReadResourceBundle(assembled.bundle, FIXTURE_SCOPE), toolId).toEqual([]);
      const revision = computeProjectRevision(durableCanonicalState(FIXTURE_SCOPE, board)).canonicalStateDigest;
      expect(assembled.revision).toBe(revision);
      expect(assembled.bundle.canonicalState).toMatchObject({ resourceId: "canonical:proj-mcp", kind: "canonical-state", authoritySource: "durable-server-board", authorityStatus: "verified", sourceVersion: revision, sourceCanonicalRevision: revision, producer: "durable-read-bundle-assembler", producerVersion: "1.0.0", freshness: "current" });
      for (const envelope of assembled.bundle.auxiliary.filter((item) => item.kind !== "component-authority-records")) {
        expect(envelope, `${toolId} ${envelope.kind}`).toMatchObject({ authoritySource: "catalog", authorityStatus: "verified", sourceVersion: "jlcpcb-2l", sourceCanonicalRevision: revision, producer: envelope.kind === "fab-preset" ? "pcb/fab/presets" : "pcb/drc/presets", freshness: "current" });
      }
    }
    const readiness = await assembleDurableReadBundle({ scope: FIXTURE_SCOPE, loaded, descriptor: descriptor("sirkit.manufacturing.readiness-inspect"), componentAuthority: () => source });
    if (readiness.status !== "assembled") throw new Error("readiness");
    expect(readiness.bundle.manifest.some((entry) => entry.kind === "netlist")).toBe(false);
    // a binding that requires a kind the durable state cannot build is not servable: the withheld reads
    for (const toolId of ["sirkit.project.history-inspect", "sirkit.selection.inspect", "sirkit.view.read-state"]) {
      expect((await assembleDurableReadBundle({ scope: FIXTURE_SCOPE, loaded, descriptor: descriptor(toolId), componentAuthority: () => source })).status, toolId).toBe("not_servable");
    }
    // a non-read descriptor has no read binding
    expect((await assembleDurableReadBundle({ scope: FIXTURE_SCOPE, loaded, descriptor: descriptor("sirkit.placement.propose"), componentAuthority: () => source })).status).toBe("not_servable");
  });

  it("9. at stackups 2 and 4 each preset's consumedRef equals the one buildAgentResourceBundle seals for the same board", async () => {
    for (const [stackup, presetId] of [[2, "jlcpcb-2l"], [4, "jlcpcb-4l"]] as const) {
      const board = durableBoardFixture({ stackup });
      const { workflow } = await seeded(board);
      const loaded = found(await createDurableBoardReader(workflow).load(FIXTURE_SCOPE));
      const assembled = await assembleDurableReadBundle({ scope: FIXTURE_SCOPE, loaded, descriptor: descriptor("sirkit.manufacturing.readiness-inspect"), componentAuthority: () => null });
      const drc = await assembleDurableReadBundle({ scope: FIXTURE_SCOPE, loaded, descriptor: descriptor("sirkit.validation.drc-run"), componentAuthority: () => null });
      if (assembled.status !== "assembled" || drc.status !== "assembled") throw new Error("fixture");
      const native = assembleAgentRunContext({ ...FIXTURE_SCOPE, board });
      if (!native.ok) throw new Error("fixture");
      expect(native.context.presetId).toBe(presetId);
      const nativeBundle = buildAgentResourceBundle(native.context);
      const refOf = (bundle: typeof nativeBundle, kind: string) => consumedRef([bundle.canonicalState, ...bundle.auxiliary].find((envelope) => envelope.kind === kind)!);
      for (const kind of ["fab-preset", "drc-preset"]) expect(refOf(assembled.bundle, kind), `${stackup} ${kind}`).toEqual(refOf(nativeBundle, kind));
      expect(refOf(drc.bundle, "drc-rules")).toEqual(refOf(nativeBundle, "drc-rules"));
      expect(refOf(assembled.bundle, "canonical-state")).toEqual(refOf(nativeBundle, "canonical-state"));
      expect(refOf(assembled.bundle, "fab-preset").sourceVersion).toBe(presetId);
    }
  });

  it("10. component authority: the unique sync ids, bounded before any sort; the native guard; the duplicated bounds; absence on a null source, a rejection, an abort or the deadline; the native envelope formula", async () => {
    const board = durableBoardFixture({ synced: ["sync-u1", "sync-u2", "sync-u1"], unsynced: 2 });
    expect(durableComponentInstanceIds(board)).toEqual(["sync-u1", "sync-u2"]);
    expect(durableComponentInstanceIds(durableBoardFixture({ synced: [], unsynced: 3 }))).toEqual([]);
    // 513 footprints are refused before any sort
    const crowded = durableBoardFixture({ synced: Array.from({ length: 513 }, (_, index) => `sync-${index}`), unsynced: 0 });
    const sort = vi.spyOn(Array.prototype, "sort");
    const refusedIds = durableComponentInstanceIds(crowded);
    const sorts = sort.mock.calls.length;
    sort.mockRestore();
    expect(refusedIds).toBeNull();
    expect(sorts).toBe(0);
    // the footprint count is judged too, not only the collected ids: 513 footprints with one synchronized are over the bound
    expect(durableComponentInstanceIds(durableBoardFixture({ synced: ["sync-0"], unsynced: 512 }))).toBeNull();
    expect(durableComponentInstanceIds(durableBoardFixture({ synced: Array.from({ length: 512 }, (_, index) => `sync-${index}`), unsynced: 0 }))).toHaveLength(512);
    // the native guard
    const record = { componentId: "sync-u1" };
    expect(durableAuthorityGuard({ records: [record] })).toEqual({ records: [record], candidates: [] });
    for (const value of [null, { records: "x" }, { records: Array.from({ length: 513 }, () => record) }, { records: [record], candidates: Array.from({ length: 513 }, () => ({})) }, { records: [{}] }, { records: [null] }, { records: [record], candidates: "x" }]) {
      expect(durableAuthorityGuard(value), JSON.stringify(value).slice(0, 60)).toBeNull();
    }
    expect([DURABLE_AUTHORITY_MAX_RECORDS, DURABLE_AUTHORITY_MAX_CANDIDATES, DURABLE_AUTHORITY_MAX_COMPONENTS]).toEqual([MAX_AUTHORITY_RECORDS, MAX_AUTHORITY_CANDIDATES, MAX_AUTHORITY_COMPONENTS]);
    // the envelope: the native formula (context.ts buildAgentResourceBundle) over the loaded records
    const { workflow } = await seeded(durableBoardFixture());
    const loaded = found(await createDurableBoardReader(workflow).load(FIXTURE_SCOPE));
    const source = await durableAuthoritySource(["sync-u1", "sync-u2"]);
    const inspect = descriptor("sirkit.component-authority.inspect");
    const assembled = await assembleDurableReadBundle({ scope: FIXTURE_SCOPE, loaded, descriptor: inspect, componentAuthority: () => source });
    if (assembled.status !== "assembled") throw new Error("fixture");
    expect(source.requested.sort()).toEqual(["sync-u1", "sync-u2"]);
    const envelope = assembled.bundle.auxiliary.find((item) => item.kind === "component-authority-records")!;
    const content = envelope.content as { records: Array<{ componentId: string }>; candidates: unknown[] };
    expect(content.records.map((item) => item.componentId)).toEqual(["sync-u1", "sync-u2"]);
    expect(envelope).toMatchObject({ resourceId: "component-authority:proj-mcp", authoritySource: "durable-server-board", authorityStatus: "verified", sourceVersion: engineeringDigest({ schema: "sirkit.component-authority-records.v1", records: content.records, candidates: content.candidates }), sourceCanonicalRevision: assembled.revision, producer: "component-authority-source", producerVersion: "1.0.0", freshness: "current" });
    const native = assembleAgentRunContext({ ...FIXTURE_SCOPE, board: loaded.board, componentAuthority: { records: content.records as never, candidates: [] } });
    if (!native.ok) throw new Error("fixture");
    const nativeEnvelope = buildAgentResourceBundle(native.context).auxiliary.find((item) => item.kind === "component-authority-records")!;
    expect(consumedRef(envelope)).toEqual(consumedRef(nativeEnvelope));
    // absent: a null source, a throwing resolver, a rejection, an abort, the deadline
    const absent = async (input: Parameters<typeof assembleDurableReadBundle>[0]): Promise<boolean> => {
      const result = await assembleDurableReadBundle(input);
      return result.status === "assembled" && !result.bundle.auxiliary.some((item) => item.kind === "component-authority-records");
    };
    expect(await absent({ scope: FIXTURE_SCOPE, loaded, descriptor: inspect, componentAuthority: () => null })).toBe(true);
    expect(await absent({ scope: FIXTURE_SCOPE, loaded, descriptor: inspect, componentAuthority: () => { throw new Error("resolver"); } })).toBe(true);
    const rejecting = { ...source, bindings: { loadForComponent: async () => { throw new Error("db down"); } } };
    expect(await absent({ scope: FIXTURE_SCOPE, loaded, descriptor: inspect, componentAuthority: () => rejecting })).toBe(true);
    const aborted = new AbortController();
    aborted.abort();
    expect(await absent({ scope: FIXTURE_SCOPE, loaded, descriptor: inspect, componentAuthority: () => source, signal: aborted.signal })).toBe(true);
    vi.useFakeTimers();
    const slow = { ...source, bindings: { loadForComponent: () => new Promise<never>(() => undefined) } };
    const pending = absent({ scope: FIXTURE_SCOPE, loaded, descriptor: inspect, componentAuthority: () => slow, deadlineMs: 200 });
    await vi.advanceTimersByTimeAsync(200);
    expect(await pending).toBe(true);
    vi.useRealTimers();
    // a board over the component bound withholds the resource without calling the source
    const overBound = await seeded(crowded);
    const overLoaded = found(await createDurableBoardReader(overBound.workflow).load(FIXTURE_SCOPE));
    const untouched = await durableAuthoritySource([]);
    expect(await absent({ scope: FIXTURE_SCOPE, loaded: overLoaded, descriptor: inspect, componentAuthority: () => untouched })).toBe(true);
    expect(untouched.requested).toEqual([]);
  });

  it("11. the post-check: unchanged; unchanged after a content-identical republish (aggregate revision 2); changed after a content change or a supersession; unavailable when the reader fails", async () => {
    const board = durableBoardFixture();
    const { workflow, record } = await seeded(board);
    const reader = createDurableBoardReader(workflow);
    const first = found(await reader.load(FIXTURE_SCOPE));
    expect(await durableBoardUnchanged(reader, FIXTURE_SCOPE, first.head)).toBe("unchanged");
    await publishDurableBoard(workflow, FIXTURE_SCOPE, structuredClone(board), { expectedRevision: 1, key: "republish-identical", updatedAt: "2026-09-21T12:05:00.000Z" });
    const republished = found(await reader.load(FIXTURE_SCOPE));
    expect(republished.head.aggregateRevision).toBe(2);
    expect(await durableBoardUnchanged(reader, FIXTURE_SCOPE, first.head)).toBe("unchanged");
    await publishDurableBoard(workflow, FIXTURE_SCOPE, durableBoardFixture({ variant: 2 }), { expectedRevision: 2 });
    expect(await durableBoardUnchanged(reader, FIXTURE_SCOPE, first.head)).toBe("changed");
    const lineage = await seeded(board);
    const lineageReader = createDurableBoardReader(lineage.workflow);
    const before = found(await lineageReader.load(FIXTURE_SCOPE));
    await deriveDurableGeneration(lineage.workflow, lineage.record, structuredClone(board));
    expect(await durableBoardUnchanged(lineageReader, FIXTURE_SCOPE, before.head)).toBe("changed"); // same content, another board id
    const failing = createDurableBoardReader(wrapped(workflow, async () => { throw new Error("down"); }));
    expect(await durableBoardUnchanged(failing, FIXTURE_SCOPE, first.head)).toBe("unavailable");
    void record;
  });

  it("12. the reader calls only loadHead; the read-only view rejects every write and the outbox listing with DW_READ_ONLY_VIEW and never delegates", async () => {
    const inner = new InMemoryDurableWorkflowRepository();
    const record = await publishDurableBoard(inner, FIXTURE_SCOPE, durableBoardFixture());
    await deriveDurableGeneration(inner, record, durableBoardFixture({ variant: 1 }));
    const { workflow, spies } = spiedWorkflow(inner);
    const view = readOnlyDurableWorkflow(workflow);
    const reader = createDurableBoardReader(view);
    const loaded = found(await reader.load(FIXTURE_SCOPE));
    await durableBoardUnchanged(reader, FIXTURE_SCOPE, loaded.head);
    await reader.load({ ...FIXTURE_SCOPE, projectId: "proj-other" });
    await assembleDurableReadBundle({ scope: FIXTURE_SCOPE, loaded, descriptor: descriptor("sirkit.manufacturing.readiness-inspect"), componentAuthority: () => null });
    for (const method of DURABLE_WORKFLOW_METHODS) {
      if (method === "loadHead") expect(spies.loadHead!.mock.calls.length).toBeGreaterThan(0);
      else expect(spies[method], method).not.toHaveBeenCalled();
    }
    for (const method of ["commit", "claimOutbox", "completeOutbox", "failOutbox", "listOutbox"] as const) {
      await expect((view[method] as (input: unknown) => Promise<unknown>)({}), method).rejects.toThrow("DW_READ_ONLY_VIEW");
      expect(spies[method], method).not.toHaveBeenCalled();
    }
    // the delegated reads answer exactly what the repository answers
    const identity = spies.loadHead!.mock.calls[0]![0] as Parameters<DurableWorkflowRepository["loadHead"]>[0];
    expect(await view.loadHead(identity)).toEqual(await inner.loadHead(identity));
    expect(await view.history(identity)).toEqual(await inner.history(identity));
    expect(await view.listHeads({ aggregateType: "pcb-sync.board.v1", scope: FIXTURE_SCOPE })).toEqual(await inner.listHeads({ aggregateType: "pcb-sync.board.v1", scope: FIXTURE_SCOPE }));
  });

  it("13. S4: 30 hostile inputs never throw and answer a closed outcome", async () => {
    const { workflow } = await seeded();
    const reader = createDurableBoardReader(workflow);
    const throwingGetter = new Proxy({}, { get() { throw new Error("getter"); } });
    const scopes: unknown[] = [null, undefined, 5, "scope", [], {}, { ...FIXTURE_SCOPE, tenantId: "" }, { ...FIXTURE_SCOPE, projectId: "p q" }, { ...FIXTURE_SCOPE, branchId: "b".repeat(129) }, { ...FIXTURE_SCOPE, tenantId: `t${String.fromCharCode(0)}` }, throwingGetter, { ...FIXTURE_SCOPE, projectId: 7 }];
    for (const [index, scope] of scopes.entries()) {
      const load = await reader.load(scope as FixtureScope);
      expect(["not_found", "unavailable", "invalid", "corrupt"], `scope ${index}`).toContain(load.status);
    }
    const payloads: unknown[] = [null, [], 5, "board", { board: null }, { board: [] }, { board: 5 }, throwingGetter];
    for (const payload of payloads) {
      const hostile = wrapped(workflow, async (identity) => {
        const head = await workflow.loadHead(identity);
        return head && head.aggregateType === "pcb-sync.board.v1" ? { ...head, payload: payload as object } : head;
      });
      const load = await createDurableBoardReader(hostile).load(FIXTURE_SCOPE);
      expect(["unavailable", "invalid", "corrupt"]).toContain(load.status);
    }
    const hostileHeads: unknown[] = [5, "head", [], throwingGetter];
    for (const head of hostileHeads) {
      const load = await createDurableBoardReader(wrapped(workflow, async () => head as DurableAggregateRecord)).load(FIXTURE_SCOPE);
      expect(["unavailable", "invalid", "corrupt"]).toContain(load.status);
    }
    const huge = { ...found(await reader.load(FIXTURE_SCOPE)).head, boardId: "board:proj-mcp@r99999999" };
    for (const input of [null, 5, huge, throwingGetter]) {
      await expect(durableBoardUnchanged(reader, FIXTURE_SCOPE, input as never)).resolves.toMatch(/^(unchanged|changed|unavailable)$/);
    }
    for (const input of [null, undefined, { scope: throwingGetter }, { scope: FIXTURE_SCOPE, loaded: null, descriptor: null }]) {
      await expect(assembleDurableReadBundle(input as never)).resolves.toEqual({ status: "not_servable" });
    }
    expect(durableComponentInstanceIds(throwingGetter as never)).toBeNull();
    expect(durableAuthorityGuard(throwingGetter)).toBeNull();
    expect(durableBoardAccepted(throwingGetter)).toBe(false);
    expect(() => durableCanonicalState(FIXTURE_SCOPE, durableBoardFixture())).not.toThrow();
  });

  it("14. the reader's deadline and signal: its load argument (200 ms) and its own option (300 ms) each answer unavailable at exactly that time; an abort while loadHead is pending answers at once; the durable work it reports ends when the repository read settles, never at the race", async () => {
    const { workflow } = await seeded();
    // a repository whose reads wait until released (a slow database: a durable query is not cancellable)
    let hold = true;
    const waiting: Array<() => void> = [];
    const slow = wrapped(workflow, async (identity) => {
      if (hold) await new Promise<void>((release) => waiting.push(release));
      return workflow.loadHead(identity);
    });
    const releaseReads = async (): Promise<void> => {
      hold = false;
      for (const release of waiting.splice(0)) release();
      for (let index = 0; index < 100; index += 1) await Promise.resolve();
      hold = true;
    };
    // [B20 B3 review] a work tracker as the MCP pipeline passes it: one start per load that reads the repository, one end when
    // those reads have settled (the pipeline holds its admission slot in between)
    let started = 0;
    let ended = 0;
    const track = (): (() => void) => {
      started += 1;
      let open = true;
      return () => { if (open) { open = false; ended += 1; } };
    };
    vi.useFakeTimers();
    try {
      let settled: DurableBoardLoad | null = null;
      void createDurableBoardReader(slow).load(FIXTURE_SCOPE, undefined, 200, track).then((value) => { settled = value; });
      await vi.advanceTimersByTimeAsync(199);
      expect(settled, "the load argument: nothing at 199 ms").toBeNull();
      await vi.advanceTimersByTimeAsync(1);
      expect(settled, "the load argument: unavailable at 200 ms").toEqual({ status: "unavailable" });
      expect([started, ended], "the read still runs after the answer").toEqual([1, 0]);
      await releaseReads();
      expect([started, ended], "its end is reported once it settles").toEqual([1, 1]);
      settled = null;
      void createDurableBoardReader(slow, { deadlineMs: 300 }).load(FIXTURE_SCOPE, undefined, 4_000, track).then((value) => { settled = value; });
      await vi.advanceTimersByTimeAsync(299);
      expect(settled, "the reader's option: nothing at 299 ms").toBeNull();
      await vi.advanceTimersByTimeAsync(1);
      expect(settled, "the reader's option: unavailable at 300 ms (a longer load argument cannot widen it)").toEqual({ status: "unavailable" });
      await releaseReads();
      expect([started, ended]).toEqual([2, 2]);
      const controller = new AbortController();
      settled = null;
      void createDurableBoardReader(slow).load(FIXTURE_SCOPE, controller.signal, undefined, track).then((value) => { settled = value; });
      for (let index = 0; index < 10; index += 1) await Promise.resolve();
      expect(settled).toBeNull();
      controller.abort();
      for (let index = 0; index < 10; index += 1) await Promise.resolve();
      expect(settled, "an abort answers at once, with no timer advanced").toEqual({ status: "unavailable" });
      expect([started, ended]).toEqual([3, 2]);
      await releaseReads();
      expect([started, ended]).toEqual([3, 3]);
    } finally {
      vi.useRealTimers();
    }
    // a found load reports its end before it answers; a load that reads nothing (a pre-aborted signal, a malformed scope) reports nothing
    const reader = createDurableBoardReader(workflow);
    let endedAtAnswer = -1;
    const answer = await reader.load(FIXTURE_SCOPE, undefined, undefined, track).then((value) => { endedAtAnswer = ended; return value; });
    expect(answer.status).toBe("found");
    expect([started, endedAtAnswer]).toEqual([4, 4]);
    const aborted = new AbortController();
    aborted.abort();
    await reader.load(FIXTURE_SCOPE, aborted.signal, undefined, track);
    await reader.load({ ...FIXTURE_SCOPE, projectId: "p q" }, undefined, undefined, track);
    expect([started, ended]).toEqual([4, 4]);
    // a tracker that throws is ignored; the post-check passes the tracker through
    expect((await reader.load(FIXTURE_SCOPE, undefined, undefined, () => { throw new Error("tracker"); })).status).toBe("found");
    const head = found(await reader.load(FIXTURE_SCOPE)).head;
    expect(await durableBoardUnchanged(reader, FIXTURE_SCOPE, head, undefined, undefined, track)).toBe("unchanged");
    expect([started, ended]).toEqual([5, 5]);
  });
});
