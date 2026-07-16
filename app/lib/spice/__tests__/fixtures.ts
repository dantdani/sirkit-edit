import type { SchematicState } from "@/lib/schematic-types";

export function dividerSchematic(): SchematicState {
  return {
    components: [
      { id: "V1", type: "voltage-source", x: 100, y: 100, rotation: 0, value: "5V" },
      { id: "R1", type: "resistor", x: 200, y: 70, rotation: 0, value: "1kΩ" },
      { id: "G1", type: "ground", x: 230, y: 150, rotation: 0, value: "0" },
    ],
    wires: [
      { id: "w1", vertices: [{ x: 100, y: 70 }, { x: 170, y: 70 }] },
      { id: "w2", vertices: [{ x: 230, y: 70 }, { x: 230, y: 130 }] },
      { id: "w3", vertices: [{ x: 100, y: 130 }, { x: 230, y: 130 }] },
    ],
    netLabels: [
      { id: "label-vin", position: { x: 100, y: 70 }, name: "VIN", kind: "power", orientation: 0 },
      { id: "label-gnd", position: { x: 230, y: 130 }, name: "GND", kind: "ground", orientation: 0 },
    ],
  };
}
