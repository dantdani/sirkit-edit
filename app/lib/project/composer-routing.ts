/**
 * [B18-D I1] Where the chat composer sends a message — pure routing, never authority. "ask" sends a chat turn that the
 * SERVER loop authorizes; "edit" and "generate" only ever produce proposals the user reviews. Nothing here can make a
 * change happen.
 *
 * The first matching rule wins (artifacts/ai-control-plane-b18/chat-execution-ux.md §3):
 *  1. empty → ask;
 *  1b. [PR-C, 2026-10-14] no schematic yet AND a pure question → ask (PROMPT_TO_PCB_RELIABILITY_AND_SIMPLE_UI.md §C: "pure
 *     questions must not unexpectedly replace a schematic"; rule 2 sent "What is a 555 timer?" to generation). A pure question
 *     ends with "?" and opens with a question word (what / why / how / when / where / which / who / whose / is / are / does /
 *     do / should / would / could / can / will) - except "can / could / will you (please) make / build / create / design /
 *     generate / draw …", which asks for the circuit and stays a request - or opens with explain / define / compare / tell me
 *     / describe how / what / why ("describe a circuit" is a request). With a schematic a question already reaches the
 *     assistant through rule 9, whose reason B21-E4's corpus pins (b21-e4-composer-routing cases 2-3), so the rule is gated to
 *     the empty project it corrects;
 *  2. no schematic yet → generate (the design prompt of an empty project, unchanged);
 *  3. begins with generate / design → generate;
 *  4. begins with (please) move / shift / nudge / rotate / turn / flip / put / undo / redo → ask (the explicit grammars);
 *  5. begins with an edit verb or create / build / make / draw AND names a PCB object (silkscreen, via, track, trace,
 *     dimension, copper, zone, pour, keep-out, courtyard, drill, layer, pcb, drc, board outline) → ask — a PCB change
 *     the schematic editor cannot make ("footprint" and "board" alone are excluded: both name schematic-side things too);
 *  5b. names a component REPLACEMENT (a replace/swap that names a part, component, MPN or alternate - or, [B21 E4], the router's
 *     strict kind swap `partKindSwap`: "with a lower-power timer") → ask — swapping a part is the server-owned sealed replacement
 *     proposal (B14), which the schematic editor cannot make; a value change ("replace R1 with 4.7k") names no part and stays an edit;
 *  6. begins with make <reference designator> → edit;
 *  7. begins with create / build / make / draw → generate;
 *  8. begins with an edit verb (word-bounded) → edit;
 *  9. anything else → ask.
 * A release / publish / order / purchase / qualify / upload / ship word adds the display-only "tier3-release" hint: the
 * assistant never does those, whatever the route. [PR-C] A "generate" route whose text names the PCB (pcb / board layout /
 * layout the board / gerber / manufactur… / fabricat…, word-bounded) adds the display-only "prepare-pcb" hint: the page shows
 * that the request carries the PCB intent across the schematic approval (§C) - the hint grants nothing and changes no route.
 */
export type ComposerRoute = "ask" | "edit" | "generate";
export type ComposerHint = "tier3-release" | "prepare-pcb";
export interface ComposerRouting { route: ComposerRoute; reason: string; hints: ComposerHint[] }

export const COMPOSER_ROUTE_LABELS: Readonly<Record<ComposerRoute, string>> = Object.freeze({
  ask: "ask the assistant",
  edit: "edit the schematic",
  generate: "generate a schematic",
});

const EDIT_VERB = /^(?:edit|change|set|rename|delete|remove|add|replace|swap|connect|disconnect|rewire|fix|update)\b/;
const GENERATE_VERB = /^(?:create|build|make|draw)\b/;
const EXECUTION_VERB = /^(?:please\s+)?(?:move|shift|nudge|rotate|turn|flip|put|undo|redo)\b/;
const PCB_NOUN = /\b(?:silk(?:screen)?|vias?|tracks?|traces?|dimensions?|copper|zones?|pours?|keep-?outs?|courtyards?|drills?|layers?|pcb|drc|board outline)\b/;
const MAKE_PART = /^make\s+(?:r|c|u|d|led|j|sw)\d+\b/;
// [B18-E E15] scenario 4: a part SWAP is the sealed replacement proposal the assistant owns, not a schematic edit. It is
// recognised by the pairing — a replace/swap verb anywhere with a word naming the thing being swapped IN. [B21 B] exported: the router's replacement rule IS this grammar; [B21 E4] with the kind swap `partKindSwap` (appended below) the router imports.
export const REPLACE_PART = /\b(?:replace|replacing|swap|swapping|substitute)\b[^.!?]*\b(?:parts?|components?|mpns?|alternates?|alternatives?|chips?)\b/;
const TIER3_WORD = /\b(?:release|publish|order|purchase|buy|qualify|upload|ship)\b/;
// [PR-C] rule 1b's grammar (every scan anchored at the start or a constant-time tail check: linear on any text, as b21-e4 case 6 requires)
const QUESTION_HEAD = /^(?:what|why|how|when|where|which|who|whose|is|are|does|do|should|would|could|can|will)\b/;
/** "can / could / will you (please) make / build / create / design / generate / draw …" asks FOR the circuit: a request, even with "?" */
const QUESTION_FORM_REQUEST = /^(?:can|could|will)\s+you\s+(?:please\s+)?(?:make|build|create|design|generate|draw)\b/;
/** an explanation ask, with or without "?" ("describe a circuit" is not one: only describe how / what / why) */
const EXPLANATION_HEAD = /^(?:explain|define|compare|tell\s+me|describe\s+(?:how|what|why))\b/;
const QUESTION_REASON = "a question: the assistant answers it (nothing is generated)";
// [PR-C] the "prepare-pcb" hint's words (word-bounded; a stem for manufacturing / manufacturer / fabrication / fabricate)
const PCB_INTENT_WORD = /\b(?:pcbs?|board layout|layout the board|gerbers?|manufactur[a-z]*|fabricat[a-z]*)\b/;

/** [PR-C] rule 1b: a pure question (see the module comment) */
function pureQuestion(t: string): boolean {
  if (EXPLANATION_HEAD.test(t)) return true;
  return t.endsWith("?") && QUESTION_HEAD.test(t) && !QUESTION_FORM_REQUEST.test(t);
}

export function routeComposerMessage(text: string, hasSchematic: boolean): ComposerRouting {
  const t = text.trim().toLowerCase();
  const hints: ComposerHint[] = TIER3_WORD.test(t) ? ["tier3-release"] : [];
  // [PR-C] the display-only "prepare-pcb" hint rides on the generate route only (a PCB word in an edit or an ask names no intent to carry)
  const routed = (route: ComposerRoute, reason: string): ComposerRouting => ({ route, reason, hints: route === "generate" && PCB_INTENT_WORD.test(t) ? [...hints, "prepare-pcb"] : hints });
  if (!t) return routed("ask", "nothing to send yet");
  if (!hasSchematic && pureQuestion(t)) return routed("ask", QUESTION_REASON); // [PR-C] rule 1b
  if (!hasSchematic) return routed("generate", "the project has no schematic yet: the message describes a circuit to generate");
  if (/^(?:generate|design)\b/.test(t)) return routed("generate", "asks to generate or design a circuit");
  if (EXECUTION_VERB.test(t)) return routed("ask", "a move, rotate, flip, undo or redo request: the assistant handles it");
  if ((EDIT_VERB.test(t) || GENERATE_VERB.test(t)) && PCB_NOUN.test(t)) return routed("ask", "names a PCB object the schematic editor cannot change: the assistant handles it");
  if (REPLACE_PART.test(t) || partKindSwap(replacementMessage(text), text)) return routed("ask", "asks to swap a part: the assistant prepares the server-owned replacement proposal the schematic editor cannot make"); // [B21 E4] + the router's strict kind swap (D21-38): the runbook's "Replace the NE555 timer U1 with a lower-power timer." reaches the assistant
  if (MAKE_PART.test(t)) return routed("edit", "changes a named schematic part");
  if (GENERATE_VERB.test(t)) return routed("generate", "asks to create a circuit");
  if (EDIT_VERB.test(t)) return routed("edit", "an edit to the current schematic");
  return routed("ask", "a question or request for the assistant");
}

// ─── [B21 D3 lead] The replacement request: ONE strict POSITIVE grammar with CLOSED vocabularies, anchored at both ends ─────────────
// [B21 E4] MOVED here verbatim from the end of router.ts (D21-38), beside `REPLACE_PART`: the composer's rule 5b and the router's
// replacement rule answer with this ONE predicate; the router imports it and `POLITE` (this module imports nothing: no cycle), and its
// answers are byte-identical (b21-e4-replacement-grammar: the corpus under five fact sets, the moved code lines hashed against HEAD fafc90e).
// B21-D3's account, as it stood in router.ts: the lead's adversarial phrasing sweep (three lenses,
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

/** The polite / framing prefix a head verb may follow ([B21 E4] moved from router.ts with the grammar; the router imports it for its own head verbs). */
export const POLITE = "(?:(?:please|now|just|first|ok|okay|go ahead and|let's|can you|could you|would you|i want you to|i'd like you to|i need you to)\\s+)*";
/** [B21 D3 lead] the polite prefix stripped: the replacement forms (below) must match ALL that follows it, anchored at both ends */
const PART_KIND_SWAP = new RegExp(`^${POLITE}(.+)$`); // [B21 D3 lead] the polite prefix stripped: the replacement forms (appended below) must match ALL that follows it, anchored at both ends
/** the ACTIVE part kinds a replacement may name, singular - never a passive type (a resistor or capacitor change is a value change) */
const ACTIVE_KIND = "(?:timer|regulator|ldo|op-?amp|comparator|microcontroller|mcu|oscillator|driver)";
/** the part words of the composer's pairing (`REPLACE_PART`), singular: a NEW part named by what it is */
const PART_WORD = "(?:part|component|chip|alternative|alternate)";
/** an ACTIVE component's reference designator (U1, IC3, Y1, Q2, K1, PS1, U1A) - never a passive's (a passive change is a value, rating
 *  or package edit; VR is a variable resistor as often as a regulator), never pin3, net5, sheet2, tim2, x86 or C0603 */
const DESIGNATOR = "(?:u|ic|y|q|k|ps)\\d{1,4}[a-f]?(?![a-z])"; // [B21 D3 lead, round 6] a unit letter a-f only, never a plural ("U1s") or a look-alike ("k8s", "Y2K")
/** an MPN of the REPLACED part: a listed vendor or family prefix, a digit, at least three digits in the token, an optional numeric suffix
 *  ("-3.3"), never a plural ("NE555s") or a multiplier ("x2") - and only ever ANCHORED by a kind or a designator in `REPLACED` (a bare
 *  prefixed code is as often a solder alloy, a laminate, an instrument, a standard or a serial number) (NE555, LM358, TL072, TLC555,
 *  STM32F030, ATmega328, AMS1117-3.3) */
const MPN = "(?=(?:[a-z]*\\d){3})(?:ne|sa|se|lm|lmc|lmv|lt|ltc|max|mcp|mic|tl|tlc|tlv|tps|ina|opa|ad|adp|op|ua|ts|tsv|ncp|mc|icm|stm|atmega|attiny|pic|esp|rp|nrf|ams|ld|ap|mp|ir|irs|ucc|drv|uln|bq|lp|isl|xc|cd|sn|ca)\\d[a-z0-9]{0,10}(?<!\\ds)(?<!x\\d{1,2})(?:-\\d{1,2}(?:\\.\\d{1,2})?(?!\\d))?"; // [B21 D3 lead, round 6] the suffix a voltage variant ("-3.3", "-12"), never a second part number ("NE555-556")
/** a standard part NUMBER that names a part by itself ("the 555 timer", "the 7805 regulator", "the 741 op-amp") - a closed list, never a year,
 *  a net or a value */
const STANDARD_PART = "(?:555|556|558|7555|741|358|324|339|393|311|317|337|386|7805|7806|7809|7812|7815|7905|7912|1117|4017|4060|4093|40106)";
/** the REPLACED part, one of seven closed shapes: "it"; a designator ("U1"); "part / IC / chip / component U1"; "the timer" / "the part";
 *  "the NE555 timer [U1 | (U1)]" or "the NE555 U1 | (U1)" - an MPN always anchored by a kind or a designator; "the 555 timer [U1 |
 *  (U1)]" (a listed standard number); "U1, the NE555," - never a list, a plural, a value, a BOM alternate, a bare code or a clause */
const REPLACED = `(?:it|${DESIGNATOR}|(?:part|ic|chip|component)\\s${DESIGNATOR}|the\\s(?:${ACTIVE_KIND}|part|component|chip)|the\\s(?:(?:${MPN}|${STANDARD_PART})\\s${ACTIVE_KIND}(?:\\s${DESIGNATOR}|\\s\\(${DESIGNATOR}\\))?|${MPN}\\s(?:${DESIGNATOR}|\\(${DESIGNATOR}\\)))|${DESIGNATOR},\\sthe\\s(?:${MPN}|${STANDARD_PART}\\s${ACTIVE_KIND}),)`; // [B21 D3 lead, round 6] the appositive's closing comma required: "U1, the NE555 with" is a two-item list
/** [B21 D3 lead, round 6] the replaced part NAMED without a kind the grammar can compare ("it", "the part", "the NE555 (U1)", "U1, the
 *  NE555,"): for it, a bare new part names nothing new */
const BARE_REPLACED = `(?:it|the\\s(?:part|component|chip)|the\\s${MPN}\\s(?:${DESIGNATOR}|\\(${DESIGNATOR}\\))|${DESIGNATOR},\\sthe\\s(?:${MPN}|${STANDARD_PART}\\s${ACTIVE_KIND}),)`;
/** [B21 D3 lead, round 6] the kind families a part is named by ("an LDO" is a regulator, "an MCU" a microcontroller) */
const KIND_FAMILIES: readonly string[] = Object.freeze(["timer", "(?:regulator|ldo)", "op-?amp", "comparator", "(?:microcontroller|mcu)", "oscillator", "driver"]);
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
  ["(?:regulator|ldo|driver)", "(?:\\d{1,3}(?:\\.\\d{1,2})?\\s?v|\\d{1,2}(?:\\.\\d{1,2})?\\s?a|\\d{1,4}\\s?(?:ma|ua)|\\d{1,2}v\\d{1,2})", "(?:crystal|canned|free-running)"],
  ["(?:microcontroller|mcu)", "(?:(?:4|8|16|32|64)-bit|(?:[6-9]|[1-9]\\d{1,2})-pin)", "(?:adjustable|linear|switching|buck|boost|stepper|motor|gate|crystal|canned|synchronous|programmable|free-running)"],
  ["oscillator", "\\d{1,3}(?:\\.\\d{1,3})?\\s?(?:khz|mhz)", "(?:fast|faster|high-speed|adjustable|synchronous|linear|switching|buck|boost|stepper|motor|gate|free-running)"],
  ["(?:op-?amp|comparator)", "\\d{1,3}(?:\\.\\d{1,2})?\\s?(?:ns|us)", "(?:adjustable|linear|synchronous|programmable|switching|buck|boost|stepper|motor|gate|crystal|canned|free-running)"],
  ["timer", "(?:555|556|558|7555)-compatible", "(?:fast|faster|high-speed|adjustable|free-running|precision|synchronous|linear|switching|buck|boost|stepper|motor|gate|crystal|canned|programmable)"],
] as const); // [B21 D3 lead, round 6] bounded widths and pin counts, a LISTED timer for compatibility, and each kind's nonsense spec words excluded
/** the NEW part named by a kind: "a" / "an" (or "the approved"), at most four spec words or that kind's values (never a zero magnitude:
 *  "0 V", "0v0", "0 kHz", "0-pin"), then the kind */
const KIND_OBJECTS = KIND_VALUES.map(([kind, value, excluded]) => `(?:an?|the\\sapproved)\\s(?:${excluded ? `(?!${excluded}\\s)` : ""}(?!0+(?:\\.0+)?[\\sa-z-])(?:${SPEC_WORD}|${value})\\s){0,4}${kind}`);
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
/** the forms whose new part is named by a part word: the composer's pairing (`REPLACE_PART`, above) must agree */
const PART_WORD_FORMS: readonly RegExp[] = Object.freeze(requestForms(REPLACED, PART_OBJECT));
/** a bare new part of the SAME kind family as the named part ("the timer with a timer", "the NE555 timer with a timer chip", "the
 *  ATmega328P MCU with a microcontroller") names nothing new - "the 4060 timer with a microcontroller" does; a bare new part for a part
 *  named without a comparable kind ("it with a timer") names nothing new; and a bare part word ("a part", "a chip", "a component") names
 *  nothing new for ANY part ([B21 D3 lead, round 6]) */
const VACUOUS_FORMS: readonly RegExp[] = Object.freeze([
  ...KIND_FAMILIES.flatMap((family) => requestForms(`the\\s(?:(?:${MPN}|${STANDARD_PART})\\s)?${family}(?:\\s${DESIGNATOR}|\\s\\(${DESIGNATOR}\\))?`, `an?\\s${family}(?:\\s${PART_WORD})?`)),
  ...requestForms(BARE_REPLACED, BARE_OBJECT),
  ...requestForms(REPLACED, `an?\\s${PART_WORD}`),
]);
/** "would you ..." ANYWHERE in the polite prefix asks for an opinion, whatever its punctuation ("first would you", "can you would you") */
const OPINION = /\bwould\s+you\b/;
/** a question-form request ("can you replace U1 with a CMOS timer?") asks for the replacement */
const QUESTION_REQUEST = /^(?:(?:please|now|just|ok|okay)\s+)*(?:can|could|will)\s+you\b/;
/** [B21 D3 lead] The replacement request (OD-107 amended): after a polite prefix (`PART_KIND_SWAP`), the WHOLE message is one of the
 *  three request shapes with at most one closed tail, every vocabulary closed (the replaced part's shapes with a listed MPN prefix, the
 *  spec words, each kind's unit-bearing values, the tails); a bare kind for a bare kind is nothing new; "would you" is an opinion; the
 *  RAW message's trailing punctuation decides a question - a run with "?" is a request only after "can / could / will you" and never
 *  with "!" ("?!" is incredulity). Unicode dashes and apostrophes are read as ASCII. */
export function partKindSwap(message: string, raw: string): boolean {
  const rest = PART_KIND_SWAP.exec(message.replace(/[\u2010-\u2015\u2212]/g, "-").replace(/[\u2018\u2019]/g, "'"))?.[1];
  if (rest === undefined || OPINION.test(message.slice(0, message.length - rest.length)) || VACUOUS_FORMS.some((form) => form.test(rest))) return false;
  if (/\bIT\b/.test(raw)) return false; // [B21 D3 lead, round 6] the acronym IT (upper case in the RAW message) is never the pronoun "it"
  const kindForm = REPLACEMENT_FORMS.some((form) => form.test(rest));
  const partForm = PART_WORD_FORMS.some((form) => form.test(rest));
  if (!kindForm && !(partForm && REPLACE_PART.test(rest))) return false;
  const trailing = /(?<![.!?\s])[.!?\s]*$/.exec(raw.trim())?.[0] ?? ""; // [B21 E4 fix: security-3] the same trailing run, found from its START alone (a lookbehind): linear on any text
  return !trailing.includes("?") || (!trailing.includes("!") && QUESTION_REQUEST.test(message));
}

/** [B21 E4] rule 5b's message for the predicate: the router's `normalizeRouterMessage` (router.ts), restated verbatim because this module
 *  never imports the router (the router imports it) - one line, collapsed whitespace, lower case, no trailing sentence punctuation
 *  ([B21 E4 fix: security-3] stripped from the run's start alone, linear: this runs on every render); b21-e4-composer-routing pins the two lines equal. */
function replacementMessage(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase().replace(/(?<![.!?])[.!?]+$/, "").trim();
}
