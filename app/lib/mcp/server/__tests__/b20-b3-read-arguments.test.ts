/**
 * [B20 B3] B — the argument gate and the call bindings of an MCP read (D-5, D-7; OD-70): every argument key declared and
 * compared exactly, lengths judged before patterns, `null` on an optional property counted as absent, a fresh object of
 * validated values out; the three `_meta` bindings read by exact key only, each with a closed pattern, never echoed.
 */
import { describe, expect, it, vi } from "vitest";
import { sirkitToolRegistry } from "@/app/lib/engineering/tool-catalog";
import {
  MCP_IDEMPOTENCY_KEY_PATTERN,
  MCP_NET_NAME_PATTERN,
  MCP_READ_ARGUMENT_BOUNDS,
  MCP_READ_ARGUMENT_MAX_KEYS,
  MCP_READ_ARGUMENT_RULES,
  MCP_READ_META_KEYS,
  MCP_REVISION_BINDING_PATTERN,
  gateMcpReadArguments,
  parseMcpReadBindings,
  validateMcpReadArgumentBounds,
} from "../read-arguments";

const registry = sirkitToolRegistry();
const SERVED_READS = [
  "sirkit.component-authority.inspect", "sirkit.manufacturing.readiness-inspect", "sirkit.pcb.board-inspect", "sirkit.pcb.mechanical-inspect",
  "sirkit.pcb.revision-inspect", "sirkit.pcb.via-inspect", "sirkit.project.canonical-revision-inspect", "sirkit.validation.connectivity-verify", "sirkit.validation.drc-run",
];
const PRINCIPAL = { projectId: "proj-mcp" };
const REVISION = "eng1-0123456789abcdef";
const REGISTRY = "eng1-fedcba9876543210";
const KEY = "retry-key-0001";
const HOSTILE_NUMBERS = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, 0, 1.5, 2 ** 53];
const gate = (toolId: string, args: unknown) => gateMcpReadArguments(toolId, args, PRINCIPAL);
const refused = (toolId: string, args: unknown): void => expect(gate(toolId, args), `${toolId} ${String(JSON.stringify(args)).slice(0, 60)}`).toEqual({ ok: false });

describe("[B20 B3] B — the argument gate", () => {
  it("1. the rule table's keys are each served read's registry inputSchema properties, exactly, over exactly the nine reads", () => {
    expect(Object.keys(MCP_READ_ARGUMENT_RULES).sort()).toEqual([...SERVED_READS].sort());
    expect(Object.isFrozen(MCP_READ_ARGUMENT_RULES)).toBe(true);
    for (const toolId of SERVED_READS) {
      const properties = Object.keys((registry.get(toolId)!.inputSchema.properties ?? {}) as Record<string, unknown>).sort();
      expect(Object.keys(MCP_READ_ARGUMENT_RULES[toolId]!).sort(), toolId).toEqual(properties);
      expect(Object.isFrozen(MCP_READ_ARGUMENT_RULES[toolId])).toBe(true);
    }
    expect(MCP_READ_ARGUMENT_RULES["sirkit.pcb.board-inspect"]).toEqual({ projectId: "projectId" });
    expect(MCP_READ_ARGUMENT_RULES["sirkit.pcb.via-inspect"]).toEqual({ netName: "netName" });
    expect(MCP_READ_ARGUMENT_RULES["sirkit.component-authority.inspect"]).toEqual({ componentIds: "componentIds" });
    refused("sirkit.schematic.inspect", {});
    refused("sirkit.project.history-inspect", {});
    refused("sirkit.placement.propose", {});
  });

  it("2. null counts as absent; an absent arguments object and {} are accepted; the output is a fresh object of validated values", () => {
    for (const toolId of SERVED_READS) {
      expect(gate(toolId, undefined), toolId).toEqual({ ok: true, args: {} });
      expect(gate(toolId, {}), toolId).toEqual({ ok: true, args: {} });
    }
    expect(gate("sirkit.pcb.board-inspect", { projectId: null })).toEqual({ ok: true, args: {} });
    expect(gate("sirkit.pcb.via-inspect", { netName: null })).toEqual({ ok: true, args: {} });
    expect(gate("sirkit.component-authority.inspect", { componentIds: null })).toEqual({ ok: true, args: {} });
    const input = { netName: "SIG" };
    const result = gate("sirkit.pcb.via-inspect", input);
    expect(result).toEqual({ ok: true, args: { netName: "SIG" } });
    if (result.ok) expect(result.args).not.toBe(input);
    const ids = ["sync-u1"];
    const idsResult = gate("sirkit.component-authority.inspect", { componentIds: ids });
    if (!idsResult.ok) throw new Error("fixture");
    expect(idsResult.args.componentIds).toEqual(ids);
    expect(idsResult.args.componentIds).not.toBe(ids);
  });

  it("3. an unknown key, a raw-JSON __proto__, constructor, prototype or 9 keys is invalid_arguments, with nothing echoed", () => {
    const canary = ["sk", "canary", "0123456789abcdefghij"].join("_");
    for (const toolId of SERVED_READS) {
      for (const args of [{ [canary]: 1 }, JSON.parse(`{"__proto__":{"polluted":"${canary}"}}`), { constructor: "x" }, { prototype: "x" }, Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`k${index}`, index]))]) {
        const result = gate(toolId, args);
        expect(result).toEqual({ ok: false });
        expect(JSON.stringify(result)).not.toContain(canary);
      }
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(MCP_READ_ARGUMENT_MAX_KEYS).toBe(8);
    // [B20 B3 review] the count is judged before any key: nine keys whose FIRST is the tool's own declared key are refused
    // before that key's value is examined (its pattern never runs); with eight keys the same declared value is examined first
    const patternRuns = (toolId: string, args: Record<string, unknown>): { answer: unknown; runs: number } => {
      const test = vi.spyOn(RegExp.prototype, "test");
      const exec = vi.spyOn(RegExp.prototype, "exec");
      const answer = gate(toolId, args);
      const runs = test.mock.calls.length + exec.mock.calls.length;
      test.mockRestore();
      exec.mockRestore();
      return { answer, runs };
    };
    for (const [toolId, declared] of [["sirkit.pcb.via-inspect", { netName: "SIG" }], ["sirkit.component-authority.inspect", { componentIds: ["sync-u1"] }]] as const) {
      const extra = (count: number) => Object.fromEntries(Array.from({ length: count }, (_, index) => [`k${index + 1}`, index]));
      const nine = { ...declared, ...extra(8) };
      expect(Object.keys(nine)[0]).toBe(Object.keys(declared)[0]);
      expect(Object.keys(nine)).toHaveLength(9);
      expect(patternRuns(toolId, nine), `${toolId}: nine keys`).toEqual({ answer: { ok: false }, runs: 0 });
      const eight = patternRuns(toolId, { ...declared, ...extra(7) });
      expect(eight.answer, `${toolId}: eight keys`).toEqual({ ok: false });
      expect(eight.runs, `${toolId}: eight keys examine the declared value`).toBeGreaterThan(0);
    }
    // non-object arguments are refused too (the dispatch answers them before the gate)
    for (const args of [null, 5, "x", [], [1]]) refused("sirkit.pcb.board-inspect", args);
  });

  it("4. projectId: the principal's project passes; another project, 129 characters or a number fails", () => {
    expect(gate("sirkit.pcb.board-inspect", { projectId: "proj-mcp" })).toEqual({ ok: true, args: { projectId: "proj-mcp" } });
    for (const projectId of ["proj-other", "p".repeat(129), 7, "", ["proj-mcp"]]) refused("sirkit.pcb.board-inspect", { projectId });
  });

  it("5. netName: /root/VCC, +3V3 and Net-(U1-Pad3) pass; a space, a quote, a backslash, a backtick, U+202E, 129 characters or the empty string fail; 5 000 000 characters are refused before any pattern runs", () => {
    for (const netName of ["/root/VCC", "+3V3", "Net-(U1-Pad3)", "SIG", "a".repeat(128)]) expect(gate("sirkit.pcb.via-inspect", { netName }), netName).toEqual({ ok: true, args: { netName } });
    const bidi = String.fromCharCode(0x202e);
    for (const netName of ["VCC 3V3", `"VCC"`, "V\\CC", "V`CC", "V'CC", `VCC${bidi}`, "a".repeat(129), "", 5, ["VCC"]]) refused("sirkit.pcb.via-inspect", { netName });
    const huge = { netName: "a".repeat(5_000_000) };
    const test = vi.spyOn(RegExp.prototype, "test");
    const exec = vi.spyOn(RegExp.prototype, "exec");
    const answer = gateMcpReadArguments("sirkit.pcb.via-inspect", huge, PRINCIPAL);
    const calls = test.mock.calls.length + exec.mock.calls.length;
    test.mockRestore();
    exec.mockRestore();
    expect(answer).toEqual({ ok: false });
    expect(calls).toBe(0);
    expect(MCP_NET_NAME_PATTERN.source.length).toBeGreaterThan(0);
  });

  it("6. componentIds: [] and 512 valid ids pass; 513 ids are refused before any per-item work; a bad pattern, a 129-character item or a non-string item fails", () => {
    expect(gate("sirkit.component-authority.inspect", { componentIds: [] })).toEqual({ ok: true, args: { componentIds: [] } });
    const ids = Array.from({ length: 512 }, (_, index) => `sync-${index}`);
    expect(gate("sirkit.component-authority.inspect", { componentIds: ids })).toEqual({ ok: true, args: { componentIds: ids } });
    // [B20 B3 review] item reads are COUNTED, not thrown on: the gate's own try/catch would turn a thrown tripwire into the
    // same { ok: false }, so a gate that walked the items first would still pass
    let itemReads = 0;
    const counted = (length: number): string[] => new Proxy(Array.from({ length }, (_, index) => `sync-${index}`), { get(target, key, receiver) { if (typeof key === "string" && /^\d+$/.test(key)) itemReads += 1; return Reflect.get(target, key, receiver); } });
    expect(gateMcpReadArguments("sirkit.component-authority.inspect", { componentIds: counted(513) }, PRINCIPAL), "513 ids").toEqual({ ok: false });
    expect(itemReads, "no item of 513 ids is read").toBe(0);
    expect(gateMcpReadArguments("sirkit.component-authority.inspect", { componentIds: counted(512) }, PRINCIPAL)).toMatchObject({ ok: true });
    expect(itemReads, "the control: each of 512 ids is read").toBe(512);
    for (const componentIds of [["bad id"], ["-lead"], ["x".repeat(129)], [5], [null], "sync-1", {}]) refused("sirkit.component-authority.inspect", { componentIds });
  });

  it("7. the _meta bindings: the valid forms pass; a wrong type, 20 or 22 characters, upper-case hex, a pcb2- value, a 7- or 129-character key, a leading -, or whitespace is refused with nothing echoed; another key's getter is never invoked; a raw __proto__ is inert", () => {
    expect(MCP_READ_META_KEYS).toEqual({ expectedRevision: "dev.sirkit/expectedRevision", expectedRegistryDigest: "dev.sirkit/expectedRegistryDigest", idempotencyKey: "dev.sirkit/idempotencyKey" });
    const M = MCP_READ_META_KEYS;
    expect(parseMcpReadBindings({})).toEqual({ ok: true, bindings: { expectedRevision: null, expectedRegistryDigest: null, idempotencyKey: null } });
    expect(parseMcpReadBindings({ [M.expectedRevision]: REVISION, [M.expectedRegistryDigest]: REGISTRY, [M.idempotencyKey]: KEY })).toEqual({ ok: true, bindings: { expectedRevision: REVISION, expectedRegistryDigest: REGISTRY, idempotencyKey: KEY } });
    for (const key of ["a".repeat(8), "A".repeat(128), "k1.2:3-4_5", "0abcdefg"]) expect(parseMcpReadBindings({ [M.idempotencyKey]: key }), key).toMatchObject({ ok: true });
    const bad: Array<[string, unknown]> = [
      [M.expectedRevision, 5], [M.expectedRevision, null], [M.expectedRevision, "eng1-0123456789abcde"], [M.expectedRevision, "eng1-0123456789abcdef0"], [M.expectedRevision, "eng1-0123456789ABCDEF"],
      [M.expectedRevision, "pcb2-0123456789abcdef"], [M.expectedRevision, " eng1-123456789abcdef"], [M.expectedRegistryDigest, "eng1-XYZ3456789abcdef"], [M.expectedRegistryDigest, ["eng1-0123456789abcdef"]],
      [M.idempotencyKey, "a".repeat(7)], [M.idempotencyKey, "a".repeat(129)], [M.idempotencyKey, "-leading-key"], [M.idempotencyKey, "key with space"], [M.idempotencyKey, `key${String.fromCharCode(10)}break`], [M.idempotencyKey, 12345678],
    ];
    for (const [key, value] of bad) {
      const result = parseMcpReadBindings({ [key]: value });
      expect(result, `${key}=${String(value)}`).toEqual({ ok: false });
      expect(JSON.stringify(result)).not.toContain(String(value));
    }
    const getter = vi.fn(() => "x");
    const meta: Record<string, unknown> = { [M.expectedRevision]: REVISION };
    Object.defineProperty(meta, "dev.sirkit/other", { get: getter, enumerable: true });
    Object.defineProperty(meta, "io.modelcontextprotocol/clientInfo", { get: getter, enumerable: true });
    expect(parseMcpReadBindings(meta)).toMatchObject({ ok: true, bindings: { expectedRevision: REVISION } });
    expect(getter).not.toHaveBeenCalled();
    const proto = JSON.parse(`{"__proto__":{"${M.expectedRevision}":"eng1-ffffffffffffffff"}}`) as unknown;
    expect(parseMcpReadBindings(proto)).toEqual({ ok: true, bindings: { expectedRevision: null, expectedRegistryDigest: null, idempotencyKey: null } });
    expect(MCP_REVISION_BINDING_PATTERN.test(REVISION)).toBe(true);
    expect(MCP_IDEMPOTENCY_KEY_PATTERN.test(KEY)).toBe(true);
  });

  it("8. S3: the constants validator refuses NaN, ±Infinity, -1, 0, 1.5 and 2^53; S4: 40 hostile inputs never throw", () => {
    expect(MCP_READ_ARGUMENT_BOUNDS).toEqual({ MCP_READ_ARGUMENT_MAX_KEYS: 8, MCP_READ_ARGUMENT_STRING_MAX_CHARS: 128, MCP_READ_COMPONENT_IDS_MAX: 512, MCP_READ_META_DIGEST_CHARS: 21, MCP_READ_IDEMPOTENCY_KEY_MIN_CHARS: 8, MCP_READ_IDEMPOTENCY_KEY_MAX_CHARS: 128 });
    expect(Object.isFrozen(MCP_READ_ARGUMENT_BOUNDS)).toBe(true);
    expect(validateMcpReadArgumentBounds(MCP_READ_ARGUMENT_BOUNDS)).toEqual([]);
    for (const name of Object.keys(MCP_READ_ARGUMENT_BOUNDS)) {
      for (const value of HOSTILE_NUMBERS) expect(validateMcpReadArgumentBounds({ ...MCP_READ_ARGUMENT_BOUNDS, [name]: value }).length, `${name}=${value}`).toBeGreaterThan(0);
    }
    for (const value of [null, 5, "x", [], { extra: 1 }]) expect(validateMcpReadArgumentBounds(value).length).toBeGreaterThan(0);
    const throwing = new Proxy({}, { get() { throw new Error("getter"); }, ownKeys() { throw new Error("keys"); }, getOwnPropertyDescriptor() { throw new Error("descriptor"); } });
    const hostile: unknown[] = [
      null, undefined, 0, 1, -1, Number.NaN, "", "x", true, false, [], [1], {}, throwing, Symbol("s"), () => 1, new Date(0), new Map(), Object.create(null),
      { netName: throwing }, { componentIds: throwing }, { componentIds: [throwing] }, { projectId: throwing }, JSON.parse('{"__proto__":null}'),
      { projectId: { toString: () => "proj-mcp" } }, { netName: { length: 3 } }, { componentIds: { length: 1, 0: "x" } }, new Proxy([], { get() { throw new Error("array"); } }),
      { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9 }, "a".repeat(100_000), 2 ** 53, -0, Number.POSITIVE_INFINITY, new Uint8Array(4), new Error("e"), Promise.resolve(1),
      { [MCP_READ_META_KEYS.expectedRevision]: throwing }, { [MCP_READ_META_KEYS.idempotencyKey]: { length: 10 } }, { [MCP_READ_META_KEYS.expectedRegistryDigest]: Object.create(null) }, new Proxy({}, { has() { throw new Error("has"); } }),
    ];
    expect(hostile).toHaveLength(40);
    for (const input of hostile) {
      for (const toolId of [...SERVED_READS, "sirkit.no-such-tool", 5 as unknown as string]) expect(() => gateMcpReadArguments(toolId, input, PRINCIPAL)).not.toThrow();
      expect(() => gateMcpReadArguments("sirkit.pcb.board-inspect", { projectId: "proj-mcp" }, input as { projectId: string })).not.toThrow();
      expect(() => parseMcpReadBindings(input)).not.toThrow();
    }
  });
});
