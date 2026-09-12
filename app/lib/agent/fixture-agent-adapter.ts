/**
 * [B18-C I10] A SCRIPTED agent adapter for the browser harness — never a
 * model. Reachable ONLY through `agentAdapterFor` when the fixture runtime is
 * enabled (non-production, local_dev identity) AND `SIRKIT_FIXTURE_AGENT=
 * scripted` opts in; a source-scan tripwire pins that nothing else constructs
 * it. It turns a small, fixed set of whole user instructions into the tool
 * calls a model would make — through the REAL loop, gateway, seal, minter,
 * grant store and browser ritual — so the end-to-end proofs exercise every
 * authority check with no provider:
 *
 *  - "Move <REF> <n> mm to the right|left|up|down." → selection.inspect (the
 *    user selected <REF> in the editor), then move-footprint to the absolute
 *    target;
 *  - "Flip <REF> to the bottom|top." → selection.inspect, then
 *    rotate-side-footprint { side } (the seal fills the rotation by the
 *    editor's own Flip rule);
 *  - "Add silkscreen text <TEXT> at <x>, <y>." → silkscreen-text add (mm);
 *  - "Undo that." / "Redo." → undo-redo-granted { direction };
 *  - [B18-E E10] "Add horizontal and vertical dimensions for the board[ and mounting holes]." → board-inspect, then
 *    pcb.dimension built from the OUTLINE and mounting holes the BOUNDED mechanical read returned;
 *  - [B18-E E7] "Release the board." / "Qualify the board." / "Order the parts." → a RAW provider name the run never advertised
 *    (what a model inventing a Tier 3 tool would emit), with interim text claiming success;
 *  - [B18-E E7] "Move <REF> <n> mm <direction>, then release the board." → the move with a nested delegation in its arguments;
 *  - [B18-E E7] "Add silkscreen text <TEXT> at <x>, <y> twice." → the same execution call twice in one step;
 *  - anything else → a plain reply that names the scripted instructions.
 *
 * It reads ONLY what a model would: the user's message, the advertised tools
 * and the tool results.
 */
import type { AgentStep, ProviderAgentAdapter, ProviderToolDeclaration } from "./contracts";
import type { LLMProviderId } from "../llm/types";

export const FIXTURE_AGENT_ENV = "SIRKIT_FIXTURE_AGENT";
export const FIXTURE_AGENT_SCRIPTED = "scripted";
export const FIXTURE_AGENT_MODEL = "sirkit-fixture-agent";
const NM_PER_MM = 1_000_000;

interface SelectedFootprint { id: string; ref: string; x: number; y: number }
type Planned =
  | { kind: "reply"; text: string }
  | { kind: "select-then"; ref: string; build: (item: SelectedFootprint) => { toolId: string; args: Record<string, unknown> } }
  | { kind: "call"; toolId: string; args: Record<string, unknown> }
  /** [B18-E E7] a raw provider name this run never advertised — what a model inventing a release, qualify or order tool emits. */
  | { kind: "forged"; providerName: string; args: Record<string, unknown> }
  /** [B18-E E7] the same execution call twice in one step, with distinct call ids (scenario 7's double call). */
  | { kind: "twice"; toolId: string; args: Record<string, unknown> }
  /** [B18-E E10] scenario 3: read the board first, then dimension what the snapshot actually showed. */
  | { kind: "board-then"; build: (board: BoardFacts) => { toolId: string; args: Record<string, unknown> } | { reply: string } }
  /** [B18-E E14] scenario 2: read the net's vias first, then say what is actually possible — or propose it. */
  | { kind: "via-then"; netName: string; build: (facts: NetViaFacts) => { toolId: string; args: Record<string, unknown> } | { reply: string } }
  /** [B18-E E16] scenario 4: read the schematic to resolve the reference designator, then propose the replacement. */
  | { kind: "schematic-then"; reference: string; build: (facts: SchematicComponentFacts[]) => { toolId: string; args: Record<string, unknown> } | { reply: string } }
  /** [B18-E E18] scenario 5: propose a placement, then say truthfully what was and was not done (and what failed). */
  | { kind: "layout-then"; routeAsked: boolean };

/** [B18-E E10/E11] what the scripted agent reads out of the mechanical read (the same fields a model would use). */
export interface BoardFacts {
  outline: { originMm: { x: number; y: number }; widthMm: number; heightMm: number } | null;
  mountingHoles: Array<{ id: string; reference: string; positionMm: { x: number; y: number } }>;
}

/** [B18-E E16] what the scripted agent reads out of the schematic inspect report. */
export interface SchematicComponentFacts {
  id: string;
  displayRef: string;
}

/** [B18-E E14] what the scripted agent reads out of the bounded VIA read. */
export interface NetViaFacts {
  /** The net the read matched, or null when the asked-for name is not a net on this board. */
  net: { netId: number; name: string } | null;
  netsWithVias: Array<{ name: string; viaCount: number }>;
  vias: Array<{ id: string; diameterMm: number; drillMm: number; padstack: { id: string; name: string; outerMm: number; drillMm: number } | null }>;
  viaCount: number;
  viaPadstacks: Array<{ id: string; name: string; outerMm: number; drillMm: number }>;
}

const MOVE = /^(?:please\s+)?move\s+([a-z]+\d+)\s+(\d+(?:\.\d+)?)\s*mm\s+(?:to\s+the\s+)?(right|left|up|down)$/i;
// [B18-E E7] scenario 8's attempts and scenario 7's double call — fixture-only scripts, tested before the plain patterns.
const TIER3 = /^(?:please\s+)?(release|qualify)\s+the\s+board$|^(?:please\s+)?order\s+the\s+parts$/i;
const DELEGATE = /^(?:please\s+)?move\s+([a-z]+\d+)\s+(\d+(?:\.\d+)?)\s*mm\s+(?:to\s+the\s+)?(right|left|up|down),?\s+then\s+release\s+the\s+board$/i;
const TWICE = /^(?:please\s+)?add\s+silkscreen\s+text\s+(.{1,64}?)\s+at\s+(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*mm)?\s+twice$/i;
const TIER3_PROVIDER_NAMES: Readonly<Record<string, string>> = Object.freeze({ release: "sirkit_manufacturing_release", qualify: "sirkit_pcb_qualify", order: "sirkit_bom_order" });
const FLIP = /^(?:please\s+)?flip\s+([a-z]+\d+)\s+(?:on)?to\s+the\s+(top|bottom)(?:\s+side)?$/i;
const SILK = /^(?:please\s+)?add\s+silkscreen\s+text\s+(.{1,64}?)\s+at\s+(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*mm)?$/i;
const REPLAY = /^(?:please\s+)?(undo|redo)(?:\s+that)?$/i;
// [B18-E E10] scenario 3, exactly as the runbook words it (the mounting-hole half is answered from what the board shows).
const DIMENSION = /^(?:please\s+)?add\s+horizontal\s+and\s+vertical\s+dimensions\s+for\s+the\s+board(?:\s+and\s+mounting\s+holes)?$/i;
const DIMENSION_OFFSET_NM = 2_000_000; // 2 mm clear of the outline, so the annotation is readable and never zero
// [B18-E E14] scenario 2, exactly as the runbook words it, and the lawful follow-up a person can ask for instead.
const VIA_RESIZE = /^(?:please\s+)?change\s+every\s+via\s+on\s+the\s+(.{1,64}?)\s+net\s+to\s+(\d+(?:\.\d+)?)\s*mm\s+diameter\s+and\s+(\d+(?:\.\d+)?)\s*mm\s+drill$/i;
const VIA_PADSTACK = /^(?:please\s+)?use\s+the\s+(.{1,64}?)\s+padstack\s+for\s+(?:every|all|the)\s+vias?\s+on\s+the\s+(.{1,64}?)\s+net$/i;
/** A bounded PCB proposal carries at most this many operations (`BOUNDED_EDIT_LIMITS.maxOperations`); the agent says so
 *  rather than silently proposing part of a net. Duplicated as a literal on purpose: the fixture agent is a stand-in for a
 *  model, and a model has no import of the server's limits either. */
const PROPOSABLE_VIAS = 16;
// [B18-E E18] scenario 5, as the runbook words it. The clauses it CANNOT honour (compactly, decoupling) are answered in
// words from what the candidate actually measured - never by pretending the tools have a control they do not.
const LAYOUT = /^(?:please\s+)?place\s+the\s+board\b/i;
// [B18-E E16] scenario 4, as the runbook words it. The sentence names a reference designator; the schematic read resolves
// it to an instance id. The agent never names the replacement part - it cannot: the tool takes only {componentId}.
const REPLACE_COMPONENT = /^(?:please\s+)?delete\s+([a-z]+\d+)\s+and\s+replace\s+it\s+with\s+the\s+(?:approved|verified)\b[^.]*\bpart\b/i;
const mmText = (value: number): string => value.toFixed(3);
const VECTORS: Readonly<Record<string, readonly [number, number]>> = Object.freeze({ right: [1, 0], left: [-1, 0], up: [0, -1], down: [0, 1] });
/** [B18-D I6] A model may write text beside an execution call that claims the change is made; the scripted agent does, so
 *  the browser proof can show it never reaches the answer (it is released as a note once the run ends). */
export const FIXTURE_INTERIM_TEXT = "(fixture interim) Done — the change is already made.";
const EXECUTION_TOOL_IDS: ReadonlySet<string> = new Set(["sirkit.pcb.move-footprint", "sirkit.pcb.rotate-side-footprint", "sirkit.pcb.silkscreen-text", "sirkit.pcb.undo-redo-granted"]);

/** The scripted plan for one whole instruction (exported for the harness's unit proofs). */
export function planFixtureInstruction(message: string): Planned {
  const text = message.replace(/\s+/g, " ").trim().replace(/[.!]+$/, "").trim();
  // [B18-E E7] the Tier 3 attempt: a name the run never advertised, exactly as a model would invent one.
  const tier3 = TIER3.exec(text);
  if (tier3) {
    const word = (tier3[1] ?? "order").toLowerCase();
    return { kind: "forged", providerName: TIER3_PROVIDER_NAMES[word]!, args: { boardId: "b1", designId: "d1" } };
  }
  // [B18-E E7] the nested delegation: a real edit whose arguments try to carry a release with them.
  const delegate = DELEGATE.exec(text);
  if (delegate) {
    const delta = Math.round(Number(delegate[2]) * NM_PER_MM);
    const [dx, dy] = VECTORS[delegate[3]!.toLowerCase()]!;
    return { kind: "select-then", ref: delegate[1]!.toUpperCase(), build: (item) => ({ toolId: "sirkit.pcb.move-footprint", args: { moves: [{ footprintId: item.id, x: item.x + dx * delta, y: item.y + dy * delta }], then: { toolId: "sirkit.manufacturing.release" } } }) };
  }
  // [B18-E E7] the double call: the same execution call twice in one step (the product grammar cannot prove it, so it previews).
  const twice = TWICE.exec(text);
  if (twice) {
    const at = { x: Math.round(Number(twice[2]) * NM_PER_MM), y: Math.round(Number(twice[3]) * NM_PER_MM) };
    return { kind: "twice", toolId: "sirkit.pcb.silkscreen-text", args: { edits: [{ op: "add", silkId: null, text: twice[1], layer: "silkTop", atNm: at, heightNm: null, strokeWidthNm: null }] } };
  }
  const move = MOVE.exec(text);
  if (move) {
    const delta = Math.round(Number(move[2]) * NM_PER_MM);
    const [dx, dy] = VECTORS[move[3]!.toLowerCase()]!;
    return { kind: "select-then", ref: move[1]!.toUpperCase(), build: (item) => ({ toolId: "sirkit.pcb.move-footprint", args: { moves: [{ footprintId: item.id, x: item.x + dx * delta, y: item.y + dy * delta }] } }) };
  }
  const flip = FLIP.exec(text);
  if (flip) {
    const side = flip[2]!.toLowerCase();
    return { kind: "select-then", ref: flip[1]!.toUpperCase(), build: (item) => ({ toolId: "sirkit.pcb.rotate-side-footprint", args: { targets: [{ footprintId: item.id, rotationDeg: null, side }] } }) };
  }
  const silk = SILK.exec(text);
  if (silk) {
    const at = { x: Math.round(Number(silk[2]) * NM_PER_MM), y: Math.round(Number(silk[3]) * NM_PER_MM) };
    return { kind: "call", toolId: "sirkit.pcb.silkscreen-text", args: { edits: [{ op: "add", silkId: null, text: silk[1], layer: "silkTop", atNm: at, heightNm: null, strokeWidthNm: null }] } };
  }
  // [B18-E E10] scenario 3: the plan is built from the board the read returned, never from anything the agent assumed.
  if (DIMENSION.test(text)) {
    const holesAsked = /mounting\s+holes/i.test(text);
    return {
      kind: "board-then",
      build: (facts) => {
        if (!facts.outline) return { reply: "(fixture agent) the board snapshot carries no outline, so there is nothing to dimension. Nothing was done." };
        const { originMm, widthMm, heightMm } = facts.outline;
        const nm = (mm: number): number => Math.round(mm * NM_PER_MM);
        const left = nm(originMm.x), top = nm(originMm.y), right = nm(originMm.x + widthMm), bottom = nm(originMm.y + heightMm);
        const edits: Array<Record<string, unknown>> = [
          { op: "add", kind: "horizontal", a: { x: left, y: top }, b: { x: right, y: top }, offsetNm: -DIMENSION_OFFSET_NM },
          { op: "add", kind: "vertical", a: { x: left, y: top }, b: { x: left, y: bottom }, offsetNm: -DIMENSION_OFFSET_NM },
        ];
        // The holes are whatever the snapshot CLASSIFIED as mounting holes (OD-21) — an empty list is answered, not invented.
        if (holesAsked) {
          for (const hole of facts.mountingHoles.slice(0, 7)) {
            edits.push({ op: "add", kind: "horizontal", a: { x: nm(hole.positionMm.x), y: nm(hole.positionMm.y) }, b: { x: left, y: nm(hole.positionMm.y) }, offsetNm: DIMENSION_OFFSET_NM });
          }
        }
        return { toolId: "sirkit.pcb.dimension", args: { edits } };
      },
    };
  }
  // [B18-E E14] scenario 2: read the net's vias FIRST. What can be said next is decided by what the board answered — a net
  // that does not exist, vias whose geometry belongs to a padstack, or vias this proposal may actually resize.
  const viaResize = VIA_RESIZE.exec(text);
  if (viaResize) {
    const netName = viaResize[1]!.trim();
    const sizeNm = Math.round(Number(viaResize[2]) * NM_PER_MM);
    const drillNm = Math.round(Number(viaResize[3]) * NM_PER_MM);
    return {
      kind: "via-then", netName,
      build: (facts) => {
        const missing = noSuchNet(netName, facts);
        if (missing) return { reply: missing };
        const bound = facts.vias.filter((via) => via.padstack !== null);
        if (bound.length > 0) {
          // A bound via takes its size and drill FROM its padstack. The only proposable move is a retarget, and only onto a
          // padstack that already exists — so if the asked-for pair is not in the library, the honest answer is that it cannot
          // be done here, naming what does exist and where the fork lives.
          const match = facts.viaPadstacks.find((padstack) => Math.round(padstack.outerMm * NM_PER_MM) === sizeNm && Math.round(padstack.drillMm * NM_PER_MM) === drillNm);
          if (!match) {
            const names = facts.viaPadstacks.map((padstack) => `${padstack.name} (${mmText(padstack.outerMm)}/${mmText(padstack.drillMm)} mm)`).join(", ") || "none";
            return { reply: `(fixture agent) ${bound.length} of the ${facts.viaCount} vias on ${facts.net!.name} take their size and drill from a padstack (${bound[0]!.padstack!.name}), so I cannot set ${mmText(sizeNm / NM_PER_MM)} mm / ${mmText(drillNm / NM_PER_MM)} mm on them. This board's via padstacks are: ${names}. Creating a new one is your step in the editor (the via inspector's create-padstack, then set-via-padstack). Nothing was changed.` };
          }
          return retargetPlan(facts, match);
        }
        if (facts.viaCount > PROPOSABLE_VIAS) return { reply: `(fixture agent) ${facts.net!.name} carries ${facts.viaCount} vias and one proposal holds at most ${PROPOSABLE_VIAS}, so I will not change part of the net and call it done. Nothing was changed.` };
        return { toolId: "sirkit.pcb.propose-bounded-edit", args: { intent: `resize the vias on ${facts.net!.name}`.slice(0, 240), operations: facts.vias.map((via) => ({ kind: "update_via", viaId: via.id, sizeNm, drillNm })) } };
      },
    };
  }
  // [B18-E E14] the lawful follow-up: retarget the net's vias onto a padstack that already exists, by its own name.
  const viaPadstack = VIA_PADSTACK.exec(text);
  if (viaPadstack) {
    const padstackName = viaPadstack[1]!.trim();
    const netName = viaPadstack[2]!.trim();
    return {
      kind: "via-then", netName,
      build: (facts) => {
        const missing = noSuchNet(netName, facts);
        if (missing) return { reply: missing };
        const match = facts.viaPadstacks.find((padstack) => padstack.name.toLowerCase() === padstackName.toLowerCase() || padstack.id.toLowerCase() === padstackName.toLowerCase());
        if (!match) return { reply: `(fixture agent) this board has no padstack called "${padstackName}". It has: ${facts.viaPadstacks.map((padstack) => padstack.name).join(", ") || "none"}. Nothing was changed.` };
        return retargetPlan(facts, match);
      },
    };
  }
  // [B18-E E16] scenario 4: resolve the reference designator by READING, then ask the server to prepare the replacement.
  // The target part is never named here - the server reads it from the project's own component authority.
  const replace = REPLACE_COMPONENT.exec(text);
  if (replace) {
    const reference = replace[1]!.toUpperCase();
    return {
      kind: "schematic-then", reference,
      build: (components) => {
        const found = components.find((component) => component.displayRef.toUpperCase() === reference);
        if (!found) return { reply: `(fixture agent) this schematic has no ${reference}. It has: ${components.map((component) => component.displayRef).join(", ") || "no components"}. Nothing was changed.` };
        return { toolId: "sirkit.schematic.propose-component-replacement", args: { componentId: found.id } };
      },
    };
  }
  // [B18-E E18] scenario 5: propose the placement, then ATTEMPT the routing the sentence also asked for - the loop's
  // one-artifact rule refuses it, and the agent says so rather than quietly dropping half the request.
  if (LAYOUT.test(text)) return { kind: "layout-then", routeAsked: /\broute\b/i.test(text) };
  const replay = REPLAY.exec(text);
  if (replay) return { kind: "call", toolId: "sirkit.pcb.undo-redo-granted", args: { direction: replay[1]!.toLowerCase() } };
  return { kind: "reply", text: "(fixture agent) I follow only the harness's scripted instructions: move or flip a selected part, add silkscreen text, dimension the board (and its mounting holes), resize or retarget the vias on a net, replace a component with the part its authority records, propose a placement, undo, redo, and the refusal scripts (release, qualify, order, a delegation, a double call)." };
}

/** [B18-E E14] The name the person used is not a net on this board: say so, and say what the board does have. */
function noSuchNet(asked: string, facts: NetViaFacts): string | null {
  if (facts.net) return null;
  const carrying = facts.netsWithVias.map((net) => `${net.name} (${net.viaCount})`).join(", ");
  return carrying.length > 0
    ? `(fixture agent) this board has no net called "${asked}". The nets that carry vias are: ${carrying}. Nothing was changed.`
    : `(fixture agent) this board has no vias at all, so there is nothing on "${asked}" to change. Nothing was changed.`;
}

/** [B18-E E14] The one geometry change a bound via allows: retarget onto a padstack that already exists, bounded to 16. */
function retargetPlan(facts: NetViaFacts, padstack: NetViaFacts["viaPadstacks"][number]): { toolId: string; args: Record<string, unknown> } | { reply: string } {
  const targets = facts.vias.filter((via) => via.padstack?.id !== padstack.id);
  if (targets.length === 0) return { reply: `(fixture agent) every via on ${facts.net!.name} already uses ${padstack.name} (${mmText(padstack.outerMm)} mm / ${mmText(padstack.drillMm)} mm). Nothing to change.` };
  if (targets.length > PROPOSABLE_VIAS) return { reply: `(fixture agent) ${facts.net!.name} carries ${facts.viaCount} vias and one proposal holds at most ${PROPOSABLE_VIAS}, so I will not change part of the net and call it done. Nothing was changed.` };
  return { toolId: "sirkit.pcb.propose-bounded-edit", args: { intent: `${padstack.name} on ${facts.net!.name}`.slice(0, 240), operations: targets.map((via) => ({ kind: "update_via", viaId: via.id, padstackId: padstack.id })) } };
}

/** [B18-E E14] Read what a via plan needs out of the BOUNDED via result — only fields it states, nothing inferred. */
export function netViaFacts(outputText: string | undefined): NetViaFacts {
  const empty: NetViaFacts = { net: null, netsWithVias: [], vias: [], viaCount: 0, viaPadstacks: [] };
  const padstackOf = (raw: unknown): NetViaFacts["viaPadstacks"][number] | null => {
    const item = raw as Record<string, unknown> | null;
    return item && typeof item.id === "string" && typeof item.name === "string" && typeof item.outerMm === "number" && typeof item.drillMm === "number"
      ? { id: item.id, name: item.name, outerMm: item.outerMm, drillMm: item.drillMm }
      : null;
  };
  try {
    const parsed = JSON.parse(outputText ?? "") as { output?: { vias?: unknown } };
    const read = parsed.output?.vias as Record<string, unknown> | undefined;
    if (!read) return empty;
    const net = read.net as { netId?: unknown; name?: unknown } | null | undefined;
    const vias = Array.isArray(read.vias) ? (read.vias as Array<Record<string, unknown>>) : [];
    const nets = Array.isArray(read.netsWithVias) ? (read.netsWithVias as Array<Record<string, unknown>>) : [];
    return {
      net: net && typeof net.netId === "number" && typeof net.name === "string" ? { netId: net.netId, name: net.name } : null,
      netsWithVias: nets.flatMap((entry) => (typeof entry.name === "string" && typeof entry.viaCount === "number" ? [{ name: entry.name, viaCount: entry.viaCount }] : [])),
      vias: vias.flatMap((via) => (typeof via.id === "string" && typeof via.diameterMm === "number" && typeof via.drillMm === "number"
        ? [{ id: via.id, diameterMm: via.diameterMm, drillMm: via.drillMm, padstack: padstackOf(via.padstack) }]
        : [])),
      viaCount: typeof read.viaCount === "number" ? read.viaCount : vias.length,
      viaPadstacks: Array.isArray(read.viaPadstacks) ? (read.viaPadstacks as unknown[]).flatMap((raw) => { const padstack = padstackOf(raw); return padstack ? [padstack] : []; }) : [],
    };
  } catch {
    return empty;
  }
}

/** [B18-E E18] what the scripted agent reads out of a PLACEMENT candidate result. */
export interface LayoutFacts {
  ok: boolean;
  /** [B18-E E18] what the tool actually answered when it did not produce a candidate — saying "I could not" without
   *  saying why is the same silence this increment is about. */
  status: string;
  legal: boolean | null;
  objectives: number;
  /** The objectives the engine could not evaluate — the honest answer to a clause about decoupling. */
  unevaluated: string[];
}

export function layoutFacts(outputText: string | undefined): LayoutFacts {
  const empty: LayoutFacts = { ok: false, status: statusOf(outputText), legal: null, objectives: 0, unevaluated: [] };
  try {
    const parsed = JSON.parse(outputText ?? "") as Record<string, unknown>;
    if (parsed.ok !== true) return empty;
    const unknown = Array.isArray(parsed.unknownObjectives) ? (parsed.unknownObjectives as unknown[]) : [];
    const unsupported = Array.isArray(parsed.unsupportedObjectives) ? (parsed.unsupportedObjectives as unknown[]) : [];
    return {
      ok: true,
      status: typeof parsed.status === "string" ? parsed.status : "layout_candidate_ready",
      legal: typeof parsed.legal === "boolean" ? parsed.legal : null,
      objectives: typeof parsed.objectiveCount === "number" ? parsed.objectiveCount : 0,
      unevaluated: [...unknown, ...unsupported].filter((value): value is string => typeof value === "string").slice(0, 6),
    };
  } catch {
    return empty;
  }
}

/**
 * [B18-E E18] The closing answer for scenario 5. It says what was actually produced, what the tools cannot do (there is
 * no compactness or decoupling control to use — OD-24), which objectives could not be evaluated, and why routing did not
 * happen in the same turn. Nothing here claims a change: a candidate is a candidate until the human applies it.
 */
export function layoutAnswer(placement: LayoutFacts, routingStatus: string | null): string {
  if (!placement.ok) return `(fixture agent) I could not produce a placement candidate: the tool answered ${placement.status}. Nothing was proposed and nothing was changed.`;
  const legality = placement.legal === null ? "" : placement.legal ? " It is hard-legal." : " It is NOT hard-legal — the panel lists the violations.";
  const control = " I have no control over how compact a placement is and no way to prioritize decoupling: those are not arguments these tools take, so I did not make the board compact — I proposed a placement and am telling you what it measured.";
  const unevaluated = placement.unevaluated.length > 0
    ? ` ${placement.unevaluated.length} of ${placement.objectives} objectives could not be evaluated (${placement.unevaluated.join(", ")}) — unknown, not met.`
    : ` All ${placement.objectives} objectives were evaluated.`;
  const routing = routingStatus === null ? ""
    : routingStatus === "proposal_exists"
      ? " I did not route: one run prepares one change, and the placement candidate is it. Apply or discard it, then ask me to route."
      : routingStatus === "routing_engine_unavailable"
        ? " I could not route at all: no routing engine is available to this run. Nothing was attempted on the copper."
        : ` I did not route: the routing tool answered ${routingStatus}.`;
  return `(fixture agent) A placement candidate is ready for your review — nothing on the board has changed.${legality}${unevaluated}${control}${routing}`;
}

/** [B18-E E16] Read the components out of the schematic inspect report - id and reference designator only. */
export function schematicComponentFacts(outputText: string | undefined): SchematicComponentFacts[] {
  try {
    const parsed = JSON.parse(outputText ?? "") as { output?: { report?: { components?: unknown } } };
    const components = Array.isArray(parsed.output?.report?.components) ? (parsed.output.report.components as Array<Record<string, unknown>>) : [];
    return components.flatMap((component) => (typeof component.id === "string" && typeof component.displayRef === "string" ? [{ id: component.id, displayRef: component.displayRef }] : []));
  } catch {
    return [];
  }
}

function selectedFootprints(outputText: string | undefined): SelectedFootprint[] {
  try {
    const parsed = JSON.parse(outputText ?? "") as { output?: { items?: unknown } };
    const items = Array.isArray(parsed.output?.items) ? parsed.output.items : [];
    return items.flatMap((raw) => {
      const item = raw as Record<string, unknown>;
      return item.kind === "footprint" && typeof item.id === "string" && typeof item.ref === "string" && Number.isSafeInteger(item.x) && Number.isSafeInteger(item.y)
        ? [{ id: item.id, ref: item.ref, x: item.x as number, y: item.y as number }]
        : [];
    });
  } catch {
    return [];
  }
}

/** [B18-E E11] Read the board facts a dimension plan needs out of the BOUNDED mechanical result — only fields it states. */
export function boardFacts(outputText: string | undefined): BoardFacts {
  const empty: BoardFacts = { outline: null, mountingHoles: [] };
  try {
    const parsed = JSON.parse(outputText ?? "") as { output?: { mechanical?: unknown } };
    const mechanical = parsed.output?.mechanical as { outline?: { originMm?: { x?: unknown; y?: unknown }; widthMm?: unknown; heightMm?: unknown }; mountingHoles?: unknown } | undefined;
    const raw = mechanical?.outline;
    const outline = raw && typeof raw.widthMm === "number" && typeof raw.heightMm === "number" && typeof raw.originMm?.x === "number" && typeof raw.originMm?.y === "number" && raw.widthMm > 0 && raw.heightMm > 0
      ? { originMm: { x: raw.originMm.x, y: raw.originMm.y }, widthMm: raw.widthMm, heightMm: raw.heightMm }
      : null;
    const holes = Array.isArray(mechanical?.mountingHoles) ? (mechanical.mountingHoles as Array<Record<string, unknown>>) : [];
    const mountingHoles = holes.flatMap((hole) => {
      const position = hole.positionMm as { x?: unknown; y?: unknown } | undefined;
      return typeof hole.id === "string" && typeof hole.reference === "string" && typeof position?.x === "number" && typeof position.y === "number"
        ? [{ id: hole.id, reference: hole.reference, positionMm: { x: position.x, y: position.y } }]
        : [];
    });
    return { outline, mountingHoles };
  } catch {
    return empty;
  }
}

function statusOf(outputText: string | undefined): string {
  try {
    const parsed = JSON.parse(outputText ?? "") as { status?: unknown };
    return typeof parsed.status === "string" ? parsed.status : "an unparsed result";
  } catch {
    return "an unparsed result";
  }
}

export class FixtureAgentAdapter implements ProviderAgentAdapter {
  private planned: Planned = { kind: "reply", text: "" };
  private placement: LayoutFacts = { ok: false, status: "not-run", legal: null, objectives: 0, unevaluated: [] };
  private routing = "";
  private awaitingSelection = false;
  private awaitingBoard = false;
  private awaitingVias = false;
  private awaitingSchematic = false;
  private awaitingLayout: "placement" | "routing" | null = null;
  private seq = 0;

  constructor(readonly provider: LLMProviderId) {}

  private step(partial: Partial<AgentStep>): AgentStep {
    return { text: "", toolCalls: [], stopReason: "completed", usage: { inputTokens: 0, outputTokens: 0 }, model: FIXTURE_AGENT_MODEL, continuation: { provider: this.provider, state: null }, ...partial };
  }

  private call(tools: readonly ProviderToolDeclaration[], toolId: string, args: Record<string, unknown>): AgentStep {
    const declaration = tools.find((tool) => tool.toolId === toolId);
    if (!declaration) return this.step({ text: `(fixture agent) ${toolId} is not available to this run; nothing was done.` });
    this.seq += 1;
    return this.step({ text: EXECUTION_TOOL_IDS.has(toolId) ? FIXTURE_INTERIM_TEXT : "", toolCalls: [{ callId: `fx-${this.seq}`, providerName: declaration.providerName, argumentsText: JSON.stringify(args) }] });
  }

  async start(input: Parameters<ProviderAgentAdapter["start"]>[0]): Promise<AgentStep> {
    this.planned = planFixtureInstruction(input.userMessage);
    if (this.planned.kind === "reply") return this.step({ text: this.planned.text });
    if (this.planned.kind === "select-then") {
      this.awaitingSelection = true;
      return this.call(input.tools, "sirkit.selection.inspect", {});
    }
    if (this.planned.kind === "board-then") {
      this.awaitingBoard = true;
      return this.call(input.tools, "sirkit.pcb.mechanical-inspect", {});
    }
    if (this.planned.kind === "via-then") {
      this.awaitingVias = true;
      return this.call(input.tools, "sirkit.pcb.via-inspect", { netName: this.planned.netName });
    }
    if (this.planned.kind === "schematic-then") {
      this.awaitingSchematic = true;
      return this.call(input.tools, "sirkit.schematic.inspect", {});
    }
    if (this.planned.kind === "layout-then") {
      this.awaitingLayout = "placement";
      // A bounded search on purpose: the harness is a stand-in for a model and these are real arguments the tool takes
      // (2–8 candidates, 1–2000 iterations). The smallest honest search keeps the browser proof inside CI's budget.
      return this.call(input.tools, "sirkit.placement.propose", { candidateCount: 2, maxIterations: 20 });
    }
    // [B18-E E7] a forged name skips the declaration lookup on purpose: the run must refuse a tool it never advertised, and the
    // interim claim must still only ever appear as a labelled note.
    if (this.planned.kind === "forged") {
      this.seq += 1;
      return this.step({ text: FIXTURE_INTERIM_TEXT, toolCalls: [{ callId: `fx-${this.seq}`, providerName: this.planned.providerName, argumentsText: JSON.stringify(this.planned.args) }] });
    }
    if (this.planned.kind === "twice") {
      const declaration = input.tools.find((tool) => tool.toolId === (this.planned as { toolId: string }).toolId);
      if (!declaration) return this.step({ text: `(fixture agent) ${this.planned.toolId} is not available to this run; nothing was done.` });
      const argumentsText = JSON.stringify(this.planned.args);
      this.seq += 2;
      return this.step({ text: FIXTURE_INTERIM_TEXT, toolCalls: [{ callId: `fx-${this.seq - 1}`, providerName: declaration.providerName, argumentsText }, { callId: `fx-${this.seq}`, providerName: declaration.providerName, argumentsText }] });
    }
    return this.call(input.tools, this.planned.toolId, this.planned.args);
  }

  async continueWith(input: Parameters<ProviderAgentAdapter["continueWith"]>[0]): Promise<AgentStep> {
    const planned = this.planned;
    const outputText = input.results[0]?.outputText;
    if (this.awaitingBoard && planned.kind === "board-then") {
      this.awaitingBoard = false;
      const next = planned.build(boardFacts(outputText));
      return "reply" in next ? this.step({ text: next.reply }) : this.call(input.tools, next.toolId, next.args);
    }
    if (this.awaitingLayout && planned.kind === "layout-then") {
      if (this.awaitingLayout === "placement") {
        this.placement = layoutFacts(outputText);
        // The sentence also asked to route. Ask, and let the run's own rule answer: one side-effecting artifact per run.
        if (planned.routeAsked) {
          this.awaitingLayout = "routing";
          return this.call(input.tools, "sirkit.routing.propose", {});
        }
      } else {
        this.routing = statusOf(outputText);
      }
      this.awaitingLayout = null;
      return this.step({ text: layoutAnswer(this.placement, planned.routeAsked ? this.routing : null) });
    }
    if (this.awaitingSchematic && planned.kind === "schematic-then") {
      this.awaitingSchematic = false;
      const next = planned.build(schematicComponentFacts(outputText));
      return "reply" in next ? this.step({ text: next.reply }) : this.call(input.tools, next.toolId, next.args);
    }
    if (this.awaitingVias && planned.kind === "via-then") {
      this.awaitingVias = false;
      const next = planned.build(netViaFacts(outputText));
      return "reply" in next ? this.step({ text: next.reply }) : this.call(input.tools, next.toolId, next.args);
    }
    if (this.awaitingSelection && planned.kind === "select-then") {
      this.awaitingSelection = false;
      const item = selectedFootprints(outputText).find((candidate) => candidate.ref.toUpperCase() === planned.ref);
      if (!item) return this.step({ text: `(fixture agent) ${planned.ref} is not selected in the editor; select it and ask again. Nothing was done.` });
      const next = planned.build(item);
      return this.call(input.tools, next.toolId, next.args);
    }
    return this.step({ text: `(fixture agent) the tool answered ${statusOf(outputText)}.` });
  }
}
