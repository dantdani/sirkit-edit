import { describe, it, expect } from "vitest";
import {
  parseSexpr,
  emitVerbatim,
  writeSexpr,
  child,
  children,
  num,
  str,
  SexprError,
} from "../sexpr";

describe("string escapes", () => {
  it("unescapes \\\" and \\\\ and preserves raw", () => {
    const src = '(note "he said \\"hi\\" and \\\\ that")';
    const ast = parseSexpr(src);
    const atom = ast.items[1];
    expect(atom.kind).toBe("string");
    if (atom.kind !== "string") return;
    expect(atom.value).toBe('he said "hi" and \\ that');
    expect(atom.raw).toBe('"he said \\"hi\\" and \\\\ that"');
    expect(emitVerbatim(ast, src)).toBe(src);
    // writeSexpr re-emits the raw text, keeping the original escaping.
    expect(writeSexpr(ast)).toBe(`${src}\n`);
  });
});

describe("line endings", () => {
  it("round-trips CRLF sources byte-exactly", () => {
    const src = '(footprint "X"\r\n\t(layer "F.Cu")\r\n)\r\n';
    const ast = parseSexpr(src);
    expect(emitVerbatim(ast, src)).toBe(src);
  });

  it("round-trips LF sources byte-exactly", () => {
    const src = '(footprint "X"\n\t(layer "F.Cu")\n)\n';
    expect(emitVerbatim(parseSexpr(src), src)).toBe(src);
  });
});

describe("errors carry line/col", () => {
  it("reports the position of an unclosed list", () => {
    try {
      parseSexpr("(foo\n  (bar baz");
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(SexprError);
      const err = e as SexprError;
      expect(err.line).toBe(2);
      expect(err.col).toBe(3);
    }
  });

  it("rejects non-list input with position", () => {
    try {
      parseSexpr("foo");
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(SexprError);
      const err = e as SexprError;
      expect(err.line).toBe(1);
      expect(err.col).toBe(1);
    }
  });

  it("rejects trailing content after the top-level list", () => {
    expect(() => parseSexpr("(a) junk")).toThrow(SexprError);
  });

  it("rejects unterminated strings", () => {
    expect(() => parseSexpr('(a "unterminated')).toThrow(SexprError);
  });
});

describe("number raw preservation", () => {
  it('keeps "0.50" as written through writeSexpr', () => {
    const src = "(width 0.50)";
    const ast = parseSexpr(src);
    expect(num(ast, 1)).toBe(0.5);
    expect(writeSexpr(ast)).toBe("(width 0.50)\n");
  });

  it("keeps exact integer and negative formatting", () => {
    const src = "(at -0.000005 20260206)";
    const ast = parseSexpr(src);
    expect(writeSexpr(ast)).toBe("(at -0.000005 20260206)\n");
  });
});

describe("accessors", () => {
  const ast = parseSexpr('(pad "1" smd (at 1 2 90) (size 1 2) (size 3 4))');

  it("child finds the first named child list", () => {
    const at = child(ast, "at");
    expect(at).toBeDefined();
    expect(num(at!, 1)).toBe(1);
    expect(num(at!, 3)).toBe(90);
  });

  it("children finds all named child lists", () => {
    expect(children(ast, "size")).toHaveLength(2);
  });

  it("str accepts strings and symbols", () => {
    expect(str(ast, 1)).toBe("1"); // quoted string
    expect(str(ast, 2)).toBe("smd"); // bare symbol
  });

  it("num throws on non-number atoms", () => {
    expect(() => num(ast, 1)).toThrow(SexprError);
  });
});
