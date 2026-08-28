# B12.7 — total autosave failure settlement and retained-pending closure

Corrective stage over B12.6, closing the fail-closed/data-retention edge
the independent verifier found: the autosave layer's DIAGNOSTIC
CONVERSION was itself a throw path. Four reproduced edges:

| # | Edge | Consequence |
| --- | --- | --- |
| R1 | save() throws a value whose every string-conversion path also throws | `run()` had already cleared `pending`; the conversion threw BEFORE the failure path restored it — the write was LOST (next settlement reported ok without retrying) and status stranded at `"saving"` |
| R2 | a foreign flush throws an unstringifiable value | `settleAutosaveForTransition` ITSELF threw instead of returning a typed failure |
| R3 | a foreign flush throws an Error whose `message` getter throws | the getter's exception escaped the settlement |
| R4 | a foreign flush returns a truthy non-Boolean (`"yes"`) | truthiness check settled it as `{ ok: true }` |

Closure: ONE total, bounded unknown-error renderer —
`renderUnknownError` in the dependency-neutral redaction module
([app/lib/agent/redaction.ts](../../app/lib/agent/redaction.ts)) — used
by BOTH `createAutosaver`'s save-catch and
`settleAutosaveForTransition`'s flush-catch; `run()` settles the save
attempt totally (guarded result reads, `saved` only for an explicit
`{ ok: true }`, `pending` restored before any status/listener work); the
settlement accepts only the literal boolean `true`
([total-error-rendering-contract.md](total-error-rendering-contract.md)).

Documents: [pre-edit-counterexamples.md](pre-edit-counterexamples.md) ·
[root-cause.md](root-cause.md) ·
[total-error-rendering-contract.md](total-error-rendering-contract.md) ·
[retained-pending-proof.md](retained-pending-proof.md) ·
[coordinator-recovery-proof.md](coordinator-recovery-proof.md) ·
[test-evidence.md](test-evidence.md) ·
[invariant-preservation.md](invariant-preservation.md) ·
[changed-files-and-deviations.md](changed-files-and-deviations.md) ·
[verdict.md](verdict.md)
