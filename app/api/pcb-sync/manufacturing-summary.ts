/**
 * [B16.1C §C] the reload-time manufacturing summary reader used by
 * `GET /api/pcb-sync?boardId=…&include=manufacturing`.
 *
 * Read-only over the durable workflow repository: the qualification authority
 * head (`DurableManufacturingAuthorityStore`) and the latest ledgered release
 * (`DurableManufacturingReleaseLedger`), each flagged `current` against the
 * board revision/digest the same request just loaded, so a fresh browser can
 * reconstruct truthful workflow state without any browser-local memory.
 *
 * [B16-A F12] ONE read policy for every durable subject. Before this
 * correction a thrown `MFG_AUTHORITY_RECORD_DIGEST_MISMATCH` (tampered or
 * corrupt authority head) or `PS_SNAPSHOT_DIGEST_MISMATCH` (snapshot head)
 * was swallowed as `null` with HTTP 200 — a corrupt record looked exactly
 * like "nothing qualified yet" — while a ledger failure was not guarded at
 * all. Now every subject reports `ok` / `absent` / `corrupt` plus the bounded
 * code it observed; a corrupt subject is null with `current` false, nothing
 * is rethrown raw, and no message or stack ever leaves the server.
 * [B16-A F14] the summary also carries the trusted viewer's release
 * capability (human project administrator only — the release route's exact
 * refusal), so a browser never has to guess the user's role.
 */

import type { DurableWorkflowRepository } from "@/app/lib/durable-workflow/types";
import { DurableManufacturingAuthorityStore } from "@/app/lib/pcb/fab/authority-store";
import { DurableManufacturingReleaseLedger } from "@/app/lib/pcb/fab/release-ledger";
import { PCB_BOARD_ASSEMBLY_VARIANT_ID, pcbDesignInstanceId } from "@/app/lib/pcb/board-identity";
import { DurablePcbSyncSnapshotStore } from "@/app/lib/pcb-sync/durable";
import type { PcbSyncManufacturingIntegrityState, PcbSyncManufacturingSummary, PcbSyncManufacturingSummaryReader, PcbSyncManufacturingViewer } from "./handler";

/** The public code for a durable read that failed without a bounded code of its own. */
export const MANUFACTURING_SUMMARY_READ_FAILED = "PS_MANUFACTURING_SUMMARY_READ_FAILED";
const BOUNDED_CODE = /^[A-Z0-9_]+$/;
type IntegritySubject = "authority" | "snapshot" | "latestRelease";

/** The bounded public code for a failed durable read: the thrown Error's
 *  message when it IS a code, otherwise the generic read-failure code. Never a
 *  free-text message, never a stack, never a driver detail. */
function boundedReadCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return BOUNDED_CODE.test(message) ? message : MANUFACTURING_SUMMARY_READ_FAILED;
}

/** The same policy for every subject: a thrown read is `corrupt` with its
 *  bounded code (kept server-side in full), an empty read is `absent`. */
async function guardedRead<T>(subject: IntegritySubject, read: () => Promise<T | null>, codes: string[]): Promise<{ value: T | null; state: PcbSyncManufacturingIntegrityState }> {
  try {
    const value = await read();
    return { value, state: value ? "ok" : "absent" };
  } catch (error) {
    const code = boundedReadCode(error);
    codes.push(code);
    // A classified failure is a policy outcome (verification refused the record);
    // an unclassified one is a defect — keep the cause server-side, never in the response.
    if (code === MANUFACTURING_SUMMARY_READ_FAILED) console.error(`[pcb-sync] manufacturing summary ${subject} read failed:`, error);
    else console.warn(`[pcb-sync] manufacturing summary ${subject} failed verification: ${code}`);
    return { value: null, state: "corrupt" };
  }
}

/** [B16-A F14] mirrors `POST /api/pcb/release` exactly: only an authenticated
 *  HUMAN project administrator may authorize a release. An absent viewer is
 *  reported as unknown and fails closed. Informational only — the release
 *  route re-derives and enforces this itself. */
export function manufacturingReleaseCapability(viewer: PcbSyncManufacturingViewer | undefined): PcbSyncManufacturingSummary["viewer"] {
  const role = viewer?.role ?? "unknown", actorKind = viewer?.actorKind ?? "unknown";
  return { role, actorKind, canRelease: actorKind === "human" && role === "project_admin" };
}

export function createManufacturingSummaryReader(workflow: DurableWorkflowRepository): PcbSyncManufacturingSummaryReader {
  const store = new DurableManufacturingAuthorityStore(workflow);
  const ledger = new DurableManufacturingReleaseLedger(workflow);
  const snapshots = new DurablePcbSyncSnapshotStore(workflow);
  return async (scope, current, viewer): Promise<PcbSyncManufacturingSummary> => {
    const designId = pcbDesignInstanceId(scope.projectId);
    const authorityScope = { ...scope, designId };
    const codes: string[] = [];
    const head = await guardedRead("authority", () => store.getHead(authorityScope), codes);
    const latest = await guardedRead("latestRelease", () => ledger.latest(authorityScope), codes);
    const snapshot = await guardedRead("snapshot", () => snapshots.getSnapshotHead({ tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId, designId, assemblyVariantId: PCB_BOARD_ASSEMBLY_VARIANT_ID }), codes);
    const authority = head.value;
    // A corrupt authority is null here, so it — and any release bound to it — can never be `current`.
    const authorityCurrent = Boolean(authority && current && authority.authority.boardRevision === current.revision);
    return {
      snapshot: snapshot.value ? { revision: snapshot.value.revision, snapshotDigest: snapshot.value.snapshotDigest, schematicRevision: snapshot.value.schematicRevision, schematicDigest: snapshot.value.schematicDigest } : null,
      authority: authority ? {
        revision: authority.revision,
        recordDigest: authority.recordDigest,
        boardRevision: authority.authority.boardRevision,
        boardDigest: authority.authority.boardDigest,
        schematicRevision: authority.authority.schematic.revision,
        schematicDigest: authority.authority.schematic.digest,
        componentAuthorityDigest: authority.authority.qualificationAuthority?.digest ?? authority.authority.componentAuthority.digest,
        fabricationProfileId: authority.authority.manufacturingRuleProfile.profileId,
        qualifiedAt: authority.authority.sourceDate,
        actor: authority.authority.actor,
        current: authorityCurrent,
      } : null,
      latestRelease: latest.value ? {
        releaseId: latest.value.releaseId,
        archiveSha256: latest.value.archiveSha256,
        manifestContentDigest: latest.value.manifestContentDigest,
        filename: latest.value.filename,
        authorityRecordDigest: latest.value.authorityRecordDigest,
        authorityRevision: latest.value.authorityRevision,
        boardRevision: latest.value.boardRevision,
        actor: latest.value.actor,
        releasedAt: latest.value.releasedAt,
        current: Boolean(authority && authorityCurrent && latest.value.authorityRecordDigest === authority.recordDigest),
      } : null,
      integrity: { authority: head.state, snapshot: snapshot.state, latestRelease: latest.state, codes },
      viewer: manufacturingReleaseCapability(viewer),
    };
  };
}
