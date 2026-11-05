# Reproductions

Date 2026-10-14. "Normal app" is `pnpm dev` on port 3000 with the owner's local `.env.local` (local_dev identity, the
owner's database). "Fixture" is `scripts/dev-fixture.mjs` on port 3100 (in-memory stores, committed blinker catalog,
recorded design, replayed router, scripted agent). Browser: the desktop app's built-in Chromium pane at 1366×768. No
credential value was read or printed.

## R1 — Theory mode cannot generate (normal app, fresh project)

- Steps: open the app, click Theory, open AI Chat, type "make a schematic for a 555 LED blinker", press Enter.
- Shown route: the composer labels the action "Generate" with the reason "the project has no schematic yet: the message
  describes a circuit to generate".
- Request: `POST /api/schematic` carrying only a content type (`lib/apply-netlist.ts:11-15`); no project selector, no
  cancellation signal.
- Result: HTTP 400, code `AUTH_PROJECT_SELECTOR_REQUIRED`. The chat log reads "Generating schematic → Preparing request →
  Synthesizing theory schematic → A project selector is required." Nothing changed on the sheet. No provider call was made
  (the canonical wrapper refuses before the callback runs).
- Label: CONFIRMED (browser, network panel, server log).
- Permanent test: `pr-a-journey-reproductions.test.ts` [PR-A 1] — the server-side refusal is pinned as an ordinary case
  with the provider mocked and asserted uncalled; the client contract (selector + signal) is pinned as an expected failure.

## R2 — Build mode produced no parts (the owner's own live run, 2026-10-11)

- Evidence: the owner's `pnpm run dev` terminal and the durable `llm.call-record.v1` rows for route
  `/api/schematic/build-multi` (13 model calls, 28,878 input / 3,211 output tokens, about 35 s, outcome `completed`), plus
  51 embedding calls.
- What happened: every `search_parts` tool call failed because the database lacked the table migration 0030 creates; the
  loop ended with "Loading 0 catalog parts / No parts produced". The owner's database was migrated through 0031 that day
  (ledger: 32 applied, no drift). No Build request has been recorded since, so the post-migration live Build journey is
  UNKNOWN until the bounded builder run in checkpoint C.
- Label: CONFIRMED (durable records + log) for the failure; the cause class was "missing catalog authority in the
  database", not a model failure.

## R3 — The composer is hard to find and the question route has no visible submission

- On load the chat panel is closed; the empty sheet says "Describe a circuit above, or pick a tool from the toolbar to
  place components manually." The composer is in the right-hand chat panel, which opens from the activity bar's "AI Chat".
- With a question typed ("ask" route) the composer renders no submit button; only "Enter to submit" text is shown. With a
  create request a "Generate" button appears (`app/page.tsx:5856`, `showComposerButton`).
- Label: CONFIRMED (browser, accessibility tree). Pinned as expected failures [PR-A 3].

## R4 — Dead and placeholder controls

- The header's Settings button has no handler and no accessible name (the tree lists `button` with no name at
  `app/page.tsx:6166-6168`).
- The top-level 3D tab renders the literal "3D view" (`app/page.tsx:6416`); the real `PcbPreview3D` is mounted only by
  the PCB editor's preview sheet (`PcbEditor.tsx:2661-2675`).
- Label: CONFIRMED (source and browser). Pinned [PR-A 4].

## R5 — Decorative design checks

- The Build sidebar's "Design checks" shows "No floating nets" and "Supply rails connected" as passes unconditionally
  (`app/page.tsx:6275-6276`); no validation computes them.
- Label: CONFIRMED (source). Pinned [PR-A 5].

## R6 — Silent return on the PCB sync entry

- `PcbEditor.tsx:840`: `if (!client || !syncIdentity) return;` — a click produces no feedback when the sync client or the
  project scope is absent. The exact normal-mode conditions are traced in `workflow-contract.md`.
- Label: CONFIRMED (source). Pinned [PR-A 6].

## R7 — Old projects fail the snapshot integrity check

- The owner's projects created before 2026-09-07 show "Hydration failed (PS_SNAPSHOT_DIGEST_MISMATCH)" on the PCB tab.
  Cause: commit `8746b46` changed the canonical key order used by the snapshot digest; the pre-change code reproduces all
  14 stored digests, the current code none (read-only recomputation, 2026-10-11). New projects round-trip clean (proved
  on PGlite through the real repository). No operator repair path exists.
- Label: CONFIRMED. Out of this assignment's code scope unless the owner asks for a legacy verifier; recorded in
  `remaining-blockers.md`.

## Fixture journey baseline

- `pnpm exec playwright test e2e/prompt-to-gerber.spec.ts` on the current tree (pending changes included): 1 passed in
  1.4 min, exit 0 — prompt → recorded proposal → explicit approval → review handoff → sync/apply → qualify (replayed
  router) → admin release → download and independent verification → reload → duplicate click → cross-project isolation →
  bounded refusal.
- Label: CONFIRMED for the fixture only. It proves nothing about a live model, live authentication or real routing.

## R8 — The design checks never rendered in Build mode (found by the E spec, 2026-10-16)

Fresh browser under the fixture runtime, Build mode (the default), the Build Library opened from the activity bar: the panel
shows the categories (or the fixture's "Could not load categories") and nothing else — no "Design checks" block, so the decorative
checks R5 recorded could only ever be seen in Theory mode, where there are no catalog pins to check. Found when
`e2e/simple-workspace.spec.ts` step 4 waited 20 s for `design-checks` after opening the panel (run 2, validation.md). Cause: the
block was a sibling of the Theory list inside the else-branch of `mode === "build" ? <BuildLibraryPanel/> : (…)`. Fixed by one
footer under both panels (F-30 in the fault register).
