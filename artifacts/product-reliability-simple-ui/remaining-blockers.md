# Remaining blockers, open owner decisions and remaining work

Dated 2026-10-17 against `codex/astra-foundation`. Each item names what it blocks, what is needed to clear it, and what already works
without it. "Fixture-backed" means proven with the recorded design, scripted agent and in-memory stores; "live" means the owner's real
keys, database or tools on this machine.

## 1. What works today without any further resource

- **Normal mode, live (2026-10-16, LR-1):** a Build request in the real page produced a complete 8-part proposal; approval, bindings,
  plan, a durable board and a local qualification with the bundled FreeRouting (0 remaining connections, 0 shorts, 0 DRC errors) ran
  in the owner's browser. Export stayed the administrator's click. Cost 0.19 USD.
- **Fixture browser, permanent:** the journey contract, prompt-to-Gerber, the simplified workspace at four desktop sizes, the
  missing-parts workflow, and the assistant's generation through the same review dialog (`e2e/*.spec.ts`, see `validation.md`).
- **Astra contract, live (2026-10-17, LR-2):** the owner's account lists `gpt-6-astra`; one forced-tool turn through the repository's
  own adapter returned a valid strict tool call (0.0028 USD). Cumulative spend 0.1928 USD of the 5.00 allowance.

## 2. Live resources still missing

| blocker | what it blocks | what clears it | state today |
|---|---|---|---|
| Admitted distributor credentials (DigiKey, Mouser, Octopart, LCSC) and the owner's leave to spend vendor quota (LB-15) | a live "Search distributors" from the Missing parts list; the agent's external search beyond the offer cache | credentials in the server environment, terms confirmed per source, a decision on metered quota | every source answers its honest state (`not_configured`, `operator_disabled`, `paused`); the fixture proof disables all sources |
| The catalog governance project (`SIRKIT_ATOMIC_CATALOG_TENANT_ID`, `SIRKIT_ATOMIC_CATALOG_PROJECT_ID`) and two different humans | publishing a reviewed draft so a missing part becomes PCB-assignable | the two ids configured; a reviewer and a different administrator | the publication route answers `ATOMIC_PUBLICATION_GOVERNANCE_UNCONFIGURED`; draft requests are prefilled, never submitted by the assistant |
| Anthropic credits | the "Use Anthropic instead" fallback and any Anthropic live turn | credit on the owner's Anthropic account | the key answers `insufficient_quota`; the UI says so |
| Production authentication against an isolated Supabase project (LB-1, LB-13) | the production-auth Playwright config; any claim about hosted sign-in | an isolated staging project and its redirect list | local development identity only |
| A contained routing platform (LB-3, LB-8 qualified) | routing in CI; measured FreeRouting runs over Astra placement candidates | a qualified container or OCI platform for the router | routing ran locally once in the browser (LR-1); the feedback loop is proven with a fake executor |
| Live model evaluation under a spend cap (LB-2, LB-7, LB-9) | the directive's section 13 comparison (deterministic vs Astra-guided placement at 10, 25 and 50 parts), real disagreement, fallback and quota behaviour | an approved budget beyond the remaining 4.81 USD for a corpus run, or a smaller agreed corpus | one live Build request (LR-1) and one Astra contract turn (LR-2) only |
| Physical fabrication, assembly and test (LB-5); quote and order exchange (LB-11, LB-12) | any manufacturability or hardware claim | a manufacturer account and the owner's explicit order decision | never attempted; release and ordering stay human and are not exposed to the assistant |
| Sandbox qualification for authoritative simulation (LB-10); database platform operations (LB-14); a live MCP server (LB-16); a real kicad-cli oracle (LB-17); local container PostgreSQL (LB-6) | the named B22, B24 and B20 qualifications | each its own platform or tool | unchanged from B24's PARTIAL verdict |

## 3. Owner decisions open

1. **Route "Generate a schematic: …" to the assistant by default** on an empty project. Today the composer's own Generate takes it
   (`composer-routing.ts` rule 2); the assistant is reached with "Ask the assistant instead". Both paths share one generation and one
   dialog (OD-243, OD-246).
2. **Cross-run single-flight for the assistant's generation.** A second generation while a proposal is pending is blocked only by the
   modal review dialog; the server has no pending-proposal check across runs.
3. **Send the editor's Build/Theory mode in the chat body.** The Build fact is derived from the sheet (no Theory component), so a Theory
   user on an empty sheet is offered the Build generation (OD-246).
4. **Admit the generation event to the orchestration coordinator's artifact set** under `SIRKIT_ORCHESTRATION_ENABLED=1` (off by default).
5. **A durable engineering-notes store** for module contracts. Today the run-log card is the note.
6. **Persist sealed artifacts in the chat record.** A reloaded draft-request card is a static record; asking again re-issues it.
7. **The CI split (OD-250, default applied).** The agent-orchestration suites moved to the agent-boundary job to keep OD-30's 40 % line;
   the owner may prefer amending the line instead.
8. **Retire `/api/schematic/build-multi`** once the assistant path is the only producer (OD-106's first option; OD-243 kept the route).
9. **Exposing the placement → routing feedback loop** as an agent tool, or through the sealed layout-experiment request (OD-249).

## 4. Remaining Astra work

Delivered (fixture-backed, OD-249): increment A (compatibility, profile, rebaseline; the live contract turn), C (module contracts),
D (placement intent, stackup and via-policy candidates over the qualified profiles), E (the bounded feedback loop and its capability
matrix). Remaining, in the directive's order:

- **F, qualify single-coordinator operation live:** `gpt-6-astra` as coordinator for a real circuit through the existing runtime, with
  the spend cap, recorded failures, cost and latency. Needs the live evaluation budget in section 2.
- **G, bounded specialist collaboration** with the same contracts, isolated candidate workspaces and one integration path.
- **H, the complete browser-to-artifact workflow** with Astra in the loop, after F and G.
- **Four-layer profiles:** only the two-layer `simple-2` profile with through vias is qualified by code today; four-layer needs its own
  stackup, plane, via-span and DRC qualification increment before any candidate may use it.
- **Unsupported routing constraints:** differential coupling, skew, impedance and return paths do not survive the router path
  (`astra/routing-capability-matrix.csv`); a qualified alternative workflow is required before any such constraint is claimed.

## 5. Engineering items carried forward

- **The drone request failure (2026-10-17).** The owner's four-motor drone request ended with "All 3 subsystem blocks failed to
  design": checkpoint C's 40-second shared generation budget was too short for a planner, catalog searches and three subsystem loops. A
  concurrent correction (another agent, uncommitted in the main checkout) raises the budget to 180 seconds and adds a cancellation
  boundary; it must be committed, combined with this branch and re-run on a complex request.
- **CI split.** Resolved at G by OD-250's default (all assignment suites admitted to CI; moved share 42.5 %); CI minutes are INFERRED until
  the first CI run.
- **Permanent-test gaps** listed in `verification-matrix.md` (35 gap lines): for example browser Cancel and double-click on the proposal
  dialog, a browser proof of the 3D tab with a board present, and browser proofs of the three newer agent artifacts.
- **Owner-appended runbook sections J and K** (multi-sheet schematics and workload limits; work log, recovery controller, part
  acquisition and real 3D models). Not started: both say to finish the current assignment first.
