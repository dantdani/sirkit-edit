/**
 * B10 — chat request boundary tests: the versioned, bounded, exact-key
 * atomic editorContext contract, driven through the PRODUCTION route
 * handler (a controlled provider adapter replaces the network — the run
 * loop, gateway, and context assembly are all real).
 */

import { describe, expect, it, vi } from "vitest";
import type { SchematicState } from "@/lib/schematic-types";
import { schematicStateDigest } from "@/app/lib/engineering/schematic-model";
import { createEmptyBoard, type PcbBoard } from "@/app/lib/pcb/types";
import { pcbRevisionId } from "@/app/lib/pcb/revision";

vi.mock("@/app/lib/agent/adapters", () => ({
  agentAdapterFor: () => ({
    provider: "openai",
    async start(input: { tools: ReadonlyArray<{ toolId: string }> }) {
      return {
        text: `TOOLS:${input.tools.map((tool) => tool.toolId).sort().join(";")}`,
        toolCalls: [], stopReason: "completed", usage: {}, model: "scripted",
        continuation: { provider: "openai", state: null },
      };
    },
    async continueWith() { throw new Error("not used"); },
  }),
}));

import { POST, MAX_CHAT_REQUEST_BYTES, EDITOR_CONTEXT_SCHEMA } from "../route";

const SCHEMATIC: SchematicState = { components: [{ id: "r1", type: "resistor", x: 100, y: 100, rotation: 0, value: "10k" }], wires: [] };
const SCOPE = { tenantId: "local", projectId: "p10", branchId: "main" };

function boardWithTrack(): PcbBoard {
  const board = createEmptyBoard();
  board.nets.push({ id: 1, name: "SIG", stableId: "net:sig", endpointKeys: [] });
  board.tracks.push({ id: "t1", layer: "copperTop", width: 250_000, start: { x: 1_000_000, y: 3_000_000 }, end: { x: 5_000_000, y: 3_000_000 }, netId: 1, source: "human" });
  return board;
}

function editorContext(overrides?: Record<string, unknown>) {
  const board = boardWithTrack();
  return {
    schema: EDITOR_CONTEXT_SCHEMA,
    scope: SCOPE,
    board,
    // [B10.1] the revision hint must MATCH the board (recomputed server-side).
    pcbRevisionId: pcbRevisionId(board),
    selection: { refs: [{ kind: "track", id: "t1" }], primary: null },
    netlist: null,
    schematicDigest: schematicStateDigest(SCHEMATIC),
    authoritySource: "local-working-copy",
    ...overrides,
  };
}

function post(body: unknown): Promise<Response> {
  return POST(new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));
}

const BASE = { provider: "openai", messages: [{ role: "user", content: "inspect the board" }], scope: SCOPE };

async function errorOf(response: Response): Promise<string> {
  return ((await response.json()) as { error: string }).error;
}

describe("B10 — chat request boundary", () => {
  it("bounds the ACTUAL request-body byte count (413 before parsing)", async () => {
    const oversized = "x".repeat(MAX_CHAT_REQUEST_BYTES + 1);
    const response = await post(oversized);
    expect(response.status).toBe(413);
    expect(await errorOf(response)).toContain("board-capable limit");
  });

  it("refuses unknown top-level keys and every authority-claim shape; the obsolete boardState path refuses EXPLICITLY", async () => {
    for (const [key, message] of [
      ["boardState", "obsolete"],
      ["actor", "unexpected request key"],
      ["capabilities", "unexpected request key"],
      ["approvals", "unexpected request key"],
      ["idempotencyKey", "unexpected request key"],
    ] as const) {
      const response = await post({ ...BASE, [key]: { anything: true } });
      expect(response.status, key).toBe(400);
      expect(await errorOf(response), key).toContain(message);
    }
  });

  it("validates the editorContext envelope: exact keys, exact schema version, scope equality, and local-working-copy provenance only", async () => {
    const wrongSchema = await post({ ...BASE, editorContext: editorContext({ schema: "sirkit.editor-context.v999" }) });
    expect(wrongSchema.status).toBe(400);
    expect(await errorOf(wrongSchema)).toContain("unsupported editorContext schema");

    const extraKey = await post({ ...BASE, editorContext: editorContext({ durableBoard: true }) });
    expect(extraKey.status).toBe(400);
    expect(await errorOf(extraKey)).toContain("authority-shaped key"); // [B10.1] durableBoard refuses BY NAME
    const unknownKey = await post({ ...BASE, editorContext: editorContext({ extraneous: 1 }) });
    expect(unknownKey.status).toBe(400);
    expect(await errorOf(unknownKey)).toContain("unexpected key");

    const foreignScope = await post({ ...BASE, editorContext: editorContext({ scope: { ...SCOPE, projectId: "someone-else" } }) });
    expect(foreignScope.status).toBe(400);
    expect(await errorOf(foreignScope)).toContain("does not equal the request scope");

    const forgedAuthority = await post({ ...BASE, editorContext: editorContext({ authoritySource: "durable-server-board" }) });
    expect(forgedAuthority.status).toBe(400);
    expect(await errorOf(forgedAuthority)).toContain("authority claims are refused");
  });

  async function runTools(body: unknown): Promise<string> {
    const response = await post(body);
    expect(response.status).toBe(200);
    const text = await response.text();
    const completed = text.trim().split("\n").map((line) => JSON.parse(line) as { type: string; finalText?: string }).find((event) => event.type === "run_completed");
    return completed?.finalText ?? "";
  }

  it("a VALID editor context reaches the run: the exact current board activates canonical reads + selection inspection through the production route", async () => {
    const finalText = await runTools({
      ...BASE,
      schematicState: SCHEMATIC,
      editorContext: editorContext(),
    });
    expect(finalText).toContain("sirkit.pcb.board-inspect");
    expect(finalText).toContain("sirkit.validation.drc-run");
    expect(finalText).toContain("sirkit.selection.inspect");
    expect(finalText).not.toContain("component-authority");
  });

  it("without an editorContext the browser run is truthfully read-less (zero tools without proposal prerequisites) [PR-G, 2026-10-17: board-less - no board read and no proposal; only the two schematic-only Tier 0 reads its validated schematic admits] [PR-M, 2026-10-18: three since the schematic-instance inspection, still no board read and no proposal]", async () => {
    const finalText = await runTools({ ...BASE, schematicState: SCHEMATIC });
    // [PR-G, 2026-10-17] reviewed pin move: was "TOOLS:". Since PR-D d2 (sirkit.pcb-sync.preflight) and PR-F fB (sirkit.parts.missing-facts)
    // two Tier 0 reads are advertised over the run's VERIFIED schematic snapshot alone - no board (pcbSyncPreflightReadAvailable and
    // missingFactsReadAvailable require only context.schematic + schematicDigest) - and this run carries SCHEMATIC, which passes the
    // integrity check. The exact list still proves zero board reads (no board-inspect, drc-run or selection.inspect: no editorContext)
    // and zero proposals (no head mark, no board).
    expect(finalText).toBe("TOOLS:sirkit.parts.missing-facts;sirkit.pcb-sync.preflight;sirkit.schematic.instance-inspect"); // [PR-M, 2026-10-18] reviewed pin move (runbook M.2.1): + sirkit.schematic.instance-inspect, the third schematic-only Tier 0 read - its descriptor declares exactly the two reads' discovery requirements (read_project, schematic-present, local-working-copy, no board, no catalog authority) and instanceInspectionReadAvailable admits it over the verified schematic snapshot alone (the catalog port optional), as missing-facts and preflight; still zero board reads and zero proposals (the candidate search and the resolution proposal need the server's catalog facts, absent without a configured catalog)
  });
});
