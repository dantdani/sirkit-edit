/**
 * Net-class model (PCB Stage 10) — PINNED: Stages 7 (routing), 9 (Freerouting
 * DSN), and 12 (DRC) consume `getNetClass(board, netId)` for per-net
 * trackWidth/clearance/viaSize/viaDrill.
 *
 * Three MVP classes only: Default / Power / HighCurrent. The auto-classifier
 * (netclass-rules.ts) sets the base assignment per net; AI/manual rule deltas
 * layer on top via `applyRuleDeltas`. Everything here is pure and deterministic.
 *
 * PERSISTENCE: `BoardNetClassing` lives on `PcbBoard.netClassing` (optional,
 * additive) and rides the board's existing localStorage persistence — no
 * migration; a board without it reads as all-Default.
 */

import type { PcbBoard } from "./types";

export type NetClassId = "Default" | "Power" | "HighCurrent";

export interface NetClass {
  id: NetClassId;
  name: string; // display name
  trackWidth: number; // nm
  clearance: number; // nm
  viaSize: number; // outer diameter, nm
  viaDrill: number; // nm
  explanation: string; // one-line "why" (populated for non-Default assignments)
}

/** The three MVP classes. Values match Stage 7's hard-coded defaults for Default. */
export const DEFAULT_CLASSES: Record<NetClassId, Omit<NetClass, "explanation">> = {
  Default: { id: "Default", name: "Default", trackWidth: 250_000, clearance: 200_000, viaSize: 800_000, viaDrill: 400_000 },
  Power: { id: "Power", name: "Power", trackWidth: 500_000, clearance: 250_000, viaSize: 900_000, viaDrill: 450_000 },
  HighCurrent: { id: "HighCurrent", name: "High current", trackWidth: 1_200_000, clearance: 300_000, viaSize: 1_200_000, viaDrill: 600_000 },
};

/** A fully-specified user tweak on top of a class's defaults. */
export type NetClassOverride = Partial<Omit<NetClass, "id" | "name" | "explanation">>;

export interface NetClassAssignment {
  classId: NetClassId;
  explanation: string;
  /** If set, these fields replace the class defaults for this net. */
  override?: NetClassOverride;
}

export interface RuleDeltaChange {
  className?: NetClassId;
  trackWidthNm?: number;
  clearanceNm?: number;
  viaSizeNm?: number;
  viaDrillNm?: number;
  appliesTo:
    | { kind: "class"; classId: NetClassId }
    | { kind: "nets"; netIds: number[] }
    | { kind: "namePattern"; regex: string };
}

export interface RuleDelta {
  id: string; // uuid; latest wins on conflict
  createdAt: string; // ISO
  source: "ai-brief" | "manual";
  brief?: string; // original user text if source === 'ai-brief'
  changes: RuleDeltaChange[];
  explanation: string; // human-readable
}

export interface BoardNetClassing {
  version: 1;
  /** Effective per-net class = auto-classified base with rule deltas layered on. */
  assignments: Record<number, NetClassAssignment>; // keyed by netId
  ruleDeltas: RuleDelta[]; // latest wins
  /**
   * The pure auto-classification (name + topology, NO deltas). Internal to
   * Stage 10 — consumers read `assignments`. Re-layering deltas always resets
   * `assignments` to a clone of this base first, so the effective state is a
   * deterministic function of (base, full sorted delta log) — independent of the
   * order applyRuleDeltas calls arrive in. `reclassifyBoard` populates it.
   */
  base?: Record<number, NetClassAssignment>;
}

// ── Effective class lookup (the pinned API) ──────────────────────────────────

/**
 * Effective class for a net: the assignment's class defaults with any override
 * merged on top, or `Default` when no assignment exists. Pure.
 */
export function getNetClass(board: PcbBoard, netId: number): NetClass {
  const assignment = board.netClassing?.assignments[netId];
  if (!assignment) return { ...DEFAULT_CLASSES.Default, explanation: "" };
  const base = DEFAULT_CLASSES[assignment.classId] ?? DEFAULT_CLASSES.Default;
  return { ...base, explanation: assignment.explanation, ...(assignment.override ?? {}) };
}

// ── Rule deltas ──────────────────────────────────────────────────────────────

export function ensureNetClassing(board: PcbBoard): BoardNetClassing {
  if (!board.netClassing) {
    board.netClassing = { version: 1, assignments: {}, ruleDeltas: [] };
  }
  return board.netClassing;
}

/** Deep-copy an assignment map. Works on plain objects and immer draft proxies. */
export function cloneAssignments(
  src: Record<number, NetClassAssignment>,
): Record<number, NetClassAssignment> {
  const out: Record<number, NetClassAssignment> = {};
  for (const [id, a] of Object.entries(src)) {
    out[Number(id)] = {
      classId: a.classId,
      explanation: a.explanation,
      ...(a.override ? { override: { ...a.override } } : {}),
    };
  }
  return out;
}

/** ISO strings sort chronologically as plain strings; ties keep insertion order. */
function byCreatedAt(a: RuleDelta, b: RuleDelta): number {
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

/** class (broadest) → nets → namePattern, so specific changes win (last-applied). */
const KIND_ORDER: Record<RuleDeltaChange["appliesTo"]["kind"], number> = {
  class: 0,
  nets: 1,
  namePattern: 2,
};

function compileRegex(src: string): RegExp | null {
  try {
    return new RegExp(src);
  } catch {
    return null;
  }
}

function resolveTargets(
  board: PcbBoard,
  assignments: Record<number, NetClassAssignment>,
  appliesTo: RuleDeltaChange["appliesTo"],
): number[] {
  if (appliesTo.kind === "class") {
    return board.nets
      .filter((n) => n.id !== 0 && assignments[n.id]?.classId === appliesTo.classId)
      .map((n) => n.id);
  }
  if (appliesTo.kind === "nets") {
    const valid = new Set(board.nets.map((n) => n.id));
    return appliesTo.netIds.filter((id) => id !== 0 && valid.has(id));
  }
  const re = compileRegex(appliesTo.regex);
  if (!re) return [];
  return board.nets.filter((n) => n.id !== 0 && re.test(n.name)).map((n) => n.id);
}

function applyChange(
  assignments: Record<number, NetClassAssignment>,
  netId: number,
  change: RuleDeltaChange,
  delta: RuleDelta,
): void {
  const existing = assignments[netId];
  const a: NetClassAssignment = existing ?? { classId: change.className ?? "Default", explanation: delta.explanation };
  if (change.className) a.classId = change.className;
  const override: NetClassOverride = { ...(a.override ?? {}) };
  if (change.trackWidthNm !== undefined) override.trackWidth = change.trackWidthNm;
  if (change.clearanceNm !== undefined) override.clearance = change.clearanceNm;
  if (change.viaSizeNm !== undefined) override.viaSize = change.viaSizeNm;
  if (change.viaDrillNm !== undefined) override.viaDrill = change.viaDrillNm;
  if (Object.keys(override).length > 0) a.override = override;
  a.explanation = delta.explanation;
  assignments[netId] = a;
}

/**
 * Layer the given deltas onto the current assignments (does NOT append to
 * `ruleDeltas`). Deltas apply in createdAt order; within a delta, changes apply
 * class→nets→namePattern so specific scopes override broad ones. Exported for
 * the re-classify path (netclass-rules.reclassifyBoard).
 */
export function layerRuleDeltas(board: PcbBoard, deltas: RuleDelta[]): void {
  const nc = ensureNetClassing(board);
  for (const delta of [...deltas].sort(byCreatedAt)) {
    const changes = [...delta.changes].sort(
      (x, y) => KIND_ORDER[x.appliesTo.kind] - KIND_ORDER[y.appliesTo.kind],
    );
    for (const change of changes) {
      for (const netId of resolveTargets(board, nc.assignments, change.appliesTo)) {
        applyChange(nc.assignments, netId, change, delta);
      }
    }
  }
}

/**
 * Append `deltas` to the board's rule-delta log, RESET the assignments to the
 * pure auto-classified base, then re-layer the ENTIRE log (sorted by createdAt).
 * Resetting to base first is what makes the result order-independent: class-
 * scoped changes resolve their targets against the base classification, not
 * against assignments already drifted by earlier calls — so the highest-
 * createdAt delta wins on any conflict regardless of the order calls arrive in
 * (the pinned "latest wins" semantics). Mutates `board.netClassing`.
 *
 * If no base has been recorded yet (auto-classify never ran), the base is empty:
 * name/net/pattern-scoped changes still apply; class-scoped changes match
 * nothing (they need a prior classification). Callers that want name+topology
 * classification too should go through `reclassifyBoard` (the hook does).
 */
export function applyRuleDeltas(board: PcbBoard, deltas: RuleDelta[]): void {
  const nc = ensureNetClassing(board);
  nc.ruleDeltas = [...nc.ruleDeltas, ...deltas];
  nc.assignments = cloneAssignments(nc.base ?? {});
  layerRuleDeltas(board, nc.ruleDeltas);
}
