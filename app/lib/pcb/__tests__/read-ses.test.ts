// SES reader (Stage 9): wires→tracks (per-segment), vias with catalog lookup,
// net-name→id resolution, unknown-node tolerance, and via padstack fallback.

import { describe, it, expect } from "vitest";
import { parseSes } from "../dsn/read-ses";
import { createEmptyBoard } from "../types";
import type { PcbBoard } from "../types";

function board(): PcbBoard {
  return {
    ...createEmptyBoard(),
    nets: [
      { id: 0, name: "" },
      { id: 1, name: "GND" },
      { id: 2, name: "VCC" },
    ],
  };
}

const SES = `(session sirkit-export-abcdef01
  (routes
    (resolution nm 1)
    (network_out
      (net "GND"
        (wire (path F.Cu 250000 0 0 1000000 0) (net "GND") (type protect))
        (wire (path B.Cu 300000 1000000 0 1000000 1000000) (net "GND") (type protect))
        (via "via_default" 2000000 2000000 (net "GND") (type protect))
      )
      (net "VCC"
        (wire (path F.Cu 500000 0 0 0 500000) (net "VCC") (type protect))
      )
    )
  )
)`;

describe("parseSes", () => {
  it("(a) parses 3 wires → 3 tracks (correct widths + layers) and 1 via at the right coords", () => {
    const r = parseSes(SES, board());
    expect(r.wasSuccessful).toBe(true);
    expect(r.tracks).toHaveLength(3);
    expect(r.vias).toHaveLength(1);

    const t0 = r.tracks[0];
    expect(t0.layer).toBe("copperTop"); // F.Cu
    expect(t0.width).toBe(250000);
    expect(t0.start).toEqual({ x: 0, y: 0 });
    expect(t0.end).toEqual({ x: 1000000, y: 0 });

    const t1 = r.tracks[1];
    expect(t1.layer).toBe("copperBottom"); // B.Cu
    expect(t1.width).toBe(300000);

    const via = r.vias[0];
    expect(via.at).toEqual({ x: 2000000, y: 2000000 });
    expect(via.size).toBe(800000);
    expect(via.drill).toBe(400000);
    expect(via.layers).toEqual(["copperTop", "copperBottom"]);

    // fresh, unique ids
    const ids = [...r.tracks.map((t) => t.id), ...r.vias.map((v) => v.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("(b) tolerates unknown sibling/top-level nodes without throwing", () => {
    const noisy = `(session x
  (parser (host_cad "other"))
  (library (image "junk"))
  (routes
    (network_out
      (net "GND"
        (junk 1 2 3)
        (wire (path F.Cu 250000 0 0 1000000 0) (net "GND"))
      )
    )
  )
  (trailing_garbage 9 9)
)`;
    const r = parseSes(noisy, board());
    expect(r.tracks).toHaveLength(1);
    expect(r.tracks[0].netId).toBe(1);
  });

  it("(c) resolves net names to the board's net ids", () => {
    const r = parseSes(SES, board());
    // GND wires → net 1; VCC wire → net 2
    expect(r.tracks.filter((t) => t.netId === 1)).toHaveLength(2);
    expect(r.tracks.filter((t) => t.netId === 2)).toHaveLength(1);
  });

  it("converts Freerouting micrometer SES coordinates back to Sirkit nanometers", () => {
    const s = `(session x (routes (resolution um 1) (network_out (net "GND"
      (wire (path F.Cu 250 1.5 2 3 4) (net "GND"))
      (via "via_default" 5.25 6.5 (net "GND"))
    ))))`;
    const r = parseSes(s, board());
    expect(r.tracks[0]).toMatchObject({
      width: 250000,
      start: { x: 1500, y: 2000 },
      end: { x: 3000, y: 4000 },
    });
    expect(r.vias[0].at).toEqual({ x: 5250, y: 6500 });
  });

  it("rejects an unknown via padstack instead of inventing default geometry", () => {
    const s = `(session x (routes (network_out (net "GND"
      (via "via_bogus" 5 5 (net "GND"))
    ))))`;
    expect(() => parseSes(s, board())).toThrow(/unknown via padstack/i);
  });

  it("rejects routes whose net name is not on the board", () => {
    const s = `(session x (routes (network_out (net "MYSTERY"
      (wire (path F.Cu 250000 0 0 1000 0) (net "MYSTERY"))
      (via "via_default" 5 5 (net "MYSTERY"))
    ))))`;
    expect(() => parseSes(s, board())).toThrow(/unknown or unconnected net/i);
  });

  it("imports and reports both inner copper layers on a four-layer board", () => {
    const four = { ...board(), stackup: 4 as const };
    const s = `(session x (routes (resolution um 1) (network_out (net "GND"
      (wire (path In1.Cu 200 0 0 5 0) (net "GND"))
      (wire (path In2.Cu 220 5 0 5 5) (net "GND"))
      (via "via_default" 5 0 (net "GND"))
    ))))`;
    const r = parseSes(s, four);
    expect(r.tracks.map((track) => track.layer)).toEqual(["in1", "in2"]);
    expect(r.vias[0].layers).toEqual(["copperTop", "copperBottom"]);
    expect(r.layerUsage.in1).toMatchObject({ segments: 1, trackLengthNm: 5_000 });
    expect(r.layerUsage.in2).toMatchObject({ segments: 1, trackLengthNm: 5_000 });
  });

  it("rejects an inner-layer route when that layer is disabled by a two-layer stackup", () => {
    const s = `(session x (routes (network_out (net "GND"
      (wire (path In1.Cu 200000 0 0 5000000 0) (net "GND"))
    ))))`;
    expect(() => parseSes(s, board())).toThrow(/unknown or disabled copper layer/i);
  });

  it("returns an empty, unsuccessful result on unparseable input (no throw)", () => {
    const r = parseSes("this is not ( balanced", board());
    expect(r.wasSuccessful).toBe(false);
    expect(r.tracks).toHaveLength(0);
    expect(r.vias).toHaveLength(0);
  });
});
