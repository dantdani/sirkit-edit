import { describe, expect, it } from "vitest";
import { classifyNetRelation, decideCopperPair, violatesOrdinaryCopperClearance } from "../copper-policy";
import { createEmptyBoard } from "../types";

function board() {
  const value = createEmptyBoard();
  value.nets.push(
    { id: 1, name: "3V3", stableId: "net:3v3", endpointKeys: [] },
    { id: 2, name: "GND", stableId: "net:gnd", endpointKeys: [] },
  );
  return value;
}

describe("shared copper-pair policy", () => {
  it("allows same proven net contact and removes only ordinary inter-net clearance", () => {
    const decision = decideCopperPair({
      board: board(), leftNetId: 1, rightNetId: 1, operation: "drc",
      interNetClearanceNm: 127_000, manufacturingChecks: ["TRACK_WIDTH", "COPPER_EDGE"],
    });
    expect(decision).toMatchObject({
      relation: "same-proven-net",
      mayTouchElectrically: true,
      shouldUnionWhenTouching: true,
      createsShortWhenTouching: false,
      requiredElectricalClearanceNm: null,
      status: "proven",
    });
    expect(decision.applicableManufacturingChecks).toEqual(["COPPER_EDGE", "TRACK_WIDTH"]);
    expect(violatesOrdinaryCopperClearance(48_000, decision)).toBe(false);
  });

  it("preserves different-net clearance and short semantics", () => {
    const decision = decideCopperPair({
      board: board(), leftNetId: 1, rightNetId: 2, operation: "connectivity", interNetClearanceNm: 127_000,
    });
    expect(decision).toMatchObject({
      relation: "different-proven-nets",
      mayTouchElectrically: false,
      shouldUnionWhenTouching: false,
      createsShortWhenTouching: true,
      requiredElectricalClearanceNm: 127_000,
    });
    expect(violatesOrdinaryCopperClearance(48_000, decision)).toBe(true);
  });

  it("never infers equivalence for net zero or unresolved stable identity", () => {
    const value = board();
    expect(classifyNetRelation(value, 1, 0)).toBe("proven-net-to-unassigned");
    expect(classifyNetRelation(value, 0, 0)).toBe("unassigned-to-unassigned");
    value.nets.find((net) => net.id === 1)!.stableId = undefined;
    expect(classifyNetRelation(value, 1, 1)).toBe("unknown");
    expect(decideCopperPair({
      board: value, leftNetId: 1, rightNetId: 1, operation: "route-preview", interNetClearanceNm: 127_000,
    }).requiredElectricalClearanceNm).toBe(127_000);
  });
});
