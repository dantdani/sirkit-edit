/**
 * [PR-J5, 2026-10-23] Runbook J.8.3 / OD-255 item 9 / OD-259 items 1-2: the Approve of a generated design laid out as SHEETS
 * (lib/build-sheet-layout.ts) replaces the project as ONE undoable transaction, over the PRODUCTION SchematicEditorSession and
 * SchematicGestureCoordinator wired as app/page.tsx applySchematic wires them (the b07-3 harness shape). What it proves:
 *
 *  1. over the J3 multi-sheet project (Overview, Power, Motor drivers, IMU): the final apply guard lets the sheeted result through, ONE
 *     lifecycle adoption replaces every sheet (one lineage rebase, one UI projection), the project holds the generated tree
 *     (System overview + 4 sheets, 41 instances) and its project connectivity is ok and multi-sheet;
 *  2. ONE undo restores the previous multi-sheet document exactly (its content digest, its sheets); ONE redo brings the generated design
 *     back;
 *  3. a FLAT result over the same project is refused by that guard before any adoption (the page returns before adoptLifecycle), and
 *     at the offer the derivation's kept-flat findings say why it is one page;
 *  4. over a single-sheet project the sheeted result is adopted the same way, and undo restores the flat page (no tree).
 * No network, no provider; an in-memory atomic store.
 */
import { describe, expect, it } from "vitest";
import { InMemoryAtomicProjectStore } from "@/app/lib/engineering/persistence";
import { SchematicGestureCoordinator, type GestureCoordinatorHost } from "@/app/lib/engineering/schematic-gesture-coordinator";
import { schematicStateDigest } from "@/app/lib/engineering/schematic-model";
import { SchematicEditorSession } from "@/app/lib/engineering/schematic-session";
import { resolveProjectConnectivity } from "@/app/lib/schematic/project-connectivity";
import { multiSheetDroneFixtureState } from "@/app/lib/schematic/__tests__/_j3-fixtures";
import { droneFixtureState } from "@/app/lib/schematic/__tests__/_j1-fixtures";
import { autoLayoutBuildValidated } from "@/lib/build-auto-layout";
import { layoutGeneratedSheets } from "@/lib/build-sheet-layout";
import type { SchematicState } from "@/lib/schematic-types";
import { J5_FIXTURE_CATALOG, generatedDrone, j5FixtureLookup } from "@/app/lib/__tests__/_j5-generated-drone";
import { SchematicHistory } from "../schematic-history";
import { flatReplacementRefusal, flatReplacementRefusalWithFindings, multiSheetReplaceRefusal } from "../sheet-replace-guard";

const SCOPE = { tenantId: "local", projectId: "p-j5-sheeted-replace", branchId: "main" } as const;
const SEED = "eng1-5eed5eed5eed5eed5eed5eed5eed5eed";
const LABEL = "Generated schematic: build me a simple drone controlling circuitly with 4 motors";

/** The page's applySchematic `appliedState`: the four arrays, the page size, and the tree iff present (J3's carriage). */
function asApplied(state: SchematicState, livePageSize?: SchematicState["pageSize"]): SchematicState {
  return {
    components: state.components, wires: state.wires,
    kicadComponents: state.kicadComponents ?? [], netLabels: state.netLabels ?? [],
    ...(state.pageSize ? { pageSize: state.pageSize } : { ...(livePageSize ? { pageSize: livePageSize } : {}) }), ...(state.sheets !== undefined ? { sheets: state.sheets } : {}),
  };
}

function harness(initial: SchematicState) {
  const editor = new SchematicEditorSession(SCOPE, { store: new InMemoryAtomicProjectStore() });
  let visible = structuredClone(initial);
  const projections: string[] = [];
  const host: GestureCoordinatorHost = {
    currentState: () => structuredClone(visible),
    applyPreviewFrame: (frame) => { visible = { ...visible, ...(frame as Partial<SchematicState>) }; },
    applyCanonicalProjection: (label, state) => { visible = structuredClone(state); projections.push(label); coordinator.notifyAuthoritativeProjection(state); },
    applyRollbackProjection: (state) => { visible = structuredClone(state); projections.push("rollback"); coordinator.notifyAuthoritativeProjection(state); },
    execute: async (base, request) => editor.execute(base, request),
    notify: () => undefined,
  };
  const coordinator = new SchematicGestureCoordinator(host);
  const history = new SchematicHistory<SchematicState>(structuredClone(initial), { label: "Opened project" });
  const step = (direction: "undo" | "redo") => coordinator.runHistoryStep({
    direction,
    peek: () => (direction === "undo" ? history.peekUndo() : history.peekRedo()),
    reconcile: async (target: SchematicState) => editor.reconcileHistoryStep(direction, target),
    commitCursor: () => { if (direction === "undo") history.undo(); else history.redo(); },
    applyUi: (target: SchematicState) => { visible = structuredClone(target); coordinator.notifyAuthoritativeProjection(target); },
  });
  /** app/page.tsx applySchematic: the final guard, then ONE lifecycle adoption pinned to the base it was offered against. */
  async function apply(state: SchematicState): Promise<{ refused: string } | { status: string }> {
    const applied = asApplied(state, coordinator.authoritativeState().pageSize);
    const refusal = flatReplacementRefusal(coordinator.authoritativeState(), applied);
    if (refusal !== null) return { refused: refusal };
    const outcome = await coordinator.adoptLifecycle({
      state: applied,
      reason: "AI-generated schematic applied",
      expectedBaseDigest: schematicStateDigest(coordinator.authoritativeState()),
      adopt: (candidate) => editor.adoptLifecycleProjection(candidate, "AI-generated schematic applied"),
      applyUi: (candidate) => host.applyCanonicalProjection(LABEL, candidate),
    });
    if (outcome.status === "adopted") history.record(LABEL, structuredClone(visible));
    return { status: outcome.status };
  }
  return {
    editor, coordinator, history, projections, step, apply,
    async open() {
      const outcome = await editor.openForProject(structuredClone(initial), null);
      if (outcome.status !== "fresh") throw new Error(`open failed: ${outcome.status}`);
      coordinator.notifyAuthoritativeProjection(initial);
    },
  };
}

function sheetedDrone(): SchematicState {
  const { netlist, set } = generatedDrone(4, false);
  const layout = layoutGeneratedSheets(netlist, set, J5_FIXTURE_CATALOG, { seed: SEED });
  if (layout.kind !== "sheets") throw new Error(layout.finding);
  return layout.state;
}
const flatDrone = (): SchematicState => autoLayoutBuildValidated(generatedDrone(4, false).netlist, J5_FIXTURE_CATALOG).state;

describe("[PR-J5] a generated multi-sheet design replaces a multi-sheet project as ONE undoable transaction", () => {
  it("1-2. one adoption replaces every sheet; one undo restores the previous document; one redo re-applies", async () => {
    const base = multiSheetDroneFixtureState();
    const h = harness(base);
    await h.open();
    const generated = sheetedDrone();
    const before = h.editor.headMark()!;
    expect(await h.apply(generated)).toEqual({ status: "adopted" });
    // ONE lifecycle adoption: the canonical lineage is rebased onto the replacement once (the prior history quarantined), ONE projection
    expect(h.editor.headMark()!.lineageId).not.toBe(before.lineageId);
    expect(h.editor.events.filter((event) => event.kind === "rebased")).toHaveLength(1);
    expect(h.projections).toEqual([LABEL]);
    const now = h.coordinator.authoritativeState();
    expect(now.sheets!.sheets.map((sheet) => sheet.name)).toEqual(["System overview", "Power input and 3.3 V regulator", "Motor driver stages", "Flight controller MCU", "IMU"]);
    expect(now.sheets!.sheets.some((sheet) => base.sheets!.sheets.slice(1).some((old) => old.id === sheet.id))).toBe(false); // every previous child sheet is gone
    expect(now.kicadComponents).toHaveLength(41);
    expect(schematicStateDigest(now)).toBe(schematicStateDigest(asApplied(generated)));
    const conn = resolveProjectConnectivity(now, j5FixtureLookup);
    expect(conn.ok).toBe(true);
    expect(conn.mode).toBe("multi-sheet");
    expect(h.history.present.sheets!.sheets).toHaveLength(5);

    expect(await h.step("undo")).toEqual({ status: "applied" });
    expect(schematicStateDigest(h.coordinator.authoritativeState())).toBe(schematicStateDigest(base));
    expect(h.coordinator.authoritativeState().sheets).toEqual(base.sheets);
    expect(await h.step("redo")).toEqual({ status: "applied" });
    expect(schematicStateDigest(h.coordinator.authoritativeState())).toBe(schematicStateDigest(asApplied(generated)));
  });

  it("3. a FLAT result over the multi-sheet project is refused at the final guard before any adoption; the offer says why it is one page", async () => {
    const base = multiSheetDroneFixtureState();
    const h = harness(base);
    await h.open();
    const before = h.editor.headMark()!;
    const outcome = await h.apply(flatDrone());
    expect(outcome).toEqual({ refused: multiSheetReplaceRefusal(base) });
    expect(h.editor.headMark()).toEqual(before);
    expect(h.editor.events.filter((event) => event.kind === "rebased")).toEqual([]);
    expect(h.projections).toEqual([]);
    expect(schematicStateDigest(h.coordinator.authoritativeState())).toBe(schematicStateDigest(base));
    const refusal = (outcome as { refused: string }).refused;
    // [PR-J5 integration, 2026-10-23] pin move (review B-5; was the whole finding appended): the banner is bounded to SHEET_REPLACE_GUARD_MAX_MESSAGE_LENGTH -
    // the "Why it is one page" tail is cut with "…" (the findings stay whole in the activity entry's steps); the refusal itself is never cut
    const withWhy = flatReplacementRefusalWithFindings(refusal, ["Kept on one page: PWM1 is labelled in A, B but is not a planned shared net."]);
    expect(withWhy.startsWith(`${refusal} Why it is one page: PWM1 is labelled in A, B`)).toBe(true);
    expect(withWhy.length).toBeLessThanOrEqual(240);
    expect(withWhy.endsWith("…")).toBe(true);
  });

  it("4. over a single-sheet project the sheeted result is adopted the same way; undo restores the flat page with no tree", async () => {
    const base = droneFixtureState();
    expect(base.sheets).toBeUndefined();
    const h = harness(base);
    await h.open();
    expect(await h.apply(sheetedDrone())).toEqual({ status: "adopted" });
    expect(h.coordinator.authoritativeState().sheets!.sheets).toHaveLength(5);
    expect(await h.step("undo")).toEqual({ status: "applied" });
    expect(h.coordinator.authoritativeState().sheets).toBeUndefined();
    expect(schematicStateDigest(h.coordinator.authoritativeState())).toBe(schematicStateDigest(base));
  });
});
