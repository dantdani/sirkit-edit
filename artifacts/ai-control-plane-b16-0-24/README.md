# B16.0.24 — FINAL raw-handler tranche (auth, agent chat, legacy simulation)

Stage scope: migrate the LAST five raw handlers to canonical wrappers, closing
the raw-handler surface to ZERO — GET `/api/auth/callback`, POST
`/api/auth/signin`, POST `/api/auth/signout`, POST `/api/chat`, POST
`/api/simulate`. Treated as a security-closure stage: three narrow declarative
wrapper capabilities were added (all gated sole-adopter), and `/api/simulate`
was hardened into a confined ngspice sandbox. [superseded 2026-10-02 by the B22 closeout (D22-14, OD-144): no sandbox - /api/simulate starts no process, and the diagnostic runner it calls has no isolation boundary (OD-134, OD-136)]

Worked ONLY in `C:\Users\robsa\Desktop\sirkit-edit`. The protected original
`C:\Users\robsa\sirkit` was NOT touched. Zero Supabase calls, zero provider
credits, zero real processes (scripted fake child), zero live simulators in
tests. B16.1, MCP, multi-agent orchestration, provider expansion, signup,
external model downloads, and simulator-platform expansion NOT started.

## Exact inventory

153 total · **150 canonical** · **3 factories** · **0 raw** · baseline **3** ·
migrated **+5** · new raw **0** · tools exposed **12**.

## The three narrow wrapper capabilities added (sole-adopter)

| capability | option | sole adopter | purpose |
|---|---|---|---|
| server-owned origin | `requestOrigin: true` → `meta.origin` | auth callback | origin-aware same-origin redirect from `resolveExpectedOrigin`, never a Host/forwarded header |
| closed sign-in refusal profile | `legacyReaderRefusals: "auth-signin-v1"` | sign-in | byte-exact `AUTH_SIGNIN_*` reader envelopes |
| declarative env injection | `exposeEnvironment: true` → `input.environment` | sign-out | deterministic test env without a raw second Next handler argument |
| body-scope streaming boundary | `agentStreamRoute` (new approved wrapper) | chat | body selector + lenient parse + NDJSON stream + abort signal |

## Artifact index

| file | content |
|---|---|
| [final-verdict.md](final-verdict.md) | stop condition, item by item |
| [pre-edit-counterexamples.md](pre-edit-counterexamples.md) | observed pre-edit realities + corrections |
| [route-migration-manifest.csv](route-migration-manifest.csv) | the 5 methods: wrapper, options |
| [behavioral-parity-matrix.csv](behavioral-parity-matrix.csv) | per-method §A pin coverage |
| [final-wrapper-inventory.csv](final-wrapper-inventory.csv) | 150/3/0 with per-row form |
| [authorization-and-scope-proof.md](authorization-and-scope-proof.md) | auth/CSRF/trusted-scope |
| [auth-callback-security-proof.md](auth-callback-security-proof.md) | §B redirect/cookie/token |
| [signin-credential-boundary.md](signin-credential-boundary.md) | §C |
| [signout-session-retirement-proof.md](signout-session-retirement-proof.md) | §D |
| [chat-context-authority-proof.md](chat-context-authority-proof.md) | §E context/authority |
| [chat-tool-and-permission-proof.md](chat-tool-and-permission-proof.md) | §E tools/roles |
| [chat-stream-settlement-evidence.md](chat-stream-settlement-evidence.md) | §F NDJSON |
| [trace-and-redaction-proof.md](trace-and-redaction-proof.md) | §F tracing |
| [provider-zero-call-evidence.md](provider-zero-call-evidence.md) | §E/§G zero-call |
| [simulate-process-security-proof.md](simulate-process-security-proof.md) | §G runner |
| [simulate-input-confinement.md](simulate-input-confinement.md) | §G caller-input |
| [simulator-output-and-cleanup-proof.md](simulator-output-and-cleanup-proof.md) | §G output/cleanup |
| [human-truth-contract.md](human-truth-contract.md) | §H |
| [zero-raw-handler-ratchet.md](zero-raw-handler-ratchet.md) | §J |
| [factory-allowlist.md](factory-allowlist.md) | the exact 3 factories |
| [changed-files.md](changed-files.md) | edit log |
| [test-and-validation-report.md](test-and-validation-report.md) | full suite + static |
| [superseded-claims.md](superseded-claims.md) | claims replaced |
| [unknowns-and-owner-decisions.md](unknowns-and-owner-decisions.md) | decisions + unknowns |

---

## [SUPERSEDED IN PART — B16.0.24.1]

The capability table's "declarative env injection | `exposeEnvironment: true`
→ `input.environment`" row is superseded: B16.0.24.1 replaced it with the
least-privilege `exposeAuthRuntime: true` → frozen `input.authRuntime`
projection (mode + Supabase URL + selected key only). The simulate raw-file
read and the Supabase-branch coverage were also corrected/closed — see
`artifacts/ai-control-plane-b16-0-24-1/README.md`.
