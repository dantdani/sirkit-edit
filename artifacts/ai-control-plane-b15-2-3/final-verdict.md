# B15.2.3 — final verdict

**Stop condition MET.** Every R24 variant fails closed permanently, genuine
artifacts still verify, all required gates pass, exposure remains exactly
11, and the raw-sealer allowlist is unchanged.

## Closure

| # | Defect | Closure | Test |
| --- | --- | --- | --- |
| **R24a** | `impact.schema` needed only to be "a string" — `"sirkit.evil-impact.v999"` verified with recomputed checksums | `impact.schema === BOUNDED_EDIT_COMPILE_SCHEMA`, imported from the producer | §A R24a |
| **R24b** | unknown keys were accepted at every impact nested boundary — `untrustedAuthority`, `drc.untrusted`, `readiness.extra` all verified | exact closed key sets for impact, drc, connectivity, routingCompletion, readiness (unknown AND missing keys refuse) | §A R24b, §B |
| **R24c** | any JavaScript number passed — `[1.5, -2, Number.MAX_VALUE]` net ids and `Infinity` percent verified | finite/safe/nonnegative-integer counts, 0–100 percentages, `delta === afterPercent − beforePercent` exactly, routed ≤ total with exact unrouted arithmetic, safe nonnegative integer net ids | §A R24c, §C |
| — | no bounds, no canonical order, unbounded proxy iteration possible | producer-exported `BOUNDED_EDIT_IMPACT_LIMITS` (4096 entries / 1024 chars, derivations documented at the producer), per-entry id/text/number contracts, strictly-ascending set-produced arrays (NO invented order for operationSummaries/ruleChanges/warnings — a genuinely descending-summary proposal verifies), one summary line per operation, length-first `boundedSnapshot` against lying proxies | §D, §E, §F |

## Validation

18/18 new · 110/110 across all six B15 proposal suites · 112/112 direct
battery (B08 canonical/authority, B11.5 exposure, B14.4/B14.5 AST gates) ·
**full suite 2884 passed / 20 skipped / 0 failures** (2904; 324 files
passed / 3 skipped, exit 0, no intermittent failure this run) ·
`tsc --noEmit` 0 errors · scoped ESLint clean · `git diff --check` clean ·
pins byte-identical · protected original at its 6-entry baseline.

## Classification

**CONFIRMED** — the three R24 reproductions (`{ok:true}` each, recorded
verbatim pre-edit) and the closure, backed by 18 green permanent tests
including two genuine-producer positives; zero drift across every prior
suite; exposure exactly 11; allowlist unchanged at two modules; IEEE
determinism of the delta equality.
**INFERRED** — that board-sourced layer identifiers always satisfy the
bounded identifier pattern (operation-sourced ones provably do), and that
the two non-constant producer paths (footprint pad nets into
affectedNetIds; resolvedViolationIds) stay under the 4096 ceiling for any
physical artifact — both recorded in [unknowns.md](unknowns.md).
**PROPOSED** — none. **UNKNOWN** — the items in
[unknowns.md](unknowns.md), including the still-open pre-existing
`assignment-queue-panel` flake from B15.2.2 (did not fire this run).

## Architectural statement preserved

The proposal digest remains an **integrity checksum** — never authenticity,
never mutation authority. Human approval capability and live
reauthorization remain the authority; the apply path recompiles from the
live board and byte-matches digests. B15.2.3 closed the LAST structurally
fail-open region in front of that checksum: the impact certificate.

**Not started:** registry exposure, gateway/loop, `pcb_proposal_ready`,
review UI, approval/apply, durability/recovery, B15.3, B16, MCP,
multi-agent orchestration, manufacturing release. Stopped for independent
verification.
