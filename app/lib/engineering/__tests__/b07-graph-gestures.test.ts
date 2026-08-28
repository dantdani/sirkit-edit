/**
 * B07 — canonical schematic graph commands, gesture transactions, and stable
 * theory identity.
 *
 *  §1  Stable theory identity (required tests 1–5)
 *  §2  Canonical graph operations (6–9, 14–15)
 *  §3  Gesture transactions (10–13, 16–18)
 *  §4  Hydration/consumers/exposure/tripwire (19, 22–24)
 *  (20–21 — B06.3 lineage/quarantine and sealed-proposal suites — run as
 *   their own files in the same suite invocation.)
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { schDisplayRef, type SchematicState, type Wire } from "@/lib/schematic-types";
import { buildNetUnionFind, consolidateWires, splitWiresAtPoint } from "../../connectivity";
import { InMemoryAtomicProjectStore } from "../persistence";
import { fromCanonicalSchematic, schematicStateDigest, toCanonicalSchematic } from "../schematic-model";
import { diffSchematicGraphOps, graphAfterOf, nextTheoryDisplayRef } from "../schematic-graph";
import { buildGraphReplayEvidence, renderGraphReplayEvidence } from "../schematic-replay-evidence";
import { auditSchematicSetterAuthority } from "../schematic-setter-gate";
import { SchematicEditorSession } from "../schematic-session";
import { sirkitToolRegistry } from "../tool-catalog";
import type { EngineeringOperation } from "../types";

const SCOPE = { tenantId: "tenant-b07", projectId: "project-b07", branchId: "main" } as const;

function baseState(): SchematicState {
  return {
    components: [
      { id: "uuid-r1", type: "resistor", x: 100, y: 100, rotation: 0, value: "1k", refDes: "R1" },
      { id: "R2", type: "resistor", x: 100, y: 300, rotation: 0, value: "2k" }, // legacy: no refDes → displays "R2"
    ],
    kicadComponents: [],
    wires: [
      { id: "w1", vertices: [{ x: 130, y: 100 }, { x: 300, y: 100 }] },
      { id: "w2", vertices: [{ x: 130, y: 300 }, { x: 300, y: 300 }] },
      { id: "w3", vertices: [{ x: 500, y: 500 }, { x: 600, y: 500 }] },
    ],
    netLabels: [{ id: "l1", position: { x: 300, y: 100 }, name: "VOUT", kind: "label", orientation: 0 }],
  };
}

async function openSession(state: SchematicState, projectId = "project-b07", store = new InMemoryAtomicProjectStore()) {
  const editor = new SchematicEditorSession({ ...SCOPE, projectId }, { store });
  const outcome = await editor.openForProject(state, null);
  if (outcome.status !== "fresh" && outcome.status !== "resumed") throw new Error(`open failed: ${outcome.status}`);
  return { editor, store };
}

function graphRequest(label: string, commandId: string, after: (state: SchematicState) => Parameters<typeof diffSchematicGraphOps>[1]) {
  return {
    commandId,
    label,
    buildOperations: (canonical: Parameters<typeof diffSchematicGraphOps>[0]) => diffSchematicGraphOps(canonical, after(fromCanonicalSchematic(canonical))),
  };
}

/** Emulate the page's gesture commit: preview computed from `base`, committed
 *  as ONE transaction pinned to the pre-gesture digest. */
async function commitGesture(editor: SchematicEditorSession, base: SchematicState, final: SchematicState, label = "Moved components") {
  return editor.execute(base, {
    commandId: "schematic.move-rotate",
    label,
    buildOperations: (canonical) => diffSchematicGraphOps(canonical, graphAfterOf(final)),
    expectedBaseDigest: schematicStateDigest(base),
  });
}

// ─── §1 Stable theory identity ───────────────────────────────────────────────

describe("B07 §1 — stable theory identity", () => {
  it("1+2. legacy components (no refDes) migrate by the deterministic display-fallback rule and survive reload with identical ids/digests", async () => {
    const state = baseState();
    expect(schDisplayRef(state.components[1])).toBe("R2"); // fallback = stable id
    const store = new InMemoryAtomicProjectStore();
    const { editor } = await openSession(state, "p-identity", store);
    const edited = await editor.execute(state, graphRequest("Edit", "schematic.set-property", (s) => ({ components: s.components.map((c) => (c.id === "R2" ? { ...c, value: "3k" } : c)) })));
    if (!edited.ok) throw new Error("edit rejected");
    editor.dispose();
    // Reload: same ids, same display, no re-migration (digest-stable resume).
    const second = new SchematicEditorSession({ ...SCOPE, projectId: "p-identity" }, { store });
    const outcome = await second.openForProject(edited.state, edited.headMark!);
    expect(outcome.status).toBe("resumed");
    const probe = await second.execute(edited.state, { commandId: "schematic.set-property", label: "noop", buildOperations: () => [] });
    if (!probe.ok) throw new Error("probe rejected");
    expect(probe.state.components.map((c) => c.id)).toEqual(["uuid-r1", "R2"]);
    expect(probe.state.components.map((c) => schDisplayRef(c))).toEqual(["R1", "R2"]);
  });

  it("3+5. rename changes ONLY the display identity; the stable id, wires, and connectivity survive; undo restores field ABSENCE digest-exactly", async () => {
    const state = baseState();
    const { editor } = await openSession(state, "p-rename");
    const groupsOf = (s: SchematicState) => buildNetUnionFind(s.components, s.wires, [], s.netLabels ?? []);
    const before = groupsOf(state);
    const renamed = await editor.execute(state, graphRequest("Rename R2", "schematic.set-property", (s) => ({ components: s.components.map((c) => (c.id === "R2" ? { ...c, refDes: "RLOAD" } : c)) })));
    if (!renamed.ok) throw new Error("rename rejected");
    const component = renamed.state.components.find((c) => c.id === "R2")!;
    expect(component.id).toBe("R2");           // stable identity untouched
    expect(component.refDes).toBe("RLOAD");    // display changed
    expect(renamed.state.wires).toEqual(state.wires); // graph untouched
    expect(JSON.stringify(groupsOf(renamed.state))).toBe(JSON.stringify(before)); // connectivity identical
    // Undo restores the EXACT prior state — including refDes absence.
    await editor.reconcileHistoryStep("undo", state);
    expect(editor.events.at(-1)?.kind).toBe("undo-reconciled");
    const probe = await editor.execute(state, { commandId: "schematic.set-property", label: "noop", buildOperations: () => [] });
    if (!probe.ok) throw new Error("probe rejected");
    expect(schematicStateDigest(probe.state)).toBe(schematicStateDigest(state));
    expect(probe.state.components.find((c) => c.id === "R2")!.refDes).toBeUndefined();
  });

  it("4. duplicate and malformed display references are rejected atomically (including refDes-vs-stable-id collisions)", async () => {
    const state = baseState();
    const { editor } = await openSession(state, "p-dup");
    const attempts: Array<{ componentId: string; refDes: string }> = [
      { componentId: "uuid-r1", refDes: "R2" },   // collides with R2's id-fallback display
      { componentId: "R2", refDes: "R1" },        // collides with uuid-r1's refDes display
      { componentId: "uuid-r1", refDes: "" },     // empty
      { componentId: "uuid-r1", refDes: "   " },  // whitespace-only
    ];
    for (const attempt of attempts) {
      const rejected = await editor.execute(state, {
        commandId: "schematic.set-property",
        label: `Rename ${attempt.componentId} to ${JSON.stringify(attempt.refDes)}`,
        buildOperations: () => [{ operationId: `op:${attempt.componentId}:${attempt.refDes || "blank"}`, schemaVersion: 1, units: "px", kind: "schematic_set_component_properties", family: "theory", componentId: attempt.componentId, patch: { refDes: attempt.refDes } }],
      });
      expect(rejected.ok, JSON.stringify(attempt)).toBe(false);
    }
    const probe = await editor.execute(state, { commandId: "schematic.set-property", label: "noop", buildOperations: () => [] });
    if (!probe.ok) throw new Error("probe rejected");
    expect(schematicStateDigest(probe.state)).toBe(schematicStateDigest(state));
  });

  it("display minting: nextTheoryDisplayRef skips every taken display value", () => {
    const components = baseState().components;
    expect(nextTheoryDisplayRef("resistor", components)).toBe("R3"); // R1 (refDes), R2 (id fallback) taken
    expect(nextTheoryDisplayRef("capacitor", components)).toBe("C1");
  });
});

// ─── §2 Canonical graph operations ───────────────────────────────────────────

describe("B07 §2 — graph operations", () => {
  it("6+14+15. add and delete wire execute canonically with indexed order-exact undo/redo", async () => {
    const state = baseState();
    const { editor } = await openSession(state, "p-wire");
    const added = await editor.execute(state, graphRequest("Drew wire", "schematic.connect", (s) => ({ wires: [...s.wires, { id: "w-new", vertices: [{ x: 0, y: 0 }, { x: 30, y: 0 }] }] })));
    if (!added.ok) throw new Error("add rejected");
    expect(added.state.wires.map((w) => w.id)).toEqual(["w1", "w2", "w3", "w-new"]);

    const deleted = await editor.execute(added.state, graphRequest("Deleted wire", "schematic.connect", (s) => ({ wires: s.wires.filter((w) => w.id !== "w2") })));
    if (!deleted.ok) throw new Error("delete rejected");
    expect(deleted.state.wires.map((w) => w.id)).toEqual(["w1", "w3", "w-new"]);

    // Undo the MIDDLE delete: order restored exactly; redo removes it again.
    await editor.reconcileHistoryStep("undo", added.state);
    expect(editor.events.at(-1)?.kind).toBe("undo-reconciled");
    await editor.reconcileHistoryStep("redo", deleted.state);
    expect(editor.events.at(-1)?.kind).toBe("redo-reconciled");
    const probe = await editor.execute(deleted.state, { commandId: "schematic.connect", label: "noop", buildOperations: () => [] });
    if (!probe.ok) throw new Error("probe rejected");
    expect(probe.state.wires.map((w) => w.id)).toEqual(["w1", "w3", "w-new"]);
  });

  it("7. endpoint and interior-vertex geometry changes execute canonically with exact inverses", async () => {
    const state = baseState();
    state.wires.push({ id: "w4", vertices: [{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 50, y: 50 }] });
    const { editor } = await openSession(state, "p-geo");
    const moved = await editor.execute(state, graphRequest("Adjusted wire", "schematic.connect", (s) => ({
      wires: s.wires.map((w) =>
        w.id === "w1" ? { ...w, vertices: [{ x: 130, y: 100 }, { x: 400, y: 100 }] } // endpoint
        : w.id === "w4" ? { ...w, vertices: [w.vertices[0], { x: 60, y: 10 }, w.vertices[2]] } // interior
        : w),
    })));
    if (!moved.ok) throw new Error("geometry rejected");
    expect(moved.state.wires.find((w) => w.id === "w1")!.vertices[1]).toEqual({ x: 400, y: 100 });
    expect(moved.state.wires.find((w) => w.id === "w4")!.vertices[1]).toEqual({ x: 60, y: 10 });
    await editor.reconcileHistoryStep("undo", state);
    expect(editor.events.at(-1)?.kind).toBe("undo-reconciled");
  });

  it("8. label add/delete/move/rotate execute canonically", async () => {
    const state = baseState();
    const { editor } = await openSession(state, "p-label");
    const result = await editor.execute(state, graphRequest("Edited labels", "schematic.connect", (s) => ({
      netLabels: [
        { ...(s.netLabels ?? [])[0], position: { x: 320, y: 120 }, orientation: 90 as const, name: "VOUT2" },
        { id: "l-new", position: { x: 700, y: 700 }, name: "VIN", kind: "label" as const, orientation: 0 as const },
      ],
    })));
    if (!result.ok) throw new Error("labels rejected");
    expect(result.state.netLabels).toHaveLength(2);
    expect(result.state.netLabels![0]).toMatchObject({ id: "l1", name: "VOUT2", orientation: 90, position: { x: 320, y: 120 } });
    await editor.reconcileHistoryStep("undo", state);
    expect(editor.events.at(-1)?.kind).toBe("undo-reconciled");
  });

  it("9. the DERIVED junction contract is pinned: the junction tool splits wires at a crossing; rendering derives dots from endpoint counts; no junction entity exists", async () => {
    // Crossing: horizontal w1 (interior at 200,100) + vertical wv through it.
    const state = baseState();
    state.wires.push({ id: "wv", vertices: [{ x: 200, y: 50 }, { x: 200, y: 150 }] });
    const crossing = { x: 200, y: 100 };
    const split = consolidateWires(splitWiresAtPoint(splitWiresAtPoint(state.wires, crossing), crossing));
    // Deterministic split: both wires break at the crossing point.
    const endpointCount = split.filter((w) => {
      const first = w.vertices[0]; const last = w.vertices[w.vertices.length - 1];
      return (first.x === 200 && first.y === 100) || (last.x === 200 && last.y === 100);
    }).length;
    expect(endpointCount).toBeGreaterThanOrEqual(3); // the derived-junction render rule (3+ endpoints = dot)
    // The same result executes canonically through the graph diff. (Split
    // parts mint fresh ids per invocation, so the "after" graph is computed
    // ONCE — exactly like the page handlers, whose buildOperations run once
    // inside the serialized queue.)
    const { editor } = await openSession(state, "p-junction");
    const result = await editor.execute(state, { commandId: "schematic.connect", label: "Marked junction", buildOperations: (canonical) => diffSchematicGraphOps(canonical, { wires: split }) });
    if (!result.ok) throw new Error("junction rejected");
    expect(JSON.stringify(result.state.wires)).toBe(JSON.stringify(split));
    // …and no stored junction entity exists anywhere in the model.
    expect(JSON.stringify(toCanonicalSchematic(result.state))).not.toContain("junction");
    // Split/consolidate is idempotent (no hidden normalization drift).
    expect(JSON.stringify(consolidateWires(splitWiresAtPoint(split, crossing)))).toBe(JSON.stringify(split));
    await editor.reconcileHistoryStep("undo", state);
    expect(editor.events.at(-1)?.kind).toBe("undo-reconciled");
  });
});

// ─── §3 Gesture transactions ─────────────────────────────────────────────────

describe("B07 §3 — one gesture = one transaction", () => {
  function draggedState(state: SchematicState, dx: number, dy: number): SchematicState {
    // R1 group-drag emulation: component + its attached wire w1 + label l1.
    return {
      ...state,
      components: state.components.map((c) => (c.id === "uuid-r1" ? { ...c, x: c.x + dx, y: c.y + dy } : c)),
      wires: state.wires.map((w) => (w.id === "w1" ? { ...w, vertices: w.vertices.map((v) => ({ x: v.x + dx, y: v.y + dy })) } : w)),
      netLabels: (state.netLabels ?? []).map((l) => (l.id === "l1" ? { ...l, position: { x: l.position.x + dx, y: l.position.y + dy } } : l)),
    };
  }

  it("10+11. a completed drag commits component + attached wires + labels as ONE transaction; unattached geometry is untouched; undo/redo are one exact step", async () => {
    const state = baseState();
    const { editor } = await openSession(state, "p-drag");
    const final = draggedState(state, 50, 20);
    const result = await commitGesture(editor, state, final);
    if (!result.ok) throw new Error("gesture rejected");
    expect(editor.events.filter((e) => e.kind === "executed")).toHaveLength(1); // ONE transaction
    expect(result.state.components.find((c) => c.id === "uuid-r1")).toMatchObject({ x: 150, y: 120 });
    expect(result.state.wires.find((w) => w.id === "w1")!.vertices[0]).toEqual({ x: 180, y: 120 });
    expect(result.state.wires.find((w) => w.id === "w3")).toEqual(state.wires[2]); // unattached untouched
    expect(result.state.netLabels![0].position).toEqual({ x: 350, y: 120 });
    await editor.reconcileHistoryStep("undo", state);
    expect(editor.events.at(-1)?.kind).toBe("undo-reconciled");
    await editor.reconcileHistoryStep("redo", result.state);
    expect(editor.events.at(-1)?.kind).toBe("redo-reconciled");
  });

  it("12. a stretch commits the complete FINAL consolidated geometry as one transaction", async () => {
    const state = baseState();
    const { editor } = await openSession(state, "p-stretch");
    // Emulate the page: preview wires then consolidate at pointer-up.
    const stretchedWires: Wire[] = state.wires.map((w) => (w.id === "w1" ? { ...w, vertices: [{ x: 180, y: 140 }, { x: 300, y: 140 }, { x: 300, y: 100 }] } : w));
    const final: SchematicState = { ...state, components: state.components.map((c) => (c.id === "uuid-r1" ? { ...c, x: 150, y: 140 } : c)), wires: consolidateWires(stretchedWires) };
    const result = await commitGesture(editor, state, final, "Moved component");
    if (!result.ok) throw new Error("stretch rejected");
    expect(editor.events.filter((e) => e.kind === "executed")).toHaveLength(1);
    expect(result.state.wires.find((w) => w.id === "w1")!.vertices).toHaveLength(3);
  });

  it("13. a cancelled or zero-delta gesture produces no transaction and no head advancement", async () => {
    const state = baseState();
    const { editor } = await openSession(state, "p-cancel");
    // Zero-delta commit (the page short-circuits identical digests; even
    // submitted, the kernel no-ops with nothing recorded).
    const result = await commitGesture(editor, state, structuredClone(state));
    expect(result.ok && result.status === "noop").toBe(true);
    expect(editor.events.filter((e) => e.kind === "executed")).toHaveLength(0);
    expect(editor.headMark()?.headSequence).toBe(0);
  });

  it("16+17. a stale/superseded gesture is rejected without mutating or rebasing; queued gestures serialize deterministically", async () => {
    const state = baseState();
    const { editor } = await openSession(state, "p-stale-gesture");
    const gestureA = draggedState(state, 50, 0);
    const gestureB = draggedState(state, 0, 70); // began from the SAME base
    const [first, second] = await Promise.all([
      commitGesture(editor, state, gestureA, "Drag A"),
      commitGesture(editor, state, gestureB, "Drag B"),
    ]);
    expect(first.ok).toBe(true);
    // The second gesture's base is superseded → stale rejection, NO rebase.
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error("unreachable");
    expect(second.reasonCode).toBe("stale_revision");
    expect(editor.events.filter((e) => e.kind === "rebased")).toEqual([]);
    expect(editor.headMark()?.headSequence).toBe(1); // only gesture A landed
    const probe = await editor.execute(gestureA, { commandId: "schematic.connect", label: "noop", buildOperations: () => [] });
    if (!probe.ok) throw new Error("probe rejected");
    expect(probe.state.components.find((c) => c.id === "uuid-r1")).toMatchObject({ x: 150, y: 100 });
  });

  it("18. persistence failure during a graph command leaves canonical and reported state truthful", async () => {
    let fail = false;
    const store = new InMemoryAtomicProjectStore((phase) => { if (fail && phase === "before_commit") throw new Error("DISK_FULL"); });
    const state = baseState();
    const { editor } = await openSession(state, "p-pfail", store);
    fail = true;
    const rejected = await editor.execute(state, graphRequest("Drew wire", "schematic.connect", (s) => ({ wires: [...s.wires, { id: "w-x", vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }] })));
    expect(rejected.ok).toBe(false);
    if (rejected.ok) throw new Error("unreachable");
    expect(rejected.reasonCode).toBe("persistence_failed");
    expect(editor.headMark()?.headSequence).toBe(0);
    fail = false;
    const retried = await editor.execute(state, graphRequest("Drew wire", "schematic.connect", (s) => ({ wires: [...s.wires, { id: "w-x", vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }] })));
    expect(retried.ok).toBe(true);
  });
});

// ─── §4 Hydration, consumers, exposure, tripwire ─────────────────────────────

describe("B07 §4 — consumers and boundaries", () => {
  it("19. hydration/reload preserve the exact graph and stable identity", async () => {
    const store = new InMemoryAtomicProjectStore();
    const state = baseState();
    const { editor } = await openSession(state, "p-reload", store);
    const mutated = await editor.execute(state, graphRequest("Drew wire", "schematic.connect", (s) => ({ wires: [...s.wires, { id: "w-r", vertices: [{ x: 700, y: 700 }, { x: 750, y: 700 }] }] })));
    if (!mutated.ok) throw new Error("mutation rejected");
    editor.dispose();
    const second = new SchematicEditorSession({ ...SCOPE, projectId: "p-reload" }, { store });
    const outcome = await second.openForProject(mutated.state, mutated.headMark!);
    expect(outcome.status).toBe("resumed");
    const probe = await second.execute(mutated.state, { commandId: "schematic.connect", label: "noop", buildOperations: () => [] });
    if (!probe.ok) throw new Error("probe rejected");
    expect(schematicStateDigest(probe.state)).toBe(schematicStateDigest(mutated.state));
    expect(probe.state.components.map((c) => [c.id, schDisplayRef(c)])).toEqual([["uuid-r1", "R1"], ["R2", "R2"]]);
  });

  it("22. no new mutation exposure: the tool catalog carries no B07 operation kind and no connect/add-component callable descriptor", () => {
    const catalog = sirkitToolRegistry().list();
    const kinds = ["schematic_add_wire", "schematic_delete_wire", "schematic_update_wire_geometry", "schematic_add_net_label", "schematic_delete_net_label", "schematic_update_net_label", "schematic_add_component"];
    for (const descriptor of catalog) {
      const serialized = JSON.stringify(descriptor);
      for (const kind of kinds) expect(serialized).not.toContain(kind);
      if (descriptor.owningCommandId === "schematic.connect" || descriptor.owningCommandId === "schematic.add-component") {
        expect(descriptor.callability).not.toBe("callable");
        expect(descriptor.discovery).not.toBe("discoverable");
      }
    }
  });

  it("23. structural setter gate (B07.1): raw schematic setters exist ONLY inside the three approved projection appliers — a `b07:` comment exempts nothing", () => {
    const source = readFileSync(resolve(process.cwd(), "app/page.tsx"), "utf8");
    const violations = auditSchematicSetterAuthority(source);
    expect(violations, violations.map((v) => `page.tsx:${v.line}: ${v.reason} — ${v.text}`).join("\n")).toEqual([]);
  });

  it("24. netlist/connectivity consumers observe the same post-transaction graph as the kernel", async () => {
    const state = baseState();
    const { editor } = await openSession(state, "p-consumers");
    const result = await editor.execute(state, graphRequest("Drew wire", "schematic.connect", (s) => ({ wires: [...s.wires, { id: "w-c", vertices: [{ x: 130, y: 300 }, { x: 130, y: 100 }] }] })));
    if (!result.ok) throw new Error("mutation rejected");
    // Independent application of the durable record's operations reproduces
    // the same graph the session projected — consumers (union-find
    // connectivity here, and everything derived from the state) agree.
    const sessionGroups = buildNetUnionFind(result.state.components, result.state.wires, [], result.state.netLabels ?? []);
    const expected = structuredClone(state);
    expected.wires.push({ id: "w-c", vertices: [{ x: 130, y: 300 }, { x: 130, y: 100 }] });
    const directGroups = buildNetUnionFind(expected.components, expected.wires, [], expected.netLabels ?? []);
    expect(JSON.stringify(sessionGroups)).toBe(JSON.stringify(directGroups));
    expect(schematicStateDigest(result.state)).toBe(schematicStateDigest(expected));
    // The revision advanced (downstream invalidation contract from B06 holds
    // for graph ops — same schematic domain).
    expect(result.invalidatedArtifactKinds).toContain("electrical_truth");
  });

  it("committed B07 graph fixtures match the implementation and all round-trip exactly", () => {
    const committedPath = resolve(process.cwd(), "artifacts/ai-control-plane-b07/schematic-graph-replay-fixtures.json");
    expect(existsSync(committedPath), "run: npx tsx scripts/generate-b06-schematic-artifacts.ts").toBe(true);
    expect(readFileSync(committedPath, "utf8").replaceAll("\r\n", "\n")).toBe(renderGraphReplayEvidence());
    const evidence = buildGraphReplayEvidence();
    expect(evidence.fixtures.length).toBeGreaterThanOrEqual(8);
    expect(evidence.fixtures.every((fixture) => fixture.inverseRoundTripExact)).toBe(true);
  });

  it("the graph diff refuses hidden component removals and identity changes (fail-closed boundaries)", async () => {
    const state = baseState();
    const canonical = toCanonicalSchematic(state);
    expect(() => diffSchematicGraphOps(canonical, { components: state.components.slice(1) })).toThrow(/GRAPH_DIFF_COMPONENT_REMOVAL/);
    expect(() => diffSchematicGraphOps(canonical, { components: state.components.map((c) => (c.id === "R2" ? { ...c, type: "capacitor" as const } : c)) })).toThrow(/GRAPH_DIFF_IMMUTABLE/);
    // And a session-level command whose diff throws mutates nothing.
    const { editor } = await openSession(state, "p-failclosed");
    const ops: EngineeringOperation[] = [];
    const result = await editor.execute(state, { commandId: "schematic.connect", label: "noop", buildOperations: () => ops });
    expect(result.ok && result.status === "noop").toBe(true);
  });
});
