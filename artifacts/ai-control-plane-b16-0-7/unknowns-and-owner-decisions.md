# B16.0.7 — Unknowns & owner decisions

## The central decision: this stage is a large architectural migration

B16.0.7 requires migrating **150 raw route handlers (of 153 methods across 142
files)** to mandatory canonical wrappers, adding four new wrapper variants,
migrating body-scope routes to header selectors, and adding a type-checker
confinement gate. That migration touches the runtime of nearly every API route
and cannot be applied correctly in a single pass without a high risk of
regressing the 3366-test suite.

**Decision taken this stage (truthful):** deliver the parts that are correct and
verifiable now — the R1–R11 analyzer/flow-gate closures (defense in depth), the
wrapper-adoption classifier + structural gate + negative tripwire, and the
adoption inventory — and DOCUMENT the migration as the major remaining work
rather than fake completion or ship a half-broken migration. The stop condition
is NOT met; this is stated plainly in [final-verdict.md](final-verdict.md).

## Owner decisions required

1. **Migration sequencing & risk tolerance.** The 150-route migration is best
   done family-by-family with each family's tests re-run green before the next
   (plan in [migration-and-rollback.md](migration-and-rollback.md)). The owner
   should decide whether to run it as one large change or staged PRs.
2. **New wrapper variants.** `authenticatedStreamingJsonRoute`,
   `publicStreamingInputRoute`, `boundedNonJsonRoute`, and `selectorEnvelopeRoute`
   must be designed and audited before their routes (chat, replacement-authority,
   any non-JSON body) can migrate.
3. **Hard gate cutover.** The structural adoption gate flips to all-adopted
   (`EXPECT_FULL_ADOPTION = true`) only once every protected/body method is a
   wrapper; enabling it earlier fails CI.
4. **Type-checker confinement (§E).** A `Request`-parameter/`Request`-in-callback
   type gate becomes meaningful only after routes stop taking a `Request`
   parameter (i.e. after migration); until then the AST/flow gate enforces the
   route surface.

## Residual risk

- **R9 live-Supabase production auth remains UNKNOWN** — no live database
  contacted.
- The analyzer/flow gate remains defense-in-depth, not the primary boundary; its
  honest guarantees are unchanged from B16.0.6 plus the R1–R11 closures. The
  primary-boundary goal (wrappers) is only partially delivered.

## Scope adherence

- Work confined to `C:\Users\robsa\Desktop\sirkit-edit`; `C:\Users\robsa\sirkit`
  untouched; no production route source changed.
- No provider credits; no live database writes.
- No security test weakened; the adoption gate is honest (asserts the CURRENT
  0/153 baseline + the negative tripwire).
- **B16.1, MCP, multi-agent, manufacturing integration, provider expansion,
  migrations, and new tool exposure NOT started**; 12 exposed tools, replay pins,
  hashes, internal-only release preserved.
