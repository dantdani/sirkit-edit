# B16.1A §G — validation report

All on the LF-normalized working tree (see the CRLF note in
[unknowns-and-owner-decisions.md](unknowns-and-owner-decisions.md)).

## Suites

| battery | result |
|---|---|
| B16.0.24.1 focused (`b16-0-24-1-security-correction` + `b16-0-24-tranche-parity`) | **41 green** (22 + 19) |
| authorization/confinement gates (`b16-0-24-tranche17-confinement-gate`) | **14/14** |
| zero-raw ratchet (`b16-0-8-migration-ratchet`) | **12/12** — including against the COMMITTED baseline after restore |
| benchmark-quality exact local commands | validate `{packages: 63, diagnostics: []}` · tsc **0 errors** · stage-09 **18/18** · stage10 **801/801** · stage-08 **11/11** · junit dual-reporter probe OK |
| FULL bounded Vitest suite (maxForks=2) | **4518 passed / 0 failed / 20 skipped / exit 0** |

Disclosed intermediate run: the first full run (pre-LF-fix) failed 2/4518 —
the CRLF-broken source-scan gate (deterministic, root-fixed by the LF
re-checkout + `.gitattributes`) and the known `assignment-queue-panel` UI
waitFor load-flake (passes in isolation). Both green on the final run.

## Static gates

`tsc --noEmit` **0 errors** · `git diff --check` clean · scoped ESLint on
this stage's changes: nothing lintable changed (workflow YAML + markdown).
Repo-wide ESLint carries **33 pre-existing errors** in old UI files
(`app/page.tsx`, `app/components/pcb/*` — React refs/effect rules), untouched
by any B16.x stage; recorded, not hidden.

## Generators (sanctioned, ×2)

Consecutive regenerations byte-stable; on the LF tree the regenerated
`_raw-route-baseline.json` and `route-wrapper-matrix.csv` are
**byte-identical to the committed files** (`git status` empty after regen) —
the strongest reproducibility statement available.

## Invariants

| invariant | value |
|---|---|
| total route methods | **153** |
| canonical wrappers | **150** |
| approved factories | **3** |
| raw handlers | **0** |
| exposed agent tools | **12** (registry gate inside the passing suite) |
| secret-bearing files staged | **none** (scan clean; `.env*` ignored) |
| `C:\Users\robsa\sirkit` | **untouched** |
