# B16-C.3 — Snapshot-conflict UX ("another session published a newer revision")

Labels: CONFIRMED = executed and measured on this machine; INFERRED = derived from code reading; PROPOSED = design not yet exercised; RECORDED = written down without a claim; UNKNOWN = not established.

## Reproduced (CONFIRMED)

- A publication pinned to an older snapshot revision was refused by the durable store's optimistic revision check as a bare `PS_SNAPSHOT_REVISION_CONFLICT` (409) — the same shape as every other refusal. The browser printed "Publication failed: PS_SNAPSHOT_REVISION_CONFLICT" through the generic toast, indistinguishable in kind from malformed input (400/422) or a server failure (5xx), and offered no way forward except knowing to reload.
- Nothing was ever overwritten (the CAS refused), which is preserved; what was missing was the distinction and the explicit choices.

## Contract (CONFIRMED by `b16-a-durable-heads.test.ts`, `app/api/pcb-sync/__tests__/route.test.ts`, recovery pipeline H.3, `snapshot-conflict-dialog.test.tsx`)

- Store: `DurablePcbSyncSnapshotStore.publish` throws `PcbSyncSnapshotRevisionConflict` (message unchanged, so every existing catch still works) whose `details` name the conflict: `{ kind: "snapshot_revision", expectedRevision, currentRevision, currentSnapshotDigest, currentSchematicRevision, currentSchematicDigest, attemptedSchematicRevision, attemptedSnapshotDigest }` (`app/lib/pcb-sync/types.ts`). If the head cannot be read the plain error is thrown — a conflict is never hidden behind a read failure.
- Route: `POST /api/pcb-sync` → **409** `{ ok:false, code:"PS_SNAPSHOT_REVISION_CONFLICT", conflict: {...} }`. Malformed input never carries `conflict`; server failures keep their opaque `PS_INTERNAL_ERROR`.
- Client: `PcbSyncClient` failures carry `conflict` only when the body's details have the exact shape (`snapshotConflict` guard); kind stays `stale`.
- Browser (`PcbEditor` + `SnapshotConflictDialog`): the publish step of the owned Sync preparation captures the details and opens the dialog, which shows the revision this session expected, the current revision with its schematic identity and digest, and what this session tried to publish; the actions are
  - **Refresh** — re-reads the durable truth (snapshot head, board, qualification authority, release) through the existing hydration; publishes nothing; the snapshot head becomes the next publication base through the existing adoption effect;
  - **Rebase & publish** — adopts the CURRENT revision as the publication base and re-runs the same Sync request (same placement choice) so THIS session's schematic is republished on top of the newer revision; the newer revision stays in durable history and the resulting plan is previewed before apply as always;
  - **Not now** — closes the dialog; nothing changes.
  Actions are disabled while a sync runs. The toast still names the outcome truthfully (with both revisions).

## Not done / bounded (RECORDED)

- The dialog does not diff the two schematics (only identities/digests); a content diff is PROPOSED for B17 once the schematic history coordination lands.
- Apply-time board conflicts (`PS_BOARD_REVISION_MISMATCH`, `PS_PLAN_STALE`) already refuse with bounded codes through the plan lifecycle; they were not given a dialog here (recorded in `failure-and-recovery-matrix.csv`).
