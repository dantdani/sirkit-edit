/**
 * [PR-L6 integration, 2026-10-19] BI-1 (the fixture-board review of increment 6): the approved-mutation journal is bounded by its
 * serialized SIZE as well as its entry count.
 *
 * The journal trimmed only by count (64 entries), while the production store refuses any document over 256 KiB
 * (JOURNAL_DOCUMENT_TOO_LARGE, read as `unavailable`). Receipt v2's `boardImpact` grows a resolution entry by about a third, so the byte
 * cap is now reached well before the count trim - and when the overflow lands on `finalizeReceipt`, it comes AFTER the canonical commit
 * (recovery-required after a real change), and from then on every prepare of any approved mutation in the project fails. The journal now
 * evicts the oldest RECEIPT-FINALIZED entries (never the one being written, never a prepared, committed, adopted or poisoned one) until
 * the document fits.
 *
 *  1. over the PRODUCTION IndexedDB store (fake-indexeddb, the real 256 KiB refusal): twenty 20-item v2 resolution approvals in a row
 *     each prepare, commit, adopt and finalize; the document stays under the bound; the oldest finalized receipts were evicted, the
 *     newest are intact and every write after the eviction still succeeds.
 *
 * Realistic id lengths (uuids, eng1 digests, KiCad footprint names). No provider, no database, no network.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { APPROVED_MUTATION_JOURNAL_MAX_SERIALIZED, ApprovedMutationJournal } from "@/app/lib/engineering/approved-mutation-journal";
import { IndexedDbApprovedMutationJournalStore } from "@/app/lib/engineering/approved-mutation-journal-idb";
import type { ApprovedMutationReceipt } from "@/app/lib/engineering/approved-agent-mutations";

const SCOPE = { tenantId: "local", projectId: "p-m4-journal-size", branchId: "main" } as const;
const AUTHORIZATION = { principalId: "local-user", membershipRevision: "mbr1-0123456789abcdef" };
/** A deterministic hex string unique per seed (a test fixture, not a digest of anything). */
const hex = (seed: number, length: number) => createHash("sha256").update(`m4-journal-size:${seed}`).digest("hex").slice(0, length);
const eng = (seed: number) => `eng1-${hex(seed, 64)}`;
const uuid = (seed: number, index: number) => `${hex(seed + index, 8)}-${hex(seed, 4)}-4${hex(index, 3)}-8${hex(seed, 3)}-${hex(seed * 3 + index, 12)}`;

/** One 20-item v2 resolution approval: the prepare input, the commit data and its coherent receipt. */
function approval(n: number) {
  const identityKey = eng(1000 + n), proposalId = `cprop-${hex(n, 32)}`, operationsDigest = eng(2000 + n), lineageId = `lin1-${hex(7, 16)}`;
  const baseHeadMark = { headSequence: 2 * n, canonicalStateDigest: eng(3000 + n) }, headAfter = { headSequence: 2 * n + 1, canonicalStateDigest: eng(4000 + n) };
  const baseSchematicDigest = eng(5000 + n), schematicDigestAfter = eng(6000 + n), transactionId = `tx-${uuid(n, 0)}`, committedAt = 1_760_000_000_000 + n * 1_000;
  const items = Array.from({ length: 20 }, (_, index) => ({
    componentInstanceId: uuid(n, index), refDes: `D${index + 1}`, sourcePartId: uuid(n + 50, index),
    target: {
      catalogPartId: uuid(n + 100, index), valueKey: "if=1a;vr=40v", exactMpn: `SS14-${index}`, manufacturer: "Example Semiconductor",
      atomicPartRevisionId: `apr-${uuid(n + 150, index)}`, symbolAssetVersionId: `sav-${uuid(n + 200, index)}`, footprintAssetVersionId: `fav-${uuid(n + 250, index)}`,
      mappingCertificateId: `mc-${uuid(n + 300, index)}`, footprintFullName: "Diode_SMD:D_SMA_Handsoldering", evidenceDigest: eng(7000 + n * 20 + index),
    },
  }));
  const receipt = {
    schema: "sirkit.approved-resolution-receipt.v2", receiptId: `acr-${hex(n + 9, 32)}`, proposalId, operationsDigest, originRunId: null, authorization: AUTHORIZATION, commandId: "schematic.resolve-components",
    tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, branchId: SCOPE.branchId, lineageId, headBefore: baseHeadMark, headAfter, schematicDigestBefore: baseSchematicDigest, schematicDigestAfter,
    transactionId, operationCount: 20, destructive: true, postconditions: "verified", undoReference: { kind: "canonical-transaction", transactionId }, completedAt: committedAt, items,
    authorityLinkage: { operationsDigest, impactDigest: eng(8000 + n), connectivityDigest: eng(8100 + n), authorityResourceId: `car-${uuid(n, 99)}`, authorityResourceDigest: eng(8200 + n), canonicalResourceId: `canon-${uuid(n, 98)}`, canonicalResourceDigest: eng(8300 + n), consumedAuthorityDigest: eng(8400 + n) },
    approvalActor: "human:interactive",
    boardImpact: {
      state: "assessed", schema: "sirkit.resolution-board-impact-summary.v1", digest: eng(8500 + n), basis: { kind: "board", boardId: `board:${SCOPE.projectId}`, revision: `rev-${uuid(n, 97)}`, boardClass: "class-2" },
      requiresBoardRevision: true, predictedCodes: ["FOOTPRINT_CHANGED"],
      items: items.map((item) => ({ componentInstanceId: item.componentInstanceId, schematicRefDes: item.refDes, boardRef: item.refDes, outcome: "footprint_changed", operation: "replace_unrouted_footprint", codes: ["FOOTPRINT_CHANGED", "REBIND_REQUIRED"], affectedNets: 2, copper: { tracks: 0, vias: 0, zones: 0 }, rebind: true })),
      truncatedItems: 0, copperStripped: { tracks: 0, vias: 0, zones: 0 },
      invalidates: { placementLegality: true, drc: true, routing: true, authorityRevision: n, releaseId: null, stageEvidence: true },
    },
  };
  return {
    identityKey,
    prepare: { identityKey, proposalId, operationsDigest, ...SCOPE, lineageId, baseHeadMark, baseSchematicDigest, originRunId: null, authorization: AUTHORIZATION, operationCount: 20, destructive: true, preparedAt: committedAt - 500 },
    commit: { committedAt, transactionId, revisionBefore: null, revisionAfter: null, headAfter, schematicDigestAfter },
    receipt: receipt as unknown as ApprovedMutationReceipt,
  };
}

describe("[PR-L6 integration] BI-1: the journal fits the store's byte bound, evicting only the oldest finalized receipts", () => {
  it("1. twenty 20-item v2 resolution approvals in a row each finalize; the oldest finalized receipts make room; the newest stay intact", { timeout: 60_000 }, async () => {
    const store = new IndexedDbApprovedMutationJournalStore({ factory: new IDBFactory() as unknown as globalThis.IDBFactory, databaseName: "m4-journal-size", legacyStorage: null });
    const journal = new ApprovedMutationJournal(store, SCOPE);
    const first = approval(0);
    for (let n = 0; n < 20; n += 1) {
      const next = approval(n);
      expect(await journal.prepare(next.prepare), `prepare ${n}`).toEqual({ ok: true });
      expect(await journal.markCommitted(next.identityKey, next.commit), `commit ${n}`).toEqual({ ok: true });
      expect(await journal.markAdopted(next.identityKey), `adopt ${n}`).toEqual({ ok: true });
      expect(await journal.finalizeReceipt(next.identityKey, next.receipt), `finalize ${n}`).toEqual({ ok: true });
    }
    const raw = await store.load(SCOPE.tenantId, SCOPE.projectId, SCOPE.branchId) as { entries: Array<{ identityKey: string; state: string }> };
    expect(JSON.stringify(raw).length).toBeLessThanOrEqual(APPROVED_MUTATION_JOURNAL_MAX_SERIALIZED);
    expect(raw.entries.length).toBeLessThan(20); // the size bound, not the 64-entry trim, decided
    expect(raw.entries.every((entry) => entry.state === "receipt-finalized")).toBe(true);
    expect(await journal.lookup(first.identityKey)).toEqual({ kind: "absent" }); // the oldest finalized receipt made room
    const newest = await journal.lookup(approval(19).identityKey);
    expect(newest.kind === "entry" && newest.entry.state).toBe("receipt-finalized"); // and the newest is intact (it validates)
  });
});
