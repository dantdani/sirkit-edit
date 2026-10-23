/**
 * [PR-J4, 2026-10-23] Runbook section J increment 4 (J.4 scoped connections, J.5 "supported SPICE generation ... must consume the whole
 * design"; OD-258 item 1): the Theory SPICE deck (app/lib/netlist.ts schematicToSpice, behind POST /api/simulate) of a project
 * organised into sheets is built on THE project connectivity (app/lib/spice/project-nodes.ts), never on a cross-sheet coordinate union.
 *
 *  1. GOLDEN: a single-sheet document's deck object is byte-identical to before section J (the j1-sheet-operations spiceSha pins
 *     re-asserted here, plus the Studio's divider), and it carries no `warnings` key.
 *  2. Isomorphism ("simulates identically"): a flat two-subsystem Theory circuit and its planMoveToSheet split give decks whose
 *     element lines are equal under the node bijection derived from `pinNodes` per pin, with 0 fixed; the crossing net is the port's node.
 *  3. Scoping: two sheets' local OUT labels are two nodes; identical coordinates on two sheets are two nodes; a hierarchical port joins
 *     exactly its pins; a +3V3 rail on three sheets is one node.
 *  4. Ground, the strict rule: AGND and DGND stay separate named nodes with a deck comment and a response warning each while node 0 is
 *     the GND rail; a lone AGND design simulates with AGND as node 0 (warned); several ground rails with none named GND refuse
 *     SIM_GROUND_AMBIGUOUS naming them (GND and 0 as two rails too); a plain GND label on a child sheet is a local node named in a warning.
 *  5. Refusals: a missing port, a hierarchy cycle, a dangling sheet reference and sheet references without a tree refuse
 *     SIM_SHEET_HIERARCHY_INVALID (structured); nothing is guessed.
 *  6. Probe keys: a child sheet's points are keyed "<sheetId>|x,y" and the root's bare; `probeSheetId` makes that sheet's points bare and
 *     the root's "root|x,y"; an unknown probe sheet falls back to the root with a warning.
 * Pure / in-memory: no network, no process, no randomness.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { pinWorldPos, pointKey } from "@/app/lib/geometry";
import { schematicToSpice, SIM_GROUND_AMBIGUOUS, SIM_SHEET_HIERARCHY_INVALID } from "@/app/lib/netlist";
import { spiceProbeKey } from "@/app/lib/spice/project-nodes";
import { sheetOf } from "@/app/lib/schematic/sheets";
import { PIN_NAMES, ROOT_SHEET_ID, type SchematicState } from "@/lib/schematic-types";
import { theoryLegacyFixture } from "../schematic/__tests__/_j1-fixtures";
import { dividerSchematic } from "../spice/__tests__/fixtures";
import { comp, label, LOAD_SHEET_ID, pin, railsAndReturnsTheory, sheet, splitTwoSubsystemTheory, tree, wire } from "../spice/__tests__/_j4-fixtures";

const sha = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Node of a Theory pin in a deck's probe map (bare on the probe sheet, scoped elsewhere). */
const nodeOf = (deck: ReturnType<typeof schematicToSpice>, state: SchematicState, id: string, pinName: string, probeSheetId = ROOT_SHEET_ID): string | undefined => {
  const component = state.components.find((item) => item.id === id)!;
  return deck.pinNodes[spiceProbeKey(sheetOf(component), pinWorldPos(component, pinName), probeSheetId)];
};
/** The deck without its comment lines. */
const body = (netlist: string): string[] => netlist.split("\n").filter((line) => !line.startsWith("*"));
const ELEMENT = /^[RCLDVI][A-Z0-9_]*$/;

// ── 1. golden ────────────────────────────────────────────────────────────────────────────────────────────────────────────

describe("[PR-J4] 1. a single-sheet document's deck is byte-identical to before section J and carries no warnings key", () => {
  it.each([
    ["theory (j1-sheet-operations GOLDEN)", theoryLegacyFixture, "17ffd2d3f6d45366a52a56e5c7a598dbe8e8d9efa02f954b89407e7a7a1b44b7"],
    ["the Studio divider", dividerSchematic, "5b5a7dd0f2556f8ca220d95157bde373e30ff026db8ea9ef89d26dd2d1caa8e3"],
  ] as const)("%s", (_name, make, digest) => {
    const deck = schematicToSpice(make());
    expect(sha(deck)).toBe(digest);
    expect("warnings" in deck).toBe(false);
    expect(Object.keys(deck)).toEqual(["netlist", "nodeMap", "pinNodes"]);
    // a probeSheetId on a single-sheet call changes nothing (the legacy body ignores it)
    expect(sha(schematicToSpice(make(), { probeSheetId: "anything" }))).toBe(digest);
  });
});

// ── 2. isomorphism ───────────────────────────────────────────────────────────────────────────────────────────────────────

describe("[PR-J4] 2. a design organised into sheets simulates identically to its flat original: deck isomorphism under a node relabelling", () => {
  it("the two-subsystem Theory circuit and its planMoveToSheet split: every element line equal under the pin-derived bijection, 0 fixed", () => {
    const { flat, split, portName } = splitTwoSubsystemTheory();
    expect(split.sheets!.sheets.map((item) => item.id)).toEqual([ROOT_SHEET_ID, LOAD_SHEET_ID]);
    expect(split.components.filter((item) => item.sheetId === LOAD_SHEET_ID).map((item) => item.id).sort()).toEqual(["D1", "G3", "R3"]);
    const flatDeck = schematicToSpice(flat);
    const splitDeck = schematicToSpice(split);
    expect(splitDeck.warnings).toEqual([]);
    expect(splitDeck.netlist.split("\n")[1]).toBe("* Project connectivity: 2 sheets; nodes named from project nets (sheet-local nets by sheet path, rails by exact name)");

    // the bijection: flat node -> split node, one per pin, consistent both ways, 0 fixed
    const forward = new Map<string, string>();
    const backward = new Map<string, string>();
    for (const component of split.components) {
      for (const pinName of PIN_NAMES[component.type] ?? []) {
        const point = pinWorldPos(component, pinName);
        const before = flatDeck.pinNodes[pointKey(point)];
        const after = splitDeck.pinNodes[spiceProbeKey(sheetOf(component), point, ROOT_SHEET_ID)];
        expect(before, `${component.id}.${pinName} flat`).toBeDefined();
        expect(after, `${component.id}.${pinName} split`).toBeDefined();
        expect(forward.get(before!) ?? after).toBe(after);
        expect(backward.get(after!) ?? before).toBe(before);
        forward.set(before!, after!);
        backward.set(after!, before!);
      }
    }
    expect(forward.get("0")).toBe("0");
    expect(forward.size).toBe(new Set(forward.values()).size);
    // the crossing net is the port's node on the split deck
    expect([...forward.values()]).toContain(portName);
    expect(flatDeck.netlist).not.toContain(` ${portName} `);

    // every line equal after relabelling the flat deck's element nodes (comments aside: the split deck says what it is built on)
    const relabelled = body(flatDeck.netlist).map((line) => {
      const tokens = line.split(" ");
      if (!ELEMENT.test(tokens[0] ?? "") || tokens.length < 3) return line;
      return [tokens[0], forward.get(tokens[1]!) ?? `?${tokens[1]}`, forward.get(tokens[2]!) ?? `?${tokens[2]}`, ...tokens.slice(3)].join(" ");
    });
    expect(relabelled).toEqual(body(splitDeck.netlist));
    expect(relabelled.filter((line) => ELEMENT.test(line.split(" ")[0] ?? ""))).toHaveLength(5); // V1 R1 R2 R3 D1 (the ground symbols emit nothing)
    expect(body(splitDeck.netlist)).toContain(".model D1N4148 D(IS=2.52e-9 N=1.752)");
  });

  it("the same split deck is produced from the same document twice (no randomness) and differs from the flat deck only in node names", () => {
    const { split } = splitTwoSubsystemTheory();
    expect(schematicToSpice(split)).toEqual(schematicToSpice(split));
  });
});

// ── 3. scoping ───────────────────────────────────────────────────────────────────────────────────────────────────────────

describe("[PR-J4] 3. local labels and coordinates connect on their own sheet only; rails by exact name; ports by identity", () => {
  it("two sheets' local OUT labels are two nodes (A_OUT, B_OUT); +3V3 on three sheets is one node", () => {
    const state = railsAndReturnsTheory("strict");
    const deck = schematicToSpice(state);
    expect(nodeOf(deck, state, "R4", "right")).toBe("A_OUT");
    expect(nodeOf(deck, state, "R5", "right")).toBe("B_OUT");
    expect([nodeOf(deck, state, "R1", "left"), nodeOf(deck, state, "R2", "left"), nodeOf(deck, state, "R3", "left")]).toEqual(["+3V3", "+3V3", "+3V3"]);
    expect(nodeOf(deck, state, "V1", "+")).toBe("+3V3");
    expect(deck.netlist).toMatch(/^R4 N\d{3} A_OUT 4k$/m); // R4's free pin is an unnamed net: N001.. in net-identity order
  });

  it("identical coordinates on two sheets are two nodes (never one), and the free pins of R2 on sheet A and R3 on sheet B differ", () => {
    const state = railsAndReturnsTheory("strict");
    // R2 (sheet A) and R4 (sheet A) sit where R3 / R5 sit on sheet B: same x,y, different sheets
    const deck = schematicToSpice(state);
    expect(deck.pinNodes["sa|430,170"]).toBeDefined();
    expect(deck.pinNodes["sb|430,170"]).toBeDefined();
    expect(deck.pinNodes["sa|430,170"]).not.toBe(deck.pinNodes["sb|430,170"]);
    expect(deck.pinNodes["sa|170,170"]).toBe("+3V3");
    expect(deck.pinNodes["sb|170,300"]).toBe("+3V3");
    // the unnamed free pins take N001.. in net-identity order: distinct names
    const unnamed = Object.values(deck.pinNodes).filter((name) => /^N\d{3}$/.test(name));
    expect(new Set(unnamed).size).toBe(unnamed.length);
  });

  it("a hierarchical port joins exactly the pins it binds; a same-named local label elsewhere stays apart", () => {
    const r1 = comp("R1", "resistor", 100, 100);
    const r3 = comp("R3", "resistor", 100, 300);
    const r2 = comp("R2", "resistor", 100, 100, "1k", "adc");
    const v1 = comp("V1", "voltage-source", 300, 500, "5");
    const g1 = comp("G1", "ground", 300, 580, "");
    const state: SchematicState = {
      components: [r1, r3, r2, v1, g1],
      wires: [wire("w1", [pin(r1, "right"), { x: 300, y: 100 }]), wire("w2", [pin(r2, "right"), { x: 300, y: 100 }], "adc"), wire("w3", [pin(r3, "right"), { x: 300, y: 300 }]), wire("wg", [pin(v1, "-"), pin(g1, "pin")])],
      netLabels: [
        label("pin-sig", "SIG", { x: 300, y: 100 }, { scope: "sheet-pin", portId: "p-sig", childSheetId: "adc" }),
        label("h-sig", "SIG", { x: 300, y: 100 }, { sheetId: "adc", scope: "hierarchical", portId: "p-sig" }),
        label("l-loc", "LOC", { x: 300, y: 300 }),
      ],
      sheets: tree(sheet("adc", "ADC", ROOT_SHEET_ID, { block: { x: 400, y: 50, width: 200, height: 100 }, ports: [{ id: "p-sig", name: "SIG", direction: "input" }] })),
    };
    const deck = schematicToSpice(state);
    const port = nodeOf(deck, state, "R1", "right");
    expect(port).toBe("SIG");
    expect(port).toBe(nodeOf(deck, state, "R2", "right"));
    expect(nodeOf(deck, state, "R3", "right")).toBe("LOC");
    expect(deck.pinNodes["adc|300,100"]).toBe("SIG");
    expect(deck.pinNodes["300,100"]).toBe("SIG");
    expect(deck.pinNodes["300,300"]).toBe("LOC");
    // a plain SIG label on another overview net would be two nets named SIG: the authority's collision error refuses the deck (never a join by name)
    const shadowed: SchematicState = { ...state, netLabels: state.netLabels!.map((item) => (item.id === "l-loc" ? { ...item, name: "SIG" } : item)) };
    expect(() => schematicToSpice(shadowed)).toThrow(new RegExp(`^${SIM_SHEET_HIERARCHY_INVALID}: .*SHEET_NET_NAME_COLLISION: 2 different nets are all named SIG`));
  });
});

// ── 4. ground ────────────────────────────────────────────────────────────────────────────────────────────────────────────

describe("[PR-J4] 4. ground under the strict rule (OD-258 item 1): node 0 is the GND rail; other returns stay named and warned", () => {
  it("AGND and DGND are separate named nodes with a deck comment and a warning each; node 0 is the ground symbol's GND rail", () => {
    const state = railsAndReturnsTheory("strict");
    const deck = schematicToSpice(state);
    expect(nodeOf(deck, state, "V1", "-")).toBe("0");
    expect(nodeOf(deck, state, "R1", "right")).toBe("AGND");
    expect(nodeOf(deck, state, "R2", "right")).toBe("DGND");
    expect(deck.netlist).toContain("* separate return AGND is not node 0; tie it explicitly if it should be");
    expect(deck.netlist).toContain("* separate return DGND is not node 0; tie it explicitly if it should be");
    expect(deck.warnings).toEqual([
      "The ground rail AGND is a separate return and not node 0 (node AGND); tie it to the GND rail explicitly if the two returns are one.",
      "The ground rail DGND is a separate return and not node 0 (node DGND); tie it to the GND rail explicitly if the two returns are one.",
    ]);
    expect(body(deck.netlist)).toContain("R1 +3V3 AGND 1k");
    expect(body(deck.netlist)).toContain("R2 +3V3 DGND 2k");
    expect(deck.nodeMap).toEqual(expect.objectContaining({}));
    expect(Object.values(deck.nodeMap)).toEqual(expect.arrayContaining(["0", "AGND", "DGND", "+3V3", "A_OUT", "B_OUT"]));
  });

  it("a lone AGND rail (no GND, no ground symbol) is node 0, with a deck comment and a warning", () => {
    const state = railsAndReturnsTheory("lone");
    const deck = schematicToSpice(state);
    expect(nodeOf(deck, state, "R1", "right")).toBe("0");
    expect(deck.warnings).toEqual(["Node 0 is the ground rail AGND: the project's only ground rail (no rail is named GND)."]);
    expect(deck.netlist).toContain("* node 0 is the ground rail AGND (the project's only ground rail; no rail is named GND)");
    expect(Object.values(deck.nodeMap)).not.toContain("AGND");
  });

  it("several ground rails with none named GND refuse SIM_GROUND_AMBIGUOUS naming them; GND and 0 as two rails refuse too", () => {
    expect(() => schematicToSpice(railsAndReturnsTheory("ambiguous"))).toThrow(new RegExp(`^${SIM_GROUND_AMBIGUOUS}: 2 ground rails and none is named GND \\(AGND on the overview; DGND on sheet "A"\\): name the reference return GND \\(or 0\\), or tie them explicitly; nothing was simulated$`));
    const state = railsAndReturnsTheory("strict");
    state.netLabels!.push(label("l-zero", "0", pin(state.components.find((item) => item.id === "R3")!, "right"), { kind: "ground", sheetId: "sb" }));
    expect(() => schematicToSpice(state)).toThrow(new RegExp(`^${SIM_GROUND_AMBIGUOUS}: 2 different ground rails could each be node 0 \\(0 on sheet "B"; GND on the overview\\)`));
  });

  it("a plain kind-label GND on a child sheet is a LOCAL net (node A_GND, not 0) and is named in a warning", () => {
    const state = railsAndReturnsTheory("strict");
    const r4 = state.components.find((item) => item.id === "R4")!;
    state.netLabels = state.netLabels!.filter((item) => item.id !== "l-out-a");
    state.netLabels.push(label("l-plain-gnd", "GND", pin(r4, "right"), { sheetId: "sa" }));
    const deck = schematicToSpice(state);
    expect(nodeOf(deck, state, "R4", "right")).toBe("A_GND");
    expect(nodeOf(deck, state, "V1", "-")).toBe("0");
    expect(deck.warnings).toContain('The plain label GND on sheet "A" is a local net (node A_GND), not node 0: a label of kind "label" never is the ground rail. Use a ground symbol or a ground-kind label for the reference return.');
  });

  it("a plain GND label on the overview beside a ground symbol is a name collision: refused SIM_SHEET_HIERARCHY_INVALID, never joined", () => {
    const state = railsAndReturnsTheory("strict");
    const r1 = state.components.find((item) => item.id === "R1")!;
    state.netLabels = state.netLabels!.filter((item) => item.id !== "l-agnd");
    state.netLabels.push(label("l-plain-gnd-root", "GND", pin(r1, "right")));
    expect(() => schematicToSpice(state)).toThrow(new RegExp(`^${SIM_SHEET_HIERARCHY_INVALID}: .*SHEET_NET_NAME_COLLISION: 2 different nets are all named GND`));
  });
});

// ── 5. refusals ──────────────────────────────────────────────────────────────────────────────────────────────────────────

describe("[PR-J4] 5. a structural error refuses SIM_SHEET_HIERARCHY_INVALID (structured): nothing is guessed", () => {
  const cases: Array<[string, (state: SchematicState) => SchematicState, RegExp]> = [
    ["a hierarchical label whose port does not exist", (state) => ({ ...state, netLabels: [...state.netLabels!, label("h-x", "X", { x: 600, y: 600 }, { sheetId: "sa", scope: "hierarchical", portId: "no-such-port" })] }), /SHEET_PIN_PORT_MISSING|SHEET_PORT_MISSING|no-such-port/],
    ["a hierarchy cycle", (state) => ({ ...state, sheets: { version: 1, sheets: [sheet(ROOT_SHEET_ID, "Overview", null), sheet("sa", "A", "sb"), sheet("sb", "B", "sa")] } }), /CYCLE|cycle|parent/i],
    ["a dangling sheet reference", (state) => ({ ...state, components: state.components.map((item) => (item.id === "R4" ? { ...item, sheetId: "ghost" } : item)) }), /ghost/],
    ["sheet references without a tree", (state) => { const copy = { ...state }; delete copy.sheets; return copy; }, /SHEET/],
  ];
  it.each(cases)("%s", (_name, mutate, detail) => {
    const broken = mutate(railsAndReturnsTheory("strict"));
    let message = "";
    try { schematicToSpice(broken); } catch (error) { message = (error as Error).message; }
    expect(message).toMatch(new RegExp(`^${SIM_SHEET_HIERARCHY_INVALID}: the sheet structure of this project has \\d+ error\\(s\\): `));
    expect(message).toMatch(detail);
    expect(message).toMatch(/nothing was simulated$/);
  });
});

// ── 6. probe keys ────────────────────────────────────────────────────────────────────────────────────────────────────────

describe("[PR-J4] 6. probe keys: bare on the probe sheet (the root by default), \"<sheetId>|x,y\" elsewhere", () => {
  it("a child sheet's points are scoped and the root's bare; with probeSheetId the child's are bare and the root's scoped; wire vertices follow", () => {
    const state = railsAndReturnsTheory("strict");
    const byDefault = schematicToSpice(state);
    expect(byDefault.pinNodes["170,170"]).toBe("+3V3"); // R1.left on the overview
    expect(byDefault.pinNodes["sa|170,170"]).toBe("+3V3"); // R2.left on sheet A, same coordinates
    expect(byDefault.pinNodes["sa|230,170"]).toBe("DGND");
    expect(byDefault.pinNodes["100,240"]).toBe("0"); // the ground symbol's pin through the wire
    expect(Object.keys(byDefault.pinNodes).filter((key) => key.startsWith("root|"))).toEqual([]);
    const onA = schematicToSpice(state, { probeSheetId: "sa" });
    expect(onA.pinNodes["170,170"]).toBe("+3V3"); // now R2.left
    expect(onA.pinNodes["230,170"]).toBe("DGND");
    expect(onA.pinNodes["root|230,170"]).toBe("AGND"); // R1.right on the overview, scoped now
    expect(onA.pinNodes["root|100,240"]).toBe("0");
    expect(onA.pinNodes["sb|230,300"]).toBeDefined();
    expect(onA.warnings).toEqual(byDefault.warnings);
    expect(body(onA.netlist)).toEqual(body(byDefault.netlist)); // the deck itself never depends on the probe sheet
    const unknown = schematicToSpice(state, { probeSheetId: "zzz" });
    expect(unknown.pinNodes).toEqual(byDefault.pinNodes);
    expect(unknown.warnings).toContain("The probe sheet zzz is not a sheet of this project: the overview's points are keyed bare.");
  });

  it("the probe map of a sheeted deck covers every Theory pin exactly once and only wire vertices that lie on a net", () => {
    const { split } = splitTwoSubsystemTheory();
    const deck = schematicToSpice(split);
    const pins = split.components.flatMap((component) => (PIN_NAMES[component.type] ?? []).map((name) => spiceProbeKey(sheetOf(component), pinWorldPos(component, name), ROOT_SHEET_ID)));
    for (const key of pins) expect(deck.pinNodes[key], key).toBeDefined();
    for (const w of split.wires) for (const vertex of w.vertices) expect(deck.pinNodes[spiceProbeKey(sheetOf(w), vertex, ROOT_SHEET_ID)], `${w.id} ${pointKey(vertex)}`).toBeDefined();
    expect(Object.values(deck.pinNodes)).not.toContain("N???");
  });
});
