/**
 * B07.1 — identity integrity, display-consumer consistency, geometry
 * validation, gesture race closure, and the structural setter gate.
 *
 *  §A  Canonical identity integrity (hydration + every transaction)
 *  §B  Display-reference authority across consumers (netlist / pcb-sync /
 *      SPICE / export)
 *  §C  Schematic geometry contract at the canonical command boundary
 *  §D  Gesture coordinator race rules (deferred-promise scenarios 1–9)
 *  §E  Structural direct-setter gate (forged-comment/add/revert proof)
 *  §G  Tool/provider mutation-boundary regression
 *
 * Every independently reproduced B07 acceptance failure is pinned here as a
 * named regression fixture (see artifacts/ai-control-plane-b07-1/).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { refDesKey, schDisplayRef, type SchematicState } from "@/lib/schematic-types";
import { buildNetlist, buildPcbSyncPublicationGraph } from "../../pcb/netlist-bridge";
import { compileCanonicalIr } from "../../spice/ir";
import { createSimulationProject } from "../../spice/project";
import { createEmptyBoard } from "../../pcb/types";
import { applyEngineeringOperations } from "../operations";
import { computeProjectRevision } from "../revision";
import { createPersistenceEnvelope, InMemoryAtomicProjectStore } from "../persistence";
import { diffSchematicGraphOps, graphAfterOf, type SchematicGraphAfter } from "../schematic-graph";
import { SchematicGestureCoordinator, type GestureCoordinatorHost } from "../schematic-gesture-coordinator";
import { schematicStateDigest, toCanonicalSchematic, validateCanonicalSchematic } from "../schematic-model";
import { SchematicEditorSession, type SchematicCommandResult } from "../schematic-session";
import { auditSchematicSetterAuthority } from "../schematic-setter-gate";
import { sirkitToolRegistry } from "../tool-catalog";
import { ACTION_COVERAGE_REGISTRY } from "../action-registry";
import type { CanonicalProjectState, EngineeringOperation } from "../types";

const SCOPE = { tenantId: "tenant-b071", projectId: "project-b071", branchId: "main" } as const;

function baseState(): SchematicState {
  return {
    components: [
      { id: "uuid-r1", type: "resistor", x: 100, y: 100, rotation: 0, value: "1k", refDes: "R1" },
      { id: "R2", type: "resistor", x: 100, y: 300, rotation: 0, value: "2k" }, // legacy: display falls back to id
    ],
    kicadComponents: [],
    wires: [
      { id: "w1", vertices: [{ x: 130, y: 100 }, { x: 300, y: 100 }] },
    ],
    netLabels: [{ id: "l1", position: { x: 300, y: 100 }, name: "VOUT", kind: "label", orientation: 0 }],
  };
}

async function openSession(state: SchematicState, projectId: string, store = new InMemoryAtomicProjectStore()) {
  const editor = new SchematicEditorSession({ ...SCOPE, projectId }, { store });
  const outcome = await editor.openForProject(state, null);
  if (outcome.status !== "fresh" && outcome.status !== "resumed") throw new Error(`open failed: ${outcome.status}`);
  return { editor, store };
}

function projectStateOf(state: SchematicState): CanonicalProjectState {
  return {
    schemaVersion: "sirkit.engineering.v1",
    ...SCOPE,
    pcb: createEmptyBoard(),
    schematic: toCanonicalSchematic(state),
    pinnedAssets: [],
  };
}

const op = (partial: Record<string, unknown>): EngineeringOperation =>
  ({ schemaVersion: 1, units: "px", ...partial }) as unknown as EngineeringOperation;

// ─── §A Canonical identity integrity ─────────────────────────────────────────

describe("B07.1 §A — identity integrity", () => {
  it("A1 (repro 2, fixture 2): duplicate theory stable ids must NOT hydrate as fresh/ready; nothing is written", async () => {
    const state = baseState();
    state.components.push({ id: "dup", type: "resistor", x: 200, y: 200, rotation: 0, value: "1k", refDes: "RA" });
    state.components.push({ id: "dup", type: "resistor", x: 200, y: 400, rotation: 0, value: "9k", refDes: "RB" });
    const store = new InMemoryAtomicProjectStore();
    const editor = new SchematicEditorSession({ ...SCOPE, projectId: "a1" }, { store });
    const outcome = await editor.openForProject(state, null);
    expect(outcome.status).toBe("invalid-projection");
    if (outcome.status !== "invalid-projection") throw new Error("unreachable");
    expect(outcome.issues.some((issue) => issue.includes("duplicate stable id dup"))).toBe(true);
    expect(editor.lifecycle).toBe("conflicted");
    // Nothing was persisted for this project.
    expect(await store.load("a1", "main")).toBeNull();
    // And no mutation can run.
    const rejected = await editor.execute(state, { commandId: "schematic.set-property", label: "edit", buildOperations: () => [] });
    expect(rejected.ok).toBe(false);
    if (rejected.ok) throw new Error("unreachable");
    expect(rejected.reasonCode).toBe("session_conflicted");
  });

  it("A2 (fixture 3): an ambiguous componentId 'dup' rename mutates NEITHER component (never first-match)", () => {
    const state = baseState();
    state.components.push({ id: "dup", type: "resistor", x: 200, y: 200, rotation: 0, value: "1k", refDes: "RA" });
    state.components.push({ id: "dup", type: "resistor", x: 200, y: 400, rotation: 0, value: "9k", refDes: "RB" });
    const project = projectStateOf(state);
    expect(() => applyEngineeringOperations(project, [
      op({ operationId: "op:rename-dup", kind: "schematic_set_component_properties", family: "theory", componentId: "dup", patch: { refDes: "RENAMED" } }),
    ])).toThrow(/SCHEMATIC_MODEL_UNAVAILABLE/);
    // The source project is untouched (operations apply to a clone).
    const schematic = project.schematic as { components: Array<{ refDes?: string }> };
    expect(schematic.components.map((c) => c.refDes)).toEqual(["R1", undefined, "RA", "RB"]);
  });

  it("A3: duplicate ids WITHIN kicad and ACROSS theory/kicad families are named by the validator", () => {
    const cross = baseState();
    cross.kicadComponents = [
      { id: "uuid-r1", partId: "p1", x: 200, y: 200, rotation: 0, refDes: "U1", value: "IC" },
    ];
    const crossIssues = validateCanonicalSchematic(toCanonicalSchematic(cross));
    expect(crossIssues.some((issue) => issue.includes("duplicate stable id uuid-r1"))).toBe(true);

    const withinKicad = baseState();
    withinKicad.kicadComponents = [
      { id: "k1", partId: "p1", x: 200, y: 200, rotation: 0, refDes: "U1", value: "IC" },
      { id: "k1", partId: "p1", x: 400, y: 200, rotation: 0, refDes: "U2", value: "IC" },
    ];
    const withinIssues = validateCanonicalSchematic(toCanonicalSchematic(withinKicad));
    expect(withinIssues.some((issue) => issue.includes("duplicate stable id k1"))).toBe(true);

    const wires = baseState();
    wires.wires.push({ id: "w1", vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }] });
    expect(validateCanonicalSchematic(toCanonicalSchematic(wires)).some((issue) => issue.includes("duplicate wire id w1"))).toBe(true);

    const labels = baseState();
    labels.netLabels!.push({ id: "l1", position: { x: 0, y: 0 }, name: "X", kind: "label", orientation: 0 });
    expect(validateCanonicalSchematic(toCanonicalSchematic(labels)).some((issue) => issue.includes("duplicate net-label id l1"))).toBe(true);
  });

  it("A4: a duplicate introduced by restore/replay rejects atomically (ID_REUSE), and no UI command may even submit a restore operation", async () => {
    // Replay layer (restore is only ever kernel-minted as an inverse): a
    // restore whose entity id already exists rejects and mutates nothing.
    const project = projectStateOf(baseState());
    expect(() => applyEngineeringOperations(project, [op({
      operationId: "op:forged-restore", kind: "schematic_restore_entities",
      components: [{ at: 0, entity: { id: "R2", type: "resistor", x: 500, y: 500, rotation: 0, value: "7k" } }],
      kicadComponents: [], wires: [], netLabels: [],
    })])).toThrow(/ID_REUSE:schematic-component:R2/);
    // Command layer: NO UI command permits schematic_restore_entities at all
    // — a caller-forged restore is refused before validation even runs.
    const state = baseState();
    const { editor } = await openSession(state, "a4");
    const rejected = await editor.execute(state, {
      commandId: "schematic.delete-component",
      label: "forged restore",
      buildOperations: () => [op({
        operationId: "op:forged-restore", kind: "schematic_restore_entities",
        components: [{ at: 0, entity: { id: "R2", type: "resistor", x: 500, y: 500, rotation: 0, value: "7k" } }],
        kicadComponents: [], wires: [], netLabels: [],
      })],
    });
    expect(rejected.ok).toBe(false);
    if (rejected.ok) throw new Error("unreachable");
    expect(rejected.diagnostics.join(" ")).toContain("does not permit");
    const probe = await editor.execute(state, { commandId: "schematic.set-property", label: "noop", buildOperations: () => [] });
    if (!probe.ok) throw new Error("probe rejected");
    expect(schematicStateDigest(probe.state)).toBe(schematicStateDigest(state));
  });

  it("A5: a durable envelope holding an identity-invalid canonical schematic enters corrupt-history (no overwrite), and adopting a valid canonical head over an invalid projection is offered as an explicit conflict", async () => {
    // Envelope with duplicate stable ids — integrity-digest-valid, identity-invalid.
    const invalid = baseState();
    invalid.components.push({ id: "R2", type: "resistor", x: 500, y: 500, rotation: 0, value: "7k", refDes: "RX" });
    const store = new InMemoryAtomicProjectStore();
    const project = { ...projectStateOf(invalid), projectId: "a5" };
    await store.restore(createPersistenceEnvelope({ project, revision: computeProjectRevision(project), transactionLog: [], buildId: "b071-test" }));
    const editor = new SchematicEditorSession({ ...SCOPE, projectId: "a5" }, { store });
    const outcome = await editor.openForProject(baseState(), null);
    expect(outcome.status).toBe("corrupt-history");
    expect(editor.lifecycle).toBe("conflicted");

    // VALID envelope + INVALID projection → explicit conflict offering the
    // canonical head; keep-local is refused for the invalid projection.
    const store2 = new InMemoryAtomicProjectStore();
    const goodProject = { ...projectStateOf(baseState()), projectId: "a5b" };
    await store2.restore(createPersistenceEnvelope({ project: goodProject, revision: computeProjectRevision(goodProject), transactionLog: [], buildId: "b071-test" }));
    const editor2 = new SchematicEditorSession({ ...SCOPE, projectId: "a5b" }, { store: store2 });
    const conflicted = await editor2.openForProject(invalid, null);
    expect(conflicted.status).toBe("projection-conflict");
    if (conflicted.status !== "projection-conflict") throw new Error("unreachable");
    expect(conflicted.reason).toBe("invalid-projection-identity");
    expect(schematicStateDigest(conflicted.canonicalState)).toBe(schematicStateDigest(baseState()));
    const keepLocal = await editor2.resolveConflictKeepLocal(invalid);
    expect(keepLocal.status).toBe("invalid-projection");
    // The valid canonical envelope was never replaced.
    const stored = await store2.load("a5b", "main");
    expect(stored).not.toBeNull();
  });

  it("A6: recoverStartFresh refuses an identity-invalid replacement projection (quarantine-first recovery stays intact)", async () => {
    const invalid = baseState();
    invalid.components.push({ id: "R2", type: "resistor", x: 500, y: 500, rotation: 0, value: "7k", refDes: "RX" });
    const store = new InMemoryAtomicProjectStore();
    const editor = new SchematicEditorSession({ ...SCOPE, projectId: "a6" }, { store });
    await editor.openForProject(invalid, null); // conflicted (invalid-projection)
    const outcome = await editor.recoverStartFresh(invalid);
    expect(outcome.status).toBe("invalid-projection");
    expect(await store.load("a6", "main")).toBeNull();
  });

  it("A7: the COMPLETE post-transaction schematic is validated — a batch whose net effect is invalid rolls back atomically", () => {
    // Two individually plausible adds whose combination collides on the
    // case-normalized display key — the post-batch validator must throw.
    const project = projectStateOf(baseState());
    expect(() => applyEngineeringOperations(project, [
      op({ operationId: "op:add-a", kind: "schematic_add_component", family: "theory", component: { id: "n1", type: "resistor", x: 500, y: 500, rotation: 0, value: "1k", refDes: "RX" }, atIndex: 2 }),
      op({ operationId: "op:add-b", kind: "schematic_add_component", family: "theory", component: { id: "n2", type: "resistor", x: 600, y: 500, rotation: 0, value: "1k", refDes: "rx" }, atIndex: 3 }),
    ])).toThrow(/INVALID_PROPERTY|SCHEMATIC_INTEGRITY/);
  });

  it("A8: undo (inverse replay) of a valid history keeps validating — session undo round-trips digest-exactly", async () => {
    const state = baseState();
    const { editor } = await openSession(state, "a8");
    const renamed = await editor.execute(state, {
      commandId: "schematic.set-property", label: "Rename",
      buildOperations: (canonical) => diffSchematicGraphOps(canonical, { components: canonical.components.map((c) => (c.id === "R2" ? { ...c, refDes: "RLOAD" } : c)) }),
    });
    if (!renamed.ok) throw new Error("rename rejected");
    await editor.reconcileHistoryStep("undo", state);
    expect(editor.events.at(-1)?.kind).toBe("undo-reconciled");
    const probe = await editor.execute(state, { commandId: "schematic.set-property", label: "noop", buildOperations: () => [] });
    if (!probe.ok) throw new Error("probe rejected");
    expect(schematicStateDigest(probe.state)).toBe(schematicStateDigest(state));
  });
});

// ─── §B Display-reference authority ──────────────────────────────────────────

describe("B07.1 §B — display references across consumers", () => {
  it("B1 (repro 3, fixture 4): buildNetlist emits stable identity + DISPLAYED reference for theory components", () => {
    const state: SchematicState = {
      components: [{ id: "stable-r", type: "resistor", x: 100, y: 100, rotation: 0, value: "1k", refDes: "RSENSE" }],
      kicadComponents: [{ id: "stable-k", partId: "p1", x: 300, y: 300, rotation: 0, refDes: "R1", value: "10k" }],
      wires: [], netLabels: [],
    };
    const netlist = buildNetlist(state);
    const entries = netlist.components.map((c) => ({ id: c.id, ref: c.ref }));
    // The EXACT independent reproduction, corrected:
    expect(entries).toEqual([
      { id: "stable-r", ref: "RSENSE" },
      { id: "stable-k", ref: "R1" },
    ]);
    expect(entries.filter((c) => c.ref === "R1")).toHaveLength(1); // never two R1s
  });

  it("B2 (fixture 5): pcb-sync publication keeps identity on componentInstanceId, display on referenceDesignator, and the theory symbol id derives from the TYPE (not the rename)", () => {
    const state: SchematicState = {
      components: [{ id: "stable-r", type: "resistor", x: 100, y: 100, rotation: 0, value: "1k", refDes: "RSENSE" }],
      kicadComponents: [],
      wires: [], netLabels: [],
    };
    const graph = buildPcbSyncPublicationGraph(state);
    expect(graph.components).toHaveLength(1);
    expect(graph.components[0].componentInstanceId).toBe("stable-r");
    expect(graph.components[0].referenceDesignator).toBe("RSENSE");
    expect(graph.components[0].symbolAssetVersionId).toBe("sirkit.theory-symbol:r:v1");

    // A rename changes referenceDesignator and the componentRevision digest,
    // NOT componentInstanceId or the symbol identity.
    const renamed = structuredClone(state);
    renamed.components[0].refDes = "RSHUNT";
    const renamedGraph = buildPcbSyncPublicationGraph(renamed);
    expect(renamedGraph.components[0].componentInstanceId).toBe("stable-r");
    expect(renamedGraph.components[0].referenceDesignator).toBe("RSHUNT");
    expect(renamedGraph.components[0].symbolAssetVersionId).toBe("sirkit.theory-symbol:r:v1");
    expect(renamedGraph.components[0].componentRevision).not.toBe(graph.components[0].componentRevision);
    // Pin/net identity is untouched by the rename.
    expect(renamedGraph.components[0].pins).toEqual(graph.components[0].pins);
  });

  it("B3: pcb-sync publication fails closed on a duplicate exported reference", () => {
    const state: SchematicState = {
      components: [{ id: "t1", type: "resistor", x: 100, y: 100, rotation: 0, value: "1k", refDes: "R1" }],
      kicadComponents: [{ id: "k1", partId: "p1", x: 300, y: 300, rotation: 0, refDes: "R1", value: "10k" }],
      wires: [], netLabels: [],
    };
    expect(() => buildPcbSyncPublicationGraph(state)).toThrow(/PS_COMPONENT_IDENTITY_DUPLICATE/);
  });

  it("B4 (fixture 6): 'R1' vs 'r1' is ONE exported reference — the canonical executor rejects the normalized cross-family collision", async () => {
    const state = baseState(); // holds theory display R1
    const { editor } = await openSession(state, "b4");
    const rejected = await editor.execute(state, {
      commandId: "schematic.add-component", label: "Place part",
      buildOperations: () => [op({
        operationId: "op:add-kicad-r1", kind: "schematic_add_component", family: "kicad",
        component: { id: "k-new", partId: "p1", x: 500, y: 500, rotation: 0, refDes: "r1", value: "10k" }, atIndex: 0,
      })],
    });
    expect(rejected.ok).toBe(false);
    if (rejected.ok) throw new Error("unreachable");
    expect(rejected.diagnostics.join(" ")).toMatch(/already in use/);
    // Same for a theory rename onto a kicad refDes, case-folded.
    const withKicad = baseState();
    withKicad.kicadComponents = [{ id: "k1", partId: "p1", x: 500, y: 500, rotation: 0, refDes: "RSENSE", value: "10k" }];
    const { editor: editor2 } = await openSession(withKicad, "b4b");
    const rejected2 = await editor2.execute(withKicad, {
      commandId: "schematic.set-property", label: "Rename",
      buildOperations: () => [op({ operationId: "op:rename-cross", kind: "schematic_set_component_properties", family: "theory", componentId: "R2", patch: { refDes: "rsense" } })],
    });
    expect(rejected2.ok).toBe(false);
    expect(refDesKey("R1")).toBe(refDesKey("r1")); // the normalization authority
  });

  it("B5 (fixture 7): SPICE — rename changes device NAME/label (presentation) only; id, bindings, componentPinNodes, and SourceRef.id stay on the stable id", () => {
    const schematic: SchematicState = {
      components: [
        { id: "V1", type: "voltage-source", x: 100, y: 100, rotation: 0, value: "5V" },
        { id: "stable-r", type: "resistor", x: 200, y: 70, rotation: 0, value: "1kΩ", refDes: "R1" },
        { id: "G1", type: "ground", x: 230, y: 150, rotation: 0, value: "0" },
      ],
      wires: [
        { id: "w1", vertices: [{ x: 100, y: 70 }, { x: 170, y: 70 }] },
        { id: "w2", vertices: [{ x: 230, y: 70 }, { x: 230, y: 130 }] },
        { id: "w3", vertices: [{ x: 100, y: 130 }, { x: 230, y: 130 }] },
      ],
      netLabels: [
        { id: "label-vin", position: { x: 100, y: 70 }, name: "VIN", kind: "power", orientation: 0 },
        { id: "label-gnd", position: { x: 230, y: 130 }, name: "GND", kind: "ground", orientation: 0 },
      ],
    };
    const project = createSimulationProject(schematic, { now: "2026-08-06T00:00:00.000Z" });
    const compiled = compileCanonicalIr({ project, testId: project.tests[0].id });
    const device = compiled.ir.devices.find((d) => d.id === "stable-r")!;
    expect(device.name).toBe("R1");
    expect(device.source).toEqual({ kind: "schematic-component", id: "stable-r", label: "R1" });
    expect(Object.keys(compiled.componentPinNodes)).toContain("stable-r.left");

    // Rename applied to the design revision the test is bound to — the
    // display reference is EDITABLE state, identity is not.
    const renamedProject = structuredClone(project);
    renamedProject.designRevisions[0].schematic.components[1].refDes = "RSENSE";
    const recompiled = compileCanonicalIr({ project: renamedProject, testId: renamedProject.tests[0].id });
    const renamedDevice = recompiled.ir.devices.find((d) => d.id === "stable-r")!;
    expect(renamedDevice.name).toBe("RSENSE");                      // presentation follows
    expect(renamedDevice.source.id).toBe("stable-r");               // identity does not
    expect(renamedDevice.source.label).toBe("RSENSE");
    // Saved stable-id targets (bindings, overlays, pin nodes) still resolve.
    expect(recompiled.componentPinNodes["stable-r.left"]).toBeDefined();
    expect(recompiled.componentPinNodes["stable-r.left"]).toBe(compiled.componentPinNodes["stable-r.left"]);
  });

  it("B6: theory add-component minting stays unique against case-variant displays", () => {
    const project = projectStateOf(baseState());
    // Case-variant display of the existing R1 refuses (theory family).
    expect(() => applyEngineeringOperations(project, [
      op({ operationId: "op:add-dup-display", kind: "schematic_add_component", family: "theory", component: { id: "n1", type: "resistor", x: 500, y: 500, rotation: 0, value: "1k", refDes: "r1" }, atIndex: 2 }),
    ])).toThrow(/already in use/);
  });
});

// ─── §C Geometry contract ────────────────────────────────────────────────────

describe("B07.1 §C — canonical geometry validation", () => {
  async function expectWireRejected(vertices: Array<{ x: number; y: number }>, pattern: RegExp, projectId: string) {
    const state = baseState();
    const { editor } = await openSession(state, projectId);
    const rejected = await editor.execute(state, {
      commandId: "schematic.connect", label: "Drew wire",
      buildOperations: () => [op({ operationId: `op:add-wire-${projectId}`, kind: "schematic_add_wire", wire: { id: "w-bad", vertices }, atIndex: 0 })],
    });
    expect(rejected.ok, JSON.stringify(vertices)).toBe(false);
    if (rejected.ok) throw new Error("unreachable");
    expect(rejected.diagnostics.join(" "), JSON.stringify(vertices)).toMatch(pattern);
    // Atomic: the head is unchanged.
    const probe = await editor.execute(state, { commandId: "schematic.connect", label: "noop", buildOperations: () => [] });
    if (!probe.ok) throw new Error("probe rejected");
    expect(schematicStateDigest(probe.state)).toBe(schematicStateDigest(state));
  }

  it("C1 (repro 1, fixture 1): the off-grid wire (1,1)→(21,1) rejects atomically with a truthful INVALID_PX code and no mutation", async () => {
    await expectWireRejected([{ x: 1, y: 1 }, { x: 21, y: 1 }], /INVALID_PX.*off the 10px schematic grid/, "c1");
  });

  it("C2: NaN, ±Infinity, fractional, overflow, off-grid, and out-of-bound coordinates all reject with INVALID_PX (never INVALID_NM)", async () => {
    await expectWireRejected([{ x: NaN, y: 0 }, { x: 10, y: 0 }], /INVALID_PX.*finite/, "c2a");
    await expectWireRejected([{ x: Infinity, y: 0 }, { x: 10, y: 0 }], /INVALID_PX.*finite/, "c2b");
    await expectWireRejected([{ x: -Infinity, y: 0 }, { x: 10, y: 0 }], /INVALID_PX.*finite/, "c2c");
    await expectWireRejected([{ x: 10.5, y: 0 }, { x: 20, y: 0 }], /INVALID_PX.*(safe integer|off the)/, "c2d");
    await expectWireRejected([{ x: Number.MAX_SAFE_INTEGER + 2, y: 0 }, { x: 10, y: 0 }], /INVALID_PX.*safe integer/, "c2e");
    await expectWireRejected([{ x: 1_000_010, y: 0 }, { x: 10, y: 0 }], /INVALID_PX.*bound/, "c2f");
    await expectWireRejected([{ x: -1_000_010, y: 0 }, { x: 10, y: 0 }], /INVALID_PX.*bound/, "c2g");
  });

  it("C3: repeated adjacent vertices, zero-length wires, malformed arrays, and too-few vertices reject", async () => {
    await expectWireRejected([{ x: 10, y: 10 }, { x: 10, y: 10 }, { x: 20, y: 10 }], /adjacent duplicate vertex/, "c3a");
    await expectWireRejected([{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 10 }], /adjacent duplicate/, "c3b");
    await expectWireRejected([{ x: 10, y: 10 }], /at least two vertices/, "c3c");
    const state = baseState();
    const { editor } = await openSession(state, "c3d");
    const malformed = await editor.execute(state, {
      commandId: "schematic.connect", label: "Drew wire",
      buildOperations: () => [op({ operationId: "op:add-wire-malformed", kind: "schematic_add_wire", wire: { id: "w-bad", vertices: "nope" as never }, atIndex: 0 })],
    });
    expect(malformed.ok).toBe(false);
    // Zero-length: all vertices identical is caught by adjacent-duplicate +
    // zero-length rules at the validator level.
    const zeroIssues = validateCanonicalSchematic(toCanonicalSchematic({
      ...baseState(), wires: [{ id: "wz", vertices: [{ x: 10, y: 10 }, { x: 10, y: 10 }] }],
    }));
    expect(zeroIssues.join(" ")).toMatch(/adjacent duplicate|zero-length/);
  });

  it("C4: invalid component add/transform and label add/update reject (position, rotation, orientation)", async () => {
    const state = baseState();
    const { editor } = await openSession(state, "c4");
    const badAdd = await editor.execute(state, {
      commandId: "schematic.add-component", label: "Place",
      buildOperations: () => [op({ operationId: "op:bad-add", kind: "schematic_add_component", family: "theory", component: { id: "n1", type: "resistor", x: 15, y: 20, rotation: 0, value: "1k", refDes: "R9" }, atIndex: 0 })],
    });
    expect(badAdd.ok).toBe(false);
    const badTransform = await editor.execute(state, {
      commandId: "schematic.move-rotate", label: "Move",
      buildOperations: () => [op({ operationId: "op:bad-xform", kind: "schematic_transform_component", family: "theory", componentId: "R2", x: 100, y: 100, rotation: 45 })],
    });
    expect(badTransform.ok).toBe(false);
    const badLabel = await editor.execute(state, {
      commandId: "schematic.connect", label: "Label",
      buildOperations: () => [op({ operationId: "op:bad-label", kind: "schematic_add_net_label", label: { id: "ln", position: { x: 7, y: 10 }, name: "X", kind: "label", orientation: 0 }, atIndex: 0 })],
    });
    expect(badLabel.ok).toBe(false);
    const badLabelUpdate = await editor.execute(state, {
      commandId: "schematic.connect", label: "Move label",
      buildOperations: () => [op({ operationId: "op:bad-label-upd", kind: "schematic_update_net_label", labelId: "l1", patch: { position: { x: 3, y: 3 } } })],
    });
    expect(badLabelUpdate.ok).toBe(false);
  });

  it("C5: invalid restore/replay geometry rejects; valid grid-aligned geometry round-trips exactly", async () => {
    // Restore ops are kernel-minted inverses — geometry-validate at the
    // operations layer (no UI command may submit one; see A4).
    const project = projectStateOf(baseState());
    expect(() => applyEngineeringOperations(project, [op({
      operationId: "op:bad-restore", kind: "schematic_restore_entities",
      components: [{ at: 0, entity: { id: "n9", type: "resistor", x: 1, y: 1, rotation: 0, value: "1k", refDes: "R9" } }],
      kicadComponents: [], wires: [], netLabels: [],
    })])).toThrow(/INVALID_PX/);
    const state = baseState();
    const { editor } = await openSession(state, "c5");
    // Valid aligned geometry round-trips.
    const good = await editor.execute(state, {
      commandId: "schematic.connect", label: "Drew wire",
      buildOperations: () => [op({ operationId: "op:good-wire", kind: "schematic_add_wire", wire: { id: "w-good", vertices: [{ x: 0, y: 0 }, { x: 20, y: 0 }] }, atIndex: 0 })],
    });
    expect(good.ok).toBe(true);
    if (!good.ok) throw new Error("unreachable");
    expect(good.state.wires.find((w) => w.id === "w-good")!.vertices).toEqual([{ x: 0, y: 0 }, { x: 20, y: 0 }]);
  });

  it("C6: an identity-valid but geometry-invalid projection cannot hydrate ready (fail-closed legacy recovery path)", async () => {
    const offGrid = baseState();
    offGrid.components[0].x = 101; // 1px off-grid
    const editor = new SchematicEditorSession({ ...SCOPE, projectId: "c6" }, { store: new InMemoryAtomicProjectStore() });
    const outcome = await editor.openForProject(offGrid, null);
    expect(outcome.status).toBe("invalid-projection");
    expect(editor.lifecycle).toBe("conflicted");
  });
});

// ─── §D Gesture coordinator race rules ───────────────────────────────────────

interface Deferred {
  promise: Promise<SchematicCommandResult | null>;
  resolve(result: SchematicCommandResult | null): void;
}

function deferred(): Deferred {
  let resolveFn: (result: SchematicCommandResult | null) => void = () => undefined;
  const promise = new Promise<SchematicCommandResult | null>((res) => { resolveFn = res; });
  return { promise, resolve: resolveFn };
}

function movedState(state: SchematicState, dx: number): SchematicState {
  return { ...state, components: state.components.map((c) => (c.id === "uuid-r1" ? { ...c, x: c.x + dx } : c)) };
}

/** B07.3 — commits/commands are FIFO queue jobs now: flush microtasks so a
 *  submitted job reaches its host.execute call before the test drives it. */
async function flushQueue(ticks = 6): Promise<void> {
  for (let i = 0; i < ticks; i += 1) await Promise.resolve();
}

function okResult(state: SchematicState): SchematicCommandResult {
  return { ok: true, status: "executed", state, label: "Moved components" };
}

function rejectedResult(): SchematicCommandResult {
  return { ok: false, status: "rejected", reasonCode: "stale_revision", message: "stale", diagnostics: ["STALE"] };
}

/** Deterministic fake host: records every projection application in order. */
function makeHost() {
  const log: Array<{ kind: "preview" | "canonical" | "rollback"; digest: string }> = [];
  const pending: Deferred[] = [];
  let current = baseState();
  const host: GestureCoordinatorHost = {
    currentState: () => structuredClone(current),
    applyPreviewFrame: (frame) => {
      log.push({ kind: "preview", digest: schematicStateDigest({ ...current, ...(frame as Partial<SchematicState>) }) });
    },
    applyCanonicalProjection: (_label, state) => {
      current = structuredClone(state);
      log.push({ kind: "canonical", digest: schematicStateDigest(state) });
      coordinator.notifyAuthoritativeProjection();
    },
    applyRollbackProjection: (state) => {
      current = structuredClone(state);
      log.push({ kind: "rollback", digest: schematicStateDigest(state) });
      coordinator.notifyAuthoritativeProjection();
    },
    execute: () => {
      const d = deferred();
      pending.push(d);
      return d.promise;
    },
    notify: () => undefined,
  };
  const coordinator = new SchematicGestureCoordinator(host);
  return {
    coordinator, log, pending,
    setCurrent: (state: SchematicState) => { current = structuredClone(state); },
    currentDigest: () => schematicStateDigest(current),
    /** Simulate a NON-gesture authoritative application (command/hydration). */
    applyExternal: (state: SchematicState) => {
      current = structuredClone(state);
      log.push({ kind: "canonical", digest: schematicStateDigest(state) });
      coordinator.notifyAuthoritativeProjection();
    },
  };
}

describe("B07.1 §D — gesture coordinator", () => {
  const base = baseState();
  const afterOf = (state: SchematicState): SchematicGraphAfter => graphAfterOf(state);

  it("D1: while gesture A's commit is pending, gesture B cannot take ownership", async () => {
    const h = makeHost();
    expect(h.coordinator.begin()).toBe(true);
    const commitA = h.coordinator.commit("Moved components", afterOf(movedState(base, 50)));
    expect(h.coordinator.commitInFlight).toBe(true);
    expect(h.coordinator.begin()).toBe(false); // B refused — no silent overwrite
    await flushQueue();
    h.pending[0].resolve(okResult(movedState(base, 50)));
    await commitA;
    expect(h.coordinator.begin()).toBe(true); // free again after completion
  });

  it("D2 (B07.3 model): authoritative state can only supersede a pending commit through lifecycle invalidation — and then the newer state stays visible (no stale rollback)", async () => {
    // Under the B07.3 FIFO queue an ordinary command can no longer
    // interleave a pending commit (it queues behind it), so the original
    // D2 premise is impossible by construction. The surviving race is a
    // LIFECYCLE replacement (hydration/recovery/project data), which always
    // invalidates first — a late rejection must not restore its stale base.
    const h = makeHost();
    expect(h.coordinator.begin()).toBe(true);
    const commitA = h.coordinator.commit("Moved components", afterOf(movedState(base, 50)));
    await flushQueue();
    const newer = movedState(base, 200);
    h.coordinator.invalidate();
    h.applyExternal(newer);
    h.pending[0].resolve(rejectedResult());
    await commitA;
    expect(h.currentDigest()).toBe(schematicStateDigest(newer));
    expect(h.log.filter((e) => e.kind === "rollback")).toHaveLength(0); // no stale rollback
  });

  it("D3: gesture A succeeds after a project switch — the result is ignored entirely", async () => {
    const h = makeHost();
    expect(h.coordinator.begin()).toBe(true);
    const commitA = h.coordinator.commit("Moved components", afterOf(movedState(base, 50)));
    await flushQueue();
    const otherProject = movedState(base, 500);
    h.coordinator.invalidate();     // hydrateProject on switch
    h.setCurrent(otherProject);     // new project's state is now visible
    h.pending[0].resolve(okResult(movedState(base, 50)));
    await commitA;
    expect(h.currentDigest()).toBe(schematicStateDigest(otherProject));
    expect(h.log.filter((e) => e.kind === "canonical" || e.kind === "rollback")).toHaveLength(0);
  });

  it("D4: gesture A rejects after canonical hydration/adoption — the recovered canonical state stays visible", async () => {
    const h = makeHost();
    expect(h.coordinator.begin()).toBe(true);
    const commitA = h.coordinator.commit("Moved components", afterOf(movedState(base, 50)));
    await flushQueue();
    const recovered = movedState(base, 300);
    h.coordinator.invalidate();   // adoptCanonicalSchematic invalidates…
    h.applyExternal(recovered);   // …then applies the recovered state
    h.pending[0].resolve(rejectedResult());
    await commitA;
    expect(h.currentDigest()).toBe(schematicStateDigest(recovered));
    expect(h.log.filter((e) => e.kind === "rollback")).toHaveLength(0);
  });

  it("D5: cancel during preview writes no transaction and restores the exact current base", () => {
    const h = makeHost();
    expect(h.coordinator.begin()).toBe(true);
    h.coordinator.preview(afterOf(movedState(base, 30)));
    h.coordinator.cancel();
    expect(h.pending).toHaveLength(0); // no execute call
    expect(h.log.at(-1)).toEqual({ kind: "rollback", digest: schematicStateDigest(base) });
    // A second cancel (no active gesture) restores nothing else.
    h.coordinator.cancel();
    expect(h.log.filter((e) => e.kind === "rollback")).toHaveLength(1);
  });

  it("D6: double pointer-up produces at most ONE command", async () => {
    const h = makeHost();
    expect(h.coordinator.begin()).toBe(true);
    const final = afterOf(movedState(base, 50));
    const first = h.coordinator.commit("Moved components", final);
    const second = h.coordinator.commit("Moved components", final); // no active gesture
    await flushQueue();
    expect(h.pending).toHaveLength(1);
    h.pending[0].resolve(okResult(movedState(base, 50)));
    await Promise.all([first, second]);
    expect(h.pending).toHaveLength(1);
    expect(h.log.filter((e) => e.kind === "canonical")).toHaveLength(1);
  });

  it("D7: dispose (unmount) prevents late state writes", async () => {
    const h = makeHost();
    expect(h.coordinator.begin()).toBe(true);
    const commitA = h.coordinator.commit("Moved components", afterOf(movedState(base, 50)));
    await flushQueue();
    h.coordinator.dispose();
    h.pending[0].resolve(okResult(movedState(base, 50)));
    await commitA;
    expect(h.log.filter((e) => e.kind === "canonical" || e.kind === "rollback")).toHaveLength(0);
    expect(h.coordinator.begin()).toBe(false); // dead forever
  });

  it("D8: a persistence-failed commit (no newer state) rolls back to the authoritative base", async () => {
    const h = makeHost();
    expect(h.coordinator.begin()).toBe(true);
    const commitA = h.coordinator.commit("Moved components", afterOf(movedState(base, 50)));
    await flushQueue();
    h.pending[0].resolve({ ok: false, status: "rejected", reasonCode: "persistence_failed", message: "disk full", diagnostics: ["DISK_FULL"] });
    await commitA;
    // Projection equals the authoritative canonical state (the base — the
    // transaction never committed).
    expect(h.currentDigest()).toBe(schematicStateDigest(base));
    expect(h.log.at(-1)?.kind).toBe("rollback");
  });

  it("D9: one successful end-to-end gesture creates exactly ONE canonical transaction (real session)", async () => {
    const state = baseState();
    const { editor } = await openSession(state, "d9");
    const final = movedState(state, 50);
    let executeCalls = 0;
    const host: GestureCoordinatorHost = {
      currentState: () => structuredClone(state),
      applyPreviewFrame: () => undefined,
      applyCanonicalProjection: () => undefined,
      applyRollbackProjection: () => undefined,
      execute: (b, request) => { executeCalls += 1; return editor.execute(b, request); },
      notify: () => undefined,
    };
    const coordinator = new SchematicGestureCoordinator(host);
    expect(coordinator.begin()).toBe(true);
    coordinator.preview(graphAfterOf(final));
    await coordinator.commit("Moved components", graphAfterOf(final));
    expect(executeCalls).toBe(1);
    expect(editor.events.filter((e) => e.kind === "executed")).toHaveLength(1);
    expect(editor.headMark()?.headSequence).toBe(1);
    // Zero-delta second gesture: no transaction.
    expect(coordinator.begin()).toBe(true);
    await coordinator.commit("Moved components", graphAfterOf(state));
    expect(executeCalls).toBe(1);
  });

  it("D10: history/autosave suppression (previewActive) clears on success, rejection, cancel, and invalidation", async () => {
    const h = makeHost();
    expect(h.coordinator.previewActive).toBe(false);
    h.coordinator.begin();
    expect(h.coordinator.previewActive).toBe(true);
    const commit = h.coordinator.commit("Moved components", afterOf(movedState(base, 50)));
    expect(h.coordinator.previewActive).toBe(false); // clears at pointer-up
    await flushQueue();
    h.pending[0].resolve(rejectedResult());
    await commit;
    expect(h.coordinator.previewActive).toBe(false);
    h.coordinator.begin();
    h.coordinator.cancel();
    expect(h.coordinator.previewActive).toBe(false);
    h.coordinator.begin();
    h.coordinator.invalidate();
    expect(h.coordinator.previewActive).toBe(false);
  });
});

// ─── §E Structural setter gate ───────────────────────────────────────────────

describe("B07.1 §E — structural direct-setter gate", () => {
  const pageSource = readFileSync(resolve(process.cwd(), "app/page.tsx"), "utf8");

  it("E1: the real page passes — raw setters live ONLY inside the three approved projection appliers", () => {
    expect(auditSchematicSetterAuthority(pageSource)).toEqual([]);
  });

  it("E2 (fixture 10): an injected direct mutation FAILS the gate even with a forged `b07:` comment — and the revert passes again (no destructive git needed)", () => {
    const forged = pageSource.replace(
      "const persistProject = useCallback(",
      "setComponents([]); /* b07:lifecycle */\n  const persistProject = useCallback(",
    );
    expect(forged).not.toBe(pageSource); // the injection landed
    const violations = auditSchematicSetterAuthority(forged);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].reason).toContain("comments cannot exempt");
    // Revert = original source; the gate passes again.
    expect(auditSchematicSetterAuthority(pageSource)).toEqual([]);
  });

  it("E3: aliasing or prop-threading a raw setter is a violation", () => {
    const aliased = pageSource.replace(
      "const persistProject = useCallback(",
      "const sneaky = setWires;\n  const persistProject = useCallback(",
    );
    expect(auditSchematicSetterAuthority(aliased).length).toBeGreaterThan(0);
    const threaded = pageSource.replace(
      "graph={schematicGraphApi}",
      "graph={schematicGraphApi} escapeHatch={setNetLabels}",
    );
    expect(auditSchematicSetterAuthority(threaded).length).toBeGreaterThan(0);
  });

  it("E4: removing or duplicating an approved applier fails the gate", () => {
    const renamed = pageSource.replace("const applyGesturePreviewFrame = useCallback(", "const applyGesturePreviewFrameX = useCallback(");
    const violations = auditSchematicSetterAuthority(renamed);
    expect(violations.some((v) => v.reason.includes("applyGesturePreviewFrame"))).toBe(true);
    const duplicated = `${pageSource}\nconst applyGesturePreviewFrame = useCallback(() => {});`;
    expect(auditSchematicSetterAuthority(duplicated).some((v) => v.reason.includes("applyGesturePreviewFrame"))).toBe(true);
  });

  it("E5: the approved appliers pin their distinct responsibilities (adoption vs lifecycle vs preview)", () => {
    // [B12.2 §C] Canonical adoption records ONE real SchematicHistory entry
    // SYNCHRONOUSLY through the shared production primitive
    // (adoptCanonicalResult), suppresses the debounce watcher's duplicate,
    // and FAILS the coordinator job when adoption fails; lifecycle
    // replacement suppresses history without recording; preview touches
    // neither.
    const canonicalBody = pageSource.slice(pageSource.indexOf("const applyCanonicalSchematicProjection"), pageSource.indexOf("const applyLifecycleSchematicProjection"));
    expect(canonicalBody).toContain("adoptCanonicalResult");
    expect(canonicalBody).toContain("flushPendingRecord");
    expect(canonicalBody).toContain("history: () => schHistoryRef.current");
    expect(canonicalBody).toContain("applyingHistoryRef.current = true");
    expect(canonicalBody).toContain("throw new Error");
    const lifecycleBody = pageSource.slice(pageSource.indexOf("const applyLifecycleSchematicProjection"), pageSource.indexOf("/** User prompts"));
    expect(lifecycleBody).toContain("applyingHistoryRef.current = true");
    expect(lifecycleBody).not.toContain("adoptCanonicalResult");
    const previewBody = pageSource.slice(pageSource.indexOf("const applyGesturePreviewFrame"), pageSource.indexOf("const applyCanonicalSchematicProjection"));
    expect(previewBody).not.toContain("historyLabelRef");
    expect(previewBody).not.toContain("applyingHistoryRef");
    expect(previewBody).not.toContain("adoptCanonicalResult");
  });
});

// ─── §G Mutation-boundary regression ─────────────────────────────────────────

describe("B07.1 §G — tool/provider boundary stays closed", () => {
  it("G1: no callable/discoverable schematic mutation surface exists for connect/add-component, and no B07/B07.1 operation kind appears in any tool descriptor", () => {
    const catalog = sirkitToolRegistry().list();
    const kinds = [
      "schematic_add_wire", "schematic_delete_wire", "schematic_update_wire_geometry",
      "schematic_add_net_label", "schematic_delete_net_label", "schematic_update_net_label",
      "schematic_add_component",
    ];
    for (const descriptor of catalog) {
      const serialized = JSON.stringify(descriptor);
      for (const kind of kinds) expect(serialized).not.toContain(kind);
      if (descriptor.owningCommandId === "schematic.connect" || descriptor.owningCommandId === "schematic.add-component") {
        expect(descriptor.callability).not.toBe("callable");
        expect(descriptor.discovery).not.toBe("discoverable");
      }
    }
  });

  it("G2: B07.1 added no new registry actions and no new callable tools (identity/geometry validation and the gesture coordinator are not agent surface)", () => {
    const registryIds = ACTION_COVERAGE_REGISTRY.map((record) => record.id);
    expect(registryIds.filter((id) => /b07|gesture|coordinator|setter/i.test(id))).toEqual([]);
    const callable = sirkitToolRegistry().list().filter((descriptor) => descriptor.callability === "callable");
    expect(callable.filter((descriptor) => /gesture|coordinator|identity-integrity|setter-gate/i.test(JSON.stringify(descriptor)))).toEqual([]);
  });

  it("G3: display helpers exported for consumers carry no mutation capability (pure functions over state)", () => {
    const component = { id: "stable-r", refDes: "RSENSE" };
    expect(schDisplayRef(component)).toBe("RSENSE");
    expect(refDesKey(" rsense ")).toBe("RSENSE");
  });
});
