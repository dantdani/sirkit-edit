# B16.1C — Fresh-browser hydration proof (§C/§F)

Claim: a browser with NO local memory (empty localStorage/IndexedDB) reconstructs truthful workflow progress from durable records alone, and can continue the workflow (publish, qualify, release) without guessing.

## Server truth (CONFIRMED)

`GET /api/pcb-sync?boardId=<board>&include=manufacturing` (canonical `authenticatedRoute`, all-members read, bounded query projection; `include` accepts only `manufacturing`, anything else → 422 `PS_API_UNKNOWN_FIELD` — [B16-A corrected] this line said 400; the handler's `PS_*` status mapping sends `PS_API_UNKNOWN_FIELD` to its 422 default branch (`app/api/pcb-sync/handler.ts` line 32, CONFIRMED; pinned by `b16-a-manufacturing-summary.test.ts` "include=foo → 422", F25) returns beside the board load result:

```
manufacturing: {
  snapshot:      { revision, snapshotDigest, schematicRevision, schematicDigest } | null,
  authority:     { revision, recordDigest, boardRevision, boardDigest, schematicRevision, schematicDigest,
                   componentAuthorityDigest, fabricationProfileId, qualifiedAt, actor, current } | null,
  latestRelease: { releaseId, archiveSha256, manifestContentDigest, filename, authorityRecordDigest,
                   authorityRevision, boardRevision, actor, releasedAt, current } | null,
  integrity:     { authority: "ok"|"absent"|"corrupt", snapshot: same, latestRelease: same, codes: string[] },
  viewer:        { role, actorKind, canRelease }
}
```

`current` is computed by the server against the board record loaded in the SAME request (`createManufacturingSummaryReader` in `app/api/pcb-sync/manufacturing-summary.ts`): the authority is current only when its `boardRevision` equals the loaded board's revision; the release is current only when the authority is current AND the release's `authorityRecordDigest` equals the authority head digest.

[B16-A corrected: F12/F14, `92c9601`] `integrity` is ONE read policy for every durable subject: a read that throws is `corrupt` with its bounded code (`MFG_AUTHORITY_RECORD_DIGEST_MISMATCH` for a tampered authority head, `PS_SNAPSHOT_DIGEST_MISMATCH` for a tampered snapshot head, a bounded code or `PS_MANUFACTURING_SUMMARY_READ_FAILED` for a failing ledger read), the subject is `null`, it can never be `current`, nothing is rethrown raw and no message or stack leaves the server (HTTP 200, not an error envelope). Before this correction a thrown authority/snapshot read was swallowed as `null` — a corrupt record looked exactly like "nothing qualified yet" — and a ledger failure was unguarded. `viewer` mirrors the release route's exact refusal (`canRelease` = human `project_admin`; absent viewer → `unknown`/`false`, fails closed) and is informational — the release route re-derives and enforces it. Tests: `app/api/pcb-sync/__tests__/b16-a-manufacturing-summary.test.ts` (tampered authority / snapshot heads, throwing ledger, viewer passthrough, `include` surface, client round trip).

Evidence (acceptance suite, `app/lib/workflow/prompt-to-gerber/__tests__/acceptance-pipeline.test.ts`):
- step 3 — before anything: 404 `not_found` with `{ snapshot: null, authority: null, latestRelease: null }`;
- step 6 — after sync apply: `found`, record revision = committed revision, `snapshot.revision = 1`, authority/release null;
- step 7 — after qualification: record revision = routed revision, `authority.current = true` (revision 1, actor = the editor);
- step 10 — after release: `latestRelease.current = true`, filename/archive sha/authority revision as in the release headers;
- recovery H.13 — after the durable board changed: `authority.current = false`, `latestRelease.current = false`; after re-qualification: authority r2 current, latest release (new id) current;
- recovery H.15 — another project or branch sees `not_found` + all-null truth and cannot qualify or release the main-branch board (404s).

## Browser reconstruction (CONFIRMED)

`useManufacturingWorkflow` → `reconstruct(scope, truth, local)` (`machine.ts`):

| Durable truth | Reconstructed state | Test |
|---|---|---|
| no board | `idle` (schematic may exist locally) | panel H.8 |
| board, no current authority | `awaiting_qualification`; Release disabled with the reason "needs a CURRENT qualification authority" | panel H.9; panel "stale authority" case (authority for an older board → `(stale)`, never releasable) |
| board + current authority | `qualified`; Request release enabled ONLY when `viewer.canRelease` is also true; a `pcb_editor` sees the control disabled with the reason and no dialog opens, even through the hook's own `requestRelease` entry point (the server route remains the enforcement point) [B16-A corrected: F14] | panel H.10; panel F14 |
| board + current authority + current ledgered release | `released`; identity strip shows the ledgered filename | panel H.10 (after the in-session release the panel re-reads truth and shows `released`) |
| hydration failure (transport) | the panel's OWN `hydration_failed` state ("Durable truth could not be read — retry hydration") — never the `idle` label — with `Hydration failed (<code>)` + bounded message + explicit Retry [B16-A corrected: F13 — before `92c9601` the state row fell through to the `idle` label after a failed hydration] | panel "hydration failure" case; panel F13 |
| any subject `integrity … corrupt` | a FAILED hydration carrying the integrity code ("A durable manufacturing record failed integrity verification (<code>). Nothing can be released until an operator inspects it."); release blocked; never shown as "authority none" [B16-A corrected: F12] | panel F12; `b16-a-manufacturing-summary.test.ts` |
| release refused `MFG_AUTHORITY_CONFIRMATION_MISMATCH` / `MFG_AUTHORITY_STALE` | the refusal is surfaced; explicit Retry RE-HYDRATES and asks the administrator to confirm the FRESH head in a NEW dialog — the refused pins are never resent; with no current authority after re-hydration nothing is sent and no dialog opens; a transport failure (503) retries the same pins idempotently without re-hydrating [B16-A corrected: F19 — the previous retry test was tautological: the hook re-sent the same stale pin] | panel F19 (three cases) |

## Publication base (pre-edit probe P1 closure, CONFIRMED)

The snapshot head revision from the same read becomes the editor's `snapshotRevisionRef` (`PcbEditor.tsx`, effect on `manufacturingSnapshotHead`; persisted with `savePcbSnapshotRevision`), so a fresh browser publishes against the CURRENT durable revision. Recovery H.4 proves the server behaviour end to end: a fresh browser's `expectedSnapshotRevision: 0` is refused (409 `PS_SNAPSHOT_REVISION_CONFLICT`), the hydrated revision (1) makes the retry an idempotent replay (200, `created: false, idempotent: true`).

## What is browser-local by design (RECORDED)

- A pending proposal under review (schematic or PCB plan) and the administrator's open authorization dialog do not survive a refresh; `reconstruct` never invents one (machine test: every reconstruction has `pendingReview: null`).
- The canonical schematic itself is hydrated by the page's existing B12 path (IndexedDB canonical store + journals); this stage does not change it.
- Production Supabase sessions were not exercised (BLOCKED-LIVE-QUALIFICATION since B16.1B); the local/test identity seam (`injectAuthorizedPrincipal`) stands in for the authenticated session in every suite.
