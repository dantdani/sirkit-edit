import type { MirApertureFunction, MirObjectAttributes } from "./types";

export interface ParsedGerberAperture {
  code: number;
  template: string;
  modifiers: string;
  apertureFunction?: MirApertureFunction;
  macroBody?: string;
}

export type ParsedGerberObject =
  | {
      kind: "stroke";
      start: { x: number; y: number };
      end: { x: number; y: number };
      aperture: ParsedGerberAperture;
      polarity: "dark" | "clear";
      attributes: MirObjectAttributes;
    }
  | {
      kind: "flash";
      at: { x: number; y: number };
      aperture: ParsedGerberAperture;
      polarity: "dark" | "clear";
      attributes: MirObjectAttributes;
    }
  | {
      kind: "region";
      points: Array<{ x: number; y: number }>;
      apertureFunction?: MirApertureFunction;
      polarity: "dark" | "clear";
      attributes: MirObjectAttributes;
    };

export interface ParsedGerber {
  fileAttributes: Record<string, string[]>;
  apertures: Map<number, ParsedGerberAperture>;
  objects: ParsedGerberObject[];
  errors: string[];
}

function fields(body: string): [string, ...string[]] {
  const [name, ...values] = body.split(",");
  return [name, ...values];
}

function cloneAttributes(attributes: MirObjectAttributes): MirObjectAttributes {
  return { ...attributes };
}

function parseCoordinate(line: string): { x?: number; y?: number; operation: number } | null {
  const match = line.match(/^(?:X([+-]?\d+))?(?:Y([+-]?\d+))?D0?([123])\*$/);
  if (!match) return null;
  return {
    ...(match[1] !== undefined ? { x: Number(match[1]) } : {}),
    ...(match[2] !== undefined ? { y: Number(match[2]) } : {}),
    operation: Number(match[3]),
  };
}

export function parseGerber(text: string): ParsedGerber {
  const errors: string[] = [];
  const fileAttributes: Record<string, string[]> = {};
  const macros = new Map<string, string>();
  const apertures = new Map<number, ParsedGerberAperture>();
  const objects: ParsedGerberObject[] = [];
  const objectAttributes: MirObjectAttributes = {};
  let apertureFunction: MirApertureFunction | undefined;
  let selected: ParsedGerberAperture | undefined;
  let point = { x: 0, y: 0 };
  let polarity: "dark" | "clear" = "dark";
  let inRegion = false;
  let regionPoints: Array<{ x: number; y: number }> = [];
  let sawFormat = false;
  let sawMetric = false;
  let sawEnd = false;

  const lines = text.replace(/\r/g, "").split("\n").filter((line) => line.length > 0);
  for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
    const line = lines[lineNumber].trim();
    if (line.startsWith("G04")) continue;
    const macro = line.match(/^%AM([_A-Za-z$][_A-Za-z0-9$]*)\*(.*)\*%$/);
    if (macro) {
      macros.set(macro[1], macro[2]);
      continue;
    }
    const fileAttribute = line.match(/^%TF([^*]+)\*%$/);
    if (fileAttribute) {
      const [name, ...values] = fields(fileAttribute[1]);
      fileAttributes[name] = values;
      continue;
    }
    const ta = line.match(/^%TA\.AperFunction,([^*]+)\*%$/);
    if (ta) {
      apertureFunction = ta[1].split(",")[0] as MirApertureFunction;
      continue;
    }
    const to = line.match(/^%TO([^*]+)\*%$/);
    if (to) {
      const [name, ...values] = fields(to[1]);
      if (name === ".N") objectAttributes.net = values[0];
      else if (name === ".P") {
        objectAttributes.ref = values[0];
        objectAttributes.pin = values[1];
        if (values[2]) objectAttributes.pinFunction = values[2];
      } else if (name === ".C") objectAttributes.ref = values[0];
      else if (name === ".CFtp") objectAttributes.footprint = values[0];
      else if (name === ".CRot") objectAttributes.rotationDeg = Number(values[0]);
      continue;
    }
    if (line === "%TD*%") {
      for (const key of Object.keys(objectAttributes) as Array<keyof MirObjectAttributes>) delete objectAttributes[key];
      apertureFunction = undefined;
      continue;
    }
    if (line === "%TD.AperFunction*%") {
      apertureFunction = undefined;
      continue;
    }
    const ad = line.match(/^%ADD(\d+)([_A-Za-z$][_A-Za-z0-9$]*)(?:,([^*]+))?\*%$/);
    if (ad) {
      const value: ParsedGerberAperture = {
        code: Number(ad[1]),
        template: ad[2],
        modifiers: ad[3] ?? "",
        apertureFunction,
        macroBody: macros.get(ad[2]),
      };
      apertures.set(value.code, value);
      continue;
    }
    if (line === "%FSLAX46Y46*%") {
      sawFormat = true;
      continue;
    }
    if (line === "%MOMM*%") {
      sawMetric = true;
      continue;
    }
    if (line === "%LPD*%") {
      polarity = "dark";
      continue;
    }
    if (line === "%LPC*%") {
      polarity = "clear";
      continue;
    }
    if (line === "G01*") continue;
    if (line === "G36*") {
      if (inRegion) errors.push(`line ${lineNumber + 1}: nested G36`);
      inRegion = true;
      regionPoints = [];
      continue;
    }
    if (line === "G37*") {
      if (!inRegion || regionPoints.length < 4) errors.push(`line ${lineNumber + 1}: invalid region`);
      else {
        const points = [...regionPoints];
        if (points.length > 1 && points[0].x === points.at(-1)!.x && points[0].y === points.at(-1)!.y) points.pop();
        objects.push({
          kind: "region",
          points,
          apertureFunction,
          polarity,
          attributes: cloneAttributes(objectAttributes),
        });
      }
      inRegion = false;
      regionPoints = [];
      continue;
    }
    const select = line.match(/^D(\d+)\*$/);
    if (select) {
      selected = apertures.get(Number(select[1]));
      if (!selected) errors.push(`line ${lineNumber + 1}: undefined aperture D${select[1]}`);
      continue;
    }
    const command = parseCoordinate(line);
    if (command) {
      const next = { x: command.x ?? point.x, y: command.y ?? point.y };
      if (command.operation === 2) {
        point = next;
        if (inRegion) regionPoints = [next];
      } else if (command.operation === 1) {
        if (inRegion) regionPoints.push(next);
        else if (selected) {
          objects.push({
            kind: "stroke",
            start: point,
            end: next,
            aperture: selected,
            polarity,
            attributes: cloneAttributes(objectAttributes),
          });
        } else errors.push(`line ${lineNumber + 1}: draw without aperture`);
        point = next;
      } else if (selected) {
        objects.push({
          kind: "flash",
          at: next,
          aperture: selected,
          polarity,
          attributes: cloneAttributes(objectAttributes),
        });
        point = next;
      } else errors.push(`line ${lineNumber + 1}: flash without aperture`);
      continue;
    }
    if (line === "M02*") {
      sawEnd = true;
      if (lineNumber !== lines.length - 1) errors.push("M02 is not the final command");
      continue;
    }
    errors.push(`line ${lineNumber + 1}: unsupported or invalid command ${line.slice(0, 80)}`);
  }

  if (!sawFormat) errors.push("missing exact %FSLAX46Y46*% format declaration");
  if (!sawMetric) errors.push("missing metric unit declaration");
  if (!sawEnd) errors.push("missing M02 end command");
  for (const required of [".FileFunction", ".FilePolarity", ".SameCoordinates"] as const) {
    if (!fileAttributes[required]) errors.push(`missing mandatory ${required} attribute`);
  }
  return { fileAttributes, apertures, objects, errors };
}
