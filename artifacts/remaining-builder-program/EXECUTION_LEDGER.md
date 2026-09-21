# Sirkit Remaining Builder Program — Execution Ledger

Durable, append-only record of every checkpoint. Tests, code, durable artifacts and observed behaviour remain authoritative; this ledger is a map to them, never proof by itself. Labels: CONFIRMED (observed in this program), RECORDED (read from source/artifacts), INFERRED, PROPOSED, UNKNOWN, BLOCKED-LIVE-QUALIFICATION.

Identity: commits by `Dandi Desta <dandidesta82@gmail.com>`, real timestamps, no AI co-author trailers. Working repository `C:\Users\robsa\Desktop\sirkit-edit`; protected original `C:\Users\robsa\sirkit` never touched.

---

## B16-A — Integrate and independently verify B16.1C

**Started:** 2026-09-07 (local), on `integration/b16-1c-prompt-to-gerber` at `c82d1cbcbb1476937631b6e3c932f67bfb630893` (PR #5 head), base `b7bb6d6a46654fab48daf33cb8b3a163ea360432` (origin/main).

**Starting handoff verified (CONFIRMED via `git fetch` + `gh pr view 5`):** PR #5 OPEN, not draft, `mergeable: MERGEABLE`, `mergeStateStatus: CLEAN`, no reviews, head `c82d1cb`, base `main`; checks: `benchmark-core` SUCCESS, `benchmark-nightly` SKIPPED (by workflow design). Six commits in range `b7bb6d6..c82d1cb`: 16d1382, 8a635a4, c29c92d, ed83e69, 2e380bb, c82d1cb. Repository has no CLAUDE.md/AGENTS.md (only `.claude/launch.json`).

**Re-measurement plan (runbook B16-A.3):** narrow suites (acceptance, recovery, qualification/release, component authority, route/tool/invariant gates), tsc, scoped ESLint, `git diff --check`, sanctioned generators ×2, bounded full suite, benchmark-quality commands, independent ZIP/Gerber validators; plus an adversarial multi-lens review of the diff (authority bypass, determinism/host dependence, human truth, test integrity, CI risk) with two refuters per finding.

_(results appended below as they are observed)_

### B16-A narrow re-measurement (CONFIRMED, 2026-09-07 local, head c82d1cb + ledger commit 9b05187)

- `pnpm exec tsc --noEmit` → exit 0.
- Narrow suites (`app/lib/workflow/prompt-to-gerber/__tests__`, `app/lib/pcb/fab/__tests__`, `app/api/pcb`, `b16-1c-invariant-tripwires`, `b16-0-15-tranche-parity`, `manufacturing-workflow-panel`, `manufacturing-release-gate`, `native-fab`, `b16-1b-auth-composition`, `physical-binding`, `footprint-resolver`, `pcb-sync`): 37 files passed, 1 skipped (opt-in DB); 341 tests passed, 11 skipped, 0 failed; 15.5 s.
- `git diff --check` → clean.
- Sanctioned generators ×2 → sha1 `4d93461b` / `e22ec3a3` / `0599d5e6` / `49f279fd` both runs, identical to committed files (git status clean under artifacts/).
- Scoped ESLint over every B16.1C production module → 0 errors, 1 pre-existing warning (`app/api/pcb/edit/__tests__/assist-live.test.ts` unused directive, not in range).
- Independent archive identity (CONFIRMED): the acceptance suite's evidence ZIP (`%TEMP%/sirkit-b16-1c-evidence/b16-1c-acceptance-release.zip`, 40,962 bytes) hashes to `23314a7513b3c87fb135caab534e5d6d708b1259508e88d17919d8b7d7acf456` — equal to the B16.1C claim; releaseId `mfg-release-110d72644994b65fd0d757ff5c3311e2`, board `pcb2-d3c41a58ca702019`; 10 members all dated 1980-01-01; in-repo independent reader 80/80 checks ok; third-party gerbonara 1.6.3 `INDEPENDENT VERIFICATION: PASS`.

### B16-A adversarial review of PR #5 (RECORDED, 2026-09-07 local)

Multi-lens review of `b7bb6d6..c82d1cb` (authority bypass, determinism/host dependence, human truth, test integrity, CI risk), every finding challenged by two independent refuters; 28 findings survived, 0 refuted (journal: session workflow `wf_19e58a58-f13`). Each is corrected on the PR #5 branch with its own reproduction and regression test before the merge (runbook B16-A.6). Severity as assessed by the reviewers.

| # | Sev | Finding (CONFIRMED) | Correction |
|---|---|---|---|
| F1 | medium | `deriveCorrelationId` hashes only method+path → every `/api/pcb/qualify` failure carries the same correlation id; a trace cannot be found by it | per-request unique id (path digest + random suffix), test pins two requests differ |
| F2 | medium | qualify publishes the routed board durably inside `commitSelected` BEFORE RC01/RC02 and the authority save → a later failure leaves the board replaced while the envelope says "Nothing was changed" | gates run on the candidate before any durable write; board + authority committed in ONE durable commit |
| F3 | medium | client body key `seeds` is cast unvalidated and steers the placement RNG/run id | body closed to `boardId`/`designId`; unknown keys refused |
| F4 | medium | RC01 parity certified against `boardToSourceNetlist(board)` (board-projected) → passes by construction; the same netlist is sealed as `authority.netlist` | parity against the netlist derived from the LAST APPLIED synchronization snapshot; that netlist is sealed |
| F5 | low | `designId` is a free-form client string never checked against the synchronized design | must equal the applied snapshot's `designId` (refused otherwise) |
| F6 | low | administrator confirmation pin enforced only when volunteered | `expectedAuthorityRevision` (integer) + `expectedAuthorityDigest` (string) mandatory on release; positive/negative/type tests |
| F7 | low | in-flight qualification guard is a process-local Map (multi-instance: two router runs) | durable lease aggregate (CAS, TTL) replaces the Map |
| F8 | medium | canonical key sort uses bare `localeCompare` → identities depend on the host ICU locale (lt-LT reproduces `ROUTE_FIXTURE_MISS`) | code-point comparator in every identity-bearing canonicalizer; locale-shim regression test |
| F9 | medium | recorded release identities asserted by no test; acceptance/recovery suites run by no CI workflow | pinned-identities assertion; deterministic manufacturing CI job |
| F10 | low | contract says "DEFLATE level fixed"; archive uses STORE | doc corrected |
| F11 | high | "no hidden auto-approval" false: `handleEditSchematic` Tier-2 path applies `edit-build` output directly | Tier-2 output staged in the same review dialog; source tripwire pins the only direct apply sites |
| F12 | medium | summary reader swallows corrupt authority/snapshot heads → browser shows "authority none" | reader reports integrity per subject; hook treats corrupt as failed hydration |
| F13 | medium | panel shows the `idle` label after a FAILED hydration | distinct failed state label |
| F14 | medium | H.7 "dialog only for admins" false: any member sees the enabled Request release + dialog | server reports the viewer's release capability; non-admins see a disabled control with the reason |
| F15 | low | "byte-identical across days" overstated (frozen clock) | wording corrected |
| F16 | low | CSV says 61 PASS rows (actual 80); component-authority proof says 24 (actual 26) | corrected |
| F17 | low | README overstates the gerbonara reader (no manifest digest/count checks) | wording corrected |
| F18 | low | panel text "independently read back" describes the internal parser | wording corrected |
| F19 | medium | panel "stale confirmation → retry" test tautological (hook re-sends the same stale pin) | retry after CONFIRMATION_MISMATCH/STALE re-hydrates and asks for a new confirmation; test asserts the new pin |
| F20 | medium | no positive route test for matching pins; no type-contract negative | added |
| F21 | medium | recorded fixtures replace the whole production router, masking TS routing-integration regressions | opt-in live-router run (`SIRKIT_B16_1C_LIVE_ROUTER=1`) documented; limitation recorded |
| F22 | low | tranche-parity helper hardcodes `verifiedAt: "2026-09-07"` without a fake clock (fails after 2027-09-08) | helper derives from the current date |
| F23 | low | `getSnapshotHead` / authority `getHead`/`save` digest branches and the summary reader untested | behavioural tests added |
| F24 | low | `runOwnedRelease` stale/thrown branches untested | tests added |
| F25 | low | `include=<other>` refusal and reader-absent untested | tests added |
| F26/27 | low | protected-original tripwire passes vacuously off this machine | reported as skipped (never passed) when the path is absent |
| F28 | low | raw-route baseline sha1 for `/api/pcb-sync` stale; sha1 informational | baseline regenerated; ratchet compares sha1 |

### B16-A corrections landed (CONFIRMED, 2026-09-07 local)

Every finding F1–F28 is corrected on `integration/b16-1c-prompt-to-gerber` with its own reproduction and regression test; each change set was committed and pushed immediately (owner rule):

| Commit | Scope |
|---|---|
| `cee3b04` | F1 per-request correlation ids (`corr-<route facet>-<16 hex entropy>`); `b16-a-correlation-id.test.ts` |
| `3231f3f` | F2–F7 qualify: gates in memory, ONE durable commit for board + authority (`qualification-commit.ts`), RC01 parity from the applied snapshot's netlist (`snapshot-netlist.ts`), closed bodies (`MFG_API_UNKNOWN_FIELD`), `designId` bound to the applied plan (`MFG_DESIGN_SCOPE_MISMATCH`), durable lease (`qualification-lease.ts`); release pins mandatory (`MFG_AUTHORITY_CONFIRMATION_REQUIRED`); tests `b16-a-qualification-commit`, `b16-a-snapshot-netlist-parity`, `b16-a-release-confirmation`, tranche-parity additions |
| `d795aba` | F11 Tier-2 edit / "Apply suggestions" staged in the review dialog; `b16-a-review-corrections-tripwires.test.ts` |
| `f69178a`, `fba0e1e` | F23–F28 behavioural tests (durable heads, authority store, owned release), protected-original tripwire SKIPPED off-machine, raw-route baseline regenerated + sha1 ratchet; qualify tripwire updated |
| `92c9601` | F12/F13/F14/F18/F19/F25 summary integrity + viewer capability, `hydration_failed` state, honest retry, corrected result text; `b16-a-manufacturing-summary.test.ts`, panel suite rewritten (11 tests) |
| `8746b46` | F8 `app/lib/stable-compare.ts` (code-point / natural comparators) in 50 identity-bearing modules (209 call sites); `b16-a-locale-independent-identities.test.ts` (lt-LT shim + throwing shim); router fixtures re-recorded with the bundled FreeRouting 2.2.4 (acceptance 2, recovery 4 executions) |
| `850ee3e`, `4da76b8` | F9/F21 `fixtures/expected-identities.json` asserted on every replay; `.github/workflows/deterministic-manufacturing.yml`; `SIRKIT_B16_1C_LIVE_ROUTER=1` |
| `e0efcfb`, `7d341ff` | F8 consequence: sanctioned generators re-run (B05 `generate-read-invocation-artifacts`, B06 `generate-b06-schematic-artifacts`, B11 `generate-b11-artifacts`, raw-route baseline) — committed replay fixtures/pins that hashed canonical forms moved with the comparator; `snapshot-netlist` moved to `app/lib/pcb/fab/` (Stage 3 forbids `netlist-bridge` references) |

**New recorded release identities (CONFIRMED locally and in CI on ubuntu-latest, run 34160044215):** board revision `pcb2-bbc76fdb18ec7646`; authority record digest `sha256:f648165bd4c3ba415ae494737471bbb1001fd0c74135fdc4dedfbec46737927d` (revision 1); component authority `qualification-authority-a959f6fc…` (unchanged from B16.1C — bindings/footprints/certificates did not move); releaseId `mfg-release-e0bdf91bb6f5d9656ec23c9c6f02a496`; archive `sirkit-board-b16-1c-blinker-3c9c6f02a496.zip` 40,962 bytes sha256 `5cd671810e87cfe805a91d83406fe456c2cc802320ba5b6e9a31341b1667ef66`; manifest digest `mfg-manifest-a5592c82a03e0517048404b0177d7f96398463a3d39c242f2c7dc754385d4482`; byte-identical across two processes on Windows and reproduced on Linux CI; in-repo reader 80/80; gerbonara 1.6.3 `INDEPENDENT VERIFICATION: PASS`.

**Consequence recorded (F8):** every engineering/durable digest changed with the comparator (the identities were host-dependent before). No live database exists (LB-4); browser-local canonical heads recorded under the old canonicalization will fail exact-head verification and start a fresh lineage by design (B03.1 fail-closed reload). `localeCompare` residue outside the release-identity chain is listed in `artifacts/ai-control-plane-b16-1c/unknowns-and-owner-decisions.md` (UNKNOWN impact until swept).

**Measurements (CONFIRMED):** `tsc --noEmit` 0; ESLint 0 errors on every touched file (app/page.tsx carries 15 pre-existing errors unrelated to the edit — same count before/after); engineering suite 56 files / 801 tests; agent suite 21 / 297; broad identity-chain set 269 files: 11 failures under parallel load (5 vitest worker RPC timeouts) → all 5 load-sensitive AST/perf suites pass in isolation (79/79), the remaining ones were the regenerated pins, the Stage 3 `netlist-bridge` rule (fixed by the move) and the dead-DB test; full suite at `7d341ff` state: 4739 passed / 29 skipped, failures = 8 B11 files (fixed by the pin regeneration, agent dir now 297/297) + `ingest-integrity` (dead `DATABASE_URL`, LB-4, B16-B); benchmark:validate 63 packages / 0 diagnostics; stage-09 core 18/18. CI: `benchmark-quality` and `deterministic-manufacturing` SUCCESS at `4da76b8`. Secret scan of `b7bb6d6..HEAD`: only the synthetic redaction fixture string.

**Final bounded full suite at `7d341ff` (CONFIRMED, 2026-09-07 20:41 local):** 432 files → 427 passed, 3 skipped, 2 failed; 4,783 tests → 4,752 passed, 29 skipped, 2 failed. The two failures: `app/lib/pcb/__tests__/ingest-integrity.test.ts` (dead `DATABASE_URL`, LB-4 — B16-B makes DB tests opt-in) and `app/lib/pcb/__tests__/route-tool.test.ts` "direct live preview avoids catastrophic slowdown with 500 tracks" (5 s perf budget, timed out under the 432-file parallel run; passes in isolation 25/25 — recorded as the pre-existing load-sensitive perf set, not dismissed: the isolation run is the evidence). CI on `7d341ff`: `benchmark-quality` SUCCESS, `deterministic-manufacturing` SUCCESS.

**B16-A CLOSED (CONFIRMED, 2026-09-07 local):** PR #5 merged normally (merge commit `62ea4a65327510a842be46afe97bda0147aac15a` on `main`, via GitHub after `benchmark-quality` + `deterministic-manufacturing` SUCCESS on branch head `a9fa5e7`, mergeStateStatus CLEAN). Local `main` fast-forwarded to the merge commit. Chapter branch `chapter/b16-foundation-closeout` created from it for B16-B/B16-C and the B16 closeout artifacts (`artifacts/ai-control-plane-b16-closeout/`).

---

## B16-B — Deployable database and authentication boundary

**Started:** 2026-09-07 (local) on `chapter/b16-foundation-closeout` at `62ea4a6`.

_(discovery, reproduction and results appended below as they are observed)_

### B16-B discovery and reproduction (CONFIRMED, 2026-09-07 local)

- Journal: 27 entries (0000–0026); `0027`/`0028` unjournaled; snapshots only to 0008; no `db:migrate`; documented path `db:push`. Migrations assume platform objects they never create (`vector` extension; `authenticated` role; `auth.uid()`), and the schema-first DDL creates no extension at all (needs `vector` + `pg_trgm` pre-enabled).
- Disposable PostgreSQL: Docker Desktop 4.67 fails at engine start (`initializing Inference manager … dockerInference: The file cannot be accessed by the system`, a Docker Desktop defect; recorded LB-6, machine settings not changed; the instance I started was stopped again). Chosen instead: PGlite 0.4.6 (PostgreSQL 17.5 in-process, pgvector/pg_trgm/pgcrypto) as the deterministic disposable instance for the default suite; real-server qualification opt-in via `SIRKIT_DB_QUALIFICATION=1` + `SIRKIT_DB_QUALIFICATION_URL` (scratch schema per run).
- Feasibility probe: all 29 files / 465 statement chunks apply in ≈0.5 s; RLS enforced under `SET ROLE authenticated`; 0028 CHECK present.

### B16-B implementation (CONFIRMED, commits `ddf1dc0`, `dc909f6`, `cb22578`, `c6d7b75`, pushed)

- `app/lib/db/migrations/{manifest,runner,verify-schema,postgres-executor}.ts`, `scripts/db-migrate.ts` (`pnpm run db:migrate`, `--status`, `--dry-run`); `db:push` refused as a delivery path.
- Proofs on the disposable instance (`app/lib/db/__tests__`): manifest integrity; clean 29/29; upgrade 0000–0026 → identical fingerprint; idempotent replay; checksum drift refused; interrupted 0026 rolled back and resumed; in-lock race → verified skip; unknown/gap refused; RLS executable (own active rows only; write refused); CHECK three-valued behaviour; schema-first vs migrations parity: both meet every criterion, 30 structural divergences recorded (16 migration-only integrity constraints — a `db:push` database silently lacks them).
- DB-test gating (item 5): 7 DB-gated tests + `assist-live` converted to `databaseQualification()`; default run without marker: 10 files passed / 3 skipped, 68 tests passed / 16 skipped, 0 failed (LB-4 closed for the default suite); with the marker pointed at an unreachable server the gates open and fail on `ECONNREFUSED` (proved, not assumed).
- Measurements: tsc 0; ESLint 0 errors (1 pre-existing warning in `assist-live`); new suites 20 + 26 tests green; CI job `database-delivery` added to `deterministic-manufacturing.yml`.
- Adversarial review of `a3445f1..c6d7b75` dispatched (four lenses, two refuters per finding); corrections follow before B16-C.

### B16-B adversarial review and corrections (CONFIRMED, 2026-09-09 local)

- Review dispatch: four lenses, two refuters per finding. Only the `transactional-correctness` lens completed before the account's subagent usage credits were exhausted (the other three lenses and every refuter failed with "out of usage credits"); its six findings were verified and corrected by the orchestrator directly. The three unrun lenses are recorded as UNKNOWN. From here the program continues SOLO (no subagent workflows) until credits return; recorded, not hidden.
- Findings and corrections (each with a regression test in `app/lib/db/__tests__`): (1) `onApplied` fired on an in-lock verified skip, now only for a migration this run applied; (2) no adoption path for databases that pre-date the ledger, now `app/lib/db/migrations/baseline.ts` verified baseline adoption + `db:migrate -- --baseline <name>` (reproduction: legacy database, `relation ... already exists`, status 0/29); (3) the real-server qualification could never pass (25 explicit `"public".` FK references defeat a scratch schema), the suite now requires an EMPTY disposable database plus an optional second one for the upgrade case; (4) index definitions are schema-qualified, moot once both instances use `public`; (5) `search_path` pinning mis-installs extensions, pinning removed; (6) ledger DDL raced outside the lock, now created under the advisory lock.
- Measurements: tsc 0; `app/lib/db` + auth boundary gate: 6 files / 77 tests passed, 3 skipped (opt-in); the disposable-PostgreSQL harness moved to `app/lib/db/disposable-postgres.ts` (tests and the CLI, never a route).
- B16-C item 5 groundwork landed in `9ebfea1`: env-gated fixture runtime (`app/lib/fixture-runtime`), blinker catalog moved out of the test tree, router recording/replay core in `app/lib/pcb/autonomous/router-fixture.ts`, dev-only role cookie, Playwright + Chromium installed, `playwright.config.ts`, `pnpm run dev:fixture`.

### B16-C.4 fabrication-rule authority (CONFIRMED, 2026-09-09 local, solo)

- Discover/reproduce: OD-1's shared `minAnnularRingMm 0.15` was via-only in code and unchecked for plated pads; a 0.16 mm plated-pad ring passed DRC, RC03 and release. Live JLCPCB 1-2 layer page re-fetched 2026-09-09 (via hole/diameter 0.15/0.25 mm; PTH ring recommended 0.25 mm, absolute 0.18 mm; NPTH 0.50 mm; hole-to-hole via 0.2 / pad 0.45 mm; 1 oz track/space 0.10/0.10 mm; copper-to-edge 0.2 mm).
- Implement: `minPthAnnularRingNm` (jlcpcb-2l 0.25 mm = recommended; other presets inherit their shared value, marked not separately verified); DRC check `pth-annular-ring` with exact per-pad ring measurement (slots, offsets, polygons); RC03 blocker `CAP_PTH_ANNULAR_RING_BELOW_PROFILE`; route-blocking set, constraint kind `pth_annular_ring`, readiness kinds, repair no-weakening list, checker descriptor, normalizer; `ManufacturingRuleProfile` v2 (`minViaAnnularRing` + `minPthAnnularRing`; evidence `sourceRefs/retrievedAt/expiresAt/scope/notes`) built only by `app/lib/pcb/fab/rule-profile.ts`; release gate + route refuse v1 profiles (`MFG_RULE_PROFILE_SCHEMA_RETIRED`) and expired evidence (`MFG_RULE_PROFILE_EXPIRED`); DRC preset jlcpcb-2l version 2, verifiedAt 2026-09-09; shape descriptor and B05 replay fixtures regenerated.
- Finding during re-pinning (CONFIRMED, corrected): released copper depended on pad-shape JSON property order (`shapeKey` used raw `JSON.stringify`); record vs replay boards had identical digests but different aperture codes/macro names and archive sha256. Fixed with canonical `stableJson`; regression `app/lib/pcb/fab/__tests__/b16-c-gerber-aperture-key.test.ts` (verified to FAIL on the old key). PostgreSQL jsonb round-trips would have had the same effect in production.
- Frozen pipeline clock moved to 2026-09-09T12:00Z (must not precede the evidence retrieval date); fixtures and identities re-recorded 4 times in total (the first two recordings exposed the clock and the aperture-key defects). Final pins: board `pcb2-f2ee7fd78eccae62`; authority `sha256:59d66e96c10e4587…`; release `mfg-release-181d118a5be1bce8f45e27172b33f1cc`, archive `sirkit-board-b16-1c-blinker-27172b33f1cc.zip` 41,855 B sha256 `0f9fec3746d444d9…`; manifest `mfg-manifest-ffa2ce48…`; router executions 2 (the recovery suite's H.6 deliberately crashes the router: "exited 137" in the logs is that test, not an anomaly).
- Measurements: tsc 0; suites: DRC/constraints/capability/repair/proposal (75 files incl. new `b16-c-fabrication-rule-authority.test.ts` 9 tests), api/pcb + fab + pcb-sync (23 files), workflow + fixture-runtime + fab replay (12 files) all green; release-gate test gained retired/expired/PTH-drift refusals.
- Owner: OD-1 closed with the builder default 0.25 mm (owner may relax to 0.18 mm by editing `jlcpcb-2l.json`; identities re-record). Artifact: `artifacts/ai-control-plane-b16-closeout/fabrication-rule-authority.md`.

### B16-C.2 component-binding review handoff (CONFIRMED, 2026-09-09 local, solo)

- Discover/reproduce: an editor's `bind_atomic_selection` was refused 422 `PB_ATOMIC_BIND_HUMAN_REVIEWER_REQUIRED` (the status of malformed input; pinned "as-is" by the B16.1C acceptance test) and no path carried the need to a reviewer.
- Implement: `app/lib/physical-binding/review-handoff.ts` (durable `pb.component-review-request.v1` aggregate; evidence projected from the published atomic snapshot: candidate, symbol, footprint, package, pin-to-pad certificate, source revisions, digest; request → approve/reject/withdraw; retirement on requester revocation or role change; approval performs the ordinary binding lifecycle under the REVIEWER's identity; evidence drift refused); route operations `request_atomic_review` / `list_review_requests` / `resolve_review_request` / `withdraw_review_request`; `errorResponse` maps FORBIDDEN / REVIEWER_REQUIRED to 403 and names the handoff; `ComponentReviewPanel` + `useComponentReview` mounted in `PcbEditor` beside the manufacturing panel; Sync preparation tells an editor to use the panel instead of a bare code.
- Tests: `app/api/physical-bindings/__tests__/b16-c-review-handoff.test.ts` (7 cases: 403 not 422; viewer 403; editor request idempotent with full evidence; editor resolve 403; reviewer approve → selected+approved binding by the reviewer, second approve 409; reject → reason, re-request, withdraw only by requester; role change / revocation retire pending → 409; evidence drift 409; cross-project 404/empty; malformed 400); `component-review-panel.test.tsx` (3 cases); acceptance step 4 rewritten to request → list → approve ×9 → resume (identities re-recorded, replay green).
- Harness: `signInAs` now keeps every fresh-browser membership and switches identity only (a reviewer's session previously replaced the membership repository, which would have read as the editor's revocation).
- Collateral fixes surfaced by running wider suites: `b16-0-15-tranche-parity` release stub upgraded to the v2 rule profile (was failing since B16-C.4); `b16-0-2-mode-diagnostics` layout assertion accepts the fixture-runtime prop added in B16-C §5 (was failing since 9ebfea1 — recorded as a slip: those suites were not run at that commit).
- Measurements: tsc 0; eslint 0 errors on the change set; suites green: physical-bindings + physical-binding + api tripwires + auth + assignment-queue (73 files), prompt-to-gerber + physical-bindings replay (6 files), panel (3 tests). Artifact: `artifacts/ai-control-plane-b16-closeout/component-review-handoff.md`.

### B16-C.3 snapshot-conflict UX (CONFIRMED, 2026-09-09 local, solo)

- Discover/reproduce: a publication pinned to an older snapshot revision was refused as a bare `PS_SNAPSHOT_REVISION_CONFLICT` 409 (the CAS never overwrote anything) and the browser printed a generic "Publication failed: <code>" toast — indistinguishable in kind from malformed input or a server failure, with no way forward.
- Implement: `PcbSyncSnapshotRevisionConflict` (durable store; same message, `details` = expected/current revision, current snapshot digest + schematic identity, attempted identity/digest — `PcbSyncSnapshotRevisionConflictDetails` in `pcb-sync/types.ts`); the pcb-sync handler returns the details as `conflict` on the 409; `PcbSyncClient` carries `conflict` only in its exact shape; `SnapshotConflictDialog` in `PcbEditor` names both revisions and offers Refresh (re-read durable truth, publish nothing), Rebase & publish (adopt the current revision as base and re-run the same Sync request on top; the newer revision stays in history; plan previewed before apply as always), Not now; actions disabled while a sync runs; the toast names both revisions.
- Tests: `b16-a-durable-heads` (details on the thrown conflict), `api/pcb-sync route.test` (409 body with `conflict`), recovery pipeline H.3 (fresh browser's stale publish names current 1 / expected 0), `snapshot-conflict-dialog.test.tsx` (2 cases). pcb-sync + api/pcb-sync + recovery + editor component suites green (10 + 5 files); tsc 0.
- Lint: the review hook is now declared before `handleSync` (it was read before declaration); one PRE-EXISTING `react-hooks/purity` error remains in `PcbEditor.tsx` (`Date.now()` inside the proposal-expiry memo, from an earlier chapter; CI does not run eslint) — recorded for B17-A, not fixed here.
- Artifact: `artifacts/ai-control-plane-b16-closeout/snapshot-conflict-ux.md`.

### B16-C.1 routed-board revision lifecycle (CONFIRMED, 2026-09-09 local, solo)

- Discover/reproduce: the Stage 8 guard refuses every structural sync on a routed board (`PS_STRUCTURAL_ADD_REQUIRES_UNROUTED_BOARD`, `PS_ROUTED_NET_CHANGE_REQUIRES_STAGE8`, `PS_FOOTPRINT_REPLACEMENT_REQUIRES_STAGE8`, `PS_REMOVED_NET_PROTECTED`, …); the only recorded way past it (recovery H.13) cleared copper by hand through the durable repository. Physical bindings were scoped by board instance id, so a second board id could never resolve the reviewer-approved exact parts.
- Implement (guard untouched; policy still refuses weakening): `app/lib/pcb-sync/board-revision.ts` (pure rework plan: per-component `kept/added/removed/footprint_changed/pin_map_changed/symbol_changed/placement_reset`, per-net `copper_retained/copper_stripped/unrouted/added/removed` with the semantic-equivalence PROOF — same stable id, byte-identical canonical `component::pin` endpoint set from verified pin-pad mappings, every member kept with the same footprint/mapping/symbol, placement carried; explicit `carry {copper, placement, constraints}`; optional outline; sealed `planDigest`); `board-lineage.ts` (durable lineage aggregate; `<root>@r<generation>` ids via `pcbDerivedBoardInstanceId`; ONE commit = derived board + applied sync plan + audit + child lineage current + parent lineage superseded; `resolveCurrent`; idempotent replay); service `previewBoardRevision` / `deriveBoardRevision` (parent preflight → plan → derivation-aware preflight of the stripped board (`PcbSyncPreflightContext.derivation`: protection per retained NET, never set for ordinary targets) → execute + validate → commit; refusals `PS_BOARD_DERIVATION_{CONFIRMATION_REQUIRED,HUMAN_REQUIRED,AUTHORIZATION_DENIED,PLAN_MISMATCH,BLOCKED}`, `PS_BOARD_SUPERSEDED`, `PS_BOARD_REVISION_MISMATCH`); route operations `preview_board_revision` / `derive_board_revision` (opt-in header + rollout gate like apply; 400/403/409 mapping); `GET ?boardId` carries `lineage`; qualify + release refuse superseded boards (`MFG_BOARD_SUPERSEDED` 409 naming `supersededBy`/`currentBoardId`); bindings and component authority resolve by LINEAGE ROOT id (`pcbBoardLineageOf`); browser: `BoardRevisionDialog` (carry choices, per-component/net outcomes + proofs, digest-bound acknowledgement), derive entry point beside the sync buttons when a preflight is blocked by protected copper, editor follows the lineage on load (`currentBoardId`), client `previewBoardRevision`/`deriveBoardRevision`.
- Tests: `app/lib/pcb-sync/__tests__/b16-c-board-revision.test.ts` (7 cases on the durable stack: add, remove, membership change + rename, footprint change, pin-map change, outline + constraints carry, refusals, lineage chain), `app/api/pcb-sync/__tests__/b16-c-board-revision-route.test.ts` (route: refusal → preview → derive 201 → superseded everywhere → board load lineage; malformed 400s), `board-revision-dialog.test.tsx` (2), recovery pipeline H.14 (real routing on the derived revision: old board refused for release/qualification with `MFG_BOARD_SUPERSEDED`, its ledger intact; the derived revision has no authority, is re-qualified (authority revision 1) and released separately; recovery fixture re-recorded). pcb-sync + api/pcb-sync: 10 files / 104 tests green; tsc 0.
- Not provided: an in-place "rip up routing" command (would need Tier 2 destructive-edit machinery); RECORDED, never a silent fallback. Artifact: `artifacts/ai-control-plane-b16-closeout/routed-board-revision-contract.md`.
- Findings while recording H.14 (CONFIRMED): (1) an unconnected spare component is refused by RC03 (`CAP_PIN_PAD_PARITY_UNPROVEN`, pre-existing rule) → OD-10 recorded, H.14 uses a connected J2; (2) a stable net id is derived from the endpoint set, so a membership change appears as REMOVED + ADDED identities — the plan now names the successor on the removed entry; (3) the autonomous qualification pinned placement to existing copper (`preserve_routed`) and blocked every outline candidate of a derived revision — `/api/pcb/qualify` now clears tracks/vias for the run (an already-unrouted board is byte-identical; the committed routed candidate replaces the board wholesale as before): retained copper is a starting point for human routing, never an RC02 input (incremental qualification PROPOSED); the acceptance recording is unaffected, the recovery recording was re-recorded.

### B16-C.5 page-level browser proof (CONFIRMED, 2026-09-09 local, solo)

- Harness (landed in `9ebfea1`, completed here): Playwright drives the REAL Next.js application (`next dev --port 3100`) under the env-gated fixture runtime (in-memory stores, committed blinker catalog, recorded provider design, recorded FreeRouting run replayed by placed-board revision, local-dev identity + dev-only role cookie); every test starts with cleared storage and no cookies; `e2e/prompt-to-gerber.spec.ts` is one serial journey covering the runbook's twelve items (project bootstrap, prompt, proposal + approval, review handoff, sync + explicit apply, qualification with duplicate click, separate admin release, download + independent archive verification, refresh after every durable boundary, cross-project isolation, bounded failure). CI job `page-browser-e2e` (`deterministic-manufacturing.yml`) installs Chromium and runs it; `playwright-report/` is uploaded and gitignored.
- Defects the browser found in the REAL page (each reproduced by a failing run, fixed, regression-tested; none was visible to the route-level pipelines):
  1. every authenticated AI request from the page (`/api/schematic/build-multi`, `edit`, `edit-build`, `review`, `layout-critic`, `cross-verify`) sent no project selector → `AUTH_PROJECT_SELECTOR_REQUIRED` 400 ("A project selector is required") — Build mode could not generate at all under the B16.0 trusted-context boundary. Fix: `aiRequestHeaders(scope)` in `app/page.tsx` (selector headers exactly as the simulation/BOM transports send them; never authority).
  2. `/api/parts/[id]` refused the committed catalog ids behind its UUID shape check before the fixture branch ran → every part "not found". Fix: the fixture catalog is consulted first (production path unchanged); test in `fixture-runtime.test.ts`.
  3. the fixture provider answered EVERY provider request with an empty response, so the auto-review after approval returned 500 "no review returned". Fix: `llmRouter.generate` under the fixture runtime answers only the build planner and refuses everything else with the bounded `provider_unavailable` (503, `missing_credentials`); test in `fixture-runtime.test.ts`.
  4. the component-review handoff (B16-C.2) was unreachable where an editor first meets the refusal: the PCB view's "No board yet" state rendered no panel. Fix: `ComponentReviewPanel` also renders in the empty state, in the flow below the call to action (an absolute overlay covered the button on a 1280×720 viewport — the second failing run).
  5. **In `next dev` every request-owned PCB workflow was dead**: React StrictMode runs each effect's cleanup once and mounts it again; `PcbEditor`'s cleanup disposed the `PcbBoardLifecycleOwner` permanently (and `page.tsx`'s the `ProjectAsyncScopeRegistry`), so Schematic → PCB, apply and qualification captured a never-current scope and ended `stale` at warm-up before any server call — the button did nothing, no toast, no request, no console error (reproduced by hand in the fixture server with temporary diagnostics: `run {"status":"stale","stage":"none"}`). Fix: `resume()` on both owners, called by the mount effect (`useEffect(() => { owner.resume(); return () => owner.dispose(); })`); a refused-busy or stale-before-any-server-call run now shows a toast instead of silence. Regression test `app/lib/pcb/lifecycle/__tests__/b16-c-strict-mode-remount.test.tsx` (4 cases: the pre-fix pattern leaves the owner disposed under `<StrictMode>`; the fixed pattern keeps scopes current and the owned sync workflow reaches every server stage; a real unmount disposes; resume never revives a retired generation; the project registry has the same contract). Production builds (no StrictMode double-invocation) were never affected; the deterministic pipelines run outside React.
  6. after the reviewer approved every candidate, the editor's second Schematic → PCB was refused 403 nine times: the browser re-sends `bind_atomic_selection` per instance and `bindAtomicSelection` checked the publication role BEFORE its idempotent replay of an already-approved identical selection. Fix: the replay (a read, nothing written) is answered first; publishing a NEW binding still needs reviewer/project_admin. Tests: `b16-c-review-handoff.test.ts` case 3 (editor replay 200 `alreadyBound` with the reviewer's revision, binding count unchanged; a different candidate still 403 with the handoff) and acceptance pipeline step 4 (all nine replays); identities unchanged.
  7. the committed router recording could never replay: the placed-board revision (the recording's key) differed on EVERY run. Two dumped router inputs (fixture-only diagnostics `SIRKIT_FIXTURE_ROUTER_DUMP`) differed only in every footprint's `syncIdentity.syncPlanId`; the plan digest carries the footprint resolver's decision digests, which carry the binding-set record digests (`createdAt`) and the request's `requestedAt` — i.e. the wall clock at both ends (the browser mints ids with `crypto.randomUUID()` as well). The deterministic pipelines freeze both (their harness); the fixture runtime now does the same: `app/lib/fixture-runtime/clock.ts` freezes the SERVER's `Date.now()`/`new Date()` at the pipelines' `FIXED_NOW` (`2026-09-09T12:00:00.000Z`, `SIRKIT_FIXTURE_CLOCK` overrides; installed by `instrumentation.ts` at start-up and by the container, only when the fixture runtime is enabled, idempotent, timers untouched); the spec freezes the BROWSER's `Date` with Playwright's fixed clock and replaces the browser's UUID source with a localStorage-persisted sequence. Tests: `fixture-runtime.test.ts` (clock installed only when on, idempotent, explicit dates/parsing untouched, uninstall restores). The fixture was re-recorded from empty under the frozen clock.
  8. with the recording replaying, the browser's qualification adoption ended in "Server authority diverged … the reloaded authority's content digest does not match the committed digest" and the local board stayed unrouted with "authority none": `/api/pcb/qualify` answered with the sealed authority's `boardDigest` (`pcb-authority-<sha256(stableJson(board))>`) while the editor's verified adoption compared it with the durable board RECORD's digest (`pcbSyncDigest(pcbRevisionPayload(board))`) — two different algorithms, so no qualification could ever verify in a real browser (pre-existing since B16.1C; route-level tests never compared the two). Fix: the response carries `committedBoardRevision`/`committedBoardDigest` (the record digest the reload returns; the authority's `boardDigest` is unchanged and still sealed), the editor verifies against those; acceptance pipeline step 7 pins `committedBoardDigest === record.digest` and that it differs from the authority digest. Identities unchanged.
  9. after a refresh with a synchronized board the manufacturing panel sometimes stayed at "Hydrating durable truth…" for good (run 17; run 16 passed the same step): the editor adopts the authoritative board right after mounting, which retires the lifecycle scope the hook's first READ captured, and the hook discarded the answer without ever reading again. Fix: a superseded hydration re-reads for the current generation (bounded to three retries; a lifecycle that keeps moving is reported as `MFG_HYDRATION_SUPERSEDED`, visible and retryable). Test: `manufacturing-workflow-panel.test.tsx` (replaced mid-read → loaded after one re-read; restless lifecycle → reported after the bound).
  10. (found by CI, `f6b9390`) the editor's publication answered `PS_STAGE3_DISABLED` 503 on the GitHub runner while every local run was green: the Stage 3 rollout flag `SIRKIT_PCB_SYNC_STAGE3` is OFF unless declared and the local `.env.local` had set it — an environment file CI does not have. Fix: the fixture runtime declares `opt_in` (the pipelines' state) in `playwright.config.ts` and `scripts/dev-fixture.mjs`; Playwright's failure artifacts moved to `test-results/` (the HTML reporter clears its own folder; CI uploads both).
- Spec facts: the manufacturing panel exists only once a board exists (the empty state has nothing durable to hydrate); the empty-state CTA carries `sync-schematic-to-pcb`; the sync refusal toast lives 6 s.
- Result: CONFIRMED — `pnpm exec playwright test` (replay, the CI configuration): 1 passed in 37.3 s (run 18) and 37.0 s (run 19) on 2026-09-09 after 19 iterations (each failing run named the defect above); the router recording `e2e/fixtures/blinker-route-fixture.json` was recorded from empty under the frozen clock (2 executions, FreeRouting 2.2.4 on the bundled JRE, `recordedAt` = the fixed instant; record run 69 s of routing) and replays the qualification in 1.7 s. Request tally per green run: physical-bindings 9×403 (the editor's first Schematic → PCB), 9×201 (review requests), 48×200 (listings, approvals, idempotent replays), pcb-sync 201 publish + 200 preflight + 200 apply, qualify 200 + 403 (the viewer's bounded refusal), release 200 ×2 (the second authorization idempotent, byte-identical archive); the downloaded archive's sha256 equalled the panel's digest and `verifyReleaseArchiveIndependently` reported every check ok for 9 components. Deterministic pipelines re-measured after every change: CI `prompt-to-gerber` list 43 files (40 passed, 3 skipped opt-in) / 354 tests (341 passed, 13 skipped, 0 failed); `database-delivery` list 9 files (6 passed, 3 skipped) / 68 tests (56 passed, 12 skipped); tsc 0; eslint 0 new errors (page.tsx 14 + PcbEditor.tsx 1 pre-existing, identical to HEAD). Pinned identities unchanged (board `pcb2-f61eca48a58212d9`, archive sha256 `997664c0…`). Artifact: `artifacts/ai-control-plane-b16-closeout/page-browser-e2e.md`.

### B16 final gate (CONFIRMED, 2026-09-09 local + GitHub Actions)

- PR #6 `chapter/b16-foundation-closeout` → `main`, marked ready 2026-09-09 22:00 (head `f6b9390`), fixed to `bf08386` after the first CI run of `page-browser-e2e` found the Stage 3 rollout flag missing outside `.env.local` (defect 10 in B16-C.5).
- CI at `bf08386`: `deterministic-manufacturing` run 34410597551 — `prompt-to-gerber` success (22:07:41 → 22:09:20 UTC), `database-delivery` success (22:07:43 → 22:09:16), `page-browser-e2e` success (22:07:41 → 22:10:19; real Chromium on ubuntu, fixture runtime, replayed router); `benchmark-quality` run 34410597557 — `benchmark-core` success, `benchmark-nightly` skipped by design.
- Merged normally (runbook §2.4 / OD-8) as merge commit `82ecbf8` at 22:11:10 UTC; local `main` fast-forwarded; no force-push, no history rewrite.
- B16 gate: PASSED — B16.1C integrated; deterministic CI green without dead external resources; database delivery repeatable (disposable PostgreSQL; real server BLOCKED-LIVE-QUALIFICATION); routed designs have a safe revision path; component review operable; fabrication rules source-pinned; the real page-level flow tested. Live checks recorded as blocked only (LB-1..LB-6). Artifacts: `artifacts/ai-control-plane-b16-closeout/` (16 files).
- Next: B17 (universal semantic editor, UI and 3D control) on `chapter/b17-semantic-editor` from `82ecbf8`.

## B17 — Universal semantic editor, UI and 3D control (started 2026-09-09)

### B17 discovery (RECORDED, 2026-09-09 local)

- B01 registry today: `app/lib/engineering/action-registry.ts` — 85 `ACTION_COVERAGE_REGISTRY` records (statuses: implemented 70, partial 8, ui-only 2, api-only 4, missing 1; kinds: mutate 46, propose 20, read 10, destructive 9; tool exposure: none 46, structured-route 22, preview-apply 10, chat 3, schema-only 2, repair-agent 2), `API_ROUTE_COVERAGE` for every `app/api` route, generators `scripts/generate-action-toolability-matrix.ts` → `artifacts/ai-control-plane-b01/{ui-command-toolability-matrix.csv,api-route-coverage.csv,ui-control-fingerprint.json}`, CI gate `app/lib/engineering/__tests__/action-registry.test.ts` (route coverage, method drift, fingerprint tripwire over 14 watched surfaces matching `aria-label`/`title` string literals only).
- Non-implemented records to re-baseline: partial `project.undo-redo`, `schematic.generate`, `schematic.import-export-kicad`, `placement.auto`, `routing.autoroute`, `pcb.footprint-resolution`, `pcb.ai-rules-brief`, `schematic.edit-topology`; ui-only `view.pcb-3d-control`, `view.canvas-navigation`; api-only `manufacturing.release`, `full-flow.run`, `project.engineering-effects`, `placement.preview-api`; missing `manufacturing.assembled-release`.
- Entry-point inventory (source scan, 2026-09-09): 314 `onClick` handlers across 45 files (page.tsx 74, SpiceStudio 43, BomView 36, PcbToolbar 22, PcbEditor 13, …), 10 `onKeyDown` + 12 `keydown` listeners, 24 pointer/mouse-down gestures, 10 dialogs, 1 context menu, 0 drag/drop handlers; `PcbPreview3D.tsx` (213 lines) owns component-local camera presets and layer toggles; `CommandPalette.tsx` renders `PaletteAction { run(); disabledReason }` fed by `PcbEditor.tsx`.
- Tool registry: `app/lib/engineering/tool-registry.ts` (403 lines; lifecycles, operation classes incl. `view-session`, side effects, binding statuses), `tool-discovery.ts` (227), `executor.ts` (744), `editor-adapter.ts` (980).

### B17-A rebaseline every current action (CONFIRMED, 2026-09-09 local, solo)

- Discover/reproduce: the B01 inventory fingerprinted only `aria-label`/`title` string literals on 14 watched files and its gates ran in no CI job; 15 of 85 records carried `partial`/`ui-only`/`api-only`/`missing` from B01 without current evidence; controls without labels (component props, gestures, keyboard listeners, palette actions, dialogs) were invisible to the tripwire.
- Implement: `app/lib/engineering/control-surface.ts` — a TypeScript-compiler-API scanner over `app/page.tsx`, `app/components/**` and the PCB render scene listing every JSX event handler (click, double-click, context menu, pointer/mouse down, key down, change, dialog open/close, submit, drag/drop), keyboard listeners, pointer/wheel gesture listeners and command-palette actions, keyed by surface + kind + element + label + handler summary (never a line); `control-registry.ts` — ordered classification rules (semantic / dispatcher / view / internal / unavailable with reason) naming the B01 records each control reaches; `scripts/generate-b17-control-inventory.ts` → `artifacts/ai-control-plane-b17/ui-control-inventory.csv` + `-summary.json`; three new B01 records (`schematic.sheet-size`, `pcb.board-revision`, `pcb.component-review`); 15 records re-baselined from current code (6 → implemented with evidence; 3 partial, 2 ui-only, 3 api-only and 1 missing kept ONLY with a precise documented blocker each); B01 matrices regenerated.
- Gates (`app/lib/engineering/__tests__/b17-a-control-inventory.test.ts`, now in the CI `prompt-to-gerber` job together with the B01 `action-registry.test.ts`): every control matches exactly one rule and no rule is stale; committed inventory byte-matches the render; every implemented record is reached by a control or a route (a handler-less record fails; `project.autosave` effect-driven, allow-listed with reason); ui-only reached by a control, api-only by a route, missing by neither; no record source references a retired `/api` route; a control with no handler must be internal/unavailable (never silent); unavailable controls carry a reason.
- Measurements: 554 controls on 58 surfaces (click 313, change 149, pointer 24, palette 21, shortcut 13, gesture 12, dialog 10, key 10, context-menu 1, double-click 1); classes semantic 253, view 272, dispatcher 21, internal 8, unavailable 0; 67 registry records reached by controls; registry 88 records; gates 16/16 green; tsc 0; eslint 0 on the change set.
- Bounded (RECORDED): keys change when a label or handler is refactored (the intended review point); prop-labelled generic components are inventoried by element + handler; PCB tool pointer handling is subscription-based behind the scene listener (one dispatcher site). Artifact: `artifacts/ai-control-plane-b17/control-classification-contract.md`.

### B17-B view-session command bus (CONFIRMED, 2026-09-09 local, solo)

- Discover: no shared view-command path existed — the 3D preview, the toolbar, the palette, keyboard shortcuts and the (unbound) `sirkit.view.*` tool descriptors each held their own state; the tool registry already reserved the `view-session` operation class (B04) with `binding: unbound`.
- Implement: `app/lib/view-session/types.ts` (envelope `sirkit.view-command.v1`: commandId, invocationId, sessionId, projectId, branchId, editor schematic|pcb|pcb3d, expectedViewRevision, trusted actor label, payload, issuedAt/expiresAt; bounded refusal codes VS_*; descriptor with per-command staleness rule, optional role list and explicit workspace-preference persistence; redacting trace record `sirkit.view-command-trace.v1`), `bus.ts` (`ViewSessionBus`: envelope validation, session/project/branch/editor scoping, expiry, role gate, documented stale rule — idempotent commands REBASE and report it, relative commands REFUSE with the current revision —, exact payload validation, cancellable async apply with the session's abort, structural change detection (the view revision moves only when the view changed), single settlement with bounded replay retention and shared in-flight duplicates, retirement on project-switch/logout/tab-disposed/editor-closed, preference-only persistence, subscribe, `describeCommands` for discovery; `createViewCommand`, `newViewSessionId`).
- Tests: `app/lib/view-session/__tests__/b17-b-view-session-bus.test.ts` — 12 cases covering every B17-B requirement (envelope validation, scoping, stale refuse/rebase, single settlement, cancellation, retirement ×3 reasons, preference-only persistence, no engineering undo, trace redaction with digest/keys, expiry/roles/bounded handler refusals, agent parity + registration refusals, envelope factory); added to the CI `prompt-to-gerber` list. tsc 0; eslint 0.
- Artifact: `artifacts/ai-control-plane-b17/view-command-contract.md`. Adopters follow: B17-C (pcb3d), B17-D (schematic/pcb canvas), B17-F (tools).

### B17-C complete PCB 3D semantic control (CONFIRMED, 2026-09-09 local, solo)

- Discover/reproduce: `PcbPreview3D` owned its camera presets, five coarse toggles (one shared silkscreen flag) and finish as component-local React state; the toolbar, palette and Ctrl+3 flipped a `preview3dOpen` boolean in the editor; no shared command existed (B01 `view.pcb-3d-control` ui-only, tool descriptor unbound). At a 1280 px viewport the PCB toolbar overflowed under the right inspector column, so its right-hand controls (3D preview, layers, shortcuts) could not be clicked at all — the first browser run of the 3D proof waited five minutes on an intercepted click (a silent control, contrary to the B17-A target).
- Implement: `app/lib/view-session/pcb3d.ts` — the `pcb3d` command set on the B17-B bus (`open`, `close`, `camera-preset` top/bottom/iso, `fit-board`, `reset-camera`, `focus-component` by refdes or id, `focus-selection`, `focus-net` by id or name, `set-layer-visible` for silkTop / silkBottom / mask / copper / zones / vias / footprints / refdes / substrate, `toggle-layer` (relative → refuses a stale view), `set-finish` as the ONLY persisted workspace preference, `read-state`); a pure geometry probe over the current board in scene mm (`refBBox` body bounds, net bounds from pads/tracks/vias) — unanswerable focus settles `VS_UNAVAILABLE` "model/geometry unavailable: …", never a pretend focus; camera = preset|custom + target + framing distance + sequence. Scene builder: `SceneParams.showSilkTop/showSilkBottom/showCopper/showVias/showSubstrate` (defaults keep every pinned test). `usePcb3dViewSession` (one bus per editor mount, retired on unmount, board source updated by an effect, finish preference in `localStorage sirkit.workspace.pcb3d.finish`); `PcbPreview3D` renders from bus state and every overlay control issues a command (nine layer buttons, three presets, Fit, Reset, Focus input, finish select), reporting the bus state (`data-view`) and the three.js scene graph's visibility (`data-scene`); `PcbEditor` routes toolbar / palette / Ctrl+3 / Escape / close through `pcb3d.toggle|setOpen`. Toolbar layout fixed: wraps within its column (`min-w-0 flex-wrap`) instead of painting under the inspector.
- Registry: `view.pcb-3d-control` re-baselined ui-only → implemented (sources: preview, hook, command set, bus); control rules `view.pcb-3d` (every 3D control → `pcb3d.*`) and `view.pcb-3d-focus-draft`; inventory 558 controls / 58 surfaces regenerated.
- Tests: `b17-c-pcb3d-commands.test.ts` (6 cases incl. the acceptance phrase's exact final state), `pcb3d-view-session.test.tsx` (2, StrictMode), bus suite (12), engineering gates 16/16 (inventory regenerated: 558 controls / 58 surfaces), PCB component suites green; tsc 0; eslint 0 on the change set (the one remaining report, `react-hooks/purity` at `PcbEditor.tsx:1320` `Date.now()` in the proposal-expiry guard, is pre-existing in `82ecbf8`, untouched). Escape closes the 3D view through the editor's existing global-actions ref (`close3d`) like Ctrl+3 (`toggle3d`), so the window keydown listener stays stable; proof re-run on the final tree (run 4).
- Browser proof (`e2e/pcb-3d-semantic.spec.ts`, shared `e2e/fixture-journey.ts`): run 3 PASSED 2026-09-09 23:03 local (1 passed, 24.3 s, retries 0) — open → hide top silkscreen only → focus J1 → isometric asserted on the bus state (`data-view`) AND the three.js scene visibility (`data-scene`), camera sequence advanced by one, no notice; U9 → `VS_UNAVAILABLE — model/geometry unavailable: component U9 is not on the board` with the focus unchanged; screenshot `artifacts/ai-control-plane-b17/evidence/pcb-3d-acceptance.png`. Runs 1–2 each found a real defect: (1) toolbar overflow (fixed, above); (2) React StrictMode's simulated unmount retired the pcb3d bus before first use, so the toolbar's `pcb3d.open` was refused `VS_SESSION_RETIRED` and the sheet never opened — fixed in `usePcb3dViewSession` (a bus retired before the editor is live is replaced; the session owner is the React store, so the replacement notifies subscribers; retirement stays final on the bus), regression test `app/components/pcb/__tests__/pcb3d-view-session.test.tsx` (fails on the old hook, passes now, in the CI prompt-to-gerber list). Observation: run 1's dev server logged `Error: aborted (ECONNRESET)` uncaught around the reviewer reload (client navigation aborted in-flight requests; the server continued; not seen in runs 2–3) — on the B17 validation watch list.
- Artifact: `artifacts/ai-control-plane-b17/3d-command-proof.md` (+ `evidence/pcb-3d-acceptance.png`).

### B17 CI correction: H.16 release-status pin (CONFIRMED, 2026-09-09 local, solo)

- Discover: the CI run for `9e90e5c` (B17-B) failed its `prompt-to-gerber` job — `recovery-pipeline.test.ts` H.16 pinned `manufacturing.release` as `status: "api-only"` (true at B16.1C, when no release UI existed); B17-A re-baselined the record to `implemented` after B16-C's administrator-authorized release UI, and the B17-A/B local runs covered the engineering gates but not the prompt-to-gerber recovery suite (a process gap, recorded). `database-delivery` and `page-browser-e2e` were green on that run; `040df94` (B17-C) carries the same registry, so its run (in progress at the time of this fix) is expected to fail the same way and is recorded when finished.
- Reproduce: `pnpm exec vitest run app/lib/workflow/prompt-to-gerber/__tests__/recovery-pipeline.test.ts` → 1 failed / 9 passed (H.16: expected `status: "api-only"`).
- Fix (no invariant weakened): H.16 now asserts the truthful status `implemented` AND keeps every safety property — `kind: "destructive"`, `toolExposure: "none"`, `approvalTier: "release"`, no release/qualification tool agent-exposed or callable — and adds two: the record's sources include the server-owned `app/api/pcb/release/route.ts` and its handler names `authorizeRelease` (the administrator authorization). Title updated accordingly.
- Test: recovery suite 10/10; the exact CI `prompt-to-gerber` vitest list run locally: 45 files / 377 tests passed, 3 files / 13 tests skipped (opt-in live), 0 failed.

### B17 CI correction: browser proofs shared one server and one id sequence (CONFIRMED, 2026-09-09 local, solo)

- Discover: the `page-browser-e2e` job at `040df94` and `a0236b0` ran the new `pcb-3d-semantic.spec.ts` first and then `prompt-to-gerber.spec.ts` on the SAME fixture dev server with the SAME deterministic id sequence (`b16c0000-…`), so the second journey opened the first journey's project and found a synchronized board where it expected the empty state (`sync-schematic-to-pcb` never rendered; 300 s timeout at spec line 112; error-context snapshot shows "Schematic → PCB · Qualify & route"). The 3D spec itself passed in CI (1.2 min). Locally each spec had only been run alone.
- Fix: `installDeterministicBrowser(page, context, uuidNamespace)` — every spec that shares the server mints its ids under its own namespace (`prompt-to-gerber` keeps `b16c0000`, the 3D proof uses `b17c0000`); the router recording is keyed by the content-derived placed-board revision, so the namespace does not change which recording replays (verified: the namespaced 3D run replayed the recording and passed).
- Test: `pnpm exec playwright test` (both specs, one server, retries 0): 2 passed in 51.8 s locally.

### B17-D schematic/PCB canvas navigation and selection (CONFIRMED, 2026-09-09 local, solo)

- Discover (agent-assisted read of the editors, RECORDED in `selection-context-proof.md`): the 2D canvas had no viewport getter, no fit-selection primitive, no explicit-value layer action, no net highlight, a selection store without a revision, and an unbound `PCBViewAdapter` seam; the schematic had fit only (two different zoom clamps), a single selection split across two page states, no focus/select-by-refdes, no ERC findings; tabs were a bare `setView`; the captured editor context carried a selection digest but no view revision.
- Implement: `app/lib/view-session/targets.ts` (semantic targets, versioned selection, `checkSelectionVersion` — "this component" refuses a stale revision or captured digest and an absent selection), `pcb.ts` (25 commands: fit/zoom/pan/focus, select/add/remove/net/clear, layers/grid, highlight, reveal DRC/routing findings, measure without a dimension, read-state, human-only observe), `schematic.ts` (12 commands incl. the honest ERC refusal), `workspace.ts` (3; `workspace` joins `VIEW_EDITORS`); the bus context carries `expectedViewRevision` / `viewRevision` / `rebased`; the shared StrictMode-safe `useViewSession` owner (`pcb3d` rebuilt on it, API unchanged); `usePcbViewSession` / `useSchematicViewSession` / `useWorkspaceViewSession` apply bus state to the owners and mirror the human's changes via observe; `PcbScene.viewState / onViewChange / setHighlightRefs` (amber highlight overlay); reducer `set-layer-visible` / `set-grid`; `useDrc.flash`; toolbar **Go to** on both canvases (select + focus by refdes; refusals shown, never guessed), measurement readout; every navigation/selection/layer/reveal control issues the command (toolbar, palette, context menu, layer panel, inspector Zoom to, DRC rows, fab dialog, autoroute failures, Escape, tabs, Run sim).
- Registry: `view.canvas-navigation` ui-only → implemented; new `view.selection`, `view.layer-visibility`, `view.reveal-finding`, `view.measure` (92 records); ten `view.*` rules; inventory 563 controls / 58 surfaces; gates 16/16; B01 matrices regenerated.
- Tests: view-session 27/27 (+9 B17-D cases), engineering gates 16/16, PCB component suites 56/1 skipped, `inspector-commands` adapted to the `onFitSelection` prop; tsc 0; eslint 0 on the change set (page.tsx's 14 and PcbEditor's 1 pre-existing React-hooks errors unchanged).
- Browser proof (`e2e/semantic-editor.spec.ts`, replaces `pcb-3d-semantic.spec.ts`; serial on ONE synchronized board under uuid namespace `b17c0000`): run 8 PASSED 2026-09-10 00:29 local (3 passed, 39.6 s, retries 0): scenario 1 = the B17-C 3D acceptance unchanged; scenario 2 = Go to J1 (select + focus; the renderer's observed camera converged on the intent; inspector shows J1), Go to U9 refused with a toast, layer eye → toggle-layer, activate Bottom Copper, Zoom to fit → board intent and the observed zoom dropped, Run DRC + first row → reveal-finding drc:<id> with a 40 px/mm frame; scenario 3 = Schematic tab → workspace.open-editor, Go to R1 (selected, focus zoom 2 applied by the canvas: R1 at the viewport centre within 2 px), Go to Q9 refused inline, Fit → page intent, PCB tab. Whole suite (`pnpm exec playwright test`, both specs on one server, prompt-to-Gerber first) on the final tree, 2026-09-10 01:07 local: **4 passed in 1.1 min** — prompt-to-Gerber 36.6 s with the qualification replaying the recording (`POST /api/pcb/qualify 200`), the three semantic scenarios 6.8 s / 5.0 s / 2.0 s. Screenshots in `evidence/`. Runs 1–7 each found something real (next line).
- Defects the proof found (CONFIRMED, fixed): (1) the Layers panel was a shrinkable flex item in the right column and collapsed under the "Multilayer routing" panel — its eye/activate rows were unreachable (run 1's click intercepted for 5 min; the B17-C screenshot already showed the two headers overlapping) → `LayerPanel` is `shrink-0` with a plain rows container; (2) `createViewCommand` derived the invocation id from the payload + `issuedAt`, so under the frozen fixture clock a later `pcb.observe` whose camera equalled an earlier one replayed the OLD settled result and the mirror never followed "Zoom to fit" (run 2: the canvas was fitted, `observed.pxPerMm` stayed 40) → default ids are unique per issue (counter + digest); replay is only for a deliberately reused id; bus test and contract corrected (single settlement itself unchanged); (3) the same collapse hit the DRC panel next (run 3: its violation rows sat under its own header, the click intercepted for 5 min) and the inspector — the right column scrolls, so every panel now keeps its content height (`[&>*]:shrink-0` on the column, `data-testid="pcb-right-column"`); the DRC panel itself was `flex-1 min-h-0` with a `flex-1 min-h-0 overflow-y-auto` list, a zero-height scroll box in a scrolling column (run 4: rows still under the header) → content height with a bounded `max-h-96` scrolling list; (4) on the schematic, the floating property panels (theory and KiCad) opened at `top-4 right-4` OVER the toolbar group holding Fit and Go to, so once a component was selected those controls were unreachable (run 5: the second Go to intercepted for 5 min) → the panels open below the toolbar group (`top-14`).
- Also found by the FULL browser suite: `newViewSessionId()` drew on `crypto.randomUUID()` at page mount and shifted every application id minted afterwards, so the prompt-to-Gerber journey's placed-board revision missed the router recording (`ROUTE_FIXTURE_MISS`, qualify 500) → session ids use their own generator; the whole suite then replayed the recording (4 passed, 1.1 min).
- Harness (RECORDED): run 6 clicked before the client hydrated after a cold Turbopack compile (both journeys now wait for the project name, `expectHydrated`); run 7 used the Fit button's title as its accessible name (visible text "Fit" is the name). A CI-list vitest run overlapping a full Playwright run failed five load-sensitive suites; re-run alone the list passed 48 files / 387 tests (recorded in `selection-context-proof.md`, not treated as passes). eslint on the change set is 0 (page.tsx keeps its 14 pre-existing React-hooks errors, PcbEditor its 1, `b14-replacement-proposal.test.ts` its 2 prefer-const errors — all untouched).
- Artifact: `artifacts/ai-control-plane-b17/selection-context-proof.md` (+ `evidence/pcb-canvas-acceptance.png`, `evidence/schematic-canvas-acceptance.png`).
- CI at `96a2925` (2026-09-10 00:52–00:56 UTC): `deterministic-manufacturing` run 34423102162 — `prompt-to-gerber` success, `page-browser-e2e` success (both specs on the ubuntu runner: the serial semantic-editor proof and the prompt-to-Gerber journey), `database-delivery` success; `benchmark-quality` run 34423102170 — `benchmark-core` success, `benchmark-nightly` skipped by design.

### B17-E placement, routing, history and import/export parity (CONFIRMED, 2026-09-10 local, solo)

- Discover (agent-assisted, RECORDED in `placement-routing-parity.md` / `project-history-model.md`): `runEngineeringPlacement` had 5 call sites with hand-built options and three private candidate homes (the worker hook's ref, the preview route's raw result, the tool service's map — the agent mutated a shadow board's `locked` flags); autoroute committed on return with no preview/apply/discard, never sent `netIds`/`sourceRevision` (server-complete, UI-dark) and derived `replacedNetIds` from whatever the router returned; rip-up existed three ways and reroute only as a repair fix; the two histories had incompatible entry shapes, no project sequence and no cross-store correlation beyond `pcbProposalBasis`; no import/export path declared its outcome class (schematic export failures were a raw `alert`, the palette PCB export dropped the unsupported-content diagnostic, the project-file import hid missing parts and warnings).
- Implement: `app/lib/pcb/candidates/layout-candidate.ts` — `sirkit.layout-candidate.v1` (revision + lifecycle-generation-bound, content digest excluding stamps and per-invocation engine evidence, 30 min expiry), ONE `placementRunOptions` builder for every producer, `producePlacementCandidate` / `produceRoutingCandidate` (copper restricted to the requested nets), a bounded observable `LayoutCandidateStore`, `verifyLayoutCandidate`, `applyLayoutCandidate` (ONE canonical transaction: base re-check at serialized execution, `applyPlacementCandidate` protected copper, scoped self-dual `AutorouteImport` with provenance check, undoable), `clearNets`, `netsOfSelection`; `useAutoPlace` and `useAutoroute` rebuilt on the store (autoroute now preview → apply / discard with a canvas ghost, `sourceRevision` + `netIds` sent); `PCBToolService.previewPlacement` and `POST /api/pcb/placement/preview` (409 on a stale `expectedRevision`) produce the same artifact; the placement panel lists every store candidate with its producer for human apply/discard; routing panel Apply/Discard, "Reroute selected nets", "Clear selected nets", "New routed-board revision…" (B16 sync path); palette entries; executor bindings `pcb.reroute-nets` / `pcb.clear-nets`. `app/lib/project/operation-timeline.ts` — the project operation timeline over both authoritative histories (head fingerprints; `bindStore`; `latestEligibleUndo`; `undoLatest` delegating to the owning store; refusals DIVERGED_SCHEMATIC / DIVERGED_PCB / NOT_UNDOABLE / NOTHING_TO_UNDO), recorded by the page (`publishSchematicHistory`) and the PCB editor (history subscription), shown in the Revision history dialog with "Undo latest". `app/lib/project/io-outcome.ts` — outcome declarations for every import/export path + `describeExportRefusal`; the three reporting gaps fixed.
- Registry: `placement.auto`, `routing.autoroute` partial → implemented on the shared candidate; `placement.preview-api` re-described (api-only by design, precise); new `pcb.clear-nets`, `pcb.reroute-nets`, `pcb.routed-board-revision`, `project.operation-timeline`; `project.undo-redo` re-described; remaining non-implemented records each carry a precise blocker (`schematic.import-export-kicad` partial: no `.kicad_sch` import path; `full-flow.run`, `project.engineering-effects` api-only by design; `manufacturing.assembled-release` missing until B22–B24). Rules `placement.candidate-review`, `routing.candidate-review`, `routing.selected-nets`, `routing.clear-nets`, `pcb.routed-board-revision`, `project.operation-timeline`; inventory 573 controls / 58 surfaces; 96 records; B01 matrices regenerated.
- Tests: `b17-e-layout-candidates.test.ts` (5), `b17-e-operation-timeline.test.ts` (3), `b17-e-io-outcomes.test.ts` (2); `b16-0-12-tranche-parity` normalizes the candidate's wall-clock stamps (the digest itself must match byte-for-byte); the exact CI `prompt-to-gerber` list (now incl. candidates, timeline, io-outcomes, tranche parity): 52 files / 421 tests passed, 3 files / 13 tests skipped (opt-in live); tsc 0; eslint 0 on the change set (page.tsx 14 / PcbEditor 1 pre-existing errors unchanged).
- Browser proof (`e2e/semantic-editor.spec.ts` scenario 4): run 9 PASSED 2026-09-10 01:52 local (4 passed in 50.1 s, retries 0; scenarios 1–3 unchanged): with no selection the routing panel's "Reroute selected nets" / "Clear selected nets" are disabled; Go to J1 (pcb.select) names J1's nets → both enable and the reroute button shows the net count; "New routed-board revision…" is present; no routing or placement candidate exists in the shared store before a run; Escape (pcb.clear-selection) disables the commands again; the Revision history dialog's project timeline lists entries from BOTH stores (the journey's schematic hydrate/commits and the PCB board load), and "Undo latest" refuses with a code shown inline — nothing changed; screenshot `evidence/project-timeline.png`. Observed code: DIVERGED_PCB rather than NOT_UNDOABLE — the board-load entry's head fingerprint is taken when the history is bound, before the canonical session confirms its lineage/head sequence, so the (never undoable) hydrate entry reads as diverged once the head is confirmed; commits are recorded after confirmation and carry the canonical head (RECORDED: cosmetic ordering of the two refusal checks, the refusal itself is correct and nothing is guessed). Whole suite (`pnpm exec playwright test`, both specs on one server) on the final tree, 2026-09-10 02:03 local: **5 passed in 1.2 min** — prompt-to-Gerber with the qualification replaying the recording (`POST /api/pcb/qualify 200`), the four semantic scenarios 6.6 s / 4.9 s / 1.7 s / 3.0 s.
- Artifacts: `artifacts/ai-control-plane-b17/placement-routing-parity.md`, `project-history-model.md`.
- CI at `041fad9` (2026-09-10 local 01:33): `deterministic-manufacturing` run 34425908885 — `prompt-to-gerber` success (52 files incl. the B17-E suites), `page-browser-e2e` success (both specs; five scenarios), `database-delivery` success; `benchmark-quality` success.

### B17-F tool exposure (CONFIRMED, 2026-09-10 local, solo)

- Discover (RECORDED in `tool-exposure.md`): 12 exposed tools pinned as a literal `12` / `["read", "propose"]` in ~30 gate sites across 37 test files; two unbound schema-only view declarations (`sirkit.view.pcb-3d`, `sirkit.view.canvas-navigation`); `placement.propose` / `routing.propose` unexposed and bound to the old engines; no captured view state reached the agent; the FreeRouting pass executor lived inside the autoroute route; `maxToolCount: 16` hard-coded; the wire subset has no `minimum`/`maximum` (a `min/max` keyword silently made a tool non-strict and excluded it — caught by the B09 generator).
- Implement: `app/lib/engineering/agent-exposure.ts` (the ONE reviewed intentional set, 22 ids with reasons; exposable classes read/propose/view-session; never-exposed patterns; `agentExposureReport`); registry rules for view-session tools (`bound-view-session`, `viewCommands`, `*-surface` project states, no `observe`); catalog: `sirkit.view.read-state`, `sirkit.project.history-inspect` (reads over the captured view context / timeline through the real B05 boundary), `sirkit.view.pcb3d`, `sirkit.view.canvas-navigation` 1.1.0, `sirkit.selection.control`, `sirkit.view.layers`, `sirkit.view.reveal-finding`, `sirkit.view.measure` (bus-command tools), `sirkit.placement.propose` / `sirkit.routing.propose` 1.1.0 exposed on the shared layout candidate; `app/lib/agent/view-context.ts` (captured view context validation, digests, surface states, the tool→bus-command mapping with target/ref conversion, `prepareViewCommandRequest` over the SAME command descriptors the browser runs, selection-digest pinning), `layout-proposals.ts` (strict, role/capability-rechecked candidate production; `routing-server.ts` over the pass executor extracted verbatim into `app/lib/pcb/autoroute/freerouting-pass-executor.ts` and reused by the route), contracts/context/gateway/loop (`view-command` and `layout-candidate` outcomes, `view_command_ready` / `layout_candidate_ready` events, trace classes, derived `maxToolCount`, surface-integrity check, long-running tool deadline bounded by the run deadline), `/api/chat` (`viewContext` body key; the routing engine wired with the request signal); browser: `app/lib/agent/view-session-bridge.ts` + `useViewSessionBridge` (pcb3d/pcb in PcbEditor while a real board is loaded, schematic, workspace), the page captures ONE view context per chat request and executes `view_command_ready` on the user's own bus; `layout_candidate_ready` → SAFE receiver → PcbEditor's candidate store (placement panel / routing panel with the ghost; Apply/Discard through B17-E); fixture-only `window.__sirkitViewBridge` diagnostic hook.
- Gates: 37 test files re-derived from the intentional set (no literal count anywhere); B04/B05/B05-1/B09/B10/B11 artifacts regenerated by their generators (B01 matrices, B17 inventory unchanged).
- Tests: `b17-f-agent-exposure` (8), `b17-f-view-tools` (11), `b17-f-view-session-bridge` (4) — 24/24, added to the CI prompt-to-gerber list; broad run 3009 passed; isolated re-run of the remaining files 20/21 (B16.1B §G timed out at 5.49 s under load, passes alone in 1.9 s ×2 — RECORDED, not dismissed); tsc 0; eslint 0 on the change set (page.tsx 14 / PcbEditor 1 pre-existing React-hooks errors unchanged).
- Pre-existing branch failures found by the broad run (NOT caused by B17-F; carried into B17 validation): `b16-0-8-migration-ratchet` (raw-route baseline sha1 for `POST /api/pcb-sync` stale since B16-C.1 `f6b9390`; not in any CI list), `b16-0-22-tranche-parity` (pcb-sync GET unknown boardId → 422, test pins 404; 2 cases).
- Browser proof (`e2e/semantic-editor.spec.ts` scenario 5): run 2 PASSED 2026-09-10 02:47 local (5 passed in 1.4 min; run 1 found the hook capturing without the page's timeline — fixed to bind the same capture the chat request uses); whole suite on the final tree 02:52 local: **6 passed in 2.1 min** (prompt-to-Gerber 1.1 min with the qualification replaying the recording; five semantic scenarios 12.6 s / 9.5 s / 4.1 s / 6.2 s / 6.9 s). Screenshot `evidence/agent-view-tools.png`.
- UNKNOWN: a live provider chat turn calling these tools (no fixture agent provider; credits unknown) — server half proven through the same gateway/loop with a scripted adapter, browser half through the same bridge capture/execute.
- Artifact: `artifacts/ai-control-plane-b17/tool-exposure.md`.
- CI at `81bf3ea` (2026-09-10 02:43–02:48 UTC): `deterministic-manufacturing` run 34430572594 — `prompt-to-gerber` success (incl. the three B17-F suites), `page-browser-e2e` success (both specs; six scenarios), `database-delivery` success; `benchmark-quality` run 34430572590 — `benchmark-core` success, `benchmark-nightly` skipped by design.

### B17 validation (CONFIRMED, 2026-09-10 local, solo)

- Artifacts: `ui-negative-tripwires.md`, `test-and-validation-report.md`, `changed-files.md` (153 files, 12 commits from `82ecbf8`), `unknowns-and-owner-decisions.md` (U17-1…4, R17-1…9, D17-1…5), `final-verdict.md` (PASS of the deterministic gate; live checks recorded as UNKNOWN/BLOCKED).
- New tripwire `app/lib/view-session/__tests__/b17-negative-tripwires.test.ts` (in the CI prompt-to-gerber list via `app/lib/view-session`): every registered view command (49) × representative + garbage payloads × agent/human = 518 dispatches, > 150 settled, board and schematic sources byte-identical; mirrors human-only (`VS_ROLE_FORBIDDEN`); view-session tools carry no engineering side effect/authority. Its own first draft was vacuous (wall-clock envelopes expired against the frozen bus clock) — fixed and hardened (infrastructure refusals fail the test).
- Full suite run 1 (16 workers): 4895/4959 passed, 31 failed — 27 contention timeouts / timing thresholds that all pass alone (RECORDED, R17-8) + 4 real items; run 2 (4 workers, final tree): **4928/4962 passed, 1 load timeout (passes alone 15/15), 33 opt-in pending**. Generators: all eight idempotent on the final tree. tsc 0; eslint 0 new.
- Real defect found and fixed (B17-E regression): `useAutoPlace.apply` had the candidate lookup before the B08.2 generation check, so a same-digest lifecycle replacement no longer invalidated a PARTIAL placement preview (`b08-2-async-ownership` 9: state stayed `done`, no toast) — the check now precedes the lookup, the stale candidate is retired; B08.2 15/15, PCB component suites 64/1 skipped.
- Pre-existing B16-C.1 test debts resolved (never in a CI list): `_raw-route-baseline.json` regenerated for the lineage wiring in `POST /api/pcb-sync` (3 → 3 legacy, 0 migrated, 0 added; only that sha1) — D17-5; `b16-0-22-tranche-parity` pcb-sync GET cases now mock the B16-C.1 lineage read (`DurableBoardLineageStore.get` → null → implicit lineage) — the durable workflow store had thrown `DATABASE_URL is not set` → 422 `PS_INTERNAL_ERROR`; 59/59, and the implicit lineage summary is asserted.
- Browser suite on the B17-F tree: 6 passed in 2.1 min (unchanged by validation: the fixes touch a hook path the journeys do not exercise and two tests).
- CI at `f788acd` (2026-09-10 03:09–03:14 UTC): `deterministic-manufacturing` run 34432252639 — `prompt-to-gerber` success (incl. the negative tripwires), `page-browser-e2e` success (six scenarios), `database-delivery` success; `benchmark-quality` run 34432252622 — `benchmark-core` success. **B17 final gate: PASS** (`final-verdict.md`); integrating PR #7 normally per D17-1 / OD-8.

### B17 final gate recorded (CONFIRMED, 2026-09-10 local, solo)

- PR #7 https://github.com/dantdani/sirkit-edit/pull/7 marked ready and merged normally at 2026-09-10 03:20:09 UTC as merge commit `804a08d` (heads `2558259`; the validation tree `f788acd` and `2558259` were green on `deterministic-manufacturing` — prompt-to-gerber, page-browser-e2e, database-delivery — and `benchmark-quality`). Local `main` fast-forwarded to `804a08d` (`git merge --ff-only origin/main`). No force-push, no history rewrite; every branch commit authored by Dandi Desta without AI trailers.
- B17 closeout artifacts: `artifacts/ai-control-plane-b17/` (README rows all CONFIRMED; final verdict PASS of the deterministic gate; U17-1…4 recorded).

### B18 started (2026-09-10 local, solo)

- Branch `chapter/b18-agent-execution` from `804a08d`; draft PR #8 opened so every push runs both workflows.
- Discovery (agent-assisted, read-only; RECORDED in `artifacts/ai-control-plane-b18/discovery.md`, INFERRED until reproduced): no autonomy setting exists anywhere (the only `AutonomyTier` is an unenforced CD-13 draft field); the one-shot approval pattern exists three times, all browser-in-process (`PcbEditApprovalIntent` binds 11 of the 13 grant fields B18-B lists), never server-minted or persisted; every Tier-1 canonical command already has a kernel binding (`KERNEL_OPERATION_BINDINGS`) but no callable tool — the three fail-closed gates are `validateToolDescriptor` ("agent-exposed mutation capability is forbidden"), `AGENT_EXPOSABLE_OPERATION_CLASSES` + `NEVER_EXPOSED_TOOL_PATTERNS`, and the gateway's catch-all refusal; the schematic Tier-1 apply command covers only set-property + delete; no `executed` outcome kind / event / trace class; the system prompt is "proposals only" (version 1.0.0); no scripted LLM adapter exists for browser runs (the fixture router throws for non-planner calls) — the B17-F browser proof drove the view bridge from the page instead.
- Next: B18-A — reproduce the gaps as counterexamples, define the tier vocabulary as a MAPPING onto the existing `ApprovalTier` (none/reversible → Tier 0/1, topology-or-geometry/destructive → Tier 2, release → Tier 3), server-owned project autonomy settings (schema + migration + canonical route + repository + audit), then B18-B grants.

### B18-A permission tiers and autonomy settings (CONFIRMED, 2026-09-10 local, solo; commits `595dab0`, `4baba79`, `4f2bd63`)

- Reproduce: no autonomy setting / grant / agent route exists; a project administrator's run has no mutation tool (discovery `not_agent_exposed`, toolset omits it, gateway `not_callable`) — probe green, recorded in `discovery.md`.
- Implement: `app/lib/engineering/permission-tiers.ts` — Tier 0–3 as a MAPPING onto the existing `ApprovalTier` + operation class (view-area records Tier 0; proposals are the Tier-2 path; release families a Tier-3 floor); `decideAgentExecution` pure and fail-closed (Tier 3 never; Tier 2 proposal-only; Tier 1 preview+confirm, `execute_explicit` only with the project opt-in AND a proven exact user request, always under a grant; Tier 0 direct; viewer/commenter/reviewer never execute Tier 1). `app/lib/agent/autonomy-settings.ts` (repository contract: default `proposal_only` rev 0, admin-only compare-and-set, one audit change per accepted write, no-op on the same mode; in-memory reference) and `autonomy-store.ts` (`DurableAgentAutonomyRepository` over the durable-workflow aggregate `agent.autonomy-settings.v1`: aggregate revision = setting revision, one digest-bound record + one `agent.autonomy-changed` outbox event per change, append-only history as the audit trail, tampered records refused, stale CAS answers with the current setting; injectable resolver — D18-1: no new table/migration). `app/api/agent/autonomy/route.ts` — canonical `GET` (every member) / `POST` (project_admin, CSRF, closed body `{mode, expectedRevision}`, authority-shaped keys refused by name, human only, 409 stale with current, 503 unavailable). `AgentRunContext.autonomy` read server-side by `/api/chat` (unavailable ⇒ warning + `proposal_only`); gateway integrity refuses a foreign setting.
- Registrations: policy rows (read ALL_MEMBERS / mutate ADMIN_ONLY), classification (durable read-write, project-durable), action record `agent.autonomy-setting` (97 records) + route coverage (143), the two route-count pins 153/150 → 155/152 (0 raw stays 0; the raw-route baseline is untouched — additions are refused by design); regenerated exact-route-policy, classification, auth coverage, B01 matrices, b16-0-4/7 inventories.
- Tests: `b18-a-permission-tiers` 6, `b18-a-autonomy-settings` 4, `b18-a-autonomy-store` 4, `b18-a-autonomy-route` 6; pinned suites (b16-1c, b16-1b, b16-0-1/2/3/8, auth coverage, action-registry, control inventory, agent/chat, b04, b17-f): 522 passed after the two test-authoring defects were fixed (anonymous production request is 403 when the provider is unconfigured — asserted as "refused, no store read"; the in-memory repository hands out clones, so tampering is simulated through a repository double). tsc 0; eslint 0 new.
- Artifact: `artifacts/ai-control-plane-b18/permission-tiers.md`. UI control for the mode: B18-D. Grant minting and the proof of "exact user request": B18-B/C.
- CI at `4f2bd63` (2026-09-10 local): `deterministic-manufacturing` run 34438061993 — `prompt-to-gerber` success (the pinned tripwires incl. the 155-route ratchet), `page-browser-e2e` success, `database-delivery` success; `benchmark-quality` run 34438061942 success. Ledger push `4f908a2`: benchmark-quality success. Process gap closed in the next commit: the four B18-A suites were not yet in the CI `prompt-to-gerber` list (they had run locally only) — added.
- CI at `864a4e1` (the first run executing the four B18-A suites in CI): `deterministic-manufacturing` run 34438381892 — `prompt-to-gerber` success, `page-browser-e2e` success, `database-delivery` success; `benchmark-quality` run 34438381899 success. `4f908a2` deterministic-manufacturing run 34438151180 success as well.

### B18-B server-minted execution grants (CONFIRMED, 2026-09-10 local, solo; commits `048b792`, `0a24e6d`, `aa40756`, `041939e`, `08514ac`, `d33b255`, `ada258d`)

- Design: a 10-agent workflow (three independent designs × two adversarial lenses, one synthesis) → the contract draft (scratch) and decisions D18-2…D18-12; implementation sequential on the single tree in eight increments, each type-checked, tested, linted, secret-scanned, committed (Dandi Desta, no AI trailers) and pushed; CI green on every push watched for `041939e`, `08514ac`, `d33b255`; **`ada258d` and `81021bf` FAILED** (see the next entry — a real gate, fixed, not a flake).
- Contract (`app/lib/engineering/execution-grant.ts`): the grant record with its binding (principal + membership revision + role + session identity, scope + board instance, editor/lineage/run, provider/call/tool/registry/prompt, family/Tier 1/capability/decision/autonomy snapshot, exact targets, base incl. sealed validation policy, operations INSIDE the digest-covered binding + preview + expected PCB revision after, instruction digest/excerpt + explicit-request proof, issue/expiry/TTL); digests (operations ignore minted ids; identity ignores nonce + session; grant digest over nonce + binding); public projection without nonce/session; monotonic state machine with 23 retirement reasons, lazy expiry, late committed settlement; exact parser + coherence check.
- Explicit-request proof (`explicit-request.ts`): the `pcb.move-footprint` grammar v1.0.0 derives the operations from the WHOLE instruction against the verified board through the shared builder (`execution-operations.ts`: compileEdits + compilePcbBoardDelta, deterministic ids, preview, targets, result revision) and proves only byte-equal digests; 20+ negative phrasings unproven.
- Store (`app/lib/execution-grant/store.ts`): durable-workflow aggregates per grant + per-(principal, editor) index (live set, bounded recent with status + outcome for the retry guard); mint = one commit with supersession; CAS transitions with idempotent replays; digest-verified loads; one outbox audit event per transition without nonce/operations; injectable resolver (D18-1: no migration).
- Seal / mint / consume / settle (`app/lib/agent/execution-intents.ts`, `app/lib/execution-grant/{mint,consume,settle}.ts`): the pure seal (data only; authority-shaped arguments refused by name); the only minter as a `/api/chat` closure (proof → B18-A decision → retry guard (committed or in-flight identical instructions only) → one durable mint; retireIssued; awaitSettlement from the store only); consumption with the ordered §4.2 checks (zero writes for forged handles; exact burn reasons incl. membership via the B14 evaluator; success = one issued→consumed commit); settlement bound to attempt + commitment with the late truthful commit.
- Routes (`app/api/agent/execution-grant/route.ts`, `settle/route.ts`): canonical wrappers, closed grammars (authority-shaped and undeclared keys refused by name), policy rows `TIER1_EXECUTE`, classification durable read-write, action record `agent.execution-grant`, the ratchet 155/152 → **158/155 (3 factories, 0 raw)**, artifacts regenerated (20 rows); `/api/chat` classification read-write (OD-12).
- Agent wire (`contracts.ts`, `trace.ts` + `execution_grant`, `gateway.ts` seam, `loop.ts`, `route.ts`): the `execution-grant` outcome, `execution_grant_ready` / `execution_settled` events, single-flight both ways, awaited durable settlement bounded by budget + deadline + run boundary, truthful model answers, `run_unsettled` / `run_cancelled` retirement, the minter built only in the chat root for a human session principal; grant-shaped body keys refused by name.
- Browser half (`agent-execution-journal(-idb).ts`, `granted-executions.ts`, `execution-grant-client.ts`, `execution-grant-events.ts`, `granted-execution-controller.internal.ts`, `GrantedExecutionDialog.tsx`, `PcbEditor.tsx`, `page.tsx`): the durable journal (CAS, closed keys, commitment recomputed on read, bounded), the ritual in the B15.3 order re-derived for grants (never importing the B15.3 apply service), the transport, the SAFE receivers, the controller (Confirm click / explicit / cancel / recovery sweep), the confirmation dialog, the editor intake with the precise live disable reason, the once-per-grant explicit run, lifecycle retirement and the hydration sweep, the page's event cases.
- Tests (all in the CI prompt-to-gerber list): `b18-b-execution-grant` 4, `b18-b-explicit-request` 4, `b18-b-store` 5, `b18-b-mint-consume-decisions` 7, `b18-b-execution-grant-route` 6, `b18-b-loop-execution` 6, `b18-b-chat-authority-keys` 1, `b18-b-granted-executions` 7 (REAL composition: createHistory + bindCanonicalEditorSession with a durable in-memory store + interlock + journal + a transport double over the real server services), `b18-b-import-gates` 7 (exact importer sets + negative tripwires + the dialog's claims). Pinned suites re-run green after every increment: b16-1b/1c ratchet, b16-0-1/0-2/0-3/0-4/0-7 gates, b14-4, auth coverage, action registry, control inventory, B09/B11/B15/B17 loop/trace/replay/route suites (177 + 64 + 35 + 95). tsc 0; eslint 0 new (the pre-existing page.tsx 14 / PcbEditor 1 untouched).
- Defects found and fixed while proving (RECORDED R18-3): the journal's re-seal hashed the stale checksum into the body (every transition failed validation); the retry guard counted a `not-committed` settlement as an execution (a retry after a refused commit was forced to preview). Both fixed in `ada258d` with the tests that exposed them.
- Process record (RECORDED R18-2): the staged-content secret scan produced a false positive on `private key(` (a `private` class method named `key`) during the `ada258d` push; the chain echoed the hit without aborting. No credential material; the scan now uses the PEM marker and aborts on a hit.
- Owner decisions opened: OD-11 (grammar coverage), OD-12 (`/api/chat` policy row vs. durable grant minting), OD-13 (via/dimension tiering), OD-14 (undo/redo as an executed family — B18-C sub-design).
- Artifact: `artifacts/ai-control-plane-b18/execution-grant-contract.md`. Next: adversarial review of the two halves (workflow), then B18-C — the gateway dispatch branch (seal → mint through the closure), the B04 exposure lift for `pcb.move-footprint`, the discovery recheck, the prompt rewrite (1.1.0), the undo/redo sub-design.

### B18-B CI failure at `ada258d` / `81021bf` (CONFIRMED, 2026-09-10 local, solo)

- `deterministic-manufacturing` run 34445705241 — `prompt-to-gerber` FAILED (`page-browser-e2e`, `database-delivery` success); `benchmark-quality` run 34445705245 FAILED. One test in both: `b17-a-control-inventory` gate 1 — the new `GrantedExecutionDialog.tsx` introduced three UI controls (the dialog dismiss, "Cancel — change nothing", the Confirm button) that matched no control rule. A real gate doing its job (every scanned control must map to exactly one rule and a registry record), not a flake; it had not been in the pinned set I re-ran locally for B7.
- Fix: `app/lib/engineering/control-registry.ts` — the dialog joins the `view.pcb-chrome` surface (dismiss / cancel are view controls) and the semantic rule `agent.execution-grant-confirm` (`onConfirm` → record `agent.execution-grant`); `ui-control-inventory.csv` + summary regenerated (`generate-b17-control-inventory.ts`); `b17-a-control-inventory` 6/6 and `action-registry` green locally. The control inventory gate joins the local pre-push set for every UI change from here on.

### B18-B adversarial review and fixes (CONFIRMED, 2026-09-10 local; commits `f37b43d`, this commit)

- Review: a 15-agent workflow (six lenses — server authority, unforgeability, browser ritual/journal/recovery, loop truthfulness, test adequacy, UI wiring — then one refuter per finding, capped at nine): 30 raw findings, 25 unique; 7 confirmed (5 distinct: a `poisoned` settlement reported as "nothing changed" [blocking]; an expired grant consumable when the lazy-expiry write loses its compare-and-set; the editor scoping the journal by the DERIVED board id while the ritual writes the lineage root (dead ritual after a board derivation); a committed execution whose settle exchange failed never re-settled; the sweep poisoning without sending the poisoned report), 2 refuted (the retry guard on `consumed_unsettled`; "the confirmation is a body-asserted approval" — the confirmation is the human's click on the page the server bound to the preview digest; the server never trusts a click, it trusts the digest + session binding). The 16 unverified findings were read by hand: 13 fixed, 3 recorded (R18-6/7/8).
- Fixes (server + loop, `f37b43d`): `execution_poisoned` answer; the forgery checks on the raw head (`store.peek`) so forged handles write nothing, not even the lazy expiry; consume's own expiry gate; the lazy expiry retried once on a lost CAS; a burn that loses its CAS answers from the head; the overdue consumed grant retired before a late report; any truthful late report accepted; a replayed mint answers with the first grant; the finally-path retirement not gated on a consumed outcome; the route test pins `membership_changed`.
- Fixes (browser, this commit): journal terminal state `settled` + `markSettled`, finalized entries stay in the sweep until the server holds the report; the sweep re-settles from the receipt (late when the window elapsed) and reports `poisoned` whenever it poisons; adoption failures typed (a journal write failure never poisons a proven commit); a lost tender ANSWER keeps the prepared entry; explicit grants refused before the consume are cancelled durably (preview grants left for the human); the editor scopes the journal by the lineage ROOT board id, settles by grant id (a later grant is never cleared by an earlier one), cancels durably on a lifecycle change or a failed explicit pre-check, and words the toast by whether the board changed; the page answers `poisoned` truthfully and shows an explicit grant as running until settled.
- Tests: `b18-b-granted-executions` 9/9 (+ settle-failed re-settlement incl. late; poisoned sweep report; lost tender answer; explicit pre-consume cancellation vs. preview), `b18-b-store` 6/6, `b18-b-mint-consume-decisions` 8/8, `b18-b-loop-execution` 6/6 (+ poisoned row, boundary-discarded mint retirement), `b18-b-execution-grant` 4/4, route 6/6, import gates 7/7, control inventory 6/6. tsc 0; eslint 0 new.
- CI at `302fa60` (the control-inventory fix): `deterministic-manufacturing` run 34446162335 success; `benchmark-quality` run 34446162340 success. CI at `f37b43d` (server/loop fixes): both workflows success. CI at `486d0ac` (browser fixes): `deterministic-manufacturing` run 34448709253 success; `benchmark-quality` run 34448709287 success — every B18-B suite (incl. the review regressions) ran in CI.

### B18-C design (CONFIRMED, 2026-09-10 local, solo)

- A 10-agent design workflow against `e25ccad` (three independent designs × two adversarial lenses — authority/unforgeability and truthfulness/test adequacy — then one synthesis). The synthesized contract is committed as `artifacts/ai-control-plane-b18/safe-mutation-contract.md`: the honest boundary per family (move / rotate-flip / undo-redo executed with explicit grammars; arrange / silkscreen text / dimension executed confirmation-only; dimension needs an owner-gated re-tier; via diameter/drill stays Tier 2 with a padstack-bound refusal; track Tier 2; schematic execution deferred), the one reviewed list, the gateway dispatch, the per-family builders, the model-facing result contract, the undo/redo sub-design, the pinned tests that move (re-derived, never a count bumped) and ten ordered increments.

### B18-C I1 vocabulary and gates (CONFIRMED, 2026-09-11 local, solo; commit `928160b`)

- `granted-execution-families.ts` (THE reviewed list — empty — the never-granted command ids and `grantedExecutionViolations`, from which every gate derives); `ToolDescriptor.executionMode` / `grantOnly`; the B04 validator keeps its error text with the single derived exception; `isAgentExposableDescriptor` + `grantedExecutionReport`; discovery `grantableCapabilities` / `grantLineageId` / `grant_only`; context assembly derives grantability from server facts only (minter bound + Tier 1 execute role + verified board + PCB basis) while the actor keeps `read_project`; gateway integrity refuses every tampered combination; 19 pinned suites re-derived from the exposure predicate instead of a class list.
- Tests: 37 suites / 487 tests green; eslint 0; tsc 0; registry digest `eng1-32df22be92bc24c7` unchanged; the B04 and B09 artifact generators produce no drift.
- CI at `928160b`: `deterministic-manufacturing` run 34556319253 success; `benchmark-quality` run 34556319262 success.

### B18-C I2 dispatch, loop and route plumbing — still nothing exposed (CONFIRMED, 2026-09-11 local, solo; this commit)

- The registry carries the reviewed list it was validated against (`ToolRegistry.grantedExecutionTools()`, amendment A1); the run toolset and the gateway derive from it.
- `app/lib/agent/execution-dispatch.ts` + the gateway `mutate` branch, refusing in order: not a reviewed granted execution ⇒ `not_callable` (the pre-B18-C wording for an unexposed mutation); no minter or prompt version ⇒ `execution_unavailable`; no call id ⇒ `invalid_input`; fresh discovery recheck ⇒ `not_discoverable (<reason>)`; role outside the descriptor's roles or Tier 1's execute roles ⇒ `unauthorized`; the seal's refusals 1:1; an underivable base ⇒ `authority_unavailable`; then the mint through the composition root's closure (a throwing minter ⇒ `grant_unavailable`, detail redacted). The actor's capabilities are never consulted (the capability is the grant's). Destructive/release keep the `not_callable` catch-all.
- `buildExecutionGrantBase` (verified board revision + `executionBoardDigest`, basis head + lineage, registry-resolved validation policy) and `mintablePlanOf` (the minter never receives the parsed plan or the edit commands). `executionBoardDigest` is the ONE board-fingerprint formula (the B18-B fixture's).
- Loop: a `mutate` tool is advertised only with a minter + verified board + PCB basis (a tampered flag cannot smuggle it in — truthful warning); the provider call id reaches the gateway; R18-7 closed (A3).
- `/api/chat`: one `minterAuthority` fact binds the minter and feeds both context assemblies; the gateway receives `promptVersion`. No new route: the ratchet stays 158 = 155 canonical + 3 factories + 0 raw.
- Tests: `b18-c-gateway-dispatch` 8/8 (real minter over the in-memory grant store: preview under proposal_only with the derived base and pinned origin; explicit for the exact request; one grant per run + call; twelve exact refusals with zero mints; minter refusal 1:1; throwing minter redacted; production registry — every mutation/destructive/release tool `not_callable` with a minter bound; loop toolset rule; call id on the durable grant; an untendered explicit grant retired `run_unsettled` and mirrored in the trace), `b18-c-chat-execution-availability` 3/3 (the same closure reaches gateway and loop; no basis ⇒ minter bound, context not grantable; unreadable autonomy ⇒ nothing bound, proposal-only warning). Broad run: 125 files / 1475 tests green (agent, chat, agent routes, execution-grant, engineering, project, the ratchet pins, auth composition, recovery pipeline); all ten artifact generators produce no drift (registry digest eng1-32df22be92bc24c7; 158 = 155 + 3 + 0). eslint 0; tsc 0.
- Finding (A2): a non-grantable run excludes a granted execution as `capability_missing` (the contract guessed `approval_unavailable`); pinned as observed.
- CI at `0ee63e2`: `deterministic-manufacturing` run 34557422542 success; `benchmark-quality` run 34557422565 success.

### B18-C I3 the exposure lift: `sirkit.pcb.move-footprint` (CONFIRMED, 2026-09-11 local, solo; this commit)

- The model's mutation reach widens for the first time, by ONE reviewed row (`granted-execution-families.ts`, with its reason) and its intentional-exposure entry; `move-footprint` leaves the never-exposed mutation pattern. Every other mutation, destructive and release tool stays unexposed and `not_callable` with or without a minter (pinned over the whole registry).
- Descriptor `sirkit.pcb.move-footprint@1.1.0`: `agentExposed`, `executionMode: "granted"`, `requiredSelectionKinds: []` (named targets), an integer-nanometre schema with model-facing descriptions, binding notes naming the grant path (A5).
- Discovery tightened (A4): on the agent channel a granted execution is satisfied only by the grantable set and the grant lineage.
- System prompt 1.1.0 (A6): reads/views run directly; execution tools never change the board by themselves (preview to confirm, or the exact requested operation); `executed` is the only claim of change; `execution_poisoned` is never "nothing changed"; no authority-shaped arguments.
- Artifacts regenerated: B04 (registry digest `eng1-87917291e00ec9c8`, 23 exposed), B09 manifest (the generator now describes a granted execution truthfully — resources `canonical-state;pcb-proposal-basis;execution-grant-minter`, availability conditional), B11 (all nineteen pins moved with the prompt/registry digests; 19/19 cases, 59/59 checks). B01, B16 and B17 artifacts unchanged; ratchet 158 = 155 + 3 + 0.
- Pins re-derived from the reviewed list, never a count: `b04` (invariant subject → edit-track with the granted-shape negatives; selection subject → edit-track; #21 exposure ⇔ reviewed row, grant-context-only agent discovery; the tripwire's mutate branch), `b17-f` (granted side effects / Tier 1; never-exposed list; B17-F additions exclude granted ids; mutation subject → edit-track), `b09-proposals` #34, the I1 and I2 suites; the seven stale "EXACTLY 12" titles retitled (A7).
- New suites: `b18-c-exposure-lift` 4/4; `b18-c-gateway-execution` 4/4 (production registry: explicit for the exact request pinned to the registry digest, descriptor 1.1.0 and prompt 1.1.0; preview under proposal_only; `execution_unavailable` / `not_discoverable (capability_missing)` / `not_discoverable (role_not_permitted)`; every other risky tool `not_callable` with and without a minter; a move instruction arriving in TOOL OUTPUT is only ever previewed — the proof reads only the user's own message); `b18-c-loop-real-gateway` 3/3 (scripted loop → real gateway → real minter → the page's SAFE receiver → the real ritual over a real canonical editor session: `executed` from the settled record with the ritual's own transaction and revision, one history entry, actor ai; a second call `execution_exists`; preview then the human's Confirm commits exactly the previewed move). The run context is assembled from the LIVE board after a JSON round trip, so the verified board and the live board agree on the revision (CONFIRMED — no stale-revision refusal).
- Tests: targeted 56 files / 639 passed (9 skipped = the pre-existing live Supabase matrix, BLOCKED-LIVE-QUALIFICATION); broad run: 189 files / 2953 passed, 9 skipped (the live Supabase matrix) across agent, chat, agent routes, execution-grant, engineering, project, auth, api tripwires and the recovery pipeline. eslint 0; tsc 0.
- CI at `69ebb7b`: `deterministic-manufacturing` run 34558753693 success; `benchmark-quality` run 34558753698 success.

### B18-C adversarial review of I1–I3 and fixes (CONFIRMED, 2026-09-11 local, solo; this commit)

- Review: a 14-agent workflow over `e25ccad..69ebb7b` — five lenses (authority and unforgeability; explicit-request truthfulness; loop, prompt and description truthfulness; gate completeness and test adequacy; the real browser path), dedup, then refute-by-default verification of the top nine. 13 raw findings, 13 unique. Verified: 5 confirmed — **V0 high**: every correct granted move on a board with a copper zone was settled POISONED (the expected revision came from the editor mutator; the kernel re-marks zone fills dirty; the editor refills only its own board); V1 medium: the retry guard ignored a poisoned settlement, so a re-sent identical message re-executed without confirmation; V2 (medium → low): an ambiguous reference designator resolved to the first footprint; V4 medium: a commit that rejected after the consume was never settled or abandoned; V8 low: the discovery tightening had no isolating pin. 4 refuted (the chat re-assembly flag is covered; the retry guard's raw-byte digest; the trace mirror "counting two calls"; the B09 exclusion wording). The 4 unverified lows were read by hand and all fixed (U0 the never-granted command rule unpinned; U1 the never-exposed patterns enforced only in tests; U2 a pending grant crossing projects and cancelled under the wrong scope; U3 a transiently refused preview dropped from the page).
- Fixes: contract amendments A8–A13 (`artifacts/ai-control-plane-b18/safe-mutation-contract.md` §14) — the kernel-exact expected revision + the fill-normalized postcondition + the recompile's revision check (the digest moved to the pure `semantic-board-digest.ts`); the retry guard over every possible change with the retirement reason indexed; exactly-one-footprint references in the grammar; truthful settlement of a rejecting commit; the never-exposed patterns as a runtime key; page/editor grant hygiene.
- Regression suite `b18-c-review-fixes` (11) over a shared in-process harness (`__tests__/b18c-harness.ts`: the real loop, gateway, minter, consume/settle, the page's SAFE receiver and the ritual over a real canonical session; the harness emulates the editor's zone refill). Reproduction on the PRE-FIX engineering code (the fixed files stashed, the suite run, the files restored): 8 of the 11 regressions FAIL on the pre-fix code (V0 x3 — builder, end to end, refill race; V1; V2; V4 x2; U1) and all 11 pass on the fix; the 3 that pass pre-fix pin test gaps whose runtime was already correct (V8, U0) or page/editor source that was not stashed (U2/U3). Fixed: 11/11, and `b18-c-loop-real-gateway` 3/3.
- Lint: 0 new — `page.tsx` carries 14 and `PcbEditor.tsx` 1 pre-existing errors at HEAD with the identical rule breakdown (`react-hooks/refs` ×13, `set-state-in-effect` ×1; `purity` ×1). tsc 0.
- Tests: 190 files / 2964 passed, 9 skipped (the live Supabase matrix) across agent, chat, agent routes, execution-grant, engineering, project, auth, api tripwires and the recovery pipeline; all ten artifact generators produce no drift.
- CI at `e13c87c` (the review fixes): `deterministic-manufacturing` run 34564612210 success; `benchmark-quality` run 34564612218 success.

### B18-C I4 the model-facing result contract (CONFIRMED, 2026-09-11 local, solo; this commit)

- Settlement truth (A14): the ritual runs the editor's own DRC engine under the grant's preset on the committed board and settles `{ drc: { ran, violations: errors } }` (`ran: false` when it cannot run — never a fabricated count; dirty zone fills are evaluated after the editor refills them); undo eligibility is DERIVED from the live history instead of a constant `true`; recovery settlements carry `validations: null` and the eligibility derived at that moment.
- The loop's answers: `executed` = the server-bound intent + the settled truth (transaction, both revisions, head, change set, validations with an attestation, undo with how); the preview = the same intent + expiry + `confirmationRequired`; every refusal names what was NOT applied. The `execution_settled` event carries the durable settlement summary; the page's SAFE receiver parses it (bounded) and the activity line prints the DRC result and undo eligibility.
- Pins re-derived: `b18-b-loop-execution` and `b18-c-loop-real-gateway` (the executed payload's undo/DRC keys moved under `undo` / `validations`). New `b18-c-result-contract` 7/7: the exact executed and preview key sets and values over the real stack on a zone-bearing board (the DRC count equals an independent run of the editor engine on the committed board; the durable record holds exactly what the model was told); a refusal's `intended` with a summary claiming no transaction, DRC or undo; derived undo — a settle lost twice, a later HUMAN commit, then the recovery sweep settles committed with `undoEligible: false` and `validations: null`; an unresolvable preset reports `ran: false`; the SAFE receiver drops malformed or oversized summaries without dropping the event.
- Tests: targeted 25 files / 223 passed; broad run: 191 files / 2970 passed, 9 skipped (the live Supabase matrix) across agent, chat, agent routes, execution-grant, engineering, project, auth, api tripwires and the recovery pipeline; all ten artifact generators produce no drift. eslint 0 new; tsc 0.
- CI at `5920a70` (I4): `deterministic-manufacturing` run 34566458409 success; `benchmark-quality` run 34566458488 success.

### B18-C I5 rotate/flip and arrange (CONFIRMED, 2026-09-11 local, solo; this commit)

- Two more reviewed rows (`sirkit.pcb.rotate-side-footprint`, `sirkit.pcb.arrange`) with their reasons and intentional-exposure entries; both leave the never-exposed mutation pattern (still listed: edit-track, delete-item, create-via, zone-edit, dimension). Descriptors 1.1.0 (`agentExposed`, `executionMode: "granted"`, no selection gate, model-facing descriptions, nullable optionals declared so the strict wire form can carry `null` — R18-9).
- Builders, the one inverse, the argument contracts and grammar 1.1.0 as recorded in amendment A15; the ritual recompiles every family through `planFromOperations`.
- Pins re-derived: `b04` #9 (the arrange-under-a-track-selection negative → delete-item and edit-track stay excluded under a footprint-only selection), `b18-c-exposure-lift` (rotate and arrange left the unexposed list), `b18-c-review-fixes` U1 (the pattern key is proven with a reviewed-shaped descriptor under the still-listed dimension id), `b18-c-gateway-dispatch` (the risky list; the injected test registry carries every other reviewed row), `b18-b-explicit-request` (the grammar version from the constant; the plan union narrowed).
- New suites: `b18-c-builders` 5/5 (rotation-only / side-only / both and align / centre / distribute / snap byte-identical from the plan and from the inverse; kernel kinds; the position untouched; every refusal), `b18-c-explicit-grammars` 6/6 (both rotation directions pinned against the editor's own rotate command; any angle 1–359; flip; the negative set; ambiguous and locked references; arrange without a grammar; families never cross), `b18-c-rotate-arrange-e2e` 4/4 (explicit rotate and flip end to end with ONE transaction; a rotation that differs from the sentence previewed; arrange previewed even under execute_explicit_tier1 and committed exactly by the human's Confirm).
- Artifacts: registry digest `eng1-628b44504f9368e3` (25 exposed); B09 manifest, B11 pins regenerated (19/19 cases, 59/59 checks).
- Tests: targeted 20 files / 170+ passed; broad run: 194 files / 2984 passed, 9 skipped (the live Supabase matrix) across agent, chat, agent routes, execution-grant, engineering, project, auth, api tripwires and the recovery pipeline; all ten artifact generators reproduce the committed I5 artifacts. eslint 0 new; tsc 0.
- CI at `916c8b7` (I5): `deterministic-manufacturing` run 34568302253 success; `benchmark-quality` run 34568302201 success.

### B18-C I6 silkscreen text (CONFIRMED, 2026-09-11 local, solo; this commit)

- A new reviewed row and descriptor `sirkit.pcb.silkscreen-text@1.0.0` (exposed, `executionMode: "granted"`, Tier 1 reversible / `edit_placement`, no selection gate, confirmation-only), built as recorded in amendment A16; the shared builder tail now takes a candidate board and each family's own kinds and target kinds.
- A first local run found the silk preview in the model's edit order while a pinned recompile replays the canonical delta order (a preview-digest mismatch on "add + update"); the preview is now read off the canonical operations, so both paths describe the identical change by construction.
- Pin re-derived: `b04` coverage (`pcb.silkscreen-text` left the unreferenced mutation-capable commands; every reviewed family is referenced).
- New `b18-c-silk-text` (builds byte-identical from the edits and from the inverse; silk kinds only; the preview; deterministic ids across base revisions and indexes, the silk tool's derived fields; every refusal including a pinned add squatting an existing id and a non-text silk item; the per-op argument contract with defaults and nulls; end to end — previewed even under execute_explicit_tier1, the human's Confirm commits ONE transaction carrying the deterministic id).
- Artifacts: registry digest `eng1-475b2f39ee0a88da` (36 descriptors, 26 exposed); B09 manifest and B11 pins regenerated (19/19 cases, 59/59 checks).
- Tests: targeted 20 files / 167 passed; broad run: 195 files / 2989 passed, 9 skipped (the live Supabase matrix) across agent, chat, agent routes, execution-grant, engineering, project, auth, api tripwires and the recovery pipeline; all ten artifact generators reproduce the committed I6 artifacts. eslint 0; tsc 0.
- Next: ONE adversarial review of I4–I6 before I7.
- CI at `b350c5a` (I6): `deterministic-manufacturing` run 34568957873 success; `benchmark-quality` run 34568957970 success.

### B18-C I7 dimension annotations after the OD-13 re-tier (CONFIRMED, 2026-09-11 local, solo; this commit)

- The I4–I6 adversarial review runs in parallel in isolated worktrees (read-only over `69ebb7b..b350c5a`); its fixes are the next commit.
- The runbook's PCB Tier 1 list names add/update/remove dimensions, so the owner gate the design put on this increment (contract §5) is met by the runbook: `pcb.dimension` is re-tiered `reversible` on the action record (`toolExposure: preview-apply`) and on the descriptor; `sirkit.pcb.dimension@1.2.0` is bound to `CanonicalEditorSession.commit`, exposed, `executionMode: "granted"`, confirmation-only; a reviewed row; the never-exposed pattern no longer lists it (A17).
- ONE pure module for the editor and the agent: `app/lib/pcb/dimensions/commands.ts` (`newBoardDimension` with the dimension tool's defaults, `mutateBoardWithDimensionCommand`). `useDimensionTool` and `DimensionInspector` now build their candidates through it (behaviour unchanged; the B17 control inventory regenerates identically).
- Builder: deterministic `dim-ai-` ids; an update is the inspector's fields only; refusals at the seal (the kernel's `validateBoardDimension`, a zero offset on add, a plan-set label under 0.1 mm, a pinned replace moving the points, an id collision); a no-op update is not a target; the pinned inverse rebuilds items from their known fields.
- Divergence recorded (OD-13): via diameter/drill, copper track segment edits and board `texts[]` stay as contract §5 decided (Tier 2 proposal-only / not covered).
- Found (A18, CONFIRMED by reading `app/lib/pcb/ai/snapshot.ts`): board-inspect lists no silk items or dimensions. The dimension descriptor names selection-inspect and executed results as the id sources; the silkscreen-text descriptor's board-inspect claim is corrected with the I4–I6 review fixes.
- Pins moved, each keeping its negative: `b18-a` (dimension Tier 1 on descriptor and record; create-via, edit-track and zone-edit stay Tier 2), `b04` #24 (bound, callable, exposed-granted; absent without the grant context and on automation), `b18-c-exposure-lift` (the still-unexposed list now names create-via and zone-edit), `b18-c-review-fixes` U1 (the pattern-only subject is zone-edit), `b18-b-execution-grant` (`EXECUTION_FAMILIES` += `pcb.dimension`).
- New `b18-c-dimension` 8/8: byte-identical builds from the edits and from the inverse (add, update, remove, all three together); dimension kinds only; the previews; deterministic ids that equal the tool's constructor output but for the id; update truth (points never move, a no-op is no target, a human's small label kept); every refusal; the per-op argument contract; the re-tier and gates (vias and tracks stay Tier 2; the schema's enums are the model's vocabulary); source pins that the tool and the inspector use the shared commands; end to end confirmation-only under `execute_explicit_tier1`, and the human's Confirm commits ONE transaction carrying the deterministic id.
- Artifacts: registry digest `eng1-4a8ac8b77b181624` (36 descriptors, 27 exposed); B01 matrix, B04, B09 manifest and B11 pins regenerated (19/19 cases, 59/59 checks); B16 and B17 artifacts unchanged; ratchet 158 = 155 + 3 + 0.
- Tests: targeted 45 files / 471 passed; broad run: first run Test Files 4 failed | 192 passed (196),  (the 9 skips are the live Supabase matrix); the only failures were the four AST import-gate suites (b16-0-1-ci-gates, b14-4-ast-import-gates, b14-5-lexical-require-and-diagnostics, b15-3-import-gates), and every unexpected importer they listed was a path under .claude/worktrees/wf_61c16992-3b1-5/ (a review agent's worktree at 804a08d inside the repository); with the worktrees removed the four suites pass (4/4 files). eslint 0; tsc 0.
- CI at `ded7fbd` (I7): `deterministic-manufacturing` run 34571955187 success; `benchmark-quality` run 34571955186 success.

### B18-C adversarial review of I4–I6 and fixes (CONFIRMED, 2026-09-11 local, solo; this commit)

- The review: workflow `wf_61c16992-3b1`, five lenses over `69ebb7b..b350c5a` (result contract, rotate/flip, arrange, silk, gates and tests); 16 raw findings (the gates lens's first attempt returned nothing and its retry returned five). The verify stage was STOPPED: its nine worktrees were created at `804a08d` (main) inside the repository under `.claude/worktrees/`, so they could not see B18-C, and their files broke the AST import gates' filesystem scan (the I7 broad run's only failures). Each item was verified here instead, by a regression that fails on the pre-fix code (new `b18-c-review-2`: all ten tests red before the fixes) or by a probe.
- R1 (high, CONFIRMED): a stroke-only silk update read the same before and after on the only confirmation surface. Fixed for every family: previews name every field an edit can change (silk stroke and non-default mirror, rotation or anchor; dimension label height and stroke — the same gap found in I7's own dimension preview) and print exact nanometres (a sub-micron move no longer reads as no move); the shared tail refuses any change whose before and after read the same.
- R2 (high, CONFIRMED by probe, mechanism refined): the settlement DRC ran on the kernel's emptied zone fills. A partial pour on the pads' net: the editor's refilled board shows 2 errors, the kernel's emptied board 1 (the zone net is `unknown` to the connectivity check, so its incomplete-net error is skipped); a full pour and a pour on the no-net entry count the same. The harness's zone sits on the no-net entry, which is why the I4 test could not see it. Fixed: the count is taken on the board the editor holds once its refill lands (`refillZoneFillsAtomically`, the same pure refill its zone-fill hook runs).
- R3 (medium, CONFIRMED, found by three lenses): a multi-target move / rotate / arrange listed out of board order could never be confirmed — the seal previewed in plan order, the recompile in operation order. Plans now run in board order.
- R4 (medium, CONFIRMED): a no-op silk update beside a real one stayed a target, so every Confirm failed the recompile. Found while fixing: `buildPositions` did the same for a move to where a footprint already is. A no-op edit is no target in both.
- R5 (medium, CONFIRMED): silk text is quoted exactly in the preview (escaped quotes cannot forge a second item) and refuses leading or trailing spaces (the editor's silk tool trims; whitespace-only text passed).
- R6 (low, CONFIRMED): a pinned silk change is checked for content as the editor's tool would place it (unrotated, centred, mirrored only on the bottom, text and size rules) and as its set-text-props would edit it (only text, layer, height, stroke; the mirror follows the layer).
- R7 (medium, CONFIRMED against `select-move.ts` `flipSelection`): the flip grammar and a null-rotation side change kept the rotation, while the editor's own Flip turns the part over (rotation 360 − r), so a flip at 90° or 270° landed turned 180° from the editor's Flip — reversed polarity for a diode. Both follow the editor now (grammar 1.2.0, `sirkit.pcb.rotate-side-footprint@1.2.0`). Recorded: the editor's gesture also snaps the origin to its grid; a granted flip does not (it never moves what it was not asked to move).
- R8 (low, CONFIRMED): "Put R3 to the bottom" (no side or layer word) was proven as a flip; "put" needs the word.
- R9 (medium, CONFIRMED): undo eligibility was derived from a history the editor had retired (a board-lifecycle adoption); it now needs the live bound history (`historyBindingState` active), and the ritual's call site also requires the session still current.
- R10 (CONFIRMED, A18): `sirkit.pcb.silkscreen-text@1.0.1` names selection-inspect and executed results as its id sources.
- Test gaps (the gates lens): the fill-normalized postcondition's negative — a semantic change that lands with the commit IS poisoned (the reviewer's suspected false `executed` does not occur; pinned); V4's landed-then-rejected branch is poisoned (pinned); the retry guard's outcome-unknown branch and the late not-committed report that lifts it (pinned in `b18-b-store`); the B04 coverage report's positive pin restored beside the negative.
- Pins moved with the fixes: the silk add preview (+ the stroke), three dimension previews (+ label height and stroke), the grammar version pin, two flip titles (R3 at 0° stays 0° under 360 − r).
- Artifacts: registry digest `eng1-1f798b9546c82f16`; B04, B09 manifest and B11 pins regenerated (19/19 cases, 59/59 checks); B01, B16 and B17 unchanged; ratchet 158 = 155 + 3 + 0.
- Tests: targeted 42 files / 435 passed; broad run: 197 files / 3009 passed, 9 skipped (the live Supabase matrix) across agent, chat, agent routes, execution-grant, engineering, project, auth, api tripwires and the recovery pipeline; no review worktree was present. eslint 0; tsc 0.
- CI at `e77ea20`: `deterministic-manufacturing` run 34573338094 success; `benchmark-quality` run 34573338051 success.

### B18-C I8a undo/redo under a grant — the server half (CONFIRMED, 2026-09-11 local, solo; this commit)

- I8 is split so nothing half-built reaches the model: I8a lands the vocabulary, the grant shape, the seal and the server-side resolution; I8b lands the browser's `replayUnderGrant`, the ritual's replay branch, the grammar, the exposure, the prompt and the end-to-end proofs. No descriptor changes in I8a, so no registry artifact moved.
- The replay family `pcb.undo-redo-canonical` joins `EXECUTION_FAMILIES` (Tier 1 by derivation). A replay grant carries `proposal.replay` and no operations; `replayOperationsDigest` binds the reference and the expected revision; `parsePublicExecutionGrant`, `verifyPublicGrantCoherence` and the server consume are family-aware. The seal reads only `{ direction }` — the model never names a transaction.
- The minter resolves WHAT to replay from the principal's own settled grants at the verified head of the same lineage: undo = the latest committed AI change (never itself a replay); redo = the latest committed AI undo. Anything else refuses `nothing_to_replay` and mints nothing. The preview swaps the referenced grant's own before and after and carries the history note: an AI undo or redo is a NEW history entry, so the editor's own Undo afterwards re-applies the change (A20 records the departures from the §7 sketch).
- Found while landing it: the B18-B import gate pins the grant store's importers, so the resolver lives inside `mint.ts` rather than a new module (a new importer would have widened the approved set).
- Until I8b the browser refuses a replay grant at the recompile step, before the journal is touched (pinned; that pin moves with I8b).
- New `b18-c-replay-grants` 6/6: the vocabulary and digest sensitivity; the direction-only seal (a transaction id, a bad direction or an authority key refuses); the resolved undo (reference, no operations, the swapped preview, the transaction as the target, verifiable); the refusals (no AI change, no AI undo to redo, a later human commit); family-aware verification (operations smuggled into a replay grant, a missing or altered reference, a reference smuggled into a move grant); the browser's refusal until I8b. Pin moved: `b18-b-execution-grant` (`EXECUTION_FAMILIES` += the replay family).
- Tests: targeted 61 files / 617 passed (the first run's only failure was the import gate above, fixed by the move); broad run: 198 files / 3015 passed, 9 skipped (the live Supabase matrix) across agent, chat, agent routes, execution-grant, engineering, project, auth, api tripwires and the recovery pipeline. eslint 0; tsc 0.
- CI at `9e14ffe` (I8a): `deterministic-manufacturing` run 34574572800 success; `benchmark-quality` run 34574572775 success.

### B18-C I8b undo/redo under a grant — the browser half and the exposure (CONFIRMED, 2026-09-11 local, solo; this commit)

- `CanonicalEditorSession.replayUnderGrant` (canonical first; eligibility from the durable records; no rebase under a grant; one NEW applied history entry through the commit path's own publisher; a landed but unconfirmable result throws after persisting, so the evidence path poisons it), `isReplayEligible`, `replayResultVerified` (A21).
- The ritual's replay branch: an eligibility check instead of the recompile; the commit through `replayUnderGrant`; the postcondition is two different durable records agreeing; adoption (the ritual's and the recovery sweep's) compares the executor's forced provenance `<direction>:<referenced transaction>`, derived from the stored grant.
- Found by the first end-to-end run and fixed: the journal refused a replay entry (`invalid-entry` — its operation count rule assumed 1–16 operations); the rule is now family-aware.
- Grammar 1.3.0 ("undo" / "redo", optionally "that", "it" or "the last change"; the proof needs the server-resolved reference); `sirkit.pcb.undo-redo-granted@1.0.0` (grant-only, Tier 1 by derivation) with a reviewed row and its intentional-exposure entry; the never-exposed pattern names the internal replay primitive exactly; the internal descriptor's binding note records the B03.2 amendment; prompt 1.2.0; the loop's undo wording is family-aware. OD-14 resolved (the `ui` provenance source recorded as a B03.1 deviation).
- New `b18-c-undo-redo` 8/8: the grammar and the proof; "Undo that." after an explicit AI move (proven, one new applied entry with actor ai, R3 back, `executed` from the settled record); "Redo." re-applies it; undoing the AI redo refuses `nothing_to_replay` and mints nothing; the user's own Undo after the AI undo re-applies the change, reconciled canonically (never rebased); a non-explicit ask is previewed with the history note and the human's Confirm commits it; a human change after the preview makes the Confirm refuse with nothing changed; a board with a copper zone (never poisoned); a lost journal write adopted by recovery through the provenance link; the session refuses an off-head replay with zero mutation and no rebase; the gates.
- Pins moved: the prompt version (`b18-c-gateway-execution`), the grammar version, the I8a decision pin (a whole-message "Undo that." is now proven), the grant-only pin (`b18-c-granted-execution-gates`: exactly on the reviewed replay row), `b04` #22 extended (the granted replay is absent from interactive-ui / api / automation and present on the agent channel only with the grant context); the I8a "browser refuses" pin moved into the new suite.
- Artifacts: registry digest `eng1-d990af2540b0fb24`; B04, B09 manifest and B11 pins regenerated (19/19 cases, 59/59 checks, prompt 1.2.0); B01, B16 and B17 unchanged; ratchet 158 = 155 + 3 + 0.
- Tests: targeted 64 files / 654 passed; broad run: 199 files / 3022 passed, 9 skipped (the live Supabase matrix) across agent, chat, agent routes, execution-grant, engineering, project, auth, api tripwires and the recovery pipeline. eslint 0; tsc 0.
- CI at `0d75bbe` (I8b): `deterministic-manufacturing` run 34575460485 success; `benchmark-quality` run 34575460457 success.

### B18-C I9 Tier-2 truth and hardening (CONFIRMED, 2026-09-11 local, solo; this commit)

- An adversarial review of I8 runs in parallel (read-only agents reading the committed range `e77ea20..0d75bbe` through `git show`, no worktrees); its fixes are a separate commit.
- The via proposal path is truthful: `padstack-bound` in the B15.3 bounded compiler — a size/drill change on a padstack-bound via without a padstack is refused, naming the padstack and the fork path; retargeting onto an existing padstack still compiles; a legacy via is still updatable; moving a bound via is unaffected. Reproduced first: the change compiled `ok` on the pre-fix code.
- New `b18-c-tier2-truth` 3/3 (the refusal for size, drill and both; the retarget, the legacy via and the move; no via or copper-track command is an execution family, each is never-granted, their tools stay unexposed).
- New `b18-c-never-execution-sweep` 3/3 (scenario 8): every mutate / destructive / release descriptor outside the reviewed list and everything in a Tier 3 family, through the real gateway with and without a minter, never yields an execution grant and never calls the minter; nothing else can be a granted execution; a reviewed execution forced to Tier 2 is refused by the seal; a renamed tool over each never-granted command is refused by the command rule and by the seal; nested delegation (another tool, an approval, a grant, a follow-up call, a smuggled field) is refused as invalid and mints nothing.
- New `b18-c-adversarial` 3/3 (scenario 7): a change outside the semantic revision between the mint and the Confirm is refused by the head check (A22: the planned whole-board digest check is redundant with the head and revision checks and was not added); a forged grant is dropped by the page's SAFE receiver and refused by the ritual before anything durable; every B18-C family resolves its targets by name, and a differing live selection changes nothing.
- No descriptor, prompt or registry change: no artifact moved.
- Tests: targeted 37 files / 314 passed; broad run (now also covering the B15 proposal suites): 209 files / 3147 passed, 9 skipped (the live Supabase matrix) across agent, chat, agent routes, execution-grant, engineering, project, auth, api tripwires, the B15 proposal suites and the recovery pipeline. eslint 0; tsc 0.
- CI at `d33db58` (I9): `deterministic-manufacturing` run 34576422214 success; `benchmark-quality` run 34576421901 success.

### B18-C I10a the browser harness's scripted agent (CONFIRMED, 2026-09-11 local, solo; this commit)

- I10 is split: I10a lands the scripted agent and its gate; I10b lands `e2e/agent-execution.spec.ts`, the closing record `safe-mutation-tools.md` and the owner-decision updates.
- `FixtureAgentAdapter`: "Move <REF> <n> mm …" and "Flip <REF> to the …" read the target from `sirkit.selection.inspect` (the user's selection) and then call the execution tool; "Add silkscreen text <TEXT> at <x>, <y>." and "Undo that." / "Redo." call their tools directly; anything else is a plain reply. It reads only what a model would (the message, the advertised tools, the tool results) and refuses in words a target it cannot see.
- The gate: `agentAdapterFor` returns it only under the fixture runtime AND `SIRKIT_FIXTURE_AGENT=scripted`; never in production (pinned with the environment flipped), never without the opt-in; a source scan pins `adapters.ts` as its only constructor. Playwright's web server opts in.
- Design choices recorded (A23): the script is keyed by the instruction (one server serves every spec), and the target comes from the selection (board-inspect's snapshot of a synchronized board is not bounded below the 60 000-character result budget), so the browser's rotate/flip proof is a flip.
- The harness: `runWith` shared by `runScenario` (the scripted FakeAdapter) and the new `runWithAdapter`; a run may carry a selection (`runContext(c, selection)`). Every existing harness suite passes unchanged (26 files / 144 tests before the new suite was counted).
- New `b18-c-fixture-agent` 4/4: the gate (six environment states including production); the source scan; the script (move → selection.inspect → the absolute move; flip; silk; undo / redo; an unselected target refused; an unadvertised tool refused in words); end to end through the real loop — "Move R3 2 mm to the right." with R3 selected under execute_explicit_tier1 mints an explicit grant and commits ONE transaction.
- Found while wiring it: the adapter's methods first declared narrower inputs than `ProviderAgentAdapter`; they now use the interface's own parameter types.
- CI: the deterministic-manufacturing vitest list gains every B18-C suite (none were listed; the B18-A/B suites were).
- Tests: broad run: 211 files / 3162 passed, 9 skipped (the live Supabase matrix) across agent, chat, agent routes, execution-grant, engineering, project, auth, api tripwires, the B15 proposal suites, the fixture runtime and the recovery pipeline. eslint 0; tsc 0.
- CI at `88c6875` (I10a): `deterministic-manufacturing` run 34577331711 success; `benchmark-quality` run 34577331705 success. (Found in review 3: `b18-c-fixture-agent` itself was not in the CI list at `88c6875`, so this line's "every B18-C suite" was not yet true; fixed in review 3.)

### B18-C review 3 — the fixes from the I8 adversarial review (CONFIRMED, 2026-09-11 local, solo; this commit)

- The review: a workflow over `0d75bbe` (I8a/I8b), each finding adversarially verified — eight confirmed, one refuted (A24 records every verdict).
- Reproduced first: the new `b18-c-review-3` suite and `b18-c-granted-execution-dialog` ran on the pre-fix code — seven behavioural cases failed (the redo wording ×2, the grammar, the undo preview of an add, the Ctrl+Z during the envelope write, the recovered revision, the card); the three pins passed, as intended.
- The fixes (A24): direction-aware notes and answers, prompt 1.2.1, the replay tool 1.0.1; grammar 1.4.0; `(removed)` for an undone add and the original preview for a redo; replay history labels; the replay verified synchronously before its envelope write; the ritual's replay postcondition from the durable records (recorded position `base + 1`, lineage); the live revision on adoption; the card.
- Moved pins: the I8b grammar pin "Redo the last move" → "Redo the last edit"; `AI_REPLAY_NOTE` → `AI_REPLAY_NOTES.undo` in `b18-c-replay-grants` and `b18-c-undo-redo`; the gateway prompt pins 1.2.1; the grammar pin 1.4.0.
- Generators re-run: tool registry (digest `eng1-2e9c517667471755`), B09 agent artifacts, B11 (19/19 cases, 59/59 checks at prompt 1.2.1), the toolability matrix, B16-0.x (158 = 155 + 3 + 0, unchanged) and the B17 control inventory (576 controls, unchanged).
- CI: `b18-c-review-3`, the dialog component test and `b18-c-fixture-agent` join the deterministic-manufacturing vitest list (the last was missing since I10a).
- Not done, PROPOSED for B18-D: gating the editor's own Undo/Redo while a grant executes (a UX choice after the fix, not a safety need).
- Tests: review-3 10/10; dialog 1/1; broad run: 229 files / 3228 passed, 10 skipped (the 9 live Supabase matrix tests and the opt-in database-qualification test in pcb-sync-authority, a component suite the run now includes) across agent, chat, agent routes, execution-grant, engineering, project, auth, api tripwires, the B15 proposal suites, the fixture runtime, the recovery pipeline and the PCB component suites. eslint 0; tsc 0.
- CI at `14d38ba` (review 3): `deterministic-manufacturing` run 34579377845 success (its page-browser-e2e job included); `benchmark-quality` run 34579377740 success.

### B18-C I10b — the browser proof and the closeout (CONFIRMED, 2026-09-11 local, solo; this commit)

- `e2e/agent-execution.spec.ts` (serial; `bootstrapSynchronizedBoard`, namespace `b18c0000`; the scripted agent under the fixture runtime): 4 passed (39.6 s) in run 4 — the previewed move confirmed on the card, the admin opt-in with an explicit move and flip, the silkscreen add with an AI undo, a reload and an AI redo, and the grant altered in transit dropped.
- Scenarios (A25): a previewed move confirmed on the card under `proposal_only`; the administrator's opt-in (compare-and-set; the editor refused 403) and an explicit move and flip with no card; a silkscreen add confirmed, "Undo that.", a RELOAD, "Redo."; a grant altered in transit dropped by the page's SAFE receiver. The board is read from the editor-context snapshot each chat request carries.
- The runs, in order: run 1 failed at the success check — the card closed and the server accepted the tender and the settles, but one visibility poll did not observe the transient outcome notice; the spec now records every notice shown. Run 2 passed scenarios 1–2 and failed the redo count — the chat log survives a reload (a spec assumption), so the count is now relative; the redo itself committed. Run 3 passed scenarios 1–2 and again failed the redo count (the restored chat log renders after the page loads, so a count read at once is 0; the spec now waits for the restored count) — the redo itself committed. Run 3's notice log exposed the defect: "AI execution recovery: … adopted-and-settled" right after the successful Confirm and after the first execution following the reload, with a second idempotent settle each time (see A25); reproduced in vitest (`b18-c-recovery-inflight`: the ritual refused a landed change as `recovery-required`), fixed in `recoverGrantedExecutions` (the shared claim registry). Run 4: 4 passed (39.6 s) in run 4 — the previewed move confirmed on the card, the admin opt-in with an explicit move and flip, the silkscreen add with an AI undo, a reload and an AI redo, and the grant altered in transit dropped. run 1's missing success notice was the hydration sweep's recovery notice replacing it within milliseconds (run 3's notice log shows both — the defect below); the notice visible in `forged-grant-dropped.png` is the preceding redo's, still inside its 6 s.
- Fixed (CONFIRMED): the hydration sweep no longer adopts an execution in flight in the same page (A25); regression `b18-c-recovery-inflight`, in the CI vitest list.
- Found for B18-D (PROPOSED): the composer routes any message beginning with "add", "set", "edit", "remove", … to the schematic editor (`inferComposerAction`), so "Add silkscreen text …" never reaches the assistant.
- Closeout: `safe-mutation-tools.md` (the closing record); OWNER_DECISIONS OD-11 resolved (grammars for move, rotate/flip and undo/redo; arrange, silkscreen text and dimensions confirmation-only), OD-14 browser-proven, OD-15 (schematic execution) and OD-16 (schematic wires and labels) added.
- Tests: `b18-c-recovery-inflight` 1/1 (failed before the fix); recovery and ritual suites 7 files / 53 passed; broad run: 230 files / 3229 passed, 10 skipped (the 9 live Supabase matrix tests and the opt-in database-qualification test in pcb-sync-authority) across agent, chat, agent routes, execution-grant, engineering, project, auth, api tripwires, the B15 proposal suites, the fixture runtime, the recovery pipeline and the PCB component suites; Playwright 4 passed (39.6 s) in run 4 — the previewed move confirmed on the card, the admin opt-in with an explicit move and flip, the silkscreen add with an AI undo, a reload and an AI redo, and the grant altered in transit dropped; tsc 0; eslint 0.
- Environment, not code: the first I10b broad run failed three B14.4/B14.5 AST-gate cases on `playwright-report/trace/assets/*.js` — the Playwright HTML reporter's generated trace viewer, written into the (gitignored) report folder by a local `--reporter=list,html` run; the gate walks the tree and correctly fails closed on its dynamic import. The folder was removed and the broad run repeated; the gates are unchanged (CI's vitest job runs on a clean checkout).
- CI at `2a80dff` (I10b): `deterministic-manufacturing` run 34582259377 success — prompt-to-gerber, database-delivery and page-browser-e2e (the new `agent-execution` spec, all four scenarios) green; `benchmark-quality` run 34582259369 success. **B18-C is complete.**

### B18-D I0 — the chat execution UX design record (CONFIRMED as a record, 2026-09-11 local, solo; this commit)

- The runbook's B18-D: the user must see what Sirkit understood, the resolved objects/nets, the tier, the exact operations, whether confirmation is required, progress and cancellation, the committed transaction/revision, the validations run, failures and recovery, and an undo action; no button may apply an altered proposal; no model text may claim success before the transactional result exists. Plus the two items B18-C proposed (P1 composer routing, P2 Undo/Redo during an execution).
- Design workflow `wf_1121fdf1-b3d` (eight read-only agents, no worktrees): four discovery maps, three designs (minimal-truthful 36, enforcement-first 37, user-first 34), a judge that verified the decisive anchors and synthesized `chat-execution-ux.md`. Recorded: the judge saw design A truncated; the builder spot-checked the two decisive anchors (`loop.ts:328` emits a step's text before its tool calls are handled; `page.tsx` appends that text to the answer unmarked and labels any `ok` tool_finished "— succeeded").
- Key findings (C, from the judge's verification): a step's model text is emitted before its tool calls are resolved (`loop.ts:328` vs `343-662`), and the page appends it to the answer unmarked — so Rule 2 is not enforced today; grant issuance reads "— succeeded"; every PCB undo path goes through ONE wrapped history with no guard against a commit in flight; one design's routing rule would have sent the blinker bootstrap prompt to the assistant and broken every browser spec.
- The plan: I1 composer routing (a pure `routeComposerMessage`; the bootstrap keeps generating); I2 server text phases and tiers on tool events (side-effecting steps emit their text after their calls resolve); I3 pure display modules; I4 the ritual outcome report and editor callbacks; I5 the card (digest-covered change block vs "as issued" context); I6 the chat execution entry and the page half of Rule 2; I7 the history hold (P2) at the single choke point, probe first; I8 Undo in chat through the timeline with `expectTransactionId`; I9 Stop; optional I10 (`tool_refused`, untraced) and I11 (autonomy control); I12 closeout with an adversarial review.
- Owner decisions D1–D8 recorded as OD-17 with the recommended defaults applied.
- CI at `ea689c0` (I0): CI green (deterministic-manufacturing 34587749699 incl. page-browser-e2e, benchmark-quality 34587749698).

### B18-D I1 — composer routing (CONFIRMED, 2026-09-11 local, solo; this commit)

- Found in B18-C: the composer sent every message beginning with add / set / edit / remove / delete / change / … to the SCHEMATIC editor, so "Add silkscreen text REV B at 10, 10" never reached the assistant (the browser proof said "Please add …").
- `routeComposerMessage` (a pure module, §3's nine rules) replaces the page's inline router: a PCB change phrased as an edit or a draw request reaches the assistant; schematic edits, generation and the empty project's design prompt (the browser bootstrap) route as before; the verbs are now word-bounded ("additional", "settings" ask), and the `make R1 …` rule is reachable.
- The route is shown before sending ("Sirkit will: …"); an override button sends a suggested edit or generation to the assistant instead (reset on submit); a release/order/qualify word shows that the assistant never does those. Display and routing only — the server loop or the proposal review decides everything.
- Gates: B17 577 controls (+1 override, a view rule; the composer rows gain `agent.execution-grant`); B01 unchanged; `page.tsx` eslint 14 pre-existing problems before and after; the b07-4 `function handleComposerSubmit` slice token kept.
- Tests: `b18-d-composer-routing` 4/4 (CI list); targeted 4 files / 32 passed (routing, the B17 gate, b07-4, b10-1); broad run: 231 files / 3233 passed, 10 skipped (the 9 live Supabase matrix tests and the opt-in database-qualification test); Playwright `agent-execution`: 5 passed (45.3 s) — the four B18-C scenarios, their silkscreen instructions now sent without "Please", and the new I1 routing scenario; tsc 0; eslint 0 on the new and changed files.
- CI at `c6eaaa1` (I1): CI green (deterministic-manufacturing 34588725619 incl. page-browser-e2e, benchmark-quality 34588725706). (The I1 commit also carried the four B18-C evidence screenshots, re-taken by the I1 Playwright run — the same scenarios.)

### B18-D I2 — model text after the result; phases and tiers (CONFIRMED, 2026-09-11 local, solo; this commit)

- Found in the design (C): a step's model text was emitted BEFORE its tool calls were resolved, so "Done, R3 moved." written beside a move call reached the page before any grant or transaction existed — Rule 2 ("no model text may claim success before the transactional result exists") was only prompt guidance.
- The loop now holds the text of a step that calls a `mutate` or `propose` tool until the step's calls resolved (after the explicit execution's settlement, the preview's grant or the proposal), never emits it after a boundary failure, and emits every other step's text in place. `text_delta.phase` says "interim" (beside a tool call) or "final" (the closing answer); tool events carry the tool's permission tier.
- Reproduced first: the new `b18-d-loop-text-phase` suite failed all five cases on the pre-fix code; it passes after the change.
- Tests: `b18-d-loop-text-phase` 5/5 (CI list); `app/lib/agent` + `b18-c-loop-real-gateway` 31 files / 349 passed (the B09 page-gate and closure pins, the B18-B protocol sequences and the replay capsules unchanged); broad run: 232 files / 3238 passed, 10 skipped (the 9 live Supabase matrix tests and the opt-in database-qualification test) on the repeat run; Playwright `agent-execution`: 5 passed (43.8 s); tsc 0; eslint 0.
- Timing, not code: the first I2 broad run failed one test outside B18-D — `app/components/pcb/__tests__/assignment-queue-panel.test.tsx:29` waits for "Exact decision preview" with testing-library's default one-second `findByText`, and the lookup timed out at 1.24 s under the broad run's load. The panel, its test and everything they import are unchanged on this branch; alone the file passed 2/2 three times in a row; the repeat broad run: 232 files / 3238 passed, 10 skipped — green, the panel test included. Recorded, not dismissed: if it recurs, its wait gets an explicit timeout with the reason.
- CI at `d1e1307` (I2): CI in progress at the I3 commit — its result is recorded with I4. (The I2 commit again carried the four evidence screenshots, re-taken by its Playwright run.)

### B18-D I3 — the pure display modules (CONFIRMED, 2026-09-11 local, solo; this commit)

- `execution-display.ts`: the exact operations, targets, tier, confirmation reason, and the failure, retirement, recovery and checks sentences — from data the page already holds; display only, never throws, never a pass or fitness claim.
- `chat-run-view.ts`: honest tool-line labels; the run view (interim text out of the answer, released as notes at the end; the final answer labelled while a change the run started is unresolved or a proposal awaits review; history without notes; failures visible); one execution entry per grant following the editor and the server, falling back to "landed, unverified" when they disagree.
- Found while writing them: no free-text reason exists in the explicit-proof record (the unproven sentence is generic); a header phrase ("fails safe to") matched the copy gate's prohibited list — reworded; both source files are now scanned by the new tests.
- Gates: B17 577 controls and the B01 fingerprint unchanged (I3 adds no UI); the broad run includes the AST import gates, green with the two new SAFE modules. Local Playwright not run for I3: nothing is wired into the page (the browser spec runs in CI on every push).
- Tests: `b18-d-execution-display` 7/7, `b18-d-chat-run-view` 9/9 (CI list); broad run: 234 files / 3254 passed, 10 skipped (the 9 live Supabase matrix tests and the opt-in database-qualification test); tsc 0; eslint 0.

### Test timing — the assignment workbench's preview wait (CONFIRMED, 2026-09-11 local, solo; this commit)

- `app/components/pcb/__tests__/assignment-queue-panel.test.tsx:29` waited for "Exact decision preview" with testing-library's default one-second `findByText`. It failed twice, only inside broad parallel runs: 1.24 s in I2's first run and 1.26 s in I4's. Alone it passed 3/3 both times, and nothing on this branch touches the panel, its test or its imports.
- After the recurrence (as recorded in I2) the wait is explicit — 5 s, with the reason in the test. The assertion is unchanged: the preview must still appear, the commit button must still start disabled.
- CI at `d1e1307` (I2): CI green (deterministic-manufacturing 34589879025 incl. page-browser-e2e, benchmark-quality 34589879113).
- CI at `3565ad6` (I3): CI green (deterministic-manufacturing 34590335575 incl. page-browser-e2e, benchmark-quality 34590335530).

### B18-D I4 — the editor reports what it settled with (CONFIRMED, 2026-09-11 local, solo; this commit)

- Before: the ritual settled the server record with the checks it ran and the undo eligibility, but returned neither — a confirmed preview's checks were visible nowhere, and the committed notice said "Undo restores the exact previous board" even when the change was no longer the latest.
- Now the ritual computes both once, settles with them and returns them (null checks for an execution that was already applied); the editor passes the outcome to the page, reports when it starts executing and what the recovery sweep did, and says the undo sentence only while it is true. The page consumes these in I6.
- Reproduced first: the new `b18-d-ritual-outcome-report` suite failed both cases on the pre-fix code.
- Gates: B17 577 controls and the B01 fingerprint unchanged (props and the notice text are not scanned controls); the import gates unchanged (PcbEditor imports the report types from the approved controller); `PcbEditor` eslint 1 pre-existing problem before and after.
- Tests: `b18-d-ritual-outcome-report` 2/2 (CI list); every `b18-*` suite + the B17 gate 42 files / 224 passed; broad run: 235 files / 3256 passed, 10 skipped (the 9 live Supabase matrix tests and the opt-in database-qualification test), with the panel wait fix (`64a8034`) in the tree — the first I4 run's only failure was that wait's recurrence; Playwright `agent-execution`: 5 passed (45.4 s); tsc 0; eslint 0 on the changed files.
- CI at `64a8034` (the panel wait): CI green (deterministic-manufacturing 34590830884 incl. page-browser-e2e, benchmark-quality 34590830896).
- CI at `603fe9f` (I4): CI green (deterministic-manufacturing 34591108582 incl. page-browser-e2e, benchmark-quality 34591108565).

### B18-D I5 — the confirmation card shows exactly what changes (CONFIRMED, 2026-09-11 local, solo; this commit)

- Before: the card showed the preview, the family and the operation count, with the scope, the instruction excerpt and the minter's note mixed in beside it — no tier, no targets, no individual operations, no reason for the confirmation.
- Now: a change block with only digest-covered content (tier, family, preview, targets by reference, each exact operation) and a separate "As issued by the server" block (why a confirmation is required, what you asked, scope and base, the note). Inert: no inputs; Confirm and Cancel pass no arguments. `PcbEditor` passes the live board for references; the card joins the B01 watched surfaces.
- Reproduced first: `b18-d-granted-execution-card` failed all four cases on the pre-fix card (no change block, no operations list, Confirm received the click event).
- Gates: B17 577 controls, the card's rows unchanged (Confirm and Cancel still record onConfirm / onCancel); B01: the card joins the watched surfaces with no literal labels (`"app/components/pcb/GrantedExecutionDialog.tsx": []`).
- Tests: `b18-d-granted-execution-card` (CI list) and the review-3 card test unchanged; broad run: 236 files / 3260 passed, 10 skipped (the 9 live Supabase matrix tests and the opt-in database-qualification test); Playwright `agent-execution`: 5 passed (45.6 s) — the reworked card in the preview and silkscreen scenarios; tsc 0; eslint 0.
- CI at `0984bc8` (I5): CI green (deterministic-manufacturing 34591596283 incl. page-browser-e2e, benchmark-quality 34591596261).

### B18-D I6 — one entry per AI change in the chat; the page half of Rule 2 (CONFIRMED, 2026-09-11 local, solo; this commit)

- Before: the chat showed the model's text as it arrived (including text written beside a tool call, before any result), tool lines read "— succeeded" for a grant that had only been issued, and an AI change left scattered activity lines with no single place that said what it was, whether it needed confirmation, what happened and how to undo it.
- Now: the answer is the model's final text only (labelled while the change it describes is unresolved); interim text becomes a note after the run and never enters the history; tool lines say what happened, with the tier; and each grant has ONE entry — asked, understood, tier, targets, operations, confirmation reason, state, transaction and revisions, checks, failure and next step, recovery, undo — persisted through the existing chat log shape.
- Reproduced first: the new `b18-d-execution-entry-log` suite failed all four cases on the pre-fix code (the entry-log helpers did not exist).
- Found while wiring it: my own draft test hard-coded the shortened revision with one character too many; loosened to a pattern before the run.
- Gates: B17 577 controls and the B01 fingerprint unchanged (the entry adds data attributes, no controls); `page.tsx` eslint 14 pre-existing problems before and after; the b07-4 page-source slices and the b10-1 must-not-contain pins green.
- Tests: `b18-d-execution-entry-log` 4/4 (CI list); `b18-c-fixture-agent` with the interim-text pin; the I6-related suites 14 files / 90 passed; broad run: 237 files / 3264 passed, 10 skipped (the 9 live Supabase matrix tests and the opt-in database-qualification test); Playwright `agent-execution`: 5 passed (49.5 s) — with the new I6 assertions: the entry reaches committed for the confirmed preview and the explicit move; the scripted agent's interim text appears only as a note and never in the history; a grant altered in transit creates no entry; tsc 0; eslint 0.
- CI at `1352a20` (I6): CI green (deterministic-manufacturing 34592217423 incl. page-browser-e2e, benchmark-quality 34592217422).

### B18-D I7 — the history hold (CONFIRMED, 2026-09-11 local, solo; this commit)

- The defect, CONFIRMED on the pre-fix code: on the pre-fix code a one-off diagnostic (the same gated scenario, then deleted) measured it: during the granted commit `canUndo` was true and the Undo popped the earlier human move at once (R4 31.000 → 30.000 mm); when the AI commit landed R4 was back at 31.000 mm — the user's Undo silently overwritten; the AI move committed (R3 6 → 8 mm); Redo was no longer available; the session logged `executed` then `reconcile-rebased`.
- The probe `b18-d-undo-during-commit` reproduced it first (during the commit `canUndo` was still true; `historyHoldReason` did not exist).
- The fix: the session's history hold at the single choke point every undo path shares — the user's undo/redo refused and `canUndo`/`canRedo` false while a granted execution is in flight, subscribers told when it starts and ends; the ritual takes it and releases it in its `finally`; undo eligibility now reads the entries (a hold never makes a report say "not undoable"); the timeline refuses a busy store as `STORE_BUSY`; Ctrl+Z explains the pause.
- Pin moved (deliberate): review 3's Q4 now pins that a Ctrl+Z during the AI undo's envelope write is refused with the reason and that an Undo afterwards reverses the AI undo; the replay is still never poisoned.
- Gates: B17 577 controls and the B01 fingerprint unchanged (the hold adds no controls); `PcbEditor` eslint 1 pre-existing problem before and after.
- Tests: the probe 2/2 and `b18-d-timeline-store-busy` 2/2 (CI list); the B18, B17-E, B03-1 and B08 canonical-history suites 49 files / 278 passed after the Q4 move; broad run: 239 files / 3268 passed, 10 skipped (the 9 live Supabase matrix tests and the database-qualification test); Playwright `agent-execution`: 5/5 passed (47.9 s); tsc 0; eslint 0.
- CI at `ab71fe2` (I7): CI green (deterministic-manufacturing 34593230526 incl. page-browser-e2e, benchmark-quality 34593230461).

### B18-D I8 — Undo in chat (2026-09-11 local, solo; this commit)

- Reproduced first: `b18-d-chat-undo-timeline` failed 2/2 on the pre-change timeline (`undoLatest` ignored the expectation and undid whatever was newest — for a forged id it undid the operation).
- The timeline's `undoLatest({ expectTransactionId })` refuses `NOT_LATEST` against its own recorded reference; the store's undo is never called on a refusal.
- One "Undo this change" button on a live committed entry (`ExecutionEntryActions`); disabled with its reason when already undone, no longer undoable, an AI change is in flight, or not the newest operation; the result (or the refusal, verbatim) is written into the entry. The page mirrors its entries in state so nothing reads a ref during render.
- Gates: B17 578 controls / 60 surfaces (the new button classified semantic under agent.execution-entry-undo); B01 fingerprint regenerated (the new watched file); b17-a-control-inventory and action-registry 16/16.
- Tests: `b18-d-chat-undo-timeline` 5/5 and `b18-d-execution-entry-actions` 2/2 (CI list); broad run: 241 files / 3275 passed, 10 skipped (the 9 live Supabase matrix tests and the database-qualification test); Playwright `agent-execution`: 6/6 passed (56.2 s) incl. the new Undo-in-chat scenario (its evidence frame chat-undo-entry.png shows the editor's 'Undid: AI: R3 …' toast; the entry itself is scrolled out of view — I9 re-takes the frame on the entry); tsc 0; eslint: `page.tsx` 14 pre-existing problems before and after, the new files clean.
- CI at `ddf0526` (I8): CI green (deterministic-manufacturing 34594840932 incl. page-browser-e2e, benchmark-quality 34594840975).

### B18-D I9 — Stop (2026-09-11 local, solo; this commit)

- The server half already existed (route `cancel()` → the run's abort; the loop's `finally` retires still-issued explicit grants `run_cancelled`, B18-B); what was missing was a way for the user to trigger it and an honest line when they do. `b18-d-chat-stop` pins the whole chain through the production POST handler: it passed on the pre-change code too (the server chain already held) and after the change: the body cancel, then the route abort, then the real loop ends `cancelled` with the provider signal aborted, then `retireIssued("run_cancelled", true)`.
- The page: `send()` registers its run; Stop cancels the response reader (also when pressed before the response arrived) and carries nothing; the chat says "Stopped. An AI change your editor had already started still finishes and is reported here."
- Gates: B17 579 controls / 60 surfaces (Stop classified semantic under ai.chat-run-stop); B01 fingerprint regenerated (the Stop button title literal); b17-a-control-inventory, action-registry and the route test 17/17.
- Tests: broad run: 242 files / 3276 passed, 10 skipped (the 9 live Supabase matrix tests and the database-qualification test); Playwright `agent-execution`: 7/7 passed (59.0 s) incl. the new Stop scenario and the re-taken Undo-in-chat frame (now on the entry); the server log line `[llm:openai] request failed (missing_credentials)` belongs to the automatic schematic review (`POST /api/schematic/review` 503; the fixture runtime has no provider credentials), not to the Stop scenario; tsc 0; eslint: `page.tsx` 14 pre-existing problems before and after, the new test clean.
- CI at `f0152ca` (I9): CI green (deterministic-manufacturing 34595618195 incl. page-browser-e2e, benchmark-quality 34595618149).

### B18-D I10 — calls refused before they run are shown (2026-09-11 local, solo; this commit)

- Reproduced first: `b18-d-tool-refused` (no `tool_refused` event for an unknown tool, invalid JSON or a repeated call) and `b18-d-refused-line` (no label) failed 3/3 on the pre-change code.
- The loop emits an untraced `tool_refused` at its seven pre-run refusal sites through one helper that also pushes the unchanged error result; the page shows "… refused before running (<code>) — nothing ran".
- The trace and the evaluation capsules are unchanged: the agent suite (33 files / 363 tests, including the b11 capsules and e11) passed without a pin moving.
- Gates: B17 579 controls and the B01 fingerprint unchanged (no new control).
- Tests: broad run: 244 files / 3279 passed, 10 skipped (the 9 live Supabase matrix tests and the database-qualification test); Playwright `agent-execution`: 7/7 passed (1.1 min); the one `[llm:openai] request failed (missing_credentials)` server line is again the automatic schematic review (pre-existing; also in the B16-C fixture logs); tsc 0; eslint clean on the changed files (`page.tsx` 14 pre-existing problems before and after).
- CI at `6ca4941` (I10): CI green (deterministic-manufacturing 34596153799 incl. page-browser-e2e, benchmark-quality 34596153694).

### B18-D I11 — the agent autonomy in the chat header (2026-09-11 local, solo; this commit)

- Reproduced first: b18-d-autonomy-mode-control could not run on the pre-change tree (the component did not exist: its import failed to resolve).
- The control shows the mode and what it means to every member; an administrator (the server's `viewer.canChange`) picks a mode and presses Change, which sends exactly `{ mode, expectedRevision }`; a 409 is read again, a refusal is shown verbatim, an unavailable store says the project behaves as proposal only.
- Found while verifying: the first browser run failed in scenario 2 (a 300 s timeout on the autonomy select). The plan assumed the page was the administrator there; the fixture bootstrap ends as the editor, for whom the control is correctly locked (the failure screenshot shows "Only a project administrator can change this."). Scenario 2 keeps its API change; a new scenario checks the editor's view, then changes the mode through the control as the administrator and back.
- Gates: B17 581 controls / 61 surfaces (the select classified view under view.autonomy-mode-draft, Change semantic under agent.autonomy-change); B01 fingerprint regenerated (the select aria-label); b17-a-control-inventory and action-registry 16/16.
- Tests: `b18-d-autonomy-mode-control` 4/4 (CI list); broad run: 245 files / 3283 passed, 10 skipped (the 9 live Supabase matrix tests and the database-qualification test); Playwright `agent-execution`: 8/8 passed (3.0 min) incl. the new autonomy scenario; the first run failed in scenario 2 (a 300 s timeout on the locked select, see above), the corrected run passed; the one `[llm:openai] request failed (missing_credentials)` server line is the pre-existing automatic schematic review; tsc 0; eslint clean on the new files (`page.tsx` 14 pre-existing problems before and after).
- CI at `e88ca47` (I11): CI green (deterministic-manufacturing 34630291984 incl. page-browser-e2e, benchmark-quality 34630291979).

### B18-D I12 part 1 — the §7 checks still unwritten (2026-09-11 local, solo; this commit)

- Found while closing out: §7 of the design record planned checks that no increment had written — the R1-1 source gate (`b18-d-ui-gates`), the card-Cancel scenario, P2 in the browser, the S5 order-of-appearance checks and some entry details in scenarios 1 and 3.
- `b18-d-ui-gates`: 3/3 on the current code: it pins an invariant that already held (one tenderConfirmedExecution( call and one runGrantedExecution("confirm"), both in PcbEditor; no chat component imports the execution machinery); the injected offender trips all four gates.
- The browser checks pin behaviour built in I5–I7 and I6 (Rule 2); they were written against the current code, not reproduced on older code.
- Found while verifying (P2): the first browser run sent "Move R3 1 mm to the left." — the instruction scenario 2 had already executed — and the minter correctly required confirmation ("An identical instruction already executed at 2026-09-09T12:00:00.000Z … confirm to run it again"), so the card waited and no tender was ever held (the poll saw 0 tenders; the failure screenshot shows the card with that reason). P2 now sends a fresh instruction.
- Found while verifying (not B18-D code): `assignment-queue-panel.test.tsx` timed out at vitest's 5 s default in a loaded broad run (the review workflow's agents were running alongside four workers). Alone the test takes about 0.3 s (3/3). The explicit 5 s wait from `64a8034` could never apply inside a 5 s test; both tests in the file now get a 20 s test timeout and 15 s waits, and no assertion changed.
- Where §7 named a different file, the coverage and its home are listed in D-A12.
- Gates: B17 581 controls and the B01 fingerprint unchanged (no new control); the CI list gains b18-d-ui-gates.
- Tests: broad run: 246 files / 3286 passed, 10 skipped (the 9 live Supabase matrix tests and the database-qualification test); the assignment-panel test passed under the same kind of load that had timed it out; Playwright `agent-execution`: 11/11 passed (3.5 min) incl. card Cancel, P2 and S5; the first run failed at P2 (0 tenders: a repeated instruction waited on its card, see above) and the corrected run passed; the one `[llm:openai] request failed (missing_credentials)` server line is the pre-existing automatic schematic review; tsc 0; eslint clean on the changed files.
- CI at `a162ef9` (I12 part 1): CI green (deterministic-manufacturing 34632575062 incl. page-browser-e2e, benchmark-quality 34632575037).

### B18-D I12 part 2 — the adversarial review and its fixes (2026-09-11 local, solo; this commit)

- The review: The finders raised 36 findings (about 15 distinct defects, several raised by more than one dimension); the skeptics confirmed 26 and refuted 10. The completeness critic had not reported when this was committed; its gaps are handled in part 3. Every finding's verdict and disposition is in D-A13.
- Reproduced first: `b18-d-repair-undo-held` failed 2/2 on the old code (the real session's hold: `ok: true` for an undo that did not happen; a silent no-op: `ok: true`); `b18-d-review-entry-lifecycle` could not run (`entryAttemptRefused` did not exist); the operation-detail assertions and the forged scenario's dropped-grant lines had nothing to match before.
- Fixed: entries never cross projects; a transiently refused Confirm leaves "executing"; a replaced preview is marked superseded; Stop's text is true and a stopped run's notes are released; the chat Undo stays one-shot with a true reason after a Redo (an I8 pin moved); the undo hint is conditional (an I6 pin moved); every editable field of a silkscreen-text or dimension update is shown; a dropped grant is named; a dead helper removed; the hold's redo case tested; `undoRepairTransaction` hardened.
- Kept as recorded designs after verification: the Stop text in the answer (D-A9); the chat Undo one-shot (D-A8).
- Not changed (refuted): the route enqueue after Stop (Next aborts the run before cancelling the body); a settled landed-unverified entry reverting (no path reaches it); weaker browser assertions; the reload record, the composer override and the stop-notes variant the UX verifier refuted.
- Flagged outside B18-D: the repair panel's Undo is refused on every bound history (the executor replaces the repair's transaction id) — a separate task.
- Gates: B17 581 controls and the B01 fingerprint unchanged (no new control); the CI list gains b18-d-review-entry-lifecycle and b18-d-repair-undo-held.
- Tests: broad run: 248 files / 3294 passed, 10 skipped (the 9 live Supabase matrix tests and the database-qualification test); Playwright `agent-execution`: 12/12 passed (4.1 min) incl. the replaced-preview scenario and the forged scenario with the rewritten tool line; the first run of this set failed there: the tool line was relabelled when the tool finished, but the loop reports the tool before the grant, so the relabel never fired; the drop branch now rewrites the line (pinned in b18-d-review-entry-lifecycle); two earlier runs were cut off when the session ended, not by a failure; the one missing_credentials server line is the pre-existing automatic schematic review; tsc 0; eslint: `page.tsx` 14 and `PcbEditor.tsx` 1 pre-existing problems (the same rules as before), the changed files clean.
- CI at `82b99a9` (I12 part 2): CI green (deterministic-manufacturing 34639079979 incl. page-browser-e2e, benchmark-quality 34639079904).

### B18-D I12 part 3 — the UX verifier's remaining findings (2026-09-11 local, solo; this commit)

- Reproduced first: b18-d-review-part3 failed 3/4 on the part-2 code (the pre-check reason, the undoable claim, the direction-blind hints); the fail-safe case passed, pinning existing behaviour.
- Fixed: the live pre-check's reason reaches the entry and survives the server's later retirement; the committed line drops "undoable" (an I6 pin moved); an AI undo or redo entry's hint follows its direction; disabled reasons are described for assistive technology, the route's reason is in the chip's text, and the toolbar names the hold's reason.
- The completeness critic: it reported seven gaps; each is fixed in part 4, the next commit (D-A15).
- Gates: B17 581 controls and the B01 fingerprint unchanged (no new control; the toolbar titles are expressions); the CI list gains b18-d-review-part3.
- Tests: broad run: 249 files / 3299 passed, 10 skipped (the 9 live Supabase matrix tests and the database-qualification test); Playwright `agent-execution`: 12/12 passed (4.6 min) incl. P2 checking the paused toolbar title; the one missing_credentials server line is the pre-existing automatic schematic review; tsc 0; eslint clean on the changed files (`page.tsx` 14 and `PcbEditor.tsx` 1 pre-existing problems, the same rules as before).
- CI at `e770bf1` (I12 part 3): CI green (deterministic-manufacturing 34640379579 incl. page-browser-e2e, benchmark-quality 34640379575).

### B18-D I12 part 4 — the completeness critic's gaps (2026-09-11 local, solo; this commit)

- Reproduced first: b18-d-review-part4 failed 5/5 on the part-3 code (the label wording, the undoable in-progress claim, recovery not settling a live entry, the reason after a later undo, the missing edit-route helper).
- Fixed: a cut stream is a visible failure with its notes released; the answer label is true in the unsettled case; Rule 2 on the schematic edit route (owner decision OD-18, a default); the chat Undo's reason after a later undo; recovery settles live entries; the static Tier 3 line; the in-progress lines drop "undoable" and show the wait.
- Gates: B17 581 controls and the B01 fingerprint unchanged (no new control); the CI list gains b18-d-review-part4.
- Tests: `b18-d-review-part4` (CI list); broad run: 250 files / 3304 passed, 10 skipped (the 9 live Supabase matrix tests and the database-qualification test); Playwright `agent-execution`: 13/13 passed (4.6 min) incl. the new cut-stream scenario and the Tier 3 line; the one missing_credentials server line is the pre-existing automatic schematic review; tsc 0; eslint clean on the changed files (`page.tsx` 14 and `PcbEditor.tsx` 1 pre-existing problems, the same rules as before).

### Integrated — the repair panel's Undo on a bound session (2026-09-11 local; this merge)

- The owner started the task flagged in the B18-D review: the repair's Undo compared the repair's own id with the history entry's `transactionId`, which a bound canonical session replaces with the executor's id, so the panel's Undo was always refused there. That session's branch `fix/b18-d-repair-undo-bound-session` (93177ac, 75d537a, ee1bc6f — the owner's address `danditilahun82@gmail.com`, real timestamps) is merged here with a normal merge.
- The fix: the repair records its own id in the entry's details, and its Undo matches the newest applied `pcb_repair` entry by that id (plus the repair command on canonical entries). `b18-d-repair-undo-bound` failed first (75d537a) and passes with the fix; the held test now uses a real repair, and a non-repair change is correctly never undone through a repair's Undo.
- Conflicts: `transaction.ts` and the held test, resolved to the branch's versions — they contain this branch's hardening and all three held cases.
- Tests after the merge: 2 files / 6 tests passed (held 3, bound 3); broad: 251 files / 3307 tests passed, 10 skipped (the expected skips).
- Still open, flagged by that session and outside B18-D: re-applying the same repair preview after its Undo reports success, but the executor replays the idempotent `repair:<preview id>` and nothing changes.

### Correction — the assignment-panel test was a race, not slowness (2026-09-11 local; this commit)

- `assignment-queue-panel.test.tsx` failed again in a loaded broad run after `82b99a9` had given it more time. The failure's DOM shows the cause: the reason was typed, but the candidate radio was unchecked and "Select exact candidate" was still disabled, so no preview could ever appear. The panel auto-selects the first item after loading and resets its per-item state (candidate, preview, confirmation) in an effect keyed on the selection; under load that reset ran after the test's first click and wiped it. The diagnosis recorded with `82b99a9` ("timing") was wrong; the longer waits never addressed it.
- The fix: the test flushes pending effects before interacting and checks each interaction as it happens (the radio is checked; the button is enabled before it is clicked); the reviewer-assignment test gets the same flush. Alone 5/5; broad run: 251 files / 3307 tests passed, 10 skipped (the expected skips).
- The product pattern — per-item state reset in an effect rather than with a key — predates B18 and is flagged as a separate task.

### Correction — commit identity (2026-09-11 local)

- Found while preparing the B18 merge: runbook §2.4 names the approved identity `Dandi Desta <dandidesta82@gmail.com>` (this ledger's header and the repository's git config agree), but 54 commits on `chapter/b18-agent-execution` (`2eafb49`…`e543cfe`) were authored as `Dandi Desta <danditilahun82@gmail.com>` — the owner's other address, the one the session environment reports — because the commit command overrode the configured identity.
- Every one of them is the owner's own work under the owner's own address, with real timestamps and no AI co-author trailers. They are not rewritten: the runbook forbids history rewriting and force-pushes.
- From the next commit on, commits use the approved identity. The owner may choose either address (OD-19).

### B18-D I12 part 5 — the second adversarial review and its fixes (2026-09-11 local, solo; this commit)

- The review (`wf_a9af930e-505`, four finders over I11–I12 at `e543cfe`, one skeptic per dimension, a completeness critic): 17 findings — 15 confirmed (two medium), one plausible, one refuted — and six critic gaps. Every one is fixed except the refuted finding; the table is in D-A16.
- Reproduced first: the real-history timeline test failed on the recording extracted unchanged from PcbEditor — a commit made after an undo was recorded as a redo, so the Undo reason said "the editor's Redo brought it back" for a change the redo stack no longer held. The other new tests were written with their fixes; each finding's reproduction is the verifier's trace, recorded in D-A16.
- Fixed: a dropped connection is handled like a cut stream; the wait is named only for an explicit grant; a stored entry never names the chat's button; a dropped grant's answer never points at a missing entry, and the label applies only while the outcome was unknown (an I3 pin moved); the chat Undo's reason follows the change through the recorded steps; the timeline classifies PCB changes by entry identity (a B17-E defect); the autonomy control is announced, keeps focus and claims nothing it cannot know; the edit route's model note never reaches the review dialog; a used-up grant is not offered for a retry; a replaced preview is retired and cancelled durably and its card never shows another grant's "Applying…"; a grant the editor refuses is retired `refused_before_execution`; the wiring is pinned; S5 checks text nodes.
- Production route: `/api/agent/execution-grant`'s cancel accepts two further retirement labels (`superseded_by_new_grant`, `refused_before_execution`); a cancel still retires only an issued grant, and the auth wrapper, same-origin CSRF, role rows and bounded reader are unchanged; the route ratchet is unchanged (158 = 155 + 3 + 0).
- Gates: B17 581 controls and the B01 fingerprint unchanged (both generators reproduce the committed outputs); the CI list gains b18-d-review2 and b18-d-review2-timeline.
- Tests: the affected directories (project, PCB and chat components, the agent routes, the grant modules): 57 files / 354 passed, 1 skipped; broad run: 253 files / 3329 tests passed, 10 skipped (the 9 live Supabase matrix tests and the database-qualification test); the full Playwright suite: 22/22 passed (3.5 min): agent-execution 16/16 incl. the four new checks (a Confirm refused for a transient reason, an errored stream, the S5 mixed-markup probe, the reloaded entry), semantic-editor 5/5, prompt-to-gerber 1/1; the missing_credentials server lines are the pre-existing automatic schematic review; tsc 0; eslint clean on the changed files (`page.tsx` 14 and `PcbEditor.tsx` 1 pre-existing problems, the same rules as before).

### B18-D closeout (2026-09-11 local, solo; this commit)

- Closing record: `artifacts/ai-control-plane-b18/chat-execution-closing.md` — the ten items, the two rules, the chat's controls, the review, the evidence and the recorded limits.
- SHAs: B18-D ran from `2a80dff` to `6ae2c73`; 62 files changed, 4606 insertions(+), 169 deletions(-) (evidence screenshots excluded; 10 screenshots — the closeout commit adds the tenth, `confirm-refused-transient.png`; the first version of this entry counted 9 because it counted before that commit).
- Second review (I11–I12): A second review of I11–I12 (`wf_a9af930e-505`: four read-only finders, one skeptic per dimension, a completeness critic) raised 17 findings — 15 confirmed (two medium), one plausible, one refuted — and six gaps; every one but the refuted finding is fixed (D-A16), together with a B17-E timeline-recording defect the new real-history test found.
- Evidence: 23 `b18-d-*` files / 100 tests, plus the B18-B and B18-C suites they touch; broad: 253 files / 3329 tests passed, 10 skipped (the 9 live Supabase matrix tests and the database-qualification test); `agent-execution`: 16/16 passed within the full suite (3.5 min); full Playwright suite: 22/22 passed (3.5 min): agent-execution 16, semantic-editor 5, prompt-to-gerber 1; CI at `6ae2c73`: CI green at 6ae2c73 (deterministic-manufacturing 34647251395 incl. page-browser-e2e, benchmark-quality 34647251465).
- Generated artifacts: `artifacts/ai-control-plane-b01/ui-control-fingerprint.json` sha256 `18b0fcfa9844cf15…`; `artifacts/ai-control-plane-b17/ui-control-inventory-summary.json` sha256 `ea846e545e55d398…`; `artifacts/ai-control-plane-b17/ui-control-inventory.csv` sha256 `a768ba4b9c4f1852…`.
- Security invariants: one production route changed in B18-D, and no authentication file: `/api/agent/execution-grant`'s cancel accepts two further retirement labels (`superseded_by_new_grant`, `refused_before_execution`; D-A16 item 13) — a cancel still retires only an issued grant; the auth wrapper, same-origin CSRF, the role rows and the bounded reader are unchanged, the route ratchet is unchanged (158 = 155 + 3 + 0), and their gates pass in the broad run.
- Live/fake: every proof uses the scripted fixture agent under the fixture runtime; a real model's chat execution is recorded as LB-7 (BLOCKED-LIVE-QUALIFICATION).
- Next: B18-E (the mandatory scenario matrix), then B18 validation and the chapter PR.

### B18-E E0 — the scenario record (2026-09-11 local, solo; this commit)

- Discovery (`wf_7e28fb7b-bda`, read-only, at `e543cfe`): eight mappers, one per runbook scenario, each tracing Sirkit's path and every unit, integration and browser proof, then a synthesis that checked the claimed proofs itself. Result: every scenario works partly; only scenario 6's chain is shown end to end in the browser as the runbook phrases it (on a silkscreen add, not a move); scenario 1 runs explicitly in the browser only with a variant sentence.
- Record: `artifacts/ai-control-plane-b18/scenarios.md` — the matrix (15 rows: scenario 7 split into its eight conditions), each path's tier, the harness limits (the scripted agent only; the frozen fixture clock; the retry guard per principal), the non-goals kept, increments E1–E19.
- Corrections: `permission-tiers.md` listed `pcb.dimension` under Tier 2 (it is Tier 1 since A17, as `b18-a-permission-tiers` pins); the `b18-c-adversarial` header overstated what B18-B pins (a membership revision or role change and mint idempotency — not a revocation after the mint or a provider's re-emitted call).
- Found by the discovery in B18-D's surfaces: an AI redo's hint offers "Undo that.", which the minter refuses for an AI replay; a reloaded entry's hint names the editor's one-step Undo, which a reload does not keep — E1. The drift and pre-check cancels' durable reason was fixed in B18-D part 5 (`refused_before_execution`); E2 makes drift cancels name the drift itself.
- Owner decisions: OD-20 to OD-30 recorded with defaults (OD-7 and OD-13 stand).
- Tests: none changed (records and a test header comment only).

### B18-E E1 — scenario 6's truth in the chat (2026-09-11 local, solo; this commit)

- Reproduced first: the new `b18-c-undo-redo` consistency case (every chat phrase a committed entry's hint names must mint through the real loop and minter) failed on the pre-E1 code — an AI redo's hint named “Undo that.”, which the minter answers `nothing_to_replay`.
- Fixed: an AI redo's hint names no chat phrase; a committed entry restored after a reload gets a hint that stays true (`restoredEntryLog`, called from the stored-chat restore); `nothing_to_replay` reads plainly on the tool line. The reload check, INFERRED by the discovery, is CONFIRMED in the browser: after the reload the toolbar reads "Nothing to undo" and the restored entries carry the new hint.
- Gates: B17 581 controls and the B01 fingerprint unchanged (no new control); the CI list gains b18-e-scenario-6-truth.
- Tests: `b18-e-scenario-6-truth`, the consistency case, a moved `b18-d-review-part3` pin and a `b18-d-ui-gates` wire; the affected files 10/10 (65 tests); broad run: 254 files / 3335 tests passed, 10 skipped (the 9 live Supabase matrix tests and the database-qualification test); `agent-execution`: 16/16 passed (4.8 min), including the reload checks: the toolbar reads “Nothing to undo” and the restored entries carry the new hint; tsc 0; eslint clean on the changed files (`page.tsx` 14 pre-existing problems, the same rules as before).

### B18-E E2 — refusals name their cause (2026-09-11 local, solo; this commit)

- Reproduced first: on the pre-E2 code six tests failed — the route refused a revision_drift cancel (400), the ritual's drift cancel recorded refused_before_execution instead of the drift, the entry read the generic “the server refused the change (it was cancelled, expired or altered)” where it should say “the board changed”, and the four new refusal-cause tests failed
- Fixed: the entry names the server's reason for refusing a tender (a retirement reason, a lost authorization, an unknown change, another attempt); drift cancels from the ritual and the editor's pre-check record `revision_drift` / `history_drift` / `lineage_drift`, so the model's `execution_retired` reason and the audit trail agree with the entry; one shared cancel vocabulary.
- Production route: `/api/agent/execution-grant`'s cancel accepts the three drift reasons (already in the closed retirement vocabulary; a cancel still retires only an issued grant; the auth wrapper, same-origin CSRF, the role rows and the bounded reader are unchanged); the route ratchet is unchanged (158 = 155 + 3 + 0).
- Gates: B17 581 controls and the B01 fingerprint unchanged (no new control); the CI list gains b18-e-refusal-causes.
- Tests: the affected files 19/19 (121 tests), including the new b18-e-refusal-causes, a route drift-cancel case, the ritual's drift and HTTP-status pins and a loop row; broad run: 255 files / 3340 tests passed, 10 skipped (the 9 live Supabase matrix tests and the database-qualification test); `agent-execution`: 16/16 passed (4.8 min); tsc 0; eslint clean on the changed files (`page.tsx` 14 and `PcbEditor.tsx` 1 pre-existing problems, the same rules as before).
- The first broad run of this increment FAILED — 6 tests in 5 files: the repo-wide AST and import gates (`b16-0-identity-header-gate`, `b14-4-ast-import-gates`, `b14-2-settlement-and-boundaries` ×2, `b11-3-generated-pcb-shape`) and one replay-recovery case (`b18-c-review-3`). It was not the code: each of those files passes alone (5 files / 86 tests, exit 0), and that run reported per-test durations of up to 2.3 hours — longer than the run itself lasted — so its workers were starved or suspended. Two measurement processes of mine (the board-inspect sizing for E3) ran alongside it, which is the likely cause; nothing else ran during the repeat above. Recorded rather than dismissed: the gates and deadlines are real, and a run under that load proves nothing either way. The runner script now keeps the full vitest output, because that failing run's assertions were filtered away and had to be recovered by re-running.

### B18-E E3 — scenario 1: what the model can read, and what it is told to read (2026-09-11 local, solo; this commit)

- Measured (A23's open question): `board-inspect` answers 40,410 characters on a PLACED board (67% of the loop's 60,000-character
  budget) and 70,173 / 72,453 on the two recorded ROUTED boards — over the budget, so the loop answers
  `output_too_large_for_model` and the model gets no board facts. CONFIRMED by measurement; how much copper it takes to cross is
  UNKNOWN. `b18-e-board-inspect-budget` (new, in the CI list) pins both directions against the loop's exported constant.
- Fixed: all three footprint execution tools named board-inspect as the only id source; they now also name
  `sirkit.selection.inspect` (move-footprint 1.1.1, rotate-side-footprint 1.2.1, arrange 1.1.1 — descriptions, id arguments and
  version notes; arguments, schema shape and reach unchanged). Artifacts regenerated: B04 tool-registry and provider parity, B09
  manifest (json + csv), activation audit, provider parity and replay fixtures, B11 evaluation results and replay-trace pins. The
  B01 fingerprint and the B17 inventory (581 controls) are unchanged. Pins moved: `b18-c-gateway-execution`, `b18-c-exposure-lift`.
- Added through the real loop (`b18-c-fixture-agent`): the same exact sentence a second time is previewed with the retry note and
  the board moves once; with nothing selected there is no grant and nothing changes. Composer pins for the mandatory sentences
  (`b18-d-composer-routing`): scenarios 1, 2, 3, 5, 6 ask; scenario 4 still routes to the schematic edit (E15).
- Reproduced first: `b18-c-exposure-lift` and `b18-c-gateway-execution` failed on the version bump (the pins they carry), and the
  budget test was written from measurements taken before it existed (70,173 / 72,453 against 60,000).
- Tests: the agent, engineering and route suites (144 files / 2366 tests) — the one failure was the b18-c-exposure-lift version pin, which moved with the bump and re-ran green in the broad run; broad run: 256 files / 3344 tests passed, 10 skipped (the 9 live Supabase matrix tests and the database-qualification test); tsc 0; eslint clean on the changed files.
- No local browser run for this increment: nothing the browser renders changed — the descriptor text is model-facing, and the
  scripted fixture agent never reads it — so a browser run would prove nothing here. CI's page-browser-e2e runs the full suite
  over this commit anyway.

### B18-E E4 — scenario 6's refresh, in integration (2026-09-11 local, solo; this commit)

- The runbook's scenario 6 is "Undo that," followed by refresh and redo. The refresh half had no integration proof: the harness
  kept one in-memory history for the whole scenario. `reloadEditor` (test-only) now reopens the project as the browser does — a
  fresh history over the persisted board, the EXACT canonical head restored from the verified claim and the same durable store,
  a new commit interlock, the durable grant store, journal and registry kept — and the test asserts the lineage is the same one.
- Proven: after the refresh the editor's own undo stack is gone (`canUndo` and `canRedo` false); "Undo that." answers
  `nothing_to_replay` because the latest AI change is itself an AI undo; "Redo." executes from the durable records (one new head,
  R3 restored, `executed` read from the settled record); a human change after the refresh makes "Redo." refuse, nothing changed.
- Found while writing it: session binding is synchronous but the lineage reopens on the session's queue, so the head is provable
  only after `whenIdle()`; the first reload returned too early and the run context could not be assembled (null head). A browser
  reload has the same shape — nothing may assume the canonical head before the session settles.
- Tests: b18-c-undo-redo 11/11 (the two new refresh cases); the seven harness-based B18-C suites 35/35; broad run: 256 files / 3346 tests passed, 10 skipped (the 9 live Supabase matrix tests and the database-qualification test); tsc 0; eslint clean. No browser run: this increment is test-only (the harness and its
  suite); CI's page-browser-e2e runs the full suite over this commit anyway.

### B18-E E5 — scenario 7's conditions, closed in integration (2026-09-11 local, solo; this commit)

- New `b18-e-scenario-7` (in the CI list) drives four of scenario 7's conditions through the real loop, gateway, minter, grant
  store, consume/settle services and the ritual over a real canonical session: a double call and a re-emission (one grant, one
  transaction); a cancelled run with the editor's auto-run held (the grant retired, a later tender refused, nothing committed); a
  tender the server refuses 403 (reported with its status, the journal entry abandoned, never consumed); and a coherent forgery
  (refused by the editor's recompile, burned `proposal_altered` by the server).
- Measured corrections to what was assumed: a provider's re-emission of the same call is refused `execution_exists`, not
  `repeated_call` (one side-effecting artifact per run is checked first); and a cancelled run retires its untendered explicit
  grant `run_unsettled` when the loop was awaiting its settlement — `run_cancelled` is the provider-wait window, which the Stop
  proof covers. D-A9's shorthand covers one window only; both are recorded here.
- Harness (test-only): a cancellation signal passed into the loop's run request, a held auto-run that collects the ritual instead
  of starting it, and a transport double that can refuse a tender as the route would.
- Tests: b18-e-scenario-7 4/4 (new); the eight harness-based B18-C suites 46/46; broad run: 257 files / 3350 tests passed, 10 skipped (the 9 live Supabase matrix tests and the database-qualification test); tsc 0; eslint clean. No browser run: this increment is test-only; CI's page-browser-e2e
  runs the full suite over this commit anyway.

### B18-E E6 — scenario 8: qualify, release and order are not reachable (2026-09-11 local, solo; this commit)

- Through the real loop (`b18-e-scenario-8`, new, in the CI list): five invented provider names — including two spellings of the
  release tool, a qualify name, an order name and a friendly-sounding one — are each refused `unknown_tool` with no tool started,
  no grant minted and the board and head untouched; a move carrying a nested delegation to a release tool is refused before it
  runs. At the seal (`b18-c-never-execution-sweep`): a Tier 3 command renamed as a reviewed execution is refused whatever the
  tool is called.
- Production route (defence in depth, narrowing only): `/api/pcb/qualify` refuses a non-human actor kind before any durable read
  with `MFG_QUALIFY_HUMAN_REQUIRED` (403, registered in the closed manufacturing-refusal vocabulary), mirroring the release
  route's long-standing check. No agent tool binds this route and the family is Tier 3, so the AI gains nothing; humans are
  unaffected (the role rows are untouched); no route is added — the ratchet stays 158 = 155 + 3 + 0. Pinned by
  `qualify-human-only` (the three non-human kinds refused, no durable read, a human passing the check) and by the B16.1C source
  tripwire.
- Tiers: `pcb.qualify-route` pinned Tier 3; the Tier 3 family floor matches the qualify spellings.
- Found while writing it: (a) the B16.1C tripwire's title and header said "155 route methods = 152 canonical" although its
  assertion has been 158 = 155 + 3 + 0 since B18-B added three canonical wrappers — the stale text is corrected; (b) not every
  Tier 3 command matches the family-name floor: `manufacturing.export-engineering` is Tier 3 by its release class.
- Tests: b18-e-scenario-8 6/6 and qualify-human-only 4/4 (both new; the qualify suite sits outside the broad set's paths, so it runs in the targeted set and the CI list); b18-c-never-execution-sweep with b18-a-permission-tiers 10/10; b16-1c-invariant-tripwires 7/7; broad run: 258 files / 3357 tests passed, 10 skipped (the 9 live Supabase matrix tests and the database-qualification test); tsc 0; eslint clean. No browser run: the change is a server route refusal and tests; CI's
  page-browser-e2e runs the full suite over this commit anyway.

### B18-E E7 — the scripted agent attempts Tier 3, a delegation and a double call (2026-09-11 local, solo; this commit)

- Why: the browser scenarios (E8-E9) need an agent that actually ATTEMPTS the forbidden call. The scripted adapter looked its tool
  up in the run's declarations first, so it could never emit an undeclared name; a Tier 3 phrase produced a sentence, which proves
  nothing about refusal.
- Added three fixture-only scripts to `app/lib/agent/fixture-agent-adapter.ts`: a forged raw provider name emitted WITHOUT the
  declaration lookup and carrying the interim success claim (release / qualify / order spellings); a move whose arguments smuggle
  `then: { toolId: "sirkit.manufacturing.release" }`; and the same execution call twice with distinct ids in one step. Reachability
  is unchanged - fixture runtime AND `SIRKIT_FIXTURE_AGENT=scripted` - and the B18-C gate plus the source scan (nothing in
  production constructs this adapter) stay green.
- Pinned end to end through the real loop in `b18-c-fixture-agent`: the forged Tier 3 call is refused `unknown_tool` with no tool
  started, no grant and an unchanged head; the double call mints exactly ONE grant and refuses the duplicate `execution_exists`,
  and because a silkscreen add has no explicit grammar the grant is `preview_then_confirm`, so nothing commits without a human.
- Measured, and a correction to the assumption I wrote the script from: the smuggled delegation does not reach an authority
  decision. move-footprint's own argument contract rejects the unknown key, so the call finishes `invalid_input` and the honest
  edit in the same sentence is lost too. Strict tool arguments are the outer wall; E6's gateway refusal is the inner one.
- Tests: b18-c-fixture-agent 10/10 (4 new); broad run: 258 files, 3361 passed, 10 expected skips; tsc 0; eslint clean. No browser run: this is fixture-only harness code plus tests, and the
  browser scenarios that use it are E8-E9.

### B18-E E8 — the browser, part 1: scenario 6 on a move, the retry guard, the binding, the double call (2026-09-11 local, solo; this commit)

- Three cases added to `e2e/agent-execution.spec.ts` against the REAL application (fixture runtime, scripted agent; every
  authority check runs for real). No production code changed in this increment.
- Scenario 6 on a MOVE, which the browser had only proven on a silkscreen add: an explicit move with no card, "Undo that." as
  a replay grant that is its own history entry, a RELOAD, then "Redo." resolved from the durable records — the board ends at
  the moved position.
- The retry guard in the browser (7e): the same sentence again is a CARD with the minter's note even under explicit autonomy.
- Measured while writing it, and it corrected the case: the confirmation card is a MODAL dialog. With one open the editor is
  unreachable — the first version of this test tried to change the selection under the card and spent its full 300 s timeout
  with the dialog intercepting every click on the editor's own control. So a selection cannot drift under a pending preview in
  this session at all; the browser case now pins the modality (a trial click on the editor is refused) and that Confirm commits
  the bound move. 7a's real claim — targets are bound by id, never by the selection — stays proven in the unit and integration
  suites, where that burn is reachable. It also constrains E9: revision drift under an open card can only be driven from
  another session, not from this page.
- The double call in the browser (7c): E7's two-calls-in-one-step script yields ONE card, ONE entry, a run log line saying the
  duplicate was refused before running (`execution_exists`), and exactly one committed transaction.
- Browser run: agent-execution 19/19 (3 new), 6.8 min, port 3100. Broad vitest: not re-run for this increment: no source file changed (only the browser spec and records); E7's broad run at 9cdf842 was green and CI runs the full set on this commit; tsc 0; eslint clean. Evidence: two new PNGs; re-taken PNGs from unchanged cases
  were restored so the committed evidence changes only where the proof changed.

### B18-E E9 — the browser, part 2: a claim with nothing behind it, Tier 3, a delegation, a forged handle (2026-09-11 local, solo; this commit)

- Defect found and reproduced on pre-fix code: a run that CLAIMED a change and prepared none (E7's forged Tier 3 call and its
  smuggled delegation) left the claim standing. Rule 2 labelled it as written-before-the-result, but there was no execution
  entry to read and no label on the answer, because every existing label assumed a pending execution or review.
- Fix (production, display only): `LABEL_NOTHING_CHANGED` in `chat-run-view.ts` — when a run ends having written interim text
  and having prepared nothing at all (no execution pending/received/dropped, no review), the page labels the answer with its
  OWN sentence saying nothing was changed and pointing at the run log. Pinned by `b18-e-claimed-nothing` (the two refusal
  shapes; that it never displaces `LABEL_BEFORE_CHANGE`, `LABEL_DROPPED` or `LABEL_BEFORE_REVIEW`; that it is silent for runs
  that made no claim, are still running, or really committed).
- Browser (real app, scripted agent): scenario 8 refused `unknown_tool` with no card, no entry, nothing committed and the
  claim absent from the next request's history; the delegation refused `invalid_input` with the honest edit lost too; a grant
  whose HANDLE was rewritten in transit passes the page's checks and is refused by the server at the tender — the entry ends
  not_made, never "landed, unverified", and the board is untouched.
- Second finding, in the test harness itself: the S5 observer records the states of EVERY execution entry in the chat log, not
  the entry belonging to the run that wrote the claim. Its clause "an execution entry existed" has therefore been trivially
  true for every claim since the first entry existed. The invariant now asserts what is genuinely checkable chat-wide, and the
  per-run truth (no entry added; the page's contradiction visible) is pinned in each refusal run's own test.
- Deferred with a reason (new row E9b): 7b's stale revision at the card and 7g's altered operations past the page's receiver.
  E8 measured that the card is MODAL, so drift cannot be driven from the same page; both need a second session or a rewritten
  digest set, and they are their own increment rather than a rushed addition here.
- Browser run: agent-execution 22/22 (3 new), 7.8 min; tests: b18-e-claimed-nothing 4/4 (new) plus the run-view and fixture-agent suites, 41/41; broad run: 259 files, 3365 passed, 10 expected skips; tsc 0; eslint clean.

### B18-E E9b — the browser, part 3: a stale base at the card, altered operations past the receiver (2026-09-11 local, solo; this commit)

- Read first, then written: the page's SAFE receiver (`execution-grant-events.ts` + `verifyPublicGrantCoherence`) verifies
  COHERENCE — recomputed operations/targets/preview digests, the decision, the lifetime — and cannot verify the grant against
  the server's record. Both E9b cases exploit exactly that, so each lands on the layer that is supposed to catch it.
- 7b in the browser: the grant's recorded base PCB revision is rewritten in transit (a field no digest covers) to one the
  editor is not on — the condition a concurrent edit produces. The card appears and the EDITOR refuses it: Confirm disabled,
  the reason stated on the card (revision_drift: 'the live board changed since the grant was issued - ask again.'), nothing committed, and Cancel leaves the board untouched.
- 7g in the browser: an operation's text is replaced and the operations and preview digests are recomputed, so the page cannot
  fault the grant; the human still sees the minted preview. Confirm tenders it and the SERVER refuses — the entry ends
  not committed and not landed_unverified, nothing is committed, and neither text reaches the board.
- No production code changed in this increment. Browser run: agent-execution 24/24 (2 new), 9.0 min; tsc 0; eslint clean; the vitest suites are untouched (E9's
  broad run at db09732 was green and CI runs the full set on this commit).
- Not dismissed as a flake: the FIRST run of these cases reported one failure — E8's scenario-6 case timed out waiting for a
  chat reply — and the evidence says the host suspended: that single test reported 25.2 minutes and the whole suite 30.3
  (against ~8 minutes for the identical code in the three preceding runs), and this session's own wall clock jumped 25 minutes
  with no work in between. The E9 CI watch died in the same window with "error connecting to api.github.com" (its two
  workflows were green when re-read). The suite was re-run on the same commit and is recorded above.

### B18-E E10 — scenario 3, part 1: the mounting-hole classification and the dimension plan (2026-09-11 local, solo; this commit)

- Read before writing: `sirkit.pcb.measure` is a view command (its readout never reaches the model) and the board-inspect
  snapshot listed `padIds` without pad TYPES — so nothing agent-visible could tell a mounting hole from a pad, and half of
  scenario 3's sentence was unanswerable except by guessing.
- Production change (one bounded Tier 0 read, under the exposure review): every snapshot footprint carries `mountingHole` —
  true when it has physical pads and they are ALL `np_thru_hole`, exactly OD-21's default. It is a classification of pads the
  snapshot already lists: no new geometry, no new authority, one boolean per footprint. `sirkit.pcb.board-inspect` 1.0.0 ->
  1.1.0 with the reason in its version notes and description; the B04/B09/B11 manifests are regenerated from the catalog.
- Harness: the scripted agent gains a `board-then` script for the runbook's exact sentence — board-inspect FIRST, then
  `pcb.dimension` built from the outline the snapshot returned (2 mm clear), plus one dimension per classified hole; a
  snapshot without an outline is answered in words rather than dimensioned at invented coordinates.
- Proven end to end (`b18-e-scenario-3`, new, in the CI list): the run reads then dimensions, mints ONE grant that is
  `preview_then_confirm` even under `execute_explicit_tier1` (OD-11), runs no ritual, and does not move the head; its two
  operations are `add_dimension` at the board's real corners, asserted against the snapshot's own outline. The fixture board
  has no mounting holes, so nothing is added for them — the truthful answer to that half of the sentence.
- Tests: b18-e-scenario-3 3/3 (new), plus b10-editor-context and b05-read-invocation re-verified; broad run: 260 files, 3368 passed, 10 expected skips (after the two consequences were fixed); tsc 0; eslint clean; five generators re-run (agent artifacts, tool registry, B11,
  toolability matrix, read-invocation fixtures). Browser: E11.
- Two consequences the broad run caught, both fixed rather than excused: the B05 read-replay fixtures are generated from the
  registry, so the version bump made them byte-inconsistent until `generate-read-invocation-artifacts` was re-run; and the B10
  context-integrity test invoked board-inspect by version, so its pin moved to 1.1.0 (it still asserts the same refusal).

### B18-E E11 — scenario 3, part 2: the browser proof and the routed-board read limit (2026-09-11 local, solo; this commit)

- Browser (real app, scripted agent): the runbook's sentence yields a confirmation CARD even under `execute_explicit_tier1`
  (OD-11), naming `pcb.dimension` with exactly two operations; Confirm commits ONE transaction, the entry ends `committed`,
  and the next chat snapshot carries exactly `horizontal` and `vertical` dimensions with no footprint moved. No hole dimension
  is added because the board has none.
- Recorded limit (harness limits, with numbers): the dimension plan depends on the board-inspect snapshot, measured in E3 at
  40,410 characters on the placed board against a 60,000-character result budget but 70,173 / 72,453 once routed. Scenario 3 is
  proven on the placed board; on a routed board the read would be refused as oversized and a bounded mechanical read would be
  needed. No production change was made for that case in this chapter.
- The browser helper now reads `dimensions` out of the editor context the chat request already carries, so the proof is the
  editor's own working copy rather than the UI's wording. Browser run: agent-execution 25/25 (1 new), 10.9 min; broad run: 260 files, 3368 passed, 10 expected skips; tsc 0; eslint clean.
- Found by RUNNING it, twice, and fixed rather than worked around. First: the synchronized board's outline is a POLYGON, which
  states points rather than a size, so the plan read "no outline" and truthfully did nothing. Second, and the real cause: the
  full board-inspect snapshot on that board exceeds the model's 60,000-character result budget, so the read returns
  `output_too_large_for_model` and no plan is possible. The answer is the bounded mechanical read the chapter's plan
  anticipated — `sirkit.pcb.mechanical-inspect` (Tier 0): the outline (kind, origin, size, up to 64 vertices with the true
  count) and the mounting holes (id, reference, position, bounds), and nothing else; a unit pin measures it at under a
  twentieth of the full snapshot. It states nothing the full snapshot did not; it exists because that one does not fit.
- The exposure is a REVIEWED addition in `agent-exposure.ts` with its reason. Four gates pin that set and all four were updated
  to name the new id — B09.1's declaration count, B17-F's "additions are exactly these" filter, B18-C's "additions beyond the
  B17 baseline are exactly the granted executions", and B10's exposure test (whose title named a number and now names the
  reviewed list). None was loosened into a count or a pattern.
- The B11 evaluation cases pin the tools each context discovers; the new read was added to their ALL_READS list and all 19
  cases / 60 checks pass. Five artifact generators were re-run.
- Recorded about this branch's history: commit `5c9d656` (E10) is RED on benchmark-quality — it bumped the board-inspect tool
  version but left out the regenerated read-replay fixtures and the test that pins that version. `781c1a4`, the very next
  commit, adds exactly those two files. The branch tip is what merges; the red commit in the middle is stated, not hidden.

### B18-E E12 — scenario 2, part 1: Tier 2 truth in the review and in the chat (2026-09-12 local, solo; this commit)

- Discovery first, and wide: five parallel readers over the bounded-proposal path, the via facts an agent can actually see,
  the fixture boards, the human review/chat surfaces and the existing tests (106 findings, 46 gaps, every claim carrying a
  file:line). Two of the gaps are defects in what the HUMAN is told, and this increment fixes exactly those two.
- The Tier 2 review did not state what it was asking approval for: a via operation read `Update via v1`, with the new
  diameter and drill nowhere on the dialog. It now reads `Update via v1 — 0.700 mm pad / 0.350 mm drill` — the RESULTANT
  pair, the padstack when one is imposed, the position when it moves. Proven on the real rendered `PcbProposalReviewDialog`
  fed by a proposal a real run sealed, not on the compiler's string.
- A blocked Tier 2 proposal read `refused (proposal_blocked)` in the chat: a code, no statement that nothing was changed,
  and no reason. The reason existed — the compiler writes a precise sentence naming the via, the padstack and the human
  fork — but it went only to the MODEL, so the human depended on the model relaying it. The line is now plain words plus
  "nothing was changed", and the server's reason rides `tool_finished.reason` (refusals only, capped, never on a success,
  never in the trace) so the page states it itself. That is the B18-D standard applied to Tier 2.
- Pinned because it decides what part 2 must build: a board LOAD binds every via to a padstack, so `padstack-bound` is
  scenario 2's normal outcome on any real board, and the unbound via shape under which a resize compiles cannot survive a
  load. 0.7/0.35 is no seeded padstack and no proposal operation can create one, so the literal request is reachable only
  through the human fork the refusal already names.
- First time an `update_via` payload travelled the real loop and gateway (every prior bounded-PCB proof used
  `update_track`): one `pcb_proposal_ready`, zero grants, the board byte-identical, the answer carrying the page's own
  before-review label.
- Stated rather than silently left: `update_track`, `update_dimension` and `update_keepout` still summarize without their
  values, and rejecting a Tier 2 proposal still produces nothing the human or the chat can see. Both are outside scenario
  2's path and are named for a later increment rather than folded in here.
- Tests: b18-e-scenario-2 12/12 (new, added to the CI list); broad run: 261 files, 3380 passed, 10 expected skips; tsc 0; eslint clean.
- E11's CI: green at `07385e1` (deterministic-manufacturing 34674307925 and benchmark-quality 34674307838, both success).

### B18-E E13 — scenario 2, part 2: the facts a via plan needs (2026-09-12 local, solo; this commit)

- The model could not plan this scenario at all. Vias exist only on a routed board, whose full snapshot exceeds the result
  budget; and the snapshot strips `padstackId` and carries no padstack library, so the fact that decides the outcome was
  invisible and the retarget targets were invisible with it. The only way to learn the constraint was to be refused.
- `sirkit.pcb.via-inspect` (Tier 0 read, reviewed in `agent-exposure.ts` with its reason): the nets that carry vias, one
  named net's vias with the padstack each is bound to, and the board's via padstack library. Nothing else; every list capped
  beside its true count; measured under a tenth of the budget on the recorded routed boards where the full snapshot is over
  it. It states no DRC floor — those belong to a preset a pure board read does not receive, and a guess is not a fact.
- The net name is matched exactly and a miss is a miss: `net: null` plus every via-bearing net. That makes OD-20's truthful
  no-match a mechanism instead of a promise — "the 5 V net" finds nothing on a board whose rail is `/root/VCC`.
- The B18-C harness board can now hold the scenario: `fixtureBoard({ vias: true })` seeds that rail, four vias, and runs the
  same padstack normalization a board LOAD runs, so every via is bound as reality leaves it.
- Proven through the real loop and gateway, read first: the no-match run changes nothing and seals nothing; a proposal built
  FROM the read seals the lawful retarget; the resize the sentence literally asks for is blocked and the chat line carries
  the padstack reason E12 added.
- Four exposure gates updated to NAME the read, never loosened to a count; B11 evaluation 19/19 cases and 61/61 checks; six
  artifact manifests regenerated; the 158-route ratchet untouched (a tool, not a route).
- Tests: b18-e-via-facts 9/9 (new, added to the CI list); broad run: 262 files, 3389 passed, 10 expected skips; tsc 0; eslint clean.
- E12's CI: green at `9f22e6f` (deterministic-manufacturing 34675746967 and benchmark-quality 34675746960, both success).

### B18-E E14 — scenario 2, part 3: the scripted via plan, and the browser's honest half (2026-09-12 local, solo; this commit)

- The scripted agent now reads the vias before it answers anything. Its plan is built from the read's four real outcomes:
  no such net, vias whose geometry belongs to a padstack the asked-for pair is not, more vias than one proposal holds, and
  the case where the change really is proposable. A second grammar asks for the lawful move directly — retarget a net's
  vias onto a padstack that already exists.
- Five harness cases on the via-bearing board: the verbatim sentence names the rail the board really has and changes
  nothing; asked by that name the refusal names the bound padstack, the padstacks that exist and where the human fork
  lives; the lawful ask seals ONE proposal whose review lines carry E12's geometry; no run mints a grant or moves the head.
- The browser (agent-execution, 26/26): the run log shows the bounded via read running for real and the answer is "this
  board has no vias at all… Nothing was changed" — no card, no proposal, no transaction, nothing moved. Evidence PNG
  committed.
- Found by running it: the browser journey's board CANNOT be routed on this machine. Qualification answers
  `ROUTE_FIXTURE_MISS:pcb2-d5bd2f299ef57ca0 (recorded: 2)` and writes nothing durable, and re-recording needs the real
  bundled FreeRouting, which needs a JRE this machine does not have. Recorded as LB-8 and as a harness limit, with the
  measured revision and the two recorded executions — not worked around. Nothing was fabricated into the route fixture and
  no assertion was softened to make a routed board appear; a draft spec that assumed one was deleted rather than left
  half-passing.
- Tests: b18-c-fixture-agent 15/15 (5 new); browser: 26/26 (1 new), 4.5 min; broad run: 262 files, 3394 passed, 10 expected skips; tsc 0; eslint clean.
- E13's CI: green at `4342c91` (deterministic-manufacturing 34676531955 and benchmark-quality 34676531968, both success).

### B18-E E15 — scenario 4, part 1: the sentence reaches the assistant, and the chat says what happened (2026-09-12 local, solo; this commit)

- Discovery first: five parallel readers over the sealed replacement path, the component-authority source, the composer and
  loop, the human surfaces and the existing tests (64 findings, 36 gaps, every claim with a file:line). B14's artifact,
  gateway contract and human apply are proven densely already and were left alone.
- The runbook's scenario-4 sentence did not reach the assistant: the composer routed it to the legacy schematic edit route,
  which knows nothing about component authority or replacement. So the scenario was unreachable through the product. A part
  SWAP now routes to the assistant; a value change still belongs to the schematic editor, and both are pinned.
- The only route-level proof hard-coded the component id and used a different sentence. The runbook's sentence now travels
  the REAL /api/chat handler: the provider READS the schematic to resolve "U1", then sends only that id. Every identity in
  the sealed target comes from the server-owned authority and is asserted never to appear in the model's arguments.
- The chat was silent on two of the four outcomes: a refused apply was a transient toast (the run log went on saying a
  proposal awaited review), and a cancel said nothing. All four sentences are now one tested pure function the page calls,
  and the missing two reach the chat — the same standard E12 applied to the PCB path.
- "the approved lower-power part": the authority record carries no power fact, so nothing may call the target lower-power.
  The page states what is true — the part, the manufacturer, that the project's authority records it, the connections kept,
  none dropped, nothing changed — and a test pins that no power claim appears in that sentence or in the model's result.
- Corrected a sentence in the chapter record rather than proving it verbatim: "the model never chooses the target" was
  wrong; the model names the component, never the part.
- Found and fixed before committing: a scripted edit had rewritten `app/page.tsx` line endings CRLF-wide, which broke a
  B16.0.2 source gate locally. The working tree was normalized back to LF; the earlier commits on this branch are clean
  (git normalized them on commit, verified against HEAD).
- Tests: b18-e-scenario-4-route 6/6, b18-e-scenario-4-chat 8/8 (both new, added to the CI list); broad run: 264 files, 3407 passed, 10 expected skips;
  tsc 0; eslint clean on the changed files (page.tsx's pre-existing react-hooks findings unchanged in count).
- E14's CI: green at `40b22dd` (deterministic-manufacturing 34677824967 and benchmark-quality 34677824886, both success).

### B18-E E16 — scenario 4, part 2: the fixture's missing authority, and a real defect behind it (2026-09-12 local, solo; this commit)

- The fixture runtime had no component-authority source: both `/api/chat` sources are gated on `DATABASE_URL`, which the
  fixture launchers blank. So the replacement tool was withheld from every browser run and scenario 4 was unreachable in
  the real application. Two fixture sources now supply the same server-owned reads from the stores the fixture already
  fills, behind the same gate as every other seam. Nothing is invented — an unbound component resolves to no authority.
- The scripted agent reads the schematic to resolve "U1" and then names only the component; it can never name the part.
- Browser, end to end: the sentence seals a Tier 2 replacement, the dialog shows the part the AUTHORITY records with its
  connection outcome and its destructive-tier warning, Cancel changes nothing (and now says so), and Apply commits ONE
  canonical transaction reported as verified and undoable.
- A REAL production defect, found by running it and fixed: the apply recompiles the proposal and requires a byte match,
  but the seal and the apply load different BREADTHS of component authority (every component vs the one being replaced),
  and the whole record set was sealed into the authority envelope whose digest feeds the grant id inside the operation.
  Any project with more than one bound component refused every apply. The envelope now carries only the replaced
  component's authority. Reproduced independently at the assembler first; 77 replacement tests pass after the fix.
- A duplicated sentence in the chat ("Nothing was changed. Nothing was changed.") was found the same way and fixed.
- OD-23's pre-authorized fixture-only CMOS part was NOT needed and was not added: the journey's own authority already
  yields a real replacement. Recorded as an annotation on OD-23 rather than a silent deviation.
- Corrected from E15's own record: it said `b18-e-scenario-4-chat 8/8`; the file has 7 tests. The count was wrong.
- Tests: b18-e-fixture-authority 6/6, b18-e-replacement-apply-breadth 3/3 (new), b18-c-fixture-agent 19/19 (4 new);
  browser agent-execution 28/28 (2 new), 4.8 min; broad run: 266 files, 3420 passed, 10 expected skips; tsc 0; eslint clean.
- E15's CI: green at `beee5c9` (deterministic-manufacturing 34678943429 and benchmark-quality 34678943506, both success).

### B18-E E17 — scenario 5, part 1: what a layout candidate is allowed to say (2026-09-12 local, solo; this commit)

- Discovery first: five readers over the candidate path, the routing seam, the objective vocabulary, the agent surfaces
  and the existing tests (72 findings, 31 gaps). The Tier 2 contract beneath the scenario is strong and was left alone.
- The scenario's last clause was unanswered by everything except the editor panel. A routing candidate knows, per
  unresolved connection, the net, the reason, the blockers and the suggested repair; the model got a count and the person
  got nothing. Both now get the failures themselves, bounded, with the true count beside them.
- An objective the engine could not evaluate was invisible, which reads as a pass. Every objective's state is now
  reported, including unknown and unsupported ones, by name.
- OD-24 said the chat should report truthfully rather than widen the agent's controls. The tools genuinely have no
  compactness, spacing or objective-weight argument, so the note now says so and a test pins it against the real argument
  surface — a run can never report a board as having been made compact.
- "Placement and routing take turns" was a claim in the chapter record that had never been run; it runs now (one
  candidate, the second call refused `proposal_exists`, nothing changed).
- `routing-server.ts` and the page's SAFE receiver for layout candidates had no tests at all. Both do now, including
  scenario 7g's altered-artifact invariant for this artifact type.
- Tests: b18-e-scenario-5 10/10 (new, added to the CI list); broad run: 267 files, 3430 passed, 10 expected skips; tsc 0; eslint clean.
- E16's CI: green at `48c3576` (deterministic-manufacturing 34680864313 and benchmark-quality 34680864293, both success).

### B18-E E18 — scenario 5, part 2: the scripted layout plan and the browser (2026-09-12 local, solo; this commit)

- The scripted agent turns the runbook's sentence into a bounded placement proposal and then ATTEMPTS the routing the
  sentence also asked for; the loop's one-artifact rule refuses it and the agent says so, rather than silently dropping
  half the request.
- The two clauses the product cannot honour are answered in words (OD-24): no compactness or decoupling control exists on
  these tools, so the answer states that plainly instead of implying the board was made compact. Objectives that could not
  be evaluated are named and called unknown, never met.
- Browser: the sentence produces the T2 line, the page's candidate sentence and that answer, with no grant card, no
  transaction and nothing moved. Evidence PNG committed.
- Two things found by running it. The unevaluated objectives were reported by internal id rather than by kind —
  unreadable to a person, meaningless to a model. And the agent's own failure sentence said "I could not produce a
  placement candidate" without saying why, which is the same silence this increment is about; it names the tool's
  status now. Both fixed and pinned.
- That second fix is how the next fact was measured: on the freshly synchronized board the bounded search returns a
  candidate, but asked at the end of the browser journey — after 26 cases have moved, flipped and annotated the
  board — the same search truthfully answers `no_candidate`. The browser case runs first for that reason (a candidate
  is inert and disturbs no later case), and the refusal wording is pinned in the unit tests rather than arranged away.
- The scripted plan asks for the smallest honest search (2 candidates, 20 iterations) so the browser case fits CI's
  budget rather than running the placement engine's full default search.
- Recorded with numbers because it cost real time: this machine reached 34.1 GB committed of a 36.5 GB limit with ~0 GB
  free physical while E18 was being verified, and the browser suite became unreliable — 15.7 minutes instead of 4.4
  with a failure in its first test, a 300 s timeout in the Undo/Redo-wait case, once no fixture banner at all. With
  memory free it passes 29/29 in 11.3 minutes. No product change lies between those runs; CI runs it on a clean runner.
- Tests: b18-c-fixture-agent 23/23 (4 new); browser agent-execution 29/29 (1 new), 11.3 min; broad run: 267 files, 3434 passed, 10 expected skips; tsc 0; eslint clean.
- E17's CI: green at `313eafa` (deterministic-manufacturing 34681917386 and benchmark-quality 34681917398, both success).

### B18-E E19 — closeout: all eight scenarios proven (2026-09-12 local, solo; this commit)

- `scenarios.md` closes with §7: the FINAL level of every mandatory scenario (unit, integration, browser), what carries
  it, and what is not proven with the reason. Every increment E1–E18 is CONFIRMED in §6 with what it actually ran.
- All eight scenarios are proven at all three levels. The browser suite is 29 cases (`e2e/agent-execution.spec.ts`) with
  20 evidence screenshots; the broad unit run is 267 files / 3434 tests.
- Three product defects were found by proving the scenarios, each fixed with a regression that fails on the pre-fix code:
  a run could claim a change with nothing contradicting it (E9); scenario 3 was unreachable in the real app because the
  only board read exceeds the model's result budget (E11); and a sealed component replacement could never be applied on
  any project with more than one bound component (E16) — invisible to every unit test because both sides used
  single-record fixtures. Two further truthfulness defects were fixed where the human reads them (E12, E15).
- Nothing was weakened to get here: the exposure ratchet names each new read in the one reviewed list, the 158-route
  ratchet is untouched, no Tier 2 path became a grant, and no agent control was widened (OD-24).
- Chapter totals against the base `804a08d`: 82 commits, 240 files, +22,240/-397 lines, 76 new test files.
- Next: B18 validation artifacts, then PR #8 ready and a normal merge after green CI.

### B18 validation — the adversarial pass, and the verdict (2026-09-12 local, solo; this commit)

- Before writing a verdict, six verifiers were each given ONE load-bearing B18 claim and told to REFUTE it from the
  source (workflow `wf_d1783a33-a63`). Three could not: Tier 3 inaccessible (nine attack routes, each dead-ending on an
  independently enforced mechanism), Tier 2 human-only, and the exposure set exactly the reviewed list.
- Three did. All three were acted on: the chat's "nothing was changed" label keyed on the model having written prose
  beside the call, so an ordinary "Done." in the final answer went unlabelled AND became the next run's history — while
  the same rule fired on innocent read-only runs; a landed granted execution could be settled NOT COMMITTED after a
  lineage rebase, because reopening a lineage replaces the canonical transaction log wholesale and absence of evidence
  was read as evidence of absence; and two rows of the closeout table overstated what the browser carries. Each is fixed
  or corrected, with regressions that fail on the pre-fix code.
- CI then caught one more that a local run had not: the browser spec kept its own COPY of the label sentence. The spec
  imports the constant now. That commit (`bd4aaf5`) is the one red commit on this branch and the next commit fixes it.
- Five further observations with no live path are RECORDED as F18-1 to F18-5 with file:line, not closed by assertion.
  The one tier boundary B18 moved (`pcb.dimension`, OD-13/OD-11) is stated plainly rather than left inside "no ratchet
  was loosened".
- Validation artifacts: `test-and-validation-report.md`, `changed-files.md`, `unknowns-and-owner-decisions.md`,
  `final-verdict.md`. Verdict: **B18 PASSES its deterministic gate.**
- Measured on the final tree: broad 268 files / 3439 passed / 10 expected skips; browser 29/29 in 11.1 min; tsc 0;
  eslint clean; seven generators idempotent with zero drift; 158-route ratchet and the exposure ratchet intact.

### B19 — chapter start and discovery (2026-09-12 local, solo; this commit)

- B18 merged normally into `main` as `5a59a1f` (PR #8) with both workflows green on `cf8ad68`. B19 opens from that base
  on `chapter/b19-external-acquisition`.
- Discovery by six parallel read-only readers (workflow `wf_30aa690a-0c4`): the connectors, the outbound boundary, the
  quarantine-to-authority pipeline, inbound import security, the product/agent surfaces and the existing tests — 113
  findings, 53 gaps, every claim with a file:line. Recorded in `artifacts/ai-control-plane-b19/discovery.md`.
- What exists: three live distributor clients (DigiKey V4 OAuth, Mouser v1, Nexar GraphQL) and an LCSC stub, all in one
  directory; the back half of the authority pipeline (atomic revisions, mapping certificates, physical bindings) is
  strong; there is NO purchase path anywhere, which is the state the runbook wants kept.
- The most useful single finding: a complete, unit-tested SSRF guard already exists (`app/lib/atomic/security.ts:121`)
  with ZERO production callers, and a bounded response reader exists that no server-side outbound call uses. B19 wires
  them rather than writing new ones — with two gaps to close while wiring (hostname-string validation with no resolved-IP
  check; an IPv4-only private-range table).
- Seven defects recorded to reproduce first: a PUBLIC, CSRF-free `/api/bom` whose caller-supplied `forceRefresh` can
  drain a paid monthly quota anonymously; that route reflecting raw distributor errors; the Mouser API key travelling in
  the URL query string; no timeout on any distributor call; unbounded response reads everywhere; the cross-verify
  endpoint following redirects with its bearer attached and reflecting 200 bytes of the remote body; and license enforced
  at publication but not at export.
- Increments I1–I7 planned in `discovery.md` §4, one per runbook checkpoint plus validation.

### B19 I1 — one bounded, validated egress path for acquisition sources (2026-09-13 local, solo; this commit)

- Built on what already existed rather than beside it: the SSRF guard with no production callers and the bounded stream
  reader no server-side outbound call used are now wired into one path, `app/lib/net/outbound-fetch.ts`, which never
  throws and returns a closed code with a redacted sentence.
- Every request: HTTPS only, no URL credentials, the source's exact allowlisted host, a name and EVERY resolved address
  outside loopback / link-local (incl. cloud metadata) / private / CGNAT / ULA / multicast, one hard deadline over
  resolution through body, a bounded read, a media-type check, and no implicit redirect — each hop revalidated, bounded,
  credentials never crossing an origin, and a request carrying a secret in its URL never redirected at all.
- Three gaps reproduced before they were fixed. The existing guard's private-range table was IPv4-only, so an allowlisted
  `[::1]`, `[fd00::1]`, `[::ffff:127.0.0.1]` or `100.64.0.1` passed. Closing that exposed a subtler one: the URL parser
  REWRITES `[::ffff:127.0.0.1]` to `[::ffff:7f00:1]` before any check sees it, so IPv6 is now read as numbers. And a
  resolver that never answered ignored the deadline; resolution now races the same abort.
- A limit stated rather than claimed: addresses are checked at admission and the transport resolves again at connect, so
  a sub-connect rebinding window is not excluded by this module; the exact-host allowlists close it in practice, and
  pinning the connection is recorded as a follow-up.
- DigiKey (token + search), Mouser and Nexar now call only their own host through per-source policies (15/15/20 s, 2/2/4 MB,
  no redirects, JSON only), and log only the boundary's sentence instead of the raw error object.
- Corrected a discovery finding instead of "fixing" it: Mouser's current documentation authenticates the Search API with
  an `apiKey` query parameter by design. It is contained — declared a secret, never logged or messaged, never redirected.
- Measured while writing the client suite: run against the unwired clients, the seam did not exist and they used the real
  global fetch with dummy credentials, so some cases passed only because a real call failed fast. Only the failing cases
  were genuine reproductions. The suite now poisons the global fetch so a bypass can never pass silently.
- `/api/schematic/cross-verify`'s credential-carrying redirects and body reflection (D19-6) moved to I2 with `/api/bom`'s
  error reflection, where the two route-level fixes are reproduced together.
- Tests: b19-outbound-fetch 19/19 and b19-distributor-egress 8/8 (both new, in the CI list); the existing atomic security
  suites unchanged and green; broad run: 279 files, 3569 passed, 10 expected skips; tsc 0; eslint clean on the changed files (one pre-existing warning in
  the untouched `lcsc.ts`).

### B19 I2 — who may spend paid quota, and what a failure may say (2026-09-13 local, solo; this commit)

- Reproduction widened D19-1: six public BOM routes priced live (the workbench, the CSV export, the procurement packet and
  three carts), and the server resolves part ids to catalog MPNs, so an anonymous caller spent quota on real parts. The
  pricing layer had no notion of a caller.
- Live pricing is now a capability the caller must be granted: `getPricingFor` serves the cache unless `live: true`, and
  `forceRefresh` means nothing without it. The safe value is the default.
- `/api/bom` is an authenticated project read declared `providerCredit: true` and is the route that asks for live pricing;
  snapshot and diff (already authenticated) ask explicitly; the export and cart routes stay public and cache-only.
- D19-2 was wider too: every BOM route repeated a failure's message. All nine now answer with a fixed sentence and log a
  redacted, bounded line.
- The workbench sends its project scope, and says why when there is no project.
- Reviewed pin moves (strengthenings) in b16-0-4, b16-0-5 and b16-0-11; three route CSVs regenerated, one row each; the
  migration ratchet unchanged at 158.
- A vacuous pass recorded: the five public-route cases passed against the old code; the pricing-layer test is the real
  reproduction.
- A pre-existing isolated timeout (chat-surface revocation) proven unrelated by stashing I2; follow-up filed, not called a
  flake.
- Not proven here: the workbench in a browser (no spec reaches it; the dev server was stopped before it could spend real
  quota). Carried by I6. Owner decision OD-31 recorded.
- `/api/schematic/cross-verify` (D19-6) is I2b.
- Tests: b19-pricing-live-gate 4/4 and b19-bom-quota 12/12 (both new, in the CI list); the moved pins, the migration
  ratchet and invariant tripwires 171/171; the route artifact and control-inventory gates 51/51; broad run: 281 files,
  3585 passed, 10 expected skips; tsc 0 in the changed areas; eslint: no new findings.

### B19 I2b — the second opinion's outbound call through the same boundary (2026-09-13 local, solo; this commit)

- Measured before changing anything (two loopback servers, a dummy bearer, Node 24.15): the old cross-verify call followed
  a redirect to any address and re-sent the prompt there; Node dropped the bearer on the cross-origin hop and kept it on a
  same-origin one; the caller was told the final hop's status and first 200 bytes of its body. Discovery's D19-6 is
  corrected accordingly (the bearer did not cross origins; the rest was real).
- Reproduced in the suite: 9 of 12 route cases failed against the old route. One harness mistake (a default parameter
  filling in the endpoint for the "unconfigured" case) was found and fixed before recording. The log-token case is
  vacuous on the old code, which logged nothing.
- The call now goes through `outboundFetch` in `app/lib/schgen/endpoint-client.ts`: HTTPS, the configured host only, no
  inward address, no redirects, 240 s per attempt, 1 MB, JSON; the 503 retry bounded at 3 attempts and 300 s total;
  configuration read per request; a closed failure with a fixed sentence to the caller and a redacted log line.
- Tests: b19-cross-verify-egress 12/12 and b19-schgen-endpoint-client 14/14 (both new, in the CI list); the B16.0.10
  cross-verify pins unchanged; broad run (now including app/lib/schgen and app/api/schematic): 284 files, 3620 passed,
  10 expected skips; tsc 0 in the changed areas; eslint clean on the changed files.

### B19 I3 — the versioned source registry, enforced (2026-09-13 local, solo; this commit)

- Read the vendors' own current documentation first (DigiKey developer portal and API agreement, Mouser's Search API
  specifications and terms, Nexar's support articles, plans and legal terms, LCSC's Open API docs); every fact in the
  registry cites them, and anything they do not state is UNKNOWN.
- `app/lib/acquisition/source-registry.ts` (1.0.0) records, per source: identity and API version, exact hosts and
  operations, authentication method and secret REFERENCES, observations, quota, deadline/body/redirect/spacing/retry/
  breaker, freshness, storage and retention, bulk refresh, redistribution and export disposition, attribution, region,
  source and authority class, and state. `source-registry.csv` is its generated, byte-gated render.
- The connectors read it: egress policies, admission (blocked never; disabled only by a reviewed change; operator can
  only switch off), request spacing, freshness, storage, retention purge, bulk refresh, and the BOM's unavailable-source
  sentences.
- Checking the documentation found, and reproduction confirmed before each fix: DigiKey requests 214/203 ms apart
  against a 120-a-minute limit (now 500 ms); Mouser offers persisted despite a no-storage clause; every stored row served
  24 h and kept forever (DigiKey now 1 h, Nexar 24 h, purged past retention, one serving rule for every reader);
  Mouser used whenever its key was set despite its terms (now disabled, OD-32).
- A regression I2 introduced, found while reading every reader of stored offers: the operator refresh job passed only
  `forceRefresh`, so it silently refreshed nothing after live pricing became a grant. It is now granted live pricing as
  a declared bulk refresh, which touches only sources whose terms permit it (none today, OD-33) and says so.
- A claim corrected before recording: the Mouser client never memoized answers (that case passes on the old client);
  the storage defect was one layer up.
- Recorded, not changed: Nexar's connector sends a pre-issued token instead of running client credentials (D19-12).
  Quotas, breakers and coalescing are recorded but enforced in I3b.
- Reviewed pin move: b19-pricing-live-gate now configures credentials (admission needs them) and expects Mouser at 0.
- Tests: b19-source-registry 24/24, b19-connector-policy 6/6, b19-source-admission 7/7 and b19-offer-retention 5/5 against a
  migrated PGlite (all new; the first three in the prompt-to-gerber CI list, the last in database-delivery); distributor and
  BOM suites 56/56; database suites green; broad run: 288 files, 3662 passed, 10 expected skips; tsc 0 in the changed areas;
  eslint: no new findings (the pre-existing `lcsc.ts` unused-parameter warning remains).

### B19 I3b — request quotas, circuit breakers and in-flight coalescing (2026-09-13 local, solo; this commit)

- Reproduced first: against the connectors as I3 left them, 6 of 7 cases failed — the 121st DigiKey request of a minute
  was sent, a Nexar batch past 2,000 matched parts was sent, requests kept going after five 503s and after a 429, and
  concurrent identical lookups each paid for a vendor call. The 404 case is a baseline, passing before and after.
- `app/lib/acquisition/admission-control.ts`: every registered quota window is reserved before a request is sent (cost:
  1 request, a Nexar batch's matched parts, or 0 for DigiKey's token request); the breaker opens after 5 consecutive
  failures or at once on a 429, allows one trial after 10 minutes, and ignores neutral answers; per-client coalescing
  joins lookups already in flight. Enforced in `distributorJson`, the one path every vendor request takes.
- A BOM priced live names a paused source and when it may be tried again.
- Stated limits: per-process meters (a durable shared meter is a follow-up); a Nexar batch larger than the remaining
  quota is refused whole.
- Tests: b19-quota-breaker-coalescing 7/7 (new, in the CI list), b19-admission-control 9/9 (new, under app/lib/acquisition),
  the pause sentence added to b19-source-admission (8/8); distributor, registry and BOM suites 97/97; broad run: 290 files,
  3679 passed, 10 expected skips; tsc 0 in the changed areas; eslint: no new findings.

### B19 I4 — the quarantine pipeline's front half (2026-09-13 local, solo; this commit)

- Measured first: a live distributor lookup carried no evidence reference at all, and nothing implemented the pipeline's
  front half (types only, from before B19).
- Every live distributor answer is now pinned to the SHA-256 of the exact response bytes and when they arrived; the bytes
  are never kept.
- `app/lib/acquisition/quarantine.ts`: deterministic, frozen external observations (source, source and authority class,
  registry and normalizer versions, raw hash, expiry, `rawRetained: false`; blocked or disabled sources refused);
  normalized candidates whose every fact is classified sourcing / identity hint / engineering candidate / quarantined
  (model and OCR extractions always quarantined; engineering facts from distributors, third-party CAD or geometry
  inference quarantined); evidence bundles for one part with conflicts, stale observations, parser versions and missing
  engineering evidence, and `engineering.proven` always false. No export can approve, publish, create a revision or bind.
- Not built, and why: a distributor `SourceAdapter` (discovery planned one) would page a vendor catalog, which every
  registered source's terms prohibit or leave unclear; observations are made per interactive lookup.
- Recorded for I4b: the approval validator does not check what kind of source backs an engineering fact, or whether a
  model extracted it; the downstream mapping verifier does.
- Tests: b19-quarantine-pipeline 20/20 (new, under app/lib/acquisition in the CI list); acquisition, distributor and BOM
  suites 117/117; broad run: 291 files, 3699 passed, 10 expected skips; tsc 0 in the changed areas; eslint: no new findings.

### B19 I4b — what evidence a reviewed atomic revision may rest on (2026-09-13 local, solo; this commit)

- Reproduced first, 12 of 17 cases failing on the unchanged validator: a mapping certificate resting only on a distributor,
  third-party CAD, geometry inference or an LLM suggestion was PCB-assignable, and a published snapshot like that passed the
  publication transaction; a context with no provenance was trusted; trusted terminal/package/identity claims resting only
  on a distributor, and verified claims resting only on unreviewed LLM/OCR extraction, raised no blocker. Five baselines.
- `evaluateApproval` now requires engineering-authoritative evidence (manufacturer, official library, organization,
  human-reviewed; not an unreviewed model/OCR extraction) for approved mapping certificates and for trusted
  identity/terminal/package/mechanical claims; refuses any trusted claim resting only on unreviewed model/OCR extraction;
  and refuses provenance it cannot judge, naming exactly what is missing.
- All four callers supply provenance, including the server search view, which now loads the source records and sources
  behind its evidence (not DB-tested: INFERRED for that path).
- The governance suite's half-publication pin holds unchanged (the new message names a missing evidence source record);
  that suite was in no CI list and now is.
- Tests: b19-approval-evidence-authority 17/17 (new, in the CI list with governance-security); atomic, component-selection,
  fixture-runtime 123/123; workflow, mapping-verification, physical-binding, assignment-queue, kicad, circuit-knowledge 151
  passed / 6 skipped; broad run: 292 files, 3716 passed, 10 expected skips; tsc 0; eslint clean on the changed files.

### B19 I4b CI fix — a governance case that had never run on Linux (2026-09-13 local, solo; this commit)

- I4b added `app/lib/atomic/__tests__/governance-security.test.ts` to CI; it had only ever run on the Windows development
  machine. On Linux one case failed: "rejects path traversal and unsupported 3D formats" used Windows paths
  (`C:\safe\models`, backslash-separated references). A backslash is not a separator on POSIX, so the file-type reference
  resolved outside the root first and threw the path error instead; and the traversal assertion passed on Linux only for
  that same reason. The code under test (`resolvePermittedPath`) was right on both platforms — fail-closed.
- Not called a flake: reproduced from the CI log, reasoned under both path semantics (simulated with `path.posix` and
  `path.win32`), and fixed in the test: the assertions use the platform's own separator and an absolute native root, add a
  permitted-path case, and add the other platform's separator as a traversal that must also be refused.
- Tests: governance-security 25/25 locally; CI confirms on Linux.

### B19 I5a — license enforced at export (2026-09-13 local, solo; this commit)

- CI record first: I4 (`583691e`) green; I4b (`d1d5ed0`) red on prompt-to-gerber only — the Windows-only governance path
  case, fixed in `ad3f066`, which is green on every job.
- Reproduced (6 of 7 failing on the unchanged export): a pinned symbol whose license export disposition was `prohibited`,
  `private_review_only`, `metadata_only` or `unknown`, or whose license record was absent, was copied into the downloaded
  `.kicad_sch`; `POST /api/export/kicad` answered 200 with the file. One baseline (redistributable) passes before and after.
- `exportToKicadSch` checks every pinned symbol's own license before serializing and throws `SchematicExportLicenseError`;
  the route answers 422 `EXPORT_LICENSE_PROHIBITED` naming the components and sends nothing of any symbol.
- Recorded: the app's export button sends no pinned selections today, so this protects the public export API and pinned
  exports; PCB/fabrication geometry licensing is UNKNOWN from this chapter and carried to the validation increment.
- Tests: b19-export-license 7/7 (new, in the CI list); atomic, API and PCB suites green (three PCB performance cases timed
  out once under a full parallel run and pass in isolation, 41/41 — machine load, recorded, not a code change); broad run:
  293 files, 3723 passed, 10 expected skips; tsc 0 in the changed files; eslint clean.

### Record correction — timestamps (2026-09-13 local)

- The `updatedAt` stamps written to `PROGRAM_STATE.json` during B19 I2b through I4b (e.g. `03:01`, `03:37`, `03:49`,
  `04:06`, `04:16` with a `-04:00` offset) were read from a shell clock that was reporting UTC; they are UTC times mislabelled
  as Eastern. The dates are right. From I5a on, stamps are local Eastern time (the shell now reports EDT). Commit dates in
  git were always correct: git records the offset itself.

### B19 I5b plan — the import security matrix (2026-09-13 local, solo; this commit)

- CI on I5a (`bea0d35`): green on every job.
- A read-only multi-agent sweep (5 scouts, 5 adversarial skeptics, 1 synthesis; no file edits, no test runs) mapped the
  runbook's B19-D cases onto the surfaces that exist. 51 rows kept (1 high, 7 medium, 43 low; none refuted, 2 marked
  reproduce-first), 6 verified controls to pin, and the absent surfaces recorded with search evidence (no inbound
  archive/PDF/SVG/CSV import, no model-file ingestion, no distributor text in model prompts).
- The skeptics corrected several scout claims and test designs before anything was built (e.g. a proposed CSV fix that
  would have corrupted negative pick-and-place coordinates; tests placed under `lib/__tests__`, which vitest never runs).
- Recorded as `artifacts/ai-control-plane-b19/import-security-matrix.md`; batches I5b–I5e follow, each test-first.

### B19 I5b — the acquisition path, hardened (2026-09-13 local, solo; this commit)

- Twelve matrix rows, each reproduced first: 40 of 67 new cases failed on the unchanged code; 27 baselines pass before and
  after. One harness mistake found and fixed before recording: connector cases had been placed in a file whose hoisted
  module mocks replaced the connectors, so they briefly tested fakes; they moved to their own unmocked file.
- High (row 01): connectors answered with a different part's offer and the pricing layer relabelled it; now exact-MPN only
  (OD-34), no relabelling, stored offers carry their MPN (migration `0029_part_offers_mpn`, registered; migration pins moved
  by one registered entry, every contract unchanged; schema parity holds).
- Medium (row 03): vendor-derived lifecycle re-stamped on every read and never cleared; now live-only and expired by the
  purge at the strictest bounded retention.
- Also: per-exact-MPN pricing keys (36), quantity- and currency-correct unit prices and totals (20), lifecycle negations
  (26), unambiguous number parsing (51), exact-MPN bundle identity with confusable refusal (27a), complete conflict
  properties (39), requested-MPN and superseded-revision tracking (40), inert vendor text and safe links (41), ingestion
  media-type/size/record/deadline bounds (42), archive budget integer checks (43).
- Tests: exact-MPN connectors 7/7, exact-MPN pricing 5/5, vendor values 26/26, lifecycle retention 2/2, quarantine
  hardening 16/16, ingestion bounds 16/16, BOM per-MPN pricing 1/1 (all new, in the CI list), offer retention on migrated
  PGlite 7/7 (2 new cases, database-delivery job); database suites 55 passed / 3 skipped; broad run (now including app/lib/db
  and app/lib/component-selection): 306 files, 3867 passed, 13 expected skips; tsc 0; eslint clean on the changed files.
- An adversarial review workflow over this exact diff is running; its verified findings are fixed in the next commit.

### B19 I5b review — the adversarial review's verified findings, fixed (2026-09-13 local, solo; this commit)

- CI on I5b (`2feaeee`): green on every job, database-delivery with migration 0029 included.
- Review workflow (4 lenses + 4 skeptics, read-only, over the saved diff): 39 findings, 22 verified real (1 medium, 21 low),
  17 refuted with reasons.
- Reproduced first: 42 of 67 new cases failed on the I5b code; 22 baselines; 3 pins that already passed, kept because the
  reviewer showed the earlier deadline test could not tell the mechanisms apart.
- Medium: remembered "no exact match" answers (per source and canonical MPN, for the source's freshness; failures and
  no-storage sources excluded). Low: canonical memo keys; decimal-comma groups; all negated lifecycle phrases; Unicode-property
  inert text and code-point truncation; normalised host allowlists; explicit archive counts; canonical MPN conflicts;
  live-only lifecycle verdicts stamped at answer time; one line-price rule for estimate, CSV and view; snapshot price basis;
  quantity-1 USD pricing in notify and alternates; `offersForExactMpn` for every other offer reader; read-time lifecycle
  expiry (`partLifecycleStatus`) in every lifecycle reader, verified on migrated PGlite; backfill clears vendor stamps; the
  qualification pin missed in I5b.
- Tests: review-connectors 5/5, review-values 36/36, review-lifecycle 2/2, review-price-consistency 16/16 (all new, in the CI
  list), offer retention on PGlite 8/8; affected suites 412 passed / 3 skipped; broad run: 310 files, 3927 passed, 13
  expected skips; tsc 0; eslint: no new findings (BomView's four pre-existing effect warnings unchanged).
- Three I5c reproduction files written in parallel are left uncommitted on purpose; they land with I5c.

### B19 I5c — output injection (2026-09-13 local, solo; this commit)

- Twelve matrix rows, reproduced first: all 42 new cases failed before the fix (5 only on missing helpers). Two proposed tests
  corrected while reproducing (a formula-shaped reference is already refused by board integrity; a comma in a neutralised
  cell stays quoted).
- Medium: chat markdown images (02) — one `ChatMarkdown` renderer that never fetches images and keeps only web/mail links, plus
  an `img-src 'self' data: blob:` policy; `.kicad_pcb` structure injection (04) — every leaf child validated.
- Also: KiCad string escaping and string-aware indentation (17); own-property table lookups (18); export pinned parts from the
  server's published snapshots, body selections ignored, single-symbol validation (15, 16); one browser-safe link policy for
  vendor pages, datasheets and KiCad extraction (34); datasheet policy at export, recorded as policy because KiCad was not
  available to reproduce (35); CSV formula neutralisation in carts, the packet and both fab writers, and quoted CR (09, 10, 33);
  SPICE report escaping (21).
- Tests: chat markdown 7/7, href and CSV output 11/11, export selections 7/7, fab CSV 2/2, KiCad emit injection 13/13, report
  escaping 1/1 (all new, in the CI list; the fab file under the already-listed fab directory); PCB, constraints, KiCad,
  SPICE, project and component suites 1387 passed / 8 skipped; broad run 312 files, 3941 passed, 13 expected skips; control
  inventory gate green; tsc 0; eslint clean on the changed files.
- Browser proof for the UI changes is CI's page-browser-e2e job.

### B19 I5c review — adversarial diff review, verified findings fixed (2026-09-13 local, workflow + solo fixes; this commit)

- Review workflow over the committed I5c diff (regressions, security, coverage, tests; a skeptic per finding): 20 findings,
  17 verified real, 3 refuted with reasons.
- Reproduced first: 18 new or strengthened cases failed on the I5c code; pins that already passed were each proven by
  reverting their control (5 mutants, 5 killed).
- Medium: pinned export lost the Datasheet (fixed from the published symbol's property; fixture-runtime route test with the
  real loader); silk text anchor injected `.kicad_pcb` nodes (closed set through the token layer; all eight PCB writers
  audited); the row-16 test could not catch its own regression (well-formed forged symbol and license-precedence cases).
- Low: `lib_symbols` Datasheet policy; scheme-less `www.` datasheets; one load per revision with 503 on catalog failure;
  closed Side token; BOM CSV link columns; discriminating chat link cases; served-header e2e spec; indent, power-label, native
  placement and DRU pins; `DatasheetLink` and the distributor link helpers replace regex tripwires; local host names.
- Decision: pinned parts keep MPN-named library items (unique per pinned part; symbol-named items would collide) — the cost
  to "Update symbols from library" is recorded in import-security.md.
- Added to later batches instead of dropped: row 27b (identity resolution confusables) was missing from the batch table and
  lands in I5d; the refuted-as-out-of-scope FreeRouting DSN token finding becomes I5e row 52.
- Correction: the I5c entry above said "Browser proof for the UI changes is CI's page-browser-e2e job" — no spec exercised
  those changes, so that proof did not exist. The corrected proof is the component/helper tests and the new served-header spec.
- Tests: broad run 473 files (469 passed, 4 env-gated skips), 5025 passed, 25 expected skips (live auth, Postgres qualification, kicad-cli oracle, live assist, SPICE worker, ingest data); e2e security headers 2/2 locally against the running fixture-runtime app (next dev); tsc 0; eslint: no new findings (page.tsx 14 and BomView 4 pre-existing,
  identical on HEAD).
- The I5d work in progress is parked in a git stash (not committed) while this lands.

### B19 I5d — KiCad parsing and atomic data integrity (2026-09-13 local, solo; this commit)

- Seventeen matrix rows (06, 07, 08, 22, 23, 27b, 27c, 37, 38, 44–50), reproduced first: 48 of 67 cases failed on the
  unchanged code; 19 baselines and verified controls; 5 cases added with the fix; 6 mutants of the new controls all killed.
- Parsing: one bounded iterative s-expression reader that reads exactly one document; DRU files read as forms; raw symbol
  blocks from the lossless parser's spans; iterative bounded `extends` with cycle/missing/duplicate issues; pin, pad and
  expanded-pin budgets; embedded payloads, missing or impossible versions and model paths outside the model variables are
  unsupported; path policy with own variables, absolute paths and segment-based escapes.
- Data integrity: mega/milli value keys (no re-key) and own-key links; superseded claims; strict supplier freshness in approval
  and search; unqualified criteria never read absolute maximums; explicit units, ambiguity refusal and percentage tolerances;
  canonical identity in resolution (confusables are conflicts) and at publication (search key recomputed); certificate
  conflicts, reclassification and unknown terminals; publication re-verifies certificates and hashes blob bytes;
  PCB materialization hashes and bounds the footprint bytes.
- Corpus check over the local upstream KiCad library: extractor output identical; 12 231 per-file derived symbols that were
  "valid" with zero pins are now unsupported (`extends_missing_parent`); one footprint's doubled model-path separator was
  first refused, then accepted by a corrected policy (pinned).
- Tests: claims-values 27/27, KiCad hostile 21/21, s-expression hostile 8/8, atomic integrity 16/16 (all new, in the CI
  list); full unit suite 573 files (568 passed, 5 env-gated skips), 5790 passed, 33 expected skips; tsc 0; eslint clean on
  every changed file.
- Reviewed pin move: the library-table test uses the platform's absolute paths (a relative library path is now refused);
  assertions unchanged.

### B19 I5e-1 — project import, BOM table and source shapes, DSN tokens (2026-09-13 local, solo; this commit)

- Seven matrix rows (11, 12, 13, 14, 19, 28, 52), reproduced first: 37 of 43 new cases failed on the unchanged code (5 of
  them only on missing named exports); 6 baselines.
- Project files: size bound before reading, linear nesting bound before hashing, no rejected promise; checkpoint schematic,
  chat and board validated; table and distinct-part bounds; eight lookups at a time; a part is resolved only when the catalog
  returns it; a refused save is a failed import (`trySaveProject`).
- BOM routes: one `checkBomState` for all eight routes (shape, 10 000 instances, 2 000 distinct parts, bounded text) before any
  lookup; chunked IN lists.
- Requirements sources: runtime unions at ingestion and validation, compile-time exhaustive. OD-35 recorded (authority
  class remains caller-declared; must be a defined class).
- FreeRouting DSN: `DsnEmitError` refusals for layer names, directions, costs, design token, coordinates and control
  characters in quoted names.
- Reviewed pin move: the project-state parts mock uses the route's real `{ ok, part }` shape.
- Tests: project import bounds 13/13, BOM table bounds 9/9, source unions 11/11, DSN tokens 10/10 (all new, in the CI list);
  affected suites 52 files / 430 passed; full unit suite 577 files (572 passed, 5 env-gated skips), 5833 passed, 33 expected skips — the first full run found 5 failures in the B16.0.11 parity pins, which require each BOM route's exact historical 400 wording for a missing state; the implementation now passes each route's own wording (the pins were not changed); tsc 0; eslint: no new findings.
- The I5d adversarial review is still running over commit cf3993e; its findings land in their own commit.

### B19 I5d review — adversarial diff review, verified findings fixed (2026-09-13 local, workflow + solo fixes; this commit)

- Review workflow over cf3993e (regressions against the upstream corpus, security, missed sites, tests; a skeptic per lens):
  30 findings, 12 verified real, 18 refuted with reasons.
- Reproduced first: 32 of 37 new cases failed on cf3993e; 5 baselines.
- Medium: inheritance property amplification (resolution cost counted from the chain before any map is built; property and
  raw budgets; shared maps); suffixed mega/milli value-key collisions.
- Low: duplicated-ancestor symbols; DRU forms and rule children that were silently dropped; Unicode whitespace around
  published MPNs; wider unit ambiguity patterns; allowlisted limit semantics for unqualified criteria; ingest script skips
  symbols with extraction issues; supersession chains through the whole claim map and in component-selection gates;
  publication re-derives every KiCad asset from its verified bytes.
- Reviewed pin moves: the governance "complete bundle" and two I5d publication cases use a real blinker snapshot (the synthetic
  fixture's blobs are not KiCad text).
- Corpus re-check: outcomes identical to I5d; whole-library ingest over the 230 upstream symbol libraries accepts 22 756, skips 0.
- Tests: I5d review 32/32, DRU structure 3/3, ingest issues 2/2 (all new, in the CI list); affected suites 29 files / 297
  passed; full unit suite 580 files (575 passed, 5 env-gated skips), 5870 passed, 33 expected skips; tsc 0; eslint: no new findings (ingest-kicad's unused `sha256` import is pre-existing).
- The I5e-2 reproduction tests written meanwhile are parked outside the repository until this lands.

### B19 I5e-2 — what reaches a model (2026-09-13 local, solo; this commit)

- Rows 05, 24, 25, 29, 30 (synthetic reproduction), 32 reproduced first: 17 of 18 cases failed; 1 baseline; row 31 adopted as
  the ratchet (4 cases, passing before and after); 3 cases added with the fix.
- Catalog text bounded and labelled untrusted in Build tool results, rerank and review inputs; the data rule in five prompts;
  review findings quoted as data in the Apply-suggestions instruction; escaped and capped context sections; cleaned tool
  results and bounded inspection strings; circuit-knowledge excerpts labelled and locators bounded; closed failure sentences
  and URL-credential redaction; SchGen label grammar, bounded findings and advisory messages kept out of the chat history.
- Ratchet note: the vendor-code import closure first failed on the policy-only source registry (reached through the lifecycle
  SQL expression); allowlisted explicitly and still walked.
- Tests: build-loop injection 11/11, compose escaping 3/3, tool-result hygiene 2/2, excerpt injection 2/2, SchGen and advisory
  history 4/4, external-text injection route 4/4 (all new, in the CI list); full unit suite 586 files (581 passed, 5 env-gated skips), 5895 passed, 33 expected skips; tsc 0; eslint: no new
  findings; control inventory regenerated with no drift.
- Browser proof for the chat-history change is CI's page-browser-e2e job running the existing chat and build specs over this
  commit (they send and render messages; none asserts the advisory flag itself — the flag is proven by the unit tests above).

### B19 I5e review — adversarial diff review fixes (2026-09-13 local, solo; this commit)

- Review workflow over 8df97ff and a75fc1e: 35 findings, 19 confirmed (14 distinct), 16 refuted. 28 cases failed on the
  unchanged code first; baselines that already held are pinned.
- Fixed: ngspice deck element names (HIGH, new matrix row 53); DSN quote/backslash refusal with autoroute 422 (MEDIUM);
  find_alternates catalog text (MEDIUM); every review-input string; save rollback that never deletes an existing record;
  imported checkpoint page size; SchGen KiCad label grammar; exports that always fit the import bound; imported chat marked
  advisory; layout-critic message advisory with anchored per-site tripwires (3 mutations caught); strict circuit-knowledge
  locators; URL-credential redaction; path-only cycle detection and token-anchored `sk-` redaction for model-bound text; KiCad
  ingests pinned to reviewed commits (live check: both checkouts at their pins).
- Follow-ups recorded (untouched routes): SPICE AI route, layout-critic prompt/manifest, architecture/interfaces/power
  propose prompts; locally stored pre-I5e-2 assistant messages.
- Tests: the new and extended files above, plus the B16.0.24 simulate parity and confinement gates and the autoroute route
  suite; full unit suite under a loaded machine (a per-file eslint loop ran alongside; 65 min): 5870 passed, 68 failed in 47 files - 67 timeouts or perf thresholds and 1 real failure (the write-dsn escaped-quote pin, moved above); all 47 files re-run afterwards with two workers and nothing else running: 47 files, 544 tests passed; tsc 0; eslint: no new findings; control inventory regenerated with no drift.

### B19-E E1-A/B — pricing provenance, per-source status, packet labels (2026-09-13 local, solo; this commit)

- Plan: the B19-E discovery workflow (six increments E1–E6); owner decisions OD-36..OD-40 recorded with their safe defaults.
- E1-A reproduced first (6 of 8 cases failed): a connector's memo answer was indistinguishable from a live one and was
  persisted as `now` (served past DigiKey's hour from when it answered); a cache-only build listed every source as queried; a
  memo answer counted as live. Now every offer carries `provenance {servedFrom: live | process-memo | offer-cache,
  retrievedAt}`, the memo and the offer cache expire from the vendor's answer, a future time is never stamped, and the counts
  say what happened. Fixture correction: the I3 retention fixture's `fetchedAt: 0` became a real fetch time.
- E1-B reproduced first (8 of 10 failed; formula safety and cart bytes held): `source-labels.ts` (browser-safe) labels a
  source and an offer from the registry; the BOM result carries `pricingMode`, `registryVersion` and `sources[]` (available,
  paused with retryAt, blocked, disabled with owner decision, operator-disabled, credentials missing — no values); the
  procurement packet has Status, Pricing basis and License lines, optional warnings, and two appended columns (observation
  time, basis) with columns 19/20 and the cart files' bytes unchanged; the risk summary no longer says "production-ready".
- Tests: provenance cache (PGlite) 5/5, counts 3/3, source labels 7/7, BOM sources 5/5, packet 5/5; distributor, acquisition,
  BOM routes and B16.0.11 parity suites green; tsc 0.
- Next: E1-C — the BOM workbench (source chips and labels, offline state, no window.open, sourcing-worksheet wording), the
  no-purchase tripwire and the control inventory.

### B19-E E1-C — BOM workbench labels, offline state, no-purchase wording (2026-09-13 local; implementation workflow; this commit)

- Implemented by a workflow agent test-first (9 of 16 new cases failed on the unchanged code: every workbench case, the
  purchase-wording scan with three hits in BomView, and the navigation check on its `window.open`); reviewed by three lenses
  with skeptics in the same workflow.
- BomView: picker from the static registry (Mouser disabled with OD-32, LCSC blocked, a stale stored choice falls back);
  "Export for distributor" with no `window.open` — a dismissible notice says nothing was sent and no order was placed and
  links the vendor upload page (safeHref, noopener noreferrer); "N cached · M live"; "Sourcing worksheet (CSV, unverified)";
  per-source chips (paused with retry time, disabled with owner decision, credentials not configured, switched off);
  "Supply signals OK (observed)"; offer details show basis, observed and expiry; a failed refetch keeps the last result with
  an offline banner and Retry, and blanks expired offers. Registry wording updated; control inventory 581 → 583 (Retry
  semantic under bom.workbench, Dismiss view), B01 toolability matrix re-rendered for the wording change.
- Tests: workbench 7/7, no-purchase tripwire 9/9 (5 reintroduction checks), B17 gates, action registry, BOM routes and
  library green (11 files, 98 tests, re-run by the lead); tsc 0; eslint: the 4 `set-state-in-effect` errors in BomView are
  pre-existing in HEAD, none new.
- Review (same workflow): 17 findings, 15 confirmed (13 distinct) — a frozen clock while online (medium), non-network errors
  shown as offline, expired offers still steering sort, risk and the summary badge, a kept result under a changed choice,
  client clock skew, and seven test-strength gaps. They are fixed test-first in the next commit (E1-C review).

### B19-E E1-C review — fixes for the confirmed workbench findings (2026-09-13 local; fix workflow + lead; this commit)

- Fix workflow, test-first: 12 new cases failed on the unchanged code; the tests that only strengthen existing ones were proven
  by 18 deliberate breakages of the source (each caught). Two independent checkers confirmed all 13 distinct findings fixed and
  every new test failing on revert.
  - The clock ticks every 30 s whenever a result is shown; an expired offer is blanked online too, with a "Get current offers"
    notice; only a rejected fetch is offline, and an error answer shows its HTTP status and clears the result.
  - Expired offers steer no sort order, no priced note and no supply-OK badge ("Observations expired"); counts say
    "last result"; a kept result for a different pricing choice or design shows no cost, chips or prices; pricing None never
    shows a cost.
  - `BomResult.generatedAt` lets the client judge expiry and observation times in server time (a two-hour-slow client clock
    tested).
  - Test strength: fixture separates expiry from basis, rank and distributor; the risk breakdown and every vendor's notice are
    asserted; programmatic anchor clicks, bare `open()`, `.click()` on href-assigned elements and location navigations are
    caught; the wording scan covers every production .tsx; export routes may not pass pricing options from anywhere but an
    object literal.
- Lead follow-ups on the checkers' three new low issues (3 cases failed first): a connection dropping while the body downloads is
  offline (not "HTTP 200"); rows are keyed by their references so a clock-driven re-sort keeps an expanded row; the notice's
  refetch is named "Get current offers", distinct from the header's cache-bypassing "Refresh prices".
- Control inventory 583 → 584 (the notice button, semantic under bom.workbench). Tests: 14 files, 173 passed (workbench 19,
  tripwire 12+, source labels, BOM library and routes, B17 gates, action and tool registries, href/CSV); tsc 0; eslint: the 4
  pre-existing `set-state-in-effect` errors only.
- Recorded, not fixed: the tripwire has no bare "cart" pattern outside BomView (the component test covers BomView); a navigation
  through a helper in a file that never names an upload URL is not caught lexically; out-of-order /api/bom answers (pre-existing
  race; a result is labelled with the request it answered); no-storage sources are hidden only offline (both disabled or blocked).

### B19-E E2 — bounded external candidate search (2026-09-13 local; implementation, review and fix workflow + lead; this commit)

- Implemented test-first by a workflow agent (all 7 new test files failed on the unchanged code: missing modules, the missing
  registry `candidateSearch` field, and 4 of 5 purpose-share cases). Everything is tested against fake vendors through the egress
  injection; no live network.
  - Registry 1.1.0: a `candidateSearch` record per enabled source (DigiKey keyword search, Nexar `supSearch`/`supSearchMpn`,
    at most 5 results), `license.agentDisclosure` = unknown everywhere (OD-36), `license.attributionLink` (Nexar's required
    octopart.com link). The keyword-search terms were not re-read (no network); the registry and `source-registry.md` say so.
  - Admission: an agent purpose share (at most 25% of each window, OD-40) and a non-reserving `previewAdmission`, so a paused
    source sends nothing, not even a token request. The per-process clients moved to `distributors/clients.ts`, shared by
    pricing and search.
  - `acquisition/external-search.ts`: bounded printable-ASCII queries (1–64), limit 1–5, admitted enabled sources only (Mouser
    and LCSC never constructed), exact/keyword modes (agent exact only), a memo per tenant and project for the source's
    freshness (never for no-storage sources), no `part_offers` write, every hit through the quarantine observation path,
    exact-match computed never relabelled, inert bounded vendor text, safe https links only, per-source status.
  - `POST /api/parts/external-search`: authenticated project read with provider credit (same policy shape as /api/bom),
    4 KB body, forbidden and undeclared keys refused, a fixed failure sentence. Route ratchet 158/155 → 159/156, every
    route-policy artifact regenerated (also correcting a stale public `/api/bom` row in two B16.0.4/B16.0.7 matrices).
  - Action record `parts.external-observation-read` (tool exposure none until E6); Build Library "Search distributors"
    section with labels per hit, a credit line and no place or buy control; control inventory 584 → 590.
- Review in the same workflow: 17 findings, 12 confirmed (process memo shared across tenants; Nexar attribution link not
  guaranteed; Nexar GraphQL error answers memoized as empty for 24 h — medium; Octopart click links dropped; tripwire missing the
  new vendor modules; a PGlite suite in the no-database CI job; a stale ratchet header; the registry document at 1.0.0; four
  test-strength gaps). All fixed test-first (19 failing cases first; 16 deliberate source breakages caught), confirmed by an
  independent checker.
- Lead follow-ups on the checker's three new low issues (3 cases failed first): `sig` is exempt only on octopart.com page links
  (an Azure SAS `sig` on a datasheet link is dropped; the DigiKey `?sig=` expectation moved from kept to dropped, reviewed); a
  Nexar answer with field errors beside a result list is a partial answer shown and not counted toward the breaker BOM pricing
  shares; the CI job-scope guard follows relative imports and test harnesses (the previous detector missed both forms).
- Tests (lead re-run, bounded): acquisition, distributors, parts routes and the panel 28 files / 318; BOM, workbench, registries,
  B17 and no-purchase gates 12 / 145; auth, route-policy, invariant and injection gates 25 / 335 (+9 env-gated skips); B01 byte
  gates, AST import gates and B16.0.24 parity 4 / 83; tsc 0; eslint clean on every changed file except the 14 pre-existing
  `app/page.tsx` react-hooks errors (E2 changes one prop there); control inventory and route-policy artifacts regenerate with no
  drift.
- Recorded, not fixed: the Nexar pricing path has the same GraphQL-error handling gap (a batch with errors is remembered as
  "no exact match"); it needs its own decision on partial batches. Memo scope is tenant plus project (stricter than tenant).

### B19-E E2 CI — the type-check step ran out of memory (2026-09-13 local; this commit)

- CI on 5c8de9d failed in both workflows at `pnpm exec tsc --noEmit`: V8 aborted with "JavaScript heap out of memory" at about
  2 GB (prompt-to-gerber and benchmark-core); database-delivery and page-browser-e2e passed. Not a type error, and not dismissed:
  reproduced locally with a full, non-incremental check capped at 2048 MB (the local incremental cache had hidden it).
- Measured with `--extendedDiagnostics --incremental false`: 2dee62c 5,434 files, 625,428 types, 2.12 GB; 5c8de9d 5,446 files,
  629,894 types, 2.19 GB, exit 0 with a 4 GB heap. E2 added 0.7% types and 65 MB — no pathological type; the project had
  reached Node's default heap on the runner.
- Fix: the two tsc steps run with `NODE_OPTIONS=--max-old-space-size=4096`. Resources only; no check, test or type changed.
- The E3 workflow started before the machine restarted did not complete and left no working-tree changes; it is re-run on
  this commit.

### B19-E E3 — exact-revision integrity at the durable atomic boundary (2026-09-13 local; two workflows + lead; this commit)

- Incident, recorded as it happened: the first E3 workflow (started before the machine restart) was still running when a second
  E3 run was launched on 5b2c3ca. The second run's implementer saw the first one writing, stood aside and changed nothing; its
  reviewers and fixer then worked on the first run's implementation while the first run's own review and fix continued. The
  lead stopped the first run during its fix stage, backed up the tree, and re-verified everything below on the combined result.
- Implementation (first run, test-first: 45 new cases failed on the unchanged code — the collision resolved instead of
  rejecting, an identical re-publish wrote a second audit row, 20 validation refusals did not throw, AI and single-person
  transitions were allowed, withdrawal did not exist):
  - publication validation recomputes id and semanticHash, requires approve and publish by different humans (never
    llm:/ocr:/agent:, compared after trimming, NFKC and case folding), the publish actor equals the caller, and a runtime role
    check; the revision insert ignores conflicts only on its id, so a (logicalPartId, revision) collision throws and rolls back
    revision, links and audit row; an identical re-publish is idempotent;
  - `withdrawPublishedAtomicRevision` appends to the new `atomic_revision_status_events` table (migration 0030, registered,
    forward-only; CHECKs, FKs, a unique (revision, state) index; verify-schema criteria) with an audit row in one transaction;
    only legal edges, selectable same-part successors, a reason, publisher/admin humans;
  - catalog transitions refuse AI actors for approve/publish/withdraw states and approver == publisher (OD-37);
  - loaders: `loadAtomicRevisionStatus`, `loadSelectablePortableSnapshot` (new selection and binding) and a pinned loader that
    keeps deprecated/superseded but refuses revoked (OD-38), mirrored in the chat raw-SQL reads; new-selection reads (atomic
    catalog, KiCad category, catalog search, parts search, part detail) list only selectable revisions and derive `approved`;
    a bind replay on a revoked revision is refused.
- Review fixes (second run's fixer, test-first; an independent checker confirmed all ten): a withdrawn revision is never
  re-published or linked, and a replay may not add links (the publish audit now names approver, role and links); CI lists carry
  the three E3 suites and the CI job-scope guard requires every B19 suite to run; strengthened two-person, successor,
  handoff-loader, snapshot-id and collision tests, each proven by a deliberate breakage. First run's review: withdrawal refusal
  assertions are anchored so drizzle's query text cannot satisfy them.
- Lead fix (split reviewer verdicts, resolved fail-closed): a value whose own link points at a withdrawn or missing revision no
  longer falls back to the part's '' default link, which can be a different exact part. Parts carry `withdrawnValueKeys` and
  `valueKeyLink` refuses the fallback for them (test failed first; a mutation removing the auto-layout guard is caught).
- Reviewed pin moves: B16-B migration pins 30 → 31 entries and the qualification upgrade list gain 0030; three suites' server-
  catalog mocks export the new loaders (no assertion changed); the b13-2 chat cancellation harness keeps each Request alive for
  the test (a garbage-collected Request dropped the abort; proven with a temporary file, since deleted; no assertion changed).
- Gates (lead re-run on the combined tree, bounded batches): atomic 19 files / 298; db, physical binding 13 / 101 (+9 opt-in
  skips); catalog routes and tranche parity 5 / 183; chat and fixture runtime 14 / 84; engineering authority, project suites,
  AST import gates, CI scope, no-purchase and b13-2 22 / 354; prompt-to-gerber, PCB sync, auth ratchets and parts-search
  consumers 35 / 444 (+10 skips); tsc 0 (4 GB heap); eslint clean on 30 changed files. No route added (ratchet 159).
- Recorded, not fixed: the operator seed script's reuse path still reads through the pinned loader; the FOR SHARE lock on
  re-publish is not exercised by a concurrent test (PGlite has one connection); whether Next.js keeps a Request alive for the
  life of a handler (abort propagation on client disconnect) is unverified and is a separate hardening item.

### B19-E E4 — import candidate review and two-person human publication (2026-09-13 local; workflow + follow-up workflow + lead; this commit)

- Implemented test-first by a single-writer workflow (quarantine suite: 11 of 13 cases failed first; every other new suite
  failed on missing modules):
  - quarantine: `missing` counts only non-superseded engineering candidates; conflict values carry `establishes` and
    `sourceClass`; `quarantinedDisagreements` are information only; extraction text is inert and bounded;
  - `acquisition/import-review.ts`: labelled review evidence (source, freshness, cached/live, registry version, stale) and a
    `reviewEvidenceDigest` over identity, engineering candidates, quarantined facts, conflicts and supersession — not sourcing
    facts, distributor TTL or a distributor's MPN spelling; distributor facts are persisted as SHA-256 hashes only;
  - `atomic/authoring.ts`: drafts assembled server-side from the bundled KiCad library, source classes set by rule
    (person-entered data is organization_authored, never manufacturer_datasheet), revision = latest + 1;
  - `atomic/publication-review.ts`: durable `atomic.publication-request.v1` (CAS, namespaced idempotency, human actors,
    retirement when the requester or approver loses membership or role); approve refuses digest drift, unresolved conflicts,
    quarantined/superseded/distributor resolutions, an unresolved manufacturer, missing evidence and undispositioned facts;
    publish by a different person re-assembles the draft and calls the E3 boundary with reviewed links in one transaction;
  - `POST/GET /api/components/atomic/publication`: governance tenant + project + default branch, human only, per-op roles,
    64 KiB body, forbidden and undeclared keys refused, closed refusal codes, cache only (0 vendor calls end to end);
  - `AtomicPublicationReviewPanel` from the Build Library preview and exact E2 hits; never-exposed tool patterns and
    `publica` in the Tier-3 family pattern; route ratchet 159/156 → 161/158; B01 record `parts.atomic-publication-review`;
    control inventory 590 → 619.
- Review in the workflow: 24 findings, 16 confirmed and fixed test-first (13 failing tests first, 3 test-strength findings by
  deliberate breakages), confirmed by a checker — among them unreviewed requester-chosen links (now checked for exact MPN,
  symbol and existing links at submit, approve and publish, named in evidence and the digest, and refused inside the
  transaction), idempotency-key poisoning, an in-flight publish racing a withdrawal or a second publisher (marker lease),
  authority not re-checked at publish, a truncated pin map, and the governance gate ignoring the tenant (new required
  `SIRKIT_ATOMIC_CATALOG_TENANT_ID`, recorded as an OD-37 amendment).
- Follow-up workflow (four checker items, each failing first; checker confirmed): a late publication is never recorded onto a
  replacing request (409 REQUEST_REPLACED); an ambiguous publish outcome keeps the marker (409 PUBLISH_OUTCOME_UNKNOWN; the
  E3 boundary flags failures after its callback as commit-outcome-unknown); a withdrawn '' default link is reported in
  `withdrawnValueKeys`, so the panel no longer offers a link the server refuses; the concurrent-publish test now reproduces
  the shared-marker-key interleaving (proven against the old key format).
- Lead follow-ups on the second checker (2 cases failed first): every refusal code has a client message, enforced at compile
  time (a deleted message fails tsc — checked) and by a test; the outcome read accepts any ReadonlyMap-shaped answer; the
  unknown-outcome message no longer promises a retry succeeds while the status cannot be read.
- Decisions recorded: OD-37 amendment (tenant + project governance scope); OD-34 amendment (a link needs an empty or exact
  `mpn`; family-level links are refused, fail closed).
- Gates (lead re-run, bounded batches): atomic + acquisition 35 files / 579; component, parts, editor and review panels,
  physical binding, durable workflow 15 / 124 (+8 skips); prompt-to-gerber, B14 AST gates, chat injection ratchet, fixture
  runtime 9 / 77; all auth gates and B16.1C tripwires 38 / 444 (+9 skips); engineering registries, B17, B18 exposure and
  never-execution sweeps, no-purchase 9 / 87; tsc 0 (4 GB heap); eslint clean on 38 files; B17 inventory and route-policy
  artifacts regenerate with no drift.
- Recorded, not fixed: a status-read outage holds a request (fail closed) beyond the lease; a definite rollback at COMMIT is
  reported as an unknown outcome; AAL2 step-up not enforced (OD-37); no browser check of the panel (memory); the bundled
  KiCad reader was exercised with fixture libraries, not the uncommitted data/ checkout.

### B19-E E5 — lifecycle and project binding (2026-09-14 local; workflow resumed across a restart + lead; this commit)

- The E5 workflow was interrupted by a machine restart during its fix stage; the fixer had only recorded start hashes, and all 68
  files still matched them, so the run was resumed (implementation and reviews from cache; the verifiers re-ran live).
- Implemented test-first (non-PGlite batch 63 failing / 7 baseline; PGlite 6 of 6 failing first):
  - `withdraw_revision` on the governance publication route (human project_admin, closed body, reason, status checked first,
    E3 refusal codes kept);
  - `POST /api/components/revision-status` (16 KB, 1–500 revision ids, member read, no project data, no withdrawal reason);
    route ratchet 161/158 → 162/159; `BomRow.catalogStatus` with a badge and "Review successor" (the status read runs only
    for the authenticated `/api/bom`; public exports never read the catalog; at most 2,000 distinct atomic ids);
  - component authority `catalogStatus` facet (revoked: no exact authority, a gap; deprecated/superseded: verified-exact
    with a successor gap); `diffAtomicUpgrade` blocks deprecated, superseded, revoked and unpublished targets;
  - successor preview and rebind (reviewer or admin, human; digest over the project scope only; supersede and bind staged
    and written in one commit, so a failure leaves the old binding; the replay re-reads the successor's status; the chain
    of successors is followed up to 8 hops, cycle-safe; an editor gets a reviewer handoff; a leftover identical candidate is
    reused); replacement pin facts take a role — current pins are read historically, target pins must be selectable;
    a "symbol differs from revision" blocker in review and bind, replay included;
  - "Use published exact revision": the Build Library resolves the identity from its fresh part detail; the placement
    carries it only for the value it was resolved for; authority still needs the reviewed binding.
- Review in the workflow: 21 findings, 14 confirmed and fixed test-first (mutations prove the strengthened tests), confirmed
  by a checker: a successor-chain dead end (medium), actor/session in the diff digest, preview offered without an effective
  binding, replay skipping the status re-read, an editor handoff that could not complete a rebind, a 500 for an astral
  reason, public BOM routes reading the catalog, the plain Place control carrying the E5 note, and six test-strength gaps
  (target pin facts, gateway role wiring, client symbol forwarding, page adoption wiring, effective-selection check, replay
  symbol check).
- Lead follow-up (the checker's one new issue; failed first, mutation caught): an adopted identity names the value it was
  resolved for (`AdoptedAtomicIdentity.forValue`), and a placement of any other value — "" before the part cache fills — carries
  no revision.
- OD-38 amended twice (historical current-pin reads; following the successor chain).
- Gates (lead re-run, bounded batches): atomic, physical binding 35 files / 489 (+6 skips); components, BOM, parts, editor and
  review panels 19 / 205; authority, replacement, B14, chat, replacement-authority, fixture runtime, prompt-to-gerber 36 / 415;
  auth gates and B16.1C tripwires 38 / 444 (+9); registries, exposure sweeps, no-purchase, AST gates, CI scope 11 / 113; suites
  reading the page, PCB editor, sync and placement 67 / 820 (+3); tsc 0; eslint: no new problems (BomView 4, PcbEditor 1,
  page 14 and b14-replacement-proposal test 3, all equal to HEAD); B17 inventory (628 controls) and route-policy artifacts
  regenerate with no drift.
- Recorded, not fixed here: on the PostgreSQL path a component review approval fails with PB_REVIEW_EVIDENCE_CHANGED_CONFLICT,
  because `server-catalog.ts` stamps `capturedAt` with the load time and the review evidence digest includes it (pre-existing,
  found by the E5 fixer; fixed next, test-first); no browser run of the new panels (memory).

### B19-E E5 follow-up — durable component-review approvals were always refused (2026-09-14 local, solo; this commit)

- Pre-existing defect found by the E5 fixer: the PostgreSQL catalog loader stamps each portable snapshot's `capturedAt` with the
  read time, and the component review evidence digest included it, so the evidence re-read at approval never matched the
  evidence the reviewer saw — every durable approval answered 409 PB_REVIEW_EVIDENCE_CHANGED_CONFLICT. The in-memory fixture
  catalog hid it (a constant `capturedAt`).
- Reproduced through the real `/api/physical-bindings` route (B16-C handoff suite, new test 9: the catalog read twice at two
  times → 409 before the fix). `capturedAt` itself cannot be made constant: mapping verification uses it as "now" to judge
  source freshness. Fix: the digest covers the reviewed evidence without the read time (still shown to the reviewer); real
  evidence drift is still refused (test 6 unchanged).
- Reviews requested before this change carry a digest that included the read time; approving one now asks for a fresh request
  (409), as the PostgreSQL path already did.
- Tests: physical bindings (API and library), both component review panels, prompt-to-gerber 17 files / 119 (+6 skips); tsc 0;
  eslint clean on both files.

### B19-E E4 follow-up — the B11.5 write-closure gate admits the E4 KiCad-library fixture test (2026-09-16 local, solo; this commit)

- Found by the E6 implementer: `b11-5-capture-exactness.test.ts` check 12 (no test writes under app/, lib/, scripts/ or
  artifacts/) failed since E4 (40c15b6), because `b19-e-publication-boundaries.test.ts` builds throwaway KiCad library fixtures
  with `mkdirSync`/`writeFileSync`. Not caught by CI: that gate is not in a CI list (it is in the full suite only).
- Every one of its 8 write lines (the symlink and junction included) is rooted at `mkdtempSync(path.join(tmpdir(),
  "b19e-e4-kicad-…"))` scratch roots, so it was admitted the way the gate admits the other temp-directory tests: a justification
  predicate that requires the scratch root and refuses any write line not rooted at it. Proven: rerooting one write outside
  the scratch root fails the gate (mutation, file restored by hash). The gate passes 18/18.
- The E6 workflow was resumed after its four review agents hit the weekly usage limit; its implementation stage came back
  from cache and only the review, fix and check stages re-ran.


### B19-E E6 — bounded read-only agent tools for external search and evidence (2026-09-16/17 local; workflow + review-fix workflow + lead; this commit)

- Implemented test-first against the plan's E6 section (OD-36, OD-40): the five new suites and the ratchet amendment failed
  first (`b19-e-external-read-descriptors`, `b19-e-external-read-service`, `b19-e-agent-read-port`,
  `b19-e-chat-external-acquisition`, `b19-e-live-contract` could not import their modules; the amended import-closure tripwire
  failed on the unchanged walker).
  - Registry and catalog: binding status `bound-external-read`, authority source `external-observation`, a validator rule
    (read class, side effects none or derived-cache, approval tier none, exactly the external-observation authority, module and
    symbol required); `sirkit.parts.external-search` 1.0.0 (1-5 exact MPNs, derived-cache, 12 s) and
    `sirkit.parts.evidence-read` 1.0.0 (one MPN, cache only), both Tier 0 and agent-exposed with reasons; the "orderable"
    wording became "published physical-authority"; action record `parts.external-observation-read` exposed to chat.
  - Agent boundary `app/lib/agent/acquisition-reads.ts`: allowlisted bindings, fresh discovery and role/capability rechecks,
    canonical state required, exact keys, safe-JSON and schema checks, `canonicalExactMpn` per MPN, a deadline composed with
    the run's cancellation, at most 5 live MPNs per run, a closed projection (labels; vendor values only under
    `untrustedVendorText`, bounded, only for a source whose registry entry permits agent disclosure), at most 8,000 characters,
    errors by class name only.
  - Server port `app/lib/acquisition/agent-read-port.ts` (admission, the agent's pause, the new `lookupExactMpns` in
    `app/lib/distributors/index.ts` — cache first, `lookupBatch` for misses at the agent purpose only when the server's live
    policy allows, pending at the deadline — the quarantine front half, the E4 import-review projection, E3/E5 revision status;
    closed refusal codes, never an environment name); `getCachedOffersForExactMpns` in the offer cache; `LookupBatchOptions`
    (purpose) on the three connectors.
  - Chat wiring: `app/api/chat/external-acquisition-runtime.ts` (the one approved boundary, resolve/set/reset), the route passes
    the port and the availability fact, the assembler advertises `external-observation` only with that fact and canonical
    state, the gateway's integrity check holds in both directions, the loop withholds the tools otherwise; prompt 1.3.0 with
    the sourcing-observation rule.
  - Reviewed pin moves, reason beside each: `b17-f-agent-exposure` and `b18-c-exposure-lift` (the two Tier 0 external reads),
    `b04-tool-registry` (an exposed read is backed by the B05 allowlist or the external-read allowlist),
    `b18-c-gateway-execution` (prompt 1.2.1 → 1.3.0 pinned into a grant), `b19-e-external-search-route` (toolExposure none →
    chat); `b09-3-closure` and `b09-1-boundary` needed no move (still 12 without the port).
  - Reviewed amendment to the chat import-closure ratchet (`b19-d-external-text-injection-route.test.ts`): the walk stops at
    `external-acquisition-runtime.ts`; tripwires pin that only the chat route imports it, that it imports only
    `agent-read-port.ts`, that build-loop.ts and llm/router.ts stay fully forbidden.
  - Artifacts regenerated (b01 matrix, b04 registry and parity, b09 manifest, activation audit, replay fixtures and parity,
    b11 evaluation results and replay pins); CI lists (the three new prompt-to-gerber entries); `acquisition-ux.md` (E1-E6
    product and agent UX, OD-36..OD-40, out of scope with reasons); README status row.
- Adversarial review (four lenses) confirmed 15 findings; every one fixed test-first in the fix workflow, the reproducing test
  run on the unchanged code first, test-strength findings proven by a deliberate breakage that the strengthened test caught
  (each mutated file restored and verified by SHA-1):
  - **A slow vendor defeated the per-run cap and the "pending" promise (security + correctness + tests-01).** The port's
    deadline equalled the service's timer, so a hung vendor made the whole call time out (the model never saw `pending`, nor
    the call's cached observations), and the run's live budget was charged only after a successful answer — every retry got a
    fresh 5 MPNs. Reproduced through the real port and gateway with a hung fake vendor (timeout refused; a second call sent five
    more MPNs) and at the service (budgets seen [5, 5, 5]). Fix: the port's deadline ends a margin before the service's
    (`EXTERNAL_READ_DEADLINE_MARGIN_MS`, a quarter of a short timeout), `lookupExactMpns` counts its deadline from the call's
    start, and the run is charged BEFORE the port is asked for every MPN the call may send (a timed-out, cancelled or failed
    call keeps the charge; a projected answer settles it to what was sent; an evidence read never charges); a port can claim no
    more live MPNs than the call asked for. After: pending per MPN with `liveLookups.thisRun` 5, the next call `run_live_limit`
    with no vendor request; budgets [5, 2, 2] and 0 after a five-MPN timeout.
  - **The exact-MPN offer-cache read took an arbitrary 64 rows before choosing the newest (correctness).** Reproduced against
    PGlite: a fresh Nexar row behind 64 stale DigiKey rows of the same MPN was not served. Fix: `DISTINCT ON (upper(mpn),
    distributor)` ordered newest first, so one row per MPN and source is chosen in the database; new suite
    `b19-e-exact-mpn-offer-cache.test.ts` in the database-delivery job (pinned in the CI scope test).
  - **Test strength.** The ratchet's "not vacuous" assertion was tautological (`walk(APPROVED_BOUNDARY)` stops at its own
    entry): removed, the manual walk behind the port carries the proof (a type-only import of the distributor index fails it).
    The chat "withheld" case depended on the shell having no DATABASE_URL (shown failing with a placeholder DATABASE_URL):
    it stubs the variable, and the resolver's three states (no database, fixture runtime, a port built without I/O) are pinned.
    Evidence labels (revision states with successors, conflicts, stale ids, quarantined names) and search labels are now
    asserted after the projection, in the model's own input and through the gateway with the real port (omitting `revoked`
    or nulling every ISO time fails them). Test d advertises the move tool under a real grant minter with
    `execute_explicit_tier1`, so "nothing executes" is a real claim: the vendor's instruction yields a preview and never a
    settlement (a minter that treats every request as explicit fails it). The loop's withholding guard and the integrity
    clause "claimed without canonical state" have tests that fail when either is deleted. The refuse-rather-than-cut branch is
    exercised (raising the budget fails it). Under a permitting source (test-only disclosure), an instruction reaches the
    model only under `untrustedVendorText`, while credential-shaped tokens and links are removed from vendor text before the
    bound (a decision recorded in `acquisition-ux.md`).
  - **Report accuracy.** The B11.5 write-gate failure named in the E6 report was fixed in b363b0f; app/lib/agent is green on
    the current base. This ledger entry and PROGRAM_STATE.json were missing from the E6 working tree.
- Gate re-run after the fixes (fix workflow, bounded batches, 2 workers): the five affected suites and the CI scope pin 5 files
  / 68; the PGlite cache suite 1 / 2; app/lib/agent 34 / 391 (the B11.5 write gate included); engineering 48 / 708 and
  47 / 348; chat, acquisition and the B14.4 AST gates 27 files (+1 skipped) / 292 (+2 skipped); distributors 17 / 139 (four
  PGlite suites); auth gates and B16.1C tripwires 38 / 444 (+9 skipped); fixture runtime and prompt-to-gerber 7 / 51; tsc 0;
  eslint clean on the 36 changed .ts/.tsx files. Artifacts b01/b04/b09/b11 were regenerated by the E6 workflow; the fixes
  change no descriptor, so they regenerate with no drift.
- The auth batch first failed `b16-0-ai-approval-lifecycle` 22/23 at the 5 s test timeout: the test cold-imports the whole
  /api/chat route graph inside its body, and E6 made that graph heavier (the port, the connectors, the offer cache and the
  database client). Measured on this branch with a scratch probe: import 7.9 s idle, POST 15 ms, status 403 — the refusal is
  correct, the body is outrun. The reviewed hunk from `9335704` (fix/b16-0-revoked-member-cold-import-timeout, pushed, not
  merged) was applied to the working tree: the provider mock and the route import run at collection, the timed body keeps
  the identical setup, POST and 403 assertion. The file alone passes 5/5 with the body at 62 ms.
- Not done here: threading the run's abort signal into the connectors' `lookupBatch` (an abandoned vendor request still runs
  to its egress deadline; its quota was already metered, so nothing is spent twice); the live contract check was not run.
- Lead follow-ups on the checker's four new low items (2026-09-17; 2 cases failed first, 2 pins added): a live lookup whose
  deadline the offer-cache reads already used up settles its misses as pending and asks no vendor (a request whose answer
  could only be discarded was still metered and charged); the vendor-text scrub runs over a bounded prefix (4× the visible
  bound) with a bounded leading run, so a 50 KB keyword-repeat word no longer backtracks for seconds (1.67 s → under 500 ms in
  the test); the deliberate fail-closed reservation is pinned for a port that throws and for a call cancelled mid-flight; the
  scrub's over-match of benign "…key:" text is recorded as a trade-off in acquisition-ux.md. The b16-0 cold-import hunk the
  fixer applied (from fix/b16-0-revoked-member-cold-import-timeout, unmerged) is kept: mock and import hoisted, assertion
  unchanged.
- Lead re-run of the E6 gates on the combined tree (bounded batches, one at a time): agent, chat, CI scope and AST gates
  49 files / 493; engineering 95 / 1,056; auth gates, B16.1C tripwires, fixture runtime, prompt-to-gerber and the external-
  search route 46 / 514 (+9 env-gated skips); acquisition, distributors and the two E6 service/port suites 19 / 198; tsc 0
  (4 GB heap); eslint clean on 36 changed files; the B09/B04/B01/B11 agent artifacts, the B17 inventory and the route-policy
  artifacts regenerate with no drift (ratchet unchanged at 162/159: E6 adds no route).


### B19 closeout — validation on the final tree (2026-09-17 local, solo; this commit and f158d28)

- Final code commit bf88eba (E6); the closeout commits change only artifacts. CI on bf88eba: both workflows green
  (prompt-to-gerber, database-delivery, benchmark-core, page-browser-e2e; benchmark-quality).
- Full suite, alone, two workers (`run-batch.sh`, 12.2 min): 634 files (628 passed, 6 skipped whole), 6,595 tests (6,560 passed,
  35 skipped), 0 failures, 0 timeouts, no process left behind. Every skip is an environment gate without its marker (live
  acquisition contract, live PCB assist, SPICE worker, Postgres qualification, durable-workflow tenant scope, ingest integrity;
  the live Supabase matrix 9, physical-binding schema integrity on Postgres 6, kicad-cli oracle 2, three single cases).
- tsc 0 (non-incremental, 37 s, 4 GB heap; the incremental check agrees). eslint over the 306 .ts/.tsx/.js files the chapter
  changed (batches of 60: one command line was too long for Windows): 25 findings, all pre-existing and equal to the counts
  recorded at the increments (page 14, BomView 4, PcbEditor 1, b14-replacement-proposal test 3, one unused-import warning each in
  lcsc.ts, ingest-kicad.ts and project-state.test.tsx — the last on a line from 2026-08-04 that B19 never touched); no new finding.
- 14 generators re-run sequentially (source registry, B16.0 route-policy set and the B16.0.8 baseline, action toolability, agent,
  tool registry, B11, read invocation, B10, B17 inventory): exit 0 each, `git status` identical before and after (zero drift).
  Ratchets inside the full run: tripwires 7/7 (162 = 159 + 3 + 0), agent exposure 9/9, CI job scope 4/4, import closure 5/5,
  no-purchase 13/13, B11.5 18/18, AST import gates 22/22, never-execution sweep 4/4.
- Artifacts: `changed-files.md` (generated: 31 commits, 342 files), `unknowns-and-owner-decisions.md` (OD-31..OD-40 with
  amendments, UNKNOWN and BLOCKED-LIVE items, every recorded follow-up, out-of-scope decisions), `test-and-validation-report.md`,
  `final-verdict.md` (B19 PASSES its deterministic gate; every runbook criterion mapped to executed evidence); README rows for
  B19-D, B19-E and validation updated. Not run: the optional live contract check (no vendor credentials here; a run spends the
  operator's quota) — BLOCKED-LIVE-QUALIFICATION; no browser run this chapter (memory) — CI's browser job covers the committed specs.
- Next: PR #9 description rewritten for the whole chapter, un-drafted, merged normally after green CI on the closeout commit; then B20.

### B20 — chapter start and discovery (2026-09-17 local, workflow + lead; this commit)

- B19 merged normally into `main` as `102dd27` (PR #9) with both workflows green on `3296753`. B20 opens from that base on
  `chapter/b20-mcp-adapter`; the draft PR is opened with this commit so every increment gets CI.
- References re-read live before any code was read (runbook: never a remembered or deprecated draft): the current MCP
  revision is 2026-07-28 (stateless; `server/discover`; MRTR; no sessions; `Mcp-Method`/`Mcp-Name`/`MCP-Protocol-Version`
  headers; `ttlMs`/`cacheScope`; error codes -32020/-32021/-32022); the TypeScript SDK 1.30.0 (latest, no prerelease) speaks
  2025-11-25 only; Anthropic's connector (`mcp-client-2025-11-20`) and OpenAI's `type: "mcp"` tool are handshake-era, remote
  HTTP only, tools only. Recorded in `artifacts/ai-control-plane-b20/mcp-reference-notes.md`; OD-41 (dual era, current
  revision as the authority path) and OD-42 (no SDK dependency) recorded in `OWNER_DECISIONS.md`.
- Discovery by six parallel read-only readers (workflow `wf_dacb9f05-091`, 7 agents, no process started): 211 facts and 69
  gaps with file:line, synthesized into `discovery.md` and spot-checked by the lead (nine load-bearing claims re-read, all
  as cited). 36 candidate defects D20-1 … D20-36 — among them: exposure is one boolean with no per-protocol dimension; a
  registry-generated list would advertise the six granted Tier 1 mutations; no bearer principal, no audience validation,
  and a missing `Origin` is refused on every authenticated POST; no server-side canonical-state source for a browser-less
  read; view-session commands and inert proposals exist only as chat-stream events; the egress path discards response
  headers and cannot consume an SSE stream; no OAuth 2.1 client, no token store, host-level allowlist, per-source-only quota;
  no MCP feature flag; the CI admission guard covers `b19-` only.
- Owner decisions the chapter needs (OD-41 … OD-59) listed with a safe default each; increments A0 … A5, B1 … B4, C1 … C3,
  D1 … D3 planned test-first with their suites, CI lists, ratchet moves and artifacts (`discovery.md` section 7, adjusted in
  section 9: the protected-resource metadata document and a Sirkit-issued short-lived MCP token are part of B20-B2; B5
  view-session delivery and B6 stdio deferred by default).

### B20-A0 - the MCP server registry, generalised admission, the feature flag and the CI admission rule (2026-09-17 local; workflow + lead; this commit)

- Implemented test-first by a single-writer workflow (`wf_ec6622a8-858`; the three new suites and the two new CI-guard cases
  failed on the unchanged tree first): `app/lib/mcp/server-registry.ts` (registry 1.0.0, EMPTY by OD-48, deep-frozen with no
  add/remove API; RFC 8707 canonical URIs with origin (host and port) and exact-path endpoints; supported protocol versions
  with 2025-11-25 only under `compatibilityEra`; secret references by environment-variable NAME with closed roles; descriptor
  pin; bounded limits with a minute-window floor of 4 so the agent's 25% share never rounds to 0; per-tool windows;
  `maxRedirects` pinned 0; agentDisclosure unknown; state with an owner-decision id; a validator with 18 closed rule codes
  that never echoes a malformed id; `admittedMcpServer(id, env = process.env)` that consults the flag and the operator
  disabled list on every call; a 28-column CSV renderer), `app/lib/mcp/rollout.ts` (`SIRKIT_MCP_ENABLED` enables only on the
  exact untrimmed string "1"; `SIRKIT_MCP_DISABLED_SERVERS` removes only), the generic admission key in
  `admission-control.ts` (server + optional tool; both windows required; breaker per server; agent share on both; existing
  distributor behaviour and signatures unchanged), the CI job-scope guard generalised to `b19-`/`b20-` with the
  `app/lib/mcp` directory filter in the prompt-to-gerber job, `scripts/generate-b20-mcp-server-registry.ts` with the
  byte-gated `mcp-server-registry.csv`, `mcp-server-registry.md`, `mcp-client-boundary.md` (registry and admission section),
  `.env.example` entries, README row, OD-46/48/53/54/59.
- Adversarial review (four lenses, one skeptic each): 20 findings, 18 confirmed, all fixed test-first by the fix workflow
  (15 failing cases first; the deep-freeze strengthening proven by a deliberate shallow-freeze mutation caught, source restored
  by hash) and confirmed by an independent checker: admission no longer fails open when the environment is omitted; the
  endpoint keeps the port (a ported URI and its port-443 twin are different endpoints); the secret-shape scan uses the
  token-anchored classifier (`containsTokenAnchoredSecretShapedText`, one new export in `redaction.ts`) so `desk-lamp-tools`
  is an identity, not a key; cross-row uniqueness of canonical URIs and credential references; a malformed id is labelled
  `(malformed id, row n)` in every message; the flag comparison untrimmed; artifact counts and citations corrected and one
  test pins the page's column count to the renderer's constant.
- Lead follow-ups on the checker's two residual low items (one case failed first): `shared-secret-reference` applies to
  credential roles only (a `client-id` is a public identifier one OAuth client may present to several resource servers;
  client secrets and access tokens stay one-server-only); discovery.md records D20-20 as closed on its registry half only,
  with the wire half (origin-and-path admission instead of hostname-only) in A1 and the pin comparison in A2.
- Gates (lead re-run on the combined tree, bounded batches, one at a time): mcp, acquisition, distributor quota/registry/
  egress 18 files / 384 (+2 env-gated skips); agent, redaction consumers, AST import gates, B16.1C tripwires (ratchet unchanged
  162 = 159 + 3 + 0: A0 adds no route), B17-F exposure, no-purchase 40 / 471; tsc 0; eslint clean on the 10 changed .ts files;
  the B20 registry, B19 source registry, action-toolability and B16.0.1/0.2 generators re-run with zero drift; no CRLF or
  control characters. Closes D20-20 (registry half), D20-21 (per-tool dimension; meters per process, OD-53), D20-24
  (registry pins `maxRedirects` 0; the wire test follows in A1), D20-26, D20-27.

### B20-A1 - the Streamable HTTP transport of the MCP client (2026-09-17 to 2026-09-20 local; workflow, three review-fix rounds, lead; this commit)

- Implemented test-first by a single-writer workflow (`wf_a330a7b8-60d`; 14 of 17 header cases failed and the two new modules
  did not exist on the unchanged tree): additive options on `app/lib/net/outbound-fetch.ts` (a bounded, allowlisted response
  header subset of at most 16 values of at most 2,048 bytes with `headersDropped`; `errorBody` for a bounded 4xx/5xx JSON body
  under the closed code `http_error`; `streamBody` handing a 2xx `text/event-stream` body back unread - without it no SSE
  reader can exist, since the bounded reader succeeds only at `done`), `app/lib/net/sse-reader.ts` (`readSseJsonRpc`:
  incremental frames, keep-alive comments ignored, stops and cancels at the awaited response, per-event, total and
  event-count caps, deadline, abort, server-initiated requests refused) and `app/lib/mcp/http-transport.ts` (`mcpPost`:
  URL only from the row's canonical URI and admitted by origin AND exact path - the wire half of D20-20; `maxRedirects` 0
  with the Authorization header never re-sent - D20-24 on the wire; `Accept`, `MCP-Protocol-Version`, `Mcp-Method`,
  `Mcp-Name` with the Base64 sentinel; transport-owned `_meta` and forged reserved keys refused; Bearer only from injected
  providers, on every request, never in a URL, error or result; admission and the in-flight bound before anything is sent;
  one closed outcome per status, body and header - 202, JSON, SSE, -32020/-32021/-32022, 401/403 challenges parsed and only
  recorded, 404/405 as `legacy_or_unknown` for A2's era probe, 429/5xx with `Retry-After`). `schgen/endpoint-client.ts` gains
  one row in its total failure map. No route: ratchet unchanged at 162 = 159 + 3 + 0. Closes D20-16, D20-17.
- Review round 1 (four lenses, one skeptic each): 28 findings, 23 confirmed, fixed test-first (14 cases failed first): unread
  stream hand-offs cancelled on every non-consuming path, the sent token redacted from every result and notification leaf,
  notification text inert and bounded, capability lists as validated names, error bodies read as JSON only with a 401's
  challenge surviving an oversized body, the streamed event cap at the row's ceiling, a 400 with a Bearer challenge as
  `unauthorized`, egress refusals counted for the breaker, a non-finite `errorBody.maxBytes` clamped. A session restart cut
  off the checker; on resume the skeptics re-judged all 28 findings against the fixed tree (27 no longer real) and one more
  was confirmed and fixed (the attribution's `method` is the validated plain name or empty, never the caller's raw string);
  the lead closed the checker's residual (the attribution's `protocolVersion` likewise; one case failed first). Because the
  resume had skipped the formal check of the first pass, four independent read-only checkers then re-examined its 23 fixes:
  24 of 24 fixed (three documentation-only), and ten further distinct issues found.
- Review round 2 (`wf_d45a360c-4da`, R2-A to R2-K, 19 of 106 cases failed first; two checkers: 11 of 11 fixed and
  revert-sensitive): object KEYS redacted and scrubbed with a deterministic collision rule; the media-type sentence names only
  a plain bounded type; a token straddling the scrub's cut no longer survives as a prefix; a wire-level bodiless 202 typed
  `text/event-stream` is probed under min(1 s, remaining deadline) and accepted; an error body dropped for size is
  `response_too_large`, never `legacy_or_unknown`; the SSE reader's caps withstand NaN, Infinity and negatives under a 16 MiB
  ceiling; the read deadline is clamped against a clock stepping backwards; a caller abort is the MCP-only breaker outcome
  `inconclusive` (as the half-open trial it re-opens the breaker; the identical distributor gap at
  `distributors/egress.ts:74` is recorded as a B19 follow-up, not changed); the scrub's work is bounded (256 strings and keys
  per notification, 262,144 characters per call, `notificationsDropped`); the B19 URL-credential redaction pattern runs in
  linear time (a 100,000-character text: 3,184 ms before, 1.4 ms after; 1,500 of 1,875 corpus texts identical, the rest strict
  supersets; every redaction consumer passes unchanged); plus one found by the fixer: NFC folded a KELVIN SIGN into a real K
  after the comparison.
- Review round 3 (`wf_cc422016-251`, R3-1 to R3-5, 9 of 96 cases failed first, 34 mutations each caught, checker 5 of 5):
  the round-2 regression that a token followed by one combining mark survived the single NFC comparison - redaction is now
  three passes, fail closed (raw window, NFC form, then a skeleton of NFKD without combining marks and format characters; a
  disguised text is replaced whole; results get passes one and three only and are not normalised - a stated limit for A4);
  the dropped-notification stub never names a method that carries the token; a rewritten key can never mint a structural
  JSON-RPC name or `__proto__`; the 202 probe's four branches pinned; `mcpPost` never rejects (locked bodies, a throwing body
  getter, a hostile signal) with the in-flight count and the breaker record consistent.
- Lead follow-ups on the last checker's two low items (2 cases failed first; the digit-token fix also proven by mutation and
  restored by hash): a clock that throws after admission no longer skips the breaker record or replaces the call's outcome;
  a bearer token of digits only is refused before anything is sent, because a number in an answer is never redacted.
- Gates (lead re-run on the final combined tree, bounded batches, one at a time): net, http, mcp 9 files / 323; acquisition,
  distributor egress and quota, schgen, cross-verify 17 / 242 (+2 env-gated skips); agent and the other redaction consumers
  36 / 420; AST import gates, B16.1C tripwires, B17-F exposure, no-purchase 4 / 51; tsc 0; eslint clean on the 10 changed
  .ts files; the B20 and B19 registry generators with zero drift; no CRLF, control characters, console calls or mutation
  markers. The four A1 suites hold 122 cases (20 + 28 + 70 + 4), pinned against the page by a test.
- Recorded, not fixed: the DNS rebinding window of the egress path (D20-23, for D1); `x-mcp-header` mirroring, negotiation
  and the era probe (A2); PRM and token flows (A3); trace attribution and result normalisation (A4); the redaction pattern
  is still quadratic on many `scheme://` runs without `@` (bounded to about 210 ms per call by the scrub budget) and
  `sanitizeModelBoundText` is slow on 100,000 spaces (B19 owner follow-ups); the SSE reader's own count of notifications
  beyond its cap of 64 is not surfaced.

### B20-A2 - negotiation, tool discovery and foreign-descriptor gates of the MCP client (2026-09-20 local; workflow, review workflow, lead; this commit)

- Implemented test-first against the current revision (2026-07-28). The first attempt (`wf_2c08f734-596`) stopped on a usage
  limit after writing the fake MCP server harness and the 20-case negotiation suite against a module that did not exist yet;
  both were kept, and the relaunch (`wf_b7c30da6-dd6`) wrote the rest before a restart cut it off ahead of its review, so the
  review ran as its own workflow (`wf_14729c0f-bc0`) over the finished tree. Four modules: `app/lib/mcp/negotiation.ts`
  (`discoverMcpServer`: one `server/discover` through `mcpPost`, the newest revision both the row and the server list, exactly
  one retry on -32022, `legacy_server` for the handshake era with nothing else sent, a strict DiscoverResult, `instructions`
  and serverInfo display-only and labelled untrusted), `foreign-tools.ts` (`acceptForeignTools`: namespaced reversible ids
  that can never take or shadow a `sirkit.` id, name / directive / annotation / schema gates with one closed reason each,
  `x-mcp-header` as the one extension keyword, every accepted descriptor a new frozen object), `tool-discovery.ts`
  (`listMcpTools`: bounded paging and cursor rules, the listing digest compared against the row's `descriptorPin` - the pin
  half of D20-20 - and a 64-entry per-process cache honouring `ttlMs` / `cacheScope`), `tool-call.ts` (`callMcpTool`:
  arguments validated against the accepted schema, the Value Encoding table for `Mcp-Param-{Name}`, `input_required`
  refused, a `header_mismatch` invalidating the listing); five additive changes to `http-transport.ts` (the `paramHeaders`
  option and the exports A2 needs); no new dependency. Closes D20-18, the foreign halves of D20-15 and D20-13, and the
  D20-20 pin comparison. OD-52 (foreign naming) and OD-58 (foreign schemas within the proven wire subset, in-house) recorded.
- Adversarial review (four lenses, one skeptic each): 35 findings, 33 confirmed (20 distinct), fixed test-first (18 cases
  failed first; test-strength findings proven against named mutations) and checked by two independent checkers: 33 of 33
  fixed, 30 revert-sensitive and 3 documentation-only by construction (a null `x-mcp-header` value is refused by the schema
  validator before the header code runs, so the unreachable branch was removed and the limit stated). The worst: schema
  descriptions, titles, enum values and property NAMES were copied into the accepted descriptor with no directive scan, no
  scrub and no token comparison (a directive or the sent token hidden inside `inputSchema` reached the object A4 renders to
  the model); the sent token, case-flipped, was accepted as a tool NAME and echoed in the internal id and the provider name;
  a principal scope key of "public" made a private listing's cache key equal the shared one, so a private listing crossed
  principals; the cache key omitted the reserved provider names, so a cache hit skipped the collision gate; the directive
  pattern backtracked cubically on server text; a nested `x-mcp-header` parameter was read from the top-level argument of
  the same leaf name; accepted foreign schemas used constructs the call-time validator rejects; a backwards clock let a
  cached listing outlive its ttl; the page's line references were unpinned.
- Gates (lead re-run on the combined tree, one heavy job at a time under the global lock): mcp, net, http 13 files / 422;
  acquisition, distributor egress and quota, schgen, cross-verify 17 / 242 (+2 env-gated skips); agent, B04 registry, B17-F
  exposure, no-purchase, build-loop injection 38 / 463; AST import gates and B16.1C tripwires 2 / 29 (ratchet unchanged,
  162 = 159 + 3 + 0: A2 adds no route); tsc 0; eslint clean on the 10 changed .ts files; the B20 registry, B04 tool-registry
  and B09 agent generators with zero drift; no CRLF, control characters, console calls or mutation markers. The four A2
  suites hold 99 cases (32 + 26 + 15 + 26).
- Open, and taken in the next commit (review round 2): the checkers found 8 further issues - a whole upper-cased token that
  straddles the display bound surviving as a prefix; enum and const values scanned without treating `_` and `-` as
  separators, so an underscore-joined directive and a camelCase property name pass; unbudgeted scrub work over schema text;
  the probe rule classifying the RETRY as `legacy_server`; and four statements on the page that the tests do not back.

### B20-A2 review round 2 - the eight residual issues of the independent check (2026-09-21 local; fix workflow + lead; this commit)

- Fixed test-first by a single-writer fixer (`wf_f5324e1b-350`; 10 of 111 cases failed on the unchanged source; the
  test-strength items proven against their named mutations, every source restored by sha256) and checked by two
  independent checkers: 8 of 8 fixed and revert-sensitive.
  - A whole upper-cased token straddling the display bound survived as a prefix: `scrubDisplayText` in `http-transport.ts`
    compares case-folded over the same extended window the scrub reads, before any cut, and removes a case-folded prefix
    at the end of a cut window (a prefix only the skeleton shows replaces the text whole). Used for titles, descriptions,
    schema text, instructions, serverInfo and tool-call issues through one `displayText`.
  - Enum and const values and property names read `_`, `-` and camelCase as letters, so the review's own payload was
    accepted: `readsAsDirective` scans raw and again with those boundaries read as spaces; the tool NAME and an
    `x-mcp-header` token are judged the same way.
  - Scrub work over schema text had no per-listing budget: one budget per `acceptForeignTools` call (16 384 strings,
    262 144 characters - the transport's per-call scrub figure), charged before anything is scrubbed, including a tool's
    own title and description; a tool over the remaining budget is excluded whole as `schema_text_budget`. 500 worst-case
    tools: 65 891 ms before, 576 ms after.
  - The legacy probe rule classified the RETRY: it now applies to the first attempt only.
  - Four page statements the tests did not back are now pinned or restated (the non-object `paramHeaders` refusal, both
    sides of the size / property / depth bounds with literal counts, the output-schema drop-versus-exclude branches, and
    the pin digest now ordered by NAME as documented - recomputed independently by a test).
- Gates (lead re-run, one heavy job at a time under the global lock): mcp, net, http, acquisition, distributor egress and
  quota 28 files / 650 (+2 env-gated skips); agent, build-loop injection, B16.1C tripwires, AST import gates 37 / 440;
  tsc 0; eslint clean. The four A2 suites hold 111 cases.
- Open, and taken in review round 3: the checkers found 7 further issues - a directive written with other separators
  (`/`, `+`, `:`, `,`, `|`, `~`, middle dot, em dash) in an enum or const value still passes (medium: it reaches the
  declaration a model reads); the camelCase rule mis-splits an ALL-CAPS run and never splits a directive with no
  separators; the skeleton-only prefix branch of `scrubDisplayText` is unpinned; enum and const values are uncharged,
  and NFKD expands characters up to 18 times, so the scan cost is outside the budget; and three page statements that
  over-state what holds (the retry pass-through, the list of structural refusals that drop an output schema, and
  'bytes' where the code counts UTF-16 characters).

### B20-B1 - the MCP exposure subset and the tool definitions rendered from the registry (2026-09-20/21 local; server-track workflow + lead; 77125bd, merged in 5121891)

- The first increment of the SERVER track, run in parallel with the client track in a separate git worktree
  (`chapter/b20-mcp-server`, one global heavy-job lock across both trees), then merged into this branch with a normal
  merge (no file overlapped the client track). Implemented test-first (`wf_28e3e062-cf8`: both suites failed to import
  and the CI job-scope guard failed 1 of 7 on the unchanged tree): `app/lib/engineering/mcp-exposure.ts` and
  `mcp-exposure-review.ts` (a tool is MCP-exposed only when the structural rule over its own classification admits it AND
  the reviewed decision lists it; 16 of the 32 agent-set tools; 25 excluded with one of 12 closed reasons; a removal is a
  reviewed move to `MCP_WITHHELD_TOOL_IDS`), a deny-by-default discovery channel `mcp` in `tool-discovery.ts` (the four
  existing channels pinned byte-identical against pre-B1 digests), `app/lib/mcp/server/tool-definitions.ts` (definitions
  rendered from the registry: raw-id names, the providers' strict input schema, output schemas only within the wire
  subset, annotations derived only from Sirkit's classification, `_meta` under `dev.sirkit/`; a listing digest bound to
  the registry digest, never partial), the generator `scripts/generate-b20-mcp-tool-manifest.ts` with the byte-gated
  `mcp-tool-manifest.csv` / `.json`, and `mcp-exposure.md`. Closes D20-1, D20-2, the exclusion half of D20-33 and the
  order-and-identity half of D20-14. OD-49, OD-52 (first-party part), OD-55, OD-56 and OD-60 recorded.
- Adversarial review (four lenses, one skeptic each): 15 findings, 9 confirmed, fixed test-first (13 cases failed first;
  12 mutations each caught and restored by hash) and checked (9 of 9): a read or proposal that declares a state-writing
  side effect was admitted (now `side_effects`); the structural rule alone admitted a new agent-set read at runtime, so
  exposure now also requires the reviewed decision; the B04 import gate could not see B1's import; a registry whose second
  read answered differently got a partial listing (now `exposure_drift`); four test-strength gaps. The lead corrected one
  page sentence the checker found (which refusal code each runtime gate uses).
- Gates (lead re-run in the worktree, under the lock): the B1 suites, mcp and the CI scope guard 8 files / 291;
  engineering 96 / 1 078; agent, B16.1C tripwires and AST import gates 36 / 423 (ratchet unchanged at 162 = 159 + 3 + 0:
  B1 adds no route); tsc 0; eslint clean on the 7 changed .ts files; the B04 and B09 generators and the new manifest
  generator with zero drift. 42 cases in two suites.

### B20-A2 review round 3 - one directive matcher for every judged string, a scan budget, UTF-8 size bounds (2026-09-21 local; fix workflow + lead; this commit)

- The round-2 check found directives still readable through other separators, ALL-CAPS runs and no separator at all, so
  round 3 replaced the per-separator patches with one matcher (`wf_5d177b3f-c40`; 9 of 123 cases failed on the unchanged
  source; every named mutation caught, sources restored by sha256): one phrase list (`MCP_DIRECTIVE_PHRASES`) compiled
  once into a whole-word pattern and a squashed pattern, read over word streams of the skeleton (every run of non-letters
  one space, every case boundary a space, a capital run kept whole, an acronym reading), a partial homoglyph fold
  (Cyrillic, Greek, four Latin letters), and the existing raw markers. The payload table (118 spellings x 8 places) is
  excluded everywhere (547 of 944 rows were wrong before); a benign table of 83 identifiers, values and descriptions is
  accepted. Every judged string is charged to a per-listing scan budget (2 097 152 characters) by its skeleton length
  before it is scanned, and a skeleton over 4x the characters read (or 32 768) excludes the tool as `text_expansion`
  (500 tools of the finding's worst text: 28 051 ms before, 33 ms after). The serialised schema bound now counts UTF-8
  bytes in one pass without a copy. The skeleton-only prefix branch of `scrubDisplayText` is pinned. The retry and
  output-schema page statements corrected.
- Checked by two independent checkers: 6 of 6 fixed (two page-only, not pinned by a page test). They found 13 further
  issues, among them TWO REGRESSIONS against the previous commit: a short phrase in inverted or mixed case (`yOU mUST`)
  that the previous lowercased pass excluded is now accepted, because a case boundary always splits; and a format
  character between the words of a short phrase is deleted by the matcher's skeleton (joining the words) while the kept
  display text turns it into a space, so a clean directive is accepted and kept. Both are taken in round 4 together with
  an uncharged failing read (scan work outside the budget), the skeleton-length charge being unpinned, the argument bound
  of `tool-call.ts` still counting UTF-16 units, directives split across adjacent strings, new false positives from the
  squashed stream crossing word boundaries (`new instruction set`, `complex filtration`), Latin small capitals, and five
  page statements. Nothing is exposed meanwhile: the flag is off, the registry is empty and no agent path reads A2 yet.
- Gates (lead re-run, one heavy job at a time): mcp (client and server), net, http and the B1 exposure suite 488 passed;
  agent, B16.1C tripwires and AST import gates 423; tsc 0; eslint clean. The four A2 suites hold 123 cases.

### B20-A2 review round 4 - the matcher regressions, bounded failing reads, word-aligned squashing, OD-81 (2026-09-21 local; fix workflow + lead; this commit)

- Declared the last A2 round (`wf_61ec4859-3da`): a blocklist of directives can never be complete, so the round fixed every
  regression and every bounded-work defect, closed the cheap and precise classes, made each page statement exact and
  pinned, and recorded the filter as defense-in-depth (OD-81). 13 of 134 cases failed on the previous commit's tree;
  23 named code mutations and 8 page / owner-decision mutations each caught; sources restored by sha256.
  - Round 3's two regressions fixed: a case-free reading of the lowercased skeleton restores mixed and inverted case
    (`yOU mUST`); the matcher's skeleton keeps format characters as word separators and the kept display text is judged
    too, so a zero-width character between two words no longer hides a directive.
  - A read that fails is charged what it cost before its outcome is judged, and the skeleton is built in steps that stop
    within one code point of its bound: 500 tools of the worst uncharged text 839 ms -> 54 ms and 2 083 ms -> 119 ms.
  - `tool-call.ts` counts its argument bound in UTF-8 bytes like the schema bound.
  - Strings a model reads together are judged as one text (an enum's members, a property name before its description,
    the tool's title then its description); squashed matching is word-aligned and covers every phrase, which catches
    glued spellings (`IGNOREPRIORINSTRUCTIONS`) while accepting `new instruction set`, `complex filtration`,
    `ignorePriority` and `ignoreAboveThreshold`; Latin small capitals and the enclosed negative letters are folded.
    The benign table holds 92 entries, every one accepted; three false positives are stated on the page.
  - OD-81 recorded: the filter fails closed on what it recognises, and cannot recognise every paraphrase or obfuscation;
    the guarantee that foreign text cannot direct the agent comes from the operator-reviewed descriptor pin, untrusted-data
    labelling and the absence of authority (A4).
- Checked by an independent checker scoped to regressions, claimed classes, bounded work, leaks and page statements: 9 of 9
  fixed and revert-sensitive. It found 4 further issues, taken in a short follow-up round: a format character INSIDE a word
  of an exact phrase (`Ig<ZWSP>nore the above`) now passes, because the previous commit's reading that deleted format
  characters was dropped (medium, a regression); word-aligned squashing drops two glued spellings the previous substring
  squashing caught, beyond the one stated limit; a schema property's own title is not joined with its description, as the
  page claims; and two statements of the scan-budget and `text_expansion` rows no longer match the code. Nothing is
  exposed: the flag is off, the registry is empty and no agent path reads A2 yet.
- One incident, recorded: the fixer's mutation harness called `bash` from Python, which Windows resolved to WSL's
  `bash.exe` and booted the WSL VM; nothing ran in it, the fixer shut it down (`wsl --shutdown`), and WSL reports no
  running distribution. Harnesses must name Git Bash explicitly.
- Gates (lead re-run, one heavy job at a time): mcp (client and server), net, http and the B1 exposure suite 499 passed;
  agent, B16.1C tripwires and AST import gates 423; tsc 0; eslint clean. The A2 suites hold 134 cases.

### B20-B2 - the Sirkit MCP endpoint, its principal, the route policy and the census move (2026-09-20/21 local; server-track workflow + lead; 0e80b30, merged in 71250ad)

- the Sirkit MCP endpoint, its principal, the route policy and the census move, on `chapter/b20-mcp-server` over `77125bd`, test-first (22 of 23 files failed first: missing modules and renderer exports, and the old generators rewriting the matrices on import). POST `/api/mcp` is served by the new canonical wrapper `mcpBearerJsonRoute`, whose order is by construction: the flag, the options, the exact `mcp-bearer` policy, the production blocker, the configuration, Origin when present, no query string, the RFC 6750 credential, the verifier plus the wrapper's own claim re-check, the per-principal limit, the LIVE membership revision, the role gate, media, the bounded body. The token is a Sirkit-issued HS256 JWS (header pinned by bytes, exactly eleven claims, one hour, nothing stored), minted by POST `/api/mcp/token` for a live cookie member. The dispatch serves `server/discover`, `tools/list` (B1's rendering filtered by the mapped role) and `tools/call` (a closed `not_served` refusal). The RFC 9728 metadata is served from `app/.well-known`, and every route inventory walks both roots through `route-tree.ts`. Census 162/159/3/0 → 165/162/3/0; eight artifacts regenerated (+3 rows each, +1 action record); the three route matrices are now byte-pinned. The live re-read changed one default: a missing `MCP-Protocol-Version` is 400 `-32020` (Server Validation), naming the supported versions; an unsupported value is 400 `-32022`. It also CONFIRMED that the metadata's `authorization_servers` is a MUST in MCP 2026-07-28; B2 leaves it out per OD-43 (recorded deviation, D20-3 partial / BLOCKED-LIVE). Gates, re-run one at a time: B2 10 files / 101; auth and API 48 / 545 (+9 skipped); registry, CI, MCP, B04/B05/B09/B10/B11 23 / 556; other policy readers 37 / 1193; route suites 3 / 39 (+1 skipped); tsc 0; eslint clean on 51 files (the `app/.well-known` route included); zero generator drift; eight mutations each caught. Recorded, not fixed: the served `.well-known` route and the 405s are for B20-D3; suite H awaits A2's discovery calls; the wrapper's pre-dispatch refusals are untraced; the limits are per process.
- Adversarial review (four lenses, one skeptic each): 18 findings, 16 confirmed and fixed test-first, 16 of 16 checked. All 15 confirmed findings were fixed test-first. - The route walker no longer skips dot-directories below `app/api` and `app/.well-known`. This closes a gap in the census and inventories introduced with the shared walker. A virtual-tree case and a census of every route file Next would serve now pin it. - -32022 now carries `data.requested`, and JSON-RPC errors never send `"id": null`: the id is echoed when it can be read, including after an internal failure. - The weak tests were strengthened: the internal-error catch-alls, response-shaped bodies, the Accept, Content-Type and secret bounds, Origin checked before verification, per-member rate-limit keys, the byte-identical invalid-token answer, the wrapper's role, capability and policy branches, `local_dev` minting, the route-matcher tripwire, and J2's runtime import closure. - 19 deliberate source breakages were each caught by the intended test, and every restore was verified by sha256. - Cases went from 101 to 108. The census stays at 165/162/3/0, with zero artifact diff. tsc and eslint are clean.
- Lead follow-ups on the checker's two low items (one case failed first): the runtime import closure of the J2 gate resolves specifiers case-insensitively, like the direct-import helper it replaced, so a case-variant import of a forbidden module is followed on Sirkit's case-insensitive filesystems; a stale walker comment corrected. Merged into this branch with a normal merge; no file overlapped the client track. Lead gates in the worktree: auth, API MCP and lib MCP 53 files / 808 (+9 env-gated skips); app/api 27 / 1 059; engineering, agent, CI scope and AST gates 132 / 1 501; tsc 0; eslint clean on 50 files; 14 generators with zero drift; census 165/162/3/0.

### B20-A2 follow-up - format characters inside a word, glued spellings, a schema node read as one text, two page rows (2026-09-21 local; fix workflow + lead; this commit)

- The four items the round-4 check left (`wf_43ac79ad-8a4`), each fixed test-first with named mutations caught and
  sources restored by sha256:
  - A format character INSIDE a word of a phrase (`Ig<ZWSP>nore the above`, `pri<SHY>or`) is read again: when the
    matcher's skeleton holds a format character, the phrase readings run twice, once with the characters as separators
    and once with them deleted (600 rows; 330 failed on the previous commit).
  - Glued spellings the earlier substring squashing caught are read again without reviving the round-4 false positives:
    a `~` word may run on from inside the word that holds its last two letters, and a verb glued to `always` may run on
    into its object (`ALWAYSINVOKESIRKIT_PCB_EXPORT`, `iGNOREpREVIOUSLYgIVENiNSTRUCTIONS`); prose such as "always calls"
    stays accepted (40 rows failed before).
  - A schema node's own title and description are judged as one text (with the property's name first), charged to the
    scan budget like every judged text (5 hostile rows and one charge row failed before).
  - The scan-budget, `text_expansion` and `schema_text_budget` rows of `mcp-client-boundary.md` now say what the code
    does, pinned by a page case. OD-81 lists the stated limits; the benign table still holds 92 entries, all accepted.
- Checked by an independent checker: 4 of 4 fixed and revert-sensitive. It found 3 further issues, taken in a short
  round next: the `~` run-on lets `these` match `the se...`, so benign prose such as "ignore the server certificate"
  is refused (medium, a regression, not stated); the one node text meets the `email ... the` phrase, so a node titled
  `Email` whose description starts "The ..." is refused, and the name-then-title half went beyond the decision (low, a
  regression); and the glued always-verb wording on the page, in the code comment and in OD-81 does not match what the
  acronym stream reads (low). Nothing is exposed: the flag is off, the registry is empty and no agent path reads A2 yet.
- Gates (lead re-run, one heavy job at a time): mcp (client and server), net, http and the B1 exposure suite 514 passed;
  agent 394; B16.1C tripwires and AST import gates 29; tsc 0; eslint clean on the three changed files. The A2 suites
  hold 139 cases.

### B20-A2 round 6 - the in-word run-on narrowed, the exfiltration phrase within one string, exact always-verb statements (2026-09-21 local; fix workflow + lead; this commit)

- The three items the follow-up's check left (`wf_fa70993d-38e`), each fixed test-first with named mutations caught and
  sources restored by sha256 (12 code mutations, 8 page mutations):
  - A `~` word runs on across a split only after its FIRST letter, the rest contiguous (the shape inverted case gives a
    word), and a `~` word of three letters or fewer only contiguous: the follow-up's split before the last two letters
    read `these~` as `the se<anything>`, so "Ignore the server certificate" was refused (70 of 90 rows and 44 of the
    sweep's 54 failed before). A sweep of every `~` word split after an English word or a filler finds no benign sentence
    the new rule refuses; two spellings the follow-up read are stated limits.
  - The exfiltration phrase (`send|post|upload|email|forward` + object) is read only WITHIN one judged string, never across
    the line break of a joined text: its verbs are the common noun labels of fields, so `{email: {description: "The user's
    email address."}}` - refused since review-4 - is accepted, while "Email the project secrets to ..." within one string
    stays excluded (14 rows failed before).
  - The glued always-verb is stated as the two case-split streams read it (page, code comment, OD-81).
- Checked by an independent checker: 3 of 3 fixed and revert-sensitive. It found two page statements inexact; the lead
  made both exact, each with a case appended at the end of its suite (no cited line moved; the three-letter rule's revert
  fails it, restored by sha256): a `~` word of three letters or fewer split after its first letter is not read
  (`nEVERlOGS`, a stated limit beside `doNotLOgout`), and after an ALL-CAPS `ALWAYS` the unread verb is the one whose run
  of capitals ends before its last letter. The filter stays defense-in-depth (OD-81): nothing is exposed, the flag is off,
  the registry is empty and no agent path reads A2 yet.
- Gates (lead re-run, one heavy job at a time): mcp (client and server), net, http and the B1 exposure suite 521 passed;
  agent, B16.1C tripwires and AST import gates 423; tsc 0; eslint clean on the three changed files. The A2 suites hold
  146 cases.

### B20-B3 - MCP reads served from the durable server board (2026-09-21 local; server-track workflow + lead; 78c0339, merged in a097c3a)

- Designed read-only first (designer, critic, reviser; `scratchpad/b20/task-B3.md`), answering where canonical state
  lives for a principal without a browser: the durable pcb-sync board (the current generation of the lineage rooted at
  `board:<projectId>`), the server-owned B13 component authority and the static presets; no table stores the editor's
  `SchematicState`. `tools/call` on a listed read now answers from that board through the canonical B05 service on the
  `mcp` channel with `durable-server-board` authority, behind `readOnlyDurableWorkflow` (its `commit` refuses
  `DW_READ_ONLY_VIEW`, proven over the resolved production defaults). Each call binds its revision (`_meta
  dev.sirkit/expectedRevision`, required except on the two revision reads), optionally the registry digest and an
  idempotency key; the board (id, `pcb2-`, sha256 `pb1-`) and the membership are checked again after the read; refusals
  are closed codes with fixed sentences; one `sirkit.mcp-read-trace.v1` record per call. `sirkit.schematic.inspect` and
  `sirkit.project.history-inspect` are withheld (OD-69), so the subset is 14 (9 served reads, 5 listed proposals answering
  `not_served` until B4). Six board reads declare `durable-server-board` (OD-68); the registry digest moved to
  `eng1-4aacd63c7e0a6193` and the B09, B11, b16-0-2 and MCP manifest artifacts were regenerated. `/api/mcp` is classified
  durable `read`; the census is unchanged at 165/162/3/0. Written test-first (9 mutations caught); OD-67..73.
- Adversarial review (four lenses, one skeptic each): 13 findings confirmed and fixed test-first, each test-strength fix
  proved by a named mutation with the source restored by sha256. The most serious: an aborted or timed-out read released
  its admission slot while its durable query still ran, so the caps did not bound the load on the shared database pool
  (now held until the query settles; C20, A14); the import gate and the dispatch header credited J2 with "no database
  write", which since B3 is enforced at run time (G7, H15); the `pcb2-` output of `pcb.revision-inspect` read as the pin
  (the instructions and sentences now name the `eng1-` pin's place; H17). U5 (the component id space) is CONFIRMED on the
  prompt-to-Gerber acceptance run's synced board.
- Lead follow-ups (test-first, mutation-proven): the review's slot hold had no ceiling, so a query that never settles
  held its slot until the process restarted; the lead added `MCP_READ_STUCK_WORK_GRACE_MS` (60 s after the call answered,
  a ninth read bound with its ceiling), releasing the slot and counting the abandonment once (C23 fails with the watchdog
  removed). The endpoint page and the dispatch header now state exactly what the import gate proves (no approve, bind,
  withdraw, rebind, purchase, qualify, release or process run); pcb-sync publication and board-lineage derivation are in
  the closure, and every such write goes through `workflow.commit`, which the read-only view refuses. The page's line
  references were re-derived and are pinned by F8 (a moved citation fails it).
- Gates (lead re-run in the worktree, one heavy job at a time): auth, API MCP and lib MCP 59 files / 880 (+9 env-gated
  skips); app/api 27 / 1 059; engineering, agent, CI scope, AST gates and the acceptance pipeline 135 / 1 534; tsc 0;
  eslint clean on 34 files; 14 generators with zero drift (artifact hashes compared before and after). Merged into this
  branch with a normal merge.
- On the merged tree (lead, after recording OD-67..73, the closure clauses, the README row and the reference notes' re-read):
  auth, API MCP, lib MCP, net and http 67 files / 1 107 (+9 env-gated skips); app/api 27 / 1 059; engineering, agent,
  acquisition, AST gates and the acceptance pipeline 147 / 1 728 (+2 env-gated skips); tsc 0; 16 generators with zero
  drift.

### B20-A3 - first dispatch stopped at the live re-read of the authorization pages, before any code; the lead's decisions (2026-09-21 local; workflow, review-fix round + lead; this commit)

- Dispatched on 4299067 to build the MCP client's authorization (RFC 9728 discovery, RFC 8414 / OIDC metadata from a pinned
  issuer, the client-credentials grant with RFC 8707 `resource`, an in-process token cache, one refresh and one bounded
  step-up). The task's section 0 re-read (fetched live 2026-09-21) found that the client-credentials extension
  (`io.modelcontextprotocol/oauth-client-credentials`) lists "Declare support" first for a client: the extension goes in
  every request's `_meta["io.modelcontextprotocol/clientCapabilities"].extensions`, and a server that requires it can reject
  a client that does not declare it. No section 4 decision declared a capability - the task's stop condition - so A3
  stopped before code and no source file changed.
- The same re-read found three more departures of the task's defaults: the ext-auth draft sends a client secret in the
  request content (OAuth 2.1 section 2.4.1: the body MUST, HTTP Basic MAY), the reverse of the task's Basic preference; an
  MCP server MUST implement only ONE of the challenge `resource_metadata` and the well-known URIs, so the proactive default
  (no token-less request) could not reach a conforming server that publishes its metadata only through the challenge; and
  implementations SHOULD accept an uppercase scheme and host in the canonical URI, from which the exact `resource`
  comparison departs.
- Review of the stop report (four lenses): 4 coverage findings confirmed and fixed test-first. The dated re-read is
  `mcp-reference-notes.md` section 9, appended (sections 1-8 byte-identical, pinned by sha256, so discovery.md's line
  citations do not move); `app/lib/mcp/__tests__/b20-a3-live-reread.test.ts` (7 cases) pins the record and this entry; 4
  mutations caught, the notes restored by sha256 each time.
- The lead's decisions (`scratchpad/b20/task-A3-lead-decisions.md`, each with the owner's alternative, recorded in OD-62
  and OD-64 when A3 lands): declare the extension on every request of a client-credentials row only (LD-1); keep HTTP Basic
  when listed or when the method list is absent, the body method only when it alone is listed, and refuse a list naming
  neither (LD-2); follow the specification's discovery order - one credential-free probe to read a same-origin 401
  challenge, then the well-known URIs; a cross-origin challenge URL stays refused, the one recorded departure (LD-3); the
  first token request asks for the challenge scope, else `scopes_supported`, each intersected with the row ceiling (LD-4);
  keep the exact `resource` comparison, a recorded departure from the uppercase SHOULD (LD-5). D20-19 and D20-31 stay open
  until A3 lands.
- Gates (fix round and lead, one heavy job at a time): lib MCP, net and the CI job-scope guard pass with this entry; tsc 0;
  eslint clean on the new suite; no generator input changed.

### B20-A3 - the authorization client, delivered by the re-dispatch with the lead's decisions (2026-09-21 local; increment workflow + lead; this commit)

- Re-dispatched on d7d2f61 with the lead's decisions LD-1..LD-6 (`scratchpad/b20/task-A3-lead-decisions.md`), after a session
  restart interrupted the first re-dispatch (its partial files were moved to the scratchpad and the tree cleaned). Built
  test-first: the eight new suites could not import and the A0 and live-reread suites failed their changed expectations
  (10 files, 6 cases) before any code. `mcpPostAuthorized` authorizes only a client-credentials row under
  `mcpAuthorizationTokenProvider` (every other row is `mcpPost`, with the LD-1 declaration for a client-credentials row):
  one credential-free probe of the endpoint for a same-origin 401 challenge, then the well-known URIs (LD-3); RFC 9728
  metadata with `resource` identical to the canonical URI (LD-5); RFC 8414 / OIDC metadata from the PINNED issuer; the
  client-credentials grant with RFC 8707 `resource`, Basic unless only the body method is listed (LD-2); the first scope
  from the challenge or `scopes_supported` within the ceiling (LD-4); an in-process cache; one refresh after a 401 and one
  bounded step-up; a per-call collector redacting every token the call held. The registry moves to 1.1.0 with the
  authorization-server pin (30 CSV columns). Live re-read of the two pages the decisions rest on (2026-09-21): unchanged.
  16 named mutations each failed its case; sources restored by sha256.
- Adversarial review (four lenses, one skeptic each): 28 findings raised, 22 confirmed and fixed test-first (13 of 144
  cases failed on the review's tree). Among them: a pre-issued token over 8 192 characters could escape the case-folded
  redaction (now never sent, `token_malformed`); a token endpoint with a trailing slash could equal an MCP endpoint, and a
  client-id reference could name another row's credential (both refused by the registry now); a still-valid token evicted
  mid-walk could surface in a later page's error (every post's `redactAlso` now carries the call's collector); the probe
  judged the transport's normalised URL instead of what the server wrote (now the raw parameter). The independent check:
  every confirmed fix done, all but two revert-sensitive (one page wording, one state-probe walk not pinned).
- The check's one new issue, fixed by the lead test-first (the new prm-discovery case failed on the review's tree): the raw
  parameter read every `resource_metadata` after `Bearer` to the end of the field, so a 401 carrying a second challenge
  (`Bearer ..., DPoP algs="ES256", resource_metadata="..."`, which RFC 9728 section 5.1 allows) was refused as a repeated
  parameter, and `parseBearerChallenge` could take a later challenge's `scope` as the Bearer challenge's. Both parsers now
  read only the Bearer challenge's own parameters (`bearerChallengeParams`); the boundary page's 44 transport citations
  after the change were re-pinned by a line map of the diff.
- OD-61..OD-64 recorded (OD-62 and OD-64 carry LD-1..LD-5 with the owner's alternatives); D20-19 closed for the B20-A
  credential shapes, reachable once A4's composition root injects the provider; the client side of D20-31 closed. Nothing
  is exposed: the flag is off and the registry holds no server.
- Gates (lead, one heavy job at a time): mcp (client and server), net, http and the B1 exposure suite 721 passed;
  app/api/mcp 75; agent, B16.1C tripwires, AST import gates and the CI job-scope guard 430; tsc 0; eslint clean on the 20
  changed and new files; the registry generator byte-identical. The A3 suites hold 146 cases.
