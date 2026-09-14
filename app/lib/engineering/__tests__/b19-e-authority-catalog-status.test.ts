/**
 * [B19-E E5 c] Component authority carries the bound revision's catalog status (OD-38).
 *
 *  - revoked: no exactAuthority, and a named gap — the component is never verified-exact, whatever else is clean;
 *  - deprecated or superseded: the existing pin keeps its exact authority (verified-exact), with a gap naming the successor;
 *  - published: nothing changes — no facet, no gap, the same record digest as before E5.
 * The production source (cancellable SQL over the append-only status events) and the fixture runtime both supply the status;
 * a status read that fails fails the load closed.
 *
 * Reproduced on the unchanged code: the loader had no status input, so a deprecated pin carried no gap and a revoked
 * revision's absence of authority was indistinguishable from an unpublished one.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadComponentAuthorityRecords, type AuthorityBindingAggregate, type ComponentAuthoritySourceDeps } from "../component-authority-source";
import { inspectComponentAuthority, type ComponentAuthorityRecord } from "../component-authority";
import { FIXTURE_AUTHORITY_HIERARCHY, FIXTURE_AUTHORITY_SCOPE, FIXTURE_EXACT, matchingAtomicConfirmer, validApprovedAggregate } from "./_authority-fixtures";
import { loadAtomicCatalogStatusCancellable, AUTHORITY_READ_ABORTED, type CancellableAuthorityQuery, type CancellableAuthoritySqlClient } from "@/app/api/chat/authority-cancellable-reads";
import { resetAuthoritySqlClientFactory, resolveComponentAuthoritySource, setAuthoritySqlClientFactory } from "@/app/api/chat/component-authority-runtime";
import { fixtureComponentAuthoritySource } from "@/app/lib/fixture-runtime/blinker/authority";
import { blinkerCatalog } from "@/app/lib/fixture-runtime/blinker/catalog";

const COMPONENT = "component-uuid-1";
const LOAD = { scope: FIXTURE_AUTHORITY_SCOPE, canonicalRevision: "eng1-head", componentInstanceIds: [COMPONENT], hierarchyPath: FIXTURE_AUTHORITY_HIERARCHY };
const SUCCESSOR = "atomic-revision-2";

function deps(aggregate: AuthorityBindingAggregate, catalogStatus?: ComponentAuthoritySourceDeps["catalogStatus"]): ComponentAuthoritySourceDeps & { statusCalls: string[] } {
  const statusCalls: string[] = [];
  return {
    statusCalls,
    bindings: { loadForComponent: async () => [aggregate] },
    atomic: matchingAtomicConfirmer(),
    ...(catalogStatus ? { catalogStatus: async (id: string, signal?: AbortSignal) => { statusCalls.push(id); return catalogStatus(id, signal); } } : {}),
  };
}

const verifiedRecord = (catalogStatus?: ComponentAuthorityRecord["catalogStatus"]): ComponentAuthorityRecord => ({
  authorityRecordId: "set-1", componentId: COMPONENT, projectId: FIXTURE_AUTHORITY_SCOPE.projectId, authorityRevision: "binding:r4",
  selectedPart: { mpn: FIXTURE_EXACT.exactMpn, manufacturer: FIXTURE_EXACT.manufacturerId, provenance: "physical-binding" },
  lifecycle: "selected", approval: "approved", freshness: "current", conflict: "none", footprintAsset: "available", mappingVerification: "verified",
  exactAuthority: { atomicPartRevisionId: FIXTURE_EXACT.atomicPartRevisionId, mpn: FIXTURE_EXACT.exactMpn, manufacturer: FIXTURE_EXACT.manufacturerId, symbolAssetVersionId: FIXTURE_EXACT.symbolAssetVersionId, footprintAssetVersionId: FIXTURE_EXACT.footprintAssetVersionId, mappingCertificateId: FIXTURE_EXACT.mappingCertificateId },
  ...(catalogStatus ? { catalogStatus } : {}),
});
const summarize = (record: ComponentAuthorityRecord) => inspectComponentAuthority({ componentIds: [COMPONENT], projectId: FIXTURE_AUTHORITY_SCOPE.projectId, records: [record] })[0]!;

afterEach(() => { resetAuthoritySqlClientFactory(); vi.unstubAllEnvs(); });

describe("[B19-E E5 c] the inspector reads the catalog status facet", () => {
  it("a revoked revision is never verified-exact, even with a complete exact block, and says why", () => {
    const summary = summarize(verifiedRecord({ atomicPartRevisionId: FIXTURE_EXACT.atomicPartRevisionId, state: "revoked" }));
    expect(summary.state).not.toBe("verified-exact");
    expect(summary.authorityGaps.some((gap) => /revoked/.test(gap) && gap.includes(FIXTURE_EXACT.atomicPartRevisionId))).toBe(true);
  });

  it.each(["deprecated", "superseded"] as const)("a %s revision stays verified-exact with a gap naming its successor", (state) => {
    const summary = summarize(verifiedRecord({ atomicPartRevisionId: FIXTURE_EXACT.atomicPartRevisionId, state, successorRevisionId: SUCCESSOR }));
    expect(summary.state).toBe("verified-exact");
    const gap = summary.authorityGaps.find((item) => item.includes(state));
    expect(gap).toBeDefined();
    expect(gap).toContain(SUCCESSOR);
  });

  it("a deprecated revision with no successor says that no successor is named", () => {
    const summary = summarize(verifiedRecord({ atomicPartRevisionId: FIXTURE_EXACT.atomicPartRevisionId, state: "deprecated" }));
    expect(summary.state).toBe("verified-exact");
    expect(summary.authorityGaps.join(" ")).toMatch(/deprecated.*no successor/);
  });

  it("a published revision carries no facet and no gap: its summary and record digest are what they were", () => {
    const summary = summarize(verifiedRecord());
    expect(summary.state).toBe("verified-exact");
    expect(summary.authorityGaps).toEqual([]);
  });
});

describe("[B19-E E5 c] the server loader supplies the facet from the revision's status", () => {
  it("revoked: no exactAuthority and a revoked facet (the pinned confirmation is not consulted)", async () => {
    const aggregate = await validApprovedAggregate(COMPONENT);
    const source = deps(aggregate, async () => ({ state: "revoked" }));
    const load = await loadComponentAuthorityRecords(source, LOAD);
    expect(load.status).toBe("loaded");
    if (load.status !== "loaded") return;
    const [record] = load.records;
    expect(record!.exactAuthority).toBeUndefined();
    expect(record!.catalogStatus).toEqual({ atomicPartRevisionId: FIXTURE_EXACT.atomicPartRevisionId, state: "revoked" });
    expect(source.statusCalls).toEqual([FIXTURE_EXACT.atomicPartRevisionId]);
    expect(summarize(record!).authorityGaps.join(" ")).toMatch(/revoked/);
  });

  it.each(["deprecated", "superseded"] as const)("%s: the existing pin keeps its exact authority and the facet names the successor", async (state) => {
    const aggregate = await validApprovedAggregate(COMPONENT);
    const load = await loadComponentAuthorityRecords(deps(aggregate, async () => ({ state, successorRevisionId: SUCCESSOR })), LOAD);
    if (load.status !== "loaded") throw new Error(load.reason);
    const [record] = load.records;
    expect(record!.exactAuthority?.atomicPartRevisionId).toBe(FIXTURE_EXACT.atomicPartRevisionId);
    expect(record!.catalogStatus).toEqual({ atomicPartRevisionId: FIXTURE_EXACT.atomicPartRevisionId, state, successorRevisionId: SUCCESSOR });
    const summary = summarize(record!);
    expect(summary.state).toBe("verified-exact");
    expect(summary.authorityGaps.join(" ")).toContain(SUCCESSOR);
  });

  it("published: the records and their source digest are identical to a load without a status reader", async () => {
    const aggregate = await validApprovedAggregate(COMPONENT);
    const withStatus = await loadComponentAuthorityRecords(deps(aggregate, async () => ({ state: "published" })), LOAD);
    const without = await loadComponentAuthorityRecords(deps(aggregate), LOAD);
    expect(withStatus).toEqual(without);
    if (withStatus.status === "loaded") expect(withStatus.records[0]!.catalogStatus).toBeUndefined();
  });

  it("a status read that fails fails the whole load closed", async () => {
    const aggregate = await validApprovedAggregate(COMPONENT);
    const load = await loadComponentAuthorityRecords(deps(aggregate, async () => { throw new Error("status source down"); }), LOAD);
    expect(load).toEqual({ status: "unavailable", reason: expect.stringMatching(/status/) });
  });
});

/** postgres.js-shaped client returning the given status-event rows for the events query. */
function eventsClient(rows: Array<{ to_state: string; successor_revision_id: string | null }>, seen: string[] = []): CancellableAuthoritySqlClient {
  return {
    unsafe(text: string): CancellableAuthorityQuery {
      seen.push(text);
      const promise = Promise.resolve(text.includes("atomic_revision_status_events") ? rows : []);
      return Object.assign(promise, { cancel: () => {} }) as unknown as CancellableAuthorityQuery;
    },
  };
}

describe("[B19-E E5 c] production and fixture runtime sources", () => {
  it("the cancellable status read derives the furthest state and its successor from the append-only events", async () => {
    expect(await loadAtomicCatalogStatusCancellable(eventsClient([]), "rev", undefined)).toEqual({ state: "published" });
    expect(await loadAtomicCatalogStatusCancellable(eventsClient([{ to_state: "deprecated", successor_revision_id: null }, { to_state: "superseded", successor_revision_id: SUCCESSOR }]), "rev", undefined)).toEqual({ state: "superseded", successorRevisionId: SUCCESSOR });
    expect(await loadAtomicCatalogStatusCancellable(eventsClient([{ to_state: "revoked", successor_revision_id: null }]), "rev", undefined)).toEqual({ state: "revoked" });
    const aborted = new AbortController();
    aborted.abort();
    await expect(loadAtomicCatalogStatusCancellable(eventsClient([]), "rev", aborted.signal)).rejects.toThrow(AUTHORITY_READ_ABORTED);
  });

  it("the production chat source wires the status reader over the same SQL client", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://fixture-only.invalid/db");
    const seen: string[] = [];
    setAuthoritySqlClientFactory(() => eventsClient([{ to_state: "revoked", successor_revision_id: null }], seen));
    const source = resolveComponentAuthoritySource({ tenantId: "t", projectId: "p", branchId: "main" });
    expect(source?.catalogStatus).toBeTypeOf("function");
    expect(await source!.catalogStatus!("rev-x")).toEqual({ state: "revoked" });
    expect(seen.some((text) => text.includes("atomic_revision_status_events"))).toBe(true);
  });

  it("the fixture runtime's source supplies it too: its committed catalog is published; an unknown revision has none", async () => {
    vi.stubEnv("SIRKIT_FIXTURE_RUNTIME", "blinker");
    vi.stubEnv("SIRKIT_AUTH_MODE", "local_dev");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DATABASE_URL", "");
    const source = fixtureComponentAuthoritySource();
    const [revisionId] = [...blinkerCatalog().snapshots.keys()];
    expect(source.catalogStatus).toBeTypeOf("function");
    expect(await source.catalogStatus!(revisionId!)).toEqual({ state: "published" });
    expect(await source.catalogStatus!("no-such-revision")).toBeNull();
  });
});
