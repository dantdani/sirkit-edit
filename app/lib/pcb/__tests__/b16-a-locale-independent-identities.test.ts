/**
 * B16-A review finding F8 — identities must not depend on the host locale.
 *
 * Every canonicalizer in the manufacturing release chain sorts object keys and
 * unordered arrays. When that sort was `String.prototype.localeCompare`, the
 * order — and therefore every digest, revision id, fixture key and archive
 * hash built on it — followed the host's ICU default collation (Lithuanian
 * puts `y` before `x`; nothing in CI pins a locale). The canonicalizers now use
 * `app/lib/stable-compare`, which consults nothing but code units.
 *
 * This suite (a) pins the comparator semantics and (b) proves the
 * identity-bearing canonicalizers are byte-identical with the real
 * `localeCompare`, with `localeCompare` forced to `lt-LT`, and with
 * `localeCompare` replaced by a throwing shim — i.e. they never call it.
 */
import { afterEach, describe, expect, it } from "vitest";
import { compareCodePoints, compareNatural } from "@/app/lib/stable-compare";
import { canonicalJson as atomicCanonicalJson } from "@/app/lib/atomic/stable";
import { durableWorkflowDigest, durableWorkflowJson } from "@/app/lib/durable-workflow/stable";
import { canonicalPhysicalBindingJson, physicalBindingDigest } from "@/app/lib/physical-binding/stable";
import { canonicalPublicationGraph, publicationSourceDigest } from "@/app/lib/pcb-sync/stable";
import { stableJson } from "../fab/native/stable";
import { canonicalEndpointSet } from "../integrity";
import { padSemanticKey } from "../pad-identity";
import { canonicalJson, pcbRevisionId } from "../revision";
import { createEmptyBoard, type FootprintInstance, type Pad, type PcbBoard } from "../types";
import { mmToNm } from "../units";

// ── comparator semantics ─────────────────────────────────────────────────────

describe("stable-compare: locale-free comparators", () => {
  it("compareCodePoints orders strictly by UTF-16 code unit (digits < upper < '_' < lower)", () => {
    const input = ["y", "x", "Z", "_a", "1", "a"];
    expect([...input].sort(compareCodePoints)).toEqual(["1", "Z", "_a", "a", "x", "y"]);
    // Identical to the engine's own comparator-less sort, which is code-unit order by spec.
    expect([...input].sort(compareCodePoints)).toEqual([...input].sort());
    // Antisymmetric, reflexive, and a total order on the sample.
    for (const a of input) for (const b of input) {
      expect(compareCodePoints(a, b) + compareCodePoints(b, a)).toBe(0);
      expect(Math.sign(compareCodePoints(a, b))).toBe(a === b ? 0 : a < b ? -1 : 1);
    }
  });

  it("compareNatural orders digit runs numerically and is a total order", () => {
    expect(["R10", "R2", "R1", "C1"].sort((a, b) => compareNatural(a, b))).toEqual(["C1", "R1", "R2", "R10"]);
    expect(["pin12", "pin7", "pin100", "pin7a"].sort((a, b) => compareNatural(a, b))).toEqual(["pin7", "pin7a", "pin12", "pin100"]);
    // Leading zeros compare as equal numerically, then the code-unit tie-break keeps the order total.
    expect(compareNatural("R007", "R7")).toBe(-1);
    expect(compareNatural("R7", "R007")).toBe(1);
    expect(compareNatural("R7", "R7")).toBe(0);
    // Shorter string first when one is a prefix of the other.
    expect(compareNatural("R1", "R1A")).toBe(-1);
  });

  it("compareNatural({ caseInsensitive }) folds case but never returns 0 for distinct strings", () => {
    expect(["r2", "R10", "R1", "c1"].sort((a, b) => compareNatural(a, b, { caseInsensitive: true }))).toEqual(["c1", "R1", "r2", "R10"]);
    expect(compareNatural("r1", "R1", { caseInsensitive: true })).toBe(1); // tie → code units: "R1" < "r1"
    expect(compareNatural("R1", "r1", { caseInsensitive: true })).toBe(-1);
    // Without folding, upper case sorts first (code-unit order), unlike ICU.
    expect(compareNatural("r1", "R1")).toBe(1);
  });
});

// ── identity-bearing canonicalizers ──────────────────────────────────────────

function pad(number: string, x: number): Pad {
  return { number, type: "smd", shape: { kind: "rect", width: mmToNm(1), height: mmToNm(1) }, at: { x: mmToNm(x), y: 0 }, rotationDeg: 0, layers: ["pasteTop", "copperTop", "maskTop"] };
}

function footprint(id: string, ref: string, padNets: Record<string, number>): FootprintInstance {
  return {
    id,
    ref,
    footprintId: "Locale:Probe",
    def: {
      libName: "Locale",
      name: "Probe",
      attributes: { smd: true, throughHole: false, excludeFromPos: false, excludeFromBom: false },
      // Deliberately NOT in canonical order: "10" vs "2" vs "A1" vs "a1" vs "_1" vs "1".
      pads: [pad("10", 3), pad("2", 1), pad("A1", 4), pad("a1", 5), pad("_1", 6), pad("1", 0)],
      graphics: [
        { kind: "line", layer: "silkTop", start: { x: 0, y: mmToNm(1) }, end: { x: mmToNm(1), y: mmToNm(1) }, width: mmToNm(0.1) },
        { kind: "line", layer: "silkTop", start: { x: 0, y: 0 }, end: { x: mmToNm(1), y: 0 }, width: mmToNm(0.1) },
      ] as FootprintInstance["def"]["graphics"],
      bodyBBox: { minX: 0, minY: 0, maxX: mmToNm(7), maxY: mmToNm(1) },
      models: [],
      rawSexpr: "",
    },
    at: { x: mmToNm(10), y: mmToNm(10) },
    rotationDeg: 0,
    side: "top",
    padNets,
  };
}

/** A board whose ids, keys and pad numbers mix case, digits and punctuation — where ICU and code-unit orders disagree. */
function probeBoard(): PcbBoard {
  const board = createEmptyBoard();
  board.nets = [
    { id: 0, name: "", stableId: "net:unconnected", endpointKeys: [] },
    { id: 3, name: "y", stableId: "net:y", endpointKeys: ["fp:Z:pad:1", "fp:a:pad:1"] },
    { id: 1, name: "x", stableId: "net:x", endpointKeys: ["fp:_x:pad:2", "fp:1:pad:2"] },
    { id: 2, name: "Z", stableId: "net:Z", endpointKeys: ["fp:a:pad:10", "fp:1:pad:10"] },
    { id: 4, name: "_", stableId: "net:_x", endpointKeys: [] },
    { id: 5, name: "1", stableId: "net:1", endpointKeys: [] },
  ];
  board.footprints = [
    footprint("fp:Z", "R10", { "1": 3, "2": 1, "10": 2 }),
    footprint("fp:a", "R2", { "1": 3, "10": 2 }),
    footprint("fp:_x", "r1", { "2": 1 }),
    footprint("fp:1", "C1", { "2": 1, "10": 2 }),
  ];
  board.tracks = ["t:y", "t:x", "t:Z", "t:_a", "t:1", "t:a"].map((id, index) => ({ id, layer: "copperTop", width: mmToNm(0.25), start: { x: mmToNm(index), y: 0 }, end: { x: mmToNm(index + 1), y: 0 }, netId: 1 }));
  board.vias = [
    { id: "v:b", at: { x: mmToNm(2), y: mmToNm(2) }, netId: 1, layers: ["copperTop", "copperBottom"], drill: mmToNm(0.4), size: mmToNm(0.8) },
    { id: "v:B", at: { x: mmToNm(3), y: mmToNm(3) }, netId: 1, layers: ["copperTop", "copperBottom"], drill: mmToNm(0.4), size: mmToNm(0.8) },
    { id: "v:_", at: { x: mmToNm(4), y: mmToNm(4) }, netId: 1, layers: ["copperTop", "copperBottom"], drill: mmToNm(0.4), size: mmToNm(0.8) },
  ];
  // Free-form semantic state with mixed-case keys, in deliberately scrambled insertion order.
  board.placementPreferences = { y: 1, Z: 2, a: 3, _x: 4, "1": 5, x: { y: true, Z: false, a: null, _x: [3, 1, 2], "1": "one" } } as unknown as PcbBoard["placementPreferences"];
  return board;
}

/** A plain document with the same key mix plus the unordered-set keys the durable / binding canonicalizers sort. */
const PROBE_DOCUMENT = {
  y: { Z: 1, a: 2, _x: 3, "1": 4, y: 5, x: 6 },
  Z: ["y", "x", "Z", "_a", "1", "a"],
  a: "a",
  _x: -0,
  "1": [{ y: 1, x: 2 }, { Z: 3, a: 4 }],
  x: null,
  evidenceRefs: ["y", "x", "Z", "_a", "1", "a", "ref:Z", "ref:a"],
  componentInstanceIds: ["U1", "u1", "U10", "U2", "_U", "1U"],
  assemblyVariantIds: ["v:y", "v:x", "v:Z"],
  hierarchyPath: ["root", "Root", "_root"],
} as const;

const PROBE_ENDPOINT_KEYS = ["y", "x", "Z", "_a", "1", "a", "x", "fp:Z:pad:1", "fp:a:pad:1", "fp:_x:pad:2", "fp:1:pad:2"];

function probeGraph() {
  return {
    components: [
      { componentInstanceId: "u1", referenceDesignator: "U1", hierarchyPath: ["root"], pins: [{ pinInstanceId: "u1:pin:10", pinNumber: "10" }, { pinInstanceId: "u1:pin:2", pinNumber: "2" }, { pinInstanceId: "u1:pin:A", pinNumber: "A" }, { pinInstanceId: "u1:pin:_", pinNumber: "_" }] },
      { componentInstanceId: "U1", referenceDesignator: "U1", hierarchyPath: ["root"], pins: [] },
      { componentInstanceId: "_u", referenceDesignator: "U2", hierarchyPath: ["root"], pins: [] },
      { componentInstanceId: "1u", referenceDesignator: "U3", hierarchyPath: ["root"], pins: [] },
    ],
    nets: [
      { stableNetId: "net:y", canonicalScope: ["root"], aliases: ["Y", "y", "_y"], members: [{ componentInstanceId: "u1", pinInstanceId: "u1:pin:10" }, { componentInstanceId: "u1", pinInstanceId: "u1:pin:2" }, { componentInstanceId: "U1", pinInstanceId: "U1:pin:1" }, { componentInstanceId: "_u", pinInstanceId: "_u:pin:1" }], explicitNoConnectPinIds: ["z", "Z", "_z"], constraintRefs: ["c:Z", "c:a", "c:_"] },
      { stableNetId: "net:Z", canonicalScope: ["root"], aliases: [], members: [], explicitNoConnectPinIds: [], constraintRefs: [] },
      { stableNetId: "net:_x", canonicalScope: ["root"], aliases: [], members: [], explicitNoConnectPinIds: [], constraintRefs: [] },
      { stableNetId: "net:1", canonicalScope: ["root"], aliases: [], members: [], explicitNoConnectPinIds: [], constraintRefs: [] },
      { stableNetId: "net:a", canonicalScope: ["root"], aliases: [], members: [], explicitNoConnectPinIds: [], constraintRefs: [] },
    ],
    prerequisiteIssues: [
      { code: "PS_b", scope: "board", message: "", stableIds: ["y", "x"], displayRefs: ["Y", "y"], evidenceRefs: ["Z", "a"], causedBy: ["_", "1"], blocking: false },
      { code: "PS_B", scope: "board", message: "", stableIds: ["Z", "_a"], displayRefs: [], evidenceRefs: [], causedBy: [], blocking: true },
      { code: "PS_a", scope: "board", message: "", stableIds: ["1", "a"], displayRefs: [], evidenceRefs: [], causedBy: [], blocking: true },
    ],
  } as unknown as Parameters<typeof canonicalPublicationGraph>[0];
}

/** Every representative identity, computed fresh from scrambled inputs. */
function computeIdentities(): Record<string, string> {
  return {
    boardCanonicalJson: canonicalJson(probeBoard()),
    boardRevision: pcbRevisionId(probeBoard()),
    padSemanticKeys: probeBoard().footprints[0]!.def.pads.map(padSemanticKey).join(" "),
    fabStableJson: stableJson(PROBE_DOCUMENT),
    fabStableJsonPretty: stableJson(PROBE_DOCUMENT, true),
    atomicCanonicalJson: atomicCanonicalJson(PROBE_DOCUMENT),
    durableJson: durableWorkflowJson(PROBE_DOCUMENT),
    durableDigest: durableWorkflowDigest(PROBE_DOCUMENT),
    physicalBindingJson: canonicalPhysicalBindingJson(PROBE_DOCUMENT),
    physicalBindingDigest: physicalBindingDigest(PROBE_DOCUMENT),
    publicationGraph: JSON.stringify(canonicalPublicationGraph(probeGraph())),
    publicationSourceDigest: publicationSourceDigest(probeGraph()),
    endpointSet: canonicalEndpointSet(PROBE_ENDPOINT_KEYS).join(" "),
  };
}

type LocaleCompare = typeof String.prototype.localeCompare;
const REAL_LOCALE_COMPARE: LocaleCompare = String.prototype.localeCompare;

function withLocaleCompare<T>(shim: LocaleCompare, run: () => T): T {
  String.prototype.localeCompare = shim;
  try { return run(); } finally { String.prototype.localeCompare = REAL_LOCALE_COMPARE; }
}

/** Forces the Lithuanian collation (y < x) whatever the host default is. */
const lithuanianLocaleCompare: LocaleCompare = function (this: string, that: string, _locales?: string | string[], options?: Intl.CollatorOptions) {
  return REAL_LOCALE_COMPARE.call(this, that, "lt-LT", options);
};

describe("identity-bearing canonicalizers are independent of String.prototype.localeCompare", () => {
  afterEach(() => { String.prototype.localeCompare = REAL_LOCALE_COMPARE; });

  it("premise: the lt-LT shim really reorders what bare localeCompare would sort", () => {
    // Default (root/en) collation puts x before y; Lithuanian puts y before x.
    const forced = withLocaleCompare(lithuanianLocaleCompare, () => ["x", "y"].sort((a, b) => a.localeCompare(b)));
    expect(forced).toEqual(["y", "x"]);
    // And the canonical forms actually exercise the sort: key order is not insertion order.
    const json = canonicalJson(probeBoard());
    const positions = ['"1":', '"Z":', '"_x":', '"a":', '"x":', '"y":'].map((key) => json.indexOf(key, json.indexOf("placementPreferences")));
    expect(positions.every((position) => position > 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("every identity is byte-identical with the real localeCompare, under lt-LT, and with localeCompare throwing", () => {
    const real = computeIdentities();
    const lithuanian = withLocaleCompare(lithuanianLocaleCompare, computeIdentities);
    expect(lithuanian).toEqual(real);

    let invoked = 0;
    const throwing: LocaleCompare = function (this: string) { invoked += 1; throw new Error("localeCompare must not be reached by an identity-bearing canonicalizer"); };
    const withoutLocaleCompare = withLocaleCompare(throwing, computeIdentities);
    expect(invoked).toBe(0);
    expect(withoutLocaleCompare).toEqual(real);

    // Sanity: the identities are real strings of the expected shapes.
    expect(real.boardRevision).toMatch(/^pcb2-[0-9a-f]{16}$/);
    expect(real.durableDigest).toMatch(/^dw1-[0-9a-f]{64}$/);
    expect(real.physicalBindingDigest).toMatch(/^pb1-[0-9a-f]{64}$/);
    expect(real.publicationSourceDigest).toMatch(/^pb1-[0-9a-f]{64}$/);
  });

  it("the canonical forms are in code-unit order, not ICU order", () => {
    // Object keys.
    expect(Object.keys(JSON.parse(atomicCanonicalJson(PROBE_DOCUMENT)) as object)).toEqual(["1", "Z", "_x", "a", "assemblyVariantIds", "componentInstanceIds", "evidenceRefs", "hierarchyPath", "x", "y"]);
    expect(Object.keys(JSON.parse(stableJson(PROBE_DOCUMENT)) as object)).toEqual(["1", "Z", "_x", "a", "assemblyVariantIds", "componentInstanceIds", "evidenceRefs", "hierarchyPath", "x", "y"]);
    // Unordered-set arrays (durable-workflow / physical-binding) sort their JSON forms by code unit.
    const durable = JSON.parse(durableWorkflowJson(PROBE_DOCUMENT)) as typeof PROBE_DOCUMENT;
    expect(durable.evidenceRefs).toEqual(["1", "Z", "_a", "a", "ref:Z", "ref:a", "x", "y"]);
    expect(durable.componentInstanceIds).toEqual(["1U", "U1", "U10", "U2", "_U", "u1"]);
    const binding = JSON.parse(canonicalPhysicalBindingJson(PROBE_DOCUMENT)) as typeof PROBE_DOCUMENT;
    expect(binding.evidenceRefs).toEqual(["1", "Z", "_a", "a", "ref:Z", "ref:a", "x", "y"]);
    expect(binding.hierarchyPath).toEqual(["Root", "_root", "root"]);
    // Endpoint sets, board net order, and the published graph.
    expect(canonicalEndpointSet(PROBE_ENDPOINT_KEYS)).toEqual(["1", "Z", "_a", "a", "fp:1:pad:2", "fp:Z:pad:1", "fp:_x:pad:2", "fp:a:pad:1", "x", "y"]);
    const graph = canonicalPublicationGraph(probeGraph());
    expect(graph.components.map((component) => component.componentInstanceId)).toEqual(["1u", "U1", "_u", "u1"]);
    expect(graph.components[3]!.pins.map((pin) => pin.pinInstanceId)).toEqual(["u1:pin:10", "u1:pin:2", "u1:pin:A", "u1:pin:_"]);
    expect(graph.nets.map((net) => net.stableNetId)).toEqual(["net:1", "net:Z", "net:_x", "net:a", "net:y"]);
    expect(graph.nets[4]!.members.map((member) => member.pinInstanceId)).toEqual(["U1:pin:1", "_u:pin:1", "u1:pin:10", "u1:pin:2"]);
    expect(graph.prerequisiteIssues.map((issue) => issue.code)).toEqual(["PS_B", "PS_a", "PS_b"]);
  });
});
