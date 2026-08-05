import type { TransactionAcknowledgement } from "./types";

export interface EngineeringSyncStatus extends TransactionAcknowledgement {
  online: boolean;
  unsynchronizedTransactions: number;
  verification: "current" | "pending" | "stale" | "diverged" | "failed";
  conflictCount: number;
  proposalId?: string;
}

export function engineeringStatusLabels(status: EngineeringSyncStatus): string[] {
  const labels: string[] = [];
  if (status.preview) labels.push("Local preview only");
  if (status.acceptedLocally && !status.durableLocal) labels.push("Accepted locally; saving");
  if (status.durableLocal) labels.push("Durably stored locally");
  if (!status.online) labels.push(`Offline; ${status.unsynchronizedTransactions} unsynchronized transaction(s)`);
  else if (status.acceptedServer && !status.durableServer) labels.push("Accepted by server; durability pending");
  else if (status.durableServer && !status.synchronizedToHead) labels.push("Durably stored by server; catching up to project head");
  else if (status.synchronizedToHead) labels.push("Synchronized to current project head");
  labels.push(status.verification === "current" && status.verifiedAtHead ? "Verified at current head" : status.verification === "diverged" ? "Verification divergence detected; full fallback required" : status.verification === "failed" ? "Verification failed" : status.verification === "stale" ? "Verification stale" : "Verification pending");
  if (status.conflictCount) labels.push(`${status.conflictCount} engineering conflict(s) require review`); if (status.proposalId) labels.push(`Proposal ${status.proposalId} active`); return labels;
}
