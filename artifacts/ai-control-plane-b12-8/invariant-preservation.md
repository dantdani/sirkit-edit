# B12.8 — invariant preservation

B12.8 changed exactly one function body (`setStatus` inside
`createAutosaver`) plus one new test file. Scope-protection audit:

| Protected surface | Status | Evidence |
| --- | --- | --- |
| IndexedDB journal/CAS | untouched | journal modules unmodified; b12-5-journal-atomicity 9/9 |
| Replay receipts / pins | untouched / identical | pins ab36b0c9…; b12-4 receipt suites green; generator ×2 byte-stable (19/19 + 59/59 both runs) |
| Pointer-commit ordering / page installation phases | untouched | page.tsx unmodified in B12.8; b12-5-transactional-activation 11/11 |
| Transition generation/barrier semantics | untouched | coordinator unmodified; b12-5-reentrant-settlement 14/14; b12-3/b12-2 suites green |
| Provider configuration / credits | unchanged / none | no provider code touched; no live calls |
| Dependencies | unchanged | package.json/pnpm-lock untouched |
| Tool exposure (nine read/propose; apply unreachable) | unchanged | b12-boundary-and-e2e §G green |
| Manufacturing authority | unchanged | no release-path code touched |
| **B12.7 unchanged in strength** | held | `renderUnknownError` and the strict `flush() === true` settlement untouched; b12-7-total-settlement 9/9 green byte-unchanged; redaction/bounds not weakened (the observer catch ADDS a suppression channel for observer failures only — save failures still render totally) |
| Autosaver public API (schedule/flush/status/subscribe/destroy signatures, debounce semantics, unsubscribe) | unchanged | `autosave.test.ts` green; only notification DELIVERY became isolated |
| Authoritative hashes | identical | types.ts 72ad7c77…, descriptor 5501d810…; descriptor `--check` OK |
| Protected original `C:\Users\robsa\sirkit` | untouched | never written to in B12.8 |

Strictness direction: observer throws previously ALTERED authoritative
behavior (aborted saves, false flush results); now they alter nothing.
No input that previously settled ok now fails, except that the FALSE
`{ok:true}` produced by a lost write is gone — which is the defect.
