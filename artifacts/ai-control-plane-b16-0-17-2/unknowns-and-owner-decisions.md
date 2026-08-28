# B16.0.17.2 — Unknowns & owner decisions

## Decisions taken (per the corrective mandate)

1. **The 4,096 limit moved INTO the schema** (CONFIRMED) — mandated as an
   intentional security-boundary tightening of provider-declared output. A
   strict-mode provider will now itself refuse over-long id strings; the local
   validator remains the fail-closed guarantee.
2. **Validator node-parameterization** (CONFIRMED) — `stringArray`/`boundedString`
   consume the schema nodes; absent bounds default open (`minLength ?? 0`,
   `maxLength ?? ∞`), so the schema stays the single authority even for fields
   that deliberately declare no bound.
3. **The no-hard-coded-limit gate scans limits ≥ 32** (RECORDED) — small
   literals (diagnostic truncation offsets like `slice(0, 64)`) are formatting
   bounds, not schema limits; every actual schema limit (32, 64, 256, 512,
   1000, 2000, 4096) is covered by the scan, and the scanned set is itself
   read from the schema.
4. **Adapter parity via reference-identity** (CONFIRMED) — both adapters pass
   the schema object through unmodified, so the assertion `toBe(schema)` is
   the strongest possible no-weakening proof; a future copying layer would
   fail it loudly.
5. **One disclosed test-typing fix** — the adapter test's untyped mock tuple
   tripped `tsc` on the first pass; fixed with explicit param typing +
   `as unknown as` casts. Behavior identical (vitest ran it green both times).

## Unknowns carried forward

- **R9 live-Supabase production auth remains UNKNOWN.**
- Remaining migration: **59 raw methods** (baseline 62) — unchanged.
- Live-provider strict-mode enforcement of nested maxLength is the provider's
  behavior, not ours — the schema now DECLARES it and the local validator
  ENFORCES it regardless; actual provider-side rejection rates remain UNKNOWN
  (zero credits spent).

## Scope adherence

Only `agent-tools.ts` (schema nodes + validator internals) and two new test
files changed. No route, prompt, config, inventory, or exposure change.
`C:\Users\robsa\sirkit` untouched. B16.0.18 / B16.1 NOT started.
