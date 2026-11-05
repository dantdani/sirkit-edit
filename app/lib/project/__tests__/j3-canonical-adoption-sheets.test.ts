/**
 * [PR-J3, 2026-10-22] Runbook J.3 / J.8.1 (OD-255 item 7): the shared canonical adoption primitive (`adoptCanonicalResult`, driven by
 * app/page.tsx's applyCanonicalSchematicProjection) normalizes the adopted state WITH its sheet tree iff present: the authoritative
 * projection, the recorded history snapshot and the coordinator notification all carry it, and a single-sheet result stays
 * byte-identical (no `sheets` key, the same digest as before J3).
 */
import { describe, expect, it } from "vitest";
import { schematicStateDigest } from "@/app/lib/engineering/schematic-model";
import { adoptCanonicalResult } from "@/app/lib/project/canonical-adoption";
import { SchematicHistory } from "@/app/lib/project/schematic-history";
import { droneFixtureState } from "@/app/lib/schematic/__tests__/_j1-fixtures";
import { multiSheetDroneFixtureState } from "@/app/lib/schematic/__tests__/_j3-fixtures";
import type { SchematicState } from "@/lib/schematic-types";

/** The page's host: the projection applier, the snapshot recorder (app/page.tsx's SchematicSnapshot shape) and a real history. */
function host(initial: SchematicState) {
  const history = new SchematicHistory<SchematicState>(structuredClone(initial), { label: "Opened project" });
  const projections: SchematicState[] = [];
  const snapshots: SchematicState[] = [];
  let suppressed = 0;
  let autosaves = 0;
  const adopt = (label: string, state: SchematicState) => adoptCanonicalResult<SchematicState>({
    flushPendingRecord: () => {},
    history: () => history,
    applyProjection: (authoritative) => { projections.push(structuredClone(authoritative)); },
    snapshot: (authoritative) => ({ components: authoritative.components, wires: authoritative.wires, kicadComponents: authoritative.kicadComponents!, netLabels: authoritative.netLabels!, ...(authoritative.sheets !== undefined ? { sheets: authoritative.sheets } : {}) }),
    historyRecorded: () => {},
    suppressEffectRecord: () => { suppressed += 1; },
    scheduleAutosave: () => { autosaves += 1; },
  }, label, state);
  return { history, projections, snapshots, adopt, suppressed: () => suppressed, autosaves: () => autosaves };
}

describe("[PR-J3] canonical adoption carries the sheet tree iff present", () => {
  it("an organised result: the projection and the recorded snapshot carry the tree; the digest is the result's", () => {
    const organised = multiSheetDroneFixtureState();
    const h = host(droneFixtureState());
    const outcome = h.adopt("Moved to sheet", organised);
    expect(outcome).toEqual({ ok: true });
    expect(h.projections).toHaveLength(1);
    expect(h.projections[0]!.sheets).toEqual(organised.sheets);
    expect(schematicStateDigest(h.projections[0]!)).toBe(schematicStateDigest(organised));
    expect(h.history.present.sheets).toEqual(organised.sheets);
    expect(h.history.peekUndo()).not.toBeNull();
    expect("sheets" in h.history.peekUndo()!).toBe(false); // the opened flat drone is the undo target
    expect(h.suppressed()).toBe(1);
    expect(h.autosaves()).toBe(1);
  });

  it("a flat result: no `sheets` key anywhere, the pre-J3 digest, the four arrays owned", () => {
    const flat = droneFixtureState();
    const h = host(multiSheetDroneFixtureState());
    expect(h.adopt("Undo organise", flat)).toEqual({ ok: true });
    const projected = h.projections[0]!;
    expect("sheets" in projected).toBe(false);
    expect(Object.keys(projected).sort()).toEqual(["components", "kicadComponents", "netLabels", ...(flat.pageSize ? ["pageSize"] : []), "wires"].sort());
    expect(schematicStateDigest(projected)).toBe(schematicStateDigest(flat));
    expect("sheets" in h.history.present).toBe(false);
  });

  it("a result with absent optional arrays keeps its tree and gets owned empty arrays", () => {
    const organised = multiSheetDroneFixtureState();
    const sparse: SchematicState = { components: [], wires: [], sheets: organised.sheets };
    const h = host(droneFixtureState());
    expect(h.adopt("Sparse", sparse)).toEqual({ ok: true });
    expect(h.projections[0]).toEqual({ components: [], wires: [], kicadComponents: [], netLabels: [], sheets: organised.sheets });
  });
});
