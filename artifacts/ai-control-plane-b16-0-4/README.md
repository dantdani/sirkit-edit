# B16.0.4 — Method-scoped authorization proofs & universal request-body bounds

This stage closes two gaps left by B16.0.1–B16.0.3:

1. **Authorization was detected at file granularity** — a sibling method's guard,
   an ignored boundary result, or a late boundary could pass. B16.0.4 proves a
   **load-bearing, dominant** boundary for **every protected exported HTTP
   method** (method-scoped), kept honest by negative tripwires.
2. **Bounded-body coverage was an 11-route allowlist** — new routes escaped it.
   B16.0.4 migrates **every** `app/api` handler to the one bounded reader and
   replaces the allowlist with an **automatic discovery gate**.

## Results at a glance

| Metric | Value |
|---|---|
| Protected exported methods proven load-bearing & dominant | **121 / 121** (0 rejects) |
| — guard-first shapes / factory-delegation | 118 / 3 |
| Public exported methods (policy: no auth) | 32 |
| Routes migrated to the bounded body reader | **49** |
| Direct unbounded body reads remaining in `app/api` | **0** |
| §A negative tripwires (must fail the gate) | 10 (+ factory + §C body tripwires) |
| §D behavioral tests (real handlers + shared reader) | 52 + the exact-200 fix |

## Documents

| Doc | Section | What it covers |
|---|---|---|
| [pre-edit-counterexamples.md](pre-edit-counterexamples.md) | R1–R7 | Mandatory pre-edit reproductions of every gap this stage closes |
| [method-scoped-authorization-proof.md](method-scoped-authorization-proof.md) | §A | The method-scoped, load-bearing, dominant analysis + the audited wrapper |
| [authorization-tripwires.md](authorization-tripwires.md) | §A | The 10 negative tripwires (+ factory + §C body tripwires) |
| [method-authorization-matrix.csv](method-authorization-matrix.csv) | §A | Generated per-method boundary verdict (byte-pinned, generator-emitted) |
| [request-body-boundary-matrix.csv](request-body-boundary-matrix.csv) | §B/§C | Generated per-method body limits/ordering/parser/downstream matrix |
| [route-authorization-and-body-matrix.md](route-authorization-and-body-matrix.md) | §A/§C | Human-readable per-method boundary + per-route body reader tables |
| [bounded-body-migration.md](bounded-body-migration.md) | §B | The 49-route migration, per-family limits, patterns |
| [public-body-abuse-surface.md](public-body-abuse-surface.md) | §B | Public routes' pre-compute body bounds and abuse analysis |
| [body-coverage-gate.md](body-coverage-gate.md) | §C | The automatic discovery gate that replaced the allowlist |
| [bounded-reader-settlement-evidence.md](bounded-reader-settlement-evidence.md) | §D | Behavioral proof of the ceiling/deadline/abort/latch contract |
| [replacement-authority-exact-200.md](replacement-authority-exact-200.md) | §D | The `[200,503]` → exact-200 nonce/component/scope binding fix |
| [changed-files.md](changed-files.md) | — | Every file this stage created, edited or deleted, with why |
| [superseded-claims.md](superseded-claims.md) | §E | What B16.0.1–B16.0.3 claims this stage refines (nothing deleted) |
| [test-and-validation-report.md](test-and-validation-report.md) | §F | Full-suite counts + exit code, tsc, eslint, generators, git check |
| [unknowns-and-owner-decisions.md](unknowns-and-owner-decisions.md) | — | Analyzer soundness boundary, R9 unknown, owner decisions, scope |
| [final-verdict.md](final-verdict.md) | — | Stop-condition item-by-item verdict |

## Key source

- Analyzer: [`app/lib/auth/__tests__/_boundary-analysis.ts`](../../app/lib/auth/__tests__/_boundary-analysis.ts)
- Audited wrappers: [`app/lib/auth/route-handlers.ts`](../../app/lib/auth/route-handlers.ts)
- Bounded reader: [`app/lib/http/bounded-json.ts`](../../app/lib/http/bounded-json.ts)
- Gates: [`app/lib/auth/__tests__/b16-0-2-gates.test.ts`](../../app/lib/auth/__tests__/b16-0-2-gates.test.ts) (§A method loop + §C body gate), [`app/lib/auth/__tests__/b16-0-4-authorization-and-body-gates.test.ts`](../../app/lib/auth/__tests__/b16-0-4-authorization-and-body-gates.test.ts) (tripwires)
- Behavior: [`app/api/__tests__/b16-0-4-bounded-body-behavior.test.ts`](../../app/api/__tests__/b16-0-4-bounded-body-behavior.test.ts)

## Reproduce

```bash
# method-scoped authorization + automatic body gate (all routes)
npx vitest run app/lib/auth/__tests__/b16-0-2-gates.test.ts
# analyzer tripwires (§A) + body-read detection (§C)
npx vitest run app/lib/auth/__tests__/b16-0-4-authorization-and-body-gates.test.ts
# bounded-body behavior across families (§D)
npx vitest run app/api/__tests__/b16-0-4-bounded-body-behavior.test.ts
# the exact-200 replacement-authority fix (§D)
npx vitest run app/api/replacement-authority/__tests__/b16-0-3-route-auth.test.ts
```

## Scope

No provider credits spent, no live database contacted or mutated, no security
test weakened. B16.1, MCP, multi-agent orchestration, manufacturing/provider
expansion, and new AI-tool exposure were **not** started.
