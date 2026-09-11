/**
 * [B18-B] EXPLICIT-REQUEST PROOF (D18-5): `explicitUserRequest` is never a
 * model claim. It is proven only when a pure, per-family grammar parses the
 * WHOLE last user turn as ONE imperative clause, DERIVES the operations
 * itself against the verified board through the same builder the plan used,
 * and the derived operations digest equals the plan's digest byte for byte.
 *
 * Anything the grammar cannot derive (a pronoun, a vague magnitude, a second
 * verb, a negation, a question, a condition, pasted text, a superset) is
 * simply UNPROVEN — which degrades to preview + confirmation, never to
 * execution. A false negative costs a click; a false positive would let a
 * model-chosen operation commit — so the grammar is deliberately narrow.
 *
 * B18-B ships the `pcb.move-footprint` reference grammar; B18-C adds one
 * grammar per family with the same negative test set.
 */
import type { PcbBoard } from "../pcb/types";
import { canonicalReference } from "../pcb/integrity";
import { buildExecutionOperations, type ExecutionPlan } from "./execution-operations";
import { MAX_INSTRUCTION_EXCERPT, type ExecutionFamily, type ExecutionGrantExplicitness } from "./execution-grant";

/** [B18-C I5] 1.1.0: + rotate (angle with a REQUIRED direction word) and flip (onto a named side) for pcb.rotate-side-footprint. */
export const EXPLICIT_GRAMMAR_VERSION = "1.1.0";

const REFUSAL_TOKENS = /\b(don'?t|do not|never|not|instead|but|rather|except|unless|if|later|afterwards?|after|before|first|then|what if|would|could|should|can you|maybe|perhaps|probably|and then|also)\b|\?|\n|\r/i;
const UNIT_NM: Readonly<Record<string, number>> = Object.freeze({ mm: 1_000_000, millimeter: 1_000_000, millimeters: 1_000_000, millimetre: 1_000_000, millimetres: 1_000_000, um: 1_000, µm: 1_000, micron: 1_000, microns: 1_000, mil: 25_400, mils: 25_400, cm: 10_000_000 });
/** Board coordinates: x grows to the right, y grows DOWN (KiCad convention), so "up" is −y. */
const DIRECTIONS: Readonly<Record<string, { x: number; y: number }>> = Object.freeze({ right: { x: 1, y: 0 }, left: { x: -1, y: 0 }, up: { x: 0, y: -1 }, down: { x: 0, y: 1 } });

/** Positional groups: 1 = reference designator, 2 = magnitude, 3 = unit, 4 = direction (the whole turn must match). */
const MOVE_PATTERN = /^(?:please\s+)?(?:move|shift|nudge)\s+([a-z][a-z0-9]*\d)\s+(?:by\s+)?(\d+(?:\.\d+)?)\s*(mm|millimet(?:er|re)s?|um|µm|microns?|mils?|cm)\s+(?:to\s+the\s+|towards?\s+the\s+)?(right|left|up|down)$/i;
/** [B18-C I5] 1 = reference designator, 2 = whole degrees, 3 = the REQUIRED direction word. */
const ROTATE_PATTERN = /^(?:please\s+)?(?:rotate|turn)\s+([a-z][a-z0-9]*\d)\s+(?:by\s+)?(\d{1,3})\s*(?:°|degrees?|deg)?\s+(clockwise|cw|counter-?clockwise|anti-?clockwise|ccw)$/i;
/** [B18-C I5] 1 = reference designator, 2 = the side. */
const FLIP_PATTERN = /^(?:please\s+)?(?:flip|put)\s+([a-z][a-z0-9]*\d)\s+(?:on)?to\s+the\s+(top|bottom)(?:\s+(?:side|layer))?$/i;

export interface ExplicitProofInput {
  userMessage: string;
  family: ExecutionFamily;
  board: PcbBoard;
  /** The plan's operations digest (from the same builder). */
  operationsDigest: string;
}

export interface ExplicitProof extends ExecutionGrantExplicitness { reason: string; excerpt: string }

function unproven(reason: string, excerpt: string, grammarId: string): ExplicitProof {
  return { proven: false, grammarId, grammarVersion: EXPLICIT_GRAMMAR_VERSION, coverage: "unproven", derivedOperationsDigest: null, reason, excerpt };
}

/** Normalize the whole turn: one line, collapsed whitespace, one trailing full stop allowed. */
function normalizeInstruction(text: string): string {
  return text.replace(/\s+/g, " ").trim().replace(/[.!]+$/, "").trim();
}

/** Derive the plan the grammar itself reads from the sentence; null when the sentence is not ONE whole clause of this family. */
export function deriveExplicitPlan(userMessage: string, family: ExecutionFamily, board: PcbBoard): { plan: ExecutionPlan; excerpt: string } | { refusal: string; excerpt: string } {
  const excerpt = userMessage.replace(/\s+/g, " ").trim().slice(0, MAX_INSTRUCTION_EXCERPT);
  if (userMessage.length > MAX_INSTRUCTION_EXCERPT) return { refusal: `the instruction exceeds ${MAX_INSTRUCTION_EXCERPT} characters`, excerpt };
  if (/[\n\r]/.test(userMessage.trim())) return { refusal: "the instruction spans several lines", excerpt };
  const normalized = normalizeInstruction(userMessage);
  if (normalized.length === 0) return { refusal: "the instruction is empty", excerpt };
  if (REFUSAL_TOKENS.test(normalized)) return { refusal: "the instruction carries a negation, question, condition, deferral or a second clause", excerpt };
  if (family === "pcb.rotate-side-footprint") return deriveRotateSide(normalized, board, excerpt);
  if (family !== "pcb.move-footprint") return { refusal: `no explicit-request grammar exists for ${family} yet`, excerpt };
  const match = MOVE_PATTERN.exec(normalized);
  if (!match) return { refusal: "the instruction is not one whole move clause (verb, reference designator, magnitude with unit, direction)", excerpt };
  const [, ref, magnitude, unit, direction] = match;
  // [B18-C review V2] the reference must name EXACTLY one footprint (references compare trimmed and uppercase): an
  // ambiguous reference is never an explicit request, whichever footprint the plan picked.
  const matches = board.footprints.filter((item) => canonicalReference(item.ref) === canonicalReference(ref!));
  if (matches.length === 0) return { refusal: `${ref} is not a reference designator on this board`, excerpt };
  if (matches.length > 1) return { refusal: `${ref} names ${matches.length} footprints on this board; the instruction is ambiguous`, excerpt };
  const footprint = matches[0]!;
  const unitNm = UNIT_NM[unit!.toLowerCase()];
  const vector = DIRECTIONS[direction!.toLowerCase()];
  if (!unitNm || !vector) return { refusal: "unknown unit or direction", excerpt };
  const deltaNm = Math.round(Number(magnitude) * unitNm);
  if (!Number.isSafeInteger(deltaNm) || deltaNm <= 0) return { refusal: "the magnitude is not a positive distance", excerpt };
  return { plan: { family: "pcb.move-footprint", moves: [{ footprintId: footprint.id, x: footprint.at.x + vector.x * deltaNm, y: footprint.at.y + vector.y * deltaNm }] }, excerpt };
}

/** [B18-C I5] Rotate BY a whole angle with a REQUIRED direction word, or flip onto a named side — one whole clause — derived to
 *  an ABSOLUTE plan in the editor's own convention (positive = counter-clockwise on screen, so a clockwise turn subtracts). */
function deriveRotateSide(normalized: string, board: PcbBoard, excerpt: string): { plan: ExecutionPlan; excerpt: string } | { refusal: string; excerpt: string } {
  const rotate = ROTATE_PATTERN.exec(normalized);
  const flip = rotate ? null : FLIP_PATTERN.exec(normalized);
  if (!rotate && !flip) return { refusal: "the instruction is not one whole rotate clause (verb, reference designator, angle, direction word) or flip clause (verb, reference designator, top or bottom)", excerpt };
  const ref = (rotate ?? flip)![1]!;
  // [B18-C review V2] the reference must name EXACTLY one footprint.
  const matches = board.footprints.filter((item) => canonicalReference(item.ref) === canonicalReference(ref));
  if (matches.length === 0) return { refusal: `${ref} is not a reference designator on this board`, excerpt };
  if (matches.length > 1) return { refusal: `${ref} names ${matches.length} footprints on this board; the instruction is ambiguous`, excerpt };
  const footprint = matches[0]!;
  if (rotate) {
    const angle = Number(rotate[2]);
    if (!Number.isSafeInteger(angle) || angle < 1 || angle > 359) return { refusal: "the angle is not a whole number of degrees from 1 to 359", excerpt };
    const clockwise = /^(?:clockwise|cw)$/i.test(rotate[3]!);
    const rotationDeg = (((footprint.rotationDeg + (clockwise ? -angle : angle)) % 360) + 360) % 360;
    return { plan: { family: "pcb.rotate-side-footprint", targets: [{ footprintId: footprint.id, rotationDeg, side: footprint.side }] }, excerpt };
  }
  const side = flip![2]!.toLowerCase() as "top" | "bottom";
  return { plan: { family: "pcb.rotate-side-footprint", targets: [{ footprintId: footprint.id, rotationDeg: footprint.rotationDeg, side }] }, excerpt };
}

/** The proof: derive, build with the SAME builder, compare digests byte for byte. */
export function proveExplicitUserRequest(input: ExplicitProofInput): ExplicitProof {
  const grammarId = input.family;
  const derived = deriveExplicitPlan(input.userMessage, input.family, input.board);
  if ("refusal" in derived) return unproven(derived.refusal, derived.excerpt, grammarId);
  const built = buildExecutionOperations(input.board, derived.plan);
  if (!built.ok) return unproven(`the derived plan does not build: ${built.message}`, derived.excerpt, grammarId);
  const proven = built.operationsDigest === input.operationsDigest;
  return {
    proven,
    grammarId,
    grammarVersion: EXPLICIT_GRAMMAR_VERSION,
    coverage: proven ? "whole-message" : "unproven",
    derivedOperationsDigest: built.operationsDigest,
    reason: proven ? "the whole instruction derives exactly the planned operations" : "the instruction derives different operations than the plan (target, magnitude, direction or count differ)",
    excerpt: derived.excerpt,
  };
}
