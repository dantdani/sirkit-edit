/**
 * [PR-C] A generated schematic proposal awaiting the human's approval survives a reload. The proposal is browser state
 * (never canonical): it is stored per project with the digest of the authoritative schematic it was produced against,
 * and it is offered again ONLY while that digest still matches; otherwise it is discarded as stale (the same rule the
 * approval itself enforces, B07.3). Approving or discarding clears it. Nothing here is authority: the restored proposal
 * goes through the same review dialog and the same exact-base apply.
 *
 * Browser-safe; every storage access is guarded (a private window or a full quota must never break the page).
 */
import type { SchematicState } from "@/lib/schematic-types";

export const PENDING_PROPOSAL_STORE_VERSION = 1 as const;
/** Larger proposals are not persisted (localStorage quotas): the proposal stays in memory only. */
export const PENDING_PROPOSAL_MAX_CHARS = 2_000_000;

export interface StoredPendingProposal {
  version: typeof PENDING_PROPOSAL_STORE_VERSION;
  projectId: string;
  /** `schematicStateDigest` of the authoritative schematic the proposal was produced against. */
  baseDigest: string;
  state: SchematicState;
  explanation: string;
  prompt: string;
  validationNote: string | null;
  savedAt: string;
  /** [PR-L, 2026-10-17] optional: the durable generation task whose validated result this proposal is (runbook L.4), so the page offers
   *  one result once and reports the review (record-review) to the task that produced it; absent on proposals made any other way. */
  task?: { taskId: string; resultDigest: string } | null;
}

const key = (projectId: string): string => `sirkit:pending-proposal:${projectId}`;

function storage(): Storage | null {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function valid(value: unknown, projectId: string): value is StoredPendingProposal {
  return isRecord(value) && value.version === PENDING_PROPOSAL_STORE_VERSION && value.projectId === projectId
    && typeof value.baseDigest === "string" && isRecord(value.state) && Array.isArray((value.state as { components?: unknown }).components)
    && typeof value.explanation === "string" && typeof value.prompt === "string"
    && (value.validationNote === null || typeof value.validationNote === "string") && typeof value.savedAt === "string"
    && (value.task === undefined || value.task === null || (isRecord(value.task) && typeof value.task.taskId === "string" && value.task.taskId.length <= 200 && typeof value.task.resultDigest === "string" && value.task.resultDigest.length <= 100)); // [PR-L, 2026-10-17]
}

/** Persist the proposal; false when it could not be (too large, no storage, quota). */
export function savePendingProposal(record: Omit<StoredPendingProposal, "version" | "savedAt"> & { savedAt?: string }): boolean {
  const store = storage();
  if (!store) return false;
  try {
    const text = JSON.stringify({ ...record, version: PENDING_PROPOSAL_STORE_VERSION, savedAt: record.savedAt ?? new Date().toISOString() } satisfies StoredPendingProposal);
    if (text.length > PENDING_PROPOSAL_MAX_CHARS) return false;
    store.setItem(key(record.projectId), text);
    return true;
  } catch {
    return false;
  }
}

/** The stored proposal for the project, or null; a malformed record is removed. */
export function loadPendingProposal(projectId: string): StoredPendingProposal | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(key(projectId));
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (valid(parsed, projectId)) return parsed;
    store.removeItem(key(projectId));
    return null;
  } catch {
    try { store.removeItem(key(projectId)); } catch { /* nothing to do */ }
    return null;
  }
}

export function clearPendingProposal(projectId: string): void {
  const store = storage();
  if (!store) return;
  try { store.removeItem(key(projectId)); } catch { /* nothing to do */ }
}
