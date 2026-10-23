// @vitest-environment jsdom
/**
 * [PR-J, 2026-10-22] Runbook section J increment 1 (J.8 items 1, 2; OD-255 item 1): persistence of the sheet contract.
 *
 *  1. GOLDEN: an existing single-sheet project keeps its exact bytes. The committed `.sirkit.json` (the fixture blinker, exported at
 *     5bf1e599 before section J) imports to the same state and exports again byte for byte; the stored localStorage record and the
 *     exported file of the blinker, the drone and a Theory design hash to the values pinned before section J.
 *  2. A multi-sheet project round-trips through the saved record (sheets, sheet ids, ports and scoped labels intact, same canonical
 *     digest) and exports as project-file version 2 (forward-only) carrying its whole tree; importing it is validated completely and
 *     [PR-J3, 2026-10-22] then hydrates the same state and re-exports the same bytes (the Sheets editor opens it: MULTI_SHEET_EDITOR_AVAILABLE
 *     is true since section J increment 3, OD-257 item 8; the SHEETS_EDITOR_PENDING refusal stays as the record of the recoverable
 *     path that held before). Inconsistent files (sheets in a version-1 file, an invalid tree, a newer version) are refused with a reason.
 * jsdom localStorage, a stubbed parts route; no network, no database.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { schematicStateDigest } from "@/app/lib/engineering/schematic-model";
import { canonicalJson } from "@/app/lib/pcb/revision";
import { kicadPinWorldPos, pointKey } from "@/app/lib/geometry";
import { planMoveToSheet } from "@/app/lib/schematic/sheet-operations";
import { loadProject, saveProject, type SavedProject } from "@/lib/persistence";
import type { SchematicState } from "@/lib/schematic-types";
import { blinkerFixtureState, droneFixtureState, fixturePartLookup, theoryLegacyFixture } from "../../schematic/__tests__/_j1-fixtures";
import { MULTI_SHEET_EDITOR_AVAILABLE, PROJECT_FILE_MAX_VERSION, PROJECT_FILE_VERSION, PROJECT_FILE_VERSION_SHEETS, SHEETS_EDITOR_PENDING, exportProjectFile, importProjectFile } from "../file";

const sha = (text: string): string => createHash("sha256").update(text).digest("hex");
const NOW = new Date("2026-10-22T00:00:00.000Z");
const FIXTURE_FILE = join(process.cwd(), "app", "lib", "schematic", "__tests__", "fixtures", "j1-blinker-project.sirkit.json");
/** Pinned at 5bf1e599 (before section J): the stored record and the exported file of each golden fixture. */
const GOLDEN = {
  blinker: { storedSha: "acff46847faed6af1de7b3eeb40da1f6aee2d3a885c05e0c2af582a4c4244693", fileSha: "256d3e016aca44f0f2cf4bc2e19f03e6bf7230c927c39d3b987ed995a32935a7" },
  drone: { storedSha: "3b6cc96978414d03891ba3ae51db880af879ee0b052a905cf466f3f5d1a5a574", fileSha: "ef5ffdad002214773397e326ce7e0d6213f0b2cae491fc11d2b30f18e37bef98" },
  theory: { storedSha: "9e232fcc2a771f281dda88f5c97521c14fba657f0551d362d266b14716342c16", fileSha: "2c3ab06521ce9510406dca3c218ea21271b25809448527dda3b95b2fca5f2d47" },
} as const;

function envelope(payload: unknown, formatVersion: number): string {
  return JSON.stringify({ format: "sirkit-project", formatVersion, exportedAt: NOW.toISOString(), integrity: `sha256:${sha(canonicalJson(payload))}`, payload });
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify({ ok: true, part: { id: decodeURIComponent(String(input).split("/").pop() ?? "") } }), { status: 200, headers: { "content-type": "application/json" } })));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("[PR-J J1] 1. an existing single-sheet project keeps its exact saved and exported bytes (golden)", () => {
  it("the committed blinker project file imports to the blinker state and exports again byte for byte (format version 1)", async () => {
    const content = readFileSync(FIXTURE_FILE, "utf8");
    const imported = await importProjectFile(content);
    if (!imported.ok) throw new Error(imported.reason);
    expect(imported.importedAsCopy).toBe(false);
    expect(imported.project.state).toEqual(blinkerFixtureState());
    expect(imported.project.state.sheets).toBeUndefined();
    const exported = await exportProjectFile(imported.project.id);
    if (!exported.ok) throw new Error(exported.reason);
    expect(exported.content).toBe(content);
    expect(JSON.parse(exported.content).formatVersion).toBe(PROJECT_FILE_VERSION);
  });

  it.each([["blinker", blinkerFixtureState], ["drone", droneFixtureState], ["theory", theoryLegacyFixture]] as const)("%s: the stored record and the exported file hash to the pre-section-J values", async (name, make) => {
    const id = `j1-golden-${name}`;
    saveProject({ id, name: `J1 ${name}`, state: make(), createdAt: 1, updatedAt: 1, schemaVersion: 2 } as SavedProject);
    expect(sha(localStorage.getItem(`sirkit:project:${id}`)!)).toBe(GOLDEN[name].storedSha);
    const file = await exportProjectFile(id);
    if (!file.ok) throw new Error(file.reason);
    expect(sha(file.content)).toBe(GOLDEN[name].fileSha);
  });
});

/** The fixture drone with its IMU moved to an "IMU" sheet (a real multi-sheet document: tree, sheet ids, a port, scoped labels). */
function multiSheetDrone(): SchematicState {
  const lookup = fixturePartLookup();
  const drone = droneFixtureState();
  const u3 = drone.kicadComponents!.find((item) => item.refDes === "U3")!;
  const pins = new Set((lookup(u3.partId)?.pins ?? []).map((pin) => pointKey(kicadPinWorldPos(u3, pin))));
  const wires = drone.wires.filter((wire) => pins.has(pointKey(wire.vertices[0]!)) || pins.has(pointKey(wire.vertices[wire.vertices.length - 1]!)));
  const ends = new Set([...pins, ...wires.flatMap((wire) => [pointKey(wire.vertices[0]!), pointKey(wire.vertices[wire.vertices.length - 1]!)])]);
  const plan = planMoveToSheet(drone, {
    entities: [{ family: "kicad", id: u3.id }, ...wires.map((wire) => ({ family: "wire" as const, id: wire.id })), ...drone.netLabels!.filter((item) => ends.has(pointKey(item.position))).map((item) => ({ family: "label" as const, id: item.id }))],
    target: { newSheet: { id: "sheet-imu", name: "IMU" } },
  }, lookup);
  if (!plan.ok) throw new Error(plan.message);
  return plan.after;
}

describe("[PR-J J1] 2. a multi-sheet project persists completely; the file format moves to version 2 only with sheets", () => {
  it("the saved record round-trips the whole tree (sheets, sheet ids, ports, scoped labels) with the same canonical digest", () => {
    const state = multiSheetDrone();
    expect(state.sheets!.sheets.map((sheet) => sheet.name)).toEqual(["Overview", "IMU"]);
    saveProject({ id: "j1-multi", name: "Drone (sheets)", state, createdAt: 1, updatedAt: 1, schemaVersion: 2 } as SavedProject);
    const loaded = loadProject("j1-multi")!;
    expect(loaded.state).toEqual(state);
    expect(schematicStateDigest(loaded.state)).toBe(schematicStateDigest(state));
    expect(loaded.state.netLabels!.filter((item) => item.scope === "sheet-pin")).toHaveLength(3);
    expect(loaded.state.kicadComponents!.filter((item) => item.sheetId === "sheet-imu")).toHaveLength(1);
  });

  it("export writes format version 2 carrying the tree; import validates it fully, hydrates the same state and re-exports it byte for byte (the Sheets editor opens it)", async () => {
    const state = multiSheetDrone();
    saveProject({ id: "j1-multi", name: "Drone (sheets)", state, createdAt: 1, updatedAt: 1, schemaVersion: 2 } as SavedProject);
    const file = await exportProjectFile("j1-multi");
    if (!file.ok) throw new Error(file.reason);
    const parsed = JSON.parse(file.content);
    expect(parsed.formatVersion).toBe(PROJECT_FILE_VERSION_SHEETS);
    expect(parsed.integrity).toBe(`sha256:${sha(canonicalJson(parsed.payload))}`);
    expect(parsed.payload.project.state.sheets).toEqual(state.sheets);
    expect(schematicStateDigest(parsed.payload.project.state)).toBe(schematicStateDigest(state));
    localStorage.clear();
    // [PR-J3, 2026-10-22] pin move (runbook J.3, OD-257 item 8): before this increment the flag was false and the import was refused
    // `${SHEETS_EDITOR_PENDING}: this project has 2 schematic sheets, ... open it again after the Sheets update.` with nothing written;
    // the Sheets editor is that update, so the file imports, the stored record holds the whole tree and the re-export is the same bytes.
    expect(MULTI_SHEET_EDITOR_AVAILABLE).toBe(true);
    expect(SHEETS_EDITOR_PENDING).toBe("SHEETS_EDITOR_PENDING"); // the recoverable path's code stays exported for the record
    const result = await importProjectFile(file.content);
    if (!result.ok) throw new Error(result.reason);
    expect(result.importedAsCopy).toBe(false);
    expect(result.project.id).toBe("j1-multi");
    expect(result.project.state).toEqual(state);
    expect(result.project.state.sheets!.sheets.map((sheet) => sheet.name)).toEqual(["Overview", "IMU"]);
    expect(loadProject("j1-multi")!.state).toEqual(state);
    expect(schematicStateDigest(loadProject("j1-multi")!.state)).toBe(schematicStateDigest(state));
    const again = await exportProjectFile("j1-multi");
    if (!again.ok) throw new Error(again.reason);
    expect(again.content).toBe(file.content);
    expect(JSON.parse(again.content).formatVersion).toBe(PROJECT_FILE_VERSION_SHEETS);
  });

  it("inconsistent files are refused with a reason and nothing is written", async () => {
    const state = multiSheetDrone();
    const project = { id: "j1-bad", name: "Bad", createdAt: 1, updatedAt: 1, schemaVersion: 2, state };
    const v1 = await importProjectFile(envelope({ project, checkpoints: [] }, 1));
    expect(v1).toMatchObject({ ok: false, reason: "A project-file version 1 cannot carry schematic sheets; the file is inconsistent. Nothing was imported." });
    const cyclic = structuredClone(state);
    cyclic.sheets!.sheets.push({ id: "x1", name: "X1", parentId: "x2" }, { id: "x2", name: "X2", parentId: "x1" });
    const bad = await importProjectFile(envelope({ project: { ...project, state: cyclic }, checkpoints: [] }, 2));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toMatch(/^Invalid schematic sheets \(SHEET_HIERARCHY_CYCLE\): /);
    const dangling = structuredClone(state);
    delete dangling.sheets;
    const orphan = await importProjectFile(envelope({ project: { ...project, state: dangling }, checkpoints: [] }, 1));
    expect(orphan.ok).toBe(false);
    if (!orphan.ok) expect(orphan.reason).toMatch(/^Invalid schematic sheets \(SHEET_REFERENCE_INVALID\): /);
    const newer = await importProjectFile(envelope({ project, checkpoints: [] }, PROJECT_FILE_MAX_VERSION + 1));
    expect(newer).toMatchObject({ ok: false, reason: `This file uses project-file version ${PROJECT_FILE_MAX_VERSION + 1}, newer than this app supports (${PROJECT_FILE_MAX_VERSION}). Update Sirkit to open it.` });
    expect(localStorage.length).toBe(0);
  });
});
