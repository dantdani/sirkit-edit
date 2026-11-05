/**
 * [PR-M, 2026-10-18] Section M2 (design M2.3): a deterministic parser for ONE closed text format of a part's pin table,
 * `SIRKIT-PIN-TABLE/1` - the only "datasheet" text an admitted CAD source may deliver in M2 (the fixture source's original MIT pin
 * tables). There is NO PDF, OCR or LLM extraction: a real manufacturer datasheet is a PDF, and a PDF is not a text import
 * (ingestion.ts); until a manufacturer publishes machine-readable pin tables under an admitted row (OD-M2-9), the terminal table stays a
 * fact a PERSON confirms in the review package.
 *
 *     SIRKIT-PIN-TABLE/1
 *     fixture: yes|no
 *     licence: <SPDX id>
 *     title: <free text>
 *     part: <the part number the table is for>
 *     manufacturer: <name>                      (optional)
 *     package: <code> smd|through_hole          (optional)
 *     pin <number> <function> [<pad>[,<pad>...]]
 *
 * Bounded (256 KiB, 256 pins, 16 pads a pin, every line <= 300 characters), strict (an unknown key, a duplicate pin, a malformed line
 * or a missing header refuses the whole table - never a partial one), and inert (the free text is made inert before it is a fact).
 */
import { inertExternalText } from "../net/external-href";

export const PIN_TABLE_FORMAT = "SIRKIT-PIN-TABLE/1" as const;
export const PIN_TABLE_PARSER_VERSION = "sirkit.pin-table/1" as const;
export const PIN_TABLE_MAX_BYTES = 256 * 1024;
const MAX_PINS = 256;
const MAX_PADS = 16;
const MAX_LINE = 300;
const NUMBER = /^[A-Za-z0-9][A-Za-z0-9_.+-]{0,15}$/;
const FUNCTION = /^[A-Za-z0-9~][A-Za-z0-9_.+/~#-]{0,31}$/;
const KEYS = new Set(["fixture", "licence", "title", "part", "manufacturer", "package"]);

export interface PinTableRow { number: string; function: string; pads: string[]; line: number }
export interface ParsedPinTable {
  format: typeof PIN_TABLE_FORMAT;
  fixture: boolean;
  licence: string;
  title: string;
  part: string;
  manufacturer: string | null;
  packageCode: string | null;
  mounting: "smd" | "through_hole" | null;
  pins: PinTableRow[];
}
export type PinTableParse = { ok: true; table: ParsedPinTable } | { ok: false; code: "too_large" | "not_a_pin_table" | "malformed"; detail: string };

/** Parse the closed format; any deviation refuses the whole table. */
export function parsePinTable(text: string): PinTableParse {
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > PIN_TABLE_MAX_BYTES) return { ok: false, code: "too_large", detail: `a pin table is at most ${PIN_TABLE_MAX_BYTES} bytes` };
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  if (lines[0] !== PIN_TABLE_FORMAT) return { ok: false, code: "not_a_pin_table", detail: `the first line is not ${PIN_TABLE_FORMAT}` };
  const fields = new Map<string, string>();
  const pins: PinTableRow[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    const at = index + 1;
    if (line.length > MAX_LINE) return { ok: false, code: "malformed", detail: `line ${at} is longer than ${MAX_LINE} characters` };
    if (line.trim() === "") continue;
    const pin = /^pin (\S+) (\S+)(?: (\S+))?$/.exec(line);
    if (pin) {
      const [, number, fn, padText] = pin as unknown as [string, string, string, string | undefined];
      if (!NUMBER.test(number) || !FUNCTION.test(fn)) return { ok: false, code: "malformed", detail: `line ${at}: a pin number or function is not in the closed form` };
      const pads = padText === undefined ? [number] : padText.split(",");
      if (pads.length === 0 || pads.length > MAX_PADS || pads.some((pad) => !NUMBER.test(pad)) || new Set(pads).size !== pads.length) return { ok: false, code: "malformed", detail: `line ${at}: the pads are not a list of 1-${MAX_PADS} distinct pad numbers` };
      if (pins.some((existing) => existing.number === number)) return { ok: false, code: "malformed", detail: `line ${at}: pin ${number} is listed twice` };
      if (pins.length >= MAX_PINS) return { ok: false, code: "malformed", detail: `more than ${MAX_PINS} pins` };
      pins.push({ number, function: fn, pads, line: at });
      continue;
    }
    const field = /^([a-z]+): (.+)$/.exec(line);
    if (!field || !KEYS.has(field[1]!) || fields.has(field[1]!)) return { ok: false, code: "malformed", detail: `line ${at} is not a pin line or a known key` };
    const value = inertExternalText(field[2]!, 200);
    if (value === null) return { ok: false, code: "malformed", detail: `line ${at}: the value is empty once made inert` };
    fields.set(field[1]!, value);
  }
  const part = fields.get("part");
  const fixture = fields.get("fixture");
  if (!part || (fixture !== "yes" && fixture !== "no") || !fields.get("licence") || !fields.get("title")) return { ok: false, code: "malformed", detail: "part, fixture (yes|no), licence and title are required" };
  if (pins.length === 0) return { ok: false, code: "malformed", detail: "the table lists no pins" };
  let packageCode: string | null = null;
  let mounting: ParsedPinTable["mounting"] = null;
  const pkg = fields.get("package");
  if (pkg !== undefined) {
    const match = /^([A-Za-z0-9][A-Za-z0-9 ._-]{0,47}) (smd|through_hole)$/.exec(pkg);
    if (!match) return { ok: false, code: "malformed", detail: "package is `<code> smd|through_hole`" };
    packageCode = match[1]!;
    mounting = match[2] as "smd" | "through_hole";
  }
  return { ok: true, table: { format: PIN_TABLE_FORMAT, fixture: fixture === "yes", licence: fields.get("licence")!, title: fields.get("title")!, part, manufacturer: fields.get("manufacturer") ?? null, packageCode, mounting, pins } };
}

/** The table as the publication spec's terminal rows (number, function, pads). */
export function pinTableTerminals(table: ParsedPinTable): Array<{ number: string; function: string; pads: string[] }> {
  return table.pins.map((pin) => ({ number: pin.number, function: pin.function, pads: [...pin.pads] }));
}
