/**
 * B07 — deterministic schematic graph-diff compiler.
 *
 * Pure translation of "the graph the UI computed" into canonical engineering
 * operations. Every migrated graph handler keeps its existing geometry math
 * (splits, L-bends, consolidation, drag deltas) and hands the RESULT here;
 * the diff emits the primitive operations (indexed adds, deletes, geometry
 * updates, transforms, property patches) whose sequential application
 * provably reproduces that result — verified by an internal simulation, so a
 * drifted diff throws instead of committing something else.
 *
 * Boundaries (fail closed):
 *  - Component REMOVAL is forbidden here — deletions go through the B06
 *    impact-plan path (`planSchematicDelete`) so incident cleanup is never
 *    bypassed.
 *  - Kicad identity/authority fields are forbidden here — replacement goes
 *    through the B06.1/B06.2 grant-gated path.
 *  - Theory stable ids and types are immutable; only x/y/rotation, value,
 *    and the display refDes may change.
 *
 * Junction contract (B07, pinned by tests): junctions are DERIVED from wire
 * geometry — the junction tool and wire drawing SPLIT wires at shared
 * points, and rendering derives dots from endpoint counts. No stored
 * junction entity exists, and this module introduces none.
 */

import { schDisplayRef, type KicadComponentInstance, type NetLabel, type SchComponent, type SchComponentType, type SchematicState, type Wire } from "@/lib/schematic-types";
import type { CanonicalSchematic } from "./schematic-model";
import type { EngineeringOperation } from "./types";

export interface SchematicGraphAfter {
  components?: SchComponent[];
  kicadComponents?: KicadComponentInstance[];
  wires?: Wire[];
  netLabels?: NetLabel[];
}

const sameVertices = (a: readonly { x: number; y: number }[], b: readonly { x: number; y: number }[]): boolean =>
  a.length === b.length && a.every((v, i) => v.x === b[i].x && v.y === b[i].y);

/**
 * Compile the difference between the canonical base and a computed "after"
 * graph into one atomic operation batch. Omitted arrays are unchanged.
 */
export function diffSchematicGraphOps(before: CanonicalSchematic, after: SchematicGraphAfter): EngineeringOperation[] {
  const operations: EngineeringOperation[] = [];
  let counter = 0;
  const base = { schemaVersion: 1 as const, units: "px" as const };
  const opId = (kind: string, id: string): string => `op:g${counter++}:${kind}:${id}`;

  // ── Theory components ──────────────────────────────────────────────────────
  if (after.components) {
    const beforeById = new Map(before.components.map((item) => [item.id, item]));
    for (const item of before.components) {
      if (!after.components.some((candidate) => candidate.id === item.id)) {
        throw new Error(`GRAPH_DIFF_COMPONENT_REMOVAL:${item.id}: component deletion must use the impact-plan delete path`);
      }
    }
    after.components.forEach((next, index) => {
      const prev = beforeById.get(next.id);
      if (!prev) {
        operations.push({ ...base, operationId: opId("addc", next.id), kind: "schematic_add_component", family: "theory", component: structuredClone(next), atIndex: index });
        return;
      }
      if (prev.type !== next.type) throw new Error(`GRAPH_DIFF_IMMUTABLE:${next.id}: theory component type cannot change`);
      if (prev.x !== next.x || prev.y !== next.y || prev.rotation !== next.rotation) {
        operations.push({ ...base, operationId: opId("xform", next.id), kind: "schematic_transform_component", family: "theory", componentId: next.id, x: next.x, y: next.y, rotation: next.rotation });
      }
      const refChanged = (prev.refDes ?? null) !== (next.refDes ?? null);
      if (prev.value !== next.value || refChanged) {
        operations.push({
          ...base, operationId: opId("props", next.id), kind: "schematic_set_component_properties", family: "theory", componentId: next.id,
          patch: { ...(prev.value !== next.value ? { value: next.value } : {}), ...(refChanged ? { refDes: next.refDes ?? null } : {}) },
        });
      }
    });
  }

  // ── KiCad components (position/rotation/value/refDes only) ─────────────────
  if (after.kicadComponents) {
    const beforeById = new Map(before.kicadComponents.map((item) => [item.id, item]));
    for (const item of before.kicadComponents) {
      if (!after.kicadComponents.some((candidate) => candidate.id === item.id)) {
        throw new Error(`GRAPH_DIFF_COMPONENT_REMOVAL:${item.id}: component deletion must use the impact-plan delete path`);
      }
    }
    after.kicadComponents.forEach((next, index) => {
      const prev = beforeById.get(next.id);
      if (!prev) {
        operations.push({ ...base, operationId: opId("addk", next.id), kind: "schematic_add_component", family: "kicad", component: structuredClone(next), atIndex: index });
        return;
      }
      if (prev.partId !== next.partId || prev.atomicPartRevisionId !== next.atomicPartRevisionId || prev.symbolAssetVersionId !== next.symbolAssetVersionId || prev.footprintAssetVersionId !== next.footprintAssetVersionId || prev.mappingCertificateId !== next.mappingCertificateId || prev.selectionRecordId !== next.selectionRecordId) {
        throw new Error(`GRAPH_DIFF_IMMUTABLE:${next.id}: part identity/authority changes must use the grant-gated replacement path`);
      }
      if (prev.x !== next.x || prev.y !== next.y || prev.rotation !== next.rotation) {
        operations.push({ ...base, operationId: opId("xform", next.id), kind: "schematic_transform_component", family: "kicad", componentId: next.id, x: next.x, y: next.y, rotation: next.rotation });
      }
      if (prev.value !== next.value || prev.refDes !== next.refDes) {
        operations.push({
          ...base, operationId: opId("props", next.id), kind: "schematic_set_component_properties", family: "kicad", componentId: next.id,
          patch: { ...(prev.value !== next.value ? { value: next.value } : {}), ...(prev.refDes !== next.refDes ? { refDes: next.refDes } : {}) },
        });
      }
    });
  }

  // ── Wires: deletes → geometry updates → indexed adds (ascending) ───────────
  if (after.wires) {
    const afterById = new Map(after.wires.map((item) => [item.id, item]));
    const beforeById = new Map(before.wires.map((item) => [item.id, item]));
    for (const item of before.wires) {
      if (!afterById.has(item.id)) operations.push({ ...base, operationId: opId("delw", item.id), kind: "schematic_delete_wire", wireId: item.id });
    }
    for (const item of before.wires) {
      const next = afterById.get(item.id);
      if (next && !sameVertices(item.vertices, next.vertices)) {
        operations.push({ ...base, operationId: opId("updw", item.id), kind: "schematic_update_wire_geometry", wireId: item.id, vertices: next.vertices.map((v) => ({ ...v })) });
      }
    }
    after.wires.forEach((next, index) => {
      if (!beforeById.has(next.id)) {
        operations.push({ ...base, operationId: opId("addw", next.id), kind: "schematic_add_wire", wire: structuredClone(next), atIndex: index });
      }
    });
  }

  // ── Net labels: deletes → patches (kind change = delete+add) → adds ────────
  if (after.netLabels) {
    const afterById = new Map(after.netLabels.map((item) => [item.id, item]));
    const beforeById = new Map(before.netLabels.map((item) => [item.id, item]));
    const reAdd: Array<{ label: NetLabel; index: number }> = [];
    for (const item of before.netLabels) {
      const next = afterById.get(item.id);
      if (!next) {
        operations.push({ ...base, operationId: opId("dell", item.id), kind: "schematic_delete_net_label", labelId: item.id });
      } else if (next.kind !== item.kind) {
        operations.push({ ...base, operationId: opId("dell", item.id), kind: "schematic_delete_net_label", labelId: item.id });
        reAdd.push({ label: next, index: after.netLabels.indexOf(next) });
      }
    }
    for (const item of before.netLabels) {
      const next = afterById.get(item.id);
      if (!next || next.kind !== item.kind) continue;
      const patch: { position?: { x: number; y: number }; name?: string; orientation?: 0 | 90 | 180 | 270 } = {};
      if (next.position.x !== item.position.x || next.position.y !== item.position.y) patch.position = { ...next.position };
      if (next.name !== item.name) patch.name = next.name;
      if (next.orientation !== item.orientation) patch.orientation = next.orientation;
      if (Object.keys(patch).length > 0) operations.push({ ...base, operationId: opId("updl", item.id), kind: "schematic_update_net_label", labelId: item.id, patch });
    }
    const adds = [
      ...after.netLabels.map((next, index) => (!beforeById.has(next.id) ? { label: next, index } : null)).filter((entry): entry is { label: NetLabel; index: number } => entry !== null),
      ...reAdd,
    ].sort((a, b) => a.index - b.index);
    for (const entry of adds) {
      operations.push({ ...base, operationId: opId("addl", entry.label.id), kind: "schematic_add_net_label", label: structuredClone(entry.label), atIndex: entry.index });
    }
  }

  // ── Simulation guard: applying the batch must reproduce `after` exactly ────
  if (operations.length > 0) verifyDiffReproducesAfter(before, after, operations);
  return operations;
}

/** Sequentially simulate the batch over a clone of `before` and require exact
 *  (order-included) equality with `after` for every provided array. */
function verifyDiffReproducesAfter(before: CanonicalSchematic, after: SchematicGraphAfter, operations: readonly EngineeringOperation[]): void {
  const sim = structuredClone({ components: before.components, kicadComponents: before.kicadComponents, wires: before.wires, netLabels: before.netLabels });
  for (const op of operations) {
    if (op.kind === "schematic_add_component") {
      const array = op.family === "theory" ? sim.components : sim.kicadComponents;
      array.splice(op.atIndex, 0, structuredClone(op.component) as never);
    } else if (op.kind === "schematic_transform_component") {
      const array = op.family === "theory" ? sim.components : sim.kicadComponents;
      const target = array.find((item) => item.id === op.componentId)!;
      target.x = op.x; target.y = op.y; target.rotation = op.rotation;
    } else if (op.kind === "schematic_set_component_properties") {
      const array = op.family === "theory" ? sim.components : sim.kicadComponents;
      const target = array.find((item) => item.id === op.componentId)! as SchComponent & KicadComponentInstance;
      if (op.patch.value !== undefined) target.value = op.patch.value;
      if (op.patch.refDes !== undefined) {
        if (op.patch.refDes === null) delete (target as SchComponent).refDes;
        else target.refDes = op.patch.refDes.trim();
      }
    } else if (op.kind === "schematic_add_wire") sim.wires.splice(op.atIndex, 0, structuredClone(op.wire));
    else if (op.kind === "schematic_delete_wire") sim.wires.splice(sim.wires.findIndex((item) => item.id === op.wireId), 1);
    else if (op.kind === "schematic_update_wire_geometry") sim.wires.find((item) => item.id === op.wireId)!.vertices = structuredClone(op.vertices);
    else if (op.kind === "schematic_add_net_label") sim.netLabels.splice(op.atIndex, 0, structuredClone(op.label) as never);
    else if (op.kind === "schematic_delete_net_label") sim.netLabels.splice(sim.netLabels.findIndex((item) => item.id === op.labelId), 1);
    else if (op.kind === "schematic_update_net_label") {
      const target = sim.netLabels.find((item) => item.id === op.labelId)!;
      if (op.patch.position !== undefined) target.position = { ...op.patch.position };
      if (op.patch.name !== undefined) target.name = op.patch.name;
      if (op.patch.orientation !== undefined) target.orientation = op.patch.orientation;
    }
  }
  const mismatch = (name: string): never => { throw new Error(`GRAPH_DIFF_ORDER:${name}: compiled operations do not reproduce the computed graph exactly`); };
  if (after.components && JSON.stringify(sim.components) !== JSON.stringify(after.components)) mismatch("components");
  if (after.kicadComponents && JSON.stringify(sim.kicadComponents) !== JSON.stringify(after.kicadComponents)) mismatch("kicadComponents");
  if (after.wires && JSON.stringify(sim.wires) !== JSON.stringify(after.wires)) mismatch("wires");
  if (after.netLabels && JSON.stringify(sim.netLabels) !== JSON.stringify(after.netLabels)) mismatch("netLabels");
}

// ─── B07 — display-reference minting for new theory components ───────────────

const THEORY_REF_PREFIX: Record<SchComponentType, string> = {
  resistor: "R", capacitor: "C", inductor: "L", diode: "D",
  "voltage-source": "V", "current-source": "I", ground: "GND",
};

/** Next free display reference ("R1", "R2", …) among theory display values. */
export function nextTheoryDisplayRef(type: SchComponentType, components: readonly SchComponent[]): string {
  const prefix = THEORY_REF_PREFIX[type];
  const taken = new Set(components.map((item) => schDisplayRef(item)));
  for (let index = 1; ; index += 1) {
    const candidate = `${prefix}${index}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Convenience view of a state as a full "after" graph. */
export function graphAfterOf(state: SchematicState): Required<SchematicGraphAfter> {
  return {
    components: state.components,
    kicadComponents: state.kicadComponents ?? [],
    wires: state.wires,
    netLabels: state.netLabels ?? [],
  };
}
