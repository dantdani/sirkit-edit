// POST /api/pcb/export/gerbers (Stage 14): 200 zip on success, 400 with
// violations on the DRC gate, 500 on kicad-cli problems. buildFabBundle is
// mocked — the orchestrator has its own suite; this covers the HTTP mapping.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BundleResult } from "@/app/lib/pcb/fab/types";
import { FabExportGatedByDrc, KicadCliError } from "@/app/lib/pcb/fab/types";
import type { DrcViolation } from "@/app/lib/pcb/drc/types";
import { buildRoutedDemo } from "@/app/lib/pcb/demo/routed-demo";

const buildFabBundleMock = vi.fn();
vi.mock("@/app/lib/pcb/fab/build-bundle", () => ({
  buildFabBundle: (...args: unknown[]) => buildFabBundleMock(...args),
}));

import { POST } from "../route";

function request(body: unknown): Request {
  return new Request("http://localhost/api/pcb/export/gerbers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function fakeResult(): BundleResult {
  return {
    zipBytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
    filename: "sirkit-demo-jlcpcb-2l-2026-07-09.zip",
    stats: {
      drcErrors: 0,
      drcWarnings: 0,
      gerberFiles: ["a.GTL"],
      drillFiles: ["a-PTH.drl"],
      posFiles: ["a_cpl_top.csv", "a_cpl_bottom.csv"],
      bomFile: "a_bom.csv",
      totalBytes: 4,
      elapsedMs: 12,
    },
  };
}

const violations = [
  { id: "v1", kind: "short", severity: "error", summary: "VCC touches GND" },
] as unknown as DrcViolation[];

beforeEach(() => {
  buildFabBundleMock.mockReset();
});

describe("POST /api/pcb/export/gerbers", () => {
  it("(a) valid body → 200 application/zip with attachment filename", async () => {
    buildFabBundleMock.mockResolvedValue(fakeResult());
    const res = await POST(
      request({ board: buildRoutedDemo(), fabPresetId: "jlcpcb-2l", boardName: "sirkit-demo" }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/zip");
    expect(res.headers.get("Content-Disposition")).toContain("sirkit-demo-jlcpcb-2l");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
    // fab preset resolved from data, netlist derived from the board
    const input = buildFabBundleMock.mock.calls[0][0] as { fabPreset: { id: string }; netlist: unknown };
    expect(input.fabPreset.id).toBe("jlcpcb-2l");
    expect(input.netlist).toBeTruthy();
  });

  it("(b) DRC gate → 400 with error 'drc-failed' and the violations list", async () => {
    buildFabBundleMock.mockRejectedValue(new FabExportGatedByDrc(violations));
    const res = await POST(request({ board: buildRoutedDemo(), fabPresetId: "jlcpcb-2l" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; violations: unknown[] };
    expect(body.error).toBe("drc-failed");
    expect(body.violations.length).toBe(1);
  });

  it("(c) kicad-cli missing → 500 with error 'kicad-cli-missing'", async () => {
    buildFabBundleMock.mockRejectedValue(
      new KicadCliError("cli-missing", "kicad-cli not found", "ENOENT"),
    );
    const res = await POST(request({ board: buildRoutedDemo(), fabPresetId: "jlcpcb-2l" }));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("kicad-cli-missing");
  });

  it("kicad-cli failure → 500 with error 'kicad-cli-failed' and stderr", async () => {
    buildFabBundleMock.mockRejectedValue(
      new KicadCliError("cli-failed", "gerber export failed", "boom"),
    );
    const res = await POST(request({ board: buildRoutedDemo(), fabPresetId: "jlcpcb-2l" }));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; stderr?: string };
    expect(body.error).toBe("kicad-cli-failed");
    expect(body.stderr).toBe("boom");
  });

  it("bad bodies → 400 bad-request; unknown fab preset → 400", async () => {
    expect((await POST(request({ fabPresetId: "jlcpcb-2l" }))).status).toBe(400);
    expect((await POST(request({ board: buildRoutedDemo(), fabPresetId: "nope" }))).status).toBe(400);
    expect(buildFabBundleMock).not.toHaveBeenCalled();
  });
});
