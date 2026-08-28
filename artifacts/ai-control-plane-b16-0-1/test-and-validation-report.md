# B16.0.1 — test and validation report

## Final tree-wide run

```
Test Files  342 passed | 3 skipped (345)
Tests       3073 passed | 20 skipped (3093)   ← ZERO failures
tsc --noEmit: clean          eslint (stage surfaces): 0 errors
```

The 3 "Unhandled Errors" in the run are the known `[vitest-worker]: Timeout
calling "onTaskUpdate"` worker-IPC noise under full parallel load — no test
failure attaches to them (same class as prior stages).

## New permanent B16.0.1 suites (all green)

| suite | tests | proves |
|---|---|---|
| `b16-0-1-ci-gates` | 23 | route↔policy bijection both directions over the live filesystem; zero identity-header reads (+tripwire); legacy backlog EMPTY; policy invariants (credit≠public, write≠none, CSRF on auth writes, release role-exact, viewer/commenter never in write sets); unclassified tripwires (`/api/calculation/evil` → 500 `AUTH_POLICY_MISSING`); exposure EXACTLY 12; release internal-only/not-callable; AST import gates (server auth core, reauth/approval authority) + synthetic tripwires; byte-pinned policy CSV |
| `b16-0-1-route-authorization` | 12 | viewer → 403 before authority load on release/qualify/pcb-sync/bindings/assignment-queue/sources; release admin-only (editor refused); qualify editor+admin (reviewer refused); unauthenticated → 401; production cross-origin/origin-less POST → 403 for an ADMIN; same-origin authorizes; GET needs no Origin |
| `b16-0-1-chat-authorization` | 4 | cross-origin/origin-less chat → 403 with NO run id (before any provider call); viewer chat → 403 `AUTH_ROLE_DENIED`; editor passes |
| `b16-0-1-verified-actor` | 4 | verified principal (id/role/revision/class/source) binds the run actor + discovery; viewer stays viewer; worker/local_dev sources honest |
| `b16-0-1-signin` | 7 | §H (CSRF-before-body, bounds, fail-closed 503, NO signup path, public+CSRF policy row, callback redirects, open-redirect matrix) |
| `b16-0-1-apply-reauthorization` (PCB) | 16 | §E binding sealed+verified; legacy refusals (missing binding, v1 schema); the §F six-way denial matrix + throwing transport, each ZERO mutation + ZERO journal; fresh membership commits once; foreign-authorization recovery refusal (real landed commit under another principal is never adopted); provider cannot supply `authorization`/`authorizationBinding` args |
| `b16-0-1-tier1-authorization` | 15 | same for B12: v3 binding; V2 → `legacy-authorization-missing`; denial matrix through the SERVICE; revoked author cannot even read back the applied receipt; recovery refuses coherently re-checksummed foreign receipts; healthy replay returns the byte-identical receipt |
| `b16-0-1-replacement-authorization` | 14 | same for B14 through the PRODUCTION controller (reauthorizer provably not called for a legacy artifact) |

## Updated suites (contract-following; nothing weakened, several EXTENDED)

- 16 app/api route-family suites + 3 lib API suites: identity moved to the
  injection seams (`injectIdentity(null)` → 401; viewer → 403), Origin headers
  added to legitimate requests, shared `AUTH_*` refusal codes adopted,
  production-env CSRF assertions added. Two suites gained NEW production-fix
  pins (mapping-verification forbidden keys; full-flow typed 409).
- b06-1 + all b12 suites: authorization fixtures + stub reauthorizers; the
  journal-strictness matrix gained 4 fail-closed cases; the receipt-forgery
  matrix grew 20 → 22; receipt/commitment pins moved to the v2 schemas.
- b14 suites (125 tests) + review dialog: v2 fixtures, intent authorization,
  controller reauthorization.
- b15 suites (10 files) + b15-3 apply/production-integration/exposure: the
  explicit v2 PCB schema, intent/journal/receipt authorization, forged-v1
  bodies now assert the legacy refusal.
- B16.0 suites: mode expectations tightened (production always wins); the
  auth-route coverage derives from the policy table; the identity-header
  gate's backlog is EMPTY (strictly tighter).
- B11 replay pins regenerated through `scripts/generate-b11-artifacts.ts`
  (only the e10 proposal-trace pin + derived digests — the v3 tier-1 identity
  is inside the replayed trace); 19/19 cases, 59/59 checks.
- B01/B16.0 artifact CSVs regenerated through their sanctioned generators.

## Flake discipline (stage rule honored)

Three known non-deterministic tests, none repaired by loosening, none in an
edited surface: `assignment-queue-panel` (documented since B15.2.2) and two
wall-clock budgets (`passive-policy performance-property` 5.0 s,
`pcb route-tool` perf 5 s) that failed ONCE under a fully loaded 14-worker
run, then passed 3/3 in isolation AND in the final full run — CONFIRMED
load-induced timing, source-level cause: fixed budgets under CPU contention.

## Production defects found BY the migration's verification (fixed + pinned)

1. mapping-verification `_scope` had silently dropped its forbidden
   authoritative-key list during the adapter rewrite (fail-open vs the prior
   contract) — restored via `forbiddenBodyKeys`, pinned.
2. passive-policy `_scope` had dropped its authoritative key-NAME regex screen
   (inexpressible via exact-key lists) — restored in-route, pinned.
3. full-flow transition crashed (unhandled TypeError → 500) on a structurally
   malformed run from an AUTHORIZED caller — the old caller-header 403 had
   masked it; now a typed 409 `CD13_RUN_SHAPE_INVALID`, pinned.
