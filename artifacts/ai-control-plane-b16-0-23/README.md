# B16.0.23 — Tranche 16: complete SPICE route-family migration

Stage scope: migrate exactly THIRTEEN methods to canonical wrappers — the
public stateless trio (POST compile / reports / run-plans/estimate →
`publicJsonRoute`), model import + smoke-test (`authenticatedJsonRoute`), the
seven run-lifecycle methods (list/start/get/cancel/bundle/events/waveforms →
`authenticatedRoute` / `authenticatedJsonRoute` with the NEW per-request
`querySelector` wrapper option for header-less surfaces), and the
provider-credit AI studio route (`authenticatedJsonRoute` + the §G
provider/local error split and schema-derived tool validation).

Worked ONLY in `C:\Users\robsa\Desktop\sirkit-edit`. The protected original
`C:\Users\robsa\sirkit` was NOT touched. Zero provider credits, zero live
simulators, zero real processes (scripted fake child + fake worker seams),
zero network/DB writes. B16.0.24, B16.1, chat/simulate/auth migration, MCP,
multi-agent orchestration, provider expansion, external model downloads, and
simulator-runner expansion NOT started.

## Artifact index

| file | content |
|---|---|
| [final-verdict.md](final-verdict.md) | stop condition, item by item |
| [pre-edit-counterexamples.md](pre-edit-counterexamples.md) | observed pre-edit realities + the two reproduced corrections |
| [route-migration-manifest.csv](route-migration-manifest.csv) | 13 methods: wrapper, options, ceilings |
| [behavioral-parity-matrix.csv](behavioral-parity-matrix.csv) | per-method §A pin coverage |
| [wrapper-and-policy-matrix.csv](wrapper-and-policy-matrix.csv) | policy class/roles/CSRF per method |
| [authorization-and-scope-proof.md](authorization-and-scope-proof.md) | auth/roles/trusted-scope/query-selector |
| [compilation-confinement-proof.md](compilation-confinement-proof.md) | §C compiler purity + determinism |
| [model-import-security-proof.md](model-import-security-proof.md) | §D import screens |
| [smoke-test-truthfulness-proof.md](smoke-test-truthfulness-proof.md) | §D evidence-not-certification |
| [run-lifecycle-proof.md](run-lifecycle-proof.md) | §E creation/cancel/uniform-404/terminal guard |
| [simulator-execution-boundary.md](simulator-execution-boundary.md) | §F server-owned execution |
| [provider-boundary-proof.md](provider-boundary-proof.md) | §G split + adapter parity |
| [zero-call-refusal-evidence.md](zero-call-refusal-evidence.md) | refusals → zero provider/process/store calls |
| [reports-and-bundles-proof.md](reports-and-bundles-proof.md) | §H document/bundle confinement |
| [events-and-waveforms-proof.md](events-and-waveforms-proof.md) | §H SSE + waveform bounds |
| [human-truth-contract.md](human-truth-contract.md) | §I permanently-gated truth ladder |
| [mutation-and-release-confinement.md](mutation-and-release-confinement.md) | no schematic/PCB mutation, no release claims |
| [ratchet-evidence.md](ratchet-evidence.md) | baseline 21 → 8; TRANCHE_16; floor 145 |
| [changed-files.md](changed-files.md) | this stage's exact edit log |
| [test-and-validation-report.md](test-and-validation-report.md) | full suite + static gates |
| [superseded-claims.md](superseded-claims.md) | claims replaced by this stage |
| [unknowns-and-owner-decisions.md](unknowns-and-owner-decisions.md) | decisions + carried unknowns |
