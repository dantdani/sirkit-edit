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

  it("(d) unknown via padstack falls back to the default via dimensions", () => {
    const s = `(session x (routes (network_out (net "GND"
      (via "via_bogus" 5 5 (net "GND"))
    ))))`;
    const r = parseSes(s, board());
    expect(r.vias).toHaveLength(1);
    expect(r.vias[0].size).toBe(800000); // via_default outer
    expect(r.vias[0].drill).toBe(400000);
  });

  it("drops wires/vias whose net name isn't on the board (never assigns reserved net 0)", () => {
    const s = `(session x (routes (network_out (net "MYSTERY"
      (wire (path F.Cu 250000 0 0 1000 0) (net "MYSTERY"))
      (via "via_default" 5 5 (net "MYSTERY"))
    ))))`;
    const r = parseSes(s, board());
    expect(r.tracks).toHaveLength(0);
    expect(r.vias).toHaveLength(0);
  });

  it("returns an empty, unsuccessful result on unparseable input (no throw)", () => {
    const r = parseSes("this is not ( balanced", board());
    expect(r.wasSuccessful).toBe(false);
    expect(r.tracks).toHaveLength(0);
    expect(r.vias).toHaveLength(0);
  });
});
