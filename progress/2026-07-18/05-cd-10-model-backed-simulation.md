# CD-10 Model-Backed Simulation

Date: 2026-07-18  
Branch: `codex/cd-10-model-backed-simulation`  
Specification SHA-256: `7B60B08DDEAE2DBBCA640221CBBD19918AE5005F24EB2FDEFE7FB430E4471F0A`

## Changed and why

- Added `app/lib/model-simulation/` as a separate fail-closed authority path so legacy coordinate-derived SPICE/netlist/model behavior cannot certify CD-10.
- Enforced `BLOCKED BY CD-9` before model/provider work and pinned the exact CD-8 graph/CD-9 report digests.
- Added immutable model/license registries, exact terminal certificates, claim applicability, reviewed testbenches, explicit scenarios/corners/providers, and a non-vacuous denominator.
- Added graph-only IR, content-addressed lowering, distinct reference preservation, convergence classification, immutable waveform authority, uncertainty-aware measurements/assertions, exact coverage partitioning, readiness, and replay keys.
- Added deny-by-default execution authorization. Existing local ngspice remains diagnostic because it has mutable PATH selection and no validated sandbox/binary digest.
- Added scoped APIs, proposal-only AI tools, project history/invalidation, DB migration, CD-10 review UI, 102-case honest corpus manifest, and three benchmark packages.

## Evidence

- CD-10/API focused tests: 13 passed.
- Complete serial suite: 176 files passed, 1,198 tests passed, 9 skipped, zero failed. One route-preview performance test timed out only in the heavily parallel run, then passed isolated at 10.49 ms p95 and in the clean serial suite at 9.50 ms p95.
- TypeScript and focused ESLint: passed.
- Production build: passed; five existing Turbopack tracing warnings remain in legacy executable paths.
- Benchmark manifest: 54 packages, zero diagnostics.
- Full suite/build evidence is recorded after final verification.

## Verdict

`BLOCKED` — primary blocker `BLOCKED BY CD-9`; exact production registries, validated sandbox/provider, licensed golden/cross-provider evidence, authoritative sample campaign, and qualified review also remain.
