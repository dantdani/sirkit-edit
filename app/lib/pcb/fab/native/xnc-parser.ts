export interface ParsedXncTool {
  code: number;
  diameterNm: number;
  apertureFunction?: string;
}

export type ParsedXncObject =
  | { kind: "hit"; at: { x: number; y: number }; diameterNm: number }
  | { kind: "slot"; start: { x: number; y: number }; end: { x: number; y: number }; diameterNm: number };

export interface ParsedXnc {
  fileFunction?: string;
  tools: Map<number, ParsedXncTool>;
  objects: ParsedXncObject[];
  errors: string[];
}

const nm = (value: string): number => Math.round(Number(value) * 1_000_000);

function point(command: string): { x: number; y: number } | null {
  const match = command.match(/^X([+-]?(?:\d+(?:\.\d*)?|\.\d+))Y([+-]?(?:\d+(?:\.\d*)?|\.\d+))$/);
  return match ? { x: nm(match[1]), y: nm(match[2]) } : null;
}

export function parseXnc(text: string): ParsedXnc {
  const lines = text.replace(/\r/g, "").split("\n").filter(Boolean);
  const errors: string[] = [];
  const tools = new Map<number, ParsedXncTool>();
  const objects: ParsedXncObject[] = [];
  let fileFunction: string | undefined;
  let apertureFunction: string | undefined;
  let inHeader = false;
  let headerEnded = false;
  let metric = false;
  let mode: "drill" | "rout" | undefined;
  let selected: ParsedXncTool | undefined;
  let current: { x: number; y: number } | undefined;
  let toolDown = false;
  let sawEnd = false;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.startsWith(";")) {
      const attr = line.match(/^; #@! (TF|TA)\.([^,]+),(.+)$/);
      if (attr?.[1] === "TF" && attr[2] === "FileFunction") fileFunction = attr[3];
      if (attr?.[1] === "TA" && attr[2] === "AperFunction") apertureFunction = attr[3];
      continue;
    }
    if (line === "M48") {
      if (index !== 0) errors.push("M48 must be the first command");
      inHeader = true;
      continue;
    }
    if (line === "METRIC") {
      if (!inHeader || headerEnded) errors.push("METRIC must occur once in the header");
      metric = true;
      continue;
    }
    const declaration = line.match(/^T(\d{2})C([+]?(?:\d+(?:\.\d*)?|\.\d+))$/);
    if (declaration) {
      if (!inHeader || headerEnded) errors.push(`line ${index + 1}: tool declaration outside header`);
      const tool: ParsedXncTool = {
        code: Number(declaration[1]),
        diameterNm: nm(declaration[2]),
        apertureFunction,
      };
      if (tools.has(tool.code)) errors.push(`line ${index + 1}: duplicate tool T${declaration[1]}`);
      tools.set(tool.code, tool);
      continue;
    }
    if (line === "%") {
      if (!inHeader || headerEnded) errors.push("unexpected end-of-header command");
      headerEnded = true;
      continue;
    }
    if (line === "G05") {
      if (!headerEnded) errors.push("G05 before header end");
      mode = "drill";
      toolDown = false;
      continue;
    }
    const select = line.match(/^T(\d{1,2})$/);
    if (select) {
      selected = tools.get(Number(select[1]));
      if (!selected) errors.push(`line ${index + 1}: undefined tool T${select[1]}`);
      continue;
    }
    const move = line.match(/^G00(.+)$/);
    if (move) {
      current = point(move[1]) ?? undefined;
      if (!current) errors.push(`line ${index + 1}: invalid rout start`);
      mode = "rout";
      continue;
    }
    if (line === "M15") {
      if (mode !== "rout" || !current) errors.push(`line ${index + 1}: M15 outside rout mode`);
      toolDown = true;
      continue;
    }
    if (line === "M16") {
      if (!toolDown) errors.push(`line ${index + 1}: M16 without M15`);
      toolDown = false;
      continue;
    }
    const route = line.match(/^G01(.+)$/);
    if (route) {
      const end = point(route[1]);
      if (!end || !current || !selected || !toolDown) errors.push(`line ${index + 1}: invalid linear rout`);
      else objects.push({ kind: "slot", start: current, end, diameterNm: selected.diameterNm });
      if (end) current = end;
      continue;
    }
    const hit = point(line);
    if (hit) {
      if (mode !== "drill" || !selected) errors.push(`line ${index + 1}: drill hit without drill mode/tool`);
      else objects.push({ kind: "hit", at: hit, diameterNm: selected.diameterNm });
      current = hit;
      continue;
    }
    if (line === "M30") {
      sawEnd = true;
      if (index !== lines.length - 1) errors.push("M30 is not the final command");
      continue;
    }
    errors.push(`line ${index + 1}: invalid XNC command ${line.slice(0, 80)}`);
  }
  if (!inHeader) errors.push("missing M48 header");
  if (!metric) errors.push("missing METRIC unit command");
  if (!headerEnded) errors.push("missing % end-of-header command");
  if (!sawEnd) errors.push("missing M30 end command");
  if (!fileFunction) errors.push("missing TF.FileFunction attribute");
  return { fileFunction, tools, objects, errors };
}
