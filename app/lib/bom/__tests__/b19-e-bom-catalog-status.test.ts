/**
 * [B19-E E5] Each BOM line that names an atomic revision carries that revision's catalog status: published, deprecated,
 * superseded (with its successor), revoked, unpublished (the id names no published revision) or unavailable (the status could
 * not be read — the BOM still builds). A line with no atomic revision has none. The status is read once for every line.
 *
 * Reproduced on the unchanged code: BomRow had no catalogStatus.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const seams = vi.hoisted(() => ({ calls: [] as string[][], fail: false, statuses: new Map<string, { state: string; successorRevisionId?: string }>() }));
vi.mock("@/app/lib/db/client", () => ({ getDb: () => { throw new Error("no database in this test"); } }));
vi.mock("@/app/lib/atomic/server-catalog", () => ({
  loadAtomicRevisionStatus: async (ids: readonly string[]) => {
    seams.calls.push([...ids]);
    if (seams.fail) throw new Error("status store down");
    return new Map(ids.flatMap((id) => (seams.statuses.has(id) ? [[id, { revisionId: id, logicalPartId: "lp", selectable: seams.statuses.get(id)!.state === "published", pinnable: seams.statuses.get(id)!.state !== "revoked", ...seams.statuses.get(id)! }] as const] : [])));
  },
}));

import { buildBom, bomToCsv } from "../build";
import { blinkerCatalog } from "@/app/lib/fixture-runtime/blinker/catalog";
import type { ProjectComponentPin } from "@/app/lib/atomic/types";

const snapshots = [...blinkerCatalog().snapshots.values()].slice(0, 3);
const pin = (index: number): ProjectComponentPin => {
  const snapshot = snapshots[index]!;
  return { selectionRecordId: `sel-${index}`, atomicRevisionId: snapshot.atomicRevision.id, symbolVersionId: snapshot.symbol.versionId, footprintVersionId: snapshot.footprint?.versionId, modelVersionIds: [], mappingCertificateId: snapshot.mapping?.id, embeddedSnapshot: snapshot } as ProjectComponentPin;
};
const STATE = {
  components: [{ id: "r-theory", type: "resistor", value: "10k", x: 0, y: 0, rotation: 0, refDes: "R9" }],
  wires: [], netLabels: [],
  kicadComponents: [0, 1, 2].map((index) => ({ id: `k${index}`, partId: `part-${index}`, x: 0, y: 0, rotation: 0, refDes: `U${index + 1}`, value: `v${index}`, atomicPartRevisionId: snapshots[index]!.atomicRevision.id })),
} as never;
const SELECTIONS = { k0: pin(0), k1: pin(1), k2: pin(2) };

afterEach(() => { seams.calls.length = 0; seams.fail = false; seams.statuses.clear(); });

describe("[B19-E E5] BomRow.catalogStatus", () => {
  it("names each line's state and successor, reading the status once", async () => {
    seams.statuses.set(snapshots[0]!.atomicRevision.id, { state: "published" });
    seams.statuses.set(snapshots[1]!.atomicRevision.id, { state: "superseded", successorRevisionId: "atomic_successor" });
    const result = await buildBom(STATE, "none", {}, SELECTIONS, { catalogStatus: true });
    const byRef = Object.fromEntries(result.rows.map((row) => [row.refDes, row.catalogStatus]));
    expect(byRef).toEqual({
      U1: { state: "published", successorRevisionId: null },
      U2: { state: "superseded", successorRevisionId: "atomic_successor" },
      U3: { state: "unpublished", successorRevisionId: null },
      R9: null,
    });
    expect(seams.calls).toHaveLength(1);
    expect([...seams.calls[0]!].sort()).toEqual(snapshots.map((snapshot) => snapshot.atomicRevision.id).sort());
  });

  it("revoked and deprecated lines say so", async () => {
    seams.statuses.set(snapshots[0]!.atomicRevision.id, { state: "revoked" });
    seams.statuses.set(snapshots[1]!.atomicRevision.id, { state: "deprecated" });
    const result = await buildBom(STATE, "none", {}, SELECTIONS, { catalogStatus: true });
    expect(result.rows.find((row) => row.refDes === "U1")!.catalogStatus).toEqual({ state: "revoked", successorRevisionId: null });
    expect(result.rows.find((row) => row.refDes === "U2")!.catalogStatus).toEqual({ state: "deprecated", successorRevisionId: null });
  });

  it("a status read that fails marks the lines unavailable; the BOM and its CSV still build unchanged", async () => {
    seams.fail = true;
    const result = await buildBom(STATE, "none", {}, SELECTIONS, { catalogStatus: true });
    expect(result.rows.filter((row) => row.atomicRevisionId).map((row) => row.catalogStatus?.state)).toEqual(["unavailable", "unavailable", "unavailable"]);
    expect(bomToCsv(result).split("\r\n")[0]).toBe("refDes,Qty,Name,Sirkit Atomic Revision,MPN,Manufacturer,Package,Value,Best Unit Price,Currency,Extended Price,In Stock,Datasheet,Distributor URL,Risk Score,Risk Grade,Risk Notes");
  });

  it("[B19-E E5 review] without the option (the public export, cart and packet builds) no status is read and no line carries one", async () => {
    seams.statuses.set(snapshots[1]!.atomicRevision.id, { state: "revoked" });
    const result = await buildBom(STATE, "none", {}, SELECTIONS);
    expect(seams.calls).toEqual([]);
    expect(result.rows.map((row) => row.catalogStatus)).toEqual(result.rows.map(() => undefined));
  });

  it("[B19-E E5 review] an id that is not a bounded revision id is never read (it names no published revision)", async () => {
    const odd = { ...(STATE as object), kicadComponents: [{ id: "k-odd", partId: "part-odd", x: 0, y: 0, rotation: 0, refDes: "U9", value: "v", atomicPartRevisionId: "not a revision id" }] } as never;
    // a selection without an embedded snapshot: the line keeps the instance's own id (and reads no part catalog)
    const result = await buildBom(odd, "none", {}, { "k-odd": { ...pin(0), embeddedSnapshot: undefined } as unknown as ProjectComponentPin }, { catalogStatus: true });
    expect(seams.calls).toEqual([]);
    expect(result.rows.find((row) => row.refDes === "U9")!.catalogStatus).toEqual({ state: "unpublished", successorRevisionId: null });
  });

  it("a BOM with no atomic revision reads no status", async () => {
    const theoryOnly = { components: [{ id: "r1", type: "resistor", value: "10k", x: 0, y: 0, rotation: 0, refDes: "R1" }], wires: [], kicadComponents: [], netLabels: [] } as never;
    const result = await buildBom(theoryOnly, "none", {}, {}, { catalogStatus: true });
    expect(result.rows[0]!.catalogStatus).toBeNull();
    expect(seams.calls).toEqual([]);
  });
});
