/**
 * Export a sirkit `SchematicState` as a KiCad 8.x `.kicad_sch` file
 * (S-expression format).
 *
 * The output opens directly in KiCad with components at their sirkit positions,
 * wires intact, and net labels translated to KiCad power ports / global labels.
 *
 * Format reference: https://dev-docs.kicad.org/en/file-formats/sexpr-schematic/
 *
 * Design notes / MVP tradeoffs:
 *  - KiCad-sourced parts embed their full symbol definition into `lib_symbols`
 *    (verbatim from `CachedPart.symbolRaw`, with the symbol id rewritten to
 *    `Library:Name`). Theory (ideal) components and power/ground ports instead
 *    reference KiCad's stock libraries (`Device`, `Simulation_SPICE`, `power`)
 *    by `lib_id` and are NOT embedded — those libraries ship with KiCad.
 *  - All UUIDs are derived deterministically from element identity, so exporting
 *    the same state twice yields byte-identical output (good for diffing / VCS).
 *  - One-way export only; round-tripping is out of scope.
 */

import { createHash } from "node:crypto";
import type { SchematicState, SchComponentType } from "@/lib/schematic-types";
import { DEFAULT_PAGE_SIZE } from "@/lib/schematic-types";
import { KICAD_SCALE_PX_PER_MM } from "@/app/lib/geometry";
import type { CachedPart } from "./parts-cache";
import { getPowerSymbol, buildGenericPowerSymbol } from "./kicad-power-symbols";
import { assignFootprints } from "@/lib/footprint-assign";

export type KicadExportInput = {
  state: SchematicState;
  parts: Map<string, CachedPart>; // partId -> CachedPart for every kicadComponent in state
  title?: string;
  description?: string;
  company?: string;
};

// KiCad 10.0 stable schematic format version (matches a schematic freshly saved
// by KiCad 10.0.3). KiCad reads older versions too, but writing the current one
// avoids an on-load format upgrade prompt.
const KICAD_VERSION = "20250610";

// ─── Theory (ideal) component mappings ──────────────────────────────────────
// `ground` is intentionally absent: it becomes a power port, not a symbol.
type TheoryType = Exclude<SchComponentType, "ground">;

const THEORY_LIB_ID: Record<TheoryType, string> = {
  resistor: "Device:R",
  capacitor: "Device:C",
  inductor: "Device:L",
  diode: "Device:D",
  "voltage-source": "Simulation_SPICE:VSOURCE",
  "current-source": "Simulation_SPICE:ISOURCE",
};

const THEORY_REFDES_PREFIX: Record<TheoryType, string> = {
  resistor: "R",
  capacitor: "C",
  inductor: "L",
  diode: "D",
  "voltage-source": "V",
  "current-source": "I",
};

// Power ports resolve to the lib_id `power:<name>` for every rail and ground.
// The matching symbol is embedded locally in `lib_symbols` (see the export
// body), so the file is self-contained and doesn't depend on the user's KiCad
// having the stock `power` library mapped — which is what caused power ports to
// render as red "?" boxes.

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Convert sirkit pixels to KiCad millimetres, rounded to 1µm precision. */
function mmFromPx(px: number): number {
  const mm = px / KICAD_SCALE_PX_PER_MM;
  // `+ 0` collapses any negative zero so the same coordinate always prints the
  // same string (keeps the export byte-stable).
  return Math.round(mm * 1000) / 1000 + 0;
}

/** Format a number for an S-expression token (no trailing-zero noise). */
function num(n: number): string {
  return String(n);
}

/**
 * Quote and escape a string for an S-expression token. This is the single
 * source of truth for emitting any identifier that could contain characters
 * outside `[A-Za-z0-9_]` (hyphens, dots, colons, slashes, …) — KiCad's parser
 * only accepts those bare inside double-quoted strings.
 */
function q(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Escape a literal string for safe interpolation into a `RegExp`. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Deterministic UUID derived from an element's identity. SHA-256 of
 * `prefix:key`, formatted as an 8-4-4-4-12 hex string with the version-4 and
 * variant nibbles set so KiCad accepts it as a well-formed UUID.
 */
function uuidFor(prefix: string, key: string): string {
  const hex = createHash("sha256").update(`${prefix}:${key}`).digest("hex");
  const h = hex.slice(0, 32).split("");
  h[12] = "4"; // version 4
  h[16] = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16); // variant 10xx
  const s = h.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

/**
 * Prepare a raw `(symbol ...)` block for embedding in a schematic's
 * `lib_symbols`:
 *
 *  1. the root id becomes the fully-qualified `Library:Name` KiCad expects;
 *  2. every child unit id (`<root>_<unit>_<style>`) is re-prefixed to the new
 *     bare item `Name`.
 *
 * Step 2 matters for parts that `(extends ...)` another symbol: ingest resolves
 * inheritance by handing the child the *parent's* raw block, so the unit ids
 * still carry the parent's name (e.g. an `AP1117-18` that extends `AP1117-15`
 * arrives with `AP1117-15_0_1` units). When KiCad reads a unit it strips the
 * library nickname from the symbol name and requires the unit id to start with
 * what remains; a leftover parent prefix triggers an "Invalid symbol unit name
 * prefix" parse error. For a base symbol the original and target names are
 * identical, so the child rewrite is a no-op and existing exports are
 * byte-for-byte unchanged.
 */
function rewriteSymbolName(symbolRaw: string, libId: string): string {
  const rootMatch = symbolRaw.match(/^\s*\(symbol\s+"((?:[^"\\]|\\.)*)"/);
  if (!rootMatch) return symbolRaw;
  const rawOriginal = rootMatch[1]; // root id exactly as written in the source
  const itemName = libId.slice(libId.indexOf(":") + 1); // bare KiCad item name

  // (1) Root id → fully-qualified "Library:Name".
  let out = symbolRaw.replace(
    /^(\s*\(symbol\s+)"(?:[^"\\]|\\.)*"/,
    (_full, lead: string) => `${lead}${q(libId)}`,
  );

  // (2) Child unit ids "<root>_<unit>_<style>" → "<itemName>_<unit>_<style>".
  // The root id no longer matches `rawOriginal` (it's now "Library:Name"), so
  // only the unit children are touched.
  const childRe = new RegExp(`(\\(symbol\\s+)"${escapeRegExp(rawOriginal)}((?:_\\d+)+)"`, "g");
  out = out.replace(childRe, (_full, lead: string, suffix: string) => `${lead}${q(itemName + suffix)}`);
  return out;
}

const TODAY = new Date().toISOString().slice(0, 10);

// ─── Main export ────────────────────────────────────────────────────────────

export function exportToKicadSch(input: KicadExportInput): string {
  const { state, parts } = input;
  const components = state.components ?? [];
  const kicadComponents = state.kicadComponents ?? [];
  const wires = state.wires ?? [];
  const netLabels = state.netLabels ?? [];

  const schematicUuid = uuidFor("schematic", "root");
  // For a single-sheet design the symbol instance path is the root schematic
  // UUID; the sheet_instances path stays "/".
  const sheetPath = `/${schematicUuid}`;

  const lines: string[] = [];
  lines.push("(kicad_sch");
  lines.push(`\t(version ${KICAD_VERSION})`);
  lines.push(`\t(generator "sirkit_export")`);
  lines.push(`\t(generator_version "1.0")`);
  lines.push(`\t(uuid ${q(schematicUuid)})`);
  // KiCad's `(paper ...)` tokens match our PageSize names 1:1.
  lines.push(`\t(paper ${q(state.pageSize ?? DEFAULT_PAGE_SIZE)})`);
  lines.push(`\t(title_block`);
  lines.push(`\t\t(title ${q(input.title ?? "sirkit export")})`);
  lines.push(`\t\t(company ${q(input.company ?? "")})`);
  lines.push(`\t\t(date ${q(TODAY)})`);
  lines.push(`\t\t(comment 1 ${q(input.description ?? "")})`);
  lines.push(`\t)`);

  // ── (A) lib_symbols: embed unique KiCad part symbols (deduped by partId) ──
  const partLibId = new Map<string, string>(); // partId -> "Library:Name"
  lines.push(`\t(lib_symbols`);
  const embedded = new Set<string>();
  for (const inst of kicadComponents) {
    if (embedded.has(inst.partId)) continue;
    embedded.add(inst.partId);
    const part = parts.get(inst.partId);
    if (!part) continue; // missing parts are surfaced by the API layer
    const libId = `${part.libraryName}:${part.name}`;
    partLibId.set(inst.partId, libId);
    const raw = rewriteSymbolName(part.symbolRaw.trim(), libId);
    if (raw) lines.push(indent(raw, 2));
  }

  // Embed the power-port symbols this schematic actually uses, qualified to
  // `power:<name>` exactly as KiCad does when it saves a schematic. Grounds all
  // share the stock `GND` glyph; named rails use their stock symbol, and any
  // name without one (e.g. "VIN", a custom "+24V") gets a generic flag.
  const powerNames = new Set<string>();
  for (const label of netLabels) {
    if (label.kind === "ground") powerNames.add("GND");
    else if (label.kind === "power") powerNames.add(label.name);
  }
  for (const name of powerNames) {
    const raw = getPowerSymbol(name) ?? buildGenericPowerSymbol(name);
    lines.push(indent(rewriteSymbolName(raw.trim(), `power:${name}`), 2));
  }
  lines.push(`\t)`);

  // ── (B) symbol instances ──
  // Footprint per KiCad component: the symbol's own footprint id when it has
  // one, else a deterministic category default (R/C/L/D/Q…). Parts left
  // unresolved export with an empty Footprint, same as before.
  const footprintByRefDes = new Map(
    assignFootprints(kicadComponents, parts).map((a) => [a.refDes, a.footprint] as const),
  );

  // Per-type refDes counters for Theory components (R1, C1, ...).
  const refDesCount: Record<string, number> = {};
  const nextRefDes = (prefix: string): string => {
    const n = (refDesCount[prefix] ?? 0) + 1;
    refDesCount[prefix] = n;
    return `${prefix}${n}`;
  };

  for (const inst of kicadComponents) {
    const libId = partLibId.get(inst.partId);
    if (!libId) continue;
    const part = parts.get(inst.partId);
    lines.push(
      buildSymbolInstance({
        libId,
        x: mmFromPx(inst.x),
        y: mmFromPx(inst.y),
        rotation: inst.rotation,
        refDes: inst.refDes,
        value: inst.value,
        footprint: footprintByRefDes.get(inst.refDes) ?? "",
        datasheet: part?.datasheet ?? "",
        uuid: uuidFor("symbol", inst.id),
        sheetPath,
      }),
    );
  }

  for (const comp of components) {
    if (comp.type === "ground") continue; // emitted as a power port in (D)
    const t = comp.type as TheoryType;
    const refDes = nextRefDes(THEORY_REFDES_PREFIX[t]);
    lines.push(
      buildSymbolInstance({
        libId: THEORY_LIB_ID[t],
        x: mmFromPx(comp.x),
        y: mmFromPx(comp.y),
        rotation: comp.rotation,
        refDes,
        value: comp.value,
        footprint: "",
        datasheet: "",
        uuid: uuidFor("symbol", comp.id),
        sheetPath,
      }),
    );
  }

  // ── (C) wires + junctions ──
  const endpointCounts = new Map<string, { x: number; y: number; count: number }>();
  const tally = (x: number, y: number): void => {
    const key = `${x},${y}`;
    const hit = endpointCounts.get(key);
    if (hit) hit.count += 1;
    else endpointCounts.set(key, { x, y, count: 1 });
  };

  for (const wire of wires) {
    const verts = wire.vertices ?? [];
    for (let i = 0; i + 1 < verts.length; i++) {
      const ax = mmFromPx(verts[i].x);
      const ay = mmFromPx(verts[i].y);
      const bx = mmFromPx(verts[i + 1].x);
      const by = mmFromPx(verts[i + 1].y);
      lines.push(buildWire(ax, ay, bx, by, uuidFor("wire", `${wire.id}:${i}`)));
    }
    // Count each distinct vertex once per wire for junction detection.
    for (const v of verts) tally(mmFromPx(v.x), mmFromPx(v.y));
  }

  for (const { x, y, count } of endpointCounts.values()) {
    if (count < 3) continue;
    lines.push(buildJunction(x, y, uuidFor("junction", `${x},${y}`)));
  }

  // ── (D) net labels ──
  let pwrIndex = 0;
  const nextPwrRef = (): string => `#PWR0${String(pwrIndex++).padStart(2, "0")}`;

  for (const label of netLabels) {
    const x = mmFromPx(label.position.x);
    const y = mmFromPx(label.position.y);
    const uuid = uuidFor("label", label.id);

    if (label.kind === "ground") {
      lines.push(
        buildPowerPort("power:GND", label.name || "GND", x, y, label.orientation, nextPwrRef(), uuid, sheetPath),
      );
      continue;
    }

    if (label.kind === "power") {
      // Every rail now has an embedded `power:<name>` symbol (stock or generic).
      lines.push(
        buildPowerPort(`power:${label.name}`, label.name, x, y, label.orientation, nextPwrRef(), uuid, sheetPath),
      );
      continue;
    }

    lines.push(buildGlobalLabel(label.name, x, y, label.orientation, uuid));
  }

  // ── sheet instances ──
  lines.push(`\t(sheet_instances`);
  lines.push(`\t\t(path "/" (page "1"))`);
  lines.push(`\t)`);

  lines.push(")");
  return lines.join("\n") + "\n";
}

// ─── Block builders ─────────────────────────────────────────────────────────

function buildSymbolInstance(o: {
  libId: string;
  x: number;
  y: number;
  rotation: number;
  refDes: string;
  value: string;
  footprint: string;
  datasheet: string;
  uuid: string;
  sheetPath: string;
}): string {
  const refY = round3(o.y - 2.54); // place reference above the symbol
  const valY = round3(o.y + 2.54); // place value below the symbol
  const fontEff = `(effects (font (size 1.27 1.27)))`;
  const hiddenEff = `(effects (font (size 1.27 1.27)) (hide yes))`;
  return [
    `\t(symbol`,
    `\t\t(lib_id ${q(o.libId)})`,
    `\t\t(at ${num(o.x)} ${num(o.y)} ${num(o.rotation)})`,
    `\t\t(unit 1)`,
    `\t\t(exclude_from_sim no)`,
    `\t\t(in_bom yes)`,
    `\t\t(on_board yes)`,
    `\t\t(dnp no)`,
    `\t\t(fields_autoplaced yes)`,
    `\t\t(uuid ${q(o.uuid)})`,
    `\t\t(property "Reference" ${q(o.refDes)} (at ${num(o.x)} ${num(refY)} 0) ${fontEff})`,
    `\t\t(property "Value" ${q(o.value)} (at ${num(o.x)} ${num(valY)} 0) ${fontEff})`,
    `\t\t(property "Footprint" ${q(o.footprint)} (at 0 0 0) ${hiddenEff})`,
    `\t\t(property "Datasheet" ${q(o.datasheet)} (at 0 0 0) ${hiddenEff})`,
    `\t\t(instances`,
    `\t\t\t(project "sirkit_export"`,
    `\t\t\t\t(path ${q(o.sheetPath)}`,
    `\t\t\t\t\t(reference ${q(o.refDes)}) (unit 1)`,
    `\t\t\t\t)`,
    `\t\t\t)`,
    `\t\t)`,
    `\t)`,
  ].join("\n");
}

function buildWire(x1: number, y1: number, x2: number, y2: number, uuid: string): string {
  return [
    `\t(wire`,
    `\t\t(pts (xy ${num(x1)} ${num(y1)}) (xy ${num(x2)} ${num(y2)}))`,
    `\t\t(stroke (width 0) (type default))`,
    `\t\t(uuid ${q(uuid)})`,
    `\t)`,
  ].join("\n");
}

function buildJunction(x: number, y: number, uuid: string): string {
  return [
    `\t(junction`,
    `\t\t(at ${num(x)} ${num(y)})`,
    `\t\t(diameter 0)`,
    `\t\t(color 0 0 0 0)`,
    `\t\t(uuid ${q(uuid)})`,
    `\t)`,
  ].join("\n");
}

function buildPowerPort(
  libId: string,
  value: string,
  x: number,
  y: number,
  rotation: number,
  refDes: string,
  uuid: string,
  sheetPath: string,
): string {
  const fontEff = `(effects (font (size 1.27 1.27)))`;
  const hiddenEff = `(effects (font (size 1.27 1.27)) (hide yes))`;
  return [
    `\t(symbol`,
    `\t\t(lib_id ${q(libId)})`,
    `\t\t(at ${num(x)} ${num(y)} ${num(rotation)})`,
    `\t\t(unit 1)`,
    `\t\t(exclude_from_sim no)`,
    `\t\t(in_bom no)`,
    `\t\t(on_board no)`,
    `\t\t(dnp no)`,
    `\t\t(fields_autoplaced yes)`,
    `\t\t(uuid ${q(uuid)})`,
    `\t\t(property "Reference" ${q(refDes)} (at ${num(x)} ${num(y)} 0) ${hiddenEff})`,
    `\t\t(property "Value" ${q(value)} (at ${num(x)} ${num(round3(y + 2.54))} 0) ${fontEff})`,
    `\t\t(instances`,
    `\t\t\t(project "sirkit_export"`,
    `\t\t\t\t(path ${q(sheetPath)}`,
    `\t\t\t\t\t(reference ${q(refDes)}) (unit 1)`,
    `\t\t\t\t)`,
    `\t\t\t)`,
    `\t\t)`,
    `\t)`,
  ].join("\n");
}

// KiCad stores the intersheet-references field with this literal placeholder
// value; it expands the cross-reference text itself when rendering.
const INTERSHEET_REFS_VALUE = "${INTERSHEET_REFS}";

function buildGlobalLabel(name: string, x: number, y: number, rotation: number, uuid: string): string {
  return [
    `\t(global_label ${q(name)}`,
    `\t\t(shape input)`,
    `\t\t(at ${num(x)} ${num(y)} ${num(rotation)})`,
    `\t\t(fields_autoplaced yes)`,
    `\t\t(effects (font (size 1.27 1.27)) (justify left))`,
    `\t\t(uuid ${q(uuid)})`,
    `\t\t(property "Intersheetrefs" ${q(INTERSHEET_REFS_VALUE)} (at 0 0 0) (effects (font (size 1.27 1.27)) (hide yes)))`,
    `\t)`,
  ].join("\n");
}

/** Round a millimetre value to 1µm (mirrors `mmFromPx`'s precision). */
function round3(n: number): number {
  return Math.round(n * 1000) / 1000 + 0;
}

/** Re-indent a multi-line raw block by `tabs` tab stops, preserving structure. */
function indent(block: string, tabs: number): string {
  const pad = "\t".repeat(tabs);
  return block
    .split("\n")
    .map((line) => (line.length ? pad + line : line))
    .join("\n");
}
