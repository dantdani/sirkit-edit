// @vitest-environment jsdom
/**
 * [PR-J4, 2026-10-23] The committed FLAT drone project file the browser proof organises (fixtures/j4-drone-flat-project.sirkit.json):
 * it is the exporter's canonical payload for the frozen fixture drone (formatVersion 1: no sheets), its integrity digest holds, it is LF, and
 * it imports through the real importer to exactly `droneFixtureState()` (the j1 golden digest) with no missing part. jsdom localStorage.
 */
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { schematicStateDigest } from "@/app/lib/engineering/schematic-model";
import { canonicalJson } from "@/app/lib/pcb/revision";
import { PROJECT_FILE_VERSION, importProjectFile } from "@/app/lib/project/file";
import type { SchematicState } from "@/lib/schematic-types";
import { droneFixtureState } from "./_j1-fixtures";
import { J4_FLAT_EXPORTED_AT, J4_FLAT_PROJECT_ID, J4_FLAT_PROJECT_NAME, flatDroneProjectFile, flatDroneProjectState } from "./_j4-organize-fixtures";

const sha = (text: string): string => createHash("sha256").update(text).digest("hex");

describe("[PR-J4] the flat drone project file", () => {
  beforeEach(() => {
    localStorage.clear();
    // the importer asks the parts route whether each catalog part still resolves: a stub that knows every part (the j3 fixture test's stub)
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify({ ok: true, part: { id: decodeURIComponent(String(input).split("/").pop() ?? "") } }), { status: 200, headers: { "content-type": "application/json" } })));
  });

  it("is the canonical export of the frozen fixture drone (formatVersion 1, integrity, LF) and carries exactly droneFixtureState()", () => {
    const content = flatDroneProjectFile();
    const parsed = JSON.parse(content) as { format: string; formatVersion: number; exportedAt: string; integrity: string; payload: { project: Record<string, unknown>; checkpoints: unknown[] } };
    expect([parsed.format, parsed.formatVersion, parsed.exportedAt]).toEqual(["sirkit-project", PROJECT_FILE_VERSION, J4_FLAT_EXPORTED_AT]);
    expect(parsed.integrity).toBe(`sha256:${sha(canonicalJson(parsed.payload))}`);
    expect(parsed.payload.checkpoints).toEqual([]);
    expect(parsed.payload.project).toMatchObject({ id: J4_FLAT_PROJECT_ID, name: J4_FLAT_PROJECT_NAME, schemaVersion: 2, createdAt: 1, updatedAt: 1 });
    const flat = droneFixtureState();
    expect(flatDroneProjectState()).toEqual(flat);
    expect(flat.sheets).toBeUndefined();
    expect(schematicStateDigest(flatDroneProjectState())).toBe("eng1-66f025a6dde8f8c3"); // j1-sheet-operations GOLDEN.drone.stateDigest
    expect(canonicalJson({ project: { id: J4_FLAT_PROJECT_ID, name: J4_FLAT_PROJECT_NAME, state: flat, createdAt: 1, updatedAt: 1, schemaVersion: 2 }, checkpoints: [] })).toBe(canonicalJson(parsed.payload));
    expect(content.includes("\r")).toBe(false);
  });

  it("imports through the real importer to the same state, as the project itself (no copy), with no missing part", async () => {
    const result = await importProjectFile(flatDroneProjectFile());
    if (!result.ok) throw new Error(result.reason);
    expect(result.importedAsCopy).toBe(false);
    expect(result.project.id).toBe(J4_FLAT_PROJECT_ID);
    expect(result.project.state as SchematicState).toEqual(droneFixtureState());
    expect(result.missingParts).toEqual([]);
  });
});
