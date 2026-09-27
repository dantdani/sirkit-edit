/**
 * [B21 B] The deterministic task-complexity router (OD-110): POLICY BEFORE ANY MODEL JUDGMENT. A pure function over the user
 * message and the run facts the chat route already holds (a schematic, a board, the actor's role, the autonomy setting, the
 * selection) returning a closed `RoutePlan`:
 *  - `single`: today's one-coordinator-turn path, unchanged - a direct Tier 0/1 command (the explicit-request grammars' own
 *    verbs), a 3D/view control request, a plain question and everything the runbook does not name (runbook :766, :806);
 *  - `refused`: a message whose only ask is a Tier 3 family (release / publish / publication / upload / order / purchase /
 *    qualify / ship / deliver - the tiers' own family pattern, `TIER3_FAMILY_PATTERN`) with NO provider call (:141, :148, :811);
 *  - `dag`: the four complex shapes of runbook B21-B :805-811, each with its role list pinned as data (`DAG_ROLE_LISTS`);
 *    [B21 C] the full-circuit list is the runbook's six trimmed to the cap of four by a fixed priority (`FULL_CIRCUIT_TRIM`).
 * The grammar is a closed, documented set of phrase rules over a normalized message (`ROUTER_RULES`, first match wins): no model,
 * no randomness, no clock, no environment read; a message that matches no DAG rule is `single` by construction, so simple work
 * stays direct. The router never widens a role's permissions and never names a tool (B21-C assigns the tool subsets); it decides
 * only how many coordinator turns a message gets and which specialists, if any, are recruited. The Tier 3 rules are
 * head-verb rules (the leading imperative of the whole message, after a polite prefix): a family word elsewhere in a sentence
 * ("in order to", "the release checklist") is not a Tier 3 ask, and an "order ... by ..." sort ask is not a purchase. Recorded
 * cost: any other head verb used in another sense ("ship the schematic to my inbox") is refused without a model - the page
 * records it as a deliberate fail-closed default (no Tier 3 tool is agent-exposed, so the refusal is a shortcut, never the
 * safety boundary).
 */
import { TIER1_EXECUTE_ROLES, TIER3_FAMILY_PATTERN, type AutonomyMode } from "../../engineering/permission-tiers";
import type { ProjectRole } from "../../engineering/types";
import { REPLACE_PART } from "../../project/composer-routing";
import type { SpecialistRole } from "./contracts";

export const ROUTE_PLAN_KINDS = Object.freeze(["single", "refused", "dag"] as const);
export type RoutePlanKind = (typeof ROUTE_PLAN_KINDS)[number];

/** The run facts the route already holds; none of them is a body claim (the route derives every one server-side). */
export interface RouterFacts {
  hasSchematic: boolean;
  hasBoard: boolean;
  actorRole: ProjectRole;
  /** carried for the record; no B21-B rule reads it (Tier 1 execution decisions stay the loop's, B18-C) */
  autonomyMode: AutonomyMode;
  selectionCount: number;
}
export type RoutePlan =
  | { kind: "single"; rule: string }
  | { kind: "refused"; rule: string; reason: string }
  | { kind: "dag"; rule: string; roles: readonly SpecialistRole[] };

/** The DAG shapes and their role lists, exactly as the runbook and the B21-B task pin them (data; the suite pins them).
 *  [B21 C] The two full-circuit lists are the runbook's six trimmed to OD-107's cap of four by FULL_CIRCUIT_TRIM (below). */
export const DAG_ROLE_LISTS = Object.freeze({
  "bounded-schematic-proposal": Object.freeze(["coordinator", "schematic"] as const),
  "bounded-pcb-proposal": Object.freeze(["coordinator", "pcb-placement-routing"] as const),
  "component-replacement": Object.freeze(["coordinator", "circuit-topology", "component-sourcing-evidence", "schematic", "verification-critic"] as const), // [B21 D3] + schematic (OD-107 amended): a presentation and budget order only - no specialist reads another's result before B21-E
  "full-circuit-creation": Object.freeze(["coordinator", "circuit-topology", "component-sourcing-evidence", "schematic", "verification-critic"] as const),
  "full-circuit-layout": Object.freeze(["coordinator", "circuit-topology", "component-sourcing-evidence", "pcb-placement-routing", "verification-critic"] as const),
  "manufacturing-readiness": Object.freeze(["coordinator", "manufacturing-readiness-reviewer"] as const),
}) satisfies Readonly<Record<string, readonly SpecialistRole[]>>;
/** [B21 C] Runbook :810 as the runbook names it ("requirements, architecture/circuit, component, schematic, PCB and verifier as
 *  needed"): six specialists, over OD-107's cap of four - kept as data so the trim below is visible and pinned. */
export const FULL_CIRCUIT_RUNBOOK_ROLES = Object.freeze(["coordinator", "requirements-analyst", "circuit-topology", "component-sourcing-evidence", "schematic", "pcb-placement-routing", "verification-critic"] as const);
/** [B21 C] OD-107's open decision, resolved by the lead: the runbook's list is trimmed "as needed" to the cap of four by a FIXED
 *  priority - the requirements analysis is folded into the coordinator's own turn, and the PCB specialist runs only when a board
 *  exists and then replaces the schematic one when the message asks for layout. The owner may still raise the cap (OD-107). */
export const FULL_CIRCUIT_TRIM = Object.freeze({
  priority: Object.freeze(["circuit-topology", "component-sourcing-evidence", "schematic", "verification-critic"] as const),
  foldedIntoCoordinator: Object.freeze(["requirements-analyst"] as const),
  layoutSwap: Object.freeze({ replaces: "schematic", by: "pcb-placement-routing" } as const),
});
export type DagShape = keyof typeof DAG_ROLE_LISTS;

/** The fixed answer of a refused Tier 3 ask: the same sentence the tiers give (permission-tiers.ts, Tier 3 is never agent-executable). */
export const TIER3_REFUSAL_SENTENCE = "This assistant never releases, publishes, uploads, orders, purchases, qualifies, ships or delivers anything (Tier 3): a human performs it through the product's own authorized path. No model was called for this message.";

/** The polite / framing prefix a head verb may follow. */
const POLITE = "(?:(?:please|now|just|first|ok|okay|go ahead and|let's|can you|could you|would you|i want you to|i'd like you to|i need you to)\\s+)*";
const headVerb = (verbs: string): RegExp => new RegExp(`^${POLITE}(?:${verbs})\\b`);

export interface Tier3Family {
  readonly family: string;
  /** the family's words as the tiers' pattern spells them (every one matches `TIER3_FAMILY_PATTERN`; the suite pins it) */
  readonly words: readonly string[];
  /** synonyms the composer's own Tier 3 hint names (composer-routing.ts `TIER3_WORD`), refused here too */
  readonly aliases: readonly string[];
  readonly pattern: RegExp;
}
/** The nine Tier 3 families, one rule each, in the order of the tiers' pattern. */
export const TIER3_FAMILIES: readonly Tier3Family[] = Object.freeze([
  { family: "release", words: ["release"], aliases: [], pattern: headVerb("release") },
  { family: "publish", words: ["publish"], aliases: [], pattern: headVerb("publish") },
  { family: "publication", words: ["publication"], aliases: [], pattern: new RegExp(`^${POLITE}(?:start|begin|run|submit|do|perform|trigger|initiate|kick off|create|make|open)\\s+(?:the\\s+|a\\s+|an\\s+)?publication\\b`) },
  { family: "upload", words: ["upload"], aliases: [], pattern: headVerb("upload") },
  // [review] "order <things> by <attribute>" is a SORT, not a purchase: it stays with the coordinator (the tools never expose an
  // order); "order 10 boards ... by Friday" (a quantity) is still a purchase ask and is refused
  { family: "order", words: ["order"], aliases: [], pattern: new RegExp(`^${POLITE}(?:order\\b(?!\\s+(?:the\\s+|these\\s+|those\\s+|all\\s+|my\\s+)?[a-z][a-z-]*\\s+by\\b)|place\\s+(?:an?\\s+|the\\s+)?order\\b)`) },
  { family: "purchase", words: ["purchase"], aliases: ["buy"], pattern: headVerb("purchase|buy") },
  { family: "qualify", words: ["qualify", "qualification"], aliases: [], pattern: new RegExp(`^${POLITE}(?:qualify\\b|(?:run|start|do|perform|begin)\\s+(?:the\\s+|a\\s+)?qualification\\b)`) },
  { family: "ship", words: ["ship"], aliases: [], pattern: headVerb("ship") },
  { family: "deliver", words: ["deliver"], aliases: [], pattern: headVerb("deliver") },
].map((entry) => Object.freeze(entry)));

// ─── The DAG grammars (closed phrase rules; every one cites the runbook line it implements) ──────────────────────────────

/** the explicit-request grammars' head verbs (explicit-request.ts; composer-routing.ts `EXECUTION_VERB`): a direct Tier 1 command */
const EXPLICIT_VERB = headVerb("move|shift|nudge|rotate|turn|flip|put|undo|redo");
/** runbook :809 - a part SWAP names the thing swapped in: the composer's 5b pairing ITSELF (`REPLACE_PART`, imported) or, [B21 D3 fix], a KIND swap (`partKindSwap`, appended below): the verb at the HEAD, then an ACTIVE part kind heading the swapped-in object ("with a lower-power timer") - a value, a passive type, a purpose ("for the LDO"), a negation or a question never is, so a value change stays single */
const PART_KIND_SWAP = new RegExp(`^${POLITE}(.+)$`); // [B21 D3 lead] the polite prefix stripped: the replacement forms (appended below) must match ALL that follows it, anchored at both ends
/** runbook :810 - a NEW circuit named from words ([B21 C fix], review: the composer's generate verbs alone recruited four paid
 *  specialists for "make the LED brighter" or "make the placement more compact"): the verb at the head, an indefinite object
 *  (a / an, after an optional me / us) and a circuit-kind noun INSIDE that object (before its first preposition or clause word) */
const CREATE_NEW = new RegExp(`^${POLITE}(?:design|generate|create|build|make|draw)\\s+(?:(?:me|us)\\s+)?(?:a|an)\\s+(.+)$`);
const OBJECT_END = /\s(?:with|for|and|that|which|to|on|in|of|from|using|around|so|where|while|at|by|into|onto)\s|[,;:(]/;
const CIRCUIT_KIND = /\b(?:circuits?|schematics?|blinkers?|flashers?|oscillators?|timers?|amplifiers?|preamps?|converters?|regulators?|supply|supplies|filters?|loggers?|drivers?|controllers?|chargers?|detectors?|counters?|generators?|transmitters?|receivers?|inverters?|rectifiers?|alarms?|thermostats?|dimmers?|meters?|monitors?|testers?|mixers?|synth(?:esizer)?s?|interfaces?|sensors?)\b/;
const circuitFromWords = (message: string): boolean => {
  const object = CREATE_NEW.exec(message)?.[1];
  return object !== undefined && new RegExp(`${CIRCUIT_KIND.source}(?:\\s+(?:boards?|modules?|designs?|projects?|kits?|systems?|units?|stages?|sections?|blocks?))*$`).test(` ${object} `.split(OBJECT_END)[0]!.trim().replace(/[.!?]+$/, "")); // [B21 C lead] the circuit kind heads the object, optionally followed by a container noun ("a buck converter board"); "a schematic symbol" is a symbol
};
/** the composer's rule 5: a PCB object the schematic editor cannot make is a direct PCB change, never a circuit */
const PCB_NOUN = /\b(?:silk(?:screen)?|vias?|tracks?|traces?|dimensions?|copper|zones?|pours?|keep-?outs?|courtyards?|drills?|layers?|pcb|drc|board outline)\b/;
/** [review] a geometry, annotation or size ask ("draw a box around U1", "make the board 50 mm wide") is an edit, never a circuit */
const GEOMETRY_ASK = /\b(?:box|boxes|rectangles?|circles?|arcs?|lines?|outlines?|labels?|texts?|notes?|arrows?|wider|narrower|taller|shorter|longer|bigger|smaller|larger)\b|\b\d+(?:\.\d+)?\s*(?:mm|mils?|cm|in|inch|inches)\b/;
/** the composer's rule 6: "make <reference designator>" is an edit of a named part */
const MAKE_PART = new RegExp(`^${POLITE}make\\s+(?:r|c|u|d|led|j|sw)\\d+\\b`);
/** runbook :811 - a manufacturing word AND a review word, in either order */
const MANUFACTURING_WORD = /\b(?:manufactur\w*|fabricat\w*|fab|production|dfm)\b/;
const REVIEW_WORD = /\b(?:ready|readiness|review\w*|check\w*|assess\w*|audit\w*|evaluat\w*)\b/;
/** runbook :807 - a layout-quality verb with a LAYOUT noun (placement / routing / layout / traces / footprints / the selection);
 *  the Tier 1 arrange / align / distribute commands are not here, and neither is "improve" (a BOM tidy or a label touch-up
 *  recruits no layout specialist - review) */
const LAYOUT_VERB = /\b(?:compact\w*|tighten(?:\s+up)?|optimi[sz]e|clean\s+up|tidy(?:\s+up)?|tidier|neater|reorgani[sz]e|rearrange|re-?route|autoroute|auto-?place|densify|shrink)\b/;
const LAYOUT_NOUN = /\b(?:placement|routing|layout|traces?|tracks?|footprints?|selection|selected)\b/;
const SELECTION_WORD = /\b(?:selection|selected)\b/;
/** [B21 C fix] the full-circuit layout variant's OWN ask (review: the layout-noun list swapped on "the selected section" or on a
 *  circuit-sense "routing"): a layout noun after "with" / "and" (with a compact placement, and its layout, with the routing done)
 *  or "and place / route / lay out it|them" - never a selection word */
const LAYOUT_ASK = /\b(?:with|and)\s+(?:(?:a|an|the|its|their)\s+)?(?:[a-z0-9-]+\s+)?(?:placement|layout|routing|footprints)\b|\band\s+(?:place|route|lay\s+out)\s+(?:it|them)\b/;
/** runbook :807 - a circuit-level rework verb at the head with a circuit noun */
const CIRCUIT_VERB = headVerb("redesign|rework|revise|refactor|simplify|rethink|improve|strengthen|harden");
const CIRCUIT_NOUN = /\b(?:circuit|stage|network|filter|regulator|supply|section|subcircuit|block|schematic|topology|bias|feedback|decoupling)\b/;

export interface RouterRule {
  readonly id: string;
  readonly kind: RoutePlanKind;
  /** the runbook lines the rule implements (Sirkit_Remaining_Builder_Master_Runbook.md) */
  readonly runbook: string;
  readonly summary: string;
  readonly roles: readonly SpecialistRole[] | null;
}
const rule = (id: string, kind: RoutePlanKind, runbook: string, summary: string, roles: readonly SpecialistRole[] | null = null): RouterRule => Object.freeze({ id, kind, runbook, summary, roles });

/** The rule table, in the order the router applies it (first match wins); the page's rule table equals this data. */
export const ROUTER_RULES: readonly RouterRule[] = Object.freeze([
  ...TIER3_FAMILIES.map((entry) => rule(`T3-${entry.family}`, "refused", ":141, :148, :811", `the message's only ask is a ${entry.family} (head verb${entry.aliases.length > 0 ? ` or ${entry.aliases.join(" / ")}` : ""}): refused with no provider call`)),
  rule("S-explicit", "single", ":806", "a direct Tier 0/1 command: the explicit-request grammars' head verbs (move / shift / nudge / rotate / turn / flip / put / undo / redo) stay one coordinator turn"),
  rule("S-role", "single", ":806, :829", "a role that may not apply a proposal (not pcb_editor or project_admin) never recruits specialists: one coordinator turn answers"),
  rule("D-component-replacement", "dag", ":809", "a part swap that names the thing swapped in (the composer's own pairing, or [B21 D3] an active part kind swapped in: a timer, regulator, LDO, op-amp, comparator, microcontroller, oscillator or driver), with a schematic present; [B21 D3] the schematic specialist may seal the replacement (it runs after the sourcing specialist: a presentation and budget order, no data flow)", DAG_ROLE_LISTS["component-replacement"]),
  rule("D-full-circuit-layout", "dag", ":810", "[B21 C] a new circuit named from words (as below) with its own layout ask (with / and a placement, layout, routing or footprints - never a selection word), with a board present: the trimmed list with the PCB specialist in place of the schematic one", DAG_ROLE_LISTS["full-circuit-layout"]),
  rule("D-full-circuit-creation", "dag", ":810", "a NEW circuit named from words: design / generate / create / build / make / draw at the head with an indefinite object (a / an) that names a circuit kind (not a PCB object, not a geometry or size ask, not a named part); [B21 C] the runbook's six trimmed to the cap of four", DAG_ROLE_LISTS["full-circuit-creation"]),
  rule("D-manufacturing-readiness", "dag", ":811", "a manufacturing word with a review word, with a board present: deterministic checks first, then the reviewer - never an autonomous release agent", DAG_ROLE_LISTS["manufacturing-readiness"]),
  rule("D-bounded-pcb-proposal", "dag", ":807", "a layout-quality verb with a layout noun (placement / routing / layout / traces / footprints / the selection), with a board present (a selection-scoped ask needs a selection)", DAG_ROLE_LISTS["bounded-pcb-proposal"]),
  rule("D-bounded-schematic-proposal", "dag", ":807", "a circuit-level rework verb at the head with a circuit noun, with a schematic present", DAG_ROLE_LISTS["bounded-schematic-proposal"]),
  rule("S-default", "single", ":766, :806", "everything else - a question, a 3D/view request, a direct command, an edit the runbook does not name - stays one coordinator turn"),
]);

/** One line, collapsed whitespace, lower case, no trailing sentence punctuation. */
export function normalizeRouterMessage(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase().replace(/[.!?]+$/, "").trim();
}

const single = (id: string): RoutePlan => ({ kind: "single", rule: id });
const dag = (id: string, roles: readonly SpecialistRole[]): RoutePlan => ({ kind: "dag", rule: id, roles });

/** The router: the first matching rule of `ROUTER_RULES` decides. */
export function routeTaskComplexity(userMessage: string, facts: RouterFacts): RoutePlan {
  const message = normalizeRouterMessage(userMessage);
  // Tier 3 first: the ask is refused for every role, before any other judgement (a family word must be one the tiers' pattern names)
  for (const entry of TIER3_FAMILIES) {
    if (entry.words.every((word) => !TIER3_FAMILY_PATTERN.test(word))) continue;
    if (entry.pattern.test(message)) return { kind: "refused", rule: `T3-${entry.family}`, reason: TIER3_REFUSAL_SENTENCE };
  }
  if (EXPLICIT_VERB.test(message)) return single("S-explicit");
  if (!(TIER1_EXECUTE_ROLES as readonly string[]).includes(facts.actorRole)) return single("S-role");
  if (facts.hasSchematic && partKindSwap(message, userMessage)) return dag("D-component-replacement", DAG_ROLE_LISTS["component-replacement"]); // [B21 D3 lead] ONE strict grammar, anchored: OD-107 amended
  if (circuitFromWords(message) && !PCB_NOUN.test(message) && !GEOMETRY_ASK.test(message) && !MAKE_PART.test(message)) {
    // [B21 C] the trimmed list (OD-107): the PCB specialist replaces the schematic one only with a board and its own layout ask
    return facts.hasBoard && LAYOUT_ASK.test(message) ? dag("D-full-circuit-layout", DAG_ROLE_LISTS["full-circuit-layout"]) : dag("D-full-circuit-creation", DAG_ROLE_LISTS["full-circuit-creation"]);
  }
  if (facts.hasBoard && MANUFACTURING_WORD.test(message) && REVIEW_WORD.test(message)) return dag("D-manufacturing-readiness", DAG_ROLE_LISTS["manufacturing-readiness"]);
  if (facts.hasBoard && LAYOUT_VERB.test(message) && LAYOUT_NOUN.test(message) && (!SELECTION_WORD.test(message) || facts.selectionCount > 0)) return dag("D-bounded-pcb-proposal", DAG_ROLE_LISTS["bounded-pcb-proposal"]);
  if (facts.hasSchematic && CIRCUIT_VERB.test(message) && CIRCUIT_NOUN.test(message)) return dag("D-bounded-schematic-proposal", DAG_ROLE_LISTS["bounded-schematic-proposal"]);
  return single("S-default");
}

// ─── [B21 D3 lead] The replacement request: ONE strict POSITIVE grammar with CLOSED vocabularies, anchored at both ends ─────────────
// Appended on purpose: nothing above moves (the B21 pages pin this file's lines). The lead's adversarial phrasing sweep (three lenses,
// four rounds, several hundred phrasings each through this router) found, in turn: the exclusion-based kind swap and the unanchored
// composer pairing recruiting four paid specialists for follow-up questions, retractions, exchanges of existing parts, attribute,
// documentation and value edits, prohibitions and "why" questions (round 1); open modifiers and tails (round 2); an open MPN token,
// values tied to the wrong kind, same-part "replacements" and "?!" (round 3); and MPN-shaped package, net, laminate, OS and suffix
// names, unit-less values, passive designators, opinion questions and vacuous same-kind swaps (round 4). So NO token is open: the new
// part is described by closed spec words and unit-bearing values only - never an MPN or a number, whose shape cannot be told from a
// package, a net, a peripheral, a version or a suffix variant of the same part - and an MPN names only the REPLACED part, from a listed
// vendor or family prefix. A word the grammar does not list makes the message one coordinator turn: the grammar fails toward it, never
// toward a paid DAG. What a closed grammar cannot decide - a listed word used in another sense ("a faster op-amp for the blinker") - is
// recorded, not chased.

/** the ACTIVE part kinds a replacement may name, singular - never a passive type (a resistor or capacitor change is a value change) */
const ACTIVE_KIND = "(?:timer|regulator|ldo|op-?amp|comparator|microcontroller|mcu|oscillator|driver)";
/** the part words of the composer's pairing (`REPLACE_PART`), singular: a NEW part named by what it is */
const PART_WORD = "(?:part|component|chip|alternative|alternate)";
/** an ACTIVE component's reference designator (U1, IC3, Y1, Q2, K1, PS1, U1A) - never a passive's (a passive change is a value, rating
 *  or package edit; VR is a variable resistor as often as a regulator), never pin3, net5, sheet2, tim2, x86 or C0603 */
const DESIGNATOR = "(?:u|ic|y|q|k|ps)\\d{1,4}[a-z]?";
/** an MPN of the REPLACED part: a listed vendor or family prefix, a digit, at least three digits in the token, an optional numeric suffix
 *  ("-3.3"), never a plural ("NE555s") or a multiplier ("x2") - and only ever ANCHORED by a kind or a designator in `REPLACED` (a bare
 *  prefixed code is as often a solder alloy, a laminate, an instrument, a standard or a serial number) (NE555, LM358, TL072, TLC555,
 *  STM32F030, ATmega328, AMS1117-3.3) */
const MPN = "(?=(?:[a-z]*\\d){3})(?:ne|sa|se|lm|lmc|lmv|lt|ltc|max|mcp|mic|tl|tlc|tlv|tps|ina|opa|ad|adp|op|ua|ts|tsv|ncp|mc|icm|stm|atmega|attiny|pic|esp|rp|nrf|ams|ld|ap|mp|ir|irs|ucc|drv|uln|bq|lp|isl|xc|cd|sn|ca)\\d[a-z0-9]{0,10}(?<!\\ds)(?<!x\\d{1,2})(?:-\\d+(?:\\.\\d+)?)?";
/** a standard part NUMBER that names a part by itself ("the 555 timer", "the 7805 regulator", "the 741 op-amp") - a closed list, never a year,
 *  a net or a value */
const STANDARD_PART = "(?:555|556|558|7555|741|358|324|339|393|311|317|337|386|7805|7806|7809|7812|7815|7905|7912|1117|4017|4060|4093|40106)";
/** the REPLACED part, one of seven closed shapes: "it"; a designator ("U1"); "part / IC / chip / component U1"; "the timer" / "the part";
 *  "the NE555 timer [U1 | (U1)]" or "the NE555 U1 | (U1)" - an MPN always anchored by a kind or a designator; "the 555 timer [U1 |
 *  (U1)]" (a listed standard number); "U1, the NE555," - never a list, a plural, a value, a BOM alternate, a bare code or a clause */
const REPLACED = `(?:it|${DESIGNATOR}|(?:part|ic|chip|component)\\s${DESIGNATOR}|the\\s(?:${ACTIVE_KIND}|part|component|chip)|the\\s(?:(?:${MPN}|${STANDARD_PART})\\s${ACTIVE_KIND}(?:\\s${DESIGNATOR}|\\s\\(${DESIGNATOR}\\))?|${MPN}\\s(?:${DESIGNATOR}|\\(${DESIGNATOR}\\)))|${DESIGNATOR},\\sthe\\s(?:${MPN}|${STANDARD_PART}\\s${ACTIVE_KIND}),?)`;
/** the replaced part named by a bare kind or part word ("it", "the timer", "the part"): with a bare new part it names nothing new */
const BARE_REPLACED = `(?:it|the\\s(?:${ACTIVE_KIND}|part|component|chip))`;
/** the CLOSED list of words that specify a NEW part (power, noise, speed, size, cost, supply, technology, compatibility, sourcing) -
 *  never a value of a passive, a package, a mounting, a placement, a firmware or simulation stand-in, or a pointer at an existing part */
const SPEC_WORD = "(?:low-power|lower-power|ultra-low-power|micropower|nanopower|low-noise|lower-noise|low-dropout|low-quiescent|low-iq|cmos|cmos-based|bipolar|rail-to-rail|precision|high-speed|faster|fast|smaller|small|cheaper|cheap|low-cost|lower-cost|higher-current|high-current|higher-voltage|high-voltage|wide-input|adjustable|isolated|crystal|canned|gate|motor|stepper|buck|boost|switching|linear|synchronous|dual|quad|single|pin-compatible|drop-in|compatible|free-running|second-source|automotive|industrial|efficient|quieter|quiet|newer|modern|push-pull|open-drain|zero-drift|programmable|low-pin-count|high-side|low-side)";
/** the words a "<spec> version of the <kind / part>" may carry: a technology or a grade - never a size, a package, a fix or a view */
const VERSION_WORD = "(?:cmos|bipolar|low-power|lower-power|ultra-low-power|micropower|nanopower|low-noise|lower-noise|rail-to-rail|automotive|industrial|second-source|pin-compatible|drop-in)";
/** each kind, the values that SPECIFY it - always with a unit - and the spec words that mean something else on it: a supply or current
 *  for a regulator, an LDO or a driver ("a 3.3V LDO", "a 2 A motor driver"); a width or a pin count for a microcontroller ("an 8-bit
 *  MCU"); a kHz or MHz frequency for an oscillator ("a 16 MHz crystal oscillator" - a Hz rate is a blinker's R / C value); a speed for a
 *  comparator or an op-amp ("a 1 ns comparator"); 555 compatibility for a timer - a timer's or an oscillator's speed, adjustability,
 *  mode or precision is set by R and C, never a new part */
const KIND_VALUES: ReadonlyArray<readonly [string, string, string?]> = Object.freeze([
  ["(?:regulator|ldo|driver)", "(?:\\d{1,3}(?:\\.\\d{1,2})?\\s?v|\\d{1,2}(?:\\.\\d{1,2})?\\s?a|\\d{1,4}\\s?(?:ma|ua)|\\d{1,2}v\\d{1,2})"],
  ["(?:microcontroller|mcu)", "\\d+-(?:bit|pin)"],
  ["oscillator", "\\d{1,3}(?:\\.\\d{1,3})?\\s?(?:khz|mhz)", "(?:fast|faster|high-speed|adjustable)"],
  ["(?:op-?amp|comparator)", "\\d{1,3}(?:\\.\\d{1,2})?\\s?(?:ns|us)"],
  ["timer", "\\d{3,5}-compatible", "(?:fast|faster|high-speed|adjustable|free-running|precision)"],
] as const);
/** the NEW part named by a kind: "a" / "an" (or "the approved"), at most four spec words or that kind's values, then the kind */
const KIND_OBJECTS = KIND_VALUES.map(([kind, value, excluded]) => `(?:an?|the\\sapproved)\\s(?:${excluded ? `(?!${excluded}\\s)` : ""}(?:${SPEC_WORD}|${value})\\s){0,4}${kind}`);
/** the NEW part named by a part word: at most four spec words or kinds - never a value - then a part word; or "a <technology / grade>
 *  version of the <kind / part>" */
const PART_OBJECT = `(?:an?|the\\sapproved)\\s(?:(?:(?:${SPEC_WORD}|${ACTIVE_KIND})\\s){0,4}${PART_WORD}|(?:${VERSION_WORD}\\s){1,2}version\\sof\\sthe\\s(?:${ACTIVE_KIND}|${PART_WORD}))`;
/** a BARE new part: an article and a kind or a part word - or a kind and a part word ("a timer chip") - nothing that specifies it */
const BARE_OBJECT = `an?\\s(?:${ACTIVE_KIND}\\s)?(?:${ACTIVE_KIND}|${PART_WORD})`;
/** the CLOSED tails: "instead"; "for the <circuit function> [circuit / rail / stage / supply / section]"; "while preserving compatible
 *  nets" or "while keeping / preserving the (same) footprint / pinout / nets / connections" */
const TAIL = "(?:\\s(?:instead|for\\sthe\\s(?:blinker|led|clock|adc|dac|motor|sensor|audio|input|output|power|3v3|5v|12v|mcu|radio|display|charger|battery)(?:\\s(?:circuit|rail|stage|supply|section))?|while\\spreserving\\scompatible\\snets|while\\s(?:keeping|preserving)\\sthe\\s(?:same\\s)?(?:footprint|pinout|nets|connections)))?";
/** the three request shapes: "replace / swap (out) <part> with / for / by <new part>" or "substitute <part> with / by <new part>";
 *  "delete / remove <part> and replace it with <new part>"; "substitute <new part> for <part>" (its one correct direction) */
const requestForms = (replaced: string, object: string): RegExp[] => [
  new RegExp(`^(?:(?:replace|swap(?:\\sout)?)\\s${replaced}\\s(?:with|for|by)|substitute\\s${replaced}\\s(?:with|by))\\s${object}${TAIL}$`),
  new RegExp(`^(?:delete|remove)\\s${replaced}\\sand\\sreplace\\sit\\swith\\s${object}${TAIL}$`),
  new RegExp(`^substitute\\s${object}\\sfor\\s${replaced}${TAIL}$`),
];
/** every request shape for each object kind */
const REPLACEMENT_FORMS: readonly RegExp[] = Object.freeze(KIND_OBJECTS.flatMap((object) => requestForms(REPLACED, object)));
/** the forms whose new part is named by a part word: the composer's pairing (`REPLACE_PART`, imported) must agree */
const PART_WORD_FORMS: readonly RegExp[] = Object.freeze(requestForms(REPLACED, PART_OBJECT));
/** a bare kind or part word for a bare kind or part word ("replace the timer with a timer", "replace it with a part") names nothing new */
const VACUOUS_FORMS: readonly RegExp[] = Object.freeze(requestForms(BARE_REPLACED, BARE_OBJECT));
/** "would you ..." ANYWHERE in the polite prefix asks for an opinion, whatever its punctuation ("first would you", "can you would you") */
const OPINION = /\bwould\s+you\b/;
/** a question-form request ("can you replace U1 with a CMOS timer?") asks for the replacement */
const QUESTION_REQUEST = /^(?:(?:please|now|just|ok|okay)\s+)*(?:can|could|will)\s+you\b/;
/** [B21 D3 lead] The replacement request (OD-107 amended): after a polite prefix (`PART_KIND_SWAP`), the WHOLE message is one of the
 *  three request shapes with at most one closed tail, every vocabulary closed (the replaced part's shapes with a listed MPN prefix, the
 *  spec words, each kind's unit-bearing values, the tails); a bare kind for a bare kind is nothing new; "would you" is an opinion; the
 *  RAW message's trailing punctuation decides a question - a run with "?" is a request only after "can / could / will you" and never
 *  with "!" ("?!" is incredulity). Unicode dashes and apostrophes are read as ASCII. */
function partKindSwap(message: string, raw: string): boolean {
  const rest = PART_KIND_SWAP.exec(message.replace(/[\u2010-\u2015\u2212]/g, "-").replace(/[\u2018\u2019]/g, "'"))?.[1];
  if (rest === undefined || OPINION.test(message.slice(0, message.length - rest.length)) || VACUOUS_FORMS.some((form) => form.test(rest))) return false;
  const kindForm = REPLACEMENT_FORMS.some((form) => form.test(rest));
  const partForm = PART_WORD_FORMS.some((form) => form.test(rest));
  if (!kindForm && !(partForm && REPLACE_PART.test(rest))) return false;
  const trailing = /[.!?\s]*$/.exec(raw.trim())?.[0] ?? "";
  return !trailing.includes("?") || (!trailing.includes("!") && QUESTION_REQUEST.test(message));
}
