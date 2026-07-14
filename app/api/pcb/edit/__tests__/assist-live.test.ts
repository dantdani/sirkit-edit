/**
 * Stage 17 Phase D gate (live): the assist endpoint returns VALIDATED
 * commands for the four example instructions against the real Claude API.
 * OPT-IN: set PCB_ASSIST_LIVE=1 (plus a funded ANTHROPIC_API_KEY) to run —
 * the key in .env.local currently has no credit balance, so gating on the
 * key alone would fail every `pnpm test`. Every response must pass the
 * CLIENT gate (compileEdits on the live board) — the same bar AssistBox
 * applies.
 *
 *   PCB_ASSIST_LIVE=1 pnpm vitest run app/api/pcb/edit/__tests__/assist-live.test.ts
 */

import { describe, it, expect } from "vitest";
import { loadEnvLocal } from "../../../../lib/load-env-local";
import { buildRoutedDemo } from "@/app/lib/pcb/demo/routed-demo";
import { ensureBoardPadstacks } from "@/app/lib/pcb/padstack/migrate";
import { buildDigest, buildItemIndex } from "@/app/lib/pcb/edit/digest";
import { compileEdits } from "@/app/lib/pcb/edit/apply";
import type { SelectionRef } from "@/app/lib/pcb/edit/commands";

loadEnvLocal();
const hasKey =
  typeof process.env.ANTHROPIC_API_KEY === "string" &&
  process.env.ANTHROPIC_API_KEY !== "" &&
  process.env.PCB_ASSIST_LIVE === "1";

const board = buildRoutedDemo();
ensureBoardPadstacks(board);

async function assist(
  instruction: string,
  selection: SelectionRef[] = [],
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { POST } = await import("@/app/api/pcb/edit/assist/route");
  const payload = {
    instruction,
    digest: buildDigest(board, selection, { presetId: "jlcpcb-2l" }),
    items: buildItemIndex(board),
  };
  const res = await POST(
    new Request("http://localhost/api/pcb/edit/assist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
  const body = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body };
}

describe.skipIf(!hasKey)("POST /api/pcb/edit/assist (live Claude)", () => {
  it("'make all GND traces 0.5 mm' → validated set-track-width", { timeout: 60_000 }, async () => {
    const { status, body } = await assist("make all GND traces 0.5 mm");
    // Paste-able evidence for the phase gate:
    // eslint-disable-next-line no-console
    console.log("[stage17-d live] response:", JSON.stringify(body).slice(0, 800));
    expect(status).toBe(200);
    const commands = body.commands as { op: string; widthNm?: number; ids?: string[] }[];
    expect(commands.length).toBeGreaterThan(0);
    const width = commands.find((c) => c.op === "set-track-width");
    expect(width?.widthNm).toBe(500_000);
    const gnd = board.nets.find((n) => n.name === "GND")?.id;
    const gndIds = new Set(board.tracks.filter((t) => t.netId === gnd).map((t) => t.id));
    expect(width?.ids?.every((id) => gndIds.has(id))).toBe(true);
    expect(compileEdits(board, commands as never).errors).toEqual([]);
  });

  it("'align these vertically' on the two vias → validated align", { timeout: 60_000 }, async () => {
    const selection: SelectionRef[] = board.vias.map((v) => ({ kind: "via", id: v.id }));
    const { status, body } = await assist("align these vertically", selection);
    expect(status).toBe(200);
    const commands = body.commands as { op: string }[];
    expect(commands.some((c) => c.op === "align")).toBe(true);
    expect(compileEdits(board, commands as never).errors).toEqual([]);
  }, );

  it("'switch selected vias to the power padstack' → set-via-padstack", { timeout: 60_000 }, async () => {
    const selection: SelectionRef[] = board.vias.map((v) => ({ kind: "via", id: v.id }));
    const { status, body } = await assist("switch selected vias to the power padstack", selection);
    expect(status).toBe(200);
    const commands = body.commands as { op: string; padstackId?: string }[];
    const cmd = commands.find((c) => c.op === "set-via-padstack");
    expect(cmd?.padstackId).toBe("via-power");
    expect(compileEdits(board, commands as never).errors).toEqual([]);
  });

  it("'move R3 next to U1' → clarifying question or a sane set-position/move", { timeout: 60_000 }, async () => {
    const { status, body } = await assist("move R3 next to U1");
    expect(status).toBe(200);
    if (typeof body.question === "string") {
      expect(body.question.length).toBeGreaterThan(0); // asking is a valid outcome
      return;
    }
    const commands = body.commands as { op: string }[];
    expect(commands.length).toBeGreaterThan(0);
    expect(
      commands.every((c) => c.op === "set-position" || c.op === "move-items"),
    ).toBe(true);
    expect(compileEdits(board, commands as never).errors).toEqual([]);
  });
});
