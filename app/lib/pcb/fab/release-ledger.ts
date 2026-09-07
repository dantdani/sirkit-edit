/**
 * B16.1C §E — the durable manufacturing release ledger.
 *
 * Before this stage a verified release left NO server-owned record: the ZIP
 * streamed to the browser and only the browser's stage evidence remembered
 * that anything happened, so a reload could not truthfully show "released".
 *
 * The ledger is an append-only aggregate per (tenant, project, branch,
 * design, board). Every entry binds the release identity (releaseId, archive
 * sha256, manifest content digest) to the exact authority it was generated
 * from (authority record digest, board revision/digest) and the human
 * administrator who authorized it. Recording is idempotent by releaseId: the
 * same sealed authority released twice yields the same releaseId and ONE
 * ledger entry — byte-identical output is never double-counted.
 */

import type { DurableWorkflowRepository, DurableWorkflowScope } from "../../durable-workflow/types";
import { durableAggregateIdentity, durableScopeKey, durableWorkflowId } from "../../durable-workflow/stable";
import type { ManufacturingAuthorityScope } from "./authority-store";
import { sha256, stableJson } from "./native/stable";

const LEDGER = "mfg.release-ledger.v1";

export interface ManufacturingReleaseRecord {
  schemaVersion: "sirkit.manufacturing-release-record.v1";
  releaseId: string;
  archiveSha256: string;
  manifestContentDigest: string;
  filename: string;
  authorityRecordDigest: string;
  authorityRevision: number;
  boardRevision: string;
  boardDigest: string;
  schematicRevision: string;
  componentAuthorityDigest: string;
  actor: string;
  releasedAt: string;
  recordDigest: string;
}

interface LedgerPayload { releases: ManufacturingReleaseRecord[] }

function workflowScope(scope: ManufacturingAuthorityScope): DurableWorkflowScope {
  return { tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId };
}

function ledgerKey(scope: ManufacturingAuthorityScope): string {
  return durableWorkflowId("mfg-release-ledger", { tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId, designId: scope.designId, boardId: scope.boardId });
}

export function manufacturingReleaseRecordDigest(record: Omit<ManufacturingReleaseRecord, "recordDigest">): string {
  return `release-record-${sha256(stableJson(record))}`;
}

export class DurableManufacturingReleaseLedger {
  constructor(private readonly workflow: DurableWorkflowRepository) {}

  private head(scope: ManufacturingAuthorityScope) {
    return this.workflow.loadHead<LedgerPayload>(durableAggregateIdentity(workflowScope(scope), LEDGER, ledgerKey(scope)));
  }

  async list(scope: ManufacturingAuthorityScope): Promise<ManufacturingReleaseRecord[]> {
    const head = await this.head(scope);
    return structuredClone(head?.payload.releases ?? []);
  }

  async latest(scope: ManufacturingAuthorityScope): Promise<ManufacturingReleaseRecord | null> {
    const releases = await this.list(scope);
    return releases.length ? releases[releases.length - 1]! : null;
  }

  /** Append one release record; idempotent by releaseId (same authority ⇒ same releaseId ⇒ one entry). */
  async record(scope: ManufacturingAuthorityScope, input: Omit<ManufacturingReleaseRecord, "schemaVersion" | "recordDigest">): Promise<{ record: ManufacturingReleaseRecord; created: boolean }> {
    const head = await this.head(scope);
    const existing = head?.payload.releases.find((item) => item.releaseId === input.releaseId);
    if (existing) return { record: structuredClone(existing), created: false };
    const base = { schemaVersion: "sirkit.manufacturing-release-record.v1" as const, ...input };
    const record: ManufacturingReleaseRecord = { ...base, recordDigest: manufacturingReleaseRecordDigest(base) };
    const releases = [...(head?.payload.releases ?? []), record];
    await this.workflow.commit({
      scope: workflowScope(scope),
      scopeKey: durableScopeKey(workflowScope(scope), `mfg-release-ledger:${scope.boardId}`),
      idempotencyKey: `release:${scope.boardId}:${record.releaseId}`,
      operations: [{ aggregateType: LEDGER, aggregateKey: ledgerKey(scope), expectedRevision: head?.revision ?? 0, payload: { releases: structuredClone(releases) }, recordDigest: `release-ledger-${sha256(stableJson(releases.map((item) => item.recordDigest)))}` }],
      outbox: [{ owner: { aggregateType: LEDGER, aggregateKey: ledgerKey(scope) }, eventType: "mfg.release-recorded", eventVersion: 1, topic: "mfg.release-recorded", payload: { boardId: scope.boardId, releaseId: record.releaseId, archiveSha256: record.archiveSha256 } }],
      result: { releaseId: record.releaseId, archiveSha256: record.archiveSha256 },
      committedAt: record.releasedAt,
    });
    return { record: structuredClone(record), created: true };
  }
}
