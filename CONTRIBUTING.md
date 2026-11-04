# Contributing to Sirkit

Thanks for helping. This guide covers setup, the checks to run before a pull
request, and the project's rules. By taking part you agree to follow the
[Code of Conduct](CODE_OF_CONDUCT.md). Report security problems privately as
described in [SECURITY.md](SECURITY.md), never in a public issue or pull
request.

## Setup

Use the versions CI pins in `.github/workflows/`:

- **Node 24**
- **pnpm 11.2.2**

Then install from the lockfile, without changing it:

```bash
pnpm install --frozen-lockfile
```

If a change really needs a new or updated dependency, say why in the pull
request and commit the updated `pnpm-lock.yaml` with it.

## Developing without any keys

You do not need any API key, database or account to work on Sirkit:

```bash
pnpm run dev:fixture
```

This serves the app at http://localhost:3100. `scripts/dev-fixture.mjs` starts
`next dev` under the env-gated fixture runtime. It sets
`SIRKIT_FIXTURE_RUNTIME=blinker`, `SIRKIT_AUTH_MODE=local_dev`,
`SIRKIT_FIXTURE_ROUTER=replay`, `SIRKIT_PCB_SYNC_STAGE3=opt_in` and an empty
`DATABASE_URL`. The app then uses in-memory stores, the committed blinker
catalog, a recorded provider design, a recorded router replay and a
local-development identity.

You need no Anthropic, OpenAI, Supabase, Digi-Key, Mouser, Octopart/Nexar or
Hugging Face credentials for this, and you should not create a `.env.local`
just to contribute. The fixture runtime is honoured only in a non-production
runtime with local-development auth (`app/lib/fixture-runtime/mode.ts`).

## Before you open a pull request

Run these from the repository root. CI does not run all of them (it runs the
type check, selected vitest suites, the browser suites, a production build
smoke test and the secret scan), so please run the rest locally.

```bash
# Type check. A full check needs about 2.2 GB of heap; CI raises Node's limit the same way.
NODE_OPTIONS=--max-old-space-size=4096 pnpm exec tsc --noEmit

# Lint
pnpm lint

# Unit and integration tests (vitest). The full suite is long; at least run the suites near your change,
# e.g. pnpm exec vitest run app/lib/pcb
pnpm test

# Deterministic netlist core
pnpm test:netlist

# Browser tests against the fixture runtime (installs Chromium once)
pnpm exec playwright install chromium
pnpm e2e

# Secret scan (must exit 0)
pnpm exec tsx scripts/scan-secrets.ts
```

On Windows PowerShell, set the heap limit with
`$env:NODE_OPTIONS="--max-old-space-size=4096"` before running `tsc`.

If you change the agent orchestration, also run
`pnpm exec playwright test -c playwright.orchestration.config.ts`. Before you
commit, `pnpm exec tsx scripts/scan-secrets.ts --staged` scans exactly what you
staged.

### Gotchas

- **Generated files inside the checkout break the import gates.** Some vitest
  suites walk the whole working tree, ignoring `.gitignore`. Before a broad
  vitest run, delete `playwright-report/`, `playwright-report-orchestration/`
  and `test-results*/`, and do not keep git worktrees or other checkouts
  inside the repository folder.
- **Stop `pnpm run dev:fixture` before `pnpm e2e`.** Outside CI, Playwright
  reuses a server already listening on port 3100, and that server lacks the
  extra settings the browser suites start their own server with.
- **The fixture runtime uses a frozen clock.** `Date.now()` and `new Date()`
  answer a fixed instant (`SIRKIT_FIXTURE_CLOCK`, default
  `2026-09-09T12:00:00.000Z`) so recorded router runs replay. Timers still run.
- **Line endings.** `.gitattributes` keeps working trees on LF. The KiCad
  `.kicad_mod` test fixtures are byte-exact copies (some with CRLF) and are
  marked `-text`; do not open and re-save them.
- **Generated artifacts are pinned.** Many files under `artifacts/` and some
  under `app/` are produced by `scripts/generate-*.ts` or `scripts/gen-*.ts`
  and checked byte for byte by tests. Change the generator and re-run it; do
  not edit the output by hand.
- **Database-backed suites are opt-in.** Without their marker they are
  skipped, not failed, and the vitest setup file removes any ambient
  `DATABASE_URL` before every test file.
- **Do not make a failing test pass by weakening it.** Do not raise a
  timeout, loosen an assertion or relax a policy, CSRF check, role check or
  gate. If a test times out because it imports a large module graph inside
  the test body, move that import to the top level of the test file.

### Maintainer-only gates

Some suites talk to real services and spend real credit. They are run by the
maintainer only, and CI never runs them. Leave these unset:

- `SIRKIT_LIVE_AUTH_QUALIFICATION`
- `SIRKIT_LIVE_ORCHESTRATION_EVALUATION` and `SIRKIT_LIVE_ORCHESTRATION_PROVIDER`
- `SIRKIT_LIVE_ACQUISITION_CONTRACT`
- `SIRKIT_DB_QUALIFICATION` and `SIRKIT_DB_QUALIFICATION_URL`

If you do run the database qualification suites, point
`SIRKIT_DB_QUALIFICATION_URL` only at a throwaway local PostgreSQL, never at a
shared or hosted database.

### Optional tools

None of these is needed for the default suites:

- FreeRouting autorouting: `pnpm run setup:freerouting` (a PowerShell script
  that installs a pinned FreeRouting JAR and a private Java runtime).
- `kicad-cli` for KiCad-based exports (`KICAD_CLI`).
- A pinned ngspice install for the diagnostic simulation runner
  (`SIRKIT_NGSPICE_INSTALL_ROOT`, `SIRKIT_NGSPICE_INSTALL_SHA256`).

## Rules

- **Database changes:** add a SQL migration under `drizzle/` and apply it with
  `pnpm run db:migrate`. Never use `drizzle-kit push` or `pnpm run db:push`:
  `schema.ts` lacks constraints that exist only in the migrations.
- **No secrets or live data in the repository.** Never commit `.env*` files
  (only `.env.example`, with empty values), API keys, tokens, cookies,
  passwords, or real provider responses and recordings of live API calls. Use
  the existing fixtures and fakes. `scripts/scan-secrets.ts` runs in CI on
  every commit of a pull request; a secret that was pushed must be treated as
  leaked and rotated, even if a later commit removes it.
- **KiCad library files stay CC-BY-SA-4.0.** The `.kicad_sym` and `.kicad_mod`
  files listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) are KiCad
  library data, not Sirkit code. Do not edit them; fix library data upstream
  at https://gitlab.com/kicad/libraries. If you add a library file, record its
  upstream path and blob id in the folder's `LICENSES.md` and in
  `THIRD_PARTY_NOTICES.md`, and mark any modification.
- **No third-party content you may not redistribute.** No vendor datasheets,
  vendor SPICE model libraries, fonts or other files whose licence does not
  allow redistribution. Credit permissively licensed material in
  `THIRD_PARTY_NOTICES.md`.
- **Licence of contributions.** Sirkit is released under the
  [MIT License](LICENSE). By submitting a contribution you agree that it is
  licensed under the project's licence, and you confirm that you have the
  right to submit it.
- **Security-sensitive paths need maintainer review.** Changes to `.github/`,
  `scripts/scan-secrets.ts` and `app/lib/deployment/secret-scan*.ts` are
  reviewed by the maintainer (see `.github/CODEOWNERS`).
- **First-time contributors:** GitHub holds CI runs on a pull request from a
  first-time contributor until a maintainer approves them, so expect a short
  wait before checks start.

## Pull requests

- Branch from `main` and keep each pull request focused on one change.
- Fill in the pull request template, including the checks you ran.
- Explain *why* as well as *what*, and link the issue if there is one.
- A maintainer reviews and merges. Please do not force-push over review
  comments without saying what changed.
