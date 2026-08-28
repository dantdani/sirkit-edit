/**
 * B11.2 §A / B11.3 §B — `sirkit.agent-replay-context.v2`.
 *
 * B11/B11.1 called the replay fixture's project state an "opaque fixture" and
 * validated it only by scanning for forbidden field NAMES — an unknown field
 * could be attached to a fixture board, pass validation, and be carried into
 * `canonicalState.pcb` (B11.2 R1). B11.2 replaced that with a versioned
 * contract, but its board projection was a SHALLOW top-level `pick`, so an
 * unknown field one level deeper — on `outline`, `outline.origin`, `nets[0]`,
 * `tracks[0]`, or `tracks[0].start` — still validated and executed
 * (reproduced pre-edit as B11.3 R1–R5).
 *
 * The contract now has ONE producer and ONE consumer, exact AT EVERY DEPTH:
 *
 *  - `projectReplayContext` (PRODUCER) carries only fields the canonical
 *    types declare. It never invents, coerces, or repairs a value.
 *  - `validateReplayContext` (CONSUMER) refuses anything the producer would
 *    not carry. The proof is a PROJECTION ROUND-TRIP: the accepted document
 *    is re-projected and compared under `canonicalJson`. If the projection
 *    would DISCARD anything, the round-trip differs and the context is
 *    REFUSED — "silently discarded during normalization" is structurally
 *    impossible rather than merely intended.
 *
 * NO COMPETING DEFINITIONS. Semantics come only from the existing shared
 * authorities: `validatePcbBoardStructure`, `validateSchematicStateIntegrity`,
 * `isWellFormedProposalScope`, `parseSelectionRef`, and `proveAgentNetlist`.
 * Key exhaustiveness — the one thing those authorities do not provide — comes
 * from declarations, never from hand-maintained tables:
 *
 *  - PCB: `generated/pcb-shape-descriptor.ts`, produced by the TypeScript
 *    compiler API from `app/lib/pcb/types.ts:PcbBoard` and everything
 *    reachable from it. `scripts/generate-pcb-shape-descriptor.ts --check` is
 *    the CI drift gate. There is NO hand-written PCB key table here.
 *  - Schematic: the small key lists below, drift-gated in
 *    `b11-2-replay-context` against `lib/schematic-types.ts`.
 *
 * KEY EXHAUSTIVENESS IS NOW COMPLETE for every field of the contract:
 * envelope, `schematic`, `board`, `schematicHeadMark`, `selection`, and
 * `netlist`, at every depth, including discriminated-union variants and
 * dynamic `Record` keys.
 *
 * SEMANTIC validity is deliberately CARRIED, not refused. A structurally
 * exact board that fails `validatePcbBoardStructure` is a legitimate fixture:
 * the resource-withholding evaluation cases exist to prove the production
 * assembler withholds on it. Refusing it here would delete that coverage.
 * Every authority's verdict is returned in `verdicts` and pinned by
 * regressions, so a fixture can never change validity unnoticed.
 */

import type { SchematicState } from "@/lib/schematic-types";
import type { PcbBoard } from "../pcb/types";
import type { SelectionRef } from "../pcb/edit/commands";
import { isWellFormedProposalScope, type Tier1ProposalHeadMark } from "../engineering/schematic-proposals";
import { validatePcbBoardStructure } from "../engineering/pcb-board-structure";
import { validateSchematicStateIntegrity } from "../engineering/schematic-model";
import { proveAgentNetlist, type AgentNetlistProjection } from "./netlist-validation";
import { parseSelectionRef } from "./context";
import { canonicalJson } from "../engineering/stable";
import { findNonPlainJsonPath, findSecretShapedPath } from "./trace";
import { redactPathSegment } from "./redaction";
import { capturePlainJson, isOwnedCapture, type DeepReadonly, type PlainJsonValue } from "./plain-capture";
import { PCB_DECLARED_FIELD_NAMES, projectCapturedBoard, validateBoardShape as validateBoardAgainstTypeGraph } from "./pcb-shape-projection";

/**
 * [B11.3 §D] v2 — an INCOMPATIBLE TIGHTENING. A v1 context was exact only at
 * the `PcbBoard` top level; a v2 context is exact at every depth of the
 * authoritative PCB type graph. Documents that were valid under v1 may be
 * invalid under v2, so the contract is versioned rather than silently
 * redefined, and a v1 document now refuses with an explicit version mismatch.
 */
export const AGENT_REPLAY_CONTEXT_SCHEMA = "sirkit.agent-replay-context.v2" as const;

export const REPLAY_CONTEXT_BOUNDS = Object.freeze({
  /** Refused BEFORE any traversal. */
  maxSerializedChars: 1_000_000,
  maxDepth: 24,
  maxNodes: 100_000,
  maxStringChars: 20_000,
  maxArrayEntries: 20_000,
  maxIssues: 12,
});

// ─── Canonical key lists (DRIFT-GATED against the production declarations) ───

export const REPLAY_CONTEXT_KEYS = ["schema", "schematic", "board", "schematicHeadMark", "selection", "netlist", "editorSchematicDigest"] as const;

/**
 * [B11.3 §E] There is deliberately NO `PCB_BOARD_*_KEYS` here any more. A
 * hand-written PCB key table would be a second, drift-prone source of truth;
 * the board's authoritative shape comes exclusively from the GENERATED
 * descriptor (`generated/pcb-shape-descriptor.ts`). A regression asserts this
 * module contains no PCB key literals.
 */

/** `SchematicState`, `SchComponent`, `Wire`, `Point`, `NetLabel`,
 *  `KicadComponentInstance` — lib/schematic-types.ts */
export const SCHEMATIC_STATE_REQUIRED_KEYS = ["components", "wires"] as const;
export const SCHEMATIC_STATE_OPTIONAL_KEYS = ["kicadComponents", "netLabels", "pageSize"] as const;
export const SCH_COMPONENT_REQUIRED_KEYS = ["id", "type", "x", "y", "rotation", "value"] as const;
export const SCH_COMPONENT_OPTIONAL_KEYS = ["refDes"] as const;
export const WIRE_REQUIRED_KEYS = ["id", "vertices"] as const;
export const POINT_REQUIRED_KEYS = ["x", "y"] as const;
export const NET_LABEL_REQUIRED_KEYS = ["id", "position", "name", "kind", "orientation"] as const;
export const KICAD_COMPONENT_REQUIRED_KEYS = ["id", "partId", "x", "y", "rotation", "refDes", "value"] as const;
export const KICAD_COMPONENT_OPTIONAL_KEYS = ["atomicPartRevisionId", "symbolAssetVersionId", "footprintAssetVersionId", "mappingCertificateId", "selectionRecordId"] as const;

/** The head mark the ASSEMBLER itself projects (context.ts): exactly three
 *  fields reach `Tier1ProposalHeadMark`, so anything else would be dropped. */
export const HEAD_MARK_REQUIRED_KEYS = ["lineageId", "headSequence", "canonicalStateDigest"] as const;

/** The selection envelope the ROUTE and the assembler both require. */
export const SELECTION_REQUIRED_KEYS = ["refs", "primary"] as const;
/** The union of `SelectionRef` variant keys (`parseSelectionRef` enforces
 *  which combination is legal; this list only bounds what may be carried). */
export const SELECTION_REF_KEYS = ["kind", "id", "footprintId", "padNumber"] as const;

/** `AgentNetlistProjection` — app/lib/agent/netlist-validation.ts */
export const NETLIST_REQUIRED_KEYS = ["schema", "components", "nets"] as const;
export const NETLIST_COMPONENT_REQUIRED_KEYS = ["id", "ref", "pins"] as const;
export const NETLIST_PIN_REQUIRED_KEYS = ["number"] as const;
export const NETLIST_PIN_OPTIONAL_KEYS = ["name"] as const;
export const NETLIST_NET_REQUIRED_KEYS = ["id", "name", "nodes", "endpointKeys"] as const;
export const NETLIST_NODE_REQUIRED_KEYS = ["componentId", "pinNumber"] as const;

// ─── The versioned fixture ───────────────────────────────────────────────────

export interface ReplayContextFixture {
  schema: typeof AGENT_REPLAY_CONTEXT_SCHEMA;
  schematic: SchematicState | null;
  board: PcbBoard | null;
  schematicHeadMark: Tier1ProposalHeadMark | null;
  selection: { refs: SelectionRef[]; primary: SelectionRef | null } | null;
  netlist: AgentNetlistProjection | null;
  editorSchematicDigest: string | null;
}

/** What each SHARED AUTHORITY said about the fixture. Verdicts are reported,
 *  never used to refuse — see the module header. */
export interface ReplayContextVerdicts {
  schematic: "absent" | "valid" | "invalid";
  board: "absent" | "valid" | "invalid";
  schematicHeadMark: "absent" | "valid" | "invalid";
  selection: "absent" | "valid" | "invalid";
  /** A netlist can only be judged against a VALID schematic. `unproven`
   *  means the shared PROOF authority (`proveAgentNetlist`, server-side
   *  re-derivation) declined it — including the KiCad case, where no trusted
   *  server-side pin authority exists at all. */
  netlist: "absent" | "valid" | "unproven" | "not-evaluable";
}

export { PCB_DECLARED_FIELD_NAMES };

export type ReplayContextResult =
  | { ok: true; context: DeepReadonly<ReplayContextFixture>; verdicts: ReplayContextVerdicts }
  | { ok: false; issues: string[] };

// ─── PRODUCER ────────────────────────────────────────────────────────────────

type Rec = Record<string, unknown>;

/** [B11.6 §B] `Array.isArray` THROWS on a revoked proxy, so even this
 *  predicate is guarded — a non-reflectable value is never a record. */
const isRec = (value: unknown): value is Rec => {
  if (typeof value !== "object" || value === null) return false;
  try {
    return !Array.isArray(value);
  } catch {
    return false;
  }
};

/** Carry only the named OWN keys, dropping `undefined` (matching
 *  `canonicalJson`, which also drops it). */
function pick(value: Rec, keys: readonly string[]): Rec {
  const out: Rec = {};
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    if (value[key] === undefined) continue;
    // [B11.5 §A] `defineProperty`, never assignment: a key named `__proto__`
    // would otherwise be discarded or would replace the destination's
    // prototype (B11.5 R1). Every enumerated key here is a declared contract
    // field, but the rule is applied uniformly so no future key can regress.
    Object.defineProperty(out, key, { value: value[key], enumerable: true, writable: true, configurable: true });
  }
  return out;
}

function pickEach(value: unknown, keys: readonly string[]): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((item) => (isRec(item) ? pick(item, keys) : item));
}

function projectSchematic(value: unknown): unknown {
  if (!isRec(value)) return value;
  const state = pick(value, [...SCHEMATIC_STATE_REQUIRED_KEYS, ...SCHEMATIC_STATE_OPTIONAL_KEYS]);
  if (Array.isArray(state.components)) {
    state.components = state.components.map((item) => (isRec(item) ? pick(item, [...SCH_COMPONENT_REQUIRED_KEYS, ...SCH_COMPONENT_OPTIONAL_KEYS]) : item));
  }
  if (Array.isArray(state.wires)) {
    state.wires = state.wires.map((item) => {
      if (!isRec(item)) return item;
      const wire = pick(item, WIRE_REQUIRED_KEYS);
      wire.vertices = pickEach(wire.vertices, POINT_REQUIRED_KEYS);
      return wire;
    });
  }
  if (Array.isArray(state.netLabels)) {
    state.netLabels = state.netLabels.map((item) => {
      if (!isRec(item)) return item;
      const label = pick(item, NET_LABEL_REQUIRED_KEYS);
      if (isRec(label.position)) label.position = pick(label.position, POINT_REQUIRED_KEYS);
      return label;
    });
  }
  if (Array.isArray(state.kicadComponents)) {
    state.kicadComponents = pickEach(state.kicadComponents, [...KICAD_COMPONENT_REQUIRED_KEYS, ...KICAD_COMPONENT_OPTIONAL_KEYS]);
  }
  return state;
}

function projectSelection(value: unknown): unknown {
  if (!isRec(value)) return value;
  const selection = pick(value, SELECTION_REQUIRED_KEYS);
  selection.refs = pickEach(selection.refs, SELECTION_REF_KEYS);
  if (isRec(selection.primary)) selection.primary = pick(selection.primary, SELECTION_REF_KEYS);
  return selection;
}

function projectNetlist(value: unknown): unknown {
  if (!isRec(value)) return value;
  const netlist = pick(value, NETLIST_REQUIRED_KEYS);
  if (Array.isArray(netlist.components)) {
    netlist.components = netlist.components.map((item) => {
      if (!isRec(item)) return item;
      const component = pick(item, NETLIST_COMPONENT_REQUIRED_KEYS);
      component.pins = pickEach(component.pins, [...NETLIST_PIN_REQUIRED_KEYS, ...NETLIST_PIN_OPTIONAL_KEYS]);
      return component;
    });
  }
  if (Array.isArray(netlist.nets)) {
    netlist.nets = netlist.nets.map((item) => {
      if (!isRec(item)) return item;
      const net = pick(item, NETLIST_NET_REQUIRED_KEYS);
      net.nodes = pickEach(net.nodes, NETLIST_NODE_REQUIRED_KEYS);
      return net;
    });
  }
  return netlist;
}

/**
 * [B11.6 §D] THE context projection result contract — identical in shape and
 * meaning to `BoardProjectionResult`:
 *
 *  - `{ ok: true, value, issues: [] }` — capturable and projectable; `value`
 *    is the OWNED projection.
 *  - `{ ok: true, value, issues: [...] }` — capturable plain JSON whose board
 *    slice was structurally invalid; `value` is still owned, for diagnostics
 *    only, never authoritative.
 *  - `{ ok: false, issues }` — not capturable, or the board projection
 *    refused outright (exhaustion). Failure is never the caller's raw input.
 *
 * On every path the result contains only owned data (B11.6 R3).
 */
export type ContextProjectionResult =
  | { ok: true; value: PlainJsonValue; issues: string[] }
  | { ok: false; issues: string[] };

/**
 * The TRUSTED producer half, operating on data proven ours. Everything the
 * contract carries is enumerated here; anything absent from this function is,
 * by construction, discarded — which is what makes the consumer's round-trip
 * a real proof rather than a promise.
 */
type CapturedContextProjection =
  | { refused: true; issues: string[] }
  | { refused: false; value: unknown; issues: string[] };

function projectCapturedContextValue(raw: unknown): CapturedContextProjection {
  // [B11.7 §A] a non-record root is capturable JSON but STRUCTURALLY invalid —
  // it must carry a deterministic issue, never an empty issue list (B11.7 R1
  // reproduced `projectReplayContext("x")` returning ok:true with NO issues).
  if (!isRec(raw)) return { refused: false, value: raw, issues: ["context: must be a plain object"] };
  const context = pick(raw, REPLAY_CONTEXT_KEYS);
  const issues: string[] = [];
  context.schematic = projectSchematic(context.schematic);
  // [B11.3] Board: RECURSIVELY exhaustive, driven by the generated
  // descriptor. Nothing below the top level is carried wholesale any more.
  if (context.board !== null && context.board !== undefined) {
    // [B11.6] the board slice reuses the trusted captured projector: the
    // context is already ours, so its board sub-tree is in the ownership
    // registry and no re-capture happens (parse-once preserved).
    const board = projectCapturedBoard(context.board);
    if (!board.ok) return { refused: true, issues: board.issues };
    context.board = board.value;
    issues.push(...board.issues);
  }
  if (isRec(context.schematicHeadMark)) context.schematicHeadMark = pick(context.schematicHeadMark, HEAD_MARK_REQUIRED_KEYS);
  context.selection = projectSelection(context.selection);
  context.netlist = projectNetlist(context.netlist);
  return { refused: false, value: context, issues };
}

/**
 * [B11.6 §A/§B] THE public context projection: CAPTURE, then project the
 * capture. B11.6 R3 reproduced the previous behaviour — a revoked proxy made
 * this function THROW (`isRec` → `Array.isArray`). Data already proven ours by
 * the ownership registry skips the re-capture.
 */
export function projectReplayContext(raw: unknown): ContextProjectionResult {
  // [B11.7 §A] capture-first for EVERY foreign value; the only bypass is
  // registry-proven ownership. Non-JSON primitives now refuse at capture, and
  // "refused" vs "structurally invalid" is carried explicitly instead of
  // being inferred from a null value (which misclassified a legitimate `null`
  // root).
  if (isOwnedCapture(raw)) return finishContextProjection(projectCapturedContextValue(raw));
  const captured = capturePlainJson(raw, "context", REPLAY_CONTEXT_BOUNDS.maxSerializedChars);
  if (!captured.ok) return { ok: false, issues: captured.issues.slice(0, REPLAY_CONTEXT_BOUNDS.maxIssues) };
  return finishContextProjection(projectCapturedContextValue(captured.value));
}

function finishContextProjection(projected: CapturedContextProjection): ContextProjectionResult {
  if (projected.refused) return { ok: false, issues: projected.issues };
  return { ok: true, value: freezeProjectedContext(projected.value) as PlainJsonValue, issues: projected.issues };
}

/** Freeze the projection's NEW containers. Children come from a captured,
 *  already-frozen snapshot, so no caller object is ever frozen. */
function freezeProjectedContext<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freezeProjectedContext(child);
  }
  return value;
}

// ─── CONSUMER ────────────────────────────────────────────────────────────────

class ContextIssues {
  private readonly list: string[] = [];
  push(issue: string): void { if (this.list.length < REPLAY_CONTEXT_BOUNDS.maxIssues) this.list.push(issue); }
  get length(): number { return this.list.length; }
  value(): string[] { return [...this.list]; }
}

/** Key names are echoed into diagnostics, so they are sanitized + bounded. */
const safeKey = (key: string): string => redactPathSegment(key, 60);

function exactContextKeys(value: Rec, required: readonly string[], optional: readonly string[], label: string, issues: ContextIssues): boolean {
  let ok = true;
  for (const key of Object.keys(value)) {
    if (required.includes(key) || optional.includes(key)) continue;
    issues.push(`${label}.${safeKey(key)}: unknown key — the canonical parser would discard it, so the fixture is refused`);
    ok = false;
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key) || value[key] === undefined) {
      issues.push(`${label}.${key}: missing required key`);
      ok = false;
    }
  }
  return ok;
}

/** Every element of an array must be a plain object with exact keys. */
function exactElements(value: unknown, required: readonly string[], optional: readonly string[], label: string, issues: ContextIssues, each?: (element: Rec, elementLabel: string) => void): void {
  if (!Array.isArray(value)) { issues.push(`${label}: must be an array`); return; }
  if (value.length > REPLAY_CONTEXT_BOUNDS.maxArrayEntries) { issues.push(`${label}: exceeds ${REPLAY_CONTEXT_BOUNDS.maxArrayEntries} entries`); return; }
  for (const [index, item] of value.entries()) {
    if (issues.length >= REPLAY_CONTEXT_BOUNDS.maxIssues) return;
    const elementLabel = `${label}[${index}]`;
    if (!isRec(item)) { issues.push(`${elementLabel}: must be a plain object`); continue; }
    if (!exactContextKeys(item, required, optional, elementLabel, issues)) continue;
    each?.(item, elementLabel);
  }
}

/** Global value discipline: JSON primitives, arrays, and plain objects only;
 *  bounded strings, arrays, depth, and total node count. */
function walkDiscipline(value: unknown, label: string, issues: ContextIssues, depth: number, budget: { nodes: number }): void {
  if (issues.length >= REPLAY_CONTEXT_BOUNDS.maxIssues) return;
  if (depth > REPLAY_CONTEXT_BOUNDS.maxDepth) { issues.push(`${label}: exceeds the maximum nesting depth`); return; }
  budget.nodes += 1;
  if (budget.nodes > REPLAY_CONTEXT_BOUNDS.maxNodes) { issues.push(`${label}: exceeds the maximum node count`); return; }
  if (value === null) return;
  if (typeof value === "string") {
    if (value.length > REPLAY_CONTEXT_BOUNDS.maxStringChars) issues.push(`${label}: string exceeds ${REPLAY_CONTEXT_BOUNDS.maxStringChars} chars`);
    return;
  }
  if (typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) issues.push(`${label}: must be a finite number`);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > REPLAY_CONTEXT_BOUNDS.maxArrayEntries) { issues.push(`${label}: exceeds ${REPLAY_CONTEXT_BOUNDS.maxArrayEntries} entries`); return; }
    // [B11.3] own NON-INDEX properties on an array are invisible to index
    // iteration, to JSON.stringify, and to canonicalJson.
    for (const key of Object.getOwnPropertyNames(value)) {
      if (key === "length" || /^(0|[1-9][0-9]*)$/.test(key)) continue;
      issues.push(`${label}.${safeKey(key)}: an array must carry only index properties`);
      return;
    }
    for (const [index, item] of value.entries()) walkDiscipline(item, `${label}[${index}]`, issues, depth + 1, budget);
    return;
  }
  if (!isRec(value)) { issues.push(`${label}: must be JSON data (a primitive, array, or plain object)`); return; }
  for (const [key, child] of Object.entries(value)) walkDiscipline(child, `${label}.${safeKey(key)}`, issues, depth + 1, budget);
}

/**
 * Validate a replay context EXACTLY, BEFORE any execution.
 *
 * Order matters: cheap structural refusals precede traversal, traversal
 * precedes the secret scan, and the projection round-trip is the final
 * invariant that no accepted field is silently dropped.
 */
export function validateReplayContext(untrusted: unknown): ReplayContextResult {
  // [B11.4 §A/§B] CAPTURE FIRST, then validate and RETURN the capture. The
  // caller's object is never read again: `JSON.stringify` would have invoked a
  // `toJSON` hook (B11.4 R1/R2), ordinary reads would have invoked accessors,
  // a hostile Proxy would have thrown (R4), and returning a cast of the
  // caller's object would have left the accepted content mutable (R3).
  if (isOwnedCapture(untrusted)) return validateOwnedReplayContext(untrusted);
  const captured = capturePlainJson(untrusted, "context", REPLAY_CONTEXT_BOUNDS.maxSerializedChars);
  if (!captured.ok) return { ok: false, issues: captured.issues.slice(0, REPLAY_CONTEXT_BOUNDS.maxIssues) };
  return validateOwnedReplayContext(captured.value);
}

/**
 * [B11.4/B11.6] The validation half for an ALREADY-CAPTURED document.
 * `replayCapsule` captures the whole capsule once and reuses this, so the
 * capture never runs twice on the same bytes.
 *
 * [B11.6 §B] TOTAL and ownership-ENFORCED, not merely documented: input that
 * is not in the capture ownership registry (an unforgeable, trap-free O(1)
 * membership check) is routed through the capture-first public path. B11.6 R4
 * reproduced the previous behaviour — a revoked proxy made this exported
 * function THROW; and a caller passing plain uncaptured data would have had
 * its own object returned as the "accepted context". Now: hostile input is
 * refused by capture, foreign plain input is captured (so the returned
 * context is owned), and only genuine snapshots take the zero-copy fast path.
 */
export function validateCapturedReplayContext(raw: unknown): ReplayContextResult {
  if (!isOwnedCapture(raw)) return validateReplayContext(raw);
  return validateOwnedReplayContext(raw);
}

/** The trusted core. `raw` is PROVEN ours (ownership registry) or freshly
 *  captured by `validateReplayContext`. */
function validateOwnedReplayContext(raw: unknown): ReplayContextResult {
  const issues = new ContextIssues();
  if (!isRec(raw)) return { ok: false, issues: ["context: must be a plain object"] };

  // 1. Plain-JSON shape. Capture already guarantees it; this stays as an
  //    independent assertion of the snapshot's own integrity.
  const nonPlain = findNonPlainJsonPath(raw, "context");
  if (nonPlain !== null) return { ok: false, issues: [nonPlain] };

  // 3. Versioned envelope.
  if (!exactContextKeys(raw, REPLAY_CONTEXT_KEYS, [], "context", issues)) return { ok: false, issues: issues.value() };
  if (raw.schema !== AGENT_REPLAY_CONTEXT_SCHEMA) return { ok: false, issues: [`context.schema: expected ${AGENT_REPLAY_CONTEXT_SCHEMA}`] };

  // 4. Value discipline + bounds over the whole document.
  walkDiscipline(raw, "context", issues, 0, { nodes: 0 });
  if (issues.length > 0) return { ok: false, issues: issues.value() };

  // 5. Recursive credential/provider/SDK scan over ORIGINAL key names and
  //    string values (pre-serialization, so nested quoted JSON cannot hide).
  // Names the authoritative PCB type graph declares are exempt from the NAME
  // check only; their VALUES are still scanned. See `findSecretShapedPath`.
  const secret = findSecretShapedPath(raw, "context", 0, { nodes: 0 }, PCB_DECLARED_FIELD_NAMES);
  if (secret !== null) return { ok: false, issues: [secret] };

  // 6. Per-resource exact shape.
  if (raw.editorSchematicDigest !== null && (typeof raw.editorSchematicDigest !== "string" || raw.editorSchematicDigest.length === 0 || raw.editorSchematicDigest.length > 128)) {
    issues.push("context.editorSchematicDigest: must be null or a non-empty string of at most 128 chars");
  }
  validateSchematicShape(raw.schematic, issues);
  validateBoardShape(raw.board, issues);
  validateHeadMarkShape(raw.schematicHeadMark, issues);
  validateSelectionShape(raw.selection, issues);
  validateNetlistShape(raw.netlist, issues);
  if (issues.length > 0) return { ok: false, issues: issues.value() };

  // 7. PROJECTION ROUND-TRIP — the proof that nothing accepted is discarded.
  //    Any key the producer does not carry makes these two documents differ.
  //    [B11.6] `raw` is an owned snapshot here, so the trusted captured
  //    projector runs without any re-capture (parse-once preserved).
  const roundTrip = projectCapturedContextValue(raw);
  if (roundTrip.refused) return { ok: false, issues: roundTrip.issues };
  if (canonicalJson(roundTrip.value) !== canonicalJson(raw)) {
    return { ok: false, issues: ["context: contains data the canonical replay-context projection would discard; the fixture is refused rather than silently normalized"] };
  }

  // 8. SHARED AUTHORITIES — verdicts only (never a refusal; see the header).
  //    `raw` here is the CAPTURED, deep-frozen snapshot — not the caller's
  //    object — so what is validated is exactly what is returned.
  const context = raw as unknown as ReplayContextFixture;
  const schematicValid = context.schematic !== null && validateSchematicStateIntegrity(context.schematic).length === 0;
  let boardVerdict: ReplayContextVerdicts["board"] = "absent";
  if (context.board !== null) {
    let structural: string[];
    try { structural = validatePcbBoardStructure(context.board); } catch { structural = ["the structural validator refused the board shape"]; }
    boardVerdict = structural.length === 0 ? "valid" : "invalid";
  }
  let netlistVerdict: ReplayContextVerdicts["netlist"] = "absent";
  if (context.netlist !== null) {
    // The shared PROOF authority, not a local re-implementation: structural
    // + semantic validation followed by server-side re-derivation.
    netlistVerdict = !schematicValid || context.schematic === null
      ? "not-evaluable"
      : proveAgentNetlist(context.netlist, context.schematic).ok ? "valid" : "unproven";
  }
  const verdicts: ReplayContextVerdicts = {
    schematic: context.schematic === null ? "absent" : schematicValid ? "valid" : "invalid",
    board: boardVerdict,
    schematicHeadMark: context.schematicHeadMark === null
      ? "absent"
      : isWellFormedProposalScope({ tenantId: "replay", projectId: "replay", branchId: "replay", headMark: context.schematicHeadMark }) ? "valid" : "invalid",
    selection: context.selection === null
      ? "absent"
      : context.selection.refs.every((ref) => parseSelectionRef(ref) !== null) && (context.selection.primary === null || parseSelectionRef(context.selection.primary) !== null) ? "valid" : "invalid",
    netlist: netlistVerdict,
  };
  return { ok: true, context, verdicts };
}

// ─── Per-resource exact shape (key exhaustiveness) ───────────────────────────

function validateSchematicShape(value: unknown, issues: ContextIssues): void {
  if (value === null) return;
  if (!isRec(value)) { issues.push("context.schematic: must be null or a plain object"); return; }
  if (!exactContextKeys(value, SCHEMATIC_STATE_REQUIRED_KEYS, SCHEMATIC_STATE_OPTIONAL_KEYS, "context.schematic", issues)) return;
  exactElements(value.components, SCH_COMPONENT_REQUIRED_KEYS, SCH_COMPONENT_OPTIONAL_KEYS, "context.schematic.components", issues);
  exactElements(value.wires, WIRE_REQUIRED_KEYS, [], "context.schematic.wires", issues, (wire, label) => {
    exactElements(wire.vertices, POINT_REQUIRED_KEYS, [], `${label}.vertices`, issues);
  });
  if (value.netLabels !== undefined) {
    exactElements(value.netLabels, NET_LABEL_REQUIRED_KEYS, [], "context.schematic.netLabels", issues, (label, elementLabel) => {
      if (!isRec(label.position)) { issues.push(`${elementLabel}.position: must be a plain object`); return; }
      exactContextKeys(label.position, POINT_REQUIRED_KEYS, [], `${elementLabel}.position`, issues);
    });
  }
  if (value.kicadComponents !== undefined) {
    exactElements(value.kicadComponents, KICAD_COMPONENT_REQUIRED_KEYS, KICAD_COMPONENT_OPTIONAL_KEYS, "context.schematic.kicadComponents", issues);
  }
  if (value.pageSize !== undefined && typeof value.pageSize !== "string") issues.push("context.schematic.pageSize: must be a string");
}

/**
 * [B11.3] The board is validated against the GENERATED type graph at every
 * depth: unknown keys, wrong value types, cross-variant union fields, and
 * illegitimate dynamic record keys all produce a precise, redacted path.
 */
function validateBoardShape(value: unknown, issues: ContextIssues): void {
  if (value === null) return;
  if (!isRec(value)) { issues.push("context.board: must be null or a plain object"); return; }
  for (const issue of validateBoardAgainstTypeGraph(value)) issues.push(`context.${issue}`);
}

function validateHeadMarkShape(value: unknown, issues: ContextIssues): void {
  if (value === null) return;
  if (!isRec(value)) { issues.push("context.schematicHeadMark: must be null or a plain object"); return; }
  exactContextKeys(value, HEAD_MARK_REQUIRED_KEYS, [], "context.schematicHeadMark", issues);
}

function validateSelectionShape(value: unknown, issues: ContextIssues): void {
  if (value === null) return;
  if (!isRec(value)) { issues.push("context.selection: must be null or a plain object"); return; }
  if (!exactContextKeys(value, SELECTION_REQUIRED_KEYS, [], "context.selection", issues)) return;
  exactElements(value.refs, [], SELECTION_REF_KEYS, "context.selection.refs", issues);
  if (value.primary !== null) {
    if (!isRec(value.primary)) { issues.push("context.selection.primary: must be null or a plain object"); return; }
    exactContextKeys(value.primary, [], SELECTION_REF_KEYS, "context.selection.primary", issues);
  }
}

function validateNetlistShape(value: unknown, issues: ContextIssues): void {
  if (value === null) return;
  if (!isRec(value)) { issues.push("context.netlist: must be null or a plain object"); return; }
  if (!exactContextKeys(value, NETLIST_REQUIRED_KEYS, [], "context.netlist", issues)) return;
  exactElements(value.components, NETLIST_COMPONENT_REQUIRED_KEYS, [], "context.netlist.components", issues, (component, label) => {
    exactElements(component.pins, NETLIST_PIN_REQUIRED_KEYS, NETLIST_PIN_OPTIONAL_KEYS, `${label}.pins`, issues);
  });
  exactElements(value.nets, NETLIST_NET_REQUIRED_KEYS, [], "context.netlist.nets", issues, (net, label) => {
    exactElements(net.nodes, NETLIST_NODE_REQUIRED_KEYS, [], `${label}.nodes`, issues);
    if (!Array.isArray(net.endpointKeys)) issues.push(`${label}.endpointKeys: must be an array`);
  });
}
