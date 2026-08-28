/**
 * B07.2 — KiCad export fails closed on canonical corruption.
 *
 * The /api/export/kicad route validates the COMPLETE SchematicState against
 * the shared canonical identity + geometry contract BEFORE any catalog
 * lookup or serialization and returns a structured, sanitized 422; the pure
 * serializer throws a typed SchematicExportValidationError instead of ever
 * silently renaming a canonical reference (B07.1's `_2` fallback is gone).
 * Valid exports stay byte-deterministic.
 */

import { describe, expect, it } from "vitest";
import type { SchematicState } from "@/lib/schematic-types";
import { POST } from "../route";
import { exportToKicadSch, SchematicExportValidationError } from "@/app/lib/kicad-export";

function validState(): SchematicState {
  return {
    components: [
      { id: "uuid-r1", type: "resistor", x: 100, y: 100, rotation: 0, value: "1k", refDes: "RSENSE" },
      { id: "uuid-g1", type: "ground", x: 100, y: 200, rotation: 0, value: "" },
    ],
    kicadComponents: [],
    wires: [{ id: "w1", vertices: [{ x: 130, y: 100 }, { x: 300, y: 100 }] }],
    netLabels: [{ id: "l1", position: { x: 300, y: 100 }, name: "VOUT", kind: "label", orientation: 0 }],
    pageSize: "A4",
  };
}

async function post(state: SchematicState): Promise<Response> {
  return POST(new Request("http://localhost/api/export/kicad", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state, title: "b072-test" }),
  }));
}

describe("B07.2 — /api/export/kicad fail-closed ingress", () => {
  it("T18: duplicate case-insensitive displayed references (R1 vs r1, cross-family) return a structured 422 with sanitized issues", async () => {
    const state = validState();
    state.components[0].refDes = "R1";
    state.kicadComponents = [{ id: "k1", partId: "p1", x: 500, y: 300, rotation: 0, refDes: "r1", value: "10k" }];
    const response = await post(state);
    expect(response.status).toBe(422);
    const body = await response.json() as { ok: boolean; code: string; issues: string[]; issueCount: number };
    expect(body.ok).toBe(false);
    expect(body.code).toBe("SCHEMATIC_STATE_INVALID");
    expect(body.issues.some((issue) => issue.includes("duplicate display reference"))).toBe(true);
    expect(body.issues.every((issue) => issue.length <= 300)).toBe(true); // sanitized
  });

  it("T19: duplicate stable IDs return 422", async () => {
    const state = validState();
    state.components.push({ ...state.components[0], refDes: "ROTHER" }); // same stable id
    const response = await post(state);
    expect(response.status).toBe(422);
    const body = await response.json() as { code: string; issues: string[] };
    expect(body.code).toBe("SCHEMATIC_STATE_INVALID");
    expect(body.issues.some((issue) => issue.includes("duplicate stable id"))).toBe(true);
  });

  it("T20: invalid geometry (off-grid coordinate, invalid rotation, malformed wire) returns 422", async () => {
    const offGrid = validState();
    offGrid.components[0].x = 101;
    const r1 = await post(offGrid);
    expect(r1.status).toBe(422);
    expect(((await r1.json()) as { issues: string[] }).issues.some((issue) => issue.includes("INVALID_PX"))).toBe(true);

    const badRotation = validState();
    (badRotation.components[0] as { rotation: number }).rotation = 45;
    expect((await post(badRotation)).status).toBe(422);

    const badWire = validState();
    badWire.wires[0].vertices = [{ x: 10, y: 10 }];
    expect((await post(badWire)).status).toBe(422);
  });

  it("T21: the serializer throws the TYPED validation error for duplicate references — no `_2` suffix repair exists", async () => {
    const state = validState();
    state.components[0].refDes = "R1";
    state.components.push({ id: "uuid-r2", type: "resistor", x: 300, y: 300, rotation: 0, value: "2k", refDes: "r1" });
    let thrown: unknown = null;
    try {
      exportToKicadSch({ state, parts: new Map() });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SchematicExportValidationError);
    expect((thrown as SchematicExportValidationError).issues.some((issue) => issue.includes("duplicate display reference"))).toBe(true);
  });

  it("T22: valid export remains byte-deterministic, contains the displayed reference verbatim, and never contains a `_2` synthetic suffix", async () => {
    const first = exportToKicadSch({ state: validState(), parts: new Map(), title: "b072-test" });
    const second = exportToKicadSch({ state: validState(), parts: new Map(), title: "b072-test" });
    expect(first).toBe(second);                     // byte-identical
    expect(first).toContain('"RSENSE"');            // displayed reference verbatim
    expect(first).not.toMatch(/"RSENSE_2"|"R1_2"/); // no silent rename artifacts

    const response = await post(validState());
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toBe(first);                       // route serializes the same bytes
  });

  it("empty and malformed bodies keep their 400 contract (unchanged)", async () => {
    const empty = validState();
    empty.components = [];
    empty.kicadComponents = [];
    expect((await post(empty)).status).toBe(400);
  });
});
