/**
 * [PR-J3, 2026-10-22] Runbook J.3 / J.8.1 (OD-255 item 7): the gesture coordinator keeps the SHEET TREE through a gesture commit.
 *
 * `commit` rebuilds the committed state (`final`) from the gesture's base and the editor's final frame; the tree is not geometry and no
 * gesture changes it, so `final` carries the base's `sheets`. Without that, every drag on a multi-sheet project compared a flattened
 * `final` with the base: a zero-delta drag (a click, a cancelled move) looked like a change and submitted an empty transaction, and the
 * rollback / adoption projections could land without the tree.
 *
 *  1. a zero-delta gesture on the organised fixture rolls back to the exact base (tree intact) and executes NOTHING;
 *  2. a real drag on a child sheet commits through the session's operations with the tree intact on the base, the result and the
 *     projection; the transaction touches no sheet record and the other sheets' entities are byte-identical;
 *  3. the single-sheet golden: the flat drone's zero-delta rollback carries no `sheets` key and the same digest as before J3;
 *  4. `authoritativeState()` carries the tree once an approved applier notified it, even when the host's live fallback is flat
 *     (app/page.tsx's coordinator host rebuilds its fallback from React arrays that never hold the tree: hydration notifies first).
 * The PRODUCTION coordinator against a host that applies operations with the executor's own code; no network.
 */
import { describe, expect, it } from "vitest";
import { applySchematicOperationsToCanonical } from "@/app/lib/engineering/operations";
import { SchematicGestureCoordinator, type GestureCoordinatorHost } from "@/app/lib/engineering/schematic-gesture-coordinator";
import { graphAfterOf } from "@/app/lib/engineering/schematic-graph";
import { fromCanonicalSchematic, schematicStateDigest, toCanonicalSchematic } from "@/app/lib/engineering/schematic-model";
import type { EngineeringOperation } from "@/app/lib/engineering/types";
import { droneFixtureState } from "@/app/lib/schematic/__tests__/_j1-fixtures";
import { multiSheetDroneFixtureState } from "@/app/lib/schematic/__tests__/_j3-fixtures";
import type { SchematicState } from "@/lib/schematic-types";

type Executed = { base: SchematicState; operations: EngineeringOperation[] };
type Applied = { kind: "canonical" | "rollback"; state: SchematicState };

/** The page's host shape (app/page.tsx): the live fallback, the appliers, and a session that applies the operations for real. */
function makeHost(initial: SchematicState, liveFallback?: SchematicState) {
  let current = structuredClone(initial);
  const applied: Applied[] = [];
  const executed: Executed[] = [];
  const host: GestureCoordinatorHost = {
    currentState: () => structuredClone(liveFallback ?? current),
    applyPreviewFrame: () => {},
    applyCanonicalProjection: (_label, state) => { current = structuredClone(state); applied.push({ kind: "canonical", state: structuredClone(state) }); coordinator.notifyAuthoritativeProjection(state); },
    applyRollbackProjection: (state) => { current = structuredClone(state); applied.push({ kind: "rollback", state: structuredClone(state) }); coordinator.notifyAuthoritativeProjection(state); },
    execute: async (base, request) => {
      const canonical = toCanonicalSchematic(base);
      const operations = request.buildOperations(canonical);
      executed.push({ base: structuredClone(base), operations });
      if (operations.length === 0) return { ok: true, status: "noop", state: structuredClone(base), label: request.label };
      const result = applySchematicOperationsToCanonical(canonical, operations);
      return { ok: true, status: "executed", state: fromCanonicalSchematic(result.schematic), label: request.label };
    },
    notify: () => undefined,
  };
  const coordinator = new SchematicGestureCoordinator(host);
  return { coordinator, applied, executed, current: () => structuredClone(current) };
}

/** The commit is a FIFO queue job awaiting the host's execute: let the microtasks and one macrotask settle. */
async function settled(): Promise<void> {
  for (let tick = 0; tick < 4; tick += 1) await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe("[PR-J3] the gesture coordinator and the sheet tree", () => {
  it("1. a zero-delta gesture on the organised fixture rolls back to the exact base and executes nothing", async () => {
    const base = multiSheetDroneFixtureState();
    const h = makeHost(base);
    expect(h.coordinator.begin()).toBe(true);
    await h.coordinator.commit("Moved components", graphAfterOf(base));
    await settled();
    expect(h.executed).toEqual([]);
    expect(h.applied.map((entry) => entry.kind)).toEqual(["rollback"]);
    expect(h.applied[0]!.state).toEqual(base);
    expect(h.applied[0]!.state.sheets).toEqual(base.sheets);
    expect(schematicStateDigest(h.current())).toBe(schematicStateDigest(base));
    expect(h.coordinator.authoritativeState().sheets).toEqual(base.sheets);
  });

  it("2. a real drag on a child sheet commits with the tree intact; no sheet record is touched; the other sheets are byte-identical", async () => {
    const base = multiSheetDroneFixtureState();
    const u3 = base.kicadComponents!.find((item) => item.refDes === "U3")!;
    expect(u3.sheetId).toBe("sheet-imu");
    const frame = { ...base, kicadComponents: base.kicadComponents!.map((item) => (item.id === u3.id ? { ...item, x: item.x + 20 } : item)) };
    const h = makeHost(base);
    expect(h.coordinator.begin()).toBe(true);
    await h.coordinator.commit("Moved U3", graphAfterOf(frame));
    await settled();
    expect(h.executed).toHaveLength(1);
    const [{ base: executedBase, operations }] = h.executed as [Executed];
    expect(executedBase.sheets).toEqual(base.sheets); // the session's base carries the tree
    expect(operations.length).toBeGreaterThan(0);
    for (const operation of operations) expect(operation.kind, operation.kind).not.toMatch(/sheet|net_label|scope|port/);
    expect(h.applied.map((entry) => entry.kind)).toEqual(["canonical"]);
    const committed = h.applied[0]!.state;
    expect(committed.sheets).toEqual(base.sheets);
    const movedU3 = committed.kicadComponents!.find((item) => item.id === u3.id)!;
    expect(movedU3).toEqual({ ...u3, x: u3.x + 20 });
    const others = (state: SchematicState) => ({
      components: state.components,
      wires: state.wires,
      kicadComponents: state.kicadComponents!.filter((item) => item.id !== u3.id),
      netLabels: state.netLabels,
    });
    expect(others(committed)).toEqual(others(base));
    expect(h.coordinator.authoritativeState().sheets).toEqual(base.sheets);
    expect(schematicStateDigest(h.coordinator.authoritativeState())).toBe(schematicStateDigest(committed));
  });

  it("3. the single-sheet golden: the flat drone's zero-delta rollback has no `sheets` key and the same digest", async () => {
    const base = droneFixtureState();
    const h = makeHost(base);
    expect(h.coordinator.begin()).toBe(true);
    await h.coordinator.commit("Moved components", graphAfterOf(base));
    await settled();
    expect(h.executed).toEqual([]);
    expect(h.applied.map((entry) => entry.kind)).toEqual(["rollback"]);
    expect("sheets" in h.applied[0]!.state).toBe(false);
    expect(schematicStateDigest(h.applied[0]!.state)).toBe(schematicStateDigest(base));
  });

  it("4. authoritativeState() carries the tree once notified, even when the host's live fallback is flat", () => {
    const organised = multiSheetDroneFixtureState();
    const flatFallback: SchematicState = { components: [], wires: [], kicadComponents: [], netLabels: [] };
    const h = makeHost(organised, flatFallback);
    // before any approved applier notified: the live fallback (app/page.tsx:3738's shape, which never holds the tree)
    expect("sheets" in h.coordinator.authoritativeState()).toBe(false);
    h.coordinator.notifyAuthoritativeProjection(organised); // hydration's applyLifecycleSchematicProjection notifies first
    const authoritative = h.coordinator.authoritativeState();
    expect(authoritative.sheets).toEqual(organised.sheets);
    expect(schematicStateDigest(authoritative)).toBe(schematicStateDigest(organised));
    // a clone: the caller cannot mutate the recorded state
    authoritative.sheets!.sheets.pop();
    expect(h.coordinator.authoritativeState().sheets).toEqual(organised.sheets);
  });
});
