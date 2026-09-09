# B16 — Unknowns and owner decisions

Labels: CONFIRMED = executed and measured on this machine; INFERRED = derived from code reading; PROPOSED = designed, not exercised; RECORDED = written down without a claim; UNKNOWN = not established; BLOCKED-LIVE-QUALIFICATION = needs a live resource the owner has not provided.

The durable registers are `artifacts/remaining-builder-program/OWNER_DECISIONS.md` (OD-1..OD-10) and `LIVE_BLOCKERS.md` (LB-1..LB-6). This file is the B16 view of them.

## 1. Owner decisions closed by B16 (CONFIRMED)

| # | Decision | How B16 closed it |
|---|---|---|
| OD-1 | shared annular ring for vias and plated holes | B16-C.4: via and PTH rings split; `jlcpcb-2l` PTH ring 0.25 mm (JLCPCB recommended; 0.18 mm absolute recorded). The owner may relax to 0.18 mm by editing the preset; every pinned identity re-records. |
| OD-2 | editors cannot complete Schematic → PCB alone | B16-C.2: visible review handoff; editors never silently gain reviewer power. |
| OD-3 | routed boards refuse structural re-sync | B16-C.1: derived board revision with a reviewed rework plan; the old board and its releases stay immutable. No in-place rip-up command (RECORDED, never a silent fallback). |
| OD-4 | 422 for insufficient permission | B16-C.2: 403 with the handoff named. |
| OD-5 | migrations not deployable through a supported toolchain | B16-B: one migration CLI with a transactional applied-migration ledger, checksums, baseline adoption. |
| OD-8 | merge authority | runbook §2.4: chapter PRs merged normally after green CI; nothing else authorized. |

## 2. Owner decisions still open (RECORDED)

| # | Decision | Safe default applied | What changes if the owner decides otherwise |
|---|---|---|---|
| OD-6 | isolated Supabase project + account for live auth qualification | deterministic seams; live checks BLOCKED-LIVE-QUALIFICATION (LB-1) | the B16.1B live matrix runs; production sign-in / liveness / sign-out become CONFIRMED |
| OD-7 | provider credits for a real LLM turn | fake provider adapters / recorded design | a live prompt run becomes CONFIRMED (LB-2); the fixture runtime stays the CI default |
| OD-9 | `schema.ts` lacks 16 integrity constraints that live only in the migrations | the migration files are the delivery truth; `db:push` refused | re-aligning `schema.ts` changes what `drizzle-kit generate` diffs; the owner chooses the moment |
| OD-10 | RC03 refuses a board with an intentionally unconnected component pin (`CAP_PIN_PAD_PARITY_UNPROVEN`) | pre-existing rule left unchanged; recovery H.14 uses a connected J2 | carry the schematic `no_connect` disposition onto pad classifications (B17/B19) so spare pins satisfy parity |

## 3. Unknowns and bounded facts

| Fact | Label | Detail |
|---|---|---|
| Live Supabase authentication in a browser | BLOCKED-LIVE-QUALIFICATION | LB-1; the `.env.local` project no longer resolves; recipe in the B16.1B matrix |
| Real provider turn for the acceptance prompt | UNKNOWN | LB-2; the fixture provider answers the build planner only and refuses every other provider request with a bounded `provider_unavailable` (503) |
| Live routing in CI | local-only | LB-3; CI replays committed recordings keyed by placed-board revision and refuses unknown boards (`ROUTE_FIXTURE_MISS`) |
| Real-server PostgreSQL run of the migration proofs | BLOCKED-LIVE-QUALIFICATION | LB-4/LB-6; proven on disposable in-process PostgreSQL (PGlite); a real server needs an EMPTY disposable database |
| Physical fabrication / assembly / functional test | not attempted | LB-5; deterministic Gerber/Excellon release with two independent readers only |
| KiCad `.dru` import of the PTH ring | UNKNOWN | the importer still maps `annular_width` to the VIA ring only (`app/lib/constraints/kicad-dru.ts`); a KiCad rule meant for pads is imported as a via rule and reported as such; unknown whether any project relies on it (fabrication-rule-authority.md) |
| Other manufacturer presets (`jlcpcb-4l`, `oshpark-4l`, `pcbway-standard`) | RECORDED | inherit their shared ring value as the PTH ring, marked "not separately verified" |
| Incremental qualification (route only the unrouted nets of a derived revision) | PROPOSED | `/api/pcb/qualify` clears copper for the autonomous run; retained copper is a starting point for human routing, never an RC02 input |
| Derived-revision browser journey | PROPOSED | proven at route/pipeline/dialog level (B16-C.1, recovery H.14); not yet a Playwright journey (B17 UI rebaseline) |
| Pre-existing ESLint errors | RECORDED | `PcbEditor.tsx` `react-hooks/purity` (`Date.now()` in the proposal-expiry memo, earlier chapter) and `page.tsx` refs-during-render errors; CI does not run eslint; the B16 change sets were linted clean in isolation |
| Chromium only | RECORDED | the browser proof runs one engine; Firefox/WebKit not exercised |

## 4. What B16 did NOT do (RECORDED)

- No production credentials, purchases, orders, quotes or physical hardware.
- No force-push, history rewrite, access or billing change.
- No modification of `C:\Users\robsa\sirkit` (tripwire suite).
- No weakening of tests, policies, CSRF, bounded readers, role checks or the 153-route ratchet.
