# B12.7 — invariant preservation

B12.7 touched three files: the redaction module (one ADDITIVE export),
the autosave module (total settlement of the save attempt + strict
settlement), and the new test suite. Everything in the scope-protection
list is untouched and re-proven:

| Protected surface | Status | Evidence |
| --- | --- | --- |
| IndexedDB journal/CAS behavior | untouched | `approved-mutation-journal*.ts` unmodified; b12-5-journal-atomicity 9/9 |
| Replay receipt authentication | untouched | b12-4 receipt/strictness suites green |
| Pointer-commit ordering | untouched | page.tsx unmodified in B12.7; b12-5-transactional-activation 11/11 (one test gained an explicit 20s timeout — a declared allowance under full-suite contention, per the b12-4 precedent; zero assertion changes) |
| Coordinator generation/barrier behavior | untouched | `project-transition-coordinator.ts` unmodified; b12-5-reentrant-settlement 14/14 |
| Tool exposure (nine read/propose; apply unreachable) | unchanged | b12-boundary-and-e2e §G green |
| Provider configuration / credits | unchanged / none | no provider code touched; no live calls |
| Dependencies | unchanged | package.json/pnpm-lock untouched in B12.7 |
| Manufacturing authority | unchanged | no release-path code touched |
| Existing redaction exports (`sanitizeTraceText`, secret patterns, key folding) | unchanged | additive-only edit; B11 redaction suites green in the family battery |
| Autosaver public API + debounce/subscribe/destroy semantics | unchanged | `autosave.test.ts` green; only `run()`'s failure settlement and the settlement helper's strictness changed — both strictly fail-closed-MORE |
| B11 replay pins / authoritative hashes | identical | pins ab36b0c9…, types.ts 72ad7c77…, descriptor 5501d810…; descriptor `--check` OK; B11 generator ×2 byte-stable (19/19 + 59/59 both runs) |
| Protected original `C:\Users\robsa\sirkit` | untouched | not written to at any point in B12.7 |

Strictness direction check: every behavior change refuses MORE
(`saved` requires an explicit `{ ok: true }`; settlement requires the
literal `true`; hostile throws become typed failures instead of escapes;
pending is retained instead of lost). Nothing accepts more than before.
