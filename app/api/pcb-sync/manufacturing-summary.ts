/**
 * [B16.1C §C] the reload-time manufacturing summary reader used by
 * `GET /api/pcb-sync?boardId=…&include=manufacturing`.
 *
 * Read-only over the durable workflow repository: the qualification authority
 * head (`DurableManufacturingAuthorityStore`) and the latest ledgered release
 * (`DurableManufacturingReleaseLedger`), each flagged `current` against the
 * board revision/digest the same request just loaded, so a fresh browser can
 * reconstruct truthful workflow state without any browser-local memory.
 */

import type { DurableWorkflowRepository } from "@/app/lib/durable-workflow/types";
import { DurableManufacturingAuthorityStore } from "@/app/lib/pcb/fab/authority-store";
import { DurableManufacturingReleaseLedger } from "@/app/lib/pcb/fab/release-ledger";
import { PCB_BOARD_ASSEMBLY_VARIANT_ID, pcbDesignInstanceId } from "@/app/lib/pcb/board-identity";
import { DurablePcbSyncSnapshotStore } from "@/app/lib/pcb-sync/durable";
import type { PcbSyncManufacturingSummary, PcbSyncManufacturingSummaryReader } from "./handler";

export function createManufacturingSummaryReader(workflow: DurableWorkflowRepository): PcbSyncManufacturingSummaryReader {
  const store = new DurableManufacturingAuthorityStore(workflow);
  const ledger = new DurableManufacturingReleaseLedger(workflow);
  const snapshots = new DurablePcbSyncSnapshotStore(workflow);
  return async (scope, current): Promise<PcbSyncManufacturingSummary> => {
    const designId = pcbDesignInstanceId(scope.projectId);
    const authorityScope = { ...scope, designId };
    let head: Awaited<ReturnType<DurableManufacturingAuthorityStore["getHead"]>> = null;
    try { head = await store.getHead(authorityScope); } catch { head = null; }
    const authorityCurrent = Boolean(head && current && head.authority.boardRevision === current.revision);
    const latest = await ledger.latest(authorityScope);
    let snapshot: Awaited<ReturnType<DurablePcbSyncSnapshotStore["getSnapshotHead"]>> = null;
    try { snapshot = await snapshots.getSnapshotHead({ tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId, designId, assemblyVariantId: PCB_BOARD_ASSEMBLY_VARIANT_ID }); } catch { snapshot = null; }
    return {
      snapshot: snapshot ? { revision: snapshot.revision, snapshotDigest: snapshot.snapshotDigest, schematicRevision: snapshot.schematicRevision, schematicDigest: snapshot.schematicDigest } : null,
      authority: head ? {
        revision: head.revision,
        recordDigest: head.recordDigest,
        boardRevision: head.authority.boardRevision,
        boardDigest: head.authority.boardDigest,
        schematicRevision: head.authority.schematic.revision,
        schematicDigest: head.authority.schematic.digest,
        componentAuthorityDigest: head.authority.qualificationAuthority?.digest ?? head.authority.componentAuthority.digest,
        fabricationProfileId: head.authority.manufacturingRuleProfile.profileId,
        qualifiedAt: head.authority.sourceDate,
        actor: head.authority.actor,
        current: authorityCurrent,
      } : null,
      latestRelease: latest ? {
        releaseId: latest.releaseId,
        archiveSha256: latest.archiveSha256,
        manifestContentDigest: latest.manifestContentDigest,
        filename: latest.filename,
        authorityRecordDigest: latest.authorityRecordDigest,
        authorityRevision: latest.authorityRevision,
        boardRevision: latest.boardRevision,
        actor: latest.actor,
        releasedAt: latest.releasedAt,
        current: Boolean(head && authorityCurrent && latest.authorityRecordDigest === head.recordDigest),
      } : null,
    };
  };
}
