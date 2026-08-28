/**
 * B06 — canonical schematic semantic mutations.
 *
 * Deterministic coverage of the stage's acceptance surface:
 *  §1  delete semantics (unconnected, connected, incident cleanup,
 *      unrelated-net preservation, exact undo/redo)
 *  §2  replacement semantics (verified pin-compatible, explicit mapping,
 *      incompatible/ambiguous/pin-count-only rejection, authority rules)
 *  §3  property/transform revision + history behavior
 *  §4  executor/transaction contracts (stale revision, idempotent retry,
 *      rollback on validation and persistence failure)
 *  §5  hydration, exact-head persistence, legacy compatibility
 *  §6  security boundaries (forged lineage, spoofed interactive authority,
 *      no AI/provider mutation path, mutation-free discovery/schemas)
 *  §7  tier-1 AI edit planner (proposal → canonical compilation)
 *
 * All assertions are structural — no timing gates.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { KicadComponentInstance, NetLabel, SchComponent, SchematicState, Wire } from "@/lib/schematic-types";
import { renderSchematicReplayEvidence } from "../schematic-replay-evidence";
import { kicadPinWorldPos, pinWorldPos } from "../../geometry";
import type { KicadPin } from "../../kicad/types";
import { ACTION_COVERAGE_REGISTRY } from "../action-registry";
import { CanonicalExecutor, KERNEL_OPERATION_BINDINGS, resolveExecutorContract } from "../executor";
import { createEditorSessionChannel } from "../interactive-channel.internal";
import { createEmptyBoard } from "../../pcb/types";
import { InMemoryAtomicProjectStore } from "../persistence";
import { CANONICAL_SCHEMATIC_SCHEMA, fromCanonicalSchematic, parseCanonicalSchematic, schematicStateDigest, toCanonicalSchematic, type CanonicalSchematic } from "../schematic-model";
import { compileTier1Proposal, planSchematicDelete, planSchematicReplacement } from "../schematic-plans";
import { fixtureVerifiedAuthority } from "../schematic-replay-evidence";
import { SchematicEditorSession } from "../schematic-session";
import { discoverTools, type DiscoveryContext } from "../tool-discovery";
import { renderAnthropicTool, renderOpenAiTool } from "../tool-provider-adapters";
import { sirkitToolRegistry } from "../tool-catalog";
import { EngineeringTransactionService } from "../transaction-service";
import type { CanonicalProjectState, EngineeringActor, EngineeringOperation } from "../types";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const HUMAN: EngineeringActor = { actorId: "owner", actorKind: "human", sessionId: "s1", role: "project_admin" };
const AI_ACTOR: EngineeringActor = { actorId: "assistant", actorKind: "ai", sessionId: "s2", role: "project_admin" };

function pin(number: string, name: string, xMm: number, yMm = 0): KicadPin {
  return { number, name, type: "passive", position: { x: xMm, y: yMm }, orientation: 0, length: 2.54 };
}

/** Two-pin generic part; pins at ±2.5mm so world positions land on the grid. */
const PART_A_PINS: readonly KicadPin[] = [pin("1", "A", -2.5), pin("2", "B", 2.5)];
/** Identity-compatible substitute (same numbers AND names, same geometry). */
const PART_B_PINS: readonly KicadPin[] = [pin("1", "A", -2.5), pin("2", "B", 2.5)];
/** Same pin COUNT but different names — never implicitly compatible. */
const PART_C_PINS: readonly KicadPin[] = [pin("1", "X", -2.5), pin("2", "Y", 2.5)];
/** Different numbering; compatible only via an explicit mapping. Offset pins. */
const PART_D_PINS: readonly KicadPin[] = [pin("3", "A", -5), pin("4", "B", 5)];

function theoryComponent(id: string, x: number, y: number, value = "1k"): SchComponent {
  return { id, type: "resistor", x, y, rotation: 0, value };
}

function kicadInstance(id: string, refDes: string, x: number, y: number, partId = "lib:part-a", extra?: Partial<KicadComponentInstance>): KicadComponentInstance {
  return { id, partId, x, y, rotation: 0, refDes, value: "10k", ...extra };
}

function wireBetween(id: string, from: { x: number; y: number }, to: { x: number; y: number }, mid?: { x: number; y: number }): Wire {
  return { id, vertices: mid ? [from, mid, to] : [from, to] };
}

function label(id: string, name: string, at: { x: number; y: number }): NetLabel {
  return { id, position: at, name, kind: "label", orientation: 0 };
}

/**
 * R1 —wire w1— U1(pin1); U1(pin2) has label VOUT; a second VOUT label + wire
 * w2 elsewhere keep the net alive; w3 is unrelated; w4 PASSES THROUGH R1's
 * right pin as an interior vertex (must never be deleted with R1).
 */
function connectedState(): SchematicState {
  const r1 = theoryComponent("R1", 100, 100);
  const r2 = theoryComponent("R2", 100, 300);
  const u1 = kicadInstance("u1-id", "U1", 300, 100);
  const r1Right = pinWorldPos(r1, "right");
  const u1Pin1 = kicadPinWorldPos(u1, PART_A_PINS[0]);
  const u1Pin2 = kicadPinWorldPos(u1, PART_A_PINS[1]);
  return {
    components: [r1, r2],
    kicadComponents: [u1],
    wires: [
      wireBetween("w1", r1Right, u1Pin1),
      wireBetween("w2", { x: 500, y: 400 }, { x: 560, y: 400 }),
      wireBetween("w3", { x: 500, y: 500 }, { x: 560, y: 500 }),
      wireBetween("w4", { x: r1Right.x, y: r1Right.y - 50 }, { x: r1Right.x, y: r1Right.y + 50 }, r1Right),
    ],
    netLabels: [
      label("l1", "VOUT", u1Pin2),
      label("l2", "VOUT", { x: 500, y: 400 }),
    ],
  };
}

/**
 * Kernel-behavior test session: explicit in-memory store injection (B06.2 —
 * production never falls back to memory) plus lazy auto-open on first
 * execute, mirroring the page's open-at-hydrate flow without repeating it in
 * every test. B06.2 lifecycle-gating tests construct sessions directly.
 */
function session(projectId = "project-b06"): SchematicEditorSession {
  const editor = new SchematicEditorSession({ tenantId: "tenant-b06", projectId, branchId: "main" }, { store: new InMemoryAtomicProjectStore() });
  const originalExecute = editor.execute.bind(editor);
  let opening: Promise<unknown> | null = null;
  editor.execute = async (state, request) => {
    if (editor.lifecycle === "unopened") opening ??= editor.openForProject(state, null);
    if (opening) await opening;
    return originalExecute(state, request);
  };
  return editor;
}

function deleteRequest(state: SchematicState, family: "theory" | "kicad", componentId: string, pins?: readonly KicadPin[]) {
  const planned = planSchematicDelete(state, { family, componentId }, pins);
  if (!planned.ok) throw new Error(`plan refused: ${planned.refusal}`);
  return { planned, request: { commandId: "schematic.delete-component", label: "Delete component", buildOperations: () => [planned.operation] } };
}

async function openSchematicService(state: SchematicState, fault?: (phase: "before_commit" | "after_commit_before_ack") => void) {
  const project: CanonicalProjectState = {
    schemaVersion: "sirkit.engineering.v1",
    tenantId: "tenant-b06",
    projectId: "project-exec",
    branchId: "main",
    pcb: createEmptyBoard(),
    schematic: toCanonicalSchematic(state),
    pinnedAssets: [],
  };
  const store = new InMemoryAtomicProjectStore(fault);
  const service = await EngineeringTransactionService.open(project, { buildId: "b06-test", store });
  const executor = new CanonicalExecutor(service, ACTION_COVERAGE_REGISTRY, { interactiveChannel: createEditorSessionChannel("b06 test session") });
  return { service, executor, store };
}

function schematicOf(service: EngineeringTransactionService): CanonicalSchematic {
  const parsed = parseCanonicalSchematic(service.currentProject().schematic);
  if (!parsed) throw new Error("schematic not canonical");
  return parsed;
}

// ─── §1 Delete ───────────────────────────────────────────────────────────────

describe("B06 §1 — deterministic delete", () => {
  it("1. deletes an unconnected component (nothing else touched)", async () => {
    const state = connectedState();
    const editor = session();
    const { planned, request } = deleteRequest(state, "theory", "R2");
    expect(planned.plan.removeWireIds).toEqual([]);
    expect(planned.plan.removeNetLabelIds).toEqual([]);
    const result = await editor.execute(state, request);
    expect(result.ok && result.status === "executed").toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.state.components.map((c) => c.id)).toEqual(["R1"]);
    expect(result.state.wires).toHaveLength(4);
    expect(result.state.netLabels).toHaveLength(2);
  });

  it("2-4. connected delete removes EXACTLY the incident endpoint wires and pin labels; interior-vertex wires, unrelated wires, and same-name labels elsewhere survive", async () => {
    const state = connectedState();
    const editor = session();
    const { planned, request } = deleteRequest(state, "kicad", "u1-id", PART_A_PINS);
    // w1 ends on U1 pin 1 → removed. l1 sits on pin 2 → removed. w2/w3/w4 and
    // the same-name VOUT label l2 survive: no hidden net merging, no removal
    // of unrelated segments, no dangling references.
    expect(planned.plan.removeWireIds).toEqual(["w1"]);
    expect(planned.plan.removeNetLabelIds).toEqual(["l1"]);
    expect(planned.plan.removedLabelNames).toEqual(["VOUT"]);
    const result = await editor.execute(state, request);
    if (!result.ok) throw new Error("delete rejected");
    expect(result.state.kicadComponents).toEqual([]);
    expect(result.state.wires?.map((w) => w.id).sort()).toEqual(["w2", "w3", "w4"]);
    expect(result.state.netLabels?.map((l) => l.id)).toEqual(["l2"]);
    // Graph integrity: no wire endpoint or label sits on a deleted pin.
    const u1 = state.kicadComponents![0];
    const deletedPins = new Set(PART_A_PINS.map((p) => { const w = kicadPinWorldPos(u1, p); return `${w.x},${w.y}`; }));
    for (const w of result.state.wires ?? []) {
      const first = w.vertices[0]; const last = w.vertices[w.vertices.length - 1];
      expect(deletedPins.has(`${first.x},${first.y}`)).toBe(false);
      expect(deletedPins.has(`${last.x},${last.y}`)).toBe(false);
    }
  });

  it("2b. a theory delete removes wires attached to ITS pins via the same uniform policy", async () => {
    const state = connectedState();
    const editor = session();
    const { planned } = deleteRequest(state, "theory", "R1");
    // w1 starts on R1.right; w4 only PASSES THROUGH that point (interior
    // vertex) and must be preserved.
    expect(planned.plan.removeWireIds).toEqual(["w1"]);
    const result = await editor.execute(state, { commandId: "schematic.delete-component", label: "Delete R1", buildOperations: () => [planned.operation] });
    if (!result.ok) throw new Error("delete rejected");
    expect(result.state.wires?.map((w) => w.id).sort()).toEqual(["w2", "w3", "w4"]);
  });

  it("5. undo restores the component AND all incident graph state exactly; redo re-applies exactly (verified replay, not caller-forged)", async () => {
    const state = connectedState();
    const editor = session();
    const before = schematicStateDigest(state);
    const { request } = deleteRequest(state, "kicad", "u1-id", PART_A_PINS);
    const result = await editor.execute(state, request);
    if (!result.ok) throw new Error("delete rejected");
    const afterDelete = schematicStateDigest(result.state);
    expect(afterDelete).not.toBe(before);

    await editor.reconcileHistoryStep("undo", state);
    expect(editor.events.at(-1)?.kind).toBe("undo-reconciled");

    await editor.reconcileHistoryStep("redo", result.state);
    expect(editor.events.at(-1)?.kind).toBe("redo-reconciled");
    // One user action = one transaction each: executed + undo + redo, no rebase.
    expect(editor.events.filter((e) => e.kind === "reconcile-rebased")).toEqual([]);
  });

  it("delete fails closed when kicad pin data is not supplied", () => {
    const planned = planSchematicDelete(connectedState(), { family: "kicad", componentId: "u1-id" });
    expect(planned.ok).toBe(false);
    if (planned.ok) throw new Error("unreachable");
    expect(planned.refusal).toBe("pins-unavailable");
  });
});

// ─── §2 Replacement ──────────────────────────────────────────────────────────

describe("B06 §2 — fail-closed replacement", () => {
  it("6. verified pin-identical substitution preserves connections and replaces identity + authority TOGETHER (authority from the B05.1 bundle adapter)", async () => {
    const state = connectedState();
    // Give the instance stale Stage-5 authority from its current part.
    state.kicadComponents![0].atomicPartRevisionId = "rev-old";
    state.kicadComponents![0].mappingCertificateId = "cert-old";
    // B06.1: verified authority is minted ONLY by consuming a validated
    // B05.1 resource bundle through the internal adapter. B06.2: the grant is
    // scope+revision-pinned and verified by the EXECUTOR, so it must be
    // consumed against the exact canonical state this session executes on.
    const authority = fixtureVerifiedAuthority(state, { tenantId: "tenant-b06", projectId: "project-b06", branchId: "main" });
    const planned = planSchematicReplacement(state, {
      componentId: "u1-id",
      target: { partId: "lib:part-b", pins: PART_B_PINS, authority },
      currentPins: PART_A_PINS,
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) throw new Error("unreachable");
    expect(planned.plan.mode).toBe("pin-identical-substitution");
    expect(planned.plan.authorityStatus).toBe("verified-atomic");
    expect(planned.plan.preservedConnections).toEqual(["1", "2"]);
    expect(planned.plan.droppedConnections).toEqual([]);
    expect(planned.plan.wireEndpointMoves).toEqual([]);
    // Consumed resource ids + digests are recorded in the plan AND operation.
    expect(planned.plan.consumedAuthorityResources.map((entry) => entry.resourceId)).toEqual(["res:canonical:fixture", "res:component-authority:fixture"]);
    expect(planned.operation.kind === "schematic_replace_component" && planned.operation.consumedAuthorityResources?.length).toBe(2);

    const editor = session();
    const result = await editor.execute(state, { commandId: "schematic.replace-component", label: "Replace U1", buildOperations: () => [planned.operation] });
    if (!result.ok) throw new Error(`replace rejected: ${result.diagnostics.join(",")}`);
    const replaced = result.state.kicadComponents![0];
    expect(replaced.partId).toBe("lib:part-b");
    expect(replaced.atomicPartRevisionId).toBe("rev-new");
    expect(replaced.mappingCertificateId).toBe("cert-new");
    expect(replaced.selectionRecordId).toBe("sel-new");
    // Component instance identity and the connected wire are untouched.
    expect(replaced.id).toBe("u1-id");
    expect(result.state.wires?.find((w) => w.id === "w1")).toBeDefined();
  });

  it("7. explicit pin renumbering moves wire endpoints to the mapped pin positions", async () => {
    const state = connectedState();
    const u1 = state.kicadComponents![0];
    const planned = planSchematicReplacement(state, {
      componentId: "u1-id",
      target: { partId: "lib:part-d", pins: PART_D_PINS },
      currentPins: PART_A_PINS,
      explicitPinMapping: [{ fromPin: "1", toPin: "3" }, { fromPin: "2", toPin: "4" }],
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) throw new Error("unreachable");
    expect(planned.plan.mode).toBe("mapped-substitution");
    const newPin3 = kicadPinWorldPos(u1, PART_D_PINS[0]);
    expect(planned.plan.wireEndpointMoves).toEqual([{ wireId: "w1", end: "end", to: newPin3 }]);

    const editor = session();
    const result = await editor.execute(state, { commandId: "schematic.replace-component", label: "Replace U1 (mapped)", buildOperations: () => [planned.operation] });
    if (!result.ok) throw new Error("replace rejected");
    const w1 = result.state.wires!.find((w) => w.id === "w1")!;
    expect(w1.vertices[w1.vertices.length - 1]).toEqual(newPin3);
    // Undo restores the ORIGINAL identity, authority absence, and endpoint.
    await editor.reconcileHistoryStep("undo", state);
    expect(editor.events.at(-1)?.kind).toBe("undo-reconciled");
  });

  it("8+11. pin-count-equal but name-different replacement is refused with a structured explicit-mapping requirement", () => {
    const planned = planSchematicReplacement(connectedState(), {
      componentId: "u1-id",
      target: { partId: "lib:part-c", pins: PART_C_PINS },
      currentPins: PART_A_PINS,
    });
    expect(planned.ok).toBe(false);
    if (planned.ok) throw new Error("unreachable");
    expect(planned.refusal).toBe("explicit-pin-mapping-required");
    expect(planned.pins).toEqual(["1", "2"]);
  });

  it("8b. dropping a connected pin requires explicit acknowledgement", () => {
    const state = connectedState();
    const onePinTarget = [pin("2", "B", 2.5)];
    const planned = planSchematicReplacement(state, {
      componentId: "u1-id",
      target: { partId: "lib:part-e", pins: onePinTarget },
      currentPins: PART_A_PINS,
      explicitPinMapping: [{ fromPin: "2", toPin: "2" }],
    });
    expect(planned.ok).toBe(false);
    if (planned.ok) throw new Error("unreachable");
    expect(planned.refusal).toBe("unacknowledged-dropped-connections");
    expect(planned.pins).toEqual(["1"]);
    const acknowledged = planSchematicReplacement(state, {
      componentId: "u1-id",
      target: { partId: "lib:part-e", pins: onePinTarget },
      currentPins: PART_A_PINS,
      explicitPinMapping: [{ fromPin: "2", toPin: "2" }],
      acknowledgeDroppedPins: ["1"],
    });
    expect(acknowledged.ok).toBe(true);
  });

  it("9+10. ambiguous or unverified authority is refused / never promoted; stale authority is cleared, not retained", async () => {
    // Atomic identity fields WITHOUT verified status → structured refusal.
    const ambiguous = planSchematicReplacement(connectedState(), {
      componentId: "u1-id",
      target: { partId: "lib:part-b", pins: PART_B_PINS, authority: { status: "catalog-unverified", atomicPartRevisionId: "rev-x" } },
      currentPins: PART_A_PINS,
    });
    expect(ambiguous.ok).toBe(false);
    if (ambiguous.ok) throw new Error("unreachable");
    expect(ambiguous.refusal).toBe("ambiguous-authority");

    // catalog-unverified replacement of an instance holding stale atomic
    // authority: the stale fields are CLEARED by the operation and the plan
    // warns about it — never silently carried to the new part.
    const state = connectedState();
    state.kicadComponents![0].atomicPartRevisionId = "rev-old";
    state.kicadComponents![0].symbolAssetVersionId = "sym-old";
    const planned = planSchematicReplacement(state, {
      componentId: "u1-id",
      target: { partId: "lib:part-b", pins: PART_B_PINS, authority: { status: "catalog-unverified" } },
      currentPins: PART_A_PINS,
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) throw new Error("unreachable");
    expect(planned.plan.authorityStatus).toBe("catalog-unverified");
    const editor = session();
    const result = await editor.execute(state, { commandId: "schematic.replace-component", label: "Swap", buildOperations: () => [planned.operation] });
    if (!result.ok) throw new Error("replace rejected");
    const replaced = result.state.kicadComponents![0];
    expect(replaced.partId).toBe("lib:part-b");
    expect(replaced.atomicPartRevisionId).toBeUndefined();
    expect(replaced.symbolAssetVersionId).toBeUndefined();
    expect(replaced.mappingCertificateId).toBeUndefined();
  });

  it("replacement precondition: expectedCurrentPartId mismatch rejects atomically", async () => {
    const state = connectedState();
    const planned = planSchematicReplacement(state, {
      componentId: "u1-id",
      target: { partId: "lib:part-b", pins: PART_B_PINS },
      currentPins: PART_A_PINS,
    });
    if (!planned.ok) throw new Error("plan refused");
    const forged = { ...planned.operation, expectedCurrentPartId: "lib:some-other-part" } as EngineeringOperation;
    const editor = session();
    const result = await editor.execute(state, { commandId: "schematic.replace-component", label: "Swap", buildOperations: () => [forged] });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.diagnostics.some((d) => d.includes("REPLACE_PRECONDITION_FAILED"))).toBe(true);
  });

  it("12. a schematic mutation invalidates electrical truth and its dependents (readiness, drc, ai snapshot)", async () => {
    const state = connectedState();
    const { executor, service } = await openSchematicService(state);
    const planned = planSchematicReplacement(state, {
      componentId: "u1-id",
      target: { partId: "lib:part-b", pins: PART_B_PINS },
      currentPins: PART_A_PINS,
    });
    if (!planned.ok) throw new Error("plan refused");
    const result = await executor.execute({
      commandId: "schematic.replace-component",
      actor: HUMAN,
      expectedRevision: service.currentRevision(),
      idempotencyKey: "swap-1",
      reason: "Replace U1",
      operations: [planned.operation],
      provenance: { source: "ui" },
    });
    expect(result.status).toBe("executed");
    if (result.status === "rejected") throw new Error("unreachable");
    const kinds = result.invalidatedArtifacts.map((a) => a.artifactKind);
    expect(kinds).toContain("electrical_truth");
    expect(kinds).toContain("readiness");
    expect(kinds).toContain("drc");
    expect(kinds).toContain("ai_snapshot");
    // The schematic domain revision advanced; unrelated PCB-only domains kept
    // their revision (deterministic scoped advancement).
    expect(result.revisionAfter.domainRevisions.schematic).not.toBe(result.revisionBefore.domainRevisions.schematic);
    expect(result.revisionAfter.domainRevisions.copperTopology).toBe(result.revisionBefore.domainRevisions.copperTopology);
  });
});

// ─── §3 Properties + transform ───────────────────────────────────────────────

describe("B06 §3 — property edits and transforms", () => {
  it("13. value/refDes edits and transforms advance the revision once per action with exact undo", async () => {
    const state = connectedState();
    const editor = session();
    const setValue = await editor.execute(state, {
      commandId: "schematic.set-property",
      label: "Change U1 value",
      buildOperations: () => [{ operationId: "op:1", schemaVersion: 1, units: "px", kind: "schematic_set_component_properties", family: "kicad", componentId: "u1-id", patch: { value: "22k" } }],
    });
    if (!setValue.ok) throw new Error("set-value rejected");
    expect(setValue.state.kicadComponents![0].value).toBe("22k");
    expect(setValue.revisionBefore).not.toBe(setValue.revisionAfter);

    const rotate = await editor.execute(setValue.state, {
      commandId: "schematic.move-rotate",
      label: "Rotate U1",
      buildOperations: () => [{ operationId: "op:2", schemaVersion: 1, units: "px", kind: "schematic_transform_component", family: "kicad", componentId: "u1-id", x: 300, y: 100, rotation: 90 }],
    });
    if (!rotate.ok) throw new Error("rotate rejected");
    expect(rotate.state.kicadComponents![0].rotation).toBe(90);

    // Exact undo chain back through both transactions.
    await editor.reconcileHistoryStep("undo", setValue.state);
    expect(editor.events.at(-1)?.kind).toBe("undo-reconciled");
    await editor.reconcileHistoryStep("undo", state);
    expect(editor.events.at(-1)?.kind).toBe("undo-reconciled");
  });

  it("refDes uniqueness and non-emptiness are enforced canonically", async () => {
    const state = connectedState();
    state.kicadComponents!.push(kicadInstance("u2-id", "U2", 600, 100));
    const editor = session();
    const duplicate = await editor.execute(state, {
      commandId: "schematic.set-property",
      label: "Rename U2",
      buildOperations: () => [{ operationId: "op:3", schemaVersion: 1, units: "px", kind: "schematic_set_component_properties", family: "kicad", componentId: "u2-id", patch: { refDes: "U1" } }],
    });
    expect(duplicate.ok).toBe(false);
    if (duplicate.ok) throw new Error("unreachable");
    expect(duplicate.diagnostics.some((d) => d.includes("already in use"))).toBe(true);
  });

  it("transform rejects an out-of-domain rotation with nothing applied", async () => {
    const state = connectedState();
    const editor = session();
    const result = await editor.execute(state, {
      commandId: "schematic.move-rotate",
      label: "Rotate",
      buildOperations: () => [{ operationId: "op:4", schemaVersion: 1, units: "px", kind: "schematic_transform_component", family: "theory", componentId: "R1", x: 100, y: 100, rotation: 45 as never }],
    });
    expect(result.ok).toBe(false);
  });
});

// ─── §4 Executor/transaction contracts ───────────────────────────────────────

describe("B06 §4 — revision, idempotency, rollback", () => {
  const deleteOp = (state: SchematicState): EngineeringOperation => {
    const planned = planSchematicDelete(state, { family: "theory", componentId: "R2" });
    if (!planned.ok) throw new Error("plan refused");
    return planned.operation;
  };

  it("14. a stale expected revision is refused with nothing applied", async () => {
    const state = connectedState();
    const { executor, service } = await openSchematicService(state);
    const staleRevision = service.currentRevision();
    const first = await executor.execute({ commandId: "schematic.delete-component", actor: HUMAN, expectedRevision: staleRevision, idempotencyKey: "k1", reason: "Delete R2", operations: [deleteOp(state)], provenance: { source: "ui" } });
    expect(first.status).toBe("executed");
    const digestAfterFirst = schematicStateDigest(fromCanonicalSchematic(schematicOf(service)));
    const stale = await executor.execute({
      commandId: "schematic.set-property",
      actor: HUMAN,
      expectedRevision: staleRevision,
      idempotencyKey: "k2",
      reason: "Edit against stale head",
      operations: [{ operationId: "op:stale", schemaVersion: 1, units: "px", kind: "schematic_set_component_properties", family: "theory", componentId: "R1", patch: { value: "9k" } }],
      provenance: { source: "ui" },
    });
    expect(stale.status).toBe("rejected");
    if (stale.status !== "rejected") throw new Error("unreachable");
    expect(stale.reasonCode).toBe("stale_revision");
    expect(schematicStateDigest(fromCanonicalSchematic(schematicOf(service)))).toBe(digestAfterFirst);
  });

  it("15. an idempotent retry replays the original result without a second mutation or history entry", async () => {
    const state = connectedState();
    const { executor, service } = await openSchematicService(state);
    const revision = service.currentRevision();
    const request = { commandId: "schematic.delete-component", actor: HUMAN, expectedRevision: revision, idempotencyKey: "retry-key", reason: "Delete R2", operations: [deleteOp(state)], provenance: { source: "ui" as const } };
    const first = await executor.execute(request);
    expect(first.status).toBe("executed");
    const retry = await executor.execute(structuredClone(request));
    expect(retry.status).toBe("idempotent_replay");
    if (retry.status === "rejected" || first.status === "rejected") throw new Error("unreachable");
    expect(retry.transactionId).toBe(first.transactionId);
    expect(service.durableRecords()).toHaveLength(1);
  });

  it("16. a validation failure inside a batch rolls back the WHOLE transaction", async () => {
    const state = connectedState();
    const { executor, service } = await openSchematicService(state);
    const before = schematicStateDigest(fromCanonicalSchematic(schematicOf(service)));
    const result = await executor.execute({
      commandId: "schematic.edit-tier1-apply",
      actor: HUMAN,
      expectedRevision: service.currentRevision(),
      idempotencyKey: "batch-1",
      reason: "Mixed batch with an invalid member",
      operations: [
        { operationId: "op:good", schemaVersion: 1, units: "px", kind: "schematic_set_component_properties", family: "theory", componentId: "R1", patch: { value: "5k" } },
        { operationId: "op:bad", schemaVersion: 1, units: "px", kind: "schematic_delete_component", family: "theory", componentId: "R1", removeWireIds: ["not-a-wire"], removeNetLabelIds: [] },
      ],
      provenance: { source: "ui" },
    });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw new Error("unreachable");
    expect(result.reasonCode).toBe("invalid");
    expect(schematicStateDigest(fromCanonicalSchematic(schematicOf(service)))).toBe(before);
    expect(service.durableRecords()).toHaveLength(0);
  });

  it("17. a persistence failure leaves state, revision, and log unchanged", async () => {
    const state = connectedState();
    let fail = false;
    const { executor, service } = await openSchematicService(state, (phase) => { if (fail && phase === "before_commit") throw new Error("DISK_FULL"); });
    const before = schematicStateDigest(fromCanonicalSchematic(schematicOf(service)));
    const revisionBefore = service.currentRevision();
    fail = true;
    const result = await executor.execute({ commandId: "schematic.delete-component", actor: HUMAN, expectedRevision: revisionBefore, idempotencyKey: "p1", reason: "Delete R2", operations: [deleteOp(state)], provenance: { source: "ui" } });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw new Error("unreachable");
    expect(result.reasonCode).toBe("persistence_failed");
    expect(schematicStateDigest(fromCanonicalSchematic(schematicOf(service)))).toBe(before);
    expect(service.currentRevision().headSequence).toBe(revisionBefore.headSequence);
    expect(service.durableRecords()).toHaveLength(0);
    // The same action succeeds after the fault clears (idempotent retry path).
    fail = false;
    const retry = await executor.execute({ commandId: "schematic.delete-component", actor: HUMAN, expectedRevision: service.currentRevision(), idempotencyKey: "p1", reason: "Delete R2", operations: [deleteOp(state)], provenance: { source: "ui" } });
    expect(retry.status).toBe("executed");
  });
});

// ─── §5 Hydration, persistence, legacy ───────────────────────────────────────

describe("B06 §5 — hydration and legacy compatibility", () => {
  it("18. exact-head persistence: a reopened service resumes at the committed head with the full durable log", async () => {
    const state = connectedState();
    const store = new InMemoryAtomicProjectStore();
    const project: CanonicalProjectState = { schemaVersion: "sirkit.engineering.v1", tenantId: "tenant-b06", projectId: "p-reopen", branchId: "main", pcb: createEmptyBoard(), schematic: toCanonicalSchematic(state), pinnedAssets: [] };
    const service = await EngineeringTransactionService.open(project, { buildId: "b06-test", store });
    const executor = new CanonicalExecutor(service, ACTION_COVERAGE_REGISTRY, { interactiveChannel: createEditorSessionChannel("t") });
    const planned = planSchematicDelete(state, { family: "theory", componentId: "R2" });
    if (!planned.ok) throw new Error("plan refused");
    const first = await executor.execute({ commandId: "schematic.delete-component", actor: HUMAN, expectedRevision: service.currentRevision(), idempotencyKey: "h1", reason: "Delete R2", operations: [planned.operation], provenance: { source: "ui" } });
    expect(first.status).toBe("executed");
    const headDigest = service.currentRevision().canonicalStateDigest;

    const reopened = await EngineeringTransactionService.open(project, { buildId: "b06-test", store });
    expect(reopened.currentRevision().canonicalStateDigest).toBe(headDigest);
    expect(reopened.durableRecords()).toHaveLength(1);
    expect(schematicOf(reopened).components.map((c) => c.id)).toEqual(["R1"]);
  });

  it("18b. a fresh session per hydrated project starts with no phantom entries and a distinct lineage", async () => {
    const first = session("project-one");
    const second = session("project-two");
    const state = connectedState();
    await first.execute(state, { commandId: "schematic.set-property", label: "x", buildOperations: () => [{ operationId: "op:a", schemaVersion: 1, units: "px", kind: "schematic_set_component_properties", family: "theory", componentId: "R1", patch: { value: "2k" } }] });
    await second.execute(state, { commandId: "schematic.set-property", label: "x", buildOperations: () => [{ operationId: "op:a", schemaVersion: 1, units: "px", kind: "schematic_set_component_properties", family: "theory", componentId: "R1", patch: { value: "2k" } }] });
    expect(first.lineageId).not.toBe(second.lineageId);
    expect(first.events.filter((e) => e.kind === "executed")).toHaveLength(1);
    expect(first.events[0].kind).toBe("opened");
  });

  it("19. legacy compatibility: opaque legacy schematics fail closed, and legacy UI states (optional arrays) normalize through the adapter", async () => {
    // Executor path: a legacy opaque schematic (no canonical schema) refuses
    // schematic operations with nothing applied.
    const project: CanonicalProjectState = { schemaVersion: "sirkit.engineering.v1", tenantId: "tenant-b06", projectId: "p-legacy", branchId: "main", pcb: createEmptyBoard(), schematic: { version: 1, components: [] }, pinnedAssets: [] };
    const service = await EngineeringTransactionService.open(project, { buildId: "b06-test", store: new InMemoryAtomicProjectStore() });
    const executor = new CanonicalExecutor(service, ACTION_COVERAGE_REGISTRY, { interactiveChannel: createEditorSessionChannel("t") });
    const result = await executor.execute({
      commandId: "schematic.set-property",
      actor: HUMAN,
      expectedRevision: service.currentRevision(),
      idempotencyKey: "l1",
      reason: "Edit legacy",
      operations: [{ operationId: "op:l", schemaVersion: 1, units: "px", kind: "schematic_set_component_properties", family: "theory", componentId: "R1", patch: { value: "1k" } }],
      provenance: { source: "ui" },
    });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw new Error("unreachable");
    expect(result.diagnostics.some((d) => d.includes("SCHEMATIC_MODEL_UNAVAILABLE"))).toBe(true);
    expect(parseCanonicalSchematic({ version: 1, components: [] })).toBeNull();

    // Session path: a legacy project state without kicadComponents/netLabels
    // arrays hydrates through the adapter and mutates canonically.
    const legacyUiState: SchematicState = { components: [theoryComponent("R9", 50, 50)], wires: [] };
    const editor = session("p-legacy-ui");
    const edited = await editor.execute(legacyUiState, { commandId: "schematic.set-property", label: "x", buildOperations: () => [{ operationId: "op:m", schemaVersion: 1, units: "px", kind: "schematic_set_component_properties", family: "theory", componentId: "R9", patch: { value: "7k" } }] });
    expect(edited.ok).toBe(true);
    if (!edited.ok) throw new Error("unreachable");
    expect(edited.state.components[0].value).toBe("7k");
    expect(toCanonicalSchematic(legacyUiState).schemaVersion).toBe(CANONICAL_SCHEMATIC_SCHEMA);
  });
});

// ─── §6 Security boundaries ──────────────────────────────────────────────────

describe("B06 §6 — security boundaries", () => {
  const B06_COMMANDS = ["schematic.delete-component", "schematic.replace-component", "schematic.set-property", "schematic.move-rotate", "schematic.edit-tier1-apply"] as const;
  const SCHEMATIC_OP_KINDS = ["schematic_delete_component", "schematic_restore_entities", "schematic_replace_component", "schematic_set_component_properties", "schematic_transform_component"];

  it("20. forged undo/redo lineage is rejected before any lookup", async () => {
    const state = connectedState();
    const { executor, service } = await openSchematicService(state);
    const planned = planSchematicDelete(state, { family: "theory", componentId: "R2" });
    if (!planned.ok) throw new Error("plan refused");
    const applied = await executor.execute({ commandId: "schematic.delete-component", actor: HUMAN, expectedRevision: service.currentRevision(), idempotencyKey: "f1", reason: "Delete R2", operations: [planned.operation], provenance: { source: "ui" } });
    if (applied.status === "rejected") throw new Error("unreachable");
    const project = service.currentProject();
    const record = service.durableRecords()[0];
    const changeSet = record.appliedChangeSet!;
    const forged = await executor.executeUndoRedo({
      referencedTransactionId: applied.transactionId,
      direction: "undo",
      actor: HUMAN,
      expectedLineage: { tenantId: project.tenantId, projectId: project.projectId, branchId: project.branchId, lineageId: "lin1-forged" },
      expectedHeadRevision: service.currentRevision(),
      expectedSourceStateDigest: changeSet.resultSemanticStateDigest!,
      expectedResultStateDigest: changeSet.baseSemanticStateDigest!,
      idempotencyKey: "f2",
      reason: "Forged undo",
    });
    expect(forged.status).toBe("rejected");
    if (forged.status !== "rejected") throw new Error("unreachable");
    expect(forged.reasonCode).toBe("reference_mismatch");

    const unknownRef = await executor.executeUndoRedo({
      referencedTransactionId: "tx:not-real",
      direction: "undo",
      actor: HUMAN,
      expectedLineage: { tenantId: project.tenantId, projectId: project.projectId, branchId: project.branchId, lineageId: executor.lineageId },
      expectedHeadRevision: service.currentRevision(),
      expectedSourceStateDigest: changeSet.resultSemanticStateDigest!,
      expectedResultStateDigest: changeSet.baseSemanticStateDigest!,
      idempotencyKey: "f3",
    });
    expect(unknownRef.status).toBe("rejected");
    if (unknownRef.status !== "rejected") throw new Error("unreachable");
    expect(unknownRef.reasonCode).toBe("unknown_reference");
  });

  it("21. caller-spoofed interactive authority cannot execute destructive schematic commands without the trusted channel", async () => {
    const state = connectedState();
    const project: CanonicalProjectState = { schemaVersion: "sirkit.engineering.v1", tenantId: "tenant-b06", projectId: "p-spoof", branchId: "main", pcb: createEmptyBoard(), schematic: toCanonicalSchematic(state), pinnedAssets: [] };
    const service = await EngineeringTransactionService.open(project, { buildId: "b06-test", store: new InMemoryAtomicProjectStore() });
    // NO interactive channel — a generic API caller claiming human/ui fields.
    const channelless = new CanonicalExecutor(service, ACTION_COVERAGE_REGISTRY);
    const planned = planSchematicDelete(state, { family: "theory", componentId: "R2" });
    if (!planned.ok) throw new Error("plan refused");
    const spoofed = await channelless.execute({
      commandId: "schematic.delete-component",
      actor: HUMAN,
      expectedRevision: service.currentRevision(),
      idempotencyKey: "s1",
      reason: "Spoofed delete",
      operations: [planned.operation],
      provenance: { source: "ui" },
    });
    expect(spoofed.status).toBe("rejected");
    if (spoofed.status !== "rejected") throw new Error("unreachable");
    expect(spoofed.reasonCode).toBe("approval_required");
    // A structurally forged "channel" object is not the branded class.
    const forgedChannel = { approvesDestructive: () => true, toJSON: () => "[interactive-ui-channel]" };
    const forgedExecutor = new CanonicalExecutor(service, ACTION_COVERAGE_REGISTRY, { interactiveChannel: forgedChannel as never });
    const viaForged = await forgedExecutor.execute({
      commandId: "schematic.delete-component",
      actor: HUMAN,
      expectedRevision: service.currentRevision(),
      idempotencyKey: "s2",
      reason: "Forged channel delete",
      operations: [planned.operation],
      provenance: { source: "ui" },
    });
    expect(viaForged.status).toBe("rejected");
  });

  it("22. AI actors and AI provenance cannot execute schematic mutations, even through a channel-held executor", async () => {
    const state = connectedState();
    const { executor, service } = await openSchematicService(state);
    // edit_components is categorically refused for ai actors (authorization).
    const aiResult = await executor.execute({
      commandId: "schematic.set-property",
      actor: AI_ACTOR,
      expectedRevision: service.currentRevision(),
      idempotencyKey: "ai1",
      reason: "AI direct mutation",
      operations: [{ operationId: "op:ai", schemaVersion: 1, units: "px", kind: "schematic_set_component_properties", family: "theory", componentId: "R1", patch: { value: "0" } }],
      provenance: { source: "ai" },
    });
    expect(aiResult.status).toBe("rejected");
    if (aiResult.status !== "rejected") throw new Error("unreachable");
    expect(aiResult.reasonCode).toBe("unauthorized");
    // Destructive tier + ai provenance narrows the channel grant away.
    const planned = planSchematicDelete(state, { family: "theory", componentId: "R2" });
    if (!planned.ok) throw new Error("plan refused");
    const aiDelete = await executor.execute({
      commandId: "schematic.delete-component",
      actor: { ...HUMAN, actorKind: "ai" },
      expectedRevision: service.currentRevision(),
      idempotencyKey: "ai2",
      reason: "AI delete",
      operations: [planned.operation],
      provenance: { source: "ai" },
    });
    expect(aiDelete.status).toBe("rejected");
  });

  it("23. no schematic mutation appears in the tool catalog, any discovery channel, or provider schemas", () => {
    const registry = sirkitToolRegistry();
    const catalog = registry.list();
    // No descriptor binds a B06 schematic mutation command or operation kind.
    for (const descriptor of catalog) {
      expect(B06_COMMANDS).not.toContain(descriptor.owningCommandId);
      const serialized = JSON.stringify(descriptor);
      for (const kind of SCHEMATIC_OP_KINDS) expect(serialized).not.toContain(kind);
    }
    // Discovery: every channel/role/risk combination yields read-only-or-less
    // for schematic tools; no mutate/destructive schematic tool is discoverable.
    const contexts: DiscoveryContext[] = [
      { channel: "assistant-agent", actorRole: "project_admin", actorKind: "ai", riskCeiling: "destructive", surface: "schematic", projectState: ["schematic-present", "board-present", "authoritative-board", "catalog-available"] },
      { channel: "automation", actorRole: "automation", actorKind: "automated_engine", riskCeiling: "release", surface: "schematic", projectState: ["schematic-present", "board-present"] },
      { channel: "api", actorRole: "project_admin", actorKind: "human", riskCeiling: "destructive", surface: "schematic", projectState: ["schematic-present"] },
    ] as never;
    const descriptorById = new Map(catalog.map((d) => [d.toolId, d]));
    for (const context of contexts) {
      const discovered = discoverTools(registry, context);
      for (const item of discovered.included) {
        expect(B06_COMMANDS).not.toContain(descriptorById.get(item.toolId)?.owningCommandId);
        expect(item.category === "schematic" ? item.operationClass : "read").toBe("read");
      }
    }
    // Provider schemas: rendering every WIRE-COMPATIBLE callable descriptor
    // produces no schematic mutation tool for either provider ([B09.1] the
    // renderer fails closed for out-of-subset schemas — those never reach a
    // provider at all, which is an even stronger guarantee).
    for (const descriptor of catalog.filter((d) => d.callability === "callable")) {
      let openAi: unknown;
      let anthropic: unknown;
      try {
        openAi = renderOpenAiTool(descriptor);
        anthropic = renderAnthropicTool(descriptor);
      } catch (error) {
        expect(String(error)).toContain("STRICT_SCHEMA_UNSUPPORTED"); // fail closed, never rendered
        expect(B06_COMMANDS).not.toContain(descriptor.owningCommandId);
        continue;
      }
      for (const kind of SCHEMATIC_OP_KINDS) {
        expect(JSON.stringify(openAi)).not.toContain(kind);
        expect(JSON.stringify(anthropic)).not.toContain(kind);
      }
      expect(B06_COMMANDS).not.toContain(descriptor.owningCommandId);
    }
    // And the B06 commands are kernel-executable ONLY as mutating commands —
    // they exist in the registry, bound to exact operation kinds.
    for (const commandId of B06_COMMANDS) {
      const contract = resolveExecutorContract(commandId);
      expect(contract?.executable).toBe(true);
      expect(contract?.allowedOperationKinds.length).toBeGreaterThan(0);
    }
    expect(KERNEL_OPERATION_BINDINGS["schematic.edit-tier1-apply"]).toEqual(["schematic_set_component_properties", "schematic_delete_component"]);
  });

  it("a command may only submit its bound operation kinds (no cross-command smuggling)", async () => {
    const state = connectedState();
    const editor = session();
    const smuggled = await editor.execute(state, {
      commandId: "schematic.set-property",
      label: "Smuggled delete",
      buildOperations: () => [{ operationId: "op:x", schemaVersion: 1, units: "px", kind: "schematic_delete_component", family: "theory", componentId: "R2", removeWireIds: [], removeNetLabelIds: [] }],
    });
    expect(smuggled.ok).toBe(false);
    if (smuggled.ok) throw new Error("unreachable");
    expect(smuggled.reasonCode).toBe("operation_mismatch");
  });
});

// ─── §6b Evidence artifacts match the implementation ─────────────────────────

describe("B06 §6b — committed evidence matches the implementation", () => {
  it("schematic-replay-fixtures.json is exactly what the kernel produces today, and every fixture inverse round-trips", () => {
    const committedPath = resolve(process.cwd(), "artifacts/ai-control-plane-b06/schematic-replay-fixtures.json");
    expect(existsSync(committedPath), "run: npx tsx scripts/generate-b06-schematic-artifacts.ts").toBe(true);
    const committed = readFileSync(committedPath, "utf8").replaceAll("\r\n", "\n");
    expect(committed).toBe(renderSchematicReplayEvidence());
    const parsed = JSON.parse(committed) as { fixtures: Array<{ fixtureId: string; inverseRoundTripExact: boolean }>; refusals: unknown[] };
    expect(parsed.fixtures.length).toBeGreaterThanOrEqual(5);
    expect(parsed.fixtures.every((f) => f.inverseRoundTripExact)).toBe(true);
    expect(parsed.refusals.length).toBeGreaterThanOrEqual(4);
  });
});

// ─── §7 Tier-1 AI edit planner ───────────────────────────────────────────────

describe("B06 §7 — tier-1 proposal compilation", () => {
  it("compiles a mixed op list into one canonical batch with sequential-simulation semantics", () => {
    const state = connectedState();
    const compiled = compileTier1Proposal(state, {
      ops: [
        { op: "set-value", target: "R1", value: "4.7k" },
        { op: "rename", target: "U1", refDes: "U9" },
        { op: "set-value", target: "U9", value: "100n" }, // resolves via the rename above
        { op: "delete", target: "R2" },
      ],
      pinsByPartId: new Map([["lib:part-a", PART_A_PINS]]),
    });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) throw new Error("unreachable");
    expect(compiled.operations.map((op) => op.kind)).toEqual([
      "schematic_set_component_properties",
      "schematic_set_component_properties",
      "schematic_set_component_properties",
      "schematic_delete_component",
    ]);
    expect(compiled.impacts.destructive).toBe(true);
    // The batch executes atomically as ONE transaction.
    const editor = session();
    return editor.execute(state, { commandId: "schematic.edit-tier1-apply", label: "Applied AI edit", buildOperations: () => compiled.operations }).then((result) => {
      if (!result.ok) throw new Error(`batch rejected: ${result.diagnostics.join(",")}`);
      expect(result.status).toBe("executed");
      expect(result.state.components.find((c) => c.id === "R1")?.value).toBe("4.7k");
      expect(result.state.kicadComponents![0].refDes).toBe("U9");
      expect(result.state.kicadComponents![0].value).toBe("100n");
      expect(result.state.components.some((c) => c.id === "R2")).toBe(false);
      expect(editor.events.filter((e) => e.kind === "executed")).toHaveLength(1);
    });
  });

  it("B06.1: an unknown target or theory rename BLOCKS the complete proposal (no valid subset)", () => {
    const state = connectedState();
    const unknown = compileTier1Proposal(state, {
      ops: [
        { op: "set-value", target: "R1", value: "4.7k" }, // valid — must NOT survive
        { op: "set-value", target: "GHOST", value: "1" },
      ],
      pinsByPartId: new Map(),
    });
    expect(unknown.ok).toBe(false);
    if (unknown.ok) throw new Error("unreachable");
    expect(unknown.blockers.map((blocker) => blocker.code)).toEqual(["unknown-target"]);

    const rename = compileTier1Proposal(state, {
      ops: [
        { op: "set-value", target: "R1", value: "4.7k" },
        { op: "rename", target: "R2", refDes: "R7" },
      ],
      pinsByPartId: new Map(),
    });
    expect(rename.ok).toBe(false);
    if (rename.ok) throw new Error("unreachable");
    expect(rename.blockers.map((blocker) => blocker.code)).toEqual(["unsupported-theory-rename"]);
  });

  it("blocks the complete proposal on a kicad delete without supplied pin data", () => {
    const state = connectedState();
    const compiled = compileTier1Proposal(state, { ops: [{ op: "set-value", target: "R1", value: "3k" }, { op: "delete", target: "U1" }], pinsByPartId: new Map() });
    expect(compiled.ok).toBe(false);
    if (compiled.ok) throw new Error("unreachable");
    expect(compiled.blockers.map((blocker) => blocker.code)).toEqual(["pins-unavailable"]);
  });

  it("delete cleanup within a batch is computed against the simulated sequence (no double-removal of a shared wire)", () => {
    // R1 and U1 share wire w1. Deleting BOTH in one batch must remove w1
    // exactly once — the second delete plans against the simulated state.
    const state = connectedState();
    const compiled = compileTier1Proposal(state, {
      ops: [
        { op: "delete", target: "R1" },
        { op: "delete", target: "U1" },
      ],
      pinsByPartId: new Map([["lib:part-a", PART_A_PINS]]),
    });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) throw new Error("unreachable");
    const removals = compiled.operations.flatMap((op) => (op.kind === "schematic_delete_component" ? op.removeWireIds : []));
    expect(removals.filter((id) => id === "w1")).toHaveLength(1);
    const editor = session();
    return editor.execute(state, { commandId: "schematic.edit-tier1-apply", label: "Applied AI edit", buildOperations: () => compiled.operations }).then((result) => {
      expect(result.ok).toBe(true);
    });
  });
});
