// @vitest-environment jsdom
/**
 * B06.3 — SavedProject schematic-metadata sanitization and lifecycle-aware
 * mark persistence (mandatory tests 7–13).
 *
 * Both loaders (strict `loadProject` and salvage `loadProjectSalvaged`)
 * must apply equivalent schema-exact validation to `schematicCanonicalMark`
 * and `schematicProjectionConflict`; autosave patches must explicitly CLEAR
 * the active mark while the session is not ready (patches merge — omission
 * silently keeps a stale mark) and pair the exact state+mark when ready.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createProject, loadProject, loadProjectSalvaged, saveProjectFields, type SavedProject } from "@/lib/persistence";
import { schematicMarkPatch, validateSchematicCanonicalMark } from "@/app/lib/engineering/schematic-projection";
import type { SchematicState } from "@/lib/schematic-types";

const emptyState: SchematicState = { components: [], wires: [], kicadComponents: [], netLabels: [] };
const VALID_MARK = { lineageId: "lin1-1234567890abcdef", headSequence: 2, canonicalStateDigest: "eng1-aabbccdd00112233" };
const STORAGE_PREFIX = "sirkit:project:";

function writeRaw(id: string, mutate: (record: Record<string, unknown>) => void): void {
  const record = JSON.parse(localStorage.getItem(STORAGE_PREFIX + id)!) as Record<string, unknown>;
  mutate(record);
  localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(record));
}

const MALFORMED_MARKS: Array<[string, unknown]> = [
  ["extra field", { ...VALID_MARK, injected: "x" }],
  ["bad lineage format", { ...VALID_MARK, lineageId: "lineage-A" }],
  ["empty lineage", { ...VALID_MARK, lineageId: "" }],
  ["negative sequence", { ...VALID_MARK, headSequence: -1 }],
  ["fractional sequence", { ...VALID_MARK, headSequence: 1.5 }],
  ["unsafe sequence", { ...VALID_MARK, headSequence: Number.MAX_SAFE_INTEGER + 2 }],
  ["infinite sequence", { ...VALID_MARK, headSequence: Number.POSITIVE_INFINITY }],
  ["nonnumeric sequence", { ...VALID_MARK, headSequence: "2" }],
  ["bad digest", { ...VALID_MARK, canonicalStateDigest: "sha256-zzz" }],
  ["missing field", { lineageId: VALID_MARK.lineageId, headSequence: 2 }],
  ["array", [VALID_MARK]],
  ["string", "lin1-1234567890abcdef"],
];

describe("B06.3 — loader sanitization (tests 7–9)", () => {
  beforeEach(() => localStorage.clear());

  it("7. the STRICT loader drops malformed marks (and keeps valid ones)", () => {
    const project = createProject("Demo", emptyState);
    for (const [label, mark] of MALFORMED_MARKS) {
      writeRaw(project.id, (record) => { record.schematicCanonicalMark = mark; });
      expect(loadProject(project.id)?.schematicCanonicalMark, label).toBeUndefined();
    }
    writeRaw(project.id, (record) => { record.schematicCanonicalMark = VALID_MARK; });
    expect(loadProject(project.id)?.schematicCanonicalMark).toEqual(VALID_MARK);
  });

  it("8. strict and salvage loaders apply EQUIVALENT mark validation", () => {
    const project = createProject("Demo", emptyState);
    for (const [label, mark] of [...MALFORMED_MARKS, ["valid", VALID_MARK] as [string, unknown]]) {
      writeRaw(project.id, (record) => { record.schematicCanonicalMark = mark; });
      const strict = loadProject(project.id)?.schematicCanonicalMark;
      const salvage = loadProjectSalvaged(project.id)?.project.schematicCanonicalMark;
      expect(salvage, label).toEqual(strict);
      // Both also agree with the engineering-side validator.
      expect(strict !== undefined, label).toBe(validateSchematicCanonicalMark(mark) !== null);
    }
  });

  it("9. malformed projection-conflict records cannot become recovery authority (both loaders)", () => {
    const project = createProject("Demo", emptyState);
    const validConflict = { state: emptyState, reason: "test", at: 123 };
    const malformed: unknown[] = [
      { ...validConflict, extra: 1 },
      { state: { components: "nope", wires: [] }, reason: "x", at: 1 },
      { state: emptyState, reason: "", at: 1 },
      { state: emptyState, reason: "x", at: Number.NaN },
      { reason: "x", at: 1 },
      "garbage",
    ];
    for (const conflict of malformed) {
      writeRaw(project.id, (record) => { record.schematicProjectionConflict = conflict; });
      expect(loadProject(project.id)?.schematicProjectionConflict).toBeUndefined();
      expect(loadProjectSalvaged(project.id)?.project.schematicProjectionConflict).toBeUndefined();
    }
    writeRaw(project.id, (record) => { record.schematicProjectionConflict = validConflict; });
    expect(loadProject(project.id)?.schematicProjectionConflict).toEqual(validConflict);
    expect(loadProjectSalvaged(project.id)?.project.schematicProjectionConflict).toEqual(validConflict);
  });
});

describe("B06.3 — lifecycle-aware mark persistence (tests 10–13)", () => {
  beforeEach(() => localStorage.clear());

  function projectWithStoredMark(): SavedProject {
    const project = createProject("Demo", emptyState);
    expect(saveProjectFields(project.id, { schematicCanonicalMark: VALID_MARK })).toBe(true);
    expect(loadProject(project.id)?.schematicCanonicalMark).toEqual(VALID_MARK);
    return project;
  }

  it("10+11+12. hydrating/conflicted/unavailable autosaves CLEAR the previously stored mark", () => {
    for (const lifecycle of ["hydrating", "conflicted", "unavailable"] as const) {
      const project = projectWithStoredMark();
      const patch = schematicMarkPatch(lifecycle, null);
      expect("schematicCanonicalMark" in patch && patch.schematicCanonicalMark === undefined).toBe(true);
      expect(saveProjectFields(project.id, { state: emptyState, ...patch })).toBe(true);
      expect(loadProject(project.id)?.schematicCanonicalMark, lifecycle).toBeUndefined();
    }
    // Unopened leaves the stored mark untouched (no session judged the head).
    const untouched = projectWithStoredMark();
    expect(schematicMarkPatch("unopened", null)).toEqual({});
    expect(saveProjectFields(untouched.id, { state: emptyState, ...schematicMarkPatch("unopened", null) })).toBe(true);
    expect(loadProject(untouched.id)?.schematicCanonicalMark).toEqual(VALID_MARK);
  });

  it("13. a READY autosave pairs the exact state and the exact head mark in one write", () => {
    const project = createProject("Demo", emptyState);
    const state: SchematicState = { components: [{ id: "R1", type: "resistor", x: 10, y: 20, rotation: 0, value: "7k" }], wires: [], kicadComponents: [], netLabels: [] };
    const readyMark = { lineageId: "lin1-feedfeedfeedfeed", headSequence: 3, canonicalStateDigest: "eng1-1234abcd1234abcd" };
    const patch = schematicMarkPatch("ready", readyMark);
    expect(patch).toEqual({ schematicCanonicalMark: readyMark });
    expect(saveProjectFields(project.id, { state, ...patch })).toBe(true);
    const loaded = loadProject(project.id)!;
    expect(loaded.state.components[0]?.value).toBe("7k");
    expect(loaded.schematicCanonicalMark).toEqual(readyMark);
    // Defensive: a "ready" session without a mark clears rather than lies.
    expect(schematicMarkPatch("ready", null)).toEqual({ schematicCanonicalMark: undefined });
  });
});
