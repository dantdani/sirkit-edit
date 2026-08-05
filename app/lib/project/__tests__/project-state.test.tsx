// @vitest-environment jsdom
/**
 * R06 durable project memory: SavedProject R06 fields, salvage loading,
 * working-copy authority rules, stage evidence, and project-file round trip.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PROJECT_SCHEMA_VERSION,
  createProject,
  loadProject,
  loadProjectSalvaged,
  saveProjectFields,
  type SavedProject,
} from "@/lib/persistence";
import { bootstrapCurrentProject, openProject, startNewProject } from "../current";
import { exportProjectFile, importProjectFile } from "../file";
import { checkpointStore } from "../checkpoints";
import { loadStageEvidence, loadWorkingCopy, saveStageEvidence, saveWorkingCopy, stashWorkingConflict } from "@/app/lib/pcb/board-persistence";
import { createEmptyBoard } from "@/app/lib/pcb/types";
import type { SchematicState } from "@/lib/schematic-types";

const emptyState: SchematicState = { components: [], wires: [], kicadComponents: [], netLabels: [] };

function stateWithInstance(): SchematicState {
  return {
    components: [],
    wires: [],
    netLabels: [],
    kicadComponents: [{ id: "inst-1", partId: "part-1", x: 100, y: 200, rotation: 0, refDes: "U1", value: "NE555" }],
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("SavedProject R06 fields (Section 4/5)", () => {
  it("saveProjectFields persists chat/view/prompt/state and stamps the schema version", () => {
    const project = createProject("Demo", emptyState);
    const ok = saveProjectFields(project.id, {
      state: stateWithInstance(),
      chat: [{ id: "m1", role: "user", content: "build a blinker" }],
      designPrompt: "build a blinker",
      workflowView: "pcb",
    });
    expect(ok).toBe(true);
    const loaded = loadProject(project.id)!;
    expect(loaded.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(loaded.chat).toEqual([{ id: "m1", role: "user", content: "build a blinker" }]);
    expect(loaded.workflowView).toBe("pcb");
    expect(loaded.state.kicadComponents?.[0]?.refDes).toBe("U1");
    expect(loaded.state.kicadComponents?.[0]?.id).toBe("inst-1"); // stable instance id preserved
  });

  it("saveProjectFields reports storage failure instead of silently discarding", () => {
    const project = createProject("Demo", emptyState);
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("QuotaExceededError"); });
    expect(saveProjectFields(project.id, { designPrompt: "x" })).toBe(false);
    spy.mockRestore();
  });

  it("salvage loader keeps project identity when an optional staged record is corrupt", () => {
    const project = createProject("Demo", stateWithInstance());
    // Corrupt an optional CD-stage field directly in storage.
    const raw = JSON.parse(localStorage.getItem(`sirkit:project:${project.id}`)!) as Record<string, unknown>;
    raw.requirements = { totally: "invalid" };
    localStorage.setItem(`sirkit:project:${project.id}`, JSON.stringify(raw));
    expect(loadProject(project.id)).toBeNull(); // strict loader refuses, as designed
    const salvaged = loadProjectSalvaged(project.id)!;
    expect(salvaged.project.id).toBe(project.id); // identity survives
    expect(salvaged.project.state.kicadComponents?.[0]?.refDes).toBe("U1");
    expect(salvaged.dropped).toContain("requirements");
  });

  it("bootstrap keeps a stable project id across reloads and never silently mints a new one", () => {
    const first = bootstrapCurrentProject();
    const second = bootstrapCurrentProject();
    expect(second.project.id).toBe(first.project.id);
    expect(second.created).toBe(false);
    // Dangling pointer falls back to the newest existing project, not a new id.
    localStorage.setItem("sirkit:currentProjectId", "missing-project-id");
    const third = bootstrapCurrentProject();
    expect(third.project.id).toBe(first.project.id);
  });

  it("openProject switches the pointer; startNewProject creates a distinct project", () => {
    const first = startNewProject("A");
    const second = startNewProject("B");
    expect(second.id).not.toBe(first.id);
    expect(openProject(first.id)?.project.name).toBe("A");
    expect(bootstrapCurrentProject().project.id).toBe(first.id);
  });
});

describe("working-copy authority rules (Section 5)", () => {
  it("round-trips the working board and its authoritative base", () => {
    const project = createProject("Demo", emptyState);
    const board = createEmptyBoard();
    expect(saveWorkingCopy(project.id, board, { revision: "rev-1", digest: "digest-1" })).toBe(true);
    const loaded = loadWorkingCopy(project.id)!;
    expect(loaded.baseRevision).toBe("rev-1");
    expect(loaded.board.formatVersion).toBe(1);
  });

  it("stashWorkingConflict preserves a diverged copy instead of overwriting it", () => {
    const project = createProject("Demo", emptyState);
    const board = createEmptyBoard();
    saveWorkingCopy(project.id, board, { revision: "rev-1", digest: "digest-1" });
    const working = loadWorkingCopy(project.id)!;
    expect(stashWorkingConflict(project.id, working, "server advanced")).toBe(true);
    expect(loadWorkingCopy(project.id)).toBeNull(); // moved, not lost
    const record = loadProject(project.id)!;
    expect(record.pcbWorkingConflict?.reason).toBe("server advanced");
    expect(record.pcbWorkingConflict?.board.formatVersion).toBe(1);
  });

  it("stage evidence merges patches (routing then release)", () => {
    const project = createProject("Demo", emptyState);
    expect(saveStageEvidence(project.id, { routedBoardRevision: "pcb2-abc", routedAt: 1 })).toBe(true);
    expect(saveStageEvidence(project.id, { releasedBoardRevision: "pcb2-abc", releaseId: "rel-1" })).toBe(true);
    const evidence = loadStageEvidence(project.id);
    expect(evidence.routedBoardRevision).toBe("pcb2-abc");
    expect(evidence.releaseId).toBe("rel-1");
  });
});

describe("project file export/import (Section 6)", () => {
  function mockPartsApi(okIds: string[]): void {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const id = decodeURIComponent(url.split("/").pop() ?? "");
      return new Response(okIds.includes(id) ? "{}" : "missing", { status: okIds.includes(id) ? 200 : 404 });
    }));
  }

  it("round-trips a project (same id when free) with checkpoints and integrity", async () => {
    mockPartsApi(["part-1"]);
    const project = createProject("Blinker", stateWithInstance());
    saveProjectFields(project.id, { chat: [{ id: "m1", role: "user", content: "hi" }], workflowView: "pcb" });
    await checkpointStore().add({ projectId: project.id, label: "Generated 555 schematic", at: 1, schematic: stateWithInstance() });
    const exported = await exportProjectFile(project.id);
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(exported.fileName.endsWith(".sirkit.json")).toBe(true);

    // Fresh context: clear local storage entirely, then import.
    localStorage.clear();
    const result = await importProjectFile(exported.content);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.importedAsCopy).toBe(false);
    expect(result.project.id).toBe(project.id); // stable identity restored
    expect(result.project.chat).toHaveLength(1);
    expect(result.project.workflowView).toBe("pcb");
    expect(result.checkpointsImported).toBe(1);
    expect(result.missingParts).toEqual([]);
    const checkpoints = await checkpointStore().list(project.id);
    expect(checkpoints.map((row) => row.label)).toEqual(["Generated 555 schematic"]);
  });

  it("imports as a conflict copy when the id already exists — never overwrites", async () => {
    mockPartsApi(["part-1"]);
    const project = createProject("Blinker", stateWithInstance());
    const exported = await exportProjectFile(project.id);
    if (!exported.ok) throw new Error("export failed");
    // Mutate the existing local project so an overwrite would be detectable.
    saveProjectFields(project.id, { designPrompt: "LOCAL EDIT" });
    const result = await importProjectFile(exported.content);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.importedAsCopy).toBe(true);
    expect(result.project.id).not.toBe(project.id);
    expect(result.project.name).toContain("(imported copy)");
    expect(loadProject(project.id)?.designPrompt).toBe("LOCAL EDIT"); // untouched
  });

  it("detects tampering via the integrity digest and imports nothing", async () => {
    mockPartsApi(["part-1"]);
    const project = createProject("Blinker", stateWithInstance());
    const exported = await exportProjectFile(project.id);
    if (!exported.ok) throw new Error("export failed");
    localStorage.clear();
    const tampered = exported.content.replace("\"U1\"", "\"U9\"");
    const result = await importProjectFile(tampered);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("Integrity check failed");
    expect(loadProject(project.id)).toBeNull(); // nothing was written
  });

  it("refuses newer format versions with an actionable message", async () => {
    const file = JSON.stringify({ format: "sirkit-project", formatVersion: 99, integrity: "sha256:0", payload: {} });
    const result = await importProjectFile(file);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("newer than this app supports");
  });

  it("reports unresolvable catalog parts truthfully instead of fabricating authority", async () => {
    mockPartsApi([]); // catalog lost the part
    const project = createProject("Blinker", stateWithInstance());
    const exported = await exportProjectFile(project.id);
    if (!exported.ok) throw new Error("export failed");
    localStorage.clear();
    const result = await importProjectFile(exported.content);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.missingParts).toEqual(["part-1"]);
    expect(result.warnings.some((warning) => warning.includes("no longer resolve"))).toBe(true);
  });

  it("rejects malformed JSON and non-Sirkit files with specific reasons", async () => {
    const bad = await importProjectFile("not json at all {{{");
    expect(bad.ok).toBe(false);
    const wrong = await importProjectFile(JSON.stringify({ format: "kicad", payload: {} }));
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.reason).toContain("not a Sirkit project");
  });

  it("export excludes API keys and secrets by construction (allowlist projection)", async () => {
    const project = createProject("Blinker", stateWithInstance());
    // Even if something injected a secret-looking field into the record, the
    // allowlisting exporter must not carry it into the file.
    const raw = JSON.parse(localStorage.getItem(`sirkit:project:${project.id}`)!) as Record<string, unknown>;
    raw.apiKey = "sk-SECRET";
    localStorage.setItem(`sirkit:project:${project.id}`, JSON.stringify(raw));
    const exported = await exportProjectFile(project.id);
    if (!exported.ok) throw new Error("export failed");
    expect(exported.content).not.toContain("sk-SECRET");
  });
});

describe("no cross-project overwrite (Section 5)", () => {
  it("two projects persist independently under distinct keys", () => {
    const a = createProject("A", stateWithInstance());
    const b = createProject("B", emptyState);
    saveProjectFields(a.id, { designPrompt: "prompt-a" });
    saveProjectFields(b.id, { designPrompt: "prompt-b" });
    expect(loadProject(a.id)?.designPrompt).toBe("prompt-a");
    expect(loadProject(b.id)?.designPrompt).toBe("prompt-b");
    expect(loadProject(a.id)?.state.kicadComponents).toHaveLength(1);
    expect(loadProject(b.id)?.state.kicadComponents ?? []).toHaveLength(0);
  });
});
