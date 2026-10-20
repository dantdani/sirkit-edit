# Remaining blockers, open owner decisions and remaining work

Dated 2026-10-17 against `codex/astra-foundation`; [PR-L7, 2026-10-20] brought current for sections L and M at `deaf15ca` (the live run
LR-3, the M2 owner decisions, the open engineering items of increments 5-7 and M4). Each item names what it blocks, what is needed to clear
it, and what already works without it. "Fixture-backed" means proven with the recorded design, scripted agent and provider and in-memory
stores; "live" means the owner's real keys, database or tools on this machine.

## 1. What works today without any further resource

- **Normal mode, live (2026-10-16, LR-1):** a Build request in the real page produced a complete 8-part proposal; approval, bindings,
  plan, a durable board and a local qualification with the bundled FreeRouting (0 remaining connections, 0 shorts, 0 DRC errors) ran
  in the owner's browser. Export stayed the administrator's click. Cost 0.19 USD. (That run used the request-lifetime route section L
  has since replaced.)
- **The durable generation task, live (2026-10-20, LR-3):** the owner's four-motor sentence through Build in normal mode on the
  builder's own server and worker: 202 at once, a plan with disclosed assumptions, one block saved, two slices yielded and continued,
  then a specific blocker (`provider_quota`) with the saved block kept and shown. 1.17 USD (`persistent-generation/final-verdict.md`).
- **Fixture browser, permanent:** the journey contract, prompt-to-Gerber, the simplified workspace, missing parts, the assistant's
  generation through the same review dialog; [PR-L7, 2026-10-20] and the durable task (Build, reload, Stop / Pause / Resume, project
  switch), chat on the same task (Stop answer vs Stop design), the four-motor request and the LED dimmer to awaiting qualification,
  D1 / D2 resolution, the acquisition chain to a published replacement, and a replacement on a project with a durable board
  (`e2e/*.spec.ts`; `persistent-generation/validation.md`).
- **Astra contract, live (2026-10-17, LR-2):** one forced-tool `gpt-6-astra` turn through the repository's own adapter (0.0028 USD).
- **Spend:** known 1.3628 USD of the 5.00 allowance; LR-3's unspent reservation 2.66 USD held for its resume; provable remainder
  0.9772 USD (`live-spend.json`).

## 2. Live resources still missing

| blocker | what it blocks | what clears it | state today |
|---|---|---|---|
| [PR-L7, 2026-10-20] **The owner's OpenAI quota** (`insufficient_quota` during LR-3, 2026-10-20 before 01:02 UTC) | every live generation: LR-3's resume to a reviewable four-motor design (L.7 item 9 live, L.8's stop condition in its strongest form), any live chat start, any further live qualification | the owner raises the OpenAI billing quota or spend limit; then resume LR-3's task (the same task, inside its held reservation) | the task `generation-task:e4b1f4b694a91b011486487a8f3c02b7` (project `21558dad-52cd-473a-9101-e72a16deded6`) is durable, one block saved, b2 blocked `provider_quota`, b1 waiting on a scheduled retry |
| Admitted distributor credentials (DigiKey, Mouser, Octopart, LCSC) and the owner's leave to spend vendor quota (LB-15) | a live "Search distributors" from the Missing parts list; the agent's external search beyond the offer cache | credentials in the server environment, terms confirmed per source, a decision on metered quota | every source answers its honest state (`not_configured`, `operator_disabled`, `paused`); the fixture proof disables all sources |
| The catalog governance project (`SIRKIT_ATOMIC_CATALOG_TENANT_ID`, `SIRKIT_ATOMIC_CATALOG_PROJECT_ID`) and two different humans (OD-M2-1, OD-M2-2) | publishing a reviewed draft or an acquired candidate so a missing part becomes PCB-assignable | the two ids configured; a reviewer and a different administrator | the publication route answers `ATOMIC_PUBLICATION_GOVERNANCE_UNCONFIGURED`; an acquisition task stops at awaiting review with that blocker and keeps its candidate |
| Anthropic credits | the "Use Anthropic instead" fallback and any Anthropic live turn | credit on the owner's Anthropic account | the key answers `insufficient_quota`; the UI says so; LR-3 ran with the reranker key empty |
| Production authentication against an isolated Supabase project (LB-1, LB-13) | the production-auth Playwright config; any claim about hosted sign-in | an isolated staging project and its redirect list | local development identity only (LR-3's page shows the local-identity banner) |
| A contained routing platform (LB-3, LB-8 qualified) | routing in CI; the fixture four-motor and dimmer boards stop at awaiting qualification (no router recording, OD-253 (5)) | a qualified container or OCI platform for the router | routing ran locally once in the browser (LR-1) |
| Live model evaluation under a spend cap (LB-2, LB-7, LB-9) | the directive's section 13 comparison, real disagreement, fallback and quota behaviour | an approved budget beyond the provable remainder (0.98 USD), or a smaller agreed corpus | LR-1, LR-2 and LR-3 only |
| Physical fabrication, assembly and test (LB-5); quote and order exchange (LB-11, LB-12) | any manufacturability or hardware claim | a manufacturer account and the owner's explicit order decision | never attempted; release and ordering stay human and are not exposed to the assistant |
| Sandbox qualification for authoritative simulation (LB-10); database platform operations (LB-14); a live MCP server (LB-16); a real kicad-cli oracle (LB-17); local container PostgreSQL (LB-6) | the named B22, B24 and B20 qualifications | each its own platform or tool | unchanged from B24's PARTIAL verdict |

## 3. Owner decisions open

1. **Route "Generate a schematic: …" to the assistant by default** on an empty project (OD-243, OD-246). Both paths now share the same
   durable task (L.5).
2. ~~Cross-run single-flight for the assistant's generation.~~ [PR-L7, 2026-10-20] superseded by L.5: one active task per project and
   branch; a second start answers `GENERATION_TASK_ACTIVE` naming the running task (`e2e/l5-chat-task.spec.ts` case 2).
3. **Send the editor's Build/Theory mode in the chat body** (OD-246).
4. **Admit the generation event to the orchestration coordinator's artifact set** under `SIRKIT_ORCHESTRATION_ENABLED=1`.
5. **A durable engineering-notes store** for module contracts.
6. **Persist sealed artifacts in the chat record.**
7. **The CI split** (OD-250, default applied; increment 7's admission and re-measurement: the CI builder's OD-254).
8. **Retire `/api/schematic/build-multi`**, unused by the page since L.4 (OD-252 item 8 kept it).
9. **Exposing the placement → routing feedback loop** as an agent tool (OD-249).
10. [PR-L7, 2026-10-20] **Section M2's owner decisions** (`component-resolution/m2-acquisition-design.md` section 6; the default applied
    in brackets): OD-M2-1 the governance scope per environment [publication refuses]; OD-M2-2 the named requester, reviewer and a
    different publisher [nothing becomes eligible]; OD-M2-3 accept GitLab.com's Subscription Agreement, Acceptable Use Policy and API
    Terms for automated raw-file reads [`kicad-gitlab` blocked]; OD-M2-4 the KiCad licence attribution text and link [shown as recorded];
    OD-M2-5 which refs the live adapter may read, and a `kicad-packages3D` pin [pinned commits only]; OD-M2-6 an optional GitLab token by
    env name [none]; OD-M2-7 migration 0032, a deletable blob table for datasheet PDFs and 3D [KiCad text only; PDFs and 3D refused];
    OD-M2-8 cross-tenant handoff [refused]; OD-M2-9 manufacturer datasheet domains [none; distributor links shown, never fetched];
    OD-M2-10 commercial CAD services' written API terms [not admitted]; OD-M2-11 private-review assets and a tenant-private library tier
    [refused; no tier]; OD-M2-12 a closed parse engine before any live adapter [live blocked until it exists]; OD-M2-13 one bounded live
    run of 4 files from gitlab.com at US$0 [not run]; OD-M2-14 what the agent may see of CAD sources [labels and validation results].
11. [PR-L7, 2026-10-20] **Rebinding a part already bound on the board to another revision from the page** (`PB_ACTIVE_SELECTION_CONFLICT`,
    the pinned B19-E rule): only an API-level reviewer supersede and bind works today; the board stays behind and qualify / release stay
    refused until then. A reviewed binding replacement when the instance's exact revision changes needs the owner's decision.
12. [PR-L7, 2026-10-20] **A server-side schematic-currency guard on `/api/pcb/qualify` and `/api/pcb/release`** (OD-253 item 8 left it to
    the owner): the board-behind gate is client-side; an administrator could POST release directly.
13. [PR-L7, 2026-10-20] **The fixture builder's choices** (OD-253 (1)-(5) applied): `catalogProfile` stays `fixture-blinker`; no router
    recording for the four-motor or dimmer board; the fixture categories keep singular names; a Build generation never pauses for a
    question (the question path, OD-253 (3), is not built); STM32 / ESP32 parts need parser work first.
14. [PR-L7, 2026-10-20] **Another allowance for LR-3:** "Continue with another allowance" would need about 2.95 USD more of provable
    reservation; the remainder is 0.98 USD, so it needs the owner's further authority.

## 4. Remaining Astra work

Delivered (fixture-backed, OD-249): increment A (compatibility, profile, rebaseline; the live contract turn), C (module contracts),
D (placement intent, stackup and via-policy candidates over the qualified profiles), E (the bounded feedback loop and its capability
matrix). Remaining, in the directive's order: F (single-coordinator operation live; needs the live budget and the OpenAI quota), G
(bounded specialist collaboration), H (the browser-to-artifact workflow with Astra in the loop), four-layer profiles, and the routing
constraints the router path cannot carry (differential coupling, skew, impedance, return paths).

## 5. Engineering items carried forward

- ~~The drone request failure (2026-10-17): the 40-second shared budget; a concurrent uncommitted 180 s correction.~~ [PR-L7, 2026-10-20]
  superseded: the correction was integrated as an interim measure (OD-251, `84a2f72c`) and section L replaced the request-lifetime
  generation; the live run now ends at the provider's quota with work saved, not at a deadline (`persistent-generation/final-verdict.md`).
- [PR-L7, 2026-10-20] **`e2e/semantic-editor.spec.ts` scenario 3, intermittent, no root cause.** It failed twice on the M4 builder's tree
  under CPU load (once alone): the workspace tab read "schematic" at its first unpolled assertion. It then passed 16 executions on the
  final tree (8 by the gates runner under heavy load with CPU burners, 8 by the fix pass including 6 fresh-server runs on a quiet
  machine). The only latent path found (useViewSession's `ensureLive` re-creating the bus from the first render's state under Fast
  Refresh or StrictMode) is unproven as the cause and unchanged; neither a product fix nor a poll is justified yet. The instrumented copy
  is kept outside the repository to attach to the next failure.
- [PR-L7, 2026-10-20] **One `0xC0000409` worker crash under machine load.** In the B24 split's first browser run the fixture server's
  generation worker exited `0xC0000409` with no diagnostic right after "pump 1: the request failed (TypeError)" at the first
  `POST /api/chat` compile, then `next` exited 1 (4 failed, 8 did not run). The TypeError precursor recurs at every first chat-route
  compile and normally recovers; the crash happened once, with the machine at up to 100 % CPU and 0.65 GB free; the second run was 13/13.
  Root cause not established.
- [PR-L7, 2026-10-20] **The B14 exact-replacement dialog is not a board-impact consumer.** Its controller, service and closed-key receipt
  would need the same binding; the fact-derived drift covers B14 replacements after apply.
- [PR-L7, 2026-10-20] **A net-membership change on an existing board** (a proved pin permutation, an added connected part) raises
  `PS_REMOVED_NET_RECONCILIATION_REQUIRED` and no `remove_unrouted_net` is planned (existing Stage 3 behaviour, predicted truthfully).
- [PR-L7, 2026-10-20] **The post-apply passes' admission is per request, and its violation latch per server process.** Each automatic
  Tidy or Review request is bounded before it is sent (default 200,000 input tokens), but there is no cumulative post-apply allowance,
  and the `bound_disproven` latch that closes both passes after a reported input above its bound lives in one server process: another
  instance does not share it and a restart clears it. Review still sends its input twice (once in the instructions, once as the message).
  The image allowance is documented only for gpt-5.6-sol / terra / luna; other ids are charged 36,000 or refused.
- [PR-L7, 2026-10-20] **Generation engine follow-ups (L.6, optional):** a `knownPart()` fallback before `UNKNOWN_PART`, an approved-parts
  shortlist, a catalog statement timeout, a `get_part_pins` tool; the in-turn catalog-search count is checked only at claim; the
  framing overhead of the input bound is INFERRED (self-checked against reported usage); the four-motor drawing still has 2-4 cosmetic
  component overlaps the auto-layout could not resolve.
- [PR-L7, 2026-10-20] **Fixture evidence limits:** the fixture parts' pinouts (MIC5504 SOT-23-5, SS14 SMA, the headers, the 3386P
  potentiometer; LSM6DS3TR-C pins 10 / 11 drawn NC) come from the KiCad files only, never checked against manufacturer tables.
- [PR-L7, 2026-10-20] **Thin timing margins under load, no functional failure:** e.g. `b14-2` case 15b 51.2 s alone against 60 s,
  `b19-d` chat closure 3.0-3.7 s alone against 5 s, `b16-b-migrations` dry run 4.33 s alone against 5 s; vitest worker
  `onTaskUpdate` RPC timeouts turn otherwise-green runs into exit 1 (numbers in `persistent-generation/validation.md`).
- **Permanent-test gaps** listed in `verification-matrix.md`.
- **Owner-appended runbook sections J and K** (multi-sheet schematics and workload limits; work log, recovery controller, part
  acquisition and real 3D models): [PR-L7, 2026-10-20] still not started; both follow the current assignment. Multi-sheet identity
  for M.5 item 7 waits on J.
