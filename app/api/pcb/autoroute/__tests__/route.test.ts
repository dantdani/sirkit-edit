// POST /api/pcb/autoroute (Stage 9): success → stats from parsed SES, runner
// timeout → 500, missing FREEROUTING_JAR → 500 (runner never called), bad body
// → 400. runFreerouting is mocked; boardToDsn/writeDsn/parseSes run for real.

import { describe, it, expect, vi, beforeEach } from "vitest";

const runMock = vi.hoisted(() => vi.fn());
const runtimeMock = vi.hoisted(() => vi.fn());
vi.mock("@/app/lib/pcb/autoroute/runner", () => ({ runFreerouting: runMock }));
vi.mock("@/app/lib/pcb/autoroute/runtime", () => ({
  resolveFreeroutingRuntime: runtimeMock,
}));

import { POST } from "@/app/api/pcb/autoroute/route";
import { buildRoutedDemo } from "@/app/lib/pcb/demo/routed-demo";
import { createEmptyBoard, type FootprintDef, type PcbBoard } from "@/app/lib/pcb/types";
import { mmToNm } from "@/app/lib/pcb/units";

// GND is net 1 in the routed demo → these wires/via resolve to a real net.
const SES = `(session test
  (routes
    (network_out
      (net "GND"
        (wire (path F.Cu 250000 0 0 1000000 0) (net "GND"))
        (wire (path F.Cu 250000 1000000 0 1000000 1000000) (net "GND"))
        (via "via_default" 500000 500000 (net "GND"))
      )
    )
  )
)`;

const CHAIN_DEF: FootprintDef = {
  libName: "RouteTest",
  name: "P1",
  attributes: { smd: true, throughHole: false, excludeFromPos: false, excludeFromBom: false },
  pads: [{ number: "1", type: "smd", shape: { kind: "circle", radius: mmToNm(0.3) }, at: { x: 0, y: 0 }, rotationDeg: 0, layers: ["copperTop", "copperBottom"] }],
  graphics: [],
  courtyardBBox: { minX: mmToNm(-0.5), minY: mmToNm(-0.5), maxX: mmToNm(0.5), maxY: mmToNm(0.5) },
  bodyBBox: { minX: mmToNm(-0.4), minY: mmToNm(-0.4), maxX: mmToNm(0.4), maxY: mmToNm(0.4) },
  models: [],
  rawSexpr: "",
};

function chainBoard(): PcbBoard {
  return {
    ...createEmptyBoard(),
    outline: { kind: "rect", origin: { x: 0, y: 0 }, width: mmToNm(30), height: mmToNm(20) },
    nets: [{ id: 0, name: "" }, { id: 1, name: "CHAIN" }],
    footprints: [5, 15, 25].map((x, index) => ({
      id: `p${index}`,
      ref: `P${index + 1}`,
      footprintId: "RouteTest:P1",
      def: CHAIN_DEF,
      at: { x: mmToNm(x), y: mmToNm(10) },
      rotationDeg: 0,
      side: "top" as const,
      padNets: { "1": 1 },
    })),
  };
}

const chainSes = (complete: boolean): string => `(session chain
  (routes
    (resolution um 1)
    (network_out
      (net "CHAIN"
        (wire (path F.Cu 250 5000 10000 15000 10000) (net "CHAIN"))
        ${complete ? '(wire (path B.Cu 250 15000 10000 25000 10000) (net "CHAIN"))' : ""}
      )
    )
  )
)`;

function post(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/pcb/autoroute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/pcb/autoroute", () => {
  beforeEach(() => {
    runMock.mockReset();
    runtimeMock.mockReset();
    runtimeMock.mockResolvedValue({
      ok: true,
      jarPath: "/fake/freerouting-2.2.4.jar",
      javaPath: "/fake/java",
      version: "2.2.4",
      jarSource: "bundled-release",
      javaSource: "bundled-jre",
    });
  });

  it("returns ok + stats derived from the parsed SES on success", async () => {
    runMock.mockResolvedValue({ ok: true, sesText: SES, stderr: "", elapsedMs: 4200 });
    const res = await post({ board: buildRoutedDemo(), maxCompletionPasses: 1 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.sesText).toContain("network_out");
    expect(body.stats.tracksImported).toBe(2);
    expect(body.stats.viasImported).toBe(1);
    expect(body.stats.elapsedMs).toBe(4200);
    expect(body.engine).toEqual({
      name: "Freerouting",
      version: "2.2.4",
      source: "bundled-release",
      runtime: "bundled-jre",
      apiKeyRequired: false,
    });
    expect(runMock).toHaveBeenCalledTimes(1);
  });

  it("offers only selected affected nets as autoroute work while preserving the board", async () => {
    runMock.mockResolvedValue({ ok: true, sesText: SES, stderr: "", elapsedMs: 100 });
    const res = await post({ board: buildRoutedDemo(), netIds: [1] });
    expect(res.status).toBe(200);
    const dsnText = runMock.mock.calls[0][0].dsnText as string;
    expect(dsnText).toContain('\n    (net "GND"\n');
    expect(dsnText).not.toContain('\n    (net "VCC"\n');
    expect(dsnText).not.toContain('\n    (net "SIG"\n');
  });

  it("runs a global pass then selected-net completion pass until connectivity is complete", async () => {
    runMock
      .mockResolvedValueOnce({ ok: true, sesText: chainSes(false), stderr: "pass 1", elapsedMs: 100 })
      .mockResolvedValueOnce({ ok: true, sesText: chainSes(true), stderr: "pass 2", elapsedMs: 120 });
    const res = await post({ board: chainBoard() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.job.status).toBe("complete");
    expect(body.verification).toMatchObject({ requiredConnections: 2, completedConnections: 2, remainingConnections: 0 });
    expect(body.completion.acceptedPasses).toBe(2);
    expect(body.completion.passes).toHaveLength(2);
    expect(body.completion.passes[0]).toMatchObject({ scope: "all_incomplete", accepted: true });
    expect(body.completion.passes[1]).toMatchObject({ scope: "selected_incomplete", targetNetIds: [1], accepted: true });
    expect(body.routes.tracks).toHaveLength(2);
    expect(runMock).toHaveBeenCalledTimes(2);
    const retryDsn = runMock.mock.calls[1][0].dsnText as string;
    expect(retryDsn).toContain('\n    (net "CHAIN"\n');
  });

  it("rejects an unknown selected net before launching the engine", async () => {
    const res = await post({ board: buildRoutedDemo(), netIds: [999] });
    expect(res.status).toBe(400);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("maps a runner timeout to 500 with error:'timeout'", async () => {
    runMock.mockResolvedValue({ ok: false, error: "timeout", stderr: "", elapsedMs: 1 });
    const res = await post({ board: buildRoutedDemo() });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("timeout");
  });

  it("missing local runtime returns jar-missing and never calls the runner", async () => {
    runtimeMock.mockResolvedValue({
      ok: false,
      error: "jar-missing",
      stderr: "Run npm run setup:freerouting; no API key required.",
    });
    const res = await post({ board: buildRoutedDemo() });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("jar-missing");
    expect(runMock).not.toHaveBeenCalled();
  });

  it("malformed body (board not a PcbBoard) → 400 and the runner is never called", async () => {
    const res = await post({ board: { nope: true } });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("invalid JSON body → 400", async () => {
    const res = await POST(
      new Request("http://localhost/api/pcb/autoroute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{ not json",
      }),
    );
    expect(res.status).toBe(400);
  });
});
