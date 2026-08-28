# B08.2 — Server-Commit Reconciliation Boundary (`settleServerCommit`)

Input: a scope captured at submission + the owning
`PcbBoardLifecycleOwner` + a description that always states the server
DID commit. Called ONLY after the server durably committed (failures
never reach the boundary — they are plain scoped-toast refusals).

| scope current | owner state | identity vs scope | settlement | what happens |
|---|---|---|---|---|
| yes | live | (same by definition) | `adopt` | caller proceeds: verified load, cache, authority record, `adoptBoardLifecycle`, evidence, checkpoint, success toast |
| no | live | SAME tenant+project+branch+board | `reconcile-required` | ONE recorder (`settleStaleServerCommit`) stores a `PcbServerDivergenceNotice` (addressed to the ACTIVE generation) + toasts its description. NOTHING else: no adoption, no cache, no checkpoint, no evidence, no success |
| no | live | different tenant/project/branch/board | `discard` | NOTHING — not even a notice may leak into the unrelated board's UI |
| no | disposed (unmount) | — | `discard` | NOTHING |

## Notice lifecycle (`divergenceNoticeCurrent`)

The notice records `forGeneration` = the generation active at
settlement. It renders (banner `data-testid="server-divergence-banner"`)
only while the owner's generation AND full identity still match — ANY
later lifecycle adoption (sync adoption, checkpoint restore, qualify
adoption) or project/branch change retires it automatically. A notice is
display-only state: recording or retiring it never touches boards,
caches, checkpoints, or evidence.

## Why sync/qualify fetches are not signal-aborted (deliberate)

Aborting the apply/qualify POST on lifecycle replacement would discard
the RESPONSE — the only way to learn whether the server durably
committed. The requests run to completion; the settlement boundary then
classifies the outcome (reconcile-required vs discard). Candidate
producers (autoroute/auto-place/repair/assist) ARE aborted because their
results are local candidates with no durable server effect.

Behavioral coverage: b08-1 `T5/T6 (behavioral)` — raced checkpoint
restore → reconcile-required with the exact request id; notice retiring
on the next adoption; cross-project discard; post-dispose discard.
