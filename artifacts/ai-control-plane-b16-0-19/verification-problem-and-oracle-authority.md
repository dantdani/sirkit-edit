# B16.0.19 §E — Verification problem & oracle authority (CONFIRMED / by construction)

## /problem

Pinned upstream requirements (approved CD-8 project, CD-1..CD-8 signoff,
approved registry, requirements, contexts) → exact 400 (pinned); project/branch
scope → 403 (pinned); actor exclusively from trusted context into
`compileCircuitVerificationProblem`; no rule or evidence is invented — the
compiler consumes only the supplied pinned inputs (unchanged code, domain
suite green).

## /run

The 422 integrity gate validates problem + graph + registry AND the pins
(`problem.semanticGraphDigest === graph.deterministicDigest`,
`problem.ruleRegistryDigest === registry.deterministicDigest`) BEFORE oracle
execution (pinned). Complete-denominator construction, contexts and
requirement coverage, `runKind: "full"`, and the deterministic run digest are
unchanged code covered by the standing route/domain suites. **No provider
call** (the route never imports the router — gate-asserted) and **no
mutation** (pure computation over the supplied graph).

## The CD-9 chain

problem → applicability/registry/graph inputs → complete denominator → full
oracle run → findings → readiness → remediation proposal → human review — no
stage was reordered, skipped, or granted new authority by this migration.
