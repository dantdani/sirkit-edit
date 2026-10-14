import { describe, expect, it } from "vitest";
import { normalizeToolArguments } from "../normalize-tool-arguments";

const schema = {
  type: "object", additionalProperties: false, required: ["needed"],
  properties: {
    needed: { type: "string" }, optional: { type: "number" },
    meaningful: { type: ["number", "null"] },
    explicit: { enum: [null, "a"] },
    nested: { type: "object", properties: { optional: { type: "string" } }, required: [] },
    rows: { type: "array", items: { type: "object", properties: { optional: { type: "string" } } } },
  },
};

describe("strict argument inverse uses original optionality", () => {
  it("removes only synthetic optional nulls recursively; does not erase bad fields or array entries", () => {
    const args = { needed: null, optional: null, meaningful: null, explicit: null, invented: null, nested: { optional: null }, rows: [{ optional: null }, null] };
    const before = structuredClone(args);
    expect(normalizeToolArguments(args, schema)).toEqual({ ok: true, args: { needed: null, meaningful: null, explicit: null, invented: null, nested: {}, rows: [{}, null] } });
    expect(args).toEqual(before);
  });
  it("does not coerce strings, booleans, numbers or explicit null domains", () => {
    const args = { needed: "", optional: "42", meaningful: false, explicit: null };
    expect(normalizeToolArguments(args, schema)).toEqual({ ok: true, args });
  });
  it("is idempotent and ignores keys inherited from Object.prototype", () => {
    const first = normalizeToolArguments({ needed: "x", optional: null, nested: { optional: null } }, schema);
    expect(first.ok).toBe(true);
    if (first.ok) expect(normalizeToolArguments(first.args, schema)).toEqual(first);
  });
  it("retains null for a nullable anyOf, but removes it if every branch excludes null", () => {
    const variant = { type: "object", properties: { a: { anyOf: [{ type: "string" }, { type: "null" }] }, b: { anyOf: [{ type: "string" }, { type: "number" }] } } };
    expect(normalizeToolArguments({ a: null, b: null }, variant)).toEqual({ ok: true, args: { a: null } });
  });
  it("does not erase under ambiguous union optionality", () => {
    const variant = { anyOf: [{ type: "object", properties: { a: { type: "string" } } }, { type: "object", required: ["a"], properties: { a: { type: "string" } } }] };
    expect(normalizeToolArguments({ a: null }, variant)).toEqual({ ok: true, args: { a: null } });
  });
  it("refuses hooks, cyclic and non-object arguments without invoking hooks", () => {
    let calls = 0;
    expect(normalizeToolArguments({ get optional() { calls++; return null; } }, schema)).toEqual({ ok: false });
    expect(normalizeToolArguments({ toJSON() { calls++; return {}; } }, schema)).toEqual({ ok: false });
    expect(calls).toBe(0);
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    for (const args of [cyclic, null, [], undefined, new Date(), { optional: Infinity }]) expect(normalizeToolArguments(args, schema)).toEqual({ ok: false });
  });
  it("preserves forbidden names for domain refusal without invoking the prototype setter", () => {
    const args = JSON.parse('{"__proto__":{"polluted":true},"constructor":null}');
    const result = normalizeToolArguments(args, schema);
    expect(result).toEqual({ ok: true, args });
    if (result.ok) { expect(Object.getPrototypeOf(result.args)).toBe(Object.prototype); expect(result.args.polluted).toBeUndefined(); }
  });
});
