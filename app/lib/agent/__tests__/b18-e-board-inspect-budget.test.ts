/**
 * [B18-E E3] What the agent can actually read of a board (scenario 1's precondition, A23's open question).
 *
 * `sirkit.pcb.board-inspect` answers with the whole AI PCB snapshot, and the loop refuses a tool result larger than
 * `MAX_RESULT_CHARS` with `output_too_large_for_model` — the model then gets NO board facts at all. A23 recorded the snapshot as
 * "not bounded below" that budget but never measured it. This measures it on real boards:
 *  - a PLACED board (the unit golden blinker, and the shape the browser scenarios bootstrap) fits, with margin;
 *  - a ROUTED board (the two recorded router results the browser fixture replays) does NOT.
 * So an id the model needs must be reachable without board-inspect — from the selection — which is why the execution tools name
 * `sirkit.selection.inspect` as an id source (E3) and why the bounded reads E10/E13 propose exist. If a later change makes the
 * snapshot smaller, this test says so rather than silently passing: it pins the direction, with the measured numbers recorded.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAX_RESULT_CHARS } from "../loop";
import { buildAIPcbSnapshot } from "../../pcb/ai/snapshot";
import { buildAutonomousGoldenBoard } from "../../pcb/__tests__/fixtures/autonomous-golden-board";
import type { PcbBoard } from "../../pcb/types";

/** Exactly what the read binding answers with (`read.board-snapshot`), as the loop would serialize it. */
const resultChars = (board: PcbBoard): number => JSON.stringify({ ok: true, output: { snapshot: buildAIPcbSnapshot(board) } }).length;
/** The boards the browser fixture replays a recorded routing for: each entry's `candidate` is a complete routed board. */
const routedBoards = (): Array<{ key: string; board: PcbBoard }> => {
  const fixture = JSON.parse(readFileSync("e2e/fixtures/blinker-route-fixture.json", "utf8")) as { entries: Record<string, { candidate: PcbBoard }> };
  return Object.entries(fixture.entries).map(([key, entry]) => ({ key, board: entry.candidate }));
};

describe("B18-E E3 — board-inspect against the model's result budget", () => {
  it("a placed board fits with margin; every recorded ROUTED board exceeds the budget, so the model would get no board facts", () => { // [B24-D2, 2026-10-09] board-inspect only: sirkit.pcb.board-page-inspect pages a routed board within the budget (OD-213, b24-d2-board-read); these assertions are unchanged
    expect(MAX_RESULT_CHARS).toBe(60_000);

    const placed = buildAutonomousGoldenBoard();
    expect(placed.tracks.length + placed.vias.length, "the golden blinker board is placed, not routed").toBe(0);
    const placedChars = resultChars(placed);
    expect(placedChars).toBeLessThan(MAX_RESULT_CHARS);
    expect(placedChars, `measured 40,410 characters for ${placed.footprints.length} footprints; a large drift means the snapshot changed shape`).toBeGreaterThan(20_000);

    const routed = routedBoards();
    expect(routed.length).toBeGreaterThan(0);
    for (const { key, board } of routed) {
      expect(board.tracks.length, key).toBeGreaterThan(0);
      expect(resultChars(board), `${key}: a routed board must still be over the budget (measured 70,173 and 72,453)`).toBeGreaterThan(MAX_RESULT_CHARS);
    }
  });
});
