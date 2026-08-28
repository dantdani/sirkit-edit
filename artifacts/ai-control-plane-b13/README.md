# B13 — server-owned component-authority resource bridge and verified-replacement prerequisite

Establishes the production, server-owned path that converts durable
physical-binding + atomic-part facts into a revision-pinned
`component-authority-records` resource for the real agent chat context —
and closes the asset-substitution hole in verified-replacement authority.
B13 is read-only from the agent's perspective: it establishes trustworthy
facts and performs no replacement or design mutation.

## What was broken (reproduced)

| # | Defect | Status |
| --- | --- | --- |
| 7 | `consumeReplacementAuthority` installed caller-supplied `symbol/footprint/mapping/selection` asset IDs into a verified grant with NO server-owned comparison | reproduced + closed |
| 1 | a normal production resource bundle carried no `component-authority-records` envelope | reproduced + closed |
| 2 | the component-authority inspection tool was withheld (`not_agent_exposed`) from every real chat run | reproduced + closed |
| 3–6, 8 | foreign-scope / conflict / stale-unapproved-unavailable-unverified / DB-unavailable behavior existed only in the pure inspector — no production loader fed it | closed (loader built) |

Details: [pre-edit-counterexamples.md](pre-edit-counterexamples.md).

## What B13 built

1. **Server-owned loader** — [component-authority-source.ts](../../app/lib/engineering/component-authority-source.ts): projects durable binding aggregates (+ atomic confirmation) into `ComponentAuthorityRecord[]`, authenticated-scope only, fail-closed, deterministic, bounded. [production-authority-source-map.md](production-authority-source-map.md), [scope-freshness-conflict-matrix.md](scope-freshness-conflict-matrix.md).
2. **Exact target authority** — a server-owned `exactAuthority` block on the record carrying the complete asset identity. [exact-target-authority-contract.md](exact-target-authority-contract.md), [component-authority-record-contract.md](component-authority-record-contract.md).
3. **Grant hardening** — `consumeReplacementAuthority` derives/exact-compares every installed asset field against the server-owned record; substitution of any field fails closed before grant registration. [grant-consumption-hardening.md](grant-consumption-hardening.md).
4. **Resource + context integration** — the sealed `component-authority-records` envelope (durable-server-board, revision-pinned) enters the real `/api/chat` context after scope validation, fail-closed, abort/deadline-bounded, never from the request body. [context-and-resource-integration.md](context-and-resource-integration.md).
5. **Discovery + invocation** — the inspection tool becomes callable when the resource is valid, withheld otherwise. [discovery-and-invocation-results.md](discovery-and-invocation-results.md).
6. **Replay/trace** — the authority envelope participates in the sealed manifest digest, which flows into trace identity/replay. [replay-and-trace-results.md](replay-and-trace-results.md).

Security posture: [security-boundary.md](security-boundary.md). Coverage:
[regression-matrix.md](regression-matrix.md). Battery + hashes:
[validation-summary.md](validation-summary.md). Changes:
[changed-files-and-deviations.md](changed-files-and-deviations.md).
Verdict: [verdict.md](verdict.md).
