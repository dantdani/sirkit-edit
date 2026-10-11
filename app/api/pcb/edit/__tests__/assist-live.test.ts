/**
 * Stage 17 Phase D gate (live): the assist endpoint returns VALIDATED
 * commands for the four example instructions against the real Claude API.
 * OPT-IN: export PCB_ASSIST_LIVE=1 AND a funded ANTHROPIC_API_KEY in the REAL
 * process environment to run. B16-B item 5: no test reads .env.local any more
 * (the key there had no credit balance, and an environment failure must never
 * surface as a functional one in the default suite), so the key has to be
 * exported explicitly for this run. Every response must pass the
 * CLIENT gate (compileEdits on the live board) — the same bar AssistBox
 * applies.
 *
 *   PCB_ASSIST_LIVE=1 ANTHROPIC_API_KEY=… pnpm vitest run app/api/pcb/edit/__tests__/assist-live.test.ts
 *
 * [B24-B3, 2026-10-08] D24-18, D24-19, OD-209: the suite runs on its flag alone. With PCB_ASSIST_LIVE=1 and the key absent it FAILS
 * `NOT EXERCISED` before any case body runs (the registry's gate, app/lib/evaluation/live-suites.ts), where it used to skip. Each case
 * injects an editor of the selected project and sends the selector headers, the origin and `provider: "anthropic"`
 * (`_assist-live-request.ts`): before B24-B3 the request was refused 400 `AUTH_PROJECT_SELECTOR_REQUIRED` before any model call, and
 * the route would have sent it to OpenAI. Recorded `not exercised`: no run with a funded key exists (LB-2, LB-7).
 */

import { afterEach, beforeAll, beforeEach, describe, it, expect } from "vitest";
import { injectAuthorizedPrincipal, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { assertLiveResources } from "@/app/lib/evaluation/live-suites";
import { buildRoutedDemo } from "@/app/lib/pcb/demo/routed-demo";
import { ensureBoardPadstacks } from "@/app/lib/pcb/padstack/migrate";
import { compileEdits } from "@/app/lib/pcb/edit/apply";
import type { SelectionRef } from "@/app/lib/pcb/edit/commands";
import { ASSIST_LIVE_PRINCIPAL, assistLiveRequest } from "./_assist-live-request";

const LIVE = process.env.PCB_ASSIST_LIVE === "1";

const board = buildRoutedDemo();
ensureBoardPadstacks(board);

async function assist(
  instruction: string,
  selection: SelectionRef[] = [],
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { POST } = await import("@/app/api/pcb/edit/assist/route");
  const res = await POST(assistLiveRequest(board, instruction, selection));
  const body = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body };
}

describe.runIf(LIVE)("POST /api/pcb/edit/assist (live Claude)", () => {
  beforeEach(() => { injectAuthorizedPrincipal(ASSIST_LIVE_PRINCIPAL); });
  afterEach(() => { resetInjectedIdentity(); });

  it("'make all GND traces 0.5 mm' → validated set-track-width", { timeout: 60_000 }, async () => {
    const { status, body } = await assist("make all GND traces 0.5 mm");
    // Paste-able evidence for the phase gate:
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

  beforeAll(() => assertLiveResources("assist-live")); // [B24-B3, 2026-10-08] the registry's gate, once in this block (hooks run before the cases wherever they sit)
});
