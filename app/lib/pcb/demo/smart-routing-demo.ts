import type { FootprintDef, FootprintInstance, PcbBoard, Track } from "../types";
import { createEmptyBoard } from "../types";
import { mmToNm } from "../units";

function terminalDef(): FootprintDef {
  return {
    libName: "Sirkit",
    name: "SmartRouteTerminal",
    attributes: { smd: true, throughHole: false, excludeFromPos: false, excludeFromBom: false },
    pads: [{
      number: "1",
      type: "smd",
      shape: { kind: "circle", radius: mmToNm(0.5) },
      at: { x: 0, y: 0 },
      rotationDeg: 0,
      layers: ["copperTop", "maskTop"],
    }],
    graphics: [],
    bodyBBox: { minX: -mmToNm(0.5), minY: -mmToNm(0.5), maxX: mmToNm(0.5), maxY: mmToNm(0.5) },
    models: [],
    rawSexpr: "",
  };
}
function terminal(id: string, ref: string, xMm: number): FootprintInstance {
  return {
    id,
    ref,
    footprintId: "Sirkit:SmartRouteTerminal",
    def: terminalDef(),
    at: { x: mmToNm(xMm), y: mmToNm(30) },
    rotationDeg: 0,
    side: "top",
    padNets: { "1": 1 },
  };
}

/** Golden Phase-1 fixture: a foreign-net wall with legal CW and CCW paths. */
export function buildSmartRoutingDemo(): PcbBoard {
  const blocker: Track = {
    id: "smart-demo-blocker",
    layer: "copperTop",
    width: mmToNm(0.25),
    start: { x: mmToNm(40), y: mmToNm(20) },
    end: { x: mmToNm(40), y: mmToNm(40) },
    netId: 2,
  };
  return {
    ...createEmptyBoard(),
    identityVersion: 1,
    nets: [
      { id: 0, name: "", stableId: "net:unconnected", endpointKeys: [] },
      { id: 1, name: "SIGNAL", stableId: "net:signal", endpointKeys: [] },
      { id: 2, name: "BLOCKER", stableId: "net:blocker", endpointKeys: [] },
    ],
    footprints: [terminal("smart-a", "J1", 20), terminal("smart-b", "J2", 60)],
    tracks: [blocker],
  };
}
