/**
 * [PR-L6, 2026-10-19] Runbook L.7 items 9 and 10: the ENGINE of the fixture runtime's scripted generation provider. It answers the
 * slice core's real turns as a model would, from the conversation alone (stateless: a paused, resumed or re-claimed design sends it the
 * same stored conversation and gets the same answer):
 *
 *  - the planner call (`toolChoice` submit_plan): a request whose features select a planned recipe (the drone) gets `submit_plan` with
 *    its blocks, shared nets, rationale and the disclosed `assumptions` and `coverage` (optional plan fields); any other request - and a
 *    block-split prompt ("Block: ...") - gets no plan, so it is designed as one circuit;
 *  - a design turn: the design is the block's recipe (a "Block: <name>" message, its motor count read from the PWMn shared nets) or the
 *    single-design recipe the request selects. The engine rebuilds its OWN earlier tool calls (ids `fixture-<design>-t<turn>-search-
 *    <role>-<alternative>`) and the tool results it was given, then: every unsearched role's first query in ONE turn; for each role the
 *    first RETURNED part that satisfies it (its category, the pin names the circuit uses, its pin count, its catalog text, a value whose
 *    key is orderable; a part with published physical authority is preferred); a role nothing fits gets its next alternative query, and
 *    when the alternatives are exhausted the turn is a TEXT reply naming the role - never an invented part; when every role is filled,
 *    `submit_schematic` with partIds taken from the results and every endpoint a pin NUMBER read from that part's returned pins.
 *  - a request with no recipe gets text replies only (the slice core's nudges and strategy ladder then end it truthfully).
 *
 * Pure: no catalog, no container, no clock. Fake-backed evidence only (a scripted provider), labelled `fixture-provider` by its port.
 */
import { normalizeValueKey } from "../atomic/value-key";
import type { LLMMessage, LLMRequest, LLMToolCall } from "../llm/types";
import { STRATEGY_SEED_MARKER, droneBlockDesign, selectRecipe, type ComponentSpec, type DesignSpec, type RoleSpec } from "./generation-recipes";

/** One scripted answer: text, tool calls and the stop reason a provider would report. */
export interface ScriptedTurn { text: string; toolCalls: LLMToolCall[]; stopReason: "end_turn" | "tool_use" }
/** A part as the provider received it in a search result (the model-facing payload: facts at the top level, catalog text untrusted). */
export interface ReturnedPart {
  partId: string;
  mainCategory: string;
  pins: Array<{ number: string; name: string; type: string }>;
  verified: boolean;
  orderableValues: string[] | null;
  text: string;
  name: string;
}

export const DECLINE_TEXT = "The scripted fixture provider has no design recipe for this request (it designs a drone controller with one to four motors, a 555 PWM LED dimmer and a 555 LED blinker). It does not invent a circuit.";
const PLANNED_AT_MAIN_TEXT = "This request is designed as planned subsystem blocks; the scripted fixture provider has no single-circuit design for it.";
const TEXT_LIMIT = 1_800;

// ─── Reading the conversation ────────────────────────────────────────────────────────────────────────────────────────────

/** The first user message's text (its first text part when the message is a list: a correction or a compaction note follows it). */
export function firstUserText(messages: readonly LLMMessage[]): string {
  const first = messages.find((message) => message.role === "user");
  if (!first) return "";
  if (typeof first.content === "string") return first.content;
  const part = first.content.find((entry) => entry.type === "text");
  return part && part.type === "text" ? part.text : "";
}
/** The request a turn designs: the first user message without a strategy seed. */
export function requestTextOf(messages: readonly LLMMessage[]): string {
  return firstUserText(messages).split(STRATEGY_SEED_MARKER)[0]!;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string => (typeof value === "string" ? value : "");

/** A returned entry's facts, or null for the compact "already returned this turn" form (no pins). */
function returnedPartOf(entry: unknown): ReturnedPart | null {
  if (!isRecord(entry) || typeof entry.partId !== "string" || !Array.isArray(entry.pins)) return null;
  const pins = entry.pins.filter(isRecord).map((pin) => ({ number: str(pin.number), name: str(pin.name), type: str(pin.type) })).filter((pin) => pin.number !== "");
  const catalogText = isRecord(entry.untrustedCatalogText) ? entry.untrustedCatalogText : {};
  const orderable = Array.isArray(entry.orderableValues) ? entry.orderableValues.filter((value): value is string => typeof value === "string") : null;
  return {
    partId: entry.partId, mainCategory: str(entry.mainCategory), pins, verified: entry.physicalAuthority === "verified", orderableValues: orderable && orderable.length ? orderable : null,
    text: `${str(catalogText.name)} ${str(catalogText.mpn)} ${str(catalogText.description)}`, name: str(catalogText.name),
  };
}
/** The entries of one search_parts tool result (its plain list, or the list beside a category note); null for an error result. */
function resultEntries(output: string, isError: boolean): unknown[] | null {
  if (isError) return null;
  try {
    const parsed: unknown = JSON.parse(output);
    if (Array.isArray(parsed)) return parsed;
    if (isRecord(parsed) && Array.isArray(parsed.results)) return parsed.results;
    return null;
  } catch {
    return null;
  }
}

interface SearchRecord { roleKey: string; alternative: number; partIds: string[] }
interface Conversation { searches: SearchRecord[]; parts: Map<string, ReturnedPart> }

/** The provider's own earlier searches for `designKey` (by its call ids) with the part ids each returned, and every part's facts. */
function readConversation(messages: readonly LLMMessage[], designKey: string): Conversation {
  const searches: SearchRecord[] = [], parts = new Map<string, ReturnedPart>();
  const ownSearch = new RegExp(`^fixture-${designKey.replace(/[^A-Za-z0-9]/g, (char) => `\\${char}`)}-t\\d+-search-(.+)-(\\d+)$`);
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!;
    if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
    const answer = messages[index + 1];
    const results = new Map<string, { output: string; isError: boolean }>();
    if (answer && answer.role === "user" && Array.isArray(answer.content)) for (const part of answer.content) if (part.type === "tool_result") results.set(part.toolCallId, { output: part.output, isError: part.isError === true });
    for (const call of message.content) {
      if (call.type !== "tool_call" || call.name !== "search_parts") continue;
      const result = results.get(call.id);
      if (!result) continue; // an unanswered call is not evidence
      const entries = resultEntries(result.output, result.isError) ?? [];
      for (const entry of entries) { const facts = returnedPartOf(entry); if (facts && !parts.has(facts.partId)) parts.set(facts.partId, facts); }
      const own = ownSearch.exec(call.id);
      if (own) searches.push({ roleKey: own[1]!, alternative: Number(own[2]), partIds: entries.filter(isRecord).map((entry) => str(entry.partId)).filter(Boolean) });
    }
  }
  return { searches, parts };
}

// ─── Pins, values and roles ──────────────────────────────────────────────────────────────────────────────────────────────

/** The pin NUMBERS a selector names on a part's returned pins: `#n` a number; else every pin of that exact name; else every pin one of
 *  whose `/`-separated name tokens is the selector (KiCad's "~{RESET}/PC6"). Pin order is kept. */
export function resolvePins(pins: ReadonlyArray<{ number: string; name: string }>, selector: string): string[] {
  if (selector.startsWith("#")) return pins.filter((pin) => pin.number === selector.slice(1)).map((pin) => pin.number);
  const exact = pins.filter((pin) => pin.name === selector);
  if (exact.length) return exact.map((pin) => pin.number);
  return pins.filter((pin) => pin.name.split("/").includes(selector)).map((pin) => pin.number);
}
const endpoint = (ref: string): { ref: string; selector: string } => { const at = ref.indexOf(":"); return { ref: ref.slice(0, at), selector: ref.slice(at + 1) }; };

/** The value a component takes on a part: the first acceptable value whose key the part is orderable at (any acceptable value when
 *  the part lists no value keys), or the part's catalog name; null when none fits. */
function valueOn(spec: ComponentSpec, part: ReturnedPart): string | null {
  const orderable = part.orderableValues ? new Set(part.orderableValues) : null;
  if (spec.values === "part-name") {
    const name = part.name.trim().slice(0, 64);
    if (!name) return null;
    return orderable === null || orderable.has(normalizeValueKey(name)) ? name : null;
  }
  for (const value of spec.values) if (orderable === null || orderable.has(normalizeValueKey(value))) return value;
  return null;
}

/** The values the role's components take on `part`, or null when the part does not satisfy the role in this design. */
function fitRole(role: RoleSpec, design: DesignSpec, part: ReturnedPart): Map<string, string> | null {
  if (role.category !== undefined && part.mainCategory.trim().toLowerCase() !== role.category.toLowerCase()) return null;
  if (role.pinCount !== undefined && part.pins.length !== role.pinCount) return null;
  if (role.text && !role.text.test(part.text)) return null;
  for (const selector of role.requiredPins ?? []) if (resolvePins(part.pins, selector).length === 0) return null;
  const components = design.components.filter((component) => component.role === role.key);
  const refs = new Set(components.map((component) => component.ref));
  for (const connection of design.connections) {
    const ends = "label" in connection ? [{ ...endpoint(connection.label), single: false }] : connection.wire.map((ref) => ({ ...endpoint(ref), single: true }));
    for (const end of ends) {
      if (!refs.has(end.ref)) continue;
      const numbers = resolvePins(part.pins, end.selector);
      if (numbers.length === 0 || (end.single && numbers.length !== 1)) return null;
    }
  }
  const values = new Map<string, string>();
  for (const component of components) {
    const value = valueOn(component, part);
    if (value === null) return null;
    values.set(component.ref, value);
  }
  return values;
}

type RoleState =
  | { state: "filled"; part: ReturnedPart; values: Map<string, string> }
  | { state: "search"; alternative: number }
  | { state: "exhausted" };

function roleState(role: RoleSpec, design: DesignSpec, conversation: Conversation): RoleState {
  const own = conversation.searches.filter((search) => search.roleKey === role.key);
  const fits: Array<{ part: ReturnedPart; values: Map<string, string> }> = [];
  const seen = new Set<string>();
  for (const search of own) {
    for (const partId of search.partIds) {
      if (seen.has(partId)) continue;
      seen.add(partId);
      const part = conversation.parts.get(partId);
      if (!part) continue;
      const values = fitRole(role, design, part);
      if (values) fits.push({ part, values });
    }
  }
  const chosen = fits.find((fit) => fit.part.verified) ?? fits[0];
  if (chosen) return { state: "filled", ...chosen };
  const tried = new Set(own.map((search) => search.alternative));
  const next = role.queries.findIndex((_, index) => !tried.has(index));
  return next >= 0 ? { state: "search", alternative: next } : { state: "exhausted" };
}

// ─── The submission ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** The submit_schematic input for a design whose every role is filled: partIds from the results, endpoints as returned pin numbers. */
export function designSubmission(design: DesignSpec, filled: ReadonlyMap<string, { part: ReturnedPart; values: ReadonlyMap<string, string> }>): { components: Array<Record<string, string>>; connections: Array<Record<string, string>>; explanation: string } {
  const specByRef = new Map(design.components.map((component) => [component.ref, component] as const));
  const partOf = (ref: string): ReturnedPart => filled.get(specByRef.get(ref)!.role)!.part;
  const components = design.components.map((component) => ({
    refDes: component.ref, partId: filled.get(component.role)!.part.partId, value: filled.get(component.role)!.values.get(component.ref)!, role: component.componentRole,
    ...(component.parent !== undefined ? { parentRefDes: component.parent } : {}),
  }));
  const connections: Array<Record<string, string>> = [];
  for (const connection of design.connections) {
    if ("label" in connection) {
      const { ref, selector } = endpoint(connection.label);
      for (const number of resolvePins(partOf(ref).pins, selector)) connections.push({ kind: "label", pin: `${ref}.${number}`, labelName: connection.net, ...(connection.kind ? { labelKind: connection.kind } : {}) });
      continue;
    }
    const [from, to] = connection.wire.map((ref) => { const end = endpoint(ref); return `${end.ref}.${resolvePins(partOf(end.ref).pins, end.selector)[0]!}`; });
    connections.push({ kind: "wire", from: from!, to: to! });
  }
  return { components, connections, explanation: design.explanation };
}

// ─── The turns ───────────────────────────────────────────────────────────────────────────────────────────────────────────

const textTurn = (text: string): ScriptedTurn => ({ text: text.slice(0, TEXT_LIMIT), toolCalls: [], stopReason: "end_turn" });

/** The planner's answer for a request (`submit_plan` for a planned recipe; otherwise no plan). */
export function planTurn(prompt: string): ScriptedTurn {
  const request = prompt.split(STRATEGY_SEED_MARKER)[0]!;
  if (request.startsWith("Block: ")) return textTurn(""); // a block split: this provider designs a block as one circuit
  const recipe = selectRecipe(request);
  if (recipe === null || recipe.kind !== "planned") return textTurn("");
  const { plan } = recipe;
  return { text: "", toolCalls: [{ id: "fixture-plan", name: "submit_plan", input: { blocks: plan.blocks.map((block) => ({ name: block.name, brief: block.brief, sharedNets: [...block.sharedNets] })), rationale: plan.rationale, assumptions: [...plan.assumptions], coverage: [...plan.coverage] } }], stopReason: "tool_use" };
}

/** The design a build conversation works on: a planned drone block, or the request's single-design recipe; or the text it declines with. */
export function designOf(request: string): { design: DesignSpec } | { decline: string } {
  if (request.startsWith("Block: ")) {
    const lines = request.split("\n");
    const name = lines[0]!.slice("Block: ".length);
    const netsLine = lines.find((line) => line.startsWith("SHARED BOARD NETS")) ?? "";
    const nets = netsLine.includes(":") ? netsLine.slice(netsLine.indexOf(":") + 1).split(",").map((net) => net.trim()).filter(Boolean) : [];
    const design = droneBlockDesign(name, nets);
    return design ? { design } : { decline: DECLINE_TEXT };
  }
  const recipe = selectRecipe(request);
  if (recipe === null) return { decline: DECLINE_TEXT };
  if (recipe.kind === "planned") return { decline: PLANNED_AT_MAIN_TEXT };
  return { design: recipe.design };
}

/** One design turn from the conversation so far. */
export function designTurn(messages: readonly LLMMessage[]): ScriptedTurn {
  const chosen = designOf(requestTextOf(messages));
  if ("decline" in chosen) return textTurn(chosen.decline);
  const { design } = chosen;
  const turn = messages.filter((message) => message.role === "assistant").length + 1;
  const conversation = readConversation(messages, design.key);
  const states = design.roles.map((role) => ({ role, state: roleState(role, design, conversation) }));
  const searches = states.flatMap(({ role, state }) => (state.state === "search" ? [{ role, alternative: state.alternative }] : []));
  if (searches.length) {
    return {
      text: "",
      toolCalls: searches.map(({ role, alternative }) => {
        const query = role.queries[alternative]!;
        return { id: `fixture-${design.key}-t${turn}-search-${role.key}-${alternative}`, name: "search_parts", input: query.category !== undefined ? { query: query.query, category: query.category } : { query: query.query } };
      }),
      stopReason: "tool_use",
    };
  }
  const exhausted = states.filter(({ state }) => state.state === "exhausted").map(({ role }) => role);
  if (exhausted.length) {
    const tried = exhausted.map((role) => `${role.label} (searched ${role.queries.map((query) => `"${query.query}"`).join(", ")})`).join("; ");
    return textTurn(`No returned catalog part fits ${tried}. I will not substitute or invent a part: this design needs that part in the library.`);
  }
  const filled = new Map(states.map(({ role, state }) => [role.key, state as Extract<RoleState, { state: "filled" }>] as const));
  return { text: "", toolCalls: [{ id: `fixture-${design.key}-t${turn}-submit`, name: "submit_schematic", input: designSubmission(design, filled) }], stopReason: "tool_use" };
}

/** The scripted provider's answer to one request, from the conversation alone. */
export function scriptedGenerationTurn(request: LLMRequest): ScriptedTurn {
  const choice = request.toolChoice;
  if (typeof choice === "object" && choice !== null && choice.name === "submit_plan") return planTurn(firstUserText(request.messages));
  return designTurn(request.messages);
}
