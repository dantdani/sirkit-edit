# Progress — reliable prompt-to-PCB, semantic control, simple workspace

Assignment: `artifacts/astra-guided-pcb/PROMPT_TO_PCB_RELIABILITY_AND_SIMPLE_UI.md` (prepared 2026-10-14), checkpoints A–I.
Checkout: `C:\Users\robsa\Desktop\sirkit-edit`, remote `dantdani/sirkit-edit`, branch `codex/astra-foundation`, base `32b081e` (B24 merge).
Protected original `C:\Users\robsa\sirkit`: not touched.

This file is the context-recovery record: current checkpoint, current blocker, exact next step. Dates are real; every claim
carries CONFIRMED / INFERRED / PROPOSED / UNKNOWN / BLOCKED-LIVE-QUALIFICATION.

## Checkpoint A — establish and reproduce the real user journey (2026-10-14)

Status: IN PROGRESS → evidence in `reproductions.md`, `root-causes-and-fixes.md`, `workflow-contract.md`.

Inventory (CONFIRMED, read-only):
- Branch `codex/astra-foundation` at `32b081e`, no commits beyond `main`. Uncommitted: 32 modified tracked files (570+/304−)
  and 10 untracked files — the owner-approved OD-229/OD-236 fixes, React lifecycle repairs (BomView, AssignmentQueuePanel,
  CommandPalette, SilkTool, useLivePreview, useSilkTool, TextInspector, ViaInspector, NumberField, PadstackEditor, PcbEditor
  proposal clock, page.tsx ref assignments), their three regression test files, the B24 metadata reconciliation, and the
  `artifacts/astra-guided-pcb/` continuation pages. Inventoried file by file (see `root-causes-and-fixes.md` §B); nothing
  reset or discarded.
- Processes at start: no dev server listening (the owner's `pnpm run dev` tab had been stopped). Seven other git worktrees
  exist for unmerged side branches; untouched.
- Repository instructions: `vendor/freerouting/AGENTS.md` only (plus the runbooks named by the assignment).
- Credentials, presence only: `.env.local` sets 13 names (OpenAI, Anthropic, database, Supabase, Mouser, Nexar, DigiKey,
  `SIRKIT_PCB_SYNC_STAGE3`); configured model `gpt-5.6-sol`, effort `high`.
  - configured: yes (all 13 names set); funded: OpenAI answered a live Build request on 2026-10-11 (the owner's own
    session), Anthropic last answered "credit balance too low" (2026-10-11); authorized: the owner's US$5 cap for the
    builder's bounded live tests (`live-spend.json`); qualified: none — every live scope remains BLOCKED-LIVE-QUALIFICATION
    (LB-1..LB-17 unchanged).
- Feature flags: `SIRKIT_PCB_SYNC_STAGE3` is set in `.env.local` (normal app) and declared `opt_in` by the fixture runtime
  and the Playwright web server; `SIRKIT_FIXTURE_AGENT=scripted` only under the fixture.
- Database (the owner's Supabase project, read-only checks): migrated through 0031 on 2026-10-11 (ledger 32 applied, no
  drift). Catalog: 22,756 parts; 21 parts with full atomic authority (13 R values, 5 C values, one LED, NE555DR, a 2-pin
  header). 14 schematic snapshots and 10 release-authority heads written before 2026-09-07 fail the current digest
  (`8746b46` changed the canonical key order) — old projects show `PS_SNAPSHOT_DIGEST_MISMATCH`; new projects round-trip clean.

Reproductions (CONFIRMED, `reproductions.md`):
- R1 Theory mode, fresh project, "make a schematic for a 555 LED blinker" → route shown "generate", POST `/api/schematic`
  400 `AUTH_PROJECT_SELECTOR_REQUIRED`, chat shows "A project selector is required.", nothing changed, no provider call.
- R2 Build mode, the owner's own live run of 2026-10-11 (durable `llm.call-record.v1`, 13 model calls, 28,878 input /
  3,211 output tokens, ~35 s): every `search_parts` failed on the then-missing table → "Loading 0 catalog parts / No parts
  produced"; the migration fixed the table; no Build run has been made since (none recorded).
- R3 Chat closed on load; the empty sheet says "Describe a circuit above"; the "ask" route shows no submit control.
- R4 Header Settings button: no handler, no accessible name (`button [ref_12]`). 3D tab: the literal "3D view".
- R5 Build sidebar "Design checks": "No floating nets" and "Supply rails connected" always green.
- R6 PCB sync entry: `if (!client || !syncIdentity) return;` (source; the normal-mode condition is traced in
  `workflow-contract.md`).
- Fixture journey baseline: `pnpm exec playwright test e2e/prompt-to-gerber.spec.ts` → 1 passed (1.4 min), exit 0, on the
  current tree with the pending changes (replay router, scripted agent, recorded design).

Permanent reproduction suite: `app/lib/qualification/__tests__/pr-a-journey-reproductions.test.ts` — 1 ordinary case (the
server-side selector refusal, zero provider work) and 10 `it.fails` cases that state the contracts C and E must meet; run
2026-10-14: 11 passed (the 10 expected failures fail as expected).

Current blocker: none for A. Live Build-mode reproduction by the builder is deferred until C bounds the loop's worst case so a
request can be reserved against the US$5 cap (see `live-spend.json`).

Status: DONE (reproductions, suite, traces; `fault-register.md` and `workflow-contract.md` written from the traces).

## Checkpoint B — finish the pending corrective foundation (2026-10-14)

Status: DONE, pending commit.

- OD-229/OD-236 and the lifecycle repairs verified: the 13 new/modified suites of the pending tree pass on the current tree.
- Four holes closed test-first (counterexamples recorded in `root-causes-and-fixes.md` §B): inspector selection identity
  (`Inspector.tsx`), live-preview hint retirement (`useLivePreview.ts`), panel-owned commit result
  (`AssignmentQueuePanel.tsx`), BOM request settlement (`BomView.tsx`). One review claim refuted and kept as a pin.
- Gates on the corrective tree: `tsc --noEmit` exit 0; whole-repository `eslint .` exit 0, 0 errors, 34 warnings (28
  `no-unused-vars`, 5 `no-console`, 1 `exhaustive-deps`) — the historical 33 errors are gone; both sanctioned generators
  re-run after the BOM handler rename (628 controls / 63 surfaces; in scope 168, unnamed 0); gate suites in `validation.md`.
- Metadata: the pending reconciliation of B24's verdict (section 5.5, metadata only) kept; B24 stays PARTIAL; live blockers
  LB-1..LB-17 unchanged; the ledger carries the A/B entry.

Exact next step: commit A+B as a coherent series on `codex/astra-foundation` (pending corrective tree; A reproductions and
evidence; B closures), secret-scan, push; then checkpoint C (the vertical slice, see the ledger's "Next").
