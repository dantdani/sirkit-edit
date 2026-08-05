/**
 * R06 final audit — netlist freshness (stale-fallback regression).
 *
 * The editor's fabrication checks, readiness, DRC-repair context,
 * autoroute/autoplace verification and KiCad export must consume ONLY the
 * live netlist derived from the current schematic. A sync-time snapshot has
 * no revision binding to the current schematic, and it would only ever be
 * consulted exactly when the current schematic cannot produce a netlist —
 * the moment a stale snapshot must not silently substitute. When no live
 * netlist exists, the truthful value is null and downstream checks must say
 * "not evaluated", never "pass".
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildSchematicParityCertificate } from "@/app/lib/pcb/readiness/parity";
import { createEmptyBoard } from "@/app/lib/pcb/types";
import type { PcbNetlist } from "@/app/lib/pcb/netlist-bridge";

const source = readFileSync(`${process.cwd()}/app/components/pcb/PcbEditor.tsx`, "utf8");

describe("netlist freshness (R06 stale-fallback audit)", () => {
  it("PcbEditor holds no sync-time netlist snapshot state at all", () => {
    expect(source).not.toContain("setNetlist(");
    expect(source).not.toMatch(/useState<PcbNetlist \| null>/);
  });

  it("PcbEditor never falls back from the live netlist to another netlist source", () => {
    expect(source).not.toContain("liveNetlist ?? netlist");
    expect(source).not.toMatch(/getNetlist:\s*\(\)\s*=>\s*netlist\b/);
    // Every netlist consumer reads the live derivation only.
    expect(source.match(/getNetlist:\s*\(\)\s*=>\s*liveNetlist,/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });

  it("absent netlist yields NOT-EVALUATED parity — never a silent pass", () => {
    const board = createEmptyBoard();
    const certificate = buildSchematicParityCertificate(board, "rev-x", undefined);
    expect(certificate.state).toBe("unknown");
    expect(certificate.source).toBe("unavailable");
    expect(certificate.diagnostics.some((item) => item.code === "SCHEMATIC_PARITY_NOT_EVALUATED")).toBe(true);
  });

  it("a netlist that disagrees with the board FAILS parity (stale input is caught, not absorbed)", () => {
    const board = createEmptyBoard();
    const staleNetlist: PcbNetlist = {
      components: [{ id: "ghost-component", ref: "U9", value: "NE555", pins: [{ number: "1", name: "GND" }], pinPadMapping: {} }],
      nets: [{ name: "GHOST_NET", endpointKeys: ["ghost-component::1"], nodes: [{ componentId: "ghost-component", pinNumber: "1" }] }],
    } as unknown as PcbNetlist;
    const certificate = buildSchematicParityCertificate(board, "rev-x", staleNetlist);
    expect(certificate.state).not.toBe("pass");
    expect(certificate.missingComponents).toContain("ghost-component");
  });
});
