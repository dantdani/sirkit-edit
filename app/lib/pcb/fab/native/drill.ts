import type { ManufacturingIr, MirDrill, MirLayer, MirPrimitive } from "./types";

export interface DrillGroup {
  id: string;
  plated: boolean;
  span: [number, number];
  fileFunction: string;
  drills: MirDrill[];
}

function decimalNm(nm: number): string {
  const text = (nm / 1_000_000).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return text === "-0" || text === "" ? "0" : text;
}

function coordinate(nm: number): string {
  const value = decimalNm(nm);
  return value === "-0" ? "0" : value;
}

function drillFunction(drill: MirDrill): "ViaDrill" | "ComponentDrill" | "MechanicalDrill" {
  if (drill.sourceIds.length === 1 && drill.plated) return "ViaDrill";
  if (drill.plated) return "ComponentDrill";
  return "MechanicalDrill";
}

export function groupDrills(mir: ManufacturingIr): DrillGroup[] {
  const groups = new Map<string, DrillGroup>();
  for (const drill of mir.drills) {
    const key = `${drill.plated ? "pth" : "npth"}-${drill.span[0]}-${drill.span[1]}`;
    let group = groups.get(key);
    if (!group) {
      const [from, to] = drill.span;
      group = {
        id: key,
        plated: drill.plated,
        span: drill.span,
        fileFunction: drill.plated
          ? `Plated,${from},${to},${from === 1 && to === mir.layerCount ? "PTH" : "Blind"}`
          : `NonPlated,${from},${to},NPTH`,
        drills: [],
      };
      groups.set(key, group);
    }
    group.drills.push(drill);
  }
  return [...groups.values()]
    .map((group) => ({ ...group, drills: [...group.drills].sort((a, b) => a.id.localeCompare(b.id)) }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function drillGroupAsGerberLayer(group: DrillGroup): MirLayer {
  const primitives: MirPrimitive[] = group.drills.map((drill) => {
    const apertureFunction = drillFunction(drill);
    if (drill.kind === "hit") {
      return {
        kind: "flash",
        id: drill.id,
        at: drill.at,
        shape: { kind: "circle", radius: drill.diameterNm / 2 },
        rotationDeg: 0,
        apertureFunction,
        attributes: {},
        sourceIds: drill.sourceIds,
      };
    }
    return {
      kind: "stroke",
      id: drill.id,
      start: drill.start,
      end: drill.end,
      widthNm: drill.diameterNm,
      apertureFunction,
      attributes: {},
      sourceIds: drill.sourceIds,
    };
  });
  return {
    id: `gerber-${group.id}`,
    filenameRole: `gerber-${group.id}`,
    fileFunction: group.fileFunction,
    polarity: "Positive",
    primitives,
  };
}

export function writeXnc(group: DrillGroup): string {
  const tools = [...new Map(group.drills.map((drill) => {
    const diameterNm = Math.round(drill.diameterNm);
    const apertureFunction = drillFunction(drill);
    return [`${diameterNm}|${apertureFunction}`, { diameterNm, apertureFunction }] as const;
  })).entries()]
    .map(([key, value]) => ({ key, ...value }))
    .sort((a, b) => a.diameterNm - b.diameterNm || a.apertureFunction.localeCompare(b.apertureFunction));
  if (tools.length > 99) throw new Error(`XNC group ${group.id} requires more than 99 tools`);
  const toolNumber = new Map(tools.map((tool, index) => [tool.key, index + 1]));

  const lines = [
    "M48",
    `; #@! TF.FileFunction,${group.fileFunction}`,
    "; #@! TF.GenerationSoftware,Sirkit,Sirkit Fab Compiler,0.1.0",
    "METRIC",
  ];
  let lastFunction = "";
  for (const tool of tools) {
    if (tool.apertureFunction !== lastFunction) {
      lines.push(`; #@! TA.AperFunction,${tool.apertureFunction}`);
      lastFunction = tool.apertureFunction;
    }
    lines.push(`T${String(toolNumber.get(tool.key)).padStart(2, "0")}C${decimalNm(tool.diameterNm)}`);
  }
  lines.push("%", "G05");

  for (const definition of tools) {
    const tool = String(toolNumber.get(definition.key)).padStart(2, "0");
    const drills = group.drills.filter((drill) =>
      Math.round(drill.diameterNm) === definition.diameterNm &&
      drillFunction(drill) === definition.apertureFunction,
    );
    const hits = drills.filter((drill): drill is Extract<MirDrill, { kind: "hit" }> => drill.kind === "hit");
    const slots = drills.filter((drill): drill is Extract<MirDrill, { kind: "slot" }> => drill.kind === "slot");
    if (hits.length > 0) {
      lines.push("G05", `T${tool}`);
      for (const hit of hits) lines.push(`X${coordinate(hit.at.x)}Y${coordinate(hit.at.y)}`);
    }
    for (const slot of slots) {
      lines.push(
        `T${tool}`,
        `G00X${coordinate(slot.start.x)}Y${coordinate(slot.start.y)}`,
        "M15",
        `G01X${coordinate(slot.end.x)}Y${coordinate(slot.end.y)}`,
        "M16",
      );
    }
  }
  lines.push("M30");
  return `${lines.join("\r\n")}\r\n`;
}
