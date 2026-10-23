/**
 * [PR-J3, 2026-10-22] The shared jsdom harness of the Sheets navigator suites (j3-sheet-lens-hook, j3-sheet-navigator): a page-mimicking
 * host that holds the authoritative schematic exactly as app/page.tsx does, a canonical command runner that applies operations with
 * the executor's own code (`applySchematicOperationsToCanonical`, so every refusal is the real one) and records each command, a
 * view-session bridge with one registered "schematic" surface whose dispatches are recorded, and the fixture drone's IMU split. Not a
 * test file. Nothing here touches disk or the network.
 */
import { act } from "@testing-library/react";
import { useEffect, useState } from "react";
import { vi } from "vitest";
import { ViewSessionBridge } from "@/app/lib/agent/view-session-bridge";
import { applySchematicOperationsToCanonical } from "@/app/lib/engineering/operations";
import type { ProjectAsyncScope } from "@/app/lib/engineering/project-async-scope";
import { fromCanonicalSchematic, toCanonicalSchematic, type CanonicalSchematic } from "@/app/lib/engineering/schematic-model";
import type { EngineeringOperation } from "@/app/lib/engineering/types";
import type { StorageLike } from "@/app/lib/project/sheet-navigation-store";
import { attachedSelection, type PartPinsSource, type SchematicGraphApi } from "@/app/lib/schematic/sheet-lens";
import { planMoveToSheet } from "@/app/lib/schematic/sheet-operations";
import { droneFixtureState, fixturePartLookup } from "@/app/lib/schematic/__tests__/_j1-fixtures";
import type { ViewCommandEnvelope } from "@/app/lib/view-session/types";
import type { SchematicState } from "@/lib/schematic-types";
import { SheetNavigator } from "../SheetNavigator";
import { useSchematicSheetLens, type SchematicSheetLens, type UseSchematicSheetLensInput } from "../hooks/useSchematicSheetLens";

export const lookup = fixturePartLookup();
export const getPart: PartPinsSource = (partId) => lookup(partId);

/** The fixture drone with the IMU (U3, its wires and local labels) on a new child sheet "IMU" (the j1 proof). */
export function imuSplit(): { drone: SchematicState; after: SchematicState; u3Id: string } {
  const drone = droneFixtureState();
  const u3 = drone.kicadComponents!.find((item) => item.refDes === "U3")!;
  const plan = planMoveToSheet(drone, { entities: attachedSelection(drone, { family: "kicad", id: u3.id }, getPart)!, target: { newSheet: { id: "sheet-imu", name: "IMU", block: { x: 3200, y: 600, width: 300, height: 200 } } }, rootName: "Overview", operationIdPrefix: "move-imu" }, lookup);
  if (!plan.ok) throw new Error(`${plan.code}: ${plan.message}`);
  return { drone, after: plan.after, u3Id: u3.id };
}

export interface RecordedCommand { label: string; commandId: string; options: { expectedBaseDigest?: string; scope?: ProjectAsyncScope } | undefined }

/** The page's authoritative state and canonical command runner. */
export class FakePage {
  private state: SchematicState;
  private setter: ((next: SchematicState) => void) | null = null;
  readonly commands: RecordedCommand[] = [];
  readonly failures: string[] = [];
  /** Awaited before each command executes (a deferred command). */
  gate: Promise<void> | null = null;
  /** Rewrites the canonical base the command's buildOperations sees (a base that moved under the preview). */
  baseForBuild: ((canonical: CanonicalSchematic) => CanonicalSchematic) | null = null;
  readonly runSchematicCommand = vi.fn(async (label: string, commandId: string, build: (schematic: CanonicalSchematic) => EngineeringOperation[], options?: { expectedBaseDigest?: string; scope?: ProjectAsyncScope }): Promise<{ ok: boolean; state?: SchematicState }> => {
    this.commands.push({ label, commandId, options });
    if (this.gate) await this.gate;
    const canonical = toCanonicalSchematic(this.state);
    try {
      const operations = build(this.baseForBuild ? this.baseForBuild(canonical) : canonical);
      const applied = applySchematicOperationsToCanonical(canonical, operations);
      const next = fromCanonicalSchematic(applied.schematic);
      this.set(next);
      return { ok: true, state: next };
    } catch (error) {
      this.failures.push(error instanceof Error ? error.message : String(error));
      return { ok: false };
    }
  });

  constructor(initial: SchematicState) { this.state = initial; }
  current(): SchematicState { return this.state; }
  bind(setter: (next: SchematicState) => void): void { this.setter = setter; }
  /** Replace the authoritative state (the page's applier). */
  set(next: SchematicState): void {
    this.state = next;
    const setter = this.setter;
    if (setter) act(() => { setter(next); });
  }
}

/** A graph authority that records calls and keeps `run` callbacks for the test to run later (a queued command). */
export function recordingGraph(): { graph: SchematicGraphApi; calls: Array<{ kind: string; payload: unknown }>; pending: Array<(state: SchematicState) => unknown>; flush: (state: SchematicState) => unknown[] } {
  const calls: Array<{ kind: string; payload: unknown }> = [];
  const pending: Array<(state: SchematicState) => unknown> = [];
  const graph: SchematicGraphApi = {
    run: (label, commandId, buildAfter) => { calls.push({ kind: "run", payload: { label, commandId } }); pending.push(buildAfter); },
    begin: () => { calls.push({ kind: "begin", payload: null }); return true; },
    preview: (frame) => { calls.push({ kind: "preview", payload: frame }); },
    cancel: () => { calls.push({ kind: "cancel", payload: null }); },
    commit: (label, finalGraph) => { calls.push({ kind: "commit", payload: { label, finalGraph } }); },
  };
  return { graph, calls, pending, flush: (state) => pending.splice(0).map((build) => build(state)) };
}

export interface FakeSurface { bridge: ViewSessionBridge; dispatched: ViewCommandEnvelope[]; selection: { id: string | null; family: "theory" | "kicad" | null } }

/** A real bridge with one live "schematic" registration whose dispatches are recorded (the editor's bus stands in). */
export function fakeSurface(projectId = "p1"): FakeSurface {
  const bridge = new ViewSessionBridge();
  const dispatched: ViewCommandEnvelope[] = [];
  const surface: FakeSurface = { bridge, dispatched, selection: { id: null, family: null } };
  bridge.register({
    identity: { sessionId: "schematic-test-session", projectId, branchId: "main", editor: "schematic" },
    isCurrent: () => true,
    viewRevision: () => dispatched.length,
    state: () => ({ selection: { ...surface.selection, digest: "d" } }),
    dispatch: async (envelope) => { dispatched.push(envelope); return { status: "settled", invocationId: envelope.invocationId, commandId: envelope.commandId, viewRevision: dispatched.length, changed: true, rebased: false, state: {} }; },
  });
  return surface;
}

export class MemoryStorage implements StorageLike {
  readonly map = new Map<string, string>();
  getItem(key: string): string | null { return this.map.get(key) ?? null; }
  setItem(key: string, value: string): void { this.map.set(key, value); }
  removeItem(key: string): void { this.map.delete(key); }
}

export interface HarnessProps {
  page: FakePage;
  graph: SchematicGraphApi;
  projectId: string | null;
  storage?: StorageLike | null;
  bridge?: ViewSessionBridge | null;
  selectedKicadId?: string | null;
  selectedId?: string | null;
  captureScope?: UseSchematicSheetLensInput["captureScope"];
  onSheetSwitch?: () => void;
  getPart?: PartPinsSource;
  /** Receives the latest lens after every render. */
  onLens: (lens: SchematicSheetLens) => void;
}

/** The page-mimicking host: the authoritative state, the hook, the overview layer inside an svg and the navigator. */
export function Harness(props: HarnessProps) {
  const { page, graph, projectId, storage, bridge, selectedKicadId, selectedId, captureScope, onSheetSwitch, onLens } = props;
  const [authoritative, setAuthoritative] = useState(() => page.current());
  useEffect(() => { page.bind(setAuthoritative); }, [page]);
  const lens = useSchematicSheetLens({
    authoritative,
    graph,
    runSchematicCommand: page.runSchematicCommand,
    projectId,
    getPart: props.getPart ?? getPart,
    components: authoritative.components,
    wires: authoritative.wires,
    kicadComponents: authoritative.kicadComponents ?? [],
    netLabels: authoritative.netLabels ?? [],
    viewSessionBridge: bridge ?? null,
    ...(selectedKicadId !== undefined ? { selectedKicadId } : {}),
    ...(selectedId !== undefined ? { selectedId } : {}),
    ...(captureScope ? { captureScope } : {}),
    ...(onSheetSwitch ? { onSheetSwitch } : {}),
    ...(storage !== undefined ? { storage } : {}),
  });
  useEffect(() => { onLens(lens); });
  return (
    <div>
      <svg data-testid="harness-canvas" width={100} height={100}>
        <g>{lens.editorProps.sheetLayer}</g>
      </svg>
      <div data-testid="lens" data-activation={lens.activation} data-active={lens.activeSheetId} data-legacy={String(lens.legacy)} data-kicad={lens.kicadComponents.map((item) => item.refDes).join(",")} data-wires={lens.wires.length} data-labels={lens.netLabels.length} />
      <SheetNavigator {...lens.navigatorProps} />
    </div>
  );
}

/** Lets every pending microtask and the hook's effects settle. */
export async function settle(): Promise<void> {
  await act(async () => { for (let tick = 0; tick < 12; tick += 1) await Promise.resolve(); });
}
