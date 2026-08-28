# B15.2.3 — changed files (exact paths)

## Production

- `app/lib/pcb/proposal/bounded-edit-compiler.ts` — **added** the exported
  `BOUNDED_EDIT_IMPACT_LIMITS` constant (producer-derived ceilings:
  `maxArrayEntries` = 16 × 64 × 4 = 4096, `maxTextLength` = 1024, each with
  its derivation documented at the definition). No compile logic changed.
- `app/lib/pcb/proposal/sealed-pcb-edit-proposal.ts` — **replaced** the
  fail-open `validateImpactShape` with the closed contract (see
  [closed-impact-contract.md](closed-impact-contract.md)): exact
  `BOUNDED_EDIT_COMPILE_SCHEMA`, exact key sets at every nested boundary,
  finite/safe/nonnegative-integer counts, routed/total/unrouted arithmetic,
  0–100 percentages with `delta === afterPercent − beforePercent`,
  producer-bounded arrays and strings, per-entry id/text/number contracts,
  strictly-ascending set-produced arrays (submitted order preserved and
  UNCHECKED for operationSummaries/ruleChanges/warnings), exact
  `readiness: { state: "unavailable", reason }`, and one summary line per
  sealed operation. Added the hostile-safe `boundedSnapshot` (length
  validated before any element read) and used it for `mintedObjectIds` too.
  The impact validation still runs inside `validateProposalShape`, BEFORE
  any digest recomputation; the later
  `candidateDigest === impact.candidateBoardDigest` equality is untouched.
  Imports `BOUNDED_EDIT_COMPILE_SCHEMA` + `BOUNDED_EDIT_IMPACT_LIMITS` from
  the compiler (values; the type import already existed — no cycle: the
  compiler does not import this module).

## Tests

- `app/lib/pcb/proposal/__tests__/b15-2-3-impact-certificate.test.ts` —
  **new**, 18 permanent tests: §A the three exact R24 artifacts; §B
  extra/missing keys at every nested boundary; §C NaN/±Infinity/negative/
  fractional values, affectedNetIds numeric contract,
  routed/total/unrouted arithmetic, delta drift and range; §D the
  producer-exported ceilings pinned (4096/1024) plus oversized array and
  string refusals; §E duplicate/unsorted canonical ID arrays,
  operationSummaries submitted-order POSITIVE (lexically descending genuine
  summaries verify) and exact per-operation count; §F lying-length proxy
  (fast refusal), throwing getters, revoked proxies, cycles, sparse arrays,
  proxy-backed impact; §G genuine single-op AND genuine
  `set_net_class_rule` proposals (nonempty ruleChanges/affectedNetIds/minted
  rule id) verify.

## Not touched

`geometry-exact.ts` (R22 authority), the raw sealer + service, the
operations parser, the registry/action registry, agent gateway/loop,
`PcbEditor`, approval/apply, durability/recovery, provider adapters, and
every deterministic artifact generator are byte-unchanged. No prior test
assertion was weakened; no existing test file was modified.
