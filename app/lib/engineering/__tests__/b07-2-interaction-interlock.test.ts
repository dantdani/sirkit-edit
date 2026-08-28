/**
 * B07.2 — schematic gesture/command interlock, invalid-projection recovery,
 * and fail-closed consumer ingress.
 *
 *  §1  Preview promotion closed: the exact x=100 → preview x=150 → Rotate
 *      reproduction, every ordinary-command entry point refused during a
 *      preview, and the session-level UNKNOWN_BASE_PROJECTION fail-safe.
 *  §2  Commit-in-flight serialization, post-commit/post-failure bases, and
 *      late-completion discard.
 *  §3  Invalid-projection recovery outcomes (adoption-only with a valid
 *      fallback; persistent blocking without one; reload reproduces).
 *  §4  Consumer gate policy (export/simulation/pcb-sync/autosave/checkpoint/
 *      edit × lifecycle).
 *  §5  Explicit lifecycle adoption (typed rebase) + page structure gates
 *      (SUPPLEMENTARY source assertions; the race tests above are the
 *      behavioral authority).
 *
 * These are REAL state-transition tests over the production
 * SchematicEditorSession + SchematicGestureCoordinator — the page-mimicking
 * host reproduces exactly the wiring app/page.tsx uses.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SchematicState } from "@/lib/schematic-types";
import { InMemoryAtomicProjectStore, createPersistenceEnvelope } from "../persistence";
import { computeProjectRevision } from "../revision";
import { createEmptyBoard } from "../../pcb/types";
import { evaluateSchematicConsumerGate } from "../schematic-consumer-gate";
import { SchematicGestureCoordinator, type GestureCoordinatorHost } from "../schematic-gesture-coordinator";
import { diffSchematicGraphOps, graphAfterOf } from "../schematic-graph";
import { schematicStateDigest, toCanonicalSchematic, type CanonicalSchematic } from "../schematic-model";
import { SchematicEditorSession, type SchematicSessionLifecycle } from "../schematic-session";
import type { CanonicalProjectState, EngineeringOperation } from "../types";

const SCOPE = { tenantId: "tenant-b072", projectId: "project-b072", branchId: "main" } as const;

function state(x: number, extras?: Partial<SchematicState>): SchematicState {
  return {
    components: [{ id: "uuid-r1", type: "resistor", x, y: 100, rotation: 0, value: "1k", refDes: "R1" }],
    kicadComponents: [],
    wires: [{ id: "w1", vertices: [{ x: 130, y: 100 }, { x: 300, y: 100 }] }],
    netLabels: [],
    ...extras,
  };
}

const op = (partial: Record<string, unknown>): EngineeringOperation =>
  ({ schemaVersion: 1, units: "px", ...partial }) as unknown as EngineeringOperation;

function rotateOps(canonical: CanonicalSchematic): EngineeringOperation[] {
  const c = canonical.components[0];
  return [op({ operationId: `op:rot:${c.id}`, kind: "schematic_transform_component", family: "theory", componentId: c.id, x: c.x, y: c.y, rotation: ((c.rotation + 90) % 360) })];
}

/**
 * Page-mimicking harness: visible projection (React stand-in), the three
 * approved appliers' semantics, and command routing exactly as
 * app/page.tsx wires runSchematicCommand through the gateway.
 */
function makeHarness(initial: SchematicState, options?: { executeDelay?: () => Promise<void> }) {
  const store = new InMemoryAtomicProjectStore();
  const editor = new SchematicEditorSession(SCOPE, { store });
  let visible = structuredClone(initial);
  const adoptions: string[] = [];
  const host: GestureCoordinatorHost = {
    currentState: () => structuredClone(visible),
    applyPreviewFrame: (frame) => { visible = { ...visible, ...(frame as Partial<SchematicState>) }; },
    applyCanonicalProjection: (label, s) => {
      visible = structuredClone(s);
      adoptions.push(`canonical:${label}`);
      coordinator.notifyAuthoritativeProjection(s);
    },
    applyRollbackProjection: (s) => {
      visible = structuredClone(s);
      adoptions.push("rollback");
      coordinator.notifyAuthoritativeProjection(s);
    },
    execute: async (base, request) => {
      if (options?.executeDelay) await options.executeDelay();
      return editor.execute(base, request);
    },
    notify: () => undefined,
  };
  const coordinator = new SchematicGestureCoordinator(host);
  /** Mirrors app/page.tsx runSchematicCommand exactly (B07.3 queue contract:
   *  adoption happens INSIDE the queued job, before the next job starts). */
  async function runCommand(label: string, commandId: string, buildOperations: (c: CanonicalSchematic) => EngineeringOperation[]) {
    const gate = await coordinator.runCanonicalCommand({
      label,
      execute: (authoritativeBase) => editor.execute(authoritativeBase, { commandId, label, buildOperations }),
    });
    const ok = gate.status === "applied" || gate.status === "noop";
    return { gate, ok, result: "result" in gate ? gate.result : undefined };
  }
  async function open() {
    const outcome = await editor.openForProject(initial, null);
    if (outcome.status !== "fresh") throw new Error(`open failed: ${outcome.status}`);
    coordinator.notifyAuthoritativeProjection(initial); // hydrate applies lifecycle projection
    return outcome;
  }
  return { store, editor, coordinator, runCommand, open, visibleState: () => structuredClone(visible), adoptions };
}

const noRebase = (editor: SchematicEditorSession) =>
  expect(editor.events.filter((e) => e.kind === "rebased"), "no interaction-race path may emit a legacy rebase").toEqual([]);

// ─── §1 Preview promotion closed ─────────────────────────────────────────────

describe("B07.2 §1 — an uncommitted preview can never become canonical", () => {
  it("T1 (exact reproduction): canonical x=100, preview x=150, Rotate — refused; canonical stays x=100; no rebase; commit still works after", async () => {
    const h = makeHarness(state(100));
    await h.open();
    const baseDigest = schematicStateDigest(state(100));
    expect(h.coordinator.begin()).toBe(true);
    h.coordinator.preview(graphAfterOf(state(150)));
    expect(h.visibleState().components[0].x).toBe(150); // preview IS visible

    const rotate = await h.runCommand("Rotated component", "schematic.move-rotate", rotateOps);
    expect(rotate.gate.status).toBe("refused-gesture-active");
    expect(rotate.ok).toBe(false);
    noRebase(h.editor);
    // Canonical head untouched — x=100, rotation 0, sequence 0.
    expect(h.editor.headMark()?.headSequence).toBe(0);
    const probeAfterRefusal = await h.editor.execute(state(100), { commandId: "schematic.move-rotate", label: "noop", buildOperations: () => [] });
    if (!probeAfterRefusal.ok) throw new Error("probe rejected");
    expect(schematicStateDigest(probeAfterRefusal.state)).toBe(baseDigest);
    expect(probeAfterRefusal.state.components[0].x).toBe(100);

    // The gesture itself may still commit x=150 — the ONLY path by which
    // the preview coordinates become canonical.
    await h.coordinator.commit("Moved components", graphAfterOf(state(150)));
    expect(h.editor.headMark()?.headSequence).toBe(1);
    expect(h.visibleState().components[0].x).toBe(150);
    noRebase(h.editor);
  });

  it("T1b (session fail-safe): execute() with the preview state rejects UNKNOWN_BASE_PROJECTION — never a lineage rebase — even without the UI interlock", async () => {
    const h = makeHarness(state(100));
    await h.open();
    const result = await h.editor.execute(state(150), {
      commandId: "schematic.move-rotate",
      label: "Rotated component",
      buildOperations: rotateOps,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reasonCode).toBe("stale_revision");
    expect(result.diagnostics).toContain("UNKNOWN_BASE_PROJECTION");
    noRebase(h.editor);
    expect(h.editor.headMark()?.headSequence).toBe(0);
    const probe = await h.editor.execute(state(100), { commandId: "schematic.move-rotate", label: "noop", buildOperations: () => [] });
    if (!probe.ok) throw new Error("probe rejected");
    expect(probe.state.components[0].x).toBe(100);
  });

  it("T2–T6: Delete, property/reference change, graph wire edit, Tier-1 apply, and replacement are ALL refused through the same gate during a preview", async () => {
    const h = makeHarness(state(100));
    await h.open();
    expect(h.coordinator.begin()).toBe(true);
    h.coordinator.preview(graphAfterOf(state(150)));

    const attempts: Array<[string, string, (c: CanonicalSchematic) => EngineeringOperation[]]> = [
      ["Deleted component", "schematic.delete-component", () => [op({ operationId: "op:del", kind: "schematic_delete_component", family: "theory", componentId: "uuid-r1", removeWireIds: [], removeNetLabelIds: [] })]],
      ["Renamed R1", "schematic.set-property", () => [op({ operationId: "op:prop", kind: "schematic_set_component_properties", family: "theory", componentId: "uuid-r1", patch: { refDes: "RX" } })]],
      ["Drew wire", "schematic.connect", (c) => diffSchematicGraphOps(c, { wires: [...c.wires, { id: "w-new", vertices: [{ x: 0, y: 0 }, { x: 20, y: 0 }] }] })],
      ["Applied AI edit proposal", "schematic.edit-tier1-apply", () => [op({ operationId: "op:t1", kind: "schematic_set_component_properties", family: "theory", componentId: "uuid-r1", patch: { value: "9k" } })]],
      ["Replaced component", "schematic.replace-component", () => [op({ operationId: "op:rep", kind: "schematic_replace_component", componentId: "k1", expectedCurrentPartId: "p", replacement: { partId: "p2" }, pinMapping: [], wireEndpointMoves: [], netLabelMoves: [] })]],
    ];
    for (const [label, commandId, build] of attempts) {
      const outcome = await h.runCommand(label, commandId, build);
      expect(outcome.gate.status, `${commandId} must be refused during a preview`).toBe("refused-gesture-active");
    }
    noRebase(h.editor);
    expect(h.editor.headMark()?.headSequence).toBe(0); // nothing executed at all
    expect(h.adoptions).toEqual([]);                    // nothing adopted
    // T13: the preview never entered canonical history.
    const probe = await h.editor.execute(state(100), { commandId: "schematic.move-rotate", label: "noop", buildOperations: () => [] });
    if (!probe.ok) throw new Error("probe rejected");
    expect(probe.state.components[0].x).toBe(100);
  });

  it("T7: undo/redo entry points are excluded during preview, commit, AND command flight (synchronous gate — no check-to-run gap)", async () => {
    const h = makeHarness(state(100));
    await h.open();
    let undoRan = false;
    // During preview:
    expect(h.coordinator.begin()).toBe(true);
    expect(h.coordinator.runExclusiveSync(() => { undoRan = true; })).toBe(false);
    // During commit:
    const commit = h.coordinator.commit("Moved components", graphAfterOf(state(150)));
    expect(h.coordinator.runExclusiveSync(() => { undoRan = true; })).toBe(false);
    await commit;
    // During an in-flight (queued) command:
    let release: () => void = () => undefined;
    const pause = new Promise<void>((r) => { release = r; });
    const slow = makeHarness(state(100), { executeDelay: () => pause });
    await slow.open();
    const pending = slow.runCommand("Rotated component", "schematic.move-rotate", rotateOps);
    expect(slow.coordinator.commandInFlight).toBe(true); // in-flight from submission (B07.3)
    expect(slow.coordinator.runExclusiveSync(() => { undoRan = true; })).toBe(false);
    release();
    await pending;
    // Free again once everything settled:
    expect(slow.coordinator.runExclusiveSync(() => { undoRan = true; })).toBe(true);
    expect(undoRan).toBe(true);
  });
});

// ─── §2 Commit-in-flight serialization and late results ─────────────────────

describe("B07.2 §2 — commands serialize behind gesture commits", () => {
  it("T8+T9: a command arriving while a commit is in flight waits for the EXACT commit and then executes against the committed head", async () => {
    let release: () => void = () => undefined;
    const pause = new Promise<void>((r) => { release = r; });
    let delayOnce: (() => Promise<void>) | null = () => { const p = pause; delayOnce = null; return p; };
    const h = makeHarness(state(100), { executeDelay: () => (delayOnce ? delayOnce() : Promise.resolve()) });
    await h.open();
    expect(h.coordinator.begin()).toBe(true);
    h.coordinator.preview(graphAfterOf(state(150)));
    const commit = h.coordinator.commit("Moved components", graphAfterOf(state(150))); // paused inside execute
    expect(h.coordinator.commitInFlight).toBe(true);

    const commandPromise = h.runCommand("Rotated component", "schematic.move-rotate", rotateOps);
    // The command must NOT have executed yet (it is queued behind the commit).
    expect(h.editor.headMark()?.headSequence).toBe(0);
    release();
    await commit;
    const command = await commandPromise;
    expect(command.gate.status).toBe("applied"); // B07.3: FIFO — never discarded
    expect(command.ok).toBe(true);
    if (!command.ok) throw new Error("unreachable");
    // The command used the COMMITTED head: x=150 preserved, rotation applied.
    expect(command.result!.ok && command.result!.state.components[0].x).toBe(150);
    expect(command.result!.ok && command.result!.state.components[0].rotation).toBe(90);
    expect(h.editor.headMark()?.headSequence).toBe(2); // commit + command, exactly two
    // B07.3: the visible/adopted state equals the durable head (both commands).
    expect(h.visibleState().components[0].x).toBe(150);
    expect(h.visibleState().components[0].rotation).toBe(90);
    noRebase(h.editor);
  });

  it("T10: after a FAILED gesture commit the serialized command executes against the restored authoritative base", async () => {
    const h = makeHarness(state(100));
    await h.open();
    expect(h.coordinator.begin()).toBe(true);
    // Off-grid final geometry: the commit is rejected by the canonical
    // geometry contract and rolls back to the base.
    await h.coordinator.commit("Moved components", graphAfterOf(state(155)));
    expect(h.adoptions).toContain("rollback");
    expect(h.visibleState().components[0].x).toBe(100);
    expect(h.editor.headMark()?.headSequence).toBe(0);

    const command = await h.runCommand("Rotated component", "schematic.move-rotate", rotateOps);
    expect(command.ok).toBe(true);
    if (!command.ok) throw new Error("unreachable");
    expect(command.result!.ok && command.result!.state.components[0].x).toBe(100); // restored base
    expect(command.result!.ok && command.result!.state.components[0].rotation).toBe(90);
    noRebase(h.editor);
  });

  it("T11: a command completion from an old interaction/project epoch is DISCARDED, never adopted", async () => {
    let release: () => void = () => undefined;
    const pause = new Promise<void>((r) => { release = r; });
    const h = makeHarness(state(100), { executeDelay: () => pause });
    await h.open();
    const pending = h.runCommand("Rotated component", "schematic.move-rotate", rotateOps);
    expect(h.coordinator.commandInFlight).toBe(true);
    // Project switch / lifecycle replacement while the command is in flight:
    h.coordinator.invalidate();
    release();
    const outcome = await pending;
    // B07.3: project staleness cancels the command (its durable effect, if
    // any, belongs to the captured old session); the new project's UI is
    // never touched.
    expect(outcome.gate.status).toBe("canceled-stale");
    expect(outcome.ok).toBe(false);
    expect(h.adoptions).toEqual([]); // the result was never adopted
  });
});

// ─── §3 Invalid-projection recovery ──────────────────────────────────────────

describe("B07.2 §3 — invalid-projection recovery outcomes", () => {
  const invalidProjection = (): SchematicState => {
    const s = state(100);
    s.components.push({ id: "uuid-r1", type: "resistor", x: 200, y: 200, rotation: 0, value: "2k", refDes: "R2" }); // duplicate stable id
    return s;
  };

  it("T14: with a VALID canonical fallback, only adoption is offered — keep-local refuses; adoption succeeds", async () => {
    const store = new InMemoryAtomicProjectStore();
    const good: CanonicalProjectState = { schemaVersion: "sirkit.engineering.v1", ...SCOPE, projectId: "t14", pcb: createEmptyBoard(), schematic: toCanonicalSchematic(state(100)), pinnedAssets: [] };
    await store.restore(createPersistenceEnvelope({ project: good, revision: computeProjectRevision(good), transactionLog: [], buildId: "b072" }));
    const editor = new SchematicEditorSession({ ...SCOPE, projectId: "t14" }, { store });
    const outcome = await editor.openForProject(invalidProjection(), null);
    expect(outcome.status).toBe("projection-conflict");
    if (outcome.status !== "projection-conflict") throw new Error("unreachable");
    expect(outcome.reason).toBe("invalid-projection-identity");
    // keep-local structurally refuses the invalid projection…
    const keep = await editor.resolveConflictKeepLocal(invalidProjection());
    expect(keep.status).toBe("invalid-projection");
    // …while adopting the intact canonical head succeeds.
    const adopt = await editor.resolveConflictAdoptCanonical();
    expect(adopt.status).toBe("recovered-canonical");
    if (adopt.status !== "recovered-canonical") throw new Error("unreachable");
    expect(editor.confirmAdoption(adopt.state)).toBe(true);
    expect(editor.lifecycle).toBe("ready");
  });

  it("T15+T16: with NO valid fallback the outcome is invalid-projection with sanitized issues, nothing is written, recovery-by-invalid-state refuses, and RELOAD reproduces the identical outcome", async () => {
    const store = new InMemoryAtomicProjectStore();
    const first = new SchematicEditorSession({ ...SCOPE, projectId: "t15" }, { store });
    const outcome = await first.openForProject(invalidProjection(), null);
    expect(outcome.status).toBe("invalid-projection");
    if (outcome.status !== "invalid-projection") throw new Error("unreachable");
    expect(outcome.issues.some((issue) => issue.includes("duplicate stable id"))).toBe(true);
    expect(first.lifecycle).toBe("conflicted");
    expect(await store.load("t15", "main")).toBeNull(); // nothing written
    const fresh = await first.recoverStartFresh(invalidProjection());
    expect(fresh.status).toBe("invalid-projection");    // no repair path lies

    // Reload: a NEW session over the same store and the same stored
    // projection reproduces the same blocking outcome.
    first.dispose();
    const second = new SchematicEditorSession({ ...SCOPE, projectId: "t15" }, { store });
    const reloaded = await second.openForProject(invalidProjection(), null);
    expect(reloaded.status).toBe("invalid-projection");
    expect(second.lifecycle).toBe("conflicted");
  });

  it("T17a: editing is structurally rejected while conflicted", async () => {
    const editor = new SchematicEditorSession({ ...SCOPE, projectId: "t17" }, { store: new InMemoryAtomicProjectStore() });
    await editor.openForProject(invalidProjection(), null);
    const rejected = await editor.execute(invalidProjection(), { commandId: "schematic.set-property", label: "edit", buildOperations: () => [] });
    expect(rejected.ok).toBe(false);
    if (rejected.ok) throw new Error("unreachable");
    expect(rejected.reasonCode).toBe("session_conflicted");
    // Lifecycle adoption is refused too — no side door.
    const adoption = await editor.adoptLifecycleProjection(state(100), "attempt");
    expect(adoption.ok).toBe(false);
  });
});

// ─── §4 Consumer gate policy ─────────────────────────────────────────────────

describe("B07.2 §4 — consumer gate", () => {
  const consumers = ["export", "simulation", "pcb-sync", "checkpoint", "edit"] as const;

  it("T17b: export/simulation/pcb-sync/checkpoint/edit are blocked for every non-ready lifecycle and while recovery is pending", () => {
    const lifecycles: Array<SchematicSessionLifecycle | null> = ["unopened", "hydrating", "conflicted", "unavailable", null];
    for (const consumer of consumers) {
      for (const lifecycle of lifecycles) {
        const result = evaluateSchematicConsumerGate({ lifecycle, recoveryPending: false, consumer });
        expect(result.allowed, `${consumer}@${lifecycle}`).toBe(false);
      }
      expect(evaluateSchematicConsumerGate({ lifecycle: "ready", recoveryPending: false, consumer }).allowed).toBe(true);
      // Recovery pending blocks even a nominally ready session.
      expect(evaluateSchematicConsumerGate({ lifecycle: "ready", recoveryPending: true, consumer }).allowed).toBe(false);
    }
  });

  it("T17c: autosave blocks on conflicted/recovery (never re-persists an unresolved projection) but keeps working while the canonical store is merely unavailable or loading", () => {
    expect(evaluateSchematicConsumerGate({ lifecycle: "conflicted", recoveryPending: false, consumer: "autosave" }).allowed).toBe(false);
    expect(evaluateSchematicConsumerGate({ lifecycle: "ready", recoveryPending: true, consumer: "autosave" }).allowed).toBe(false);
    expect(evaluateSchematicConsumerGate({ lifecycle: "ready", recoveryPending: false, consumer: "autosave" }).allowed).toBe(true);
    expect(evaluateSchematicConsumerGate({ lifecycle: "unavailable", recoveryPending: false, consumer: "autosave" }).allowed).toBe(true);
    expect(evaluateSchematicConsumerGate({ lifecycle: "hydrating", recoveryPending: false, consumer: "autosave" }).allowed).toBe(true);
  });
});

// ─── §5 Explicit lifecycle adoption + page structure (supplementary) ─────────

describe("B07.2 §5 — typed lifecycle adoption and page wiring", () => {
  it("adoptLifecycleProjection: validates, quarantines-first, no-ops on known states, refuses invalid states, and is the ONLY rebase path", async () => {
    const h = makeHarness(state(100));
    await h.open();
    // Unknown VALID state → explicit lifecycle rebase (event kind "rebased").
    const generated = state(300, { wires: [] });
    const adoption = await h.editor.adoptLifecycleProjection(generated, "AI-generated schematic applied");
    expect(adoption.ok).toBe(true);
    expect(h.editor.events.filter((e) => e.kind === "rebased")).toHaveLength(1);
    // Now commands run against the adopted head without any further rebase.
    const command = await h.editor.execute(generated, { commandId: "schematic.move-rotate", label: "noop", buildOperations: () => [] });
    expect(command.ok).toBe(true);
    // Idempotent: adopting the same state again is a no-op.
    const again = await h.editor.adoptLifecycleProjection(generated, "again");
    expect(again.ok).toBe(true);
    expect(h.editor.events.filter((e) => e.kind === "rebased")).toHaveLength(1);
    // Invalid replacement refuses.
    const invalid = state(100);
    invalid.components.push({ ...invalid.components[0] });
    const refused = await h.editor.adoptLifecycleProjection(invalid, "bad");
    expect(refused.ok).toBe(false);
  });

  it("page structure (SUPPLEMENT): exhaustive hydration switch with never-guard, invalid-projection dialog wiring, authoritative consumer sources, and no raw-state consumer ingress", () => {
    const source = readFileSync(resolve(process.cwd(), "app/page.tsx"), "utf8");
    // Exhaustive outcome handling with a compile-time never guard.
    expect(source).toContain('case "invalid-projection":');
    expect(source).toContain("const unhandled: never = outcome;");
    // The invalid-projection dialog is persistent (dismissal refused).
    expect(source).toContain('schematicRecovery.kind === "invalid-projection"');
    // Authoritative consumers: export/sim/checkpoint/autosave/PCB all gate
    // and consume the authoritative state, never raw live arrays.
    expect(source).toContain('schematicConsumerGate("export")');
    expect(source).toContain('schematicConsumerGate("simulation")');
    expect(source).toContain('schematicConsumerGate("pcb-sync")');
    expect(source).toContain('consumer: "autosave"');
    expect(source).toContain('consumer: "checkpoint"');
    expect(source).toContain("schematic={authoritativeSchematic}");
    expect(source).not.toContain("schematic={{ components, kicadComponents, wires, netLabels }}");
    expect(source).not.toContain("state: { components, wires, netLabels }");
  });
});
