// @vitest-environment jsdom
/**
 * [B19-D I5e rows 11, 12, 13, 14] Opening a `.sirkit.json` project file: shape, size, depth, tables and truthful results.
 *
 *  - row 11: a checkpoint was checked on its header only, so its chat and schematic arrived unvalidated (restoring one could
 *    crash the page, and its chat could carry any markup back into the renderer).
 *  - row 12: a deeply nested payload threw a RangeError out of the canonical hash (a rejected promise, not a refusal), and no
 *    size bound existed.
 *  - row 13: no table had a bound — thousands of distinct parts meant thousands of sequential lookups — and a project that
 *    browser storage refused to save was still reported as imported.
 *  - row 14: a part the catalog answered `{ ok: true, part: null }` for (the route's real "not found") counted as resolved.
 */
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalJson } from "@/app/lib/pcb/revision";
import { CHECKPOINT_SCHEMA_VERSION } from "../checkpoints";
import { importProjectFile, MAX_PROJECT_FILE_BYTES, PROJECT_IMPORT_LIMITS, readProjectFile } from "../file";

const fetchCalls: string[] = [];

function partsRoute(resolved: readonly string[]): void {
  fetchCalls.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const id = decodeURIComponent(String(input).split("/").pop() ?? "");
    fetchCalls.push(id);
    // the real /api/parts/[id] shape: 200 with the part, or 200 with part: null
    return new Response(JSON.stringify({ ok: true, part: resolved.includes(id) ? { id } : null }), { status: 200, headers: { "content-type": "application/json" } });
  }));
}

function envelope(payload: unknown): string {
  return JSON.stringify({ format: "sirkit-project", formatVersion: 1, exportedAt: "2026-09-13T00:00:00.000Z", integrity: `sha256:${createHash("sha256").update(canonicalJson(payload)).digest("hex")}`, payload });
}

function project(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: "b19-import", name: "Import", createdAt: 1, updatedAt: 1, schemaVersion: 1, state: { components: [], wires: [], kicadComponents: [], netLabels: [] }, ...overrides };
}

function checkpoint(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: "b19-import:0", schemaVersion: CHECKPOINT_SCHEMA_VERSION, projectId: "b19-import", seq: 0, label: "", at: 0, schematic: { components: [], wires: [] }, ...overrides };
}

beforeEach(() => {
  localStorage.clear();
  partsRoute([]);
});
afterEach(() => vi.unstubAllGlobals());

describe("[B19-D I5e row 11] every imported checkpoint is validated like the project it restores", () => {
  it.each([
    ["a chat message whose content is not text", { chat: [{ id: "m", role: "assistant", content: 5 }] }],
    ["a chat that is not a list", { chat: "x" }],
    ["a schematic whose components are not a list", { schematic: { components: "x", wires: [] } }],
    ["a board that is not a board", { board: { footprints: "x" } }],
  ])("%s is refused and nothing is written", async (_label, overrides) => {
    const result = await importProjectFile(envelope({ project: project(), checkpoints: [checkpoint(overrides)] }));
    expect(result.ok).toBe(false);
    expect(localStorage.length).toBe(0);
  });

  it("a well-formed checkpoint still imports (baseline)", async () => {
    const result = await importProjectFile(envelope({ project: project(), checkpoints: [checkpoint({ chat: [{ id: "m", role: "assistant", content: "done" }] })] }));
    expect(result).toMatchObject({ ok: true, checkpointsImported: 1 });
  });
});

describe("[B19-D I5e row 12] nesting and size are refused, never thrown", () => {
  it("10 000 levels of nesting resolve to a refusal, not a RangeError", async () => {
    const deep = `${"[".repeat(10_000)}${"]".repeat(10_000)}`;
    const content = `{"format":"sirkit-project","formatVersion":1,"integrity":"sha256:${"0".repeat(64)}","payload":{"project":${deep}}}`;
    await expect(importProjectFile(content)).resolves.toMatchObject({ ok: false });
  });

  it("a file larger than the bound is refused before it is read, parsed or looked up", async () => {
    const big = new File([new Uint8Array(MAX_PROJECT_FILE_BYTES + 1)], "big.sirkit.json", { type: "application/json" });
    const read = await readProjectFile(big);
    expect(read).toMatchObject({ ok: false });
    expect(read.ok ? "" : read.reason).toMatch(/too large/i);
    expect(fetchCalls).toEqual([]);
    expect(localStorage.length).toBe(0);
    const text = await importProjectFile(" ".repeat(MAX_PROJECT_FILE_BYTES + 1));
    expect(text).toMatchObject({ ok: false });
  });

  it("a normal file is read (baseline)", async () => {
    const content = envelope({ project: project(), checkpoints: [] });
    await expect(readProjectFile(new File([content], "p.sirkit.json"))).resolves.toEqual({ ok: true, content });
  });
});

describe("[B19-D I5e row 13] tables are bounded, lookups are bounded, and a failed save is a failed import", () => {
  it("more distinct catalog parts than the resolution limit is refused without a lookup storm", async () => {
    const count = PROJECT_IMPORT_LIMITS.distinctParts + 1;
    const kicadComponents = Array.from({ length: count }, (_, index) => ({ id: `k${index}`, partId: `part-${index}`, x: 0, y: 0, rotation: 0, refDes: `R${index}`, value: "10k" }));
    const result = await importProjectFile(envelope({ project: project({ state: { components: [], wires: [], kicadComponents, netLabels: [] } }), checkpoints: [] }));
    expect(result).toMatchObject({ ok: false });
    expect(result.ok ? "" : result.reason).toMatch(/too many/i);
    expect(fetchCalls.length).toBe(0);
  });

  it("more checkpoints than the limit is refused", async () => {
    const checkpoints = Array.from({ length: PROJECT_IMPORT_LIMITS.checkpoints + 1 }, (_, seq) => checkpoint({ id: `b19-import:${seq}`, seq }));
    const result = await importProjectFile(envelope({ project: project(), checkpoints }));
    expect(result).toMatchObject({ ok: false });
  });

  it("a project browser storage refuses to save is not reported as imported", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("quota", "QuotaExceededError"); });
    try {
      const result = await importProjectFile(envelope({ project: project(), checkpoints: [] }));
      expect(result).toMatchObject({ ok: false });
    } finally {
      setItem.mockRestore();
    }
  });

  it("part lookups run in bounded batches and every distinct part is checked once (baseline for a normal board)", async () => {
    const kicadComponents = Array.from({ length: 40 }, (_, index) => ({ id: `k${index}`, partId: `part-${index % 20}`, x: 0, y: 0, rotation: 0, refDes: `R${index}`, value: "10k" }));
    partsRoute(Array.from({ length: 20 }, (_, index) => `part-${index}`));
    const result = await importProjectFile(envelope({ project: project({ state: { components: [], wires: [], kicadComponents, netLabels: [] } }), checkpoints: [] }));
    expect(result).toMatchObject({ ok: true, missingParts: [] });
    expect([...fetchCalls].sort()).toEqual(Array.from({ length: 20 }, (_, index) => `part-${index}`).sort());
  });
});

describe("[B19-D I5e row 14] a part the catalog does not have is reported missing", () => {
  it("200 { ok: true, part: null } is a missing part", async () => {
    partsRoute([]);
    const kicadComponents = [{ id: "k1", partId: "part-1", x: 0, y: 0, rotation: 0, refDes: "U1", value: "NE555" }];
    const result = await importProjectFile(envelope({ project: project({ state: { components: [], wires: [], kicadComponents, netLabels: [] } }), checkpoints: [] }));
    expect(result).toMatchObject({ ok: true, missingParts: ["part-1"] });
  });
});
