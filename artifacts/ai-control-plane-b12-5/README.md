# B12.5 — production journal atomicity and transactional project activation

Corrective stage over B12.4, closing four independently confirmed
production-boundary defects while preserving all B12.4 receipt-linkage,
strict-validation and monotonic-state-machine work:

| # | Defect | Closure |
| --- | --- | --- |
| R1 | `BrowserLocalStorageApprovedMutationJournalStore.saveIf` was not a real cross-context CAS (both writers claimed success; one write lost) | production store replaced by `IndexedDbApprovedMutationJournalStore` — read/version-check/write in ONE IndexedDB readwrite transaction, serialized by the browser engine across contexts; no localStorage fallback; no unconditional `save` — [production-journal-atomicity.md](production-journal-atomicity.md) |
| R2 | a failed current-project pointer write was ignored after visible install (installed + visible B + persisted A) | three-phase transactional activation: PREPARE → typed POINTER COMMIT → guarded no-throw COMMIT; pre-commit failures restore the survivor; commit-phase failures enter blocking recovery — [transactional-project-activation.md](transactional-project-activation.md) |
| R3 | reentry from a transition-failed outcome callback abandoned a live LEASED interlock and installed another target without its barrier | the settlement loop retires the CURRENT live interlock and awaits full settlement before every winner; outcome callbacks are part of the state-machine proof — [reentrant-transition-settlement.md](reentrant-transition-settlement.md) |
| R4 | the delimiter-joined journal key collided distinct valid scopes (`a:b`/`c` ≡ `a`/`b:c`) | injective IndexedDB array keys `[tenant, project, branch]` + bounds validation before key derivation + content-scope-only legacy migration — [collision-free-scope-identity.md](collision-free-scope-identity.md), [journal-storage-migration.md](journal-storage-migration.md) |

## Internal adversarial refutation pass

After implementation, five independent internal refuters attacked the
four closures and the coverage claims before this stage's verdict. They
could not refute §A or §B (every finding there was fail-closed), but
found six real gaps — one critical (a cancel-checkpoint path could
strand a reentrant request with zero outcomes), two major (a stale
cancel flag consumed post-cancel StrictMode remount requests and left
the survivor's interlock retired; the PCB stack's
`ensureCurrentProjectScope` wrote the current-project pointer outside
the activation protocol for salvaged projects) and three minor
(hostile hook outcome objects, post-dispose reactivation, mixed-scope
legacy documents partially reinterpreted at the journal surface with a
`conflict` mislabel). ALL were closed with code + permanent tests
before the final battery; details live in the per-section documents.

Pre-edit reproductions (verbatim, probe deleted):
[pre-edit-counterexamples.md](pre-edit-counterexamples.md). Failure
dispositions: [failure-and-recovery-matrix.md](failure-and-recovery-matrix.md).
Changes: [changed-files.md](changed-files.md). Regression coverage:
[regression-matrix.md](regression-matrix.md). Battery + confidence:
[validation-summary.md](validation-summary.md). Verdict:
[final-verdict.md](final-verdict.md).

## Dependency change (justified)

`fake-indexeddb@6.2.5` was added as a DEV-ONLY dependency (via pnpm; the
repo's node_modules is pnpm-managed). It is required to prove the §A
atomicity claims against the real production IndexedDB code path in
vitest: Node/jsdom provide no IndexedDB, and testing a hand-rolled fake
would prove nothing (exactly the "in-memory test labeled as atomicity
proof" failure the stage forbids). fake-indexeddb implements the
IndexedDB specification including cross-connection readwrite-transaction
serialization — the property under test. No production dependency
changed; no provider configuration changed; no credits spent.

## Preserved

Human approval mandatory; `schematic.edit-tier1-apply` unreachable by
the model; exactly NINE read/propose provider tools (§G suite green
unchanged); B12.4 receipt commitment + full receipt linkage; strict
journal validation + monotonic transitions (schema strings unchanged);
every B03–B11 authority/replay/tracing/redaction invariant; all 19
replay pins and both authoritative PCB hashes byte-identical; no MCP /
specialist / manufacturing-release / provider expansion. The protected
original `C:\Users\robsa\sirkit` was not touched.
