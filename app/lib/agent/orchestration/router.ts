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
import { POLITE, partKindSwap } from "../../project/composer-routing"; // [B21 E4] the replacement grammar and its polite prefix live beside the composer's pairing since D21-38: ONE predicate, imported, never the reverse
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

/** The polite / framing prefix a head verb may follow: `POLITE`, [B21 E4] imported above from the composer module, where the replacement
 *  grammar that reads it too now lives (D21-38) - one definition. */
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
/** runbook :809 - a part SWAP names the thing swapped in: [B21 E4] ONE predicate, `partKindSwap`, imported above (D21-38) - B21-D3's strict
 *  grammar, moved verbatim beside the composer's pairing `REPLACE_PART` with its polite-prefix pattern and every closed vocabulary; the rule below is unchanged */
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

/** One line, collapsed whitespace, lower case, no trailing sentence punctuation ([B21 E4 fix: security-3] the run stripped from its start alone - a lookbehind: linear, the same answer). */
export function normalizeRouterMessage(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase().replace(/(?<![.!?])[.!?]+$/, "").trim();
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
