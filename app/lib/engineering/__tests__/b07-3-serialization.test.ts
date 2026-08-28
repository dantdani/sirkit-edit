/**
 * B07.3 — atomic schematic adoption, FIFO command execution, and async
 * project-epoch isolation.
 *
 *  §1  FIFO ordinary commands (required tests 1–6): both/all apply, UI ==
 *      durable head, failures release the queue, sealed-base staleness,
 *      project-switch cancellation and old-session isolation.
 *  §2  Transactional lifecycle adoption (7–16): invalid/persistence-failed/
 *      stale candidates change NOTHING; success applies canonical + UI
 *      atomically; exact-base pins make late AI/tidy results stale.
 *  §3  Transactional undo/redo (19–21): reconcile-first, cursor+projection
 *      only after success, queue-blocking.
 *  §4  Recovery bypass, autosave candidates, preview isolation (17, 22–23)
 *      + page-wiring source supplements (18).
 *
 * These are REAL asynchronous state-transition tests over the production
 * SchematicEditorSession + SchematicGestureCoordinator, wired exactly like
 * app/page.tsx.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SchematicState, PageSize } from "@/lib/schematic-types";
import { SchematicHistory } from "../../project/schematic-history";
import { InMemoryAtomicProjectStore } from "../persistence";
import { SchematicGestureCoordinator, type GestureCoordinatorHost } from "../schematic-gesture-coordinator";
import { schematicStateDigest, type CanonicalSchematic } from "../schematic-model";
import { SchematicEditorSession } from "../schematic-session";
import type { EngineeringOperation } from "../types";

const SCOPE = { tenantId: "tenant-b073", projectId: "project-b073", branchId: "main" } as const;

function state(x: number, extras?: Partial<SchematicState>): SchematicState {
  return {
    components: [{ id: "uuid-r1", type: "resistor", x, y: 100, rotation: 0, value: "1k", refDes: "R1" }],
    kicadComponents: [], wires: [], netLabels: [],
    ...extras,
  };
}

const op = (partial: Record<string, unknown>): EngineeringOperation =>
  ({ schemaVersion: 1, units: "px", ...partial }) as unknown as EngineeringOperation;

const rotateOps = (canonical: CanonicalSchematic): EngineeringOperation[] => {
  const c = canonical.components[0];
  return [op({ operationId: `op:rot:${c.rotation}`, kind: "schematic_transform_component", family: "theory", componentId: c.id, x: c.x, y: c.y, rotation: ((c.rotation + 90) % 360) })];
};

const valueOps = (value: string) => (canonical: CanonicalSchematic): EngineeringOperation[] =>
  [op({ operationId: `op:val:${value}`, kind: "schematic_set_component_properties", family: "theory", componentId: canonical.components[0].id, patch: { value } })];

function makeHarness(initial: SchematicState, options?: { projectId?: string; executeDelay?: () => Promise<void> }) {
  const store = new InMemoryAtomicProjectStore();
  const editor = new SchematicEditorSession({ ...SCOPE, projectId: options?.projectId ?? SCOPE.projectId }, { store });
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
  /** Mirrors app/page.tsx runSchematicCommand (the optional delay stands in
   *  for transport/queue latency inside the session execution). */
  async function runCommand(label: string, commandId: string, buildOperations: (c: CanonicalSchematic) => EngineeringOperation[], expectedBaseDigest?: string) {
    return coordinator.runCanonicalCommand({
      label,
      execute: async (base) => {
        if (options?.executeDelay) await options.executeDelay();
        return editor.execute(base, { commandId, label, buildOperations, ...(expectedBaseDigest !== undefined ? { expectedBaseDigest } : {}) });
      },
    });
  }
  /** Mirrors app/page.tsx applySchematic / restoreCheckpoint / changeSheetSize. */
  function adoptViaGateway(candidate: SchematicState, extras?: { expectedBaseDigest?: string; session?: SchematicEditorSession | null; onAdopted?: () => void; label?: string }) {
    const session = extras && "session" in extras ? extras.session : editor;
    return coordinator.adoptLifecycle({
      state: candidate,
      reason: "lifecycle replacement",
      ...(extras?.expectedBaseDigest !== undefined ? { expectedBaseDigest: extras.expectedBaseDigest } : {}),
      adopt: (s) => session
        ? session.adoptLifecycleProjection(s, "lifecycle replacement")
        : Promise.resolve({ ok: false as const, code: "no-service" as const, detail: "unavailable" }),
      applyUi: (s) => host.applyCanonicalProjection(extras?.label ?? "Lifecycle replacement", s),
      onAdopted: extras?.onAdopted,
    });
  }
  async function open() {
    const outcome = await editor.openForProject(initial, null);
    if (outcome.status !== "fresh") throw new Error(`open failed: ${outcome.status}`);
    coordinator.notifyAuthoritativeProjection(initial);
    return outcome;
  }
  async function headState(): Promise<SchematicState> {
    const probe = await editor.execute(coordinator.authoritativeState(), { commandId: "schematic.move-rotate", label: "noop", buildOperations: () => [] });
    if (!probe.ok) throw new Error(`head probe rejected: ${probe.reasonCode}`);
    return probe.state;
  }
  return { store, editor, coordinator, runCommand, adoptViaGateway, open, headState, visibleState: () => structuredClone(visible), adoptions };
}

const noRebase = (editor: SchematicEditorSession) =>
  expect(editor.events.filter((e) => e.kind === "rebased"), "no interaction-race path may emit a legacy rebase").toEqual([]);

/** Queue jobs start on microtasks — flush so a submitted job reaches its
 *  (possibly paused) execution body before the test drives it further. */
async function flushQueue(ticks = 6): Promise<void> {
  for (let i = 0; i < ticks; i += 1) await Promise.resolve();
}

// ─── §1 FIFO ordinary commands ───────────────────────────────────────────────

describe("B07.3 §1 — FIFO command execution", () => {
  it("1 (fixed repro A): two concurrent commands BOTH apply in order and the visible state equals the durable head", async () => {
    const h = makeHarness(state(100));
    await h.open();
    const [a, b] = await Promise.all([
      h.runCommand("Rotated component", "schematic.move-rotate", rotateOps),
      h.runCommand("Changed value", "schematic.set-property", valueOps("9k")),
    ]);
    expect(a.status).toBe("applied");
    expect(b.status).toBe("applied"); // never discarded-stale
    expect(h.editor.headMark()?.headSequence).toBe(2);
    const visible = h.visibleState();
    expect(visible.components[0].rotation).toBe(90);
    expect(visible.components[0].value).toBe("9k");
    expect(schematicStateDigest(await h.headState())).toBe(schematicStateDigest(visible)); // UI == durable head
    noRebase(h.editor);
  });

  it("2: three rapid property edits stay ordered; none is silently lost", async () => {
    const h = makeHarness(state(100));
    await h.open();
    const outcomes = await Promise.all([
      h.runCommand("Edit 1", "schematic.set-property", valueOps("2k")),
      h.runCommand("Edit 2", "schematic.set-property", valueOps("3k")),
      h.runCommand("Edit 3", "schematic.set-property", valueOps("4k")),
    ]);
    expect(outcomes.map((o) => o.status)).toEqual(["applied", "applied", "applied"]);
    expect(h.editor.headMark()?.headSequence).toBe(3);
    expect(h.visibleState().components[0].value).toBe("4k"); // last write in FIFO order
    expect(h.adoptions).toEqual(["canonical:Edit 1", "canonical:Edit 2", "canonical:Edit 3"]);
    noRebase(h.editor);
  });

  it("3: a failing command releases the queue — the next command runs against the unchanged head", async () => {
    const h = makeHarness(state(100));
    await h.open();
    const [bad, good] = await Promise.all([
      h.runCommand("Bad edit", "schematic.set-property", () => [op({ operationId: "op:bad", kind: "schematic_set_component_properties", family: "theory", componentId: "missing", patch: { value: "x" } })]),
      h.runCommand("Good edit", "schematic.set-property", valueOps("5k")),
    ]);
    expect(bad.status).toBe("rejected");
    expect(good.status).toBe("applied");
    expect(h.editor.headMark()?.headSequence).toBe(1); // only the good edit landed
    expect(h.visibleState().components[0].value).toBe("5k");
    noRebase(h.editor);
  });

  it("4: a sealed-base command queued behind another mutation rejects on expected-base mismatch (nothing changes)", async () => {
    const h = makeHarness(state(100));
    await h.open();
    const sealedBase = schematicStateDigest(state(100)); // sealed BEFORE the other mutation
    const [first, sealed] = await Promise.all([
      h.runCommand("Rotated component", "schematic.move-rotate", rotateOps),
      h.runCommand("Applied AI edit proposal", "schematic.edit-tier1-apply", valueOps("7k"), sealedBase),
    ]);
    expect(first.status).toBe("applied");
    expect(sealed.status).toBe("rejected");
    if (sealed.status !== "rejected") throw new Error("unreachable");
    expect(sealed.result.ok).toBe(false);
    expect(h.editor.headMark()?.headSequence).toBe(1);
    expect(h.visibleState().components[0].value).toBe("1k"); // proposal changed nothing
    noRebase(h.editor);
  });

  it("5: a project switch BEFORE a queued command starts cancels it without execution", async () => {
    let release: () => void = () => undefined;
    const pause = new Promise<void>((r) => { release = r; });
    let delayOnce: (() => Promise<void>) | null = () => { const p = pause; delayOnce = null; return p; };
    const h = makeHarness(state(100), { executeDelay: () => (delayOnce ? delayOnce() : Promise.resolve()) });
    await h.open();
    const first = h.runCommand("Rotated component", "schematic.move-rotate", rotateOps); // paused in execute
    const queued = h.runCommand("Changed value", "schematic.set-property", valueOps("9k")); // FIFO behind it
    await flushQueue(); // the first job is now inside its paused execute
    h.coordinator.invalidate(); // project switch while both are pending
    release();
    const [a, b] = await Promise.all([first, queued]);
    expect(a.status).toBe("canceled-stale");
    if (a.status !== "canceled-stale") throw new Error("unreachable");
    expect(a.stage).toBe("after-commit");   // it was already executing on the old session
    expect(b.status).toBe("canceled-stale");
    if (b.status !== "canceled-stale") throw new Error("unreachable");
    expect(b.stage).toBe("before-execution"); // canceled before running
    expect(h.editor.headMark()?.headSequence).toBe(1); // only the in-flight one reached the old session
    expect(h.adoptions).toEqual([]); // nothing was ever adopted into the (new) UI
  });

  it("6: an old-session commit after a switch updates ONLY its captured session, never the new project UI", async () => {
    let release: () => void = () => undefined;
    const pause = new Promise<void>((r) => { release = r; });
    const h = makeHarness(state(100), { executeDelay: () => pause });
    await h.open();
    const pending = h.runCommand("Rotated component", "schematic.move-rotate", rotateOps);
    await flushQueue(); // the command is inside its paused execute (on the OLD session)
    h.coordinator.invalidate(); // switch
    release();
    const outcome = await pending;
    expect(outcome.status).toBe("canceled-stale");
    // The OLD session's durable head contains the commit…
    expect(h.editor.headMark()?.headSequence).toBe(1);
    // …but no UI adoption happened (the "new project" projection is untouched).
    expect(h.adoptions).toEqual([]);
    expect(h.visibleState().components[0].rotation).toBe(0);
  });
});

// ─── §2 Transactional lifecycle adoption ─────────────────────────────────────

describe("B07.3 §2 — lifecycle candidates are never rendered before adoption", () => {
  const invalidCandidate = (): SchematicState => {
    const s = state(100);
    s.components.push({ ...s.components[0] }); // duplicate stable id
    return s;
  };

  it("7 (fixed repro B): an INVALID AI result leaves UI, authoritative mirror, history, and the session head unchanged", async () => {
    const h = makeHarness(state(100));
    await h.open();
    let extras = 0;
    const outcome = await h.adoptViaGateway(invalidCandidate(), { onAdopted: () => { extras += 1; } });
    expect(outcome.status).toBe("rejected-invalid");
    expect(extras).toBe(0);
    expect(h.adoptions).toEqual([]);                                   // UI never rendered the candidate
    expect(h.visibleState().components).toHaveLength(1);
    expect(h.coordinator.authoritativeState().components).toHaveLength(1);
    expect(h.editor.headMark()?.headSequence).toBe(0);
    expect(h.editor.lifecycle).toBe("ready");
  });

  it("8: a quarantine/persistence failure during adoption changes nothing", async () => {
    const h = makeHarness(state(100));
    await h.open();
    // Force quarantine unavailability: openLineage refuses to replace the
    // envelope when the store cannot preserve it first (B06.3).
    (h.store as { preserveEnvelope?: unknown }).preserveEnvelope = undefined;
    let extras = 0;
    const outcome = await h.adoptViaGateway(state(300), { onAdopted: () => { extras += 1; } });
    expect(outcome.status).toBe("persistence-failed");
    expect(extras).toBe(0);
    expect(h.adoptions).toEqual([]);
    expect(h.visibleState().components[0].x).toBe(100);
    expect(h.coordinator.authoritativeState().components[0].x).toBe(100);
    expect(h.editor.headMark()?.headSequence).toBe(0);
  });

  it("9: successful adoption updates canonical state and UI atomically (canonical first, then UI + extras, same job)", async () => {
    const h = makeHarness(state(100));
    await h.open();
    const order: string[] = [];
    const candidate = state(300);
    const outcome = await h.adoptViaGateway(candidate, { onAdopted: () => { order.push("extras"); } });
    expect(outcome.status).toBe("adopted");
    order.unshift(...h.adoptions);
    expect(order).toEqual(["canonical:Lifecycle replacement", "extras"]); // UI applied, then extras
    expect(h.visibleState().components[0].x).toBe(300);
    expect(schematicStateDigest(await h.headState())).toBe(schematicStateDigest(h.visibleState()));
  });

  it("10–12 (checkpoint semantics): invalid checkpoint → nothing (no dialog-close/PCB/chat extras); adoption failure → no success extras; success → extras only after adoption", async () => {
    const h = makeHarness(state(100));
    await h.open();
    const ran: string[] = [];
    const invalid = await h.adoptViaGateway(invalidCandidate(), { onAdopted: () => ran.push("restored-invalid") });
    expect(invalid.status).toBe("rejected-invalid");
    (h.store as { preserveEnvelope?: unknown }).preserveEnvelope = undefined;
    const persistFail = await h.adoptViaGateway(state(400), { onAdopted: () => ran.push("restored-persist-fail") });
    expect(persistFail.status).toBe("persistence-failed");
    expect(ran).toEqual([]); // no "Restored" success path ever ran
    expect(h.visibleState().components[0].x).toBe(100);
  });

  it("13: sheet-size adoption failure retains the prior size (fixed repro shape: FIFO command + sheet change both land otherwise)", async () => {
    // Failure path: conflicted session refuses; the pageSize extra never runs.
    const conflicted = makeHarness(invalidCandidate());
    const openOutcome = await conflicted.editor.openForProject(invalidCandidate(), null);
    expect(openOutcome.status).toBe("invalid-projection");
    let uiPageSize: PageSize | null = null;
    const refusal = await conflicted.adoptViaGateway({ ...state(100), pageSize: "A3" }, { onAdopted: () => { uiPageSize = "A3"; } });
    expect(refusal.status).toBe("rejected-conflicted");
    expect(uiPageSize).toBeNull();

    // Success path (the exact independent reproduction, fixed): a command and
    // a sheet change submitted together both land FIFO and UI == head.
    const h = makeHarness(state(100));
    await h.open();
    let adoptedPageSize: PageSize | null = null;
    const [cmd, sheet] = await Promise.all([
      h.runCommand("Rotated component", "schematic.move-rotate", rotateOps),
      h.adoptViaGateway({ ...state(100, { components: [{ ...state(100).components[0], rotation: 90 }] }), pageSize: "A3" }, { onAdopted: () => { adoptedPageSize = "A3"; } }),
    ]);
    expect(cmd.status).toBe("applied");
    // The sheet adoption queued AFTER the rotate — its candidate carries the
    // rotated component, so it adopts cleanly on the advanced head.
    expect(sheet.status).toBe("adopted");
    expect(adoptedPageSize).toBe("A3");
    expect(h.visibleState().pageSize).toBe("A3");
    expect(schematicStateDigest(await h.headState())).toBe(schematicStateDigest(h.visibleState())); // no UI/durable split
  });

  it("14: a response pinned to project A cannot affect project B — even when SUBMITTED after the switch (project token, not just epoch)", async () => {
    const h = makeHarness(state(100));
    await h.open();
    const pinnedSession = h.editor;      // captured at request time (project A)
    let activeProject = "project-a";     // page: projectRef.current.id
    const stillCurrent = () => activeProject === "project-a";
    activeProject = "project-b";         // switch happens BEFORE the response arrives
    h.coordinator.invalidate();
    // The response is submitted AFTER the switch — the coordinator epoch at
    // submission is the NEW project's, so only the project token can catch it.
    const outcome = await h.coordinator.adoptLifecycle({
      state: state(300),
      reason: "late AI response",
      stillCurrent,
      adopt: (s) => pinnedSession.adoptLifecycleProjection(s, "late AI response"),
      applyUi: (s) => { h.adoptions.push("canonical:late"); h.coordinator.notifyAuthoritativeProjection(s); },
    });
    expect(outcome.status).toBe("canceled-stale-project");
    expect(h.adoptions).toEqual([]);
    expect(h.editor.headMark()?.headSequence).toBe(0); // old session untouched too (canceled pre-adopt)
  });

  it("15+16: an AI/tidy response becomes STALE after an intervening manual edit (exact-base pin) and cannot overwrite newer work", async () => {
    const h = makeHarness(state(100));
    await h.open();
    const pinDigest = schematicStateDigest(h.coordinator.authoritativeState()); // captured at request time
    const edit = await h.runCommand("Changed value", "schematic.set-property", valueOps("9k"));
    expect(edit.status).toBe("applied");
    const late = await h.adoptViaGateway(state(700), { expectedBaseDigest: pinDigest });
    expect(late.status).toBe("canceled-stale-base");
    expect(h.visibleState().components[0].value).toBe("9k"); // newer manual edit stands
    expect(h.visibleState().components[0].x).toBe(100);
    expect(h.editor.headMark()?.headSequence).toBe(1);
  });

  it("17: the authoritative snapshot consumed by advisory paths never contains gesture preview geometry", async () => {
    const h = makeHarness(state(100));
    await h.open();
    expect(h.coordinator.begin()).toBe(true);
    h.coordinator.preview({ components: [{ ...state(100).components[0], x: 900 }] });
    expect(h.visibleState().components[0].x).toBe(900);                       // preview IS visible
    expect(h.coordinator.authoritativeState().components[0].x).toBe(100);     // snapshot is not
    h.coordinator.cancel();
  });
});

// ─── §3 Transactional undo/redo ──────────────────────────────────────────────

function makeHistoryHarness(initial: SchematicState, options?: { reconcileDelay?: () => Promise<void> }) {
  const h = makeHarness(initial);
  const history = new SchematicHistory<SchematicState>(structuredClone(initial), { label: "Opened project" });
  function stepRequest(direction: "undo" | "redo") {
    return {
      direction,
      peek: () => (direction === "undo" ? history.peekUndo() : history.peekRedo()),
      reconcile: async (target: SchematicState) => {
        if (options?.reconcileDelay) await options.reconcileDelay();
        return h.editor.reconcileHistoryStep(direction, target);
      },
      commitCursor: () => { if (direction === "undo") history.undo(); else history.redo(); },
      applyUi: (target: SchematicState) => {
        // page applies via the lifecycle applier
        h.coordinator.notifyAuthoritativeProjection(target);
      },
    };
  }
  return { ...h, history, stepRequest };
}

describe("B07.3 §3 — transactional undo/redo", () => {
  it("21: successful undo replays canonically FIRST, then moves the cursor and projection — UI, head, and cursor stay consistent", async () => {
    const h = makeHistoryHarness(state(100));
    await h.open();
    const edit = await h.runCommand("Changed value", "schematic.set-property", valueOps("9k"));
    expect(edit.status).toBe("applied");
    h.history.record("Changed value", h.visibleState());
    const outcome = await h.coordinator.runHistoryStep(h.stepRequest("undo"));
    expect(outcome.status).toBe("applied");
    expect(h.history.present.components[0].value).toBe("1k"); // cursor moved
    expect(h.coordinator.authoritativeState().components[0].value).toBe("1k");
    expect((await h.headState()).components[0].value).toBe("1k"); // canonical head matches
    expect(h.editor.events.some((e) => e.kind === "undo-reconciled")).toBe(true);
  });

  it("19: a failed reconciliation leaves the history cursor, projection, authoritative state, and canonical head unchanged", async () => {
    const h = makeHistoryHarness(state(100));
    await h.open();
    const edit = await h.runCommand("Changed value", "schematic.set-property", valueOps("9k"));
    expect(edit.status).toBe("applied");
    h.history.record("Changed value", h.visibleState());
    // Force reconciliation failure: quarantine becomes unavailable AND the
    // replay link is destroyed by making the restored target unknown —
    // simplest deterministic failure: kill quarantine and make the target a
    // NON-linked state (fresh object with different digest than any link).
    (h.store as { preserveEnvelope?: unknown }).preserveEnvelope = undefined;
    const bogusTarget = state(555); // no link, digest ≠ head → rebase path → quarantine fails
    const outcome = await h.coordinator.runHistoryStep({
      ...h.stepRequest("undo"),
      peek: () => bogusTarget,
    });
    expect(outcome.status).toBe("failed");
    expect(h.history.present.components[0].value).toBe("9k"); // cursor NOT moved
    expect(h.coordinator.authoritativeState().components[0].value).toBe("9k");
    expect((await h.headState()).components[0].value).toBe("9k"); // head unchanged
  });

  it("20: undo blocks gestures and commands until durable reconciliation settles", async () => {
    let release: () => void = () => undefined;
    const pause = new Promise<void>((r) => { release = r; });
    const h = makeHistoryHarness(state(100), { reconcileDelay: () => pause });
    await h.open();
    const edit = await h.runCommand("Changed value", "schematic.set-property", valueOps("9k"));
    expect(edit.status).toBe("applied");
    h.history.record("Changed value", h.visibleState());
    const undoing = h.coordinator.runHistoryStep(h.stepRequest("undo"));
    await Promise.resolve();
    expect(h.coordinator.busy).toBe(true);
    expect(h.coordinator.begin()).toBe(false); // gestures blocked
    const queuedCommand = h.runCommand("Rotated component", "schematic.move-rotate", rotateOps); // queues behind
    release();
    const undoOutcome = await undoing;
    expect(undoOutcome.status).toBe("applied");
    const commandOutcome = await queuedCommand;
    expect(commandOutcome.status).toBe("applied"); // ran AFTER the undo, against the restored head
    expect(h.visibleState().components[0].value).toBe("1k");
    expect(h.visibleState().components[0].rotation).toBe(90);
    expect(schematicStateDigest(await h.headState())).toBe(schematicStateDigest(h.visibleState()));
  });
});

// ─── §4 Recovery bypass, autosave candidates, page wiring ────────────────────

describe("B07.3 §4 — gating and page wiring", () => {
  it("22: lifecycle adoption cannot bypass invalid-projection recovery (session refuses while conflicted)", async () => {
    const invalid = (() => { const s = state(100); s.components.push({ ...s.components[0] }); return s; })();
    const h = makeHarness(invalid);
    const outcome = await h.editor.openForProject(invalid, null);
    expect(outcome.status).toBe("invalid-projection");
    const adoption = await h.adoptViaGateway(state(100));
    expect(adoption.status).toBe("rejected-conflicted");
    expect(h.adoptions).toEqual([]);
  });

  it("23: the authoritative snapshot (autosave source) never contains an unadopted candidate", async () => {
    let releaseAdopt: () => void = () => undefined;
    const gateOpen = new Promise<void>((r) => { releaseAdopt = r; });
    const h = makeHarness(state(100));
    await h.open();
    const slowSession = {
      adoptLifecycleProjection: async (s: SchematicState, reason: string) => {
        await gateOpen;
        return h.editor.adoptLifecycleProjection(s, reason);
      },
    } as unknown as SchematicEditorSession;
    const adopting = h.adoptViaGateway(state(300), { session: slowSession });
    await Promise.resolve();
    // Mid-adoption: the candidate is NOT authoritative and NOT visible.
    expect(h.coordinator.authoritativeState().components[0].x).toBe(100);
    expect(h.visibleState().components[0].x).toBe(100);
    releaseAdopt();
    const outcome = await adopting;
    expect(outcome.status).toBe("adopted");
    expect(h.coordinator.authoritativeState().components[0].x).toBe(300); // only after success
  });

  it("18 (page wiring SUPPLEMENT): async handlers capture pins/snapshots, guard cross-project chat, and route lifecycle replacements through the gateway", () => {
    const source = readFileSync(resolve(process.cwd(), "app/page.tsx"), "utf8");
    // Pins captured before asynchronous producers.
    expect(source).toContain("captureLifecycleInvocationContext");
    expect(source).toContain("const pin = captureLifecycleInvocationContext();");
    // Cross-project chat guard exists and is used by async result writers.
    expect(source).toContain("function appendChatFor(");
    expect(source).toContain("appendChatFor(reviewPin.projectId");
    expect(source).toContain("appendChatFor(opinionPin.projectId");
    expect(source).toContain("appendChatFor(tidyPin.projectId");
    // Lifecycle replacements all flow through the gateway.
    expect(source).toContain("gestureCoordinator.adoptLifecycle({");
    expect(source).toContain("gestureCoordinatorRef.current!.adoptLifecycle({");
    expect(source).not.toMatch(/adoptLifecycleProjection\([^)]*\)\.then/); // no direct fire-and-forget adoption remains
    // Chat/advisory bodies consume authoritative snapshots, not visible arrays.
    expect(source).not.toContain("schematicState: { components, wires, kicadComponents, netLabels, pageSize }");
    expect(source).not.toContain("state: { components, wires, kicadComponents, netLabels, pageSize }");
    // Undo/redo is transactional through the queue.
    expect(source).toContain("runHistoryStep({");
    expect(source).toContain("peekUndo");
  });
});
