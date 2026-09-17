/**
 * [B19-D I5d review] `importKicadDru` reports every form it does not import.
 *
 * The row 46 fix handled a stray `)`; a MISSING `)` still lost rules silently: it nests the next rule inside the previous one,
 * and the importer kept only a rule's `constraint` children. A rule list wrapped in any other form was dropped with no loss
 * either. KiCad's own rule parser reports both as unrecognized items.
 */
import { describe, expect, it } from "vitest";
import { importKicadDru } from "../kicad-dru";

const input = (text: string) => ({ text, sourceId: "board.kicad_dru", sourceRevision: "1", netNameToStableIds: {} });

describe("[B19-D I5d review] no DRU form disappears without a loss", () => {
  it("a rule nested inside another rule (a missing ')') is reported", () => {
    const result = importKicadDru(input('(version 1)\n(rule "a" (constraint track_width (min 0.2mm))\n(rule "b" (constraint clearance (min 1mm))))'));
    expect(result.quarantined || result.losses.some((loss) => loss.severity === "error" && /rule/i.test(loss.message))).toBe(true);
  });

  it("rules wrapped in an unknown top-level form are reported", () => {
    const result = importKicadDru(input('(version 1)\n(rules (rule "b" (constraint clearance (min 1mm))))'));
    expect(result.quarantined || result.losses.some((loss) => loss.severity === "error")).toBe(true);
  });

  it("a rule's supported children import with no error loss (baseline)", () => {
    const result = importKicadDru(input('(version 1)\n(rule "w" (constraint track_width (min 0.2mm)) (severity error))'));
    expect(result.ok).toBe(true);
    expect(result.losses.filter((loss) => loss.severity === "error")).toEqual([]); // a "transformed" note for the unit is expected
  });
});
