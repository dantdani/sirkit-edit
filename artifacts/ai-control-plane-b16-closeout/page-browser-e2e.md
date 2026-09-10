# B16-C.5 — Page-level browser proof

Labels: CONFIRMED = executed and measured on this machine; INFERRED = derived from code reading; PROPOSED = design not yet exercised; RECORDED = written down without a claim; UNKNOWN = not established.

## Harness (CONFIRMED)

- `playwright.config.ts` starts the REAL Next.js application (`next dev --port 3100`) under the env-gated **fixture runtime** (`SIRKIT_FIXTURE_RUNTIME=blinker`, `SIRKIT_AUTH_MODE=local_dev`, `DATABASE_URL=""`): in-memory durable and binding stores (one container per process, anchored on `globalThis` so every route bundle shares it), the committed blinker catalog, the recorded provider design (zero credits), the recorded FreeRouting run replayed by placed-board revision (`e2e/fixtures/blinker-route-fixture.json`; `SIRKIT_FIXTURE_ROUTER=record` re-records with the bundled runtime; `live` is explicit), and the local-development identity with a dev-only role cookie (`sirkit-fixture-role`: one distinct principal per role). Honoured ONLY in a non-production runtime with local_dev auth; production ignores the request and reports the refusal (`app/lib/fixture-runtime/__tests__/fixture-runtime.test.ts`).
- Every test starts a FRESH browser context: empty storage, no cookies (`storageState: { cookies: [], origins: [] }`); the role cookie is the only thing the test sets, and it is cleared and re-set for each role switch.
- Deterministic browser identities (test seam, application untouched): the page mints project, component and wire ids with `crypto.randomUUID()`, and the placed-board revision that keys the router recording includes the footprint/sync identities, so a random browser could never replay a committed FreeRouting run. The spec's `addInitScript` replaces only the browser's UUID source with a sequence persisted in `localStorage` (reloads continue it; no two ids collide across the journey). Everything else — layout, sync plan, placement, DRC, qualification, release — is the application's own deterministic code.
- Frozen clock (both ends): every durable identity is time-bearing below the surface (binding record digests carry `createdAt`; the resolver's decision digest carries the request's `requestedAt`; the sync plan carries the resolver evidence; the footprint carries the plan id; the placed-board revision — the router recording's key — carries the footprints). The deterministic pipelines freeze time at `FIXED_NOW`; the fixture runtime freezes the server's `Date.now()`/`new Date()` at the same instant (`app/lib/fixture-runtime/clock.ts`, installed by `instrumentation.ts` at start-up only when the fixture runtime is enabled; explicit dates, parsing and timers untouched; `SIRKIT_FIXTURE_CLOCK` overrides) and the spec freezes the browser's `Date` with Playwright's fixed clock. `SIRKIT_FIXTURE_ROUTER_DUMP=<dir>` writes every router input board's canonical revision payload for diffing when a replay misses.
- The fixture provider answers only the build planner; every other provider request (auto-review after approval, tidy, second opinion, edits) is the bounded `provider_unavailable` (503, `missing_credentials`) — visible in the page as the provider-unavailable alert, never a 500.
- Live provider / auth / router variations stay opt-in elsewhere (B16.1B matrix, LB-1..LB-6).

## The spec (`e2e/prompt-to-gerber.spec.ts`)

One serial journey, in order:

| step | what the browser does | what is asserted |
| --- | --- | --- |
| 1 | opens `/` with the editor cookie | fixture-runtime and local-dev banners visible; a project is bootstrapped from nothing durable |
| 2 | types the blinker prompt, presses Enter | the recorded provider design comes back as a schematic proposal |
| 3 | approves the proposal | dialog closes; components exist (nine exact candidates appear in the PCB view) |
| 4 | opens PCB (the "No board yet" state — there is no manufacturing panel before a board exists), clicks Schematic → PCB as an EDITOR | Sync stops at binding with "reviewer approval required"; still no board (nothing durable was written) |
| 4 | requests review for all | 9 pending; refresh as editor → still 9 pending (durable) |
| 4 | reloads as REVIEWER, opens evidence, approves each | 0 pending, no reviewer controls left |
| 4 | reloads as EDITOR | every candidate approved — resumes without rebuilding anything |
| 5 | Schematic → PCB, then the explicit Apply of the exact plan | state `awaiting_qualification`; refresh keeps it |
| 6 | clicks Qualify twice | exactly one `POST /api/pcb/qualify`; state `qualified`; refresh keeps it; editor's release button disabled with the server's reason |
| 7 | reloads as ADMIN, requests release, confirms the named authority | download event; state `released`; sha256 shown; authority revision 1 |
| 8 | verifies the downloaded bytes | sha256 equals the panel's digest; `verifyReleaseArchiveIndependently` (a separate RS-274X / Excellon reader) reports every check ok for 9 components |
| 9 | refresh after release; authorizes the same authority again | state `released` from the server; second archive byte-identical (idempotent), never a second release |
| 10 | creates a new project | its PCB view is idle: no release, no review panel — nothing crosses projects |
| 11 | as a VIEWER, posts a qualification from the browser session | 401/403 with a public code, no stack or internals, nothing changed |

## Defects the browser found in the real page (CONFIRMED — each reproduced by a failing run, fixed, regression-tested)

None of these was visible to the route-level pipelines (which call handlers directly, outside React and outside the page's transports).

| # | failing run showed | root cause | fix | regression test |
|---|---|---|---|---|
| 1 | prompt → activity log "A project selector is required." (`/api/schematic/build-multi` 400) | every authenticated AI request from the page (build-multi, edit, edit-build, review, layout-critic, cross-verify) sent no `x-sirkit-*` selector; Build mode could not generate at all under the B16.0 trusted-context boundary | `aiRequestHeaders(scope)` in `app/page.tsx` (selector only, never authority) | the browser journey itself |
| 2 | "Part b16-1c-part-c not found" for every catalog part | `/api/parts/[id]` refused the committed catalog ids behind its UUID shape check before its fixture branch | the fixture catalog is consulted first; the production path is unchanged | `fixture-runtime.test.ts` |
| 3 | `/api/schematic/review` 500 "no review returned" after approval | the fixture provider answered every request with an empty response | the provider seam answers only the build planner and refuses everything else with the bounded 503 | `fixture-runtime.test.ts` |
| 4 | no Component review panel where the editor first meets the refusal | the panel rendered only once a board existed; an overlay placement then covered the call to action | the panel renders in the "No board yet" state, in the flow below the button | the browser journey itself |
| 5 | Schematic → PCB did NOTHING in `next dev`: no request, no toast, no console error | React StrictMode runs each effect's cleanup once and mounts it again; the editor's cleanup disposed the `PcbBoardLifecycleOwner` permanently (the page's `ProjectAsyncScopeRegistry` too), so every request-owned workflow (sync, apply, qualification) ended `stale` at warm-up | `resume()` on mount for both owners; a refused-busy or stale-before-any-server-call run now shows a toast | `app/lib/pcb/lifecycle/__tests__/b16-c-strict-mode-remount.test.tsx` (the pre-fix pattern is shown failing under `<StrictMode>`) |
| 6 | after the reviewer approved all nine candidates, the editor's Schematic → PCB was refused 403 nine times again | `bindAtomicSelection` checked the publication role before its idempotent replay of an already-approved identical selection | the replay (a read) is answered first; a NEW binding still needs reviewer/project_admin | `b16-c-review-handoff.test.ts` case 3; acceptance pipeline step 4 |
| 10 | first CI run: the editor's publication answered `PS_STAGE3_DISABLED` 503 (green locally) | the Stage 3 synchronization rollout flag is OFF unless declared; the local `.env.local` had set it, CI has no environment file | the fixture runtime declares `SIRKIT_PCB_SYNC_STAGE3=opt_in` itself (Playwright web server and `dev:fixture`), the state the deterministic pipelines use; Playwright failure artifacts moved out of the HTML reporter's folder (it clears its own directory) | CI job `page-browser-e2e` on PR #6 |

Production builds were never affected by 5 (no StrictMode double-invocation); 1 and 6 affected production behaviour.

## Results (RECORDED — filled in by the run)

CONFIRMED — `pnpm exec playwright test` (replay, the CI configuration): 1 passed in 37.3 s (run 18) and 37.0 s (run 19) on 2026-09-09 after 19 iterations (each failing run named the defect above); the router recording `e2e/fixtures/blinker-route-fixture.json` was recorded from empty under the frozen clock (2 executions, FreeRouting 2.2.4 on the bundled JRE, `recordedAt` = the fixed instant; record run 69 s of routing) and replays the qualification in 1.7 s. Request tally per green run: physical-bindings 9×403 (the editor's first Schematic → PCB), 9×201 (review requests), 48×200 (listings, approvals, idempotent replays), pcb-sync 201 publish + 200 preflight + 200 apply, qualify 200 + 403 (the viewer's bounded refusal), release 200 ×2 (the second authorization idempotent, byte-identical archive); the downloaded archive's sha256 equalled the panel's digest and `verifyReleaseArchiveIndependently` reported every check ok for 9 components. Deterministic pipelines re-measured after every change: CI `prompt-to-gerber` list 43 files (40 passed, 3 skipped opt-in) / 354 tests (341 passed, 13 skipped, 0 failed); `database-delivery` list 9 files (6 passed, 3 skipped) / 68 tests (56 passed, 12 skipped); tsc 0; eslint 0 new errors (page.tsx 14 + PcbEditor.tsx 1 pre-existing, identical to HEAD). Pinned identities unchanged (board `pcb2-f61eca48a58212d9`, archive sha256 `997664c0…`). Artifact: `artifacts/ai-control-plane-b16-closeout/page-browser-e2e.md`.

See `test-and-validation-report.md` for the executed run (Playwright list reporter, duration, and the router replay hits) and the CI job `page-browser-e2e` in `.github/workflows/deterministic-manufacturing.yml` (installs Chromium, runs `pnpm exec playwright test`, uploads `playwright-report`).

## Bounded (RECORDED)

- The browser proof covers the primary board of a project; the derived-revision flow is proven at the route/pipeline level (`b16-c-board-revision-route.test.ts`, recovery H.14) and by the dialog test, not yet by a browser journey (PROPOSED for B17's UI rebaseline).
- Chromium only.
