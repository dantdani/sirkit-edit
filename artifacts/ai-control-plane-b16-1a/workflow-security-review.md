# B16.1A §F — benchmark workflow security review

`.github/workflows/benchmark.yml` (post-fix + hardening):

- **Least-privilege token**: `permissions: contents: read` at workflow level —
  the job token cannot write code, packages, or settings. The added
  `upload-artifact` step needs no extra permission.
- **No secrets consumed**: the workflow references no `secrets.*`, no
  provider keys, no external credentials. The "protected suites" step only
  ECHOES that holdout/licensed runs require credentials it does not have —
  truthful declaration, not a hidden dependency.
- **No network/provider dependence** beyond the GitHub-hosted actions and the
  pnpm registry fetch during `pnpm install --frozen-lockfile` (lockfile-pinned,
  integrity-checked).
- **Pinned toolchain**: pnpm 11.2.2 (matches local), Node 24, frozen lockfile
  — deterministic dependency graph.
- **Actions provenance**: `actions/checkout@v4`, `actions/setup-node@v4`,
  `pnpm/action-setup@v4`, `actions/upload-artifact@v4` — first-party or the
  official pnpm org, major-version tags. (Owner option: pin to full commit
  SHAs for supply-chain rigor — recorded in unknowns, not silently changed.)
- **No forbidden shortcuts**: zero `continue-on-error`, zero `|| true`, zero
  ignored exit codes (output capture uses `>` redirection, which propagates
  the command's exit status), no skipped benchmarks, no weakened assertions,
  no threshold changes.
- **Bounded**: 20-minute core / 90-minute nightly job timeouts; failure
  artifacts retained 14 days.
- **Triggers**: pull_request (gates PRs), schedule (nightly), and
  workflow_dispatch (manual verification) — no `pull_request_target`, so no
  privileged-context exposure to fork code (moot on a private no-fork repo,
  but correct by construction).
