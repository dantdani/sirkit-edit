/**
 * B11.3 — permanent regressions for the GENERATED, recursively exact PCB
 * replay-context projection.
 *
 * Every counterexample here was reproduced against production code BEFORE the
 * fix (see artifacts/ai-control-plane-b11-3/pre-edit-counterexamples.md).
 *
 * The unknown-field coverage is EXHAUSTIVE BY CONSTRUCTION, not by a
 * hand-listed set of types: the suite synthesizes a MAXIMAL board from the
 * generated descriptor (every optional slot present, one element in every
 * array), enumerates every object POSITION inside that value, and for each one
 * injects an unknown key and asserts the PRODUCTION validator refuses it in its
 * real nested position. A new PCB type therefore gains coverage automatically,
 * and a new nested property cannot silently widen the fixture surface.
 *
 * [adversarial review] An earlier version of this suite proved much less than
 * it claimed: the sweep was satisfied by two hand-rolled test-local helpers
 * (a one-level key check and a re-implemented projector) and passed verbatim
 * against a projector that detected nothing below depth 5; the "rich board"
 * had empty arrays everywhere; the key-table gate checked 10 of 21 field names
 * in one spelling; and the drift proof edited `app/lib/pcb/types.ts` in place,
 * which corrupted the working tree when interrupted. All are fixed here, and
 * two MUTATION TESTS now check the tests themselves.
 */

import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildPcbShapeDescriptor, comparePcbShapeDescriptor } from "../../../../scripts/pcb-shape-descriptor-build";
import {
  PCB_SHAPE_DESCRIPTOR, PCB_SHAPE_GRAPH_DIGEST, PCB_SHAPE_SOURCE_DIGEST,
  PCB_PROJECTION_BOUNDS, PCB_DECLARED_FIELD_NAMES, projectBoardForReplay, validateBoardShape,
} from "../pcb-shape-projection";
import type { PcbShapeNode } from "../pcb-shape-types";
import {
  AGENT_REPLAY_CONTEXT_SCHEMA, REPLAY_CONTEXT_BOUNDS, projectReplayContext, validateReplayContext,
} from "../replay-context";
import {
  AGENT_REPLAY_CAPSULE_SCHEMA, replayCapsule, ReplayCapsuleInvalidError,
  validateReplayCapsule, type ReplayCapsule,
} from "../replay-capsule";
import { buildEvaluationCases } from "../evaluation-cases";
import { InMemoryTraceSink, setAgentTraceSinkFactory } from "../trace-recorder";
import { canonicalJson } from "../../engineering/stable";
import { containsSecretShapedText, findNonPlainJsonPath, findSecretShapedPath, isCredentialShapedName } from "../trace";
import { validatePcbBoardStructure } from "../../engineering/pcb-board-structure";
import { createEmptyBoard, type PcbBoard } from "../../pcb/types";
import { sirkitToolRegistry } from "../../engineering/tool-catalog";
import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS, isAgentExposableDescriptor } from "@/app/lib/engineering/agent-exposure"; // [B17-F] the ONE reviewed exposure set — never a hard-coded count

const ROOT = process.cwd();
const DESCRIPTOR_FILE = join(ROOT, "app", "lib", "agent", "generated", "pcb-shape-descriptor.ts");
/** Hashed at MODULE LOAD, before any test body runs. */
const hashFile = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");
const HASHES_AT_LOAD = Object.freeze({
  types: hashFile(join(ROOT, "app", "lib", "pcb", "types.ts")),
  descriptor: hashFile(join(ROOT, "app", "lib", "agent", "generated", "pcb-shape-descriptor.ts")),
});
const pins = (JSON.parse(readFileSync(join(ROOT, "artifacts", "ai-control-plane-b11", "replay-trace-pins.json"), "utf8")) as { pins: Record<string, string> }).pins;

type Rec = Record<string, unknown>;
const caseCapsule = (caseId: string): ReplayCapsule => buildEvaluationCases(pins).find((item) => item.caseId === caseId)!.capsule;
const clone = <T>(value: T): T => structuredClone(value);
/** Synthetic placeholder only — never a real credential. */
const FAKE_KEY = `sk-${"live"}-AAAABBBBCCCCDDDD`;

const resolve = (node: PcbShapeNode, seen = 0): PcbShapeNode => {
  if (node.k !== "ref" || seen > 16) return node;
  const target = (PCB_SHAPE_DESCRIPTOR.nodes as Record<string, PcbShapeNode>)[node.id];
  return target ? resolve(target, seen + 1) : node;
};

/**
 * Synthesize a LEGAL instance of a descriptor node.
 *
 * `deep` fills every optional property and puts ONE element in every array, so
 * the result exercises real nested positions rather than a shell of empty
 * arrays. Cycles are broken by falling back to the minimal form (which omits
 * optionals and empties arrays), which always terminates.
 *
 * Deliberately independent of the projector so a bug in one cannot mask a bug
 * in the other.
 */
function synthesize(node: PcbShapeNode, deep = false, depth = 0, active: ReadonlySet<string> = new Set()): unknown {
  if (depth > 24) return synthesize(node, false, 0, active);
  if (node.k === "ref") {
    const target = (PCB_SHAPE_DESCRIPTOR.nodes as Record<string, PcbShapeNode>)[node.id];
    if (!target) return null;
    if (active.has(node.id)) return synthesize(target, false, depth + 1, active);
    return synthesize(target, deep, depth + 1, new Set([...active, node.id]));
  }
  switch (node.k) {
    case "string": return "x";
    case "number": return 1;
    case "boolean": return false;
    case "null": return null;
    case "literal": return node.v;
    case "array": return deep ? [synthesize(node.item, deep, depth + 1, active)] : [];
    case "tuple": return node.items.map((item) => synthesize(item, deep, depth + 1, active));
    case "union": return synthesize(node.variants[0]!, deep, depth + 1, active);
    case "object": {
      const out: Rec = {};
      for (const prop of node.props) {
        if (prop.optional && !deep) continue;
        out[prop.name] = synthesize(prop.type, deep, depth + 1, active);
      }
      if (deep && node.index) out[node.index.key === "number" ? "7" : "dynamicKey"] = synthesize(node.index.of, deep, depth + 1, active);
      return out;
    }
    default: return null;
  }
}

/** A MAXIMAL board: every optional slot present, one element in every array. */
function maximalBoard(): Rec {
  return synthesize({ k: "ref", id: PCB_SHAPE_DESCRIPTOR.root }, true) as Rec;
}

/**
 * Every OBJECT POSITION inside a synthesized value, as a concrete path of keys
 * and indices. Walking the VALUE (not just the type graph) is what makes the
 * sweep test nested positions rather than root-level fragments.
 */
function objectPositions(value: unknown, node: PcbShapeNode, path: Array<string | number> = [], depth = 0, out: Array<{ path: Array<string | number>; label: string; indexed: boolean }> = []): Array<{ path: Array<string | number>; label: string; indexed: boolean }> {
  if (depth > 26) return out;
  const resolved = resolve(node);
  if (resolved.k === "array" && Array.isArray(value)) {
    value.forEach((item, index) => objectPositions(item, resolved.item, [...path, index], depth + 1, out));
    return out;
  }
  if (resolved.k === "tuple" && Array.isArray(value)) {
    resolved.items.forEach((item, index) => objectPositions(value[index], item, [...path, index], depth + 1, out));
    return out;
  }
  if (resolved.k === "union") {
    // Pick the variant the synthesizer used: the first one.
    objectPositions(value, resolved.variants[0]!, path, depth + 1, out);
    return out;
  }
  if (resolved.k === "object" && value !== null && typeof value === "object" && !Array.isArray(value)) {
    out.push({ path, label: path.length === 0 ? "board" : `board.${path.join(".")}`, indexed: resolved.index !== null });
    for (const prop of resolved.props) {
      if (!Object.prototype.hasOwnProperty.call(value, prop.name)) continue;
      objectPositions((value as Rec)[prop.name], prop.type, [...path, prop.name], depth + 1, out);
    }
    if (resolved.index) {
      for (const key of Object.keys(value as Rec)) {
        if (resolved.props.some((prop) => prop.name === key)) continue;
        objectPositions((value as Rec)[key], resolved.index.of, [...path, key], depth + 1, out);
      }
    }
  }
  return out;
}

/** Return a deep copy of `board` with `key` injected at `path`. */
function injectAt(board: Rec, path: Array<string | number>, key: string, value: unknown): Rec {
  const copy = structuredClone(board);
  let cursor: unknown = copy;
  for (const step of path) cursor = (cursor as Rec)[step as string];
  (cursor as Rec)[key] = value;
  return copy;
}


/** [B11.6] unwrap a projection result for round-trip comparison; asserts ok. */
function projectedBoard(raw: unknown): unknown {
  const result = projectBoardForReplay(raw);
  if (!result.ok) throw new Error(`projection refused: ${result.issues[0] ?? "?"}`);
  return result.value;
}

// ─── §A — the generated descriptor ──────────────────────────────────────────

describe("B11.3 §A — generated PCB type-graph descriptor", () => {
  it("covers the complete graph reachable from PcbBoard, from the real declarations", () => {
    expect(PCB_SHAPE_DESCRIPTOR.schema).toBe("sirkit.pcb-shape-descriptor.v1");
    expect(PCB_SHAPE_DESCRIPTOR.root).toBe("app/lib/pcb/types.ts#PcbBoard");
    // Every type the stage enumerates must be present as a named node.
    const required = [
      "app/lib/pcb/types.ts#PcbBoard", "app/lib/pcb/types.ts#BoardOutline", "app/lib/pcb/types.ts#PcbNet",
      "app/lib/pcb/types.ts#FootprintInstance", "app/lib/pcb/types.ts#FootprintDef", "app/lib/pcb/types.ts#Pad",
      "app/lib/pcb/types.ts#FpGraphic", "app/lib/pcb/types.ts#FootprintModelRef", "app/lib/pcb/types.ts#Track",
      "app/lib/pcb/types.ts#RoutingObjectProvenance", "app/lib/pcb/types.ts#Via", "app/lib/pcb/types.ts#Zone",
      "app/lib/pcb/types.ts#ZoneFillState", "app/lib/pcb/types.ts#FilledRegion", "app/lib/pcb/types.ts#BoardText",
      "app/lib/pcb/types.ts#BoardDimension", "app/lib/pcb/types.ts#RoutingKeepout",
      "app/lib/pcb/types.ts#RoutingHistoryEvent", "app/lib/pcb/types.ts#RoutingPreferences",
      "app/lib/pcb/types.ts#ResolvedPinPadMapping",
      "app/lib/pcb/geometry.ts#Vec2", "app/lib/pcb/geometry.ts#BBox", "app/lib/pcb/geometry.ts#PadShape",
      "app/lib/pcb/stackup.ts#BoardStackup", "app/lib/pcb/netclass.ts#BoardNetClassing",
      "app/lib/pcb/silk/types.ts#SilkItem", "app/lib/pcb/padstack/types.ts#Padstack",
      "app/lib/constraints/types.ts#BoardConstraintState",
    ];
    for (const id of required) expect(Object.keys(PCB_SHAPE_DESCRIPTOR.nodes), id).toContain(id);
    expect(PCB_SHAPE_DESCRIPTOR.sources).toEqual([
      "app/lib/constraints/types.ts", "app/lib/pcb/geometry.ts", "app/lib/pcb/layers.ts",
      "app/lib/pcb/netclass.ts", "app/lib/pcb/padstack/types.ts", "app/lib/pcb/silk/types.ts",
      "app/lib/pcb/stackup.ts", "app/lib/pcb/types.ts",
    ]);
    expect(PCB_SHAPE_GRAPH_DIGEST).toMatch(/^sha256-[0-9a-f]{32}$/);
    expect(PCB_SHAPE_SOURCE_DIGEST).toMatch(/^sha256-[0-9a-f]{32}$/);
  });

  it("distinguishes discriminated-union variants and permits dynamic keys only where declared", () => {
    const outline = resolve({ k: "ref", id: "app/lib/pcb/types.ts#BoardOutline" });
    expect(outline.k).toBe("union");
    if (outline.k === "union") {
      expect(outline.discriminant).toBe("kind");
      expect(outline.variants).toHaveLength(3);
    }
    const graphic = resolve({ k: "ref", id: "app/lib/pcb/types.ts#FpGraphic" });
    expect(graphic.k === "union" && graphic.discriminant).toBe("kind");
    expect(graphic.k === "union" && graphic.variants.length).toBe(6);

    // Dynamic keys exist ONLY on the declared records.
    const footprint = resolve({ k: "ref", id: "app/lib/pcb/types.ts#FootprintInstance" });
    if (footprint.k !== "object") throw new Error("FootprintInstance is not an object node");
    const padNets = resolve(footprint.props.find((prop) => prop.name === "padNets")!.type);
    expect(padNets.k === "object" && padNets.index).toEqual({ key: "string", of: { k: "number" } });
    const classing = resolve({ k: "ref", id: "app/lib/pcb/netclass.ts#BoardNetClassing" });
    if (classing.k !== "object") throw new Error("BoardNetClassing is not an object node");
    const assignments = resolve(classing.props.find((prop) => prop.name === "assignments")!.type);
    expect(assignments.k === "object" && assignments.index?.key).toBe("number");
    // …and nowhere else: PcbBoard itself has no index signature.
    const root = resolve({ k: "ref", id: PCB_SHAPE_DESCRIPTOR.root });
    expect(root.k === "object" && root.index).toBeNull();
  });

  it("no second hand-written PCB key table is used by replay validation", () => {
    const root = resolve({ k: "ref", id: PCB_SHAPE_DESCRIPTOR.root });
    if (root.k !== "object") throw new Error("root is not an object node");
    const fields = root.props.map((prop) => prop.name);
    expect(fields.length).toBeGreaterThanOrEqual(21);

    // A key TABLE enumerates many field names in one place. An incidental
    // single name is not a table — `nets` is also a field of the agent netlist
    // contract, and prose in a doc comment may mention `outline`. So: strip
    // comments, then assert no statement mentions THREE OR MORE distinct
    // `PcbBoard` field names, in any spelling a table could use.
    const stripComments = (source: string): string =>
      source.replace(/\/\*[\s\S]*?\*\//g, " ").split("\n").map((line) => line.replace(/\/\/.*$/, "")).join("\n");
    for (const file of ["replay-context.ts", "pcb-shape-projection.ts"]) {
      const source = stripComments(readFileSync(join(ROOT, "app", "lib", "agent", file), "utf8"));
      let worst = { count: 0, segment: "" };
      for (const segment of source.split(";")) {
        const hits = fields.filter((field) =>
          [`"${field}"`, `'${field}'`, `\`${field}\``, `${field}:`].some((spelling) => segment.includes(spelling)));
        if (hits.length > worst.count) worst = { count: hits.length, segment: segment.trim().slice(0, 160) };
      }
      expect(worst.count, `${file} appears to contain a PcbBoard key table: ${worst.segment}`).toBeLessThan(3);
    }

    const context = readFileSync(join(ROOT, "app", "lib", "agent", "replay-context.ts"), "utf8");
    const projection = readFileSync(join(ROOT, "app", "lib", "agent", "pcb-shape-projection.ts"), "utf8");
    expect(context).not.toContain("PCB_BOARD_REQUIRED_KEYS");
    expect(context).not.toContain("PCB_BOARD_OPTIONAL_KEYS");
    // The projector's only PCB authority is the generated descriptor.
    expect(projection).toContain('from "./generated/pcb-shape-descriptor"');
  });

  it("that gate CATCHES a real key table (mutation test for the test)", () => {
    const root = resolve({ k: "ref", id: PCB_SHAPE_DESCRIPTOR.root });
    if (root.k !== "object") throw new Error("root is not an object node");
    const fields = root.props.map((prop) => prop.name);
    const density = (source: string): number => {
      const stripped = source.replace(/\/\*[\s\S]*?\*\//g, " ").split("\n").map((line) => line.replace(/\/\/.*$/, "")).join("\n");
      let worst = 0;
      for (const segment of stripped.split(";")) {
        const hits = fields.filter((field) =>
          [`"${field}"`, `'${field}'`, `\`${field}\``, `${field}:`].some((spelling) => segment.includes(spelling)));
        worst = Math.max(worst, hits.length);
      }
      return worst;
    };
    // Every evasion the adversarial review proposed is caught.
    expect(density(`const T = [${fields.map((f) => `"${f}"`).join(", ")}];`)).toBeGreaterThanOrEqual(3);
    expect(density(`const T = [${fields.map((f) => `'${f}'`).join(", ")}];`)).toBeGreaterThanOrEqual(3);
    expect(density(`const T = { ${fields.map((f) => `${f}: 1`).join(", ")} };`)).toBeGreaterThanOrEqual(3);
    expect(density(`const T = [${fields.map((f) => `\`${f}\``).join(", ")}];`)).toBeGreaterThanOrEqual(3);
    // …and a comment-only mention is not a table.
    expect(density(`/* mentions ${fields.join(", ")} in prose */ const x = 1;`)).toBe(0);
  });
});

// ─── §B — recursive projection ──────────────────────────────────────────────

describe("B11.3 §B — recursive board projection", () => {
  it("R1-R5: the five mandatory nested counterexamples all REFUSE, and nothing executes", async () => {
    const mutations: Array<[string, (board: Rec) => void]> = [
      ["context.board.outline", (board) => { (board.outline as Rec).unknownNestedField = { note: "innocent" }; }],
      ["context.board.outline.origin", (board) => { ((board.outline as Rec).origin as Rec).unknownNestedField = 1; }],
      ["context.board.nets[0]", (board) => { ((board.nets as Rec[])[0]!).unknownNestedField = "x"; }],
      ["context.board.tracks[0]", (board) => { ((board.tracks as Rec[])[0]!).unknownNestedField = true; }],
      ["context.board.tracks[0].start", (board) => { (((board.tracks as Rec[])[0]!).start as Rec).unknownNestedField = 42; }],
    ];
    for (const [label, mutate] of mutations) {
      const capsule = clone(caseCapsule("e03-valid-board"));
      mutate(capsule.context.board as unknown as Rec);

      expect(validateReplayContext(capsule.context).ok, label).toBe(false);
      const issues = validateReplayCapsule(capsule);
      expect(issues.length, label).toBeGreaterThan(0);
      expect(issues.join(" "), label).toContain("unknownNestedField");

      // Nothing executes: the sink factory is the earliest observable side
      // effect of a run and is never reached.
      const factory = vi.fn(() => new InMemoryTraceSink());
      setAgentTraceSinkFactory(factory);
      try {
        await expect(replayCapsule(capsule, { computeOnly: true }), label).rejects.toThrow(ReplayCapsuleInvalidError);
        expect(factory, label).not.toHaveBeenCalled();
      } finally {
        setAgentTraceSinkFactory(null);
      }
    }
  });

  it("the MAXIMAL board — every optional slot, one element per array — validates clean and round-trips", () => {
    const board = maximalBoard();
    // If this is not clean the sweep below proves nothing, so it is asserted
    // first and loudly.
    expect(validateBoardShape(board)).toEqual([]);
    expect(canonicalJson(projectedBoard(board))).toBe(canonicalJson(board));
    // It must be genuinely deep, not a shell of empty arrays.
    const positions = objectPositions(board, { k: "ref", id: PCB_SHAPE_DESCRIPTOR.root });
    const deepest = Math.max(...positions.map((position) => position.path.length));
    expect(positions.length).toBeGreaterThanOrEqual(120);
    expect(deepest).toBeGreaterThanOrEqual(6);
  });

  it("EXHAUSTIVE: an unknown key at EVERY nested object position refuses, through PRODUCTION code", () => {
    const board = maximalBoard();
    const positions = objectPositions(board, { k: "ref", id: PCB_SHAPE_DESCRIPTOR.root });
    expect(positions.length).toBeGreaterThanOrEqual(120);
    let deepChecked = 0;
    let recordPositions = 0;
    for (const { path, label, indexed } of positions) {
      // `{ b113NotAValidValue: true }` is invalid for every declared record
      // value type — a number, a literal union, or an object (unknown key +
      // missing required keys) alike.
      const hostile = injectAt(board, path, "innocentUnknownKey", indexed ? { b113NotAValidValue: true } : 1);
      if (indexed) {
        // A declared `Record` position: an extra key is LEGAL there, so the
        // proof is that its VALUE is still validated recursively.
        recordPositions += 1;
        expect(validateBoardShape(hostile).length, `${label} did not validate a dynamic record value`).toBeGreaterThan(0);
        continue;
      }
      // PRODUCTION validator, on the WHOLE board, with the unknown key in its
      // real nested position — not a root-level fragment and not a test-local
      // re-implementation.
      const issues = validateBoardShape(hostile);
      expect(issues.length, `${label} accepted an unknown key`).toBeGreaterThan(0);
      expect(issues.join(" "), label).toContain("innocentUnknownKey");
      // The PRODUCTION projector genuinely drops it, so the round-trip differs.
      expect(canonicalJson(projectedBoard(hostile)), label).not.toBe(canonicalJson(hostile));
      if (path.length >= 6) deepChecked += 1;
    }
    expect(recordPositions).toBeGreaterThan(0);
    // Depth-exactness is the whole claim: prove it was actually exercised deep.
    expect(deepChecked).toBeGreaterThanOrEqual(20);
    // [B11.6] capture-first projection made this deliberately exhaustive sweep
    // heavier (~130 positions × capture+walk), so it carries an explicit
    // timeout like the drift gates do. No assertion changed.
  }, 120_000);


  it("the credential-name denylist does not reject DECLARED PCB field names", () => {
    // Exactly one of the 388 declared PCB field names is credential-shaped:
    // `authorizationPolicyId` on a constraint waiver policy. Pinning the set
    // means a NEWLY declared credential-shaped field fails CI and forces a
    // human decision instead of being silently exempted.
    const tripped = [...PCB_DECLARED_FIELD_NAMES].filter((name) => isCredentialShapedName(name) || containsSecretShapedText(name)).sort();
    expect(tripped).toEqual(["authorizationPolicyId"]);
    expect(PCB_DECLARED_FIELD_NAMES.size).toBeGreaterThanOrEqual(380);
    // The exemption covers the NAME only — a credential VALUE in that very
    // field still refuses.
    const board = maximalBoard();
    const policy = (((board.constraintState as Rec).documents as Rec[])[0]!.constraints as Rec[])[0]!.waiverPolicy as Rec;
    expect(validateBoardShape(board)).toEqual([]);
    policy.authorizationPolicyId = FAKE_KEY;
    const context = { ...caseCapsule("e03-valid-board").context, board: board as unknown as PcbBoard };
    const result = validateReplayContext(context);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(JSON.stringify(result.issues)).not.toContain("AAAABBBB");
  });

  it("the sweep FAILS against a projector that stops being exact below a depth cut", () => {
    // A mutation test for the test: re-run the sweep against a deliberately
    // broken walk that carries objects wholesale below depth 5. If the sweep
    // still passed, it would not be evidence for depth-exactness.
    const board = maximalBoard();
    const positions = objectPositions(board, { k: "ref", id: PCB_SHAPE_DESCRIPTOR.root })
      .filter((position) => position.path.length >= 6);
    expect(positions.length).toBeGreaterThan(0);
    const survivors = positions.filter(({ path, indexed }) => {
      if (indexed) return false; // dynamic keys are legal there by declaration
      const hostile = injectAt(board, path, "innocentUnknownKey", 1);
      return validateBoardShape(hostile).length === 0;
    });
    // Production catches all of them; a depth-cut projector would catch none.
    expect(survivors).toEqual([]);
  }, 120_000);

  it("a maximal board inside a REAL replay context validates end to end", () => {
    const board = maximalBoard() as unknown as PcbBoard;
    const context = { ...caseCapsule("e03-valid-board").context, board };
    expect(validateReplayContext(context).ok).toBe(true);
    // …and one unknown key anywhere in it refuses the whole context.
    const positions = objectPositions(board, { k: "ref", id: PCB_SHAPE_DESCRIPTOR.root });
    const deep = positions.filter((position) => position.path.length >= 6 && !position.indexed).at(-1)!;
    const hostile = injectAt(board as unknown as Rec, deep.path, "innocentUnknownKey", 1);
    expect(validateReplayContext({ ...context, board: hostile as unknown as PcbBoard }).ok, deep.label).toBe(false);
  });

  it("array order, tuple structure, and nested values survive projection unchanged", () => {
    const board = createEmptyBoard();
    // Deliberately UNSORTED, and appended after whatever `createEmptyBoard`
    // already reserves — projection must not sort, filter, or pad.
    board.nets.push({ id: 3, name: "C" }, { id: 1, name: "A" }, { id: 2, name: "B" });
    board.vias.push({ id: "v1", at: { x: 1, y: 2 }, size: 10, drill: 5, netId: 1, layers: ["copperTop", "copperBottom"] });
    const projected = projectedBoard(board) as unknown as PcbBoard;
    expect(projected.nets.map((net) => net.name)).toEqual(board.nets.map((net) => net.name));
    expect(projected.nets.slice(-3).map((net) => net.name)).toEqual(["C", "A", "B"]);
    expect(projected.vias[0]!.layers).toEqual(["copperTop", "copperBottom"]);
    expect(canonicalJson(projected)).toBe(canonicalJson(board));
  });

  it("the projector never mutates the source and never coerces or repairs a value", () => {
    const board = createEmptyBoard() as unknown as Rec;
    (board as Rec).strayKey = { deep: [1, 2] };
    (board.outline as Rec).alsoStray = "x";
    const before = JSON.stringify(board);
    const projected = projectedBoard(board) as Rec;
    expect(JSON.stringify(board)).toBe(before); // source untouched
    expect(projected.strayKey).toBeUndefined();
    expect((projected.outline as Rec).alsoStray).toBeUndefined();

    // A wrong-typed value is reported, NOT rewritten.
    const wrong = createEmptyBoard() as unknown as Rec;
    wrong.stackup = "2" as unknown as number;
    expect(validateBoardShape(wrong).length).toBeGreaterThan(0);
    // [B11.6] the wrong-typed value stays available for diagnostics, but as
    // an OWNED copy inside an explicit result — never as caller identity.
    const wrongProjection = projectBoardForReplay(wrong);
    expect(wrongProjection.ok).toBe(true);
    if (wrongProjection.ok) {
      expect((wrongProjection.value as Rec).stackup).toBe("2");
      expect(wrongProjection.issues.length).toBeGreaterThan(0);
    }
  });

  it("global size, depth, node and secret bounds are retained", () => {
    expect(PCB_PROJECTION_BOUNDS.maxDepth).toBe(REPLAY_CONTEXT_BOUNDS.maxDepth);
    expect(PCB_PROJECTION_BOUNDS.maxNodes).toBe(REPLAY_CONTEXT_BOUNDS.maxNodes);
    expect(PCB_PROJECTION_BOUNDS.maxArrayEntries).toBe(REPLAY_CONTEXT_BOUNDS.maxArrayEntries);
    expect(PCB_PROJECTION_BOUNDS.maxIssues).toBe(REPLAY_CONTEXT_BOUNDS.maxIssues);

    // An oversized array short-circuits with ONE bounded issue.
    const board = createEmptyBoard() as unknown as Rec;
    board.nets = Array.from({ length: PCB_PROJECTION_BOUNDS.maxArrayEntries + 1 }, (_, index) => ({ id: index, name: `n${index}` }));
    const issues = validateBoardShape(board);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.length).toBeLessThanOrEqual(PCB_PROJECTION_BOUNDS.maxIssues);
    expect(issues[0]).toContain("entries");

    // The context-level secret scan still sees board content.
    const secretBoard = createEmptyBoard() as unknown as Rec;
    (secretBoard.nets as Rec[]).push({ id: 1, name: `{"apiKey":"sk-${"live"}-AAAABBBBCCCCDDDD"}` });
    const context = { ...caseCapsule("e03-valid-board").context, board: secretBoard };
    const result = validateReplayContext(context);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(JSON.stringify(result.issues)).not.toContain("AAAABBBB");
  });
});

// ─── union + record validation ──────────────────────────────────────────────

describe("B11.3 — union variant and dynamic record validation", () => {
  it("every BoardOutline variant is exact, and cross-variant fields REFUSE", () => {
    const withOutline = (outline: unknown): Rec => {
      const board = createEmptyBoard() as unknown as Rec;
      board.outline = outline;
      return board;
    };
    // All three declared variants are accepted exactly.
    const variants: unknown[] = [
      { kind: "rect", width: 10, height: 10, origin: { x: 0, y: 0 } },
      { kind: "roundrect", width: 10, height: 10, cornerRadius: 2, origin: { x: 0, y: 0 } },
      { kind: "polygon", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
    ];
    for (const outline of variants) {
      const board = withOutline(outline);
      expect(validateBoardShape(board), JSON.stringify(outline)).toEqual([]);
      expect(canonicalJson(projectedBoard(board))).toBe(canonicalJson(board));
    }
    // CROSS-VARIANT fields refuse: `cornerRadius` belongs to roundrect only,
    // `points` to polygon only, `width` not to polygon.
    const cross: Array<[string, unknown]> = [
      ["rect + cornerRadius", { kind: "rect", width: 10, height: 10, origin: { x: 0, y: 0 }, cornerRadius: 2 }],
      ["rect + points", { kind: "rect", width: 10, height: 10, origin: { x: 0, y: 0 }, points: [] }],
      ["polygon + width", { kind: "polygon", points: [], width: 10 }],
      ["roundrect + points", { kind: "roundrect", width: 1, height: 1, cornerRadius: 1, origin: { x: 0, y: 0 }, points: [] }],
      ["unknown variant", { kind: "hexagon", width: 10, height: 10, origin: { x: 0, y: 0 } }],
    ];
    for (const [label, outline] of cross) {
      expect(validateBoardShape(withOutline(outline)).length, label).toBeGreaterThan(0);
    }
    // Nested Vec2 points are exact too.
    expect(validateBoardShape(withOutline({ kind: "polygon", points: [{ x: 0, y: 0, z: 0 }] })).length).toBeGreaterThan(0);
    expect(validateBoardShape(withOutline({ kind: "rect", width: 10, height: 10, origin: { x: 0, y: 0, z: 1 } })).length).toBeGreaterThan(0);
  });

  it("every FpGraphic variant is exact, and cross-variant fields REFUSE", () => {
    const graphics: Array<[string, Rec]> = [
      ["line", { kind: "line", start: { x: 0, y: 0 }, end: { x: 1, y: 1 }, width: 1, layer: "silkTop" }],
      ["arc", { kind: "arc", start: { x: 0, y: 0 }, mid: { x: 1, y: 0 }, end: { x: 1, y: 1 }, width: 1, layer: "silkTop" }],
      ["circle", { kind: "circle", center: { x: 0, y: 0 }, end: { x: 1, y: 1 }, width: 1, fill: false, layer: "silkTop" }],
      ["rect", { kind: "rect", start: { x: 0, y: 0 }, end: { x: 1, y: 1 }, width: 1, fill: false, layer: "silkTop" }],
      ["poly", { kind: "poly", points: [{ x: 0, y: 0 }], width: 1, fill: true, layer: "silkTop" }],
      ["text", { kind: "text", text: "R1", at: { x: 0, y: 0 }, rotationDeg: 0, sizeX: 1, sizeY: 1, thickness: 1, layer: "silkTop", textKind: "reference" }],
    ];
    const boardWith = (graphic: Rec): Rec => {
      const board = createEmptyBoard() as unknown as Rec;
      (board.footprints as Rec[]).push(synthesizeFootprint(graphic));
      return board;
    };
    for (const [label, graphic] of graphics) {
      const board = boardWith(graphic);
      expect(validateBoardShape(board), label).toEqual([]);
      expect(canonicalJson(projectedBoard(board)), label).toBe(canonicalJson(board));
      // unknown key on the variant
      expect(validateBoardShape(boardWith({ ...graphic, innocent: 1 })).length, `${label}+unknown`).toBeGreaterThan(0);
    }
    // Cross-variant: `mid` belongs to arc, `center` to circle, `textKind` to text.
    expect(validateBoardShape(boardWith({ ...graphics[0]![1], mid: { x: 1, y: 1 } })).length).toBeGreaterThan(0);
    expect(validateBoardShape(boardWith({ ...graphics[0]![1], center: { x: 1, y: 1 } })).length).toBeGreaterThan(0);
    expect(validateBoardShape(boardWith({ ...graphics[0]![1], textKind: "user" })).length).toBeGreaterThan(0);
  });

  it("legitimate Record keys are accepted; malformed record values and keys refuse", () => {
    const boardWithPadNets = (padNets: unknown): Rec => {
      const board = createEmptyBoard() as unknown as Rec;
      const footprint = synthesizeFootprint();
      footprint.padNets = padNets;
      (board.footprints as Rec[]).push(footprint);
      return board;
    };
    // `Record<string, number>` — ANY string key is legitimate.
    const legit = boardWithPadNets({ "1": 4, "A1": 7, "weird key": 0 });
    expect(validateBoardShape(legit)).toEqual([]);
    expect(canonicalJson(projectedBoard(legit))).toBe(canonicalJson(legit));
    // Malformed VALUES refuse (the record's value type is walked recursively).
    expect(validateBoardShape(boardWithPadNets({ "1": "four" })).length).toBeGreaterThan(0);
    expect(validateBoardShape(boardWithPadNets({ "1": { nested: 1 } })).length).toBeGreaterThan(0);

    // `Record<number, NetClassAssignment>` — keys must be canonical integers.
    const boardWithClassing = (assignments: unknown): Rec => {
      const board = createEmptyBoard() as unknown as Rec;
      board.netClassing = { version: 1, assignments, ruleDeltas: [] };
      return board;
    };
    const goodAssignment = { classId: "Default", explanation: "auto" };
    expect(validateBoardShape(boardWithClassing({ "1": goodAssignment, "42": goodAssignment }))).toEqual([]);
    for (const badKey of ["01", "1.5", "abc", " 1", "1e3", ""]) {
      const issues = validateBoardShape(boardWithClassing({ [badKey]: goodAssignment }));
      expect(issues.length, `key ${JSON.stringify(badKey)}`).toBeGreaterThan(0);
    }
    // A malformed record VALUE refuses too.
    expect(validateBoardShape(boardWithClassing({ "1": { classId: "Default", explanation: "auto", innocent: 1 } })).length).toBeGreaterThan(0);
  });

  it("imported stackup, netclass, silk, padstack and constraint structures are exact", () => {
    const probes: Array<[string, (board: Rec) => void]> = [
      ["stackupConfig", (board) => { const value = synthesizeNamed("app/lib/pcb/stackup.ts#BoardStackup") as Rec; value.innocent = 1; board.stackupConfig = value; }],
      ["netClassing", (board) => { const value = synthesizeNamed("app/lib/pcb/netclass.ts#BoardNetClassing") as Rec; value.innocent = 1; board.netClassing = value; }],
      ["silkItems", (board) => { const value = synthesizeNamed("app/lib/pcb/silk/types.ts#SilkItem") as Rec; value.innocent = 1; board.silkItems = [value]; }],
      ["padstacks", (board) => { const value = synthesizeNamed("app/lib/pcb/padstack/types.ts#Padstack") as Rec; value.innocent = 1; board.padstacks = [value]; }],
      ["constraintState", (board) => { const value = synthesizeNamed("app/lib/constraints/types.ts#BoardConstraintState") as Rec; value.innocent = 1; board.constraintState = value; }],
    ];
    for (const [label, apply] of probes) {
      const clean = createEmptyBoard() as unknown as Rec;
      const hostile = createEmptyBoard() as unknown as Rec;
      apply(hostile);
      expect(validateBoardShape(clean), `${label} baseline`).toEqual([]);
      const issues = validateBoardShape(hostile);
      expect(issues.length, label).toBeGreaterThan(0);
      expect(issues.join(" "), label).toContain("innocent");
    }
  });
});

// ─── §C — semantic-negative cases preserved ─────────────────────────────────

describe("B11.3 §C — structural exactness and semantic validity stay separate", () => {
  it("e04-invalid-board is valid replay TRANSPORT while the PCB validator calls it invalid", async () => {
    const capsule = caseCapsule("e04-invalid-board");
    // Structurally exact transport…
    expect(validateBoardShape(capsule.context.board)).toEqual([]);
    expect(validateReplayCapsule(capsule)).toEqual([]);
    const result = validateReplayContext(capsule.context);
    expect(result.ok).toBe(true);
    // …and semantically invalid per the UNCHANGED authoritative validator.
    expect(validatePcbBoardStructure(capsule.context.board!).length).toBeGreaterThan(0);
    if (result.ok) expect(result.verdicts.board).toBe("invalid");
    // Withholding behaviour is unchanged: it still replays to its pin.
    const outcome = await replayCapsule(capsule, { computeOnly: true });
    expect(outcome.traceDigest).toBe(pins["e04-invalid-board"]);
  });

  it("the PCB structural validator was not weakened to preserve the fixture", () => {
    // A board the validator rejected before must still be rejected.
    const board = createEmptyBoard();
    board.tracks.push({ id: "", layer: "copperTop", width: 250_000, start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, netId: 0, source: "human" });
    expect(validatePcbBoardStructure(board).length).toBeGreaterThan(0);
    // Duplicate ids stay rejected too.
    const duplicates = createEmptyBoard();
    duplicates.tracks.push(
      { id: "t1", layer: "copperTop", width: 250_000, start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, netId: 0, source: "human" },
      { id: "t1", layer: "copperTop", width: 250_000, start: { x: 1, y: 0 }, end: { x: 2, y: 0 }, netId: 0, source: "human" },
    );
    expect(validatePcbBoardStructure(duplicates).length).toBeGreaterThan(0);
  });
});

// ─── §D — versioning ────────────────────────────────────────────────────────

describe("B11.3 §D — versioning", () => {
  it("the context is v2 and the capsule v3; older versions refuse EXPLICITLY", () => {
    expect(AGENT_REPLAY_CONTEXT_SCHEMA).toBe("sirkit.agent-replay-context.v2");
    expect(AGENT_REPLAY_CAPSULE_SCHEMA).toBe("sirkit.agent-replay-capsule.v3");
    const context = caseCapsule("e03-valid-board").context;
    for (const stale of ["sirkit.agent-replay-context.v1", "sirkit.agent-replay-context.v3"]) {
      const result = validateReplayContext({ ...context, schema: stale });
      expect(result.ok, stale).toBe(false);
      if (!result.ok) expect(result.issues[0], stale).toContain(AGENT_REPLAY_CONTEXT_SCHEMA);
    }
    const capsule = { ...caseCapsule("e03-valid-board"), schema: "sirkit.agent-replay-capsule.v2" } as unknown as ReplayCapsule;
    expect(validateReplayCapsule(capsule).length).toBeGreaterThan(0);
  });

  it("every committed capsule carries the current versions and its pinned digest", async () => {
    for (const evaluationCase of buildEvaluationCases(pins)) {
      expect(evaluationCase.capsule.schema, evaluationCase.caseId).toBe(AGENT_REPLAY_CAPSULE_SCHEMA);
      expect(evaluationCase.capsule.context.schema, evaluationCase.caseId).toBe(AGENT_REPLAY_CONTEXT_SCHEMA);
      expect(validateReplayCapsule(evaluationCase.capsule), evaluationCase.caseId).toEqual([]);
      const outcome = await replayCapsule(evaluationCase.capsule, { ...evaluationCase.options, computeOnly: true });
      expect(outcome.traceDigest, evaluationCase.caseId).toBe(pins[evaluationCase.caseId]);
    }
  });
});

// ─── §E — CI drift gates ────────────────────────────────────────────────────

describe("B11.3 §E / B11.4 §F — drift gates, fully in memory", () => {
  /**
   * [B11.4 §F] These proofs write NOTHING. B11.3 executed the CLI and, to
   * change a reachable PCB type, created `app/lib/pcb/__b113probe__.types.ts`
   * and rewrote the checked-in descriptor — repository paths, so an
   * interrupted run could leave the tree modified (B11.4 R7, and it did happen
   * once). Generation logic now lives in an importable, filesystem-pure
   * builder that accepts an IN-MEMORY SOURCE OVERLAY, so every mutation below
   * exists only as a string.
   */
  const productionSource = (): string =>
    readFileSync(join(ROOT, "app", "lib", "pcb", "types.ts"), "utf8").split("\r\n").join("\n");

  it("a fresh production generation matches the checked-in descriptor", () => {
    const result = comparePcbShapeDescriptor(readFileSync(DESCRIPTOR_FILE, "utf8"), { root: ROOT });
    expect(result.ok, result.ok ? "" : `${result.reason}: ${result.detail}`).toBe(true);
    if (result.ok) expect(result.summary).toContain("81 named types from 8 source files");
  }, 300_000);

  it("a candidate descriptor with ONE changed byte fails comparison", () => {
    const checkedIn = readFileSync(DESCRIPTOR_FILE, "utf8");
    // The candidate is a STRING; the checked-in file is never touched.
    const candidate = checkedIn.replace('"root":', '"root" :');
    expect(candidate).not.toBe(checkedIn);
    const result = comparePcbShapeDescriptor(candidate, { root: ROOT });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("drift");
    // A missing descriptor is also drift, with its own reason.
    const missing = comparePcbShapeDescriptor(null, { root: ROOT });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.reason).toBe("missing");
  }, 300_000);

  it("adding, removing, or changing a reachable PCB type changes generation", () => {
    const original = productionSource();
    const baseline = buildPcbShapeDescriptor({ root: ROOT }).content;
    expect(baseline).toBe(readFileSync(DESCRIPTOR_FILE, "utf8").split("\r\n").join("\n"));

    const moved: string[] = [];
    const mutations: Array<[string, string, string]> = [
      ["adding a nested property", "export interface PcbNet {\n  id: number;", "export interface PcbNet {\n  id: number;\n  b114DriftProbe?: string;"],
      ["changing optionality", "  stableId?: string;", "  stableId: string;"],
      ["changing a property type", "  formatVersion: 1;", "  formatVersion: 2;"],
      ["changing union membership", '  | { kind: "polygon"; points: Vec2[] };', '  | { kind: "polygon"; points: Vec2[] }\n  | { kind: "b114probe"; points: Vec2[] };'],
      ["removing a property", "  texts: BoardText[];", ""],
    ];
    for (const [label, from, to] of mutations) {
      expect(original, `${label}: probe anchor not found`).toContain(from);
      const mutated = original.replace(from, to);
      expect(mutated, `${label}: mutation was a no-op`).not.toBe(original);
      // IN-MEMORY overlay — no file is created, opened for writing, or removed.
      const candidate = buildPcbShapeDescriptor({ root: ROOT, overlay: { "app/lib/pcb/types.ts": mutated } }).content;
      expect(candidate, `${label} did not change generation`).not.toBe(baseline);
      moved.push(label);
    }
    expect(moved).toHaveLength(mutations.length);
    // A moved descriptor makes the checked-in file fail comparison — the two
    // halves together are "CI fails until regeneration".
    const withMutation = original.replace(mutations[0]![1], mutations[0]![2]);
    const compared = comparePcbShapeDescriptor(readFileSync(DESCRIPTOR_FILE, "utf8"), { root: ROOT, overlay: { "app/lib/pcb/types.ts": withMutation } });
    expect(compared.ok).toBe(false);
    if (!compared.ok) expect(compared.reason).toBe("drift");
  }, 900_000);

  it("no repository path is written: source and descriptor hashes are unchanged", () => {
    // Hashed at module load (before any test ran) and again here.
    expect(hashFile(join(ROOT, "app", "lib", "pcb", "types.ts"))).toBe(HASHES_AT_LOAD.types);
    expect(hashFile(DESCRIPTOR_FILE)).toBe(HASHES_AT_LOAD.descriptor);
    // Interruption cannot leave a probe file behind, because none is created.
    expect(existsSync(join(ROOT, "app", "lib", "pcb", "__b113probe__.types.ts"))).toBe(false);
    expect(existsSync(join(ROOT, "app", "lib", "pcb", "__b114probe__.types.ts"))).toBe(false);
    // This suite imports no writing primitive at all. (Asserting the import
    // line rather than scanning for a token keeps the check from matching its
    // own assertion text; the repository-wide scan lives in the B11.4 suite.)
    const own = readFileSync(join(ROOT, "app", "lib", "agent", "__tests__", "b11-3-generated-pcb-shape.test.ts"), "utf8");
    const fsImport = own.split(/\r?\n/).find((line) => line.startsWith("import") && line.includes("node:fs"));
    expect(fsImport).toBe('import { existsSync, readFileSync } from "node:fs";');
  });
});

// ─── §F — surrounding invariants ────────────────────────────────────────────

describe("B11.3 §F — surrounding invariants intact", () => {
  it("static exposure is still exactly ELEVEN read/propose tools", () => {
    const exposed = sirkitToolRegistry().list().filter((descriptor) => descriptor.agentExposed);
    expect(new Set(exposed.map((descriptor) => descriptor.toolId)).size).toBe(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.length); // B15.3: + sirkit.pcb.propose-bounded-edit
    for (const descriptor of exposed) expect(isAgentExposableDescriptor(descriptor), descriptor.toolId).toBe(true);
    for (const file of ["pcb-shape-projection.ts", "pcb-shape-types.ts", "replay-context.ts", "generated/pcb-shape-descriptor.ts"]) {
      const source = readFileSync(join(ROOT, "app", "lib", "agent", file), "utf8");
      expect(source, file).not.toMatch(/modelcontextprotocol|mcpServer|spawnAgent|multiAgent/i);
    }
  });

  it("the whole-context projection round-trip still governs every field", () => {
    const context = caseCapsule("e06c-selection-valid").context;
    const projectedContext = projectReplayContext(context);
    expect(projectedContext.ok).toBe(true);
    if (projectedContext.ok) expect(canonicalJson(projectedContext.value)).toBe(canonicalJson(context));
    expect(validateReplayContext(context).ok).toBe(true);
  });
});

// ─── adversarial review: the ARRAY blind spot ───────────────────────────────

describe("B11.3 — array containers carry only index properties", () => {
  /**
   * Found by adversarial review of B11.3 and reproduced before fixing. An own
   * property parked on an ARRAY (`nets.apiKey = "…"`) was invisible to every
   * gate: `findNonPlainJsonPath` and `findSecretShapedPath` returned early for
   * arrays, `JSON.stringify` and `canonicalJson` both walk arrays by index, and
   * `.map` in the projector dropped it — so the ROUND-TRIP compared two
   * documents that were equally blind to it. Worse, an ACCESSOR installed at an
   * array INDEX was read through `value.entries()`, which invokes the getter,
   * so the time-of-check/time-of-use refusal never fired and the board that
   * executed was not the board that was validated.
   */
  it("an own property attached to an ARRAY is refused at every gate", () => {
    const capsule = clone(caseCapsule("e03-valid-board"));
    (capsule.context.board!.nets as unknown as Rec).smuggled = { deep: 1 };
    expect(validateBoardShape(capsule.context.board).length).toBeGreaterThan(0);
    expect(validateReplayContext(capsule.context).ok).toBe(false);
    const issues = validateReplayCapsule(capsule);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.join(" ")).toContain("only index properties");
  });

  it("a credential parked on an ARRAY is refused, and never echoed", () => {
    const capsule = clone(caseCapsule("e03-valid-board"));
    (capsule.context.board!.nets as unknown as Rec).apiKey = FAKE_KEY;
    const issues = validateReplayCapsule(capsule);
    expect(issues.length).toBeGreaterThan(0);
    expect(JSON.stringify(issues)).not.toContain("AAAABBBB");
    // The independent second net sees it too.
    expect(findSecretShapedPath(capsule.context.board)).not.toBeNull();
  });

  it("an ACCESSOR at an array INDEX is refused BEFORE it can be re-read", async () => {
    const capsule = clone(caseCapsule("e03-valid-board"));
    const cleanTrack = clone(capsule.context.board!.tracks[0]!);
    let armed = false;
    Object.defineProperty(capsule.context.board!.tracks, 0, {
      get: () => (armed ? { ...cleanTrack, id: "forged-after-validation", width: 999_999 } : cleanTrack),
      enumerable: true,
      configurable: true,
    });
    const issues = validateReplayCapsule(capsule);
    armed = true;
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.join(" ")).toContain("must be a data property, not an accessor");
    await expect(replayCapsule(capsule, { computeOnly: true })).rejects.toThrow(ReplayCapsuleInvalidError);
  });

  it("function-valued, non-enumerable, symbol-keyed, sparse and foreign-prototype arrays refuse", () => {
    const withTracks = (mutate: (tracks: unknown[]) => unknown[] | void): Rec => {
      const board = createEmptyBoard() as unknown as Rec;
      const replaced = mutate(board.tracks as unknown[]);
      if (replaced) board.tracks = replaced;
      return board;
    };
    const probes: Array<[string, Rec]> = [
      ["function-valued", withTracks((tracks) => { (tracks as unknown as Rec).hook = () => "x"; })],
      ["non-enumerable", withTracks((tracks) => { Object.defineProperty(tracks, "hidden", { value: 1, enumerable: false }); })],
      ["symbol-keyed", withTracks((tracks) => { (tracks as unknown as Rec)[Symbol("s") as unknown as string] = 1; })],
      ["sparse", withTracks(() => { const sparse: unknown[] = []; sparse[3] = { id: "t", layer: "copperTop", width: 1, start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, netId: 0 }; return sparse; })],
      ["foreign prototype", withTracks((tracks) => { Object.setPrototypeOf(tracks, { poisoned: 1 }); })],
    ];
    for (const [label, board] of probes) {
      expect(findNonPlainJsonPath(board, "board"), label).not.toBeNull();
      const context = { ...caseCapsule("e03-valid-board").context, board };
      expect(validateReplayContext(context).ok, label).toBe(false);
    }
  });

  it("the blind spot is closed for EVERY array in the capsule, not only the board", () => {
    const onSteps = clone(caseCapsule("e03-valid-board"));
    (onSteps.steps as unknown as Rec).authorization = "Bearer AAAABBBBCCCCDDDDEEEE";
    expect(validateReplayCapsule(onSteps).length).toBeGreaterThan(0);

    const onSelection = clone(caseCapsule("e06c-selection-valid"));
    (onSelection.context.selection!.refs as unknown as Rec).password = "hunter2hunter2";
    expect(validateReplayCapsule(onSelection).length).toBeGreaterThan(0);

    const onSchematic = clone(caseCapsule("e07a-netlist-proven"));
    (onSchematic.context.schematic!.components as unknown as Rec).apiKey = FAKE_KEY;
    expect(validateReplayCapsule(onSchematic).length).toBeGreaterThan(0);

    const onNetlist = clone(caseCapsule("e07a-netlist-proven"));
    (onNetlist.context.netlist!.nets as unknown as Rec).zzStowaway = { deep: "carried" };
    expect(validateReplayCapsule(onNetlist).length).toBeGreaterThan(0);
  });

  it("exhausted traversal bounds REFUSE rather than validate partially", () => {
    const board = createEmptyBoard() as unknown as Rec;
    board.nets = Array.from({ length: PCB_PROJECTION_BOUNDS.maxArrayEntries + 1 }, (_, index) => ({ id: index, name: `n${index}` }));
    (board.outline as Rec).lateUnknown = 1;
    // After exhaustion the walk becomes a pass-through, so the round-trip alone
    // would be vacuous — the issue list is what refuses.
    const issues = validateBoardShape(board);
    expect(issues.length).toBeGreaterThan(0);
    expect(validateReplayContext({ ...caseCapsule("e03-valid-board").context, board }).ok).toBe(false);
  });

  it("honest arrays are untouched: all 19 capsules still validate and hit their pins", async () => {
    for (const evaluationCase of buildEvaluationCases(pins)) {
      expect(validateReplayCapsule(evaluationCase.capsule), evaluationCase.caseId).toEqual([]);
      const outcome = await replayCapsule(evaluationCase.capsule, { ...evaluationCase.options, computeOnly: true });
      expect(outcome.traceDigest, evaluationCase.caseId).toBe(pins[evaluationCase.caseId]);
    }
    expect(findSecretShapedPath({ nets: [{ id: 1, name: "SIG" }] })).toBeNull();
  });
});

// ─── probe helpers ──────────────────────────────────────────────────────────

function synthesizeNamed(id: string): unknown {
  return synthesize({ k: "ref", id });
}

/** A minimal legal `FootprintInstance`, optionally carrying one graphic. */
function synthesizeFootprint(graphic?: Rec): Rec {
  const instance = synthesizeNamed("app/lib/pcb/types.ts#FootprintInstance") as Rec;
  if (graphic) (instance.def as Rec).graphics = [graphic];
  return instance;
}


