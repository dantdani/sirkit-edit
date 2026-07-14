/**
 * Stage 17 Phase A gate: the global selection store (insertion order, dedupe,
 * primary tracking, subscribe) and the selection queries (shared values,
 * select-similar, select-net).
 */

import { describe, it, expect, vi } from "vitest";
import { createSelectionStore } from "../selection";
import {
  getItems,
  sharedNetId,
  sharedLayer,
  sharedPadstackId,
  selectSimilar,
  selectNet,
} from "../selection-queries";
import { buildRoutedDemo } from "../demo/routed-demo";
import type { SelectionRef } from "../edit/commands";
import { mmToNm } from "../units";

const via = (id: string): SelectionRef => ({ kind: "via", id });
const track = (id: string): SelectionRef => ({ kind: "track", id });

describe("selection store", () => {
  it("replace / add / toggle / remove / clear with insertion order + dedupe", () => {
    const store = createSelectionStore();
    expect(store.get()).toEqual({ refs: [] });

    store.replace([via("v1"), track("t1"), via("v1")]); // dedupes
    expect(store.get().refs).toEqual([via("v1"), track("t1")]);
    expect(store.get().primary).toEqual(track("t1")); // last ref

    store.add(via("v2"));
    expect(store.get().refs).toEqual([via("v1"), track("t1"), via("v2")]);
    expect(store.get().primary).toEqual(via("v2"));

    store.add(via("v1")); // already present — no duplicate, becomes primary
    expect(store.get().refs).toEqual([via("v1"), track("t1"), via("v2")]);
    expect(store.get().primary).toEqual(via("v1"));

    store.toggle(track("t1")); // in → out
    expect(store.get().refs).toEqual([via("v1"), via("v2")]);
    store.toggle(track("t1")); // out → in, becomes primary
    expect(store.get().primary).toEqual(track("t1"));

    store.remove([via("v1"), via("v2")]);
    expect(store.get().refs).toEqual([track("t1")]);

    store.clear();
    expect(store.get()).toEqual({ refs: [] });
  });

  it("keeps primary sane when the primary is removed", () => {
    const store = createSelectionStore();
    store.replace([via("v1"), via("v2")], via("v2"));
    store.remove([via("v2")]);
    expect(store.get().primary).toEqual(via("v1"));
    store.toggle(via("v1"));
    expect(store.get().refs).toEqual([]);
    expect(store.get().primary).toBeUndefined();
  });

  it("notifies subscribers on every change and supports unsubscribe", () => {
    const store = createSelectionStore();
    const cb = vi.fn();
    const unsub = store.subscribe(cb);
    store.replace([via("v1")]);
    store.toggle(via("v1"));
    expect(cb).toHaveBeenCalledTimes(2);
    unsub();
    store.add(via("v2"));
    expect(cb).toHaveBeenCalledTimes(2);
  });
});

describe("selection queries", () => {
  const board = buildRoutedDemo();
  const gnd = board.nets.find((n) => n.name === "GND")?.id ?? -1;
  const vcc = board.nets.find((n) => n.name === "VCC")?.id ?? -1;
  const vccTracks = board.tracks.filter((t) => t.netId === vcc);
  const gndTracks = board.tracks.filter((t) => t.netId === gnd);

  it("resolves refs and skips dead ones", () => {
    const items = getItems(board, [via("rd-v1"), via("ghost"), track(vccTracks[0].id)]);
    expect(items.map((i) => i.kind)).toEqual(["via", "track"]);
  });

  it("computes shared values, '—' (undefined) when mixed", () => {
    expect(sharedNetId(board, vccTracks.map((t) => track(t.id)))).toBe(vcc);
    expect(
      sharedNetId(board, [track(vccTracks[0].id), track(gndTracks[0].id)]),
    ).toBeUndefined();
    // Vias participate in nets too.
    expect(sharedNetId(board, [via("rd-v1"), via("rd-v2")])).toBe(vcc);

    expect(sharedLayer(board, gndTracks.map((t) => track(t.id)))).toBe(
      gndTracks[0].layer,
    );
    // Vias have no single layer — shared layer is undefined.
    expect(sharedLayer(board, [via("rd-v1")])).toBeUndefined();
  });

  it("shares padstacks by id, and by dims before migration", () => {
    // Demo vias predate padstacks (no padstackId) with identical dims —
    // they share nothing yet (sharedPadstackId is id-based).
    expect(sharedPadstackId(board, [via("rd-v1"), via("rd-v2")])).toBeUndefined();
    const withIds = structuredClone(board);
    for (const v of withIds.vias) v.padstackId = "ps-default";
    expect(sharedPadstackId(withIds, [via("rd-v1"), via("rd-v2")])).toBe("ps-default");
    expect(sharedPadstackId(withIds, [via("rd-v1"), track(vccTracks[0].id)])).toBeUndefined();
  });

  it("selectNet gathers tracks, vias, zones and pads of the net", () => {
    const refs = selectNet(board, gnd);
    const kinds = new Set(refs.map((r) => r.kind));
    expect(kinds.has("track")).toBe(true);
    expect(kinds.has("zone")).toBe(true); // the GND plane
    expect(kinds.has("pad")).toBe(true);
    expect(refs.every((r) => r.kind !== "footprint")).toBe(true);

    const vccRefs = selectNet(board, vcc);
    expect(vccRefs.filter((r) => r.kind === "via").length).toBe(2);
  });

  it("selectSimilar expands by net, layer and padstack dims", () => {
    const byNet = selectSimilar(board, track(gndTracks[0].id), "net");
    expect(byNet.length).toBe(selectNet(board, gnd).length);

    const byLayer = selectSimilar(board, track(vccTracks[0].id), "layer");
    const layer = vccTracks[0].layer;
    expect(byLayer.length).toBe(
      board.tracks.filter((t) => t.layer === layer).length +
        board.zones.filter((z) => z.layer === layer).length,
    );

    // Same (size, drill) via dims count as similar before migration.
    const byPadstack = selectSimilar(board, via("rd-v1"), "padstack");
    expect(byPadstack).toEqual([via("rd-v1"), via("rd-v2")]);

    // A via with different dims is not similar.
    const altered = structuredClone(board);
    const v2 = altered.vias.find((v) => v.id === "rd-v2");
    if (v2) v2.drill = mmToNm(0.2);
    expect(selectSimilar(altered, via("rd-v1"), "padstack")).toEqual([via("rd-v1")]);
  });

  it("selectSimilar by net on unconnected (net 0) copper stays single-item", () => {
    const orphan = board.tracks.find((t) => t.netId === 0);
    expect(orphan).toBeDefined();
    const ref = track(orphan?.id ?? "");
    expect(selectSimilar(board, ref, "net")).toEqual([ref]);
  });
});
