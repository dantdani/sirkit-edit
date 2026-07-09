// POST /api/pcb/autoroute (Stage 9): success → stats from parsed SES, runner
// timeout → 500, missing FREEROUTING_JAR → 500 (runner never called), bad body
// → 400. runFreerouting is mocked; boardToDsn/writeDsn/parseSes run for real.

import { describe, it, expect, vi, beforeEach } from "vitest";

const runMock = vi.hoisted(() => vi.fn());
vi.mock("@/app/lib/pcb/autoroute/runner", () => ({ runFreerouting: runMock }));

import { POST } from "@/app/api/pcb/autoroute/route";
import { buildRoutedDemo } from "@/app/lib/pcb/demo/routed-demo";

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
    process.env.FREEROUTING_JAR = "/fake/freerouting-2.2.0.jar";
  });

  it("returns ok + stats derived from the parsed SES on success", async () => {
    runMock.mockResolvedValue({ ok: true, sesText: SES, stderr: "", elapsedMs: 4200 });
    const res = await post({ board: buildRoutedDemo() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.sesText).toContain("network_out");
    expect(body.stats.tracksImported).toBe(2);
    expect(body.stats.viasImported).toBe(1);
    expect(body.stats.elapsedMs).toBe(4200);
    expect(runMock).toHaveBeenCalledTimes(1);
  });

  it("maps a runner timeout to 500 with error:'timeout'", async () => {
    runMock.mockResolvedValue({ ok: false, error: "timeout", stderr: "", elapsedMs: 1 });
    const res = await post({ board: buildRoutedDemo() });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("timeout");
  });

  it("missing FREEROUTING_JAR → 500 error:'jar-missing' and the runner is never called", async () => {
    delete process.env.FREEROUTING_JAR;
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
