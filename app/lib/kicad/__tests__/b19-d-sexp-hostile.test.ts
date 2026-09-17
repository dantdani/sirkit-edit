/**
 * [B19-D I5d row 46] The KiCad s-expression reader is bounded and reads exactly one document.
 *
 * `parseSExp` recursed without a depth bound (a deeply nested file overflowed the stack) and returned the first node, ignoring
 * everything after it. `importKicadDru` wrapped the user's text in a synthetic root, so a stray `)` closed that root early and
 * every rule after it disappeared without a loss being reported.
 */
import { describe, expect, it } from "vitest";
import { parseSExp } from "../sexp";
import { importKicadDru } from "@/app/lib/constraints/kicad-dru";

describe("[B19-D I5d row 46] parseSExp reads one bounded document", () => {
  it.each(["(a) (b)", "hello (x)", "(a))"])("%s is refused (trailing content)", (source) => {
    expect(() => parseSExp(source)).toThrow();
  });

  it("nesting far beyond any KiCad file is refused as a depth error, not a stack overflow", () => {
    let thrown: unknown;
    try {
      parseSExp(`${"(".repeat(200_000)}${")".repeat(200_000)}`);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(/depth/);
    expect(thrown).not.toBeInstanceOf(RangeError);
  });

  it("a normal document still parses (baseline)", () => {
    expect(parseSExp(' (a (b "c \\" d") 1.5 -2 x)\n')).toEqual(["a", ["b", 'c " d'], 1.5, -2, "x"]);
  });
});

describe("[B19-D I5d row 46] importKicadDru never loses rules silently", () => {
  const input = (text: string) => ({ text, sourceId: "board.kicad_dru", sourceRevision: "1", netNameToStableIds: {} });

  it("a stray ')' is quarantined, not a clean import with the following rules dropped", () => {
    const result = importKicadDru(input('(version 1))\n(rule "hidden" (constraint track_width (min 0.2mm)))'));
    expect(result.quarantined || result.losses.length > 0).toBe(true);
    expect(result.ok && result.losses.length === 0).toBe(false);
  });

  it("200 000 levels of nesting are quarantined with a depth diagnostic", () => {
    const result = importKicadDru(input(`(version 1)\n${"(".repeat(200_000)}${")".repeat(200_000)}`));
    expect(result.quarantined).toBe(true);
    expect(result.diagnostics[0]).toMatch(/depth/);
  });

  it("a supported rule file still imports (baseline)", () => {
    const result = importKicadDru(input('(version 1)\n(rule "w" (constraint track_width (min 0.2mm)))'));
    expect(result.ok).toBe(true);
    expect(result.document?.constraints).toHaveLength(1);
  });
});
