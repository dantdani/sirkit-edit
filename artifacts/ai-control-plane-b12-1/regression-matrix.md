# B12.1 — regression matrix

27 new permanent tests across three files, plus the two B12 suites updated
to the corrected contract (32). All passing.

## `b12-1-adoption-identity-receipt.test.ts` (15)

| Test | Locks |
| --- | --- |
| apply commits once, updates the coordinator-adopted editor state, and records exactly one SchematicHistory entry | R1, §A |
| the NORMAL UI undo path restores the exact pre-apply digest and reconciles the durable lineage | §A/§E undo |
| verification runs at the SERIALIZED execution position: a hand edit queued ahead makes the apply refuse with zero partial effect | §A execution-position verification |
| a gesture owning the preview refuses the apply (editor-busy) and releases the claim; after cancel the apply succeeds | §A serialization with gestures |
| double-clicking Apply produces one submission, one transaction, one history entry | §A double-click |
| receipt consumption and committed-verified audit happen ONLY after adoption: an unadoptable commit poisons instead | §A adoption-gated finalization + recovery path |
| altered operations with retained proposalId+scope refuse as verification-failed — never already-applied, never the original receipt | **R2** |
| every sealed field participates in identity: altering any one refuses after consumption (9 mutations incl. scope, head mark, impacts, provenance, createdAt, expiresAt, extra field) | §C complete-body identity |
| exact replay of the same intact consumed artifact returns the ORIGINAL receipt without another transaction | §C intact-replay idempotency |
| hostile proposal artifacts refuse during capture: prototype-carried, accessor-bearing, cyclic | §C capture-first |
| identity derivation and integrity verification agree | §C |
| the three R3 forgeries now fail: consistent transactionId+undoReference, forged schematicDigestAfter, Object.create(validReceipt) | **R3** |
| SYSTEMATIC: every receipt field changed to another syntactically valid value fails — 20 mutations, one per key, incl. consistent multi-field forgeries | §D no-field-outside-the-digest |
| rejects inherited properties, accessors, symbols, cycles, non-finite numbers, depth bombs, oversized strings, revoked/throwing proxies — without throwing | §D capture-first totality |
| issue lists stay bounded (≤ 12) | §D bounds |

## `b12-1-lifecycle-interlock.test.ts` (7)

| Test | Locks |
| --- | --- |
| retirement before submission: session-superseded, ZERO durable transaction | §B ordering 1 |
| retirement while the apply is QUEUED (page order retire → invalidate): cancels before execution, zero durable transaction, replacement untouched | §B ordering 1 + obsolete-session rule |
| hydration/recovery invalidation also cancels a queued apply before execution | §E stale-proposal invalidation |
| retire() does NOT settle while the critical section runs; the caller is told the TRUTH (committed + adopted); retirement completes after | **R4**, §B ordering 2 |
| after an awaited retirement, a NEW apply attempt on the retired project refuses with zero further durable effect | §B post-retirement containment |
| recovery invalidation DURING the commit: postcondition-failed, poisoned, no adoption, no receipt, truthfully reported | §A/§B fail-closed recovery |
| interlock state machine: idempotent release/retire; acquisition refused in retiring AND retired states | §B |

## `b12-1-production-integration.test.ts` (5)

| Test | Locks |
| --- | --- |
| (openai) full flow: no mutation before Apply; one visible apply; one transaction; one history entry; UI undo; duplicate and altered replays contained | §E bullets 1–8 |
| (anthropic) full flow (same battery) | §E provider-neutrality |
| (openai origin) a gesture and an approved Apply cannot interleave — both directions | §E gesture interleave |
| (anthropic origin) transition-before-commit cancels with ZERO transaction; stale proposals die with session replacement; replacement (different project) never mutated | §E transition + replacement |
| (openai origin) apply-lease-before-transition: retirement WAITS; caller told the truth; replacement untouched | §E lease-first |

## Updated B12 suites (kept green under the corrected contract)

- `b12-approved-mutation.test.ts` (19) — now runs every apply through the
  real coordinator gateway + interlock; registry assertions use the new
  complete-body identity (`approvedMutationIdentityKey`).
- `b12-boundary-and-e2e.test.ts` (13) — §G boundary scans unchanged (nine
  tools, apply unreachable, channel importers pinned); §H per-provider
  flows now assert coordinator-adopted visible state and history entries
  instead of relabeling `commandResult.state`.

## Requirement coverage

| Requirement | Tests |
| --- | --- |
| R1 UI adoption | 3 (+2 §H) |
| R2 altered consumed replay | 3 |
| R3 receipt soundness | 4 |
| R4 retirement during commit | 4 |
| §A one shared canonical apply path | 8 |
| §B lifecycle interlock | 7 (+2 §E) |
| §C sealed identity ordering | 5 |
| §D capture-first receipts | 4 |
| §E production integration checklist | 5 (all 13 bullets) |
