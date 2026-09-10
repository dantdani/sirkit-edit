/**
 * [B17-D] Semantic VIEW TARGETS — how a view command names WHAT to show.
 *
 * A target is always a stable identity: a reference designator or object id,
 * an object reference, a net (by id or name), a world point the caller
 * already holds in board units, or the session's CURRENT selection. Nothing
 * here is a screen coordinate: "this component" resolves from the versioned
 * selection the issuer observed, and a stale or absent selection is refused
 * instead of guessed.
 */
import { engineeringDigest } from "../engineering/stable";
import type { SelectionRef } from "../pcb/edit/commands";
import type { ViewRefusal } from "./types";

export type ViewTarget =
  /** A component by reference designator or stable id. */
  | { kind: "component"; ref: string }
  /** One object by its selection reference (footprint, pad, track, via, zone, text, dimension). */
  | { kind: "object"; ref: SelectionRef }
  /** A net by id or (sheet) name. */
  | { kind: "net"; netId?: number; name?: string }
  /** A point in the editor's world units (board nm / sheet px) the caller already holds — never a screen coordinate. */
  | { kind: "point"; x: number; y: number }
  /** The session's current selection (all refs), versioned by the view revision / selection digest. */
  | { kind: "selection" }
  /** "This component": the PRIMARY selected item, versioned the same way. */
  | { kind: "primary" };

export const VIEW_TARGET_KINDS = ["component", "object", "net", "point", "selection", "primary"] as const;

export const SELECTION_SNAPSHOT_SCHEMA = "sirkit.selection-snapshot.v1" as const;

/** The versioned selection every editor session reports: refs, the primary, and the SAME digest the captured editor context carries. */
export interface ViewSelection {
  refs: SelectionRef[];
  primary: SelectionRef | null;
  digest: string;
}

export function selectionDigest(refs: readonly SelectionRef[], primary: SelectionRef | null): string {
  return engineeringDigest({ schema: SELECTION_SNAPSHOT_SCHEMA, refs, primary });
}

export function viewSelection(refs: readonly SelectionRef[], primary: SelectionRef | null | undefined): ViewSelection {
  const list = [...refs];
  const head = primary ?? null;
  return { refs: list, primary: head, digest: selectionDigest(list, head) };
}

export const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const OBJECT_KINDS = ["via", "track", "zone", "text", "footprint", "dimension"] as const;

export const isSelectionRef = (value: unknown): value is SelectionRef =>
  isObject(value) && typeof value.kind === "string"
  && (value.kind === "pad"
    ? typeof value.footprintId === "string" && value.footprintId.length > 0 && typeof value.padNumber === "string" && value.padNumber.length > 0
    : typeof value.id === "string" && value.id.length > 0 && (OBJECT_KINDS as readonly string[]).includes(value.kind));

const finiteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** Exact validation of a target payload; anything else is a payload refusal message. */
export function validateViewTarget(value: unknown): { ok: true; value: ViewTarget } | { ok: false; message: string } {
  if (!isObject(value) || typeof value.kind !== "string") return { ok: false, message: `target must be an object with kind one of ${VIEW_TARGET_KINDS.join(", ")}` };
  switch (value.kind) {
    case "component":
      return typeof value.ref === "string" && value.ref.trim().length > 0 ? { ok: true, value: { kind: "component", ref: value.ref.trim() } } : { ok: false, message: "target.ref (reference designator or id) is required" };
    case "object":
      return isSelectionRef(value.ref) ? { ok: true, value: { kind: "object", ref: value.ref } } : { ok: false, message: "target.ref must be a selection reference" };
    case "net": {
      const hasId = finiteNumber(value.netId) && Number.isInteger(value.netId) && value.netId > 0;
      const hasName = typeof value.name === "string" && value.name.trim().length > 0;
      if (!hasId && !hasName) return { ok: false, message: "target.netId (> 0) or target.name is required" };
      return { ok: true, value: { kind: "net", ...(hasId ? { netId: value.netId as number } : {}), ...(hasName ? { name: (value.name as string).trim() } : {}) } };
    }
    case "point":
      return finiteNumber(value.x) && finiteNumber(value.y) ? { ok: true, value: { kind: "point", x: value.x, y: value.y } } : { ok: false, message: "target.x and target.y must be finite numbers in the editor's world units" };
    case "selection":
      return { ok: true, value: { kind: "selection" } };
    case "primary":
      return { ok: true, value: { kind: "primary" } };
    default:
      return { ok: false, message: `unknown target kind ${String(value.kind)}` };
  }
}

/** Whether a target's meaning depends on the selection the issuer observed (stale revision → refuse, never rebase). */
export const isSelectionRelative = (target: ViewTarget): boolean => target.kind === "selection" || target.kind === "primary";

/** The versioning rule every editor applies before reading "the selection": a stale revision or a stale captured digest refuses. */
export function checkSelectionVersion(input: { rebased: boolean; expectedSelectionDigest?: string; currentDigest: string }): ViewRefusal | null {
  if (input.rebased) return { code: "VS_STALE_REVISION", message: "the selection-relative target refers to a view revision that moved on; re-read the selection and issue the command again" };
  if (input.expectedSelectionDigest !== undefined && input.expectedSelectionDigest !== input.currentDigest) {
    return { code: "VS_STALE_REVISION", message: "the selection changed since the editor context was captured; re-read the selection and issue the command again" };
  }
  return null;
}

/**
 * Resolve a selection-relative target against the CURRENT versioned selection.
 * `rebased` is the bus's verdict that the issuer's revision is stale; an
 * optional `selectionDigest` (the digest a captured editor context carried)
 * must match the current selection. Absent selection → VS_UNAVAILABLE.
 */
export function resolveSelectionTarget(input: {
  target: ViewTarget;
  selection: ViewSelection;
  rebased: boolean;
  expectedSelectionDigest?: string;
}): { ok: true; refs: SelectionRef[] } | { ok: false; refusal: ViewRefusal } {
  const { target, selection } = input;
  const stale = checkSelectionVersion({ rebased: input.rebased, expectedSelectionDigest: input.expectedSelectionDigest, currentDigest: selection.digest });
  if (stale) return { ok: false, refusal: stale };
  if (target.kind === "primary") {
    if (!selection.primary) return { ok: false, refusal: { code: "VS_UNAVAILABLE", message: "no current selection: 'this component' cannot be resolved" } };
    return { ok: true, refs: [selection.primary] };
  }
  if (selection.refs.length === 0) return { ok: false, refusal: { code: "VS_UNAVAILABLE", message: "no current selection" } };
  return { ok: true, refs: [...selection.refs] };
}

/** The optional `selectionDigest` field a selection-relative payload may carry. */
export function readSelectionDigest(value: Record<string, unknown>): { ok: true; value: string | undefined } | { ok: false; message: string } {
  if (value.selectionDigest === undefined) return { ok: true, value: undefined };
  return typeof value.selectionDigest === "string" && /^[A-Za-z0-9:_-]{8,128}$/.test(value.selectionDigest) ? { ok: true, value: value.selectionDigest } : { ok: false, message: "selectionDigest must be the digest string of a captured selection" };
}
