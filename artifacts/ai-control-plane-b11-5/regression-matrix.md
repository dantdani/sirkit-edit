# B11.5 — regression matrix

**18 tests** in
[`b11-5-capture-exactness.test.ts`](../../app/lib/agent/__tests__/b11-5-capture-exactness.test.ts).
Nothing is proven by a test-local helper: every assertion drives the production
`capturePlainJson`, `validateReplayContext`, `validateBoardShape`,
`projectBoardForReplay`, `validateReplayCapsule`, `replayCapsule`,
`validateAgentRunTrace`, `findNonPlainJsonPath`, or `findSecretShapedPath`.

| # | Required proof | Test |
| --- | --- | --- |
| 1 | Numeric `"__proto__"` is retained as an own property | §A "1: a NUMERIC __proto__ is retained as an own data property" — own property present, value `42`, `keep` intact |
| 2 | Object-valued `"__proto__"` does not change the captured prototype | §A "2: an OBJECT-valued __proto__ does not change the captured prototype" — prototype is `Object.prototype`, key present, value is a **copy** not the caller's object |
| 3 | Its captured child is deeply frozen | §A "3: the captured __proto__ child is deeply frozen" — snapshot, child, nested object and nested array all `Object.isFrozen` |
| 4 | `"constructor"` and `"prototype"` keys round-trip | §A "4: constructor and prototype keys round-trip" — plus `valueOf` and `hasOwnProperty`; `JSON.parse(JSON.stringify(snapshot))` deep-equals the source |
| 5 | A valid `footprint.padNets` Record containing own `"__proto__": 42` survives `validateReplayContext` exactly | §A "5: a padNets Record containing own __proto__: 42 survives validateReplayContext exactly" — `validateBoardShape` `[]`, context `ok`, captured `padNets` retains the key with value `42` and `Object.prototype` |
| 6 | JSON/canonical round-trip equality includes those keys | §A "6: JSON and canonical round-trip equality includes those keys" — board **and** context round-trips equal, and `"__proto__":42` present in both serializations |
| 7 | Synthetic credential markers never appear in issues or thrown messages | §B "7: a synthetic marker in a KEY NAME never reaches issues or the thrown message" + "the same marker never reaches context, trace, board or secret-scan diagnostics" + "redaction is deterministic, bounded, and still useful" |
| 8 | Stateful proxy traps cannot throw from any claimed-total public boundary | §C "8: every claimed-total boundary refuses instead of throwing, for every proxy family" — 8 families × 10 boundaries = 80 probes; plus "a proxy is never treated as safe because one preliminary trap succeeded" and "a hostile caller proxy is never returned as if it were a safe projection" |
| 9 | Existing `toJSON`/accessor counters remain zero | §D "9: toJSON and accessor counters remain zero" — self-deleting hook still present, getter read count `0` |
| 10 | Caller mutation after replay invocation remains irrelevant | §D "10: caller mutation after replayCapsule remains irrelevant" — no marker in events, digest equals the committed pin |
| 11 | Invalid documents reach none of the truthful execution probes | `b11-4-no-execution` (4 tests), unchanged and green — see [no-execution-proof.md](no-execution-proof.md) |
| 12 | No test writes to `app/`, `lib/`, `scripts/` or `artifacts/` | §D "12: NO test anywhere in the repository writes under app/, lib/, scripts/ or artifacts/" — recursive scan of every `*.test.ts(x)` under those roots |

## Additional proofs

| Proof | Test |
| --- | --- |
| An object-valued `__proto__` in a numeric Record refuses **cleanly**, with no prototype pollution of `{}` or `Object.prototype` | §A "an object-valued __proto__ inside a real context does not poison any prototype" |
| Sparse/malformed arrays still refuse and all 19 pins hold | §D "sparse/malformed arrays still refuse, and all 19 pins hold" |
| Static exposure remains exactly nine read/propose tools | §D "static exposure remains exactly NINE read/propose tools" |
| The capture path and the trace path share ONE classifier | §B "redaction is deterministic, bounded, and still useful" — `scanPlainJson` produces the same `[redacted-key]` segment |

## The write-scan gate, and two pre-existing exceptions

The §D scan walks **every** `*.test.ts(x)` under `app/`, `lib/`, and `scripts/`
— not just the agent suites — looking for `writeFileSync`, `rmSync`,
`mkdirSync`, `appendFileSync`, `unlinkSync`, `cpSync`, `rmdirSync`, or
`createWriteStream`.

Two **pre-existing** files outside the B11 stages call a writing primitive.
Neither is excluded blindly: each is admitted only while its justification
still holds, and the justification is itself asserted, so removing the guard
fails the gate.

| File | Justification (asserted) |
| --- | --- |
| `app/lib/pcb/__tests__/kicad-cli-oracle.test.ts` | writes only inside `mkdtempSync(join(tmpdir(), …))` — an OS temp directory, never a repository path |
| `app/lib/pcb/__tests__/kicad-write-pcb.test.ts` | writes the golden fixture only under `if (process.env.UPDATE_GOLDEN)` — an explicit opt-in that is not reachable in a normal run |

Every `b11*` suite is additionally asserted to import no writing primitive at
all.

## Carried forward, unchanged and green

* B11 `b11-trace-replay-evaluation` — 16
* B11.1 `b11-1-trace-integrity` — 30, `b11-1-route-finalization` — 9
* B11.2 `b11-2-replay-context` — 20
* B11.3 `b11-3-generated-pcb-shape` — 34
* B11.4 `b11-4-capture-ownership` — 17, `b11-4-no-execution` — 4
* Evaluation matrix — 19 cases, 59 checks

**No existing test or gate was weakened.** Two B11.1 message-shape assertions
were re-worded because the redaction became stronger; both now prove strictly
more (refused **and** not leaked). See
[diagnostic-redaction-proof.md](diagnostic-redaction-proof.md).
