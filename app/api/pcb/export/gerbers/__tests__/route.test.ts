import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BundleResult } from "@/app/lib/pcb/fab/types";
import { KicadCliError } from "@/app/lib/pcb/fab/types";
import { createEmptyBoard } from "@/app/lib/pcb/types";
import { evaluatePcbFabricationReadiness } from "@/app/lib/pcb/readiness/evaluate";
import { getFabPreset } from "@/app/lib/pcb/fab/presets";
import { getPreset } from "@/app/lib/pcb/drc/presets";
import { ManufacturingReleaseBlockedError } from "@/app/lib/pcb/readiness/release";
import type { ManufacturingReleaseManifest } from "@/app/lib/pcb/readiness/types";

const buildFabBundleMock = vi.fn();
const compileNativeMock = vi.fn();
vi.mock("@/app/lib/pcb/fab/build-bundle", () => ({ buildFabBundle: (...args: unknown[]) => buildFabBundleMock(...args) }));
vi.mock("@/app/lib/pcb/fab/native/compiler", () => ({ compileNativeFabPackage: (...args: unknown[]) => compileNativeMock(...args) }));

import { POST } from "../route";

const board = createEmptyBoard();
const netlist = { components: [], nets: [] };
const readiness = evaluatePcbFabricationReadiness({
  board,
  netlist,
  fabPreset: getFabPreset("jlcpcb-2l"),
  drcPreset: getPreset("jlcpcb-2l"),
});
const releaseManifest = {
  disposition: "verified_manufacturing_release",
  verified: true,
  designRevision: readiness.designRevision,
  readinessReportId: readiness.reportId,
} as ManufacturingReleaseManifest;

function request(body: unknown): Request {
  return new Request("http://localhost/api/pcb/export/gerbers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function fakeResult(): BundleResult {
  return {
    sourceRevision: readiness.designRevision,
    readiness,
    releaseManifest,
    zipBytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
    filename: "sirkit-demo-jlcpcb-2l-2026-07-17.zip",
    stats: {
      drcErrors: 0,
      drcWarnings: 0,
      gerberFiles: ["a.GTL"],
      drillFiles: ["a-PTH.drl"],
      posFiles: [],
      bomFile: "a_bom.csv",
      totalBytes: 4,
      elapsedMs: 12,
    },
  };
}

beforeEach(() => {
  buildFabBundleMock.mockReset();
  compileNativeMock.mockReset();
});

describe("POST /api/pcb/export/gerbers Stage 3 release policy", () => {
  it("rejects a browser-supplied board as verified manufacturing authority", async () => {
    buildFabBundleMock.mockResolvedValue(fakeResult());
    const response = await POST(request({ board, netlist, fabPresetId: "jlcpcb-2l", boardName: "sirkit-demo" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "authoritative-release-source-required" });
    expect(buildFabBundleMock).not.toHaveBeenCalled();
  });

  it("preflight returns the same scoped report and missing schematic stays incomplete", async () => {
    const response = await POST(request({ board, fabPresetId: "jlcpcb-2l", engine: "native-beta", action: "preflight" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.readiness.overallState).toBe("verification_incomplete");
    expect(body.readiness.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "SCHEMATIC_PARITY", state: "unknown" }),
    ]));
    const expected = evaluatePcbFabricationReadiness({
      board,
      fabPreset: getFabPreset("jlcpcb-2l"),
      drcPreset: getPreset("jlcpcb-2l"),
      exporter: "sirkit-native",
    });
    expect(body.readiness.reportId).toBe(expected.reportId);
    expect(compileNativeMock).not.toHaveBeenCalled();
  });

  it("creates an explicit revision-bound waiver only for an engineering artifact", async () => {
    buildFabBundleMock.mockResolvedValue({
      ...fakeResult(),
      releaseManifest: { ...releaseManifest, disposition: "engineering_prototype_export", verified: false },
    });
    const response = await POST(request({
      board,
      fabPresetId: "jlcpcb-2l",
      releaseMode: "engineering",
      waiverReason: "PCB-only prototype for mechanical fit review",
    }));
    expect(response.status).toBe(200);
    expect(buildFabBundleMock.mock.calls[0][0]).toMatchObject({
      schematicIntentAvailable: false,
      releaseDisposition: "engineering_prototype_export",
      waivers: [expect.objectContaining({
        designRevision: readiness.designRevision,
        permits: "engineering_prototype_export",
        checkCodes: ["SCHEMATIC_PARITY"],
      })],
    });
  });

  it("retires generic override and requires a reasoned engineering mode", async () => {
    expect((await POST(request({ board, netlist, fabPresetId: "jlcpcb-2l", overrideDrcFail: true }))).status).toBe(400);
    expect((await POST(request({ board, netlist, fabPresetId: "jlcpcb-2l", releaseMode: "engineering" }))).status).toBe(400);
  });

  it("maps stale or denied readiness to a release-gate response", async () => {
    buildFabBundleMock.mockRejectedValue(new ManufacturingReleaseBlockedError("VERIFIED_RELEASE_DENIED", "not ready", readiness));
    const response = await POST(request({ board, netlist, fabPresetId: "jlcpcb-2l", releaseMode: "engineering", waiverReason: "Controlled fixture export" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "readiness-gate-failed", code: "VERIFIED_RELEASE_DENIED" });
  });

  it("maps kicad-cli failures after readiness evaluation", async () => {
    buildFabBundleMock.mockRejectedValue(new KicadCliError("cli-missing", "kicad-cli not found", "ENOENT"));
    const response = await POST(request({ board, netlist, fabPresetId: "jlcpcb-2l", releaseMode: "engineering", waiverReason: "Controlled fixture export" }));
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: "kicad-cli-missing" });
  });

  it("validates malformed bodies before any release work", async () => {
    expect((await POST(request({ fabPresetId: "jlcpcb-2l" }))).status).toBe(400);
    expect((await POST(request({ board, fabPresetId: "nope" }))).status).toBe(400);
    expect(buildFabBundleMock).not.toHaveBeenCalled();
  });
});
