// @vitest-environment jsdom
/**
 * [PR-J3 integration, 2026-10-23] Review J3-PAGE-1: the BOARD checkpoint (app/components/pcb/PcbEditor.tsx `boardCheckpoint`, written at
 * placement / route / sync / release) is the twelfth site that rebuilds the schematic fields from the whole `authoritativeSchematic`,
 * and it dropped `sheets`: on an organised project it stored a flat schematic whose entities still carried `sheetId`, which (a) could
 * never be restored - the session refuses a projection that fails the sheet contract - and (b) made the project file exported
 * afterwards un-importable, since the importer validates every checkpoint's schematic and refused the WHOLE file.
 *
 *  1. source pin: PcbEditor.tsx carries the tree and the page size iff present (the literal), never the flat four-field literal;
 *  2. a board checkpoint of the organised fixture, rebuilt as app/page.tsx's restore rebuilds it, passes identity validation and is
 *     adopted by a REAL SchematicEditorSession; the previous build's flat shape is refused with SHEET_REFERENCE_INVALID (the defect);
 *  3. import: a project file carrying a board checkpoint of this build's shape imports with the checkpoint; a file carrying the previous
 *     build's flat checkpoint imports the project and leaves that checkpoint out with a warning that names it (hardening for files
 *     already written), while a project whose OWN state fails the sheet contract is still refused, and every other checkpoint refusal
 *     (a malformed table) still refuses the whole file.
 * jsdom (localStorage, no indexedDB: the in-memory checkpoint store); the parts route is stubbed; no network, no database.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryAtomicProjectStore } from "@/app/lib/engineering/persistence";
import { schematicStateDigest, validateSchematicStateIntegrity } from "@/app/lib/engineering/schematic-model";
import { SchematicEditorSession } from "@/app/lib/engineering/schematic-session";
import { canonicalJson } from "@/app/lib/pcb/revision";
import { importProjectFile } from "@/app/lib/project/file";
import { J3_FIXTURE_PROJECT_ID, multiSheetDroneFixtureState, multiSheetDroneProjectFile } from "@/app/lib/schematic/__tests__/_j3-fixtures";
import type { SchematicState } from "@/lib/schematic-types";

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");
const sha = (text: string): string => createHash("sha256").update(text).digest("hex");

/** What PcbEditor.tsx's `boardCheckpoint` stores for the schematic (the pinned literal below, as a function). */
const asPcbEditorWrites = (s: SchematicState): SchematicState => ({ components: s.components, wires: s.wires, kicadComponents: s.kicadComponents ?? [], netLabels: s.netLabels ?? [], ...(s.pageSize ? { pageSize: s.pageSize } : {}), ...(s.sheets !== undefined ? { sheets: s.sheets } : {}) });
/** What the previous build (592c62d1 and before) stored: the four arrays, the tree dropped. */
const asPreviousBuildWrote = (s: SchematicState): SchematicState => ({ components: s.components, wires: s.wires, kicadComponents: s.kicadComponents ?? [], netLabels: s.netLabels ?? [] });
/** app/page.tsx restoreCheckpoint's `restoredState` (the J3 carriage site "checkpoint restore"). */
const asPageRestores = (checkpoint: SchematicState, live: SchematicState): SchematicState => ({
  components: checkpoint.components ?? [], wires: checkpoint.wires ?? [], kicadComponents: checkpoint.kicadComponents ?? [], netLabels: checkpoint.netLabels ?? [],
  ...(checkpoint.pageSize ? { pageSize: checkpoint.pageSize } : { ...(live.pageSize ? { pageSize: live.pageSize } : {}) }), ...(checkpoint.sheets !== undefined ? { sheets: checkpoint.sheets } : {}),
});

/** The organised fixture with U3 nudged one grid step on the IMU sheet (a checkpoint that differs from the head it is restored into). */
function nudged(state: SchematicState): SchematicState {
  return { ...state, kicadComponents: state.kicadComponents!.map((item) => (item.refDes === "U3" ? { ...item, x: item.x + 10 } : item)) };
}

function checkpointRow(schematic: SchematicState, seq: number, label: string) {
  return { id: `${J3_FIXTURE_PROJECT_ID}:${seq}`, schemaVersion: 1, projectId: J3_FIXTURE_PROJECT_ID, seq, label, at: 1700000000000 + seq, schematic, workflowView: "pcb" };
}

/** The committed fixture file with its checkpoints (and optionally its project state) replaced; the integrity recomputed as the exporter does. */
function fileWith(checkpoints: unknown[], projectState?: SchematicState): string {
  const parsed = JSON.parse(multiSheetDroneProjectFile()) as { payload: { project: Record<string, unknown>; checkpoints: unknown[] } } & Record<string, unknown>;
  const payload = { ...parsed.payload, checkpoints, ...(projectState ? { project: { ...parsed.payload.project, state: projectState } } : {}) };
  const canonical = canonicalJson(payload);
  return JSON.stringify({ ...parsed, integrity: `sha256:${sha(canonical)}`, payload: JSON.parse(canonical) });
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify({ ok: true, part: { id: decodeURIComponent(String(input).split("/").pop() ?? "") } }), { status: 200, headers: { "content-type": "application/json" } })));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("[PR-J3 integration, 2026-10-23] 1. PcbEditor.tsx's board checkpoint carries the sheet tree iff present", () => {
  it("the writer's literal: the four arrays, the page size and the tree iff present; never the flat four-field literal", () => {
    const source = read("app/components/pcb/PcbEditor.tsx");
    const site = "schematic: { components: s.components, wires: s.wires, kicadComponents: s.kicadComponents ?? [], netLabels: s.netLabels ?? [], ...(s.pageSize ? { pageSize: s.pageSize } : {}), ...(s.sheets !== undefined ? { sheets: s.sheets } : {}) },";
    expect(source.split(site).length - 1).toBe(1);
    expect(source).not.toContain("netLabels: s.netLabels ?? [] },");
    expect(source.split("checkpointStore().add(").length - 1).toBe(1); // the one board checkpoint writer
    // the mirror this suite reasons with is the literal
    const organised = multiSheetDroneFixtureState();
    expect(asPcbEditorWrites(organised)).toEqual({ components: organised.components, wires: organised.wires, kicadComponents: organised.kicadComponents, netLabels: organised.netLabels, pageSize: organised.pageSize, sheets: organised.sheets });
    expect("sheets" in asPcbEditorWrites({ ...organised, sheets: undefined, kicadComponents: [], wires: [], netLabels: [] })).toBe(false);
  });
});

describe("[PR-J3 integration, 2026-10-23] 2. a board checkpoint of an organised project restores through a real session", () => {
  it("this build's shape passes identity validation and is adopted; the previous build's flat shape is refused with SHEET_REFERENCE_INVALID", async () => {
    const organised = multiSheetDroneFixtureState();
    const checkpointOf = nudged(organised);
    const session = new SchematicEditorSession({ tenantId: "local", projectId: "p-j3-board-checkpoint", branchId: "main" }, { store: new InMemoryAtomicProjectStore() });
    await session.openForProject(structuredClone(organised), null);
    const restored = asPageRestores(asPcbEditorWrites(checkpointOf), organised);
    expect(restored.sheets).toEqual(organised.sheets);
    expect(restored.pageSize).toBe(organised.pageSize);
    expect(validateSchematicStateIntegrity(restored)).toEqual([]);
    const adopted = await session.adoptLifecycleProjection(restored, "checkpoint restored: Synchronized PCB");
    expect(adopted).toMatchObject({ ok: true, code: "adopted" });
    expect(schematicStateDigest(restored)).toBe(schematicStateDigest(checkpointOf));
    // the defect: the flat shape keeps the entities' sheet stamps without their tree - the sheet contract refuses it, so did the restore
    const flat = asPageRestores(asPreviousBuildWrote(checkpointOf), organised);
    expect("sheets" in flat).toBe(false);
    expect(flat.kicadComponents!.filter((item) => item.sheetId !== undefined).length).toBeGreaterThan(0);
    const issues = validateSchematicStateIntegrity(flat);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]).toMatch(/SHEETS: SHEET_REFERENCE_INVALID/);
    const refused = await session.adoptLifecycleProjection(flat, "checkpoint restored: Synchronized PCB");
    expect(refused).toMatchObject({ ok: false, code: "invalid" });
    expect((refused as { detail: string }).detail).toMatch(/SHEET_REFERENCE_INVALID/);
  });
});

describe("[PR-J3 integration, 2026-10-23] 3. the project file exported after a board checkpoint imports again", () => {
  it("a checkpoint of this build's shape imports with the project; the previous build's flat checkpoint is left out with a warning; the project's own state and other checkpoint faults still refuse", async () => {
    const organised = multiSheetDroneFixtureState();
    const good = await importProjectFile(fileWith([checkpointRow(asPcbEditorWrites(nudged(organised)), 0, "Synchronized PCB (server revision abc)")]));
    if (!good.ok) throw new Error(good.reason);
    expect(good.project.id).toBe(J3_FIXTURE_PROJECT_ID);
    expect(good.checkpointsImported).toBe(1);
    expect(good.warnings).toEqual([]);
    localStorage.clear();
    // the previous build's file: the flat checkpoint is left out and named; the project and the valid checkpoint import
    const mixed = await importProjectFile(fileWith([
      checkpointRow(asPreviousBuildWrote(nudged(organised)), 0, "Synchronized PCB (server revision abc)"),
      checkpointRow(asPcbEditorWrites(organised), 1, "Manual save"),
    ]));
    if (!mixed.ok) throw new Error(mixed.reason);
    expect(mixed.project.state).toEqual(organised);
    expect(mixed.checkpointsImported).toBe(1);
    expect(mixed.warnings).toHaveLength(1);
    expect(mixed.warnings[0]).toMatch(/^1 checkpoint\(s\) in the file were left out because their schematic fails the sheet contract and could not be restored: "Synchronized PCB \(server revision abc\)" \(Invalid schematic sheets \(SHEET_REFERENCE_INVALID\): /);
    expect(mixed.warnings[0]).toMatch(/The project and its other checkpoints imported\.$/);
    localStorage.clear();
    // B19-D I5e stands: a checkpoint with a malformed table refuses the whole file, and so does a project whose own state fails the sheet contract
    const malformed = await importProjectFile(fileWith([{ ...checkpointRow(asPcbEditorWrites(organised), 0, "Broken"), schematic: { ...asPcbEditorWrites(organised), wires: [{ id: "w", vertices: "not-an-array" }] } }]));
    expect(malformed).toEqual({ ok: false, reason: "A checkpoint's schematic in the file is invalid. Nothing was imported." });
    expect(localStorage.length).toBe(0);
    const flatProject = await importProjectFile(fileWith([], asPreviousBuildWrote(organised)));
    expect(flatProject.ok).toBe(false);
    if (!flatProject.ok) expect(flatProject.reason).toMatch(/^Invalid schematic sheets \(SHEET_REFERENCE_INVALID\)/);
    expect(localStorage.length).toBe(0);
  });
});
