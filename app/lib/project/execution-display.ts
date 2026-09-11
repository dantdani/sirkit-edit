/**
 * [B18-D I3] SAFE, pure display text for AI executions (artifacts/ai-control-plane-b18/chat-execution-ux.md §1, §5).
 * It turns server data the page already holds — a received public grant, a settlement summary, a ritual outcome, a
 * recovery action — into plain sentences. It carries NO authority: nothing here is sent back to the server, it imports
 * only types and the tier titles, and every function accepts ANY input without throwing (an unknown or hostile shape
 * renders as "not displayable"). It never claims a board passes its checks or is fit to build.
 */
import { PERMISSION_TIER_TITLES, type PermissionTier } from "../engineering/permission-tiers";
import type { PublicExecutionGrant } from "../engineering/execution-grant";

const NM_PER_MM = 1_000_000;
const MAX_TEXT = 64;

/** Resolves an internal object id to what the user sees (a reference designator), or null. */
export type RefOf = (objectId: string) => string | null;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const short = (value: unknown, max = 40): string => (typeof value === "string" ? value.slice(0, max) : "?");

/** Integer nanometres → millimetres with three decimals ("?" for anything else). */
export function formatMm(nm: unknown): string {
  return typeof nm === "number" && Number.isFinite(nm) ? (nm / NM_PER_MM).toFixed(3) : "?";
}
const point = (value: unknown): string => (isObject(value) ? `(${formatMm(value.x)}, ${formatMm(value.y)}) mm` : "(?)");
const quoted = (value: unknown): string => (typeof value === "string" ? JSON.stringify(value.slice(0, MAX_TEXT)) : "?");
const label = (refOf: RefOf | undefined, id: unknown, fallback: string): string => {
  if (typeof id !== "string") return "?";
  let ref: string | null = null;
  try { ref = refOf ? refOf(id) : null; } catch { ref = null; }
  return ref ?? `${fallback} ${id.slice(0, 12)}`;
};
/** An item's reference where the board knows one, else its short id (no kind word: the sentence already names it). */
const idLabel = (refOf: RefOf | undefined, id: unknown): string => {
  if (typeof id !== "string") return "?";
  let ref: string | null = null;
  try { ref = refOf ? refOf(id) : null; } catch { ref = null; }
  return ref ?? id.slice(0, 12);
};

function describeSilk(item: unknown): string {
  if (!isObject(item)) return "a silkscreen item (not displayable)";
  if (item.kind === "text") {
    const parts = [`silkscreen text ${quoted(item.text)} at ${point(item.position)} on the ${item.layer === "silkBottom" ? "bottom" : "top"}, ${formatMm(item.heightNm)} mm high`];
    // [B18-D review] every field an update can change is shown (the runbook's "exact proposed operations")
    if (typeof item.strokeWidthNm === "number") parts.push(`stroke ${formatMm(item.strokeWidthNm)} mm`);
    if (typeof item.rotationDeg === "number" && Number.isFinite(item.rotationDeg)) parts.push(`rotation ${item.rotationDeg}°`);
    if (typeof item.mirror === "boolean") parts.push(item.mirror ? "mirrored" : "not mirrored");
    if (item.anchor === "left" || item.anchor === "center" || item.anchor === "right") parts.push(`anchored ${item.anchor}`);
    return parts.join(", ");
  }
  return `a silkscreen ${short(item.kind, 20)} item`;
}
function describeDimension(value: unknown): string {
  if (!isObject(value)) return "a dimension (not displayable)";
  const kind = typeof value.kind === "string" ? `${value.kind.slice(0, 20)} ` : "";
  const parts = [`a ${kind}dimension from ${point(value.a)} to ${point(value.b)}`];
  // [B18-D review] every field an update can change is shown (an update may change only the style)
  if (typeof value.offsetNm === "number") parts.push(`offset ${formatMm(value.offsetNm)} mm`);
  if (typeof value.layer === "string") parts.push(`on ${short(value.layer, 20)}`);
  if (value.unit === "mm" || value.unit === "in") parts.push(`in ${value.unit}${typeof value.precision === "number" ? ` to ${value.precision} decimals` : ""}`);
  if (typeof value.textHeightNm === "number") parts.push(`text ${formatMm(value.textHeightNm)} mm`);
  if (typeof value.strokeWidthNm === "number") parts.push(`stroke ${formatMm(value.strokeWidthNm)} mm`);
  return parts.join(", ");
}

/** One digest-covered operation as a sentence (never throws; an unknown kind is "not displayable"). */
export function describeOperation(operation: unknown, refOf?: RefOf): string {
  try {
    if (!isObject(operation)) return "operation (not displayable)";
    switch (operation.kind) {
      case "move_footprint": {
        const parts = [`${label(refOf, operation.footprintId, "footprint")} at ${point(operation.at)}`];
        if (typeof operation.rotationDeg === "number" && Number.isFinite(operation.rotationDeg)) parts.push(`rotation ${operation.rotationDeg}°`);
        if (operation.side === "top" || operation.side === "bottom") parts.push(`on the ${operation.side} side`);
        return `Place ${parts.join(", ")}`;
      }
      case "add_silk": return `Add ${describeSilk(operation.item)}`;
      case "update_silk": return `Change silkscreen item ${idLabel(refOf, operation.silkId)} to ${describeSilk(operation.replace)}`;
      case "remove_silk": return `Remove silkscreen item ${idLabel(refOf, operation.silkId)}`;
      case "add_dimension": return `Add ${describeDimension(operation.dimension)}`;
      case "update_dimension": return `Change dimension ${idLabel(refOf, operation.dimensionId)} to ${describeDimension(operation.replace)}`;
      case "remove_dimension": return `Remove dimension ${idLabel(refOf, operation.dimensionId)}`;
      default: return `operation ${short(operation.kind)} (not displayable)`;
    }
  } catch {
    return "operation (not displayable)";
  }
}

/** A replay grant carries a reference, not operations: the server selects them from the durable record. */
export function describeReplay(replay: unknown): string {
  if (!isObject(replay)) return "undo or redo (not displayable)";
  const direction = replay.direction === "redo" ? "Redo" : replay.direction === "undo" ? "Undo" : "Undo or redo";
  return `${direction} of transaction ${short(replay.referencedTransactionId, 60)} — the server selects its operations from the durable record`;
}

/** The exact operations the grant covers, as sentences (at most 16, like the grant itself). */
export function operationLines(grant: PublicExecutionGrant, refOf?: RefOf): string[] {
  try {
    const proposal = grant.binding.proposal as unknown as Record<string, unknown>;
    if (proposal.replay !== undefined) return [describeReplay(proposal.replay)];
    const operations = Array.isArray(proposal.operations) ? proposal.operations.slice(0, 16) : [];
    return operations.length > 0 ? operations.map((operation) => describeOperation(operation, refOf)) : ["no operations (not displayable)"];
  } catch {
    return ["operations (not displayable)"];
  }
}

/** The resolved targets (display only: the ids are internal; nets are named, never "none affected"). */
export function targetLines(grant: PublicExecutionGrant, refOf?: RefOf): { objects: string[]; nets: string } {
  try {
    const targets = grant.binding.targets as unknown as Record<string, unknown>;
    const ids = Array.isArray(targets.objectIds) ? targets.objectIds.slice(0, 16) : [];
    const kinds = Array.isArray(targets.kinds) ? targets.kinds : [];
    const kindAt = (index: number): string => String((kinds.length === ids.length ? kinds[index] : kinds[0]) ?? "item");
    const objects = ids.map((id, index) => {
      const kind = kindAt(index);
      if (kind === "transaction") return `the change ${short(id, 60)}`;
      return label(refOf, id, kind);
    });
    const nets = Array.isArray(targets.netIds) && targets.netIds.length > 0 ? `Nets named: ${targets.netIds.slice(0, 16).map((net) => String(net)).join(", ")}` : "Nets named: none";
    return { objects: objects.length > 0 ? objects : ["(no named object)"], nets };
  } catch {
    return { objects: ["(not displayable)"], nets: "Nets named: (not displayable)" };
  }
}

export const TIER_SHORT: Readonly<Record<PermissionTier, string>> = Object.freeze({
  0: "Tier 0 · read / view",
  1: "Tier 1 · reversible edit",
  2: "Tier 2 · proposal for your review",
  3: "Tier 3 · never done by the assistant",
});

/** The B18-A tier vocabulary for display (null for anything that is not a tier). */
export function tierLabel(tier: unknown): { short: string; title: string } | null {
  if (tier !== 0 && tier !== 1 && tier !== 2 && tier !== 3) return null;
  return { short: TIER_SHORT[tier], title: PERMISSION_TIER_TITLES[tier] };
}

/** Why a confirmation is — or is not — required, from the grant's own decision, proof and autonomy. */
export function confirmationReason(grant: PublicExecutionGrant, note?: string | null): string {
  try {
    const operation = grant.binding.operation;
    const explicit = grant.binding.instruction.explicit;
    const revision = typeof operation.autonomy?.revision === "number" ? operation.autonomy.revision : "?";
    if (operation.decision === "execute_explicit") {
      return `Not required — your whole message was exactly this request (the ${short(explicit.grammarId, 60)} grammar, version ${short(explicit.grammarVersion, 20)}), and the project runs exact requests directly (execute_explicit_tier1, setting revision ${revision}).`;
    }
    if (typeof note === "string" && note.trim().length > 0) return `Required — ${note.trim().slice(0, 300)}`;
    if (operation.autonomy?.mode === "execute_explicit_tier1") return "Required — your message was not provably exactly this change, so the assistant asks first.";
    return `Required — this project asks before every AI change (proposal_only, setting revision ${revision}).`;
  } catch {
    return "Required — confirm the exact change on the card.";
  }
}

const NOTHING_CHANGED = "Nothing was changed.";
const REFUSALS: Readonly<Record<string, { headline: string; next: string }>> = Object.freeze({
  "stale-revision": { headline: `Not made — the board changed since the assistant prepared it. ${NOTHING_CHANGED}`, next: "Ask again." },
  "stale-history": { headline: `Not made — the board's history moved since the assistant prepared it. ${NOTHING_CHANGED}`, next: "Ask again." },
  "stale-lineage": { headline: `Not made — the editing session was replaced since the assistant prepared it. ${NOTHING_CHANGED}`, next: "Ask again." },
  "stale-selection": { headline: `Not made — the selection changed since the assistant prepared it. ${NOTHING_CHANGED}`, next: "Ask again." },
  "policy-mismatch": { headline: `Not made — the active design-rule preset differs from the one the change was checked against. ${NOTHING_CHANGED}`, next: "Switch the preset back, or ask again." },
  "recompile-mismatch": { headline: `Not made — the change no longer compiles to exactly what was shown. ${NOTHING_CHANGED}`, next: "Ask again." },
  "grant-invalid": { headline: `Not made — the change failed its checks. ${NOTHING_CHANGED}`, next: "Ask again." },
  "grant-expired": { headline: `Not made — the change expired before it was made. ${NOTHING_CHANGED}`, next: "Ask again." },
  "confirmation-required": { headline: `Not made — this change needs your confirmation on the card. ${NOTHING_CHANGED}`, next: "Confirm it on the card, or ask again." },
  "session-superseded": { headline: `Not made — the board has no active editing session. ${NOTHING_CHANGED}`, next: "Open the PCB editor and ask again." },
  "foreign-scope": { headline: `Not made — the change belongs to another project, branch or board. ${NOTHING_CHANGED}`, next: "Ask again in this project." },
  "already-in-flight": { headline: "Already running — this change is being made right now.", next: "Wait for its result." },
  "identity-poisoned": { headline: `Refused — an earlier attempt at this exact change could not be verified. ${NOTHING_CHANGED}`, next: "Ask again for a fresh change." },
  "recovery-required": { headline: "Not finished — the outcome must be recovered from the durable records.", next: "Reload the editor; recovery settles it." },
  "consume-refused": { headline: `Not made — the server refused the change (it was cancelled, expired or altered). ${NOTHING_CHANGED}`, next: "Ask again." },
  "commit-rejected": { headline: `Not made — the editor's canonical executor refused the change. ${NOTHING_CHANGED}`, next: "Ask again." },
  "execution-failed": { headline: `Not made — the change failed before it was applied. ${NOTHING_CHANGED}`, next: "Ask again." },
  "precheck-refused": { headline: `Not made — the editor's live check refused it. ${NOTHING_CHANGED}`, next: "Ask again once that is resolved." }, // [B18-D review]
});

/** The ritual's refusal as a headline and a next step. `changed` wins over every code: the board MAY have changed. */
export function refusalSentence(code: unknown, changed: boolean): { headline: string; next: string } {
  if (changed === true) return { headline: "The change LANDED but could not be verified — the board MAY have changed.", next: "Check the board and the revision history; the editor's Undo restores the previous board." };
  return (typeof code === "string" ? REFUSALS[code] : undefined) ?? { headline: `Not made. ${NOTHING_CHANGED}`, next: "Ask again." };
}

const RETIREMENTS: Readonly<Record<string, string>> = Object.freeze({
  expired: "it expired before it was made",
  cancelled_by_user: "you cancelled it",
  run_cancelled: "the chat run was stopped",
  run_unsettled: "the editor did not report in time",
  principal_changed: "you signed in as someone else",
  session_changed: "your browser session changed",
  membership_changed: "your project membership changed",
  role_changed: "your project role changed",
  scope_changed: "the project or branch changed",
  autonomy_changed: "the project's autonomy setting changed",
  revision_drift: "the board changed",
  history_drift: "the board's history moved",
  lineage_drift: "the editing session was replaced",
  selection_stale: "the selection changed",
  proposal_altered: "the change was altered after it was issued",
  confirmation_missing: "it needed your confirmation",
  tier_exceeded: "it is no longer a reversible (Tier 1) change",
  kind_not_allowed: "it contained an operation outside its family",
  superseded_by_new_grant: "a newer change replaced it",
  session_superseded: "the editing session was replaced",
  commit_rejected: "the editor refused it",
  recovery_required: "its outcome had to be recovered",
  consumed_unsettled: "it was started but never reported",
});

/** A server retirement reason as a sentence. */
export function retirementSentence(reason: unknown): string {
  const why = typeof reason === "string" ? RETIREMENTS[reason] : undefined;
  return `Not made — ${why ?? "the server retired it"}. ${NOTHING_CHANGED}`;
}

const RECOVERIES: Readonly<Record<string, string>> = Object.freeze({
  "adopted-and-settled": "Recovered: an AI change that landed before an interruption was verified from the durable records and reported.",
  "settled-from-receipt": "Recovered: the server record of a finished AI change was completed.",
  "abandoned-not-committed": "Recovered: an AI change that never landed was closed. Nothing was changed.",
  "left-in-flight": "Still in progress — the change's own execution finishes it.",
  "left-issued": "Waiting — the change was never started; confirm or cancel it.",
  "refused-poisoned": "An AI change could not be verified during recovery — the board MAY have changed; check the board and the revision history.",
  unavailable: "Recovery could not read the records right now; it retries on the next load.",
});

/** A hydration-sweep action as a sentence. */
export function recoverySentence(action: unknown): string {
  return (typeof action === "string" ? RECOVERIES[action] : undefined) ?? "Recovery reported an unknown result; check the revision history.";
}

/** The checks the editor ran on the committed board (browser-attested; never a claim the board passes). */
export function checksLine(drc: unknown, presetId?: string | null): string {
  if (!isObject(drc) || typeof drc.ran !== "boolean") return "Checks: none reported — no design-rule claim.";
  if (!drc.ran) return "Checks: the design rule check did not run — no design-rule claim.";
  const errors = typeof drc.violations === "number" && Number.isSafeInteger(drc.violations) && drc.violations >= 0 ? drc.violations : "?";
  return `Checks: design rule check${presetId ? ` (${presetId.slice(0, 40)})` : ""}: ${errors} error${errors === 1 ? "" : "s"} (run by your editor; errors only).`;
}
