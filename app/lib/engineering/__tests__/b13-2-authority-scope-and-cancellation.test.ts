/**
 * B13.2 §A/§B/§C/§D — full durable component scope, exact-authority internal
 * consistency, immediate external-abort settlement, and REAL production
 * query cancellation.
 *
 * Every aggregate here is a genuinely valid durable aggregate built through
 * the REAL `PhysicalBindingService` (create → select → revalidate → approve),
 * so a refusal can only come from the scope/consistency rules under test —
 * never from a malformed fixture.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  loadComponentAuthorityRecords,
  loadRunComponentAuthority,
  MAX_AGGREGATES_PER_COMPONENT,
  type AuthorityBindingAggregate,
  type AuthorityBindingSource,
  type AuthorityComponentScope,
  type ComponentAuthoritySourceDeps,
} from "../component-authority-source";
import { inspectComponentAuthority, type ComponentAuthorityRecord } from "../component-authority";
import { consumeReplacementAuthority } from "../schematic-authority.internal";
import { buildReadResourceBundle, sealResourceEnvelope } from "../resource-envelopes";
import { computeProjectRevision } from "../revision";
import { createEmptyBoard } from "../../pcb/types";
import { PCB_BOARD_ASSEMBLY_VARIANT_ID, PCB_BOARD_HIERARCHY_PATH } from "../../pcb/board-identity";
import {
  runCancellableAuthorityRead,
  loadBindingAggregatesCancellable,
  confirmPublishedAtomicRevisionCancellable,
  AUTHORITY_READ_ABORTED,
  AUTHORITY_READ_UNAVAILABLE,
  type CancellableAuthorityQuery,
  type CancellableAuthoritySqlClient,
} from "../../../api/chat/authority-cancellable-reads";
import {
  FIXTURE_AUTHORITY_HIERARCHY,
  FIXTURE_AUTHORITY_SCOPE,
  FIXTURE_AUTHORITY_VARIANT,
  FIXTURE_EXACT,
  matchingAtomicConfirmer,
  validApprovedAggregate,
} from "./_authority-fixtures";

const COMPONENT = "component-uuid-1";
const SCOPE = FIXTURE_AUTHORITY_SCOPE;
const LOAD = {
  scope: SCOPE,
  canonicalRevision: "eng1-b132",
  componentInstanceIds: [COMPONENT],
  hierarchyPath: FIXTURE_AUTHORITY_HIERARCHY,
  assemblyVariantId: FIXTURE_AUTHORITY_VARIANT,
};

function source(aggregates: readonly AuthorityBindingAggregate[]): AuthorityBindingSource & { scopes: AuthorityComponentScope[] } {
  const scopes: AuthorityComponentScope[] = [];
  return {
    scopes,
    async loadForComponent(scope) { scopes.push(scope); return aggregates; },
  };
}
const deps = (bindings: AuthorityBindingSource, atomic = matchingAtomicConfirmer()): ComponentAuthoritySourceDeps => ({ bindings, atomic });

const OUT_OF_SCOPE = "durable source returned an aggregate outside the requested authority scope";

// ─── A. full durable component scope (1–7) ───────────────────────────────────

describe("B13.2 §A — complete requested authority scope", () => {
  it("1. a DIFFERENT component's valid aggregate is never relabeled, projected, or conflicted", async () => {
    const foreign = await validApprovedAggregate("component-uuid-2");
    const load = await loadComponentAuthorityRecords(deps(source([foreign])), LOAD);
    expect(load.status).toBe("unavailable");
    if (load.status !== "unavailable") return;
    expect(load.reason).toBe(OUT_OF_SCOPE);
    // The refusal must not leak the foreign scope's durable identifiers.
    expect(load.reason).not.toContain("component-uuid-2");
    expect(load.reason).not.toContain(foreign.set.setId);
  });

  it("2. a DIFFERENT hierarchy fails closed even with the correct component/board", async () => {
    const agg = await validApprovedAggregate(COMPONENT, { scopeOverrides: { hierarchyPath: ["root", "power"] } });
    expect(agg.set.scope.hierarchyPath).toEqual(["root", "power"]);
    const load = await loadComponentAuthorityRecords(deps(source([agg])), LOAD);
    expect(load.status === "unavailable" && load.reason === OUT_OF_SCOPE).toBe(true);
  });

  it("3. a DIFFERENT variant (neither matching nor universal) fails closed", async () => {
    const agg = await validApprovedAggregate(COMPONENT, { variants: ["variant-alt"] });
    expect(agg.set.scope.assemblyVariantIds).toEqual(["variant-alt"]);
    const load = await loadComponentAuthorityRecords(deps(source([agg])), LOAD);
    expect(load.status === "unavailable" && load.reason === OUT_OF_SCOPE).toBe(true);
  });

  it("4. an EMPTY variant list is universally applicable (the repository's authoritative semantic)", async () => {
    const agg = await validApprovedAggregate(COMPONENT, { variants: [] });
    expect(agg.set.scope.assemblyVariantIds).toEqual([]);
    const load = await loadComponentAuthorityRecords(deps(source([agg])), LOAD);
    expect(load.status).toBe("loaded");
    if (load.status !== "loaded") return;
    expect(load.records[0]!.componentId).toBe(COMPONENT);
    expect(load.records[0]!.exactAuthority?.mpn).toBe(FIXTURE_EXACT.exactMpn);
    // A variant list that CONTAINS the requested variant also applies.
    const multi = await validApprovedAggregate(COMPONENT, { variants: ["variant-alt", FIXTURE_AUTHORITY_VARIANT] });
    const multiLoad = await loadComponentAuthorityRecords(deps(source([multi])), LOAD);
    expect(multiLoad.status === "loaded" && multiLoad.records.length === 1).toBe(true);
  });

  it("5. a different board or branch fails closed (complete scope, not just component)", async () => {
    const agg = await validApprovedAggregate(COMPONENT);
    for (const foreign of [{ boardInstanceId: "board-other" }, { branchId: "release" }, { projectId: "project-other" }, { tenantId: "tenant-other" }] as const) {
      const load = await loadComponentAuthorityRecords(deps(source([agg])), { ...LOAD, scope: { ...SCOPE, ...foreign } });
      expect(load.status === "unavailable" && load.reason === OUT_OF_SCOPE, JSON.stringify(foreign)).toBe(true);
    }
  });

  it("6. mixed-scope bindings inside ONE set fail closed; a wrong-owner selected binding fails closed", async () => {
    const own = await validApprovedAggregate(COMPONENT);
    const other = await validApprovedAggregate("component-uuid-2");
    // A set whose bindings do not all share its complete owner scope.
    const mixed: AuthorityBindingAggregate = { set: own.set, bindings: [...own.bindings, ...other.bindings] };
    const mixedLoad = await loadComponentAuthorityRecords(deps(source([mixed])), LOAD);
    expect(mixedLoad.status).toBe("unavailable");
    if (mixedLoad.status === "unavailable") expect(mixedLoad.reason).toBe("durable aggregate carries a binding outside its owner scope");

    // The SELECTED binding itself carrying a foreign owner scope.
    const selectedId = own.set.effectiveSelectedRevisionId!;
    const wrongOwner: AuthorityBindingAggregate = {
      set: own.set,
      bindings: own.bindings.map((binding) => binding.revisionId === selectedId
        ? { ...binding, scope: { ...binding.scope, hierarchyPath: ["root", "elsewhere"] } }
        : binding),
    };
    const wrongLoad = await loadComponentAuthorityRecords(deps(source([wrongOwner])), LOAD);
    expect(wrongLoad.status).toBe("unavailable");
    if (wrongLoad.status === "unavailable") expect(wrongLoad.reason).toBe("durable aggregate carries a binding outside its owner scope");
  });

  it("7. the RAW aggregate count is bounded BEFORE filtering/validation, and the source receives the complete scope", async () => {
    const agg = await validApprovedAggregate(COMPONENT);
    const oversized = Array.from({ length: MAX_AGGREGATES_PER_COMPONENT + 1 }, () => agg);
    const src = source(oversized);
    const load = await loadComponentAuthorityRecords(deps(src), LOAD);
    expect(load.status).toBe("unavailable");
    if (load.status === "unavailable") expect(load.reason).toBe("durable source returned an oversized aggregate collection");

    // The scope handed to the source is ONE complete object carrying the
    // component id (never a separate parameter that could diverge).
    const okSource = source([agg]);
    await loadComponentAuthorityRecords(deps(okSource), LOAD);
    expect(okSource.scopes).toHaveLength(1);
    expect(okSource.scopes[0]).toEqual({
      ...SCOPE, componentInstanceId: COMPONENT,
      hierarchyPath: [...FIXTURE_AUTHORITY_HIERARCHY], assemblyVariantId: FIXTURE_AUTHORITY_VARIANT,
    });
  });

  it("7b. the route's shared board identity defaults apply when the caller names no hierarchy/variant", async () => {
    const agg = await validApprovedAggregate(COMPONENT, { scopeOverrides: { hierarchyPath: [...PCB_BOARD_HIERARCHY_PATH] } });
    const src = source([agg]);
    const load = await loadComponentAuthorityRecords(deps(src), { scope: SCOPE, canonicalRevision: "eng1-b132", componentInstanceIds: [COMPONENT] });
    expect(load.status === "loaded" && load.records.length === 1).toBe(true);
    expect(src.scopes[0]!.hierarchyPath).toEqual([...PCB_BOARD_HIERARCHY_PATH]);
    expect(src.scopes[0]!.assemblyVariantId).toBe(PCB_BOARD_ASSEMBLY_VARIANT_ID);
  });
});

// ─── B. exact-authority internal consistency (8–10) ──────────────────────────

describe("B13.2 §B — exact-authority internal consistency", () => {
  function verifiedRecord(over: Partial<ComponentAuthorityRecord> = {}): ComponentAuthorityRecord {
    return {
      authorityRecordId: "set-1", componentId: COMPONENT, projectId: SCOPE.projectId, authorityRevision: "rev-1",
      selectedPart: { mpn: FIXTURE_EXACT.exactMpn, manufacturer: FIXTURE_EXACT.manufacturerId, provenance: "physical-binding" },
      lifecycle: "selected", approval: "approved", freshness: "current", conflict: "none",
      footprintAsset: "available", mappingVerification: "verified",
      exactAuthority: {
        atomicPartRevisionId: FIXTURE_EXACT.atomicPartRevisionId, mpn: FIXTURE_EXACT.exactMpn, manufacturer: FIXTURE_EXACT.manufacturerId,
        symbolAssetVersionId: FIXTURE_EXACT.symbolAssetVersionId, footprintAssetVersionId: FIXTURE_EXACT.footprintAssetVersionId,
        mappingCertificateId: FIXTURE_EXACT.mappingCertificateId,
      },
      evidenceRefs: [],
      ...over,
    };
  }
  const stateOf = (record: ComponentAuthorityRecord): string =>
    inspectComponentAuthority({ componentIds: [COMPONENT], projectId: SCOPE.projectId, records: [record] })[0]!.state;

  it("8. a MANUFACTURER mismatch between selectedPart and exactAuthority is never verified-exact", () => {
    const record = verifiedRecord({ selectedPart: { mpn: FIXTURE_EXACT.exactMpn, manufacturer: "manufacturer-counterfeit", provenance: "physical-binding" } });
    expect(stateOf(record)).toBe("exact-authority-unresolved");
    expect(stateOf(verifiedRecord())).toBe("verified-exact"); // control
  });

  it("9. an MPN mismatch between selectedPart and exactAuthority is never verified-exact", () => {
    const record = verifiedRecord({ selectedPart: { mpn: "STM32F411CEU6-CLONE", manufacturer: FIXTURE_EXACT.manufacturerId, provenance: "physical-binding" } });
    expect(stateOf(record)).toBe("exact-authority-unresolved");
  });

  it("10. invalid/empty/whitespace exact-authority identifiers are never verified-exact", () => {
    const base = verifiedRecord().exactAuthority!;
    for (const [field, value] of [
      ["atomicPartRevisionId", ""], ["symbolAssetVersionId", "   "], ["footprintAssetVersionId", "has space"],
      ["mappingCertificateId", "bad id"], ["mpn", ""], ["manufacturer", "   "], ["mpn", " leading"],
      ["selectionRecordId", "not a token"],
    ] as const) {
      const record = verifiedRecord({ exactAuthority: { ...base, [field]: value } });
      expect(stateOf(record), `${field}=${JSON.stringify(value)}`).toBe("exact-authority-unresolved");
    }
    // A record with NO selected part can never be verified-exact either.
    expect(stateOf(verifiedRecord({ selectedPart: undefined }))).toBe("unresolved");
  });

  it("10b. inspection classification and GRANT eligibility agree (no grant from an inconsistent record)", () => {
    const scope = { tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, branchId: SCOPE.branchId };
    const canonicalProject = { schemaVersion: "sirkit.engineering.v1" as const, ...scope, pcb: createEmptyBoard(), pinnedAssets: [] };
    const revision = computeProjectRevision(canonicalProject).canonicalStateDigest;
    const grantFor = (record: ComponentAuthorityRecord) => {
      const canonicalEnvelope = sealResourceEnvelope({
        resourceId: "res:canonical", kind: "canonical-state", ...scope,
        authoritySource: "local-working-copy", authorityStatus: "verified", sourceVersion: "1",
        sourceCanonicalRevision: revision, producer: "b13-2-test", producerVersion: "1.0.0",
        freshness: "current", content: canonicalProject,
      });
      const authorityEnvelope = sealResourceEnvelope({
        resourceId: "res:authority", kind: "component-authority-records", ...scope,
        authoritySource: "durable-server-board", authorityStatus: "verified", sourceVersion: "1",
        sourceCanonicalRevision: revision, producer: "component-authority-source", producerVersion: "1.0.0",
        freshness: "current", content: { records: [record], candidates: [] },
      });
      return consumeReplacementAuthority({
        bundle: buildReadResourceBundle(canonicalEnvelope, [authorityEnvelope]),
        scope, expectedCanonicalRevision: revision, componentId: COMPONENT,
        targetPartId: FIXTURE_EXACT.exactMpn,
        target: { atomicPartRevisionId: FIXTURE_EXACT.atomicPartRevisionId },
      });
    };
    const mismatched = verifiedRecord({ selectedPart: { mpn: FIXTURE_EXACT.exactMpn, manufacturer: "manufacturer-counterfeit", provenance: "physical-binding" } });
    const refusal = grantFor(mismatched);
    expect(refusal.ok).toBe(false);
    if (!refusal.ok) expect(refusal.code).toBe("not_verified");
    expect(grantFor(verifiedRecord()).ok).toBe(true); // the consistent control still grants
  });
});

// ─── C. immediate external-abort settlement (11–15) ──────────────────────────

describe("B13.2 §C — abort settlement state machine", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers(); });

  /** A source that NEVER settles, even after observing abort. */
  function hostileSource(): { source: AuthorityBindingSource; abortCount: () => number; started: () => number; settle: (mode: "resolve" | "reject") => void } {
    let abortCount = 0; let started = 0;
    let resolveFn: (() => void) | undefined; let rejectFn: (() => void) | undefined;
    return {
      abortCount: () => abortCount, started: () => started,
      settle: (mode) => { if (mode === "resolve") resolveFn?.(); else rejectFn?.(); },
      source: {
        loadForComponent(_scope, signal) {
          started += 1;
          signal?.addEventListener("abort", () => { abortCount += 1; });
          return new Promise<AuthorityBindingAggregate[]>((resolve, reject) => { resolveFn = () => resolve([]); rejectFn = () => reject(new Error("late")); });
        },
      },
    };
  }

  it("11. a MID-FLIGHT external abort settles null IMMEDIATELY — never waiting for the deadline", async () => {
    const hostile = hostileSource();
    const controller = new AbortController();
    let settledValue: unknown = "PENDING";
    const promise = loadRunComponentAuthority(deps(hostile.source), { ...LOAD, signal: controller.signal }, 5_000)
      .then((value) => { settledValue = value; });
    await Promise.resolve();
    controller.abort();
    // NO timer advance at all: settlement must not depend on the deadline.
    await promise;
    expect(settledValue).toBeNull();
    expect(hostile.abortCount()).toBe(1);       // internal controller aborted exactly once
    expect(vi.getTimerCount()).toBe(0);         // the deadline timer was cleared
  });

  it("12. the deadline still settles null and aborts the source exactly once", async () => {
    const hostile = hostileSource();
    const promise = loadRunComponentAuthority(deps(hostile.source), LOAD, 50);
    await vi.advanceTimersByTimeAsync(50);
    expect(await promise).toBeNull();
    expect(hostile.abortCount()).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("13. a concurrent abort/deadline race settles exactly once (both orders)", async () => {
    for (const order of ["abort-first", "deadline-first"] as const) {
      const hostile = hostileSource();
      const controller = new AbortController();
      let settlements = 0;
      const promise = loadRunComponentAuthority(deps(hostile.source), { ...LOAD, signal: controller.signal }, 30)
        .then((value) => { settlements += 1; return value; });
      await Promise.resolve();
      if (order === "abort-first") {
        controller.abort();
        await vi.advanceTimersByTimeAsync(60);
      } else {
        await vi.advanceTimersByTimeAsync(30);
        controller.abort();
      }
      expect(await promise, order).toBeNull();
      await vi.advanceTimersByTimeAsync(10);
      expect(settlements, order).toBe(1);
      expect(hostile.abortCount(), order).toBe(1);
      expect(vi.getTimerCount(), order).toBe(0);
    }
  });

  it("14/15. late resolution and late rejection after settlement are discarded with no unhandled rejection", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => { unhandled.push(reason); };
    process.on("unhandledRejection", onUnhandled);
    try {
      for (const mode of ["resolve", "reject"] as const) {
        const hostile = hostileSource();
        const controller = new AbortController();
        const promise = loadRunComponentAuthority(deps(hostile.source), { ...LOAD, signal: controller.signal }, 5_000);
        await Promise.resolve();
        controller.abort();
        expect(await promise, mode).toBeNull();
        hostile.settle(mode);                    // late settlement AFTER the terminal abort
        await vi.advanceTimersByTimeAsync(1);
        await Promise.resolve();
      }
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    expect(unhandled).toEqual([]);
  });

  it("15b. a pre-aborted request performs NO I/O and settles null", async () => {
    const hostile = hostileSource();
    const controller = new AbortController();
    controller.abort();
    expect(await loadRunComponentAuthority(deps(hostile.source), { ...LOAD, signal: controller.signal }, 50)).toBeNull();
    expect(hostile.started()).toBe(0);
  });
});

// ─── D. real production query cancellation (16–18) ───────────────────────────

/** A controllable postgres.js-shaped PendingQuery: awaitable rows + a real
 *  `cancel()` that rejects the query the way the driver's 57014 does. */
function controllableClient(responses: Record<string, unknown[]> | ((text: string) => unknown[])): CancellableAuthoritySqlClient & {
  cancels: number; issued: string[]; pending: Array<{ text: string; release: () => void }>; deferred: boolean;
} {
  const state = {
    cancels: 0,
    issued: [] as string[],
    pending: [] as Array<{ text: string; release: () => void }>,
    deferred: false,
    unsafe(text: string, params: string[]): CancellableAuthorityQuery {
      void params;
      state.issued.push(text);
      const rows = typeof responses === "function" ? responses(text) : (responses[Object.keys(responses).find((key) => text.includes(key)) ?? ""] ?? []);
      let rejectFn: ((error: unknown) => void) | undefined;
      let settled = false;
      const promise = new Promise<readonly Record<string, unknown>[]>((resolve, reject) => {
        rejectFn = (error) => { if (!settled) { settled = true; reject(error); } };
        const release = (): void => { if (!settled) { settled = true; resolve(rows as Record<string, unknown>[]); } };
        if (state.deferred) state.pending.push({ text, release });
        else release();
      });
      const query = promise as unknown as CancellableAuthorityQuery;
      (query as { cancel: () => void }).cancel = () => {
        state.cancels += 1;
        // The driver rejects a cancelled query (PostgreSQL 57014).
        rejectFn?.(Object.assign(new Error("canceling statement due to user request"), { code: "57014" }));
      };
      return query;
    },
  };
  return state;
}

describe("B13.2 §D — production database cancellation", () => {
  it("16. an abort during a BINDING query invokes the driver's real cancel() and normalizes the failure", async () => {
    const client = controllableClient({ physical_binding_sets: [] });
    client.deferred = true;
    const controller = new AbortController();
    const scope: AuthorityComponentScope = {
      ...SCOPE, componentInstanceId: COMPONENT,
      hierarchyPath: [...FIXTURE_AUTHORITY_HIERARCHY], assemblyVariantId: FIXTURE_AUTHORITY_VARIANT,
    };
    const promise = loadBindingAggregatesCancellable(client, scope, controller.signal);
    await Promise.resolve();
    expect(client.issued).toHaveLength(1);
    controller.abort();
    await expect(promise).rejects.toThrow(AUTHORITY_READ_ABORTED);
    expect(client.cancels).toBe(1);              // REAL query.cancel() was invoked
  });

  it("17. an abort during an ATOMIC query invokes cancel() and yields no confirmation", async () => {
    const client = controllableClient({ atomic_part_revisions: [] });
    client.deferred = true;
    const controller = new AbortController();
    const promise = confirmPublishedAtomicRevisionCancellable(client, FIXTURE_EXACT.atomicPartRevisionId, controller.signal);
    await Promise.resolve();
    controller.abort();
    await expect(promise).rejects.toThrow(AUTHORITY_READ_ABORTED);
    expect(client.cancels).toBe(1);
  });

  it("18. an abort BETWEEN sequential reads starts no further query", async () => {
    const setScope = {
      tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, branchId: SCOPE.branchId, boardInstanceId: SCOPE.boardInstanceId,
      componentInstanceId: COMPONENT, hierarchyPath: [...FIXTURE_AUTHORITY_HIERARCHY], assemblyVariantIds: [FIXTURE_AUTHORITY_VARIANT],
    };
    const client = controllableClient({
      physical_binding_sets: [{ binding_set: { setId: "set-1", scope: setScope, candidateRevisionIds: ["rev-1"] } }],
      physical_binding_revisions: [{ binding: { revisionId: "rev-1", scope: setScope } }],
    });
    const controller = new AbortController();
    const scope: AuthorityComponentScope = {
      ...SCOPE, componentInstanceId: COMPONENT,
      hierarchyPath: [...FIXTURE_AUTHORITY_HIERARCHY], assemblyVariantId: FIXTURE_AUTHORITY_VARIANT,
    };
    // Abort as soon as the FIRST query resolves, before the revisions read.
    const promise = loadBindingAggregatesCancellable(client, scope, controller.signal).catch((error: Error) => error.message);
    controller.abort();
    expect(await promise).toBe(AUTHORITY_READ_ABORTED);
    expect(client.issued).toHaveLength(1);       // the second query never started
    expect(client.issued[0]).toContain("physical_binding_sets");
  });

  it("18b. driver errors never leak SQL, connection info, or raw driver detail", async () => {
    const leaky: CancellableAuthoritySqlClient = {
      unsafe(text: string): CancellableAuthorityQuery {
        void text;
        const promise = Promise.reject(new Error("connection to postgres://user:secret@db:5432 failed near SELECT * FROM physical_binding_sets"));
        const query = promise as unknown as CancellableAuthorityQuery;
        (query as { cancel: () => void }).cancel = () => {};
        return query;
      },
    };
    const error = await runCancellableAuthorityRead(leaky, "select 1", [], undefined).catch((caught: Error) => caught);
    expect((error as Error).message).toBe(AUTHORITY_READ_UNAVAILABLE);
    expect((error as Error).message).not.toContain("secret");
    expect((error as Error).message).not.toContain("physical_binding_sets");
  });

  it("18d. SUPPLEMENTARY tripwire: the production runtime no longer discards the abort signal", () => {
    // The load-bearing proofs are behavioural (16/17/18). This static check
    // only guards against a regression that silently reintroduces `void
    // signal` in the production adapter.
    const runtime = readFileSync(join(process.cwd(), "app/api/chat/component-authority-runtime.ts"), "utf8");
    expect(runtime).not.toContain("void signal");
    expect(runtime).toContain("loadBindingAggregatesCancellable");
    expect(runtime).toContain("confirmPublishedAtomicRevisionCancellable");
  });

  it("18c. a successful cancellable read projects ONLY { set, bindings } from durable rows", async () => {
    const setScope = {
      tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, branchId: SCOPE.branchId, boardInstanceId: SCOPE.boardInstanceId,
      componentInstanceId: COMPONENT, hierarchyPath: [...FIXTURE_AUTHORITY_HIERARCHY], assemblyVariantIds: [FIXTURE_AUTHORITY_VARIANT],
    };
    const client = controllableClient({
      physical_binding_sets: [{ binding_set: { setId: "set-1", scope: setScope, candidateRevisionIds: ["rev-1"] }, audit_events: ["LEAK"] }],
      physical_binding_revisions: [{ binding: { revisionId: "rev-1", scope: setScope }, record_digest: "LEAK" }],
    });
    const aggregates = await loadBindingAggregatesCancellable(client, {
      ...SCOPE, componentInstanceId: COMPONENT, hierarchyPath: [...FIXTURE_AUTHORITY_HIERARCHY], assemblyVariantId: FIXTURE_AUTHORITY_VARIANT,
    }, undefined);
    expect(aggregates).toHaveLength(1);
    expect(Object.keys(aggregates[0]!).sort()).toEqual(["bindings", "set"]);
    expect(JSON.stringify(aggregates)).not.toContain("LEAK");
    // A hierarchy/variant that does not apply is filtered by the QUERY layer too.
    const filtered = await loadBindingAggregatesCancellable(client, {
      ...SCOPE, componentInstanceId: COMPONENT, hierarchyPath: ["root", "elsewhere"], assemblyVariantId: FIXTURE_AUTHORITY_VARIANT,
    }, undefined);
    expect(filtered).toHaveLength(0);
  });
});
