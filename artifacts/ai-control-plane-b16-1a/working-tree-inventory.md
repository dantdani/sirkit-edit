# B16.1A §D — working-tree inventory

## At stage start

The working tree was CLEAN: the accumulated B06–B16.0.24.1 work (1,220 added /
278 modified / 1 deleted vs the pre-integration `main`) had already been
committed on the `-clean` branch and merged to `main` via PR #2 before this
stage began. `git status` on the checked-out branch showed no modifications;
local `main` was merely behind `origin/main` and was fast-forwarded (never
force-pushed).

## Content inventory of the merged integration (for the record)

- app/lib — the control-plane, agent, engineering-authority, SPICE, benchmark,
  and auth libraries (the bulk of the 1,220 additions).
- app/api — the migrated canonical routes and their §A parity/gate suites.
- app/components — assignment-queue and related UI surfaces.
- scripts/ — sanctioned artifact/baseline generators and benchmark tooling.
- drizzle/ — membership/ownership migrations (0027, 0028).
- artifacts/ — the complete per-stage evidence trail
  (ai-control-plane-b01 … b16-0-24-1) plus the access-revocation audit.
- Deleted: `scripts/_tmp-perf.ts` (a temporary probe — correctly removed).

Secret scan at commit time: no `.env*` (ignored by `.gitignore`), no
token/credential/key-shaped files staged; the repository's ignores cover
`node_modules`, `.next`, and `.env*` (with `!.env.example`).

## New this stage

- `.github/workflows/benchmark.yml` — failure-diagnostics hardening (commit 1).
- `artifacts/ai-control-plane-b16-1a/` — this evidence set (commit 2).
