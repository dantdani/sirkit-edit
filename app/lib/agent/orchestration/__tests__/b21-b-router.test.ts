/**
 * [B21 B] The deterministic task-complexity router (OD-110): policy BEFORE any model judgment. Every runbook branch
 * (B21-B :805-811) with three phrasings; a Tier 3 ask (each family word of `TIER3_FAMILY_PATTERN`) refused; a 3D/view request,
 * a plain question and a direct Tier 1 command (the explicit-request grammar's own examples) single; the fact gates (board,
 * schematic, role, selection); determinism (same input, identical output; the module text carries no clock, no randomness, no
 * environment read); no tool id anywhere in the router; the role lists pinned as data.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TIER1_EXECUTE_ROLES, TIER3_FAMILY_PATTERN } from "@/app/lib/engineering/permission-tiers";
import { routeComposerMessage } from "@/app/lib/project/composer-routing";
import { SPECIALIST_ROLES } from "../contracts";
import { DAG_ROLE_LISTS, FULL_CIRCUIT_RUNBOOK_ROLES, FULL_CIRCUIT_TRIM, ROUTER_RULES, TIER3_FAMILIES, TIER3_REFUSAL_SENTENCE, normalizeRouterMessage, routeTaskComplexity, type RouterFacts } from "../router";
import { SPECIALIST_CAPS } from "../scheduler";

const ROUTER = "app/lib/agent/orchestration/router.ts";
const FACTS: RouterFacts = Object.freeze({ hasSchematic: true, hasBoard: true, actorRole: "pcb_editor", autonomyMode: "proposal_only", selectionCount: 0 });
const facts = (over: Partial<RouterFacts> = {}): RouterFacts => ({ ...FACTS, ...over });
const route = (text: string, over: Partial<RouterFacts> = {}) => routeTaskComplexity(text, facts(over));

/** three phrasings per Tier 3 family word of the tiers' pattern (release|publish|publica|upload|order|purchas|qualif|ship|deliver) */
const TIER3_PHRASINGS: Record<string, readonly string[]> = {
  release: ["Release the board to manufacturing.", "please release rev 3 to the fab", "Can you release this design now?"],
  publish: ["Publish the schematic to the library.", "Please publish this revision.", "publish it"],
  publication: ["Start the publication of rev 3 to the shared library.", "Submit the publication for this board.", "Kick off a publication of the design."],
  upload: ["Upload the Gerbers to JLCPCB.", "please upload the fab package", "Upload this board."],
  order: ["Order 10 boards from the fab.", "Place an order for the assembled boards.", "please order 5 prototypes"],
  purchase: ["Purchase the BOM from Digi-Key.", "Buy the parts for this build.", "Please purchase 20 of the regulators."],
  qualify: ["Qualify the design for production.", "Run the qualification for this board.", "please qualify rev 3"],
  ship: ["Ship the boards to the customer.", "Please ship it today.", "ship the assembled units"],
  deliver: ["Deliver the Gerbers to the fab.", "Please deliver the package to manufacturing.", "deliver the boards"],
};
const VIEW_PHRASINGS = [
  "Open the 3D view, hide the top silkscreen, focus on J1, and switch to an isometric view.",
  "Show me the board in 3D and focus on U1.",
  "Switch the 3D preview to the isometric camera and hide the bottom copper.",
];
const QUESTION_PHRASINGS = ["What does R1 connect to?", "How many vias are on the VCC net?", "Is C3 a decoupling capacitor for U2?"];
/** the explicit-request grammar's own examples (app/lib/engineering/explicit-request.ts) */
const EXPLICIT_PHRASINGS = ["Move R3 2 mm to the right.", "rotate U1 90 degrees clockwise", "Flip C3 onto the bottom.", "undo", "redo the last change", "Put R2 onto the bottom layer."];
const REPLACEMENT_PHRASINGS = [
  "Delete U1 and replace it with the approved lower-power part while preserving compatible nets.",
  "Swap U1 for a lower-power alternative.",
  "Substitute the 555 timer with a CMOS version of the chip.",
];
const FULL_CIRCUIT_PHRASINGS = ["Design a 555 timer LED blinker.", "Create a complete circuit for a USB-powered temperature logger.", "Build me a 5V buck converter board."];
const READINESS_PHRASINGS = ["Is this board ready for manufacturing?", "Review the PCB for manufacturability before I send it out.", "Run a DFM check on the layout."];
const PCB_PHRASINGS = ["Compact the placement and reroute the affected traces.", "Optimize the routing on the bottom layer.", "Tidy up the layout of the whole board."];
const SCHEMATIC_PHRASINGS = ["Rework the input filter stage to reject 50 Hz noise.", "Simplify the bias network around Q1.", "Redesign the regulator circuit for a lower dropout."];

describe("[B21 B] the task-complexity router", () => {
  it("1. a Tier 3 ask is REFUSED with the fixed sentence and no other plan: three phrasings for each family word of TIER3_FAMILY_PATTERN; every family word matches the tiers' pattern and every stem of that pattern is covered by a family word; a Tier 3 word inside another ask never refuses", () => {
    for (const [family, phrasings] of Object.entries(TIER3_PHRASINGS)) {
      for (const text of phrasings) {
        expect(route(text), text).toEqual({ kind: "refused", rule: `T3-${family}`, reason: TIER3_REFUSAL_SENTENCE });
      }
    }
    expect(TIER3_FAMILIES.map((entry) => entry.family)).toEqual(Object.keys(TIER3_PHRASINGS));
    for (const entry of TIER3_FAMILIES) for (const word of entry.words) expect(word, `${entry.family}: ${word}`).toMatch(TIER3_FAMILY_PATTERN);
    const stems = /^\((.*)\)$/.exec(TIER3_FAMILY_PATTERN.source)![1]!.split("|");
    expect(stems.length).toBeGreaterThanOrEqual(9);
    for (const stem of stems) expect(TIER3_FAMILIES.some((entry) => entry.words.some((word) => word.startsWith(stem))), stem).toBe(true);
    // the word inside another ask is not a Tier 3 ask
    expect(route("Move R1 2 mm to the right in order to clear the mounting hole.").kind).toBe("single");
    expect(route("What does the release checklist contain?").kind).toBe("single");
    expect(route("Which parts are on order in the BOM?").kind).toBe("single");
  });

  it("2. a 3D/view request, a plain question and a direct Tier 1 command (the explicit grammar's own examples) are SINGLE - today's one-coordinator-turn path; the composer sends every one of them to the assistant", () => {
    for (const text of VIEW_PHRASINGS) expect(route(text).kind, text).toBe("single");
    for (const text of QUESTION_PHRASINGS) expect(route(text), text).toEqual({ kind: "single", rule: "S-default" });
    for (const text of EXPLICIT_PHRASINGS) {
      expect(route(text), text).toEqual({ kind: "single", rule: "S-explicit" });
      expect(routeComposerMessage(text, true).route, text).toBe("ask");
    }
  });

  it("3. the four complex shapes of runbook B21-B :805-811, three phrasings each, with the role lists pinned as data: component replacement, full circuit creation, manufacturing readiness, a bounded PCB proposal, a bounded schematic proposal", () => {
    // [B21 D3] pin move (OD-107 amended): the replacement DAG gained the schematic specialist (a second proposing role) after the sourcing evidence
    for (const text of REPLACEMENT_PHRASINGS) expect(route(text), text).toEqual({ kind: "dag", rule: "D-component-replacement", roles: ["coordinator", "circuit-topology", "component-sourcing-evidence", "schematic", "verification-critic"] });
    for (const text of FULL_CIRCUIT_PHRASINGS) {
      // [B21 C] pin move (OD-107 resolved by the lead): the runbook's six specialists are trimmed to the cap of four by a fixed priority (case 8)
      expect(route(text), text).toEqual({ kind: "dag", rule: "D-full-circuit-creation", roles: ["coordinator", "circuit-topology", "component-sourcing-evidence", "schematic", "verification-critic"] });
      expect(routeComposerMessage(text, true).route, text).toBe("generate");
    }
    for (const text of READINESS_PHRASINGS) expect(route(text), text).toEqual({ kind: "dag", rule: "D-manufacturing-readiness", roles: ["coordinator", "manufacturing-readiness-reviewer"] });
    for (const text of PCB_PHRASINGS) expect(route(text), text).toEqual({ kind: "dag", rule: "D-bounded-pcb-proposal", roles: ["coordinator", "pcb-placement-routing"] });
    for (const text of SCHEMATIC_PHRASINGS) expect(route(text), text).toEqual({ kind: "dag", rule: "D-bounded-schematic-proposal", roles: ["coordinator", "schematic"] });
    expect(DAG_ROLE_LISTS).toEqual({
      "bounded-schematic-proposal": ["coordinator", "schematic"],
      "bounded-pcb-proposal": ["coordinator", "pcb-placement-routing"],
      "component-replacement": ["coordinator", "circuit-topology", "component-sourcing-evidence", "schematic", "verification-critic"], // [B21 D3] pin move (OD-107 amended): + schematic
      // [B21 C] pin move: the trimmed full-circuit list and its layout variant (case 8); the runbook's six stay as data in FULL_CIRCUIT_RUNBOOK_ROLES
      "full-circuit-creation": ["coordinator", "circuit-topology", "component-sourcing-evidence", "schematic", "verification-critic"],
      "full-circuit-layout": ["coordinator", "circuit-topology", "component-sourcing-evidence", "pcb-placement-routing", "verification-critic"],
      "manufacturing-readiness": ["coordinator", "manufacturing-readiness-reviewer"],
    });
    for (const roles of Object.values(DAG_ROLE_LISTS)) {
      expect(roles[0]).toBe("coordinator");
      expect(new Set(roles).size).toBe(roles.length);
      for (const role of roles) expect(SPECIALIST_ROLES).toContain(role);
    }
  });

  it("4. simple work stays direct by construction: a value change is not a replacement (a generic component type is not the thing swapped in), a PCB object or a geometry / dimension ask is not a circuit, a named part is an edit, a Tier 3 verb wins over a DAG shape, an arrange command is Tier 1, a BOM tidy or a label touch-up recruits no layout specialist, an 'order ... by ...' sort ask is not a purchase", () => {
    expect(route("Replace R1 with 4.7k.")).toEqual({ kind: "single", rule: "S-default" });
    expect(route("Replace the 10k resistor with a 4.7k resistor.")).toEqual({ kind: "single", rule: "S-default" });
    expect(route("Swap the 100nF capacitor for a 1uF capacitor.")).toEqual({ kind: "single", rule: "S-default" });
    expect(route("Create a via at (10, 10) on the VCC net.")).toEqual({ kind: "single", rule: "S-default" });
    expect(route("Make the board 50 mm wide.")).toEqual({ kind: "single", rule: "S-default" });
    expect(route("Draw a box around U1.")).toEqual({ kind: "single", rule: "S-default" });
    expect(route("make R1 10k")).toEqual({ kind: "single", rule: "S-default" });
    expect(route("Release the board to manufacturing after the DFM check.")).toEqual({ kind: "refused", rule: "T3-release", reason: TIER3_REFUSAL_SENTENCE });
    expect(route("Align R1, R2 and R3 to the left edge.")).toEqual({ kind: "single", rule: "S-default" });
    expect(route("Clean up the parts list.")).toEqual({ kind: "single", rule: "S-default" });
    expect(route("Improve the labels on the board.")).toEqual({ kind: "single", rule: "S-default" });
    expect(route("Order the resistors by value.")).toEqual({ kind: "single", rule: "S-default" });
    expect(route("Order 10 boards from the fab by Friday.")).toEqual({ kind: "refused", rule: "T3-order", reason: TIER3_REFUSAL_SENTENCE });
    expect(route("")).toEqual({ kind: "single", rule: "S-default" });
  });

  it("7. the replacement rule IS the composer's pairing (one grammar, imported): every phrasing the router routes to the replacement DAG the composer routes to the assistant as a part swap, and every value change the composer routes to a schematic edit stays single here", () => {
    for (const text of REPLACEMENT_PHRASINGS) expect(routeComposerMessage(text, true), text).toMatchObject({ route: "ask", reason: expect.stringContaining("swap a part") });
    for (const text of ["Replace the 10k resistor with a 4.7k resistor.", "Swap the 100nF capacitor for a 1uF capacitor.", "Replace R1 with 4.7k."]) {
      expect(routeComposerMessage(text, true).route, text).toBe("edit");
      expect(route(text).kind, text).toBe("single");
    }
    const source = readFileSync(join(process.cwd(), ROUTER), "utf8");
    // [B21 E4] reviewed pin move (D21-38): the router's replacement grammar moved into composer-routing.ts beside `REPLACE_PART` as ONE
    // exported predicate, so the router imports that predicate and its polite prefix on the line that imported the pairing - the title's
    // "one grammar, imported" holds again (the composer's rule 5b uses the same predicate)
    expect(source).toMatch(/import \{ POLITE, partKindSwap \} from "\.\.\/\.\.\/project\/composer-routing";/);
    expect(source).not.toMatch(/resistors?\|/);
    // [B21 D3 fix] reviewed pin move (review tests-6; OD-107 amended by B21-D3): the title's "one grammar" no longer holds - the router's
    // replacement rule is the composer's pairing (imported, unchanged) OR the kind swap (router.ts `partKindSwap`), a SUPERSET of the
    // composer's; the title stays for the closeout (the stale-title convention). The divergence is pinned here instead of hidden:
    // a kind swap the router sends to the DAG the composer sends to the schematic editor (D21-38), and every composer value change
    // that NAMES an active kind still stays single here
    for (const text of ["Replace the NE555 timer U1 with a lower-power timer.", "Swap the NE555 (U1) for a lower-power CMOS timer."]) {
      expect(routeComposerMessage(text, true).route, text).toBe("ask"); // [B21 E4] reviewed pin move (D21-38 closed): the divergence is gone - the composer's rule 5b uses the same predicate, so the kind swap the router sends to the DAG reaches the assistant
      expect(route(text).rule, text).toBe("D-component-replacement");
    }
    for (const text of ["Replace C3 with 10uF for the LDO.", "Replace R1 with 10k for the timer.", "Replace the gate resistor for the MOSFET driver.", "Swap R4 and R5 for the op-amp gain.", "Replace C5 with 10uF near the regulator."]) {
      expect(routeComposerMessage(text, true).route, text).toBe("edit");
      expect(route(text), text).toEqual({ kind: "single", rule: "S-default" });
    }
    // [B21 D3 lead] reviewed pin move: the rule is ONE strict grammar (`partKindSwap`, anchored at both ends; the lead's adversarial
    // sweep found the unanchored pairing sending prohibitions and "why" questions to the DAG) - the composer's pairing is still imported
    // and must agree on every part word the grammar accepts (b21-d3-replacement-roles case 9)
    expect(source).toMatch(/if \(facts\.hasSchematic && partKindSwap\(message, userMessage\)\) return dag\("D-component-replacement"/);
    // [B21 E4] reviewed pin move (D21-38): the predicate's body moved verbatim into composer-routing.ts, where the pairing it requires lives
    expect(readFileSync(join(process.cwd(), "app/lib/project/composer-routing.ts"), "utf8")).toMatch(/if \(!kindForm && !\(partForm && REPLACE_PART\.test\(rest\)\)\) return false;/);
  });

  it("5. the run facts gate the shapes: no board - no readiness or PCB DAG; no schematic - no replacement or schematic DAG; a role that may not apply a proposal never recruits specialists; a selection-scoped PCB ask needs a selection", () => {
    expect(route(READINESS_PHRASINGS[0]!, { hasBoard: false })).toEqual({ kind: "single", rule: "S-default" });
    expect(route(PCB_PHRASINGS[0]!, { hasBoard: false })).toEqual({ kind: "single", rule: "S-default" });
    expect(route(REPLACEMENT_PHRASINGS[0]!, { hasSchematic: false })).toEqual({ kind: "single", rule: "S-default" });
    expect(route(SCHEMATIC_PHRASINGS[0]!, { hasSchematic: false })).toEqual({ kind: "single", rule: "S-default" });
    for (const actorRole of ["viewer", "commenter", "reviewer"] as const) {
      expect(TIER1_EXECUTE_ROLES).not.toContain(actorRole);
      expect(route(REPLACEMENT_PHRASINGS[0]!, { actorRole }), actorRole).toEqual({ kind: "single", rule: "S-role" });
      // a Tier 3 ask is refused for every role, before the role gate
      expect(route(TIER3_PHRASINGS.release![0]!, { actorRole }).kind, actorRole).toBe("refused");
    }
    for (const actorRole of TIER1_EXECUTE_ROLES) expect(route(REPLACEMENT_PHRASINGS[0]!, { actorRole }).kind, actorRole).toBe("dag");
    expect(route("Tighten up the layout of the selected footprints.", { selectionCount: 0 })).toEqual({ kind: "single", rule: "S-default" });
    expect(route("Tighten up the layout of the selected footprints.", { selectionCount: 2 })).toEqual({ kind: "dag", rule: "D-bounded-pcb-proposal", roles: ["coordinator", "pcb-placement-routing"] });
  });

  it("6. deterministic and closed: the same input yields an identical plan every time; the module reads no clock, no randomness, no environment and names no tool id; every rule has an id, a kind, a runbook line and (for a DAG) a role list that starts with the coordinator; the plan's rule is always one of the table's", () => {
    const inputs = [...Object.values(TIER3_PHRASINGS).flat(), ...VIEW_PHRASINGS, ...QUESTION_PHRASINGS, ...EXPLICIT_PHRASINGS, ...REPLACEMENT_PHRASINGS, ...FULL_CIRCUIT_PHRASINGS, ...READINESS_PHRASINGS, ...PCB_PHRASINGS, ...SCHEMATIC_PHRASINGS];
    for (const text of inputs) {
      const first = route(text);
      for (let repeat = 0; repeat < 3; repeat += 1) expect(route(text), text).toEqual(first);
      expect(ROUTER_RULES.map((rule) => rule.id), text).toContain(first.rule);
    }
    const source = readFileSync(join(process.cwd(), ROUTER), "utf8");
    for (const forbidden of [/\bDate\b/, /Math\.random/, /\bcrypto\b/, /process\.env/, /setTimeout/, /\bfetch\b/, /sirkit\.[a-z]/]) expect(source, String(forbidden)).not.toMatch(forbidden);
    expect(new Set(ROUTER_RULES.map((rule) => rule.id)).size).toBe(ROUTER_RULES.length);
    for (const rule of ROUTER_RULES) {
      expect(rule.id).toMatch(/^(?:T3|S|D)-[a-z-]+$/);
      expect(["single", "refused", "dag"]).toContain(rule.kind);
      expect(rule.runbook, rule.id).toMatch(/:\d{3}/);
      if (rule.kind === "dag") expect(rule.roles?.[0], rule.id).toBe("coordinator");
      else expect(rule.roles, rule.id).toBeNull();
    }
    // every DAG rule's role list is one of the pinned lists, and every pinned list is used by exactly one rule
    // [B21 D3] pin move (OD-107 amended): the replacement list now holds the same roles, in the same order, as the full-circuit
    // creation list (the evidence before the seal), so a rule's list is matched to its shape by IDENTITY - each rule holds its own
    // shape's frozen array - and the two equal lists are pinned as equal, their rules and grammars distinct
    const dagRules = ROUTER_RULES.filter((rule) => rule.kind === "dag");
    expect(dagRules).toHaveLength(Object.keys(DAG_ROLE_LISTS).length);
    for (const roles of Object.values(DAG_ROLE_LISTS)) expect(dagRules.filter((rule) => rule.roles === roles)).toHaveLength(1);
    expect(DAG_ROLE_LISTS["component-replacement"]).toEqual(DAG_ROLE_LISTS["full-circuit-creation"]);
    expect(DAG_ROLE_LISTS["component-replacement"]).not.toBe(DAG_ROLE_LISTS["full-circuit-creation"]);
    expect(normalizeRouterMessage("  Please   RELEASE\tthe board!  ")).toBe("please release the board");
  });

  it("8. [B21 C] the full-circuit list is TRIMMED to the cap of four by a fixed priority (OD-107, resolved by the lead; runbook :810 \"as needed\"): the runbook's six stay as data; the requirements analysis folds into the coordinator's own turn; the PCB specialist runs only with a board and then replaces the schematic one when the message asks for layout; no DAG list exceeds SPECIALIST_CAPS.maxSpecialists, so plan_exceeds_specialist_cap stays a guard that a routed plan never trips", () => {
    expect(FULL_CIRCUIT_RUNBOOK_ROLES).toEqual(["coordinator", "requirements-analyst", "circuit-topology", "component-sourcing-evidence", "schematic", "pcb-placement-routing", "verification-critic"]);
    expect(FULL_CIRCUIT_RUNBOOK_ROLES.length - 1).toBeGreaterThan(SPECIALIST_CAPS.maxSpecialists);
    expect(FULL_CIRCUIT_TRIM).toEqual({ priority: ["circuit-topology", "component-sourcing-evidence", "schematic", "verification-critic"], foldedIntoCoordinator: ["requirements-analyst"], layoutSwap: { replaces: "schematic", by: "pcb-placement-routing" } });
    expect(DAG_ROLE_LISTS["full-circuit-creation"]).toEqual(["coordinator", ...FULL_CIRCUIT_TRIM.priority]);
    expect(DAG_ROLE_LISTS["full-circuit-layout"]).toEqual(["coordinator", ...FULL_CIRCUIT_TRIM.priority.map((role) => (role === FULL_CIRCUIT_TRIM.layoutSwap.replaces ? FULL_CIRCUIT_TRIM.layoutSwap.by : role))]);
    for (const shape of ["full-circuit-creation", "full-circuit-layout"] as const) {
      for (const role of DAG_ROLE_LISTS[shape]) expect(FULL_CIRCUIT_RUNBOOK_ROLES, `${shape}: ${role}`).toContain(role);
      expect(DAG_ROLE_LISTS[shape], shape).not.toContain("requirements-analyst");
    }
    for (const roles of Object.values(DAG_ROLE_LISTS)) expect(roles.length - 1, roles.join(",")).toBeLessThanOrEqual(SPECIALIST_CAPS.maxSpecialists);
    // the layout variant: a creation ask that names a layout noun, with a board; without a board the schematic list stays
    const LAYOUT_ASKS = ["Design a 555 timer LED blinker with a compact placement.", "Create a USB-powered temperature logger circuit and its layout.", "Build me a 5V buck converter with the routing done."];
    for (const text of LAYOUT_ASKS) {
      expect(route(text), text).toEqual({ kind: "dag", rule: "D-full-circuit-layout", roles: DAG_ROLE_LISTS["full-circuit-layout"] });
      expect(route(text, { hasBoard: false }), text).toEqual({ kind: "dag", rule: "D-full-circuit-creation", roles: DAG_ROLE_LISTS["full-circuit-creation"] });
    }
    for (const text of FULL_CIRCUIT_PHRASINGS) expect(route(text, { hasBoard: false }), text).toEqual({ kind: "dag", rule: "D-full-circuit-creation", roles: DAG_ROLE_LISTS["full-circuit-creation"] });
    // the rule table carries both, in the order the router applies them (the layout variant first), at runbook :810
    const ids = ROUTER_RULES.map((rule) => rule.id);
    expect(ids.indexOf("D-full-circuit-layout")).toBe(ids.indexOf("D-full-circuit-creation") - 1);
    for (const id of ["D-full-circuit-layout", "D-full-circuit-creation"]) expect(ROUTER_RULES.find((rule) => rule.id === id)!.runbook, id).toBe(":810");
    // every routed plan fits the cap: no phrasing the suite routes to a DAG yields more than four specialists
    const inputs = [...REPLACEMENT_PHRASINGS, ...FULL_CIRCUIT_PHRASINGS, ...LAYOUT_ASKS, ...READINESS_PHRASINGS, ...PCB_PHRASINGS, ...SCHEMATIC_PHRASINGS];
    for (const text of inputs) { const plan = route(text); if (plan.kind === "dag") expect(plan.roles.length - 1, text).toBeLessThanOrEqual(SPECIALIST_CAPS.maxSpecialists); }
  });

  it("9. [B21 C fix] a full circuit is a NEW circuit named from words - the head verb, an indefinite object (a / an) and a circuit-kind noun inside that object (review: any make / build / create / draw edit recruited four paid specialists): an ordinary edit of something that exists recruits no full-circuit DAG (a layout-quality ask reaches the bounded PCB rule, anything else stays single); the layout variant needs its OWN layout ask (with / and a placement, layout, routing or footprints) - a selection word or a circuit-sense 'routing' never swaps the schematic specialist out", () => {
    const BOUNDED_PCB = { kind: "dag", rule: "D-bounded-pcb-proposal", roles: DAG_ROLE_LISTS["bounded-pcb-proposal"] };
    const CREATION = { kind: "dag", rule: "D-full-circuit-creation", roles: DAG_ROLE_LISTS["full-circuit-creation"] };
    // ordinary edits: a layout-quality ask is the bounded PCB proposal (:807); the rest is one coordinator turn
    expect(route("Make the placement more compact.")).toEqual(BOUNDED_PCB);
    expect(route("Make the routing tidier.")).toEqual(BOUNDED_PCB);
    expect(route("Make a compact placement for the regulator circuit.")).toEqual(BOUNDED_PCB);
    expect(route("Make the placement more compact.", { hasBoard: false })).toEqual({ kind: "single", rule: "S-default" });
    for (const text of ["Make the LED brighter.", "Build the BOM.", "Make U1 run cooler.", "Draw the power supply section again.", "Create the netlist.", "Make it faster.", "Build it."]) expect(route(text), text).toEqual({ kind: "single", rule: "S-default" });
    // what the composer sends to `generate` is not by itself a full circuit here: the router needs the circuit named
    expect(routeComposerMessage("Make the LED brighter.", true).route).toBe("generate");
    // a new circuit named from words stays a full circuit whatever else the message says
    expect(route("Generate a schematic for the selected section.", { selectionCount: 2 })).toEqual(CREATION);
    expect(route("Generate a schematic for the selected section.")).toEqual(CREATION);
    expect(route("Design an audio signal routing switch circuit.")).toEqual(CREATION);
    expect(route("Create a filter for the selected footprints.", { selectionCount: 3 })).toEqual(CREATION);
    expect(route("Please design me an LED driver.")).toEqual(CREATION);
    expect(route("Design an LED blinker.")).toEqual(CREATION);
    // [B21 C lead] the circuit kind must be the object's HEAD noun: a circuit-kind word that only MODIFIES another noun (a
    // schematic symbol, a sensor footprint, a timer part) or sits inside a compound word (counter-clockwise) names no circuit
    for (const text of ["Generate a schematic symbol for U1.", "Create a sensor footprint.", "Make a driver symbol.", "Create a timer part.", "Make a counter-clockwise turn of U1."]) expect(route(text), text).toEqual({ kind: "single", rule: "S-default" });
    // ...while a container noun after the circuit kind keeps it the head ("a buck converter board", "an amplifier module")
    for (const text of ["Build me a 5V buck converter board.", "Design an audio amplifier module.", "Create a sensor interface board."]) expect(route(text), text).toEqual(CREATION);
    // the layout variant only on its own ask, and only with a board
    expect(route("Design an LED flasher and its placement.")).toEqual({ kind: "dag", rule: "D-full-circuit-layout", roles: DAG_ROLE_LISTS["full-circuit-layout"] });
    expect(route("Design an LED flasher and its placement.", { hasBoard: false })).toEqual(CREATION);
    // the grammar's recorded limits (specialist-roles.md section 4): it fails toward one coordinator turn for a creation ask it does
    // not recognise, and a circuit-kind word used as a function after "with" still selects the layout variant
    expect(route("Design the power supply for this board.")).toEqual({ kind: "single", rule: "S-default" });
    expect(route("Build a 12 V to 5 V buck converter.")).toEqual({ kind: "single", rule: "S-default" });
    expect(route("Design a mixer with signal routing.").rule).toBe("D-full-circuit-layout");
    // the full-circuit rule never shadows the rules after it for a message that names no new circuit
    for (const text of [...READINESS_PHRASINGS, ...PCB_PHRASINGS, ...SCHEMATIC_PHRASINGS]) expect(route(text).rule, text).not.toMatch(/^D-full-circuit/);
  });
});
