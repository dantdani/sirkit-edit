# SIRKIT — RELIABLE PROMPT-TO-PCB, SEMANTIC CONTROL, AND SIMPLE WORKSPACE

Prepared: 2026-10-14. This is one continuous, incremental builder assignment, not another series of prompts for decimal substages.

## Assignment

You are the principal builder responsible for making the existing Sirkit product usable and reliable. Implement this assignment against the actual current code. Do not merely review it, write a plan, add attractive mockups, or report that historical chapter tests passed.

The owner reports three product problems:

1. A normal natural-language request does not reliably produce a usable schematic and then a PCB.
2. The interface looks overdecorated and AI-generated. It should become a simple, professional, robust engineering workspace.
3. It is unclear whether the assistant can perform the operations available in the UI. Meaningful, permitted editor operations need shared semantic commands and accurate AI discovery, not inaccessible React handlers or fake tool descriptions.

Deliver working behavior, a simpler existing interface, and evidence. Preserve the existing chapter goals and security architecture. Do not restart B16–B24, create a second application, or build a swarm to compensate for broken mutation paths. Astra-guided placement remains a subsequent additive capability, not a substitute for fixing this product journey.

Work through checkpoints A–I below in order. Complete, verify, record and commit a coherent checkpoint before continuing. Continue without asking the owner to supply another substage prompt. Take hours if necessary; do not compress everything into one uncontrolled rewrite.

## Workspace and non-negotiable boundaries

- Work in `C:\Users\robsa\Desktop\sirkit-edit`, unless a read-only preflight proves that the owner has explicitly designated a different current checkout. Verify the absolute root, Git remote, branch and HEAD first.
- `C:\Users\robsa\sirkit` is the protected original under the current runbook. Never edit, stage, commit, move, delete, run builds into, or reconcile it through an overwrite. The coding tool's default working directory is not permission to alter it.
- Follow all applicable `AGENTS.md` files and repository instructions. Read `C:\Users\robsa\Downloads\Sirkit_Remaining_Builder_Master_Runbook.md`, the current program ledger/state, B24 verdict and actual changed files. Treat old starting-SHA statements as historical, not current instructions to reset the checkout.
- Read the existing additive directive at `C:\Users\robsa\.codex\attachments\0614d515-77bf-41db-9a60-24b3ff4dcd28\Pasted text.txt` and `artifacts/astra-guided-pcb/CONTINUATION.md`. Preserve its dependency order and initial limit of at most 50 physical components.
- Preserve all uncommitted and concurrent work. Inventory it; do not assume it is disposable, complete, or independently verified. No `git reset --hard`, `git checkout --`, blanket cleaning, force-push, backdating, or fabricated authorship.
- Do not weaken authentication, exact-origin CSRF, membership, trusted scope, component authority, revision/lineage checks, approval tiers, execution grants, redaction, domain validation, DRC/ERC or manufacturing release.
- Never print secrets, credential values, private database contents or raw provider errors containing sensitive information. Never send a private circuit to an external service without the applicable disclosure/permission.
- The owner authorized **up to US$5 total** for bounded live API tests on synthetic fixtures only. This is cumulative, not US$5 per checkpoint, process, retry or agent. Check the shared spend record first. Prior work in this continuation made no paid calls; independently verify that before allocating the balance. Reserve worst-case cost before every request, disable automatic SDK retries for qualification, bound tokens/time/calls, and keep uncertain charges reserved. Use no paid request if the remaining budget cannot be proven. Ask only if an additional budget is genuinely required after independent offline work is exhausted.
- Production database migrations/writes, purchases, manufacturer uploads, external account changes, unrestricted downloads, provider-default changes and unsafe simulator/router execution are not implied by this assignment. Use isolated fixtures/test storage and the existing admitted service boundaries.
- Use truthful labels: `CONFIRMED`, `INFERRED`, `PROPOSED`, `UNKNOWN`, and `BLOCKED-LIVE-QUALIFICATION`. Passing recorded fixtures is not proof that a live model, live authentication, live router or physical PCB works.

## Starting facts: verify, do not rubber-stamp

The following were read from the checkout on 2026-10-14. Recheck them because files and line numbers can change.

- Local branch was `codex/astra-foundation`, HEAD `32b081e152620b46e791f9589256f7d0603f300f`, the B24 merge. Substantial corrective work is **uncommitted**. No corrective integration PR was recorded. B24 remains `PARTIAL`; the additive Astra implementation has not started.
- Owner-approved OD-236 and OD-229 fixes exist locally: `app/lib/agent/normalize-tool-arguments.ts`, gateway/loop wiring, `app/lib/engineering/agent-delete-connectivity.ts`, and the Tier-1 compiler call. Preserve and verify them. Optional null normalization must use the ORIGINAL schema and never erase required/nullable/unknown fields. AI deletion must refuse connectivity damage; human deletion remains unchanged. This is topology protection, not proof that every electrical role/net name survives arbitrary deletion.
- Local React/lifecycle repairs exist in `app/page.tsx`, `BomView`, PCB inspectors/padstack/hooks, assignment queue and command palette, with new regression tests. Earlier targeted tests and type/lint checks passed, but final whole-tree completion is **not established**. The prior full-suite session is no longer accessible; do not invent its result. Rerun the final gates and record their actual exit codes.
- `app/page.tsx` has distinct paths: `handleComposerSubmit`, `handleGenerateSchematic`, `handleEditSchematic`, and `send`; `app/lib/project/composer-routing.ts` selects `generate`, `edit`, or `ask`. Routing is not mutation authority.
- `schematic.generate` is registered as a structured route, not an agent-callable shared generation command. Source-declared tool availability is not the same as this complete workflow being callable from an agent run.
- Build-mode generation uses `POST /api/schematic/build-multi`, loads catalog parts, runs `autoLayoutBuildValidated`, and creates `pendingReplace`. Applying the generated schematic requires explicit human review. The post-apply auto pipeline currently performs tidy/review; it does **not** itself perform durable PCB synchronization.
- `lib/apply-netlist.ts::generateSchematic` sends only `Content-Type` on `POST /api/schematic` and no AbortSignal. That route uses `authenticatedJsonRoute`; `app/lib/auth/trusted-request-context.ts` requires a project selector. This is a source-level request-contract mismatch to reproduce in Theory mode, not a proven explanation of every Build-mode failure. Do not incorrectly add header authority to `/api/chat`: its dedicated boundary intentionally resolves body selectors.
- `/api/schematic/build-multi` can return `ok: true` while omitting failed subsystem blocks; its post-merge ERC findings are advisory and can be skipped on exception. This is an incomplete-result/validation-state problem to investigate. An HTTP 200 or explanation string cannot mean the requested complete circuit is electrically valid.
- Durable PCB sync and the editor already exist: `app/components/pcb/PcbEditor.tsx`, `app/lib/pcb-sync/client.ts`, `app/lib/pcb-sync/`, physical-binding routes, and `app/lib/workflow/prompt-to-gerber/`. Reuse them, including review/preflight/apply and recovery.
- `PcbEditor::handleSync` performs binding, publication and preflight; `handleApplySync` is a separate approved mutation. The sync feature defaults off unless configured, and absent client/scope can return without feedback. Inspect the actual running state and reproduce the silent return; never enable a deployment flag merely to hide a refusal. Catalog availability alone does not satisfy published-footprint and approved-mapping authority.
- Chat starts closed, while the empty sheet says `Describe a circuit above`; the composer is actually in the right chat panel. The `ask` route can submit with Enter but has no visible Send button under the current `showComposerButton` condition. Reproduce these discoverability gaps and provide an obvious entry point and labeled submission action.
- The top-level Settings button in `app/page.tsx` has no handler. The top-level 3D workspace content renders a `3D view` placeholder, while a real `PcbPreview3D` is already mounted by the PCB editor's preview sheet. Reconcile the actual feature; do not invent a second renderer or advertise a placeholder as working.
- The Build sidebar renders unconditional positive `CheckRow` entries for `No floating nets` and `Supply rails connected`. Those are not computed checks. Replace them with actual revision-bound evidence or truthful `not run`/`unknown`/`blocked` states; never retain decorative engineering passes.
- A selection-lifetime issue remains to reproduce in `app/components/pcb/Inspector.tsx`: same-kind selections with equal numeric values can reuse unkeyed inspector/NumberField instances. A pending edit/preview started on track A may target track B after selection changes. Review footprint/zone/dimension/mixed selections too. Key lifetime to identity without clearing a valid same-selection draft on every render.
- `useLivePreview` hides hints on a reset-key mismatch but retains the old hint. Reproduce whether a same-target A→B→A external-value/undo roundtrip revives an old warning without a new preview. This is a source-reviewed candidate, not a measured failure yet.
- `e2e/prompt-to-gerber.spec.ts` already exercises the real page through an explicitly gated fixture runtime with recorded models/router and role handoffs. Preserve it. It does not qualify live providers, staging auth or live routing.

The owner's symptom is a user report, not a reproduced trace. Establish the actual failing phase before selecting the fix.

## A — Establish and reproduce the real user journey

1. Inventory branch/HEAD/status, active processes, repository instructions, current chapter state, pending fixes, feature flags and runtime readiness. Inspect credential **presence only**; do not expose values. Separate configured, funded, authorized and qualified states.
2. Inspect both the normal non-fixture app and the existing isolated fixture journey. Do not test only an API handler, cached browser or scripted agent and call the product fixed.
3. Trace this chain with exact paths and symbols:

   `composer → intent route → authorized request → provider/tool output → logical netlist → part resolution → schematic layout/validation → review → canonical apply → component/footprint authority → sync publication/preflight → PCB review/apply → placement candidate → routing job → connectivity/DRC → export/readiness`.

4. For each transition record input/output contract, project/branch/actor source, captured revision, cancellation policy, side effects, approvals, failure code, observed UI state and durable evidence. Document which stages are intentionally separate.
5. Reproduce the reported inability on fresh projects in Build mode and Theory mode. Include ordinary phrasing such as “make a schematic for …”, “build this circuit and prepare its PCB”, and a question that should remain a question. Record the shown route, actual request, refusal/exception and whether anything changed.
6. Reproduce confirmed dead/placeholder controls, misleading check states, same-value selection retirement, stale async completions and incomplete subsystem output before editing their load-bearing code. Add failing tests for the actual behavior, not guessed error strings.
7. Use a compact prioritized fault register. Diagnose authorization/request mismatch, missing catalog/atomic authority, provider quota, schema/null drift, intent routing, UI adoption, persistence and router unavailability separately. Do not call all of these “AI failed.”

Acceptance: an evidence-backed chain identifies where the normal user stops and distinguishes code defects from missing authorized resources. Do not stop after discovery; proceed to implementation.

## B — Finish the pending corrective foundation

1. Verify and finish the local OD-229/OD-236 implementation and regression suites. Preserve original-domain validation and provider continuation/replay bytes.
2. Verify all local lifecycle repairs against production components. Close the remaining inspector identity hole with permanent regressions covering same-value A→B selection, pending preview, Enter/blur, Escape, unmount and later legitimate edits.
   Key the editable subtree to stable selected-reference identities, not the entire board revision. Preserve a same-selection draft across unrelated refreshes. Prove A→B→A warning retirement separately; hiding a stale hint is not clearing its lifetime.
3. Ensure BOM request identity includes project/branch/tenant, actual design content and atomic revision/ref changes. Old drawer/results/callbacks must not operate on a new circuit. Ensure assignment previews and padstack flushing preserve the original target rather than writing to the latest component.
4. Run TypeScript and the whole-repository lint command, not just a selected directory. Distinguish errors, warnings and prior debt. Do not add blanket lint disables to make the number green.
5. Reconcile current metadata with the actual B24 merge without rewriting historical measurements. Preserve historical census snapshots; current counts and current CI coverage need their own evidence.
6. Record what is verified in the corrective tree, which original-program live blockers remain, and what is still untested. Do not mark the original program `COMPLETE` merely to unlock Astra.

Acceptance: the pending local work has an honest current result and reproducible lifecycle behavior. No known identity/authority regression is hidden by test-only fixtures.

## C — Make prompt → schematic → PCB one understandable workflow

Implement a reliable vertical slice before widening tools or beautifying the interface.

### Intent and request contracts

- Make the chosen action visible: Ask, Create circuit, Edit circuit, or Prepare PCB. Ordinary create/edit requests must not terminate as an advisory paragraph with no artifact. Pure questions must not unexpectedly replace a schematic. Preserve a simple explicit user override.
- Reuse existing intent routing and server authorization. Add shared intent/request preparation only where it removes genuine duplication; do not add another parallel chat engine.
- Fix and test the Theory request selector/cancellation mismatch through the legitimate request adapter. Do not weaken route authorization or assume client selector headers confer membership.
- Validate provider output before normalization/layout. Classify provider/network/quota failures separately from invalid local output, missing parts and engineering failures. Strict optional-null handling must stay schema-derived.
- Bound planning, tool calls, concurrency, output and retries. A planner failure, partial subsystem merge, unavailable pin data or skipped electrical check must remain visible in structured status.

### Artifact and state progression

- Reuse the current workflow machine/types where suitable; extend the shared model instead of duplicating it in React. Suggested user-facing stages are Requirements, Schematic proposal, Schematic applied, Parts/footprints, PCB plan, PCB applied, Placement, Routing, Validation and Export. These labels are not authority grants.
- A request to create a circuit and prepare its PCB should carry the same scope-pinned intent across approvals. After schematic approval, offer/continue the exact next permitted stage. Do not require the user to discover hidden buttons or retype the original circuit description. Do not auto-approve component publication, sync mutation or release.
- Each stage exposes `pending`, `running`, `awaiting approval`, `blocked`, `partial`, `succeeded`, `failed` or `canceled`, with a specific next action. Reuse compatible existing status vocabulary rather than replacing public contracts casually.
- A schematic proposal, an applied schematic, a PCB plan and an applied board are distinct artifacts. Success requires the corresponding validation and canonical receipt/revision, not a model saying “done.”
- Bind component instances to actual published atomic revisions, symbols, packages, footprints and pin mappings. Show unresolved instances individually, explain the missing fact and provide a review path.
- Preserve durable sync preflight/apply, server ownership, idempotent replay, undo/redo, autosave, project reload and conflict handling. Check stale bases again at apply. Retry/cancel/project-switch must never create duplicate mutations or overwrite another project.
- Placement/routing stay reviewable and bounded. If the qualified router is unavailable, show the usable PCB and an explicit routing blocker. Do not pass a fake recording off as real routing or call an unrouted board complete.
- Keep ERC, schematic/netlist parity, DRC, unrouted connectivity and manufacturing readiness separate. `Not checked` is not `pass`; a stale check is not current; routability is not manufacturability or hardware validation.

Acceptance: in an isolated fresh-browser fixture, one circuit request reaches a visible schematic proposal, canonical approval/apply, exact binding-review handoff, PCB sync plan and canonical board. It continues to placement/routing/validation when the fixture supplies their dependencies. In normal mode, unavailable dependencies produce actionable blockers rather than hangs, silent no-ops or invented successes.

## D — Give AI semantic parity with permitted UI operations

Interpret “the AI should access every button/call functions” as **complete discoverability and shared semantic coverage**, not unrestricted browser clicks, arbitrary React closure calls or permission escalation.

1. Generate a current coverage matrix from actual surfaces and routes:

   `UI control/gesture → handler → semantic command → mutation authority → validation → revision/history → tool descriptor → discovery requirements → invocation path → approval/grant → observable outcome → tests`.

2. Classify each meaningful operation: callable now; proposal-only; grant-required; human/admin-only; view-session only; intentionally UI-only; unavailable; legacy; or missing. No unexplained row and no declaration-only “supported” status. Multiple UI buttons may share one command. A local text-entry widget does not need its own provider tool merely because it is a control.
3. Inspect and reuse:
   - `app/lib/engineering/action-registry.ts`, `control-registry.ts`, `tool-registry.ts`, `tool-catalog.ts`, `tool-discovery.ts`;
   - `app/lib/agent/gateway.ts`, `loop.ts`, `context.ts` and orchestration policy/runtime;
   - `app/lib/engineering/executor.ts`, `editor-adapter.ts`, the approved mutation services/journals and execution grants;
   - view-session/workspace/3D buses and `app/lib/agent/layout-proposals.ts`.
4. Implement missing high-value shared commands, starting with the vertical slice: part search/inspection, schematic create/edit/delete/replace, component review requests, sync preflight, PCB inspect/edit, placement/routing proposals, rules, dimensions, vias/tracks/zones, selection, fit/zoom and real 3D controls. Check what already exists before adding anything.
5. Server-owned work belongs behind authorized domain services. Browser-only view state needs the existing bounded client bridge with exact request identity, acknowledgement and retirement. Do not make a server callback reach into React state or use DOM selectors as the core command bus.
6. UI and AI invoke the same domain authority and validations for equivalent operations. Agent authority remains narrower where required. Proposal apply and reversible granted execution must retain the existing exact reviewed family boundaries.
   Derive permissions from `permission-tiers.ts`, `authorization.ts`, `agent-exposure.ts` and `granted-execution-families.ts`, not a parallel permissive table. The existing reviewed grant families are movement, rotation/side, arrangement, silkscreen text, dimension annotations and eligible AI undo/redo. Do not convert via/copper/topology/stackup/component-authority operations into grants merely because the assistant can describe them.
7. Do not expose release, purchase, publication, credential/account management, arbitrary network transfer, shell, SQL or unrestricted file operations to AI. Preserve the human/reviewer/admin boundary even if there is a corresponding visible button. Document the refusal and legitimate handoff.
8. Recheck discovery against the current editor, selection, authority, capability, grant, feature flags, revision and budgets. Publish honest “currently available” capabilities. An excluded/blocked command must not be advertised in an agent manual as callable.
9. Generate concise registry-backed manuals: ID/version, schema with valid examples, units/coordinate frame, preconditions, exact effects, permissions/approval, budget, failure codes and postconditions. Validate examples and digest-pin manuals to registry changes. Do not put a second drifting tool list into a giant system prompt.
10. Add executable coverage/drift gates. A new actionable control or route without classification fails CI. A claimed exposed operation without a handler/validation/test fails CI. Test denied discovery and failed invocations as well as happy paths.

Acceptance: a representative UI/AI parity suite proves equal permitted effects and equal validation refusal; unsafe tools remain unavailable; every meaningful UI operation has an evidence-backed disposition. A larger tool count alone is not success.

## E — Simplify the existing interface in place

Design direction: a plain professional CAD workspace, not an AI landing page. Keep the existing Next.js app and established components. Do not introduce a new design framework, rebuild the editor, or replace working canvases with static visuals.

- Use a neutral, restrained palette, consistent spacing/type scale, subtle borders and one modest action accent. A dark neutral workspace may remain; do not force a light/dark rewrite or reduce PCB layer/net contrast. Remove unnecessary gradients, glass blur, heavy shadows, decorative animation, floating stacks and repeated status cards.
- Make the central canvas dominant. Keep a concise project header, ordinary workspace tabs, a contextual editing toolbar, a collapsible parts/outline panel, a contextual properties panel, and optional chat. Use progressive disclosure for advanced rules, fabrication, provenance and developer diagnostics.
- Make the primary task obvious: Create circuit → Review schematic → Prepare PCB → Review/apply PCB → Place/route → Check → Export. Present genuine human handoffs visibly. Never make release/order a misleading one-click “Finish” button.
- Put a clear circuit-entry action on the empty sheet; opening chat by user action should focus the composer without dozens of Tab presses. Every composer route needs a visible, accessible submit action. Preserve Enter and avoid accidental duplicate submission.
- Keep provider choice/autonomy settings discoverable but secondary. Default workflow must not require knowledge of chapter names, registry internals or tool IDs.
- Replace the dead Settings control with a real scoped settings surface or remove/disable it with a clear reason. Wire the 3D tab to the existing real PCB preview/controller or show an accurate unavailable state; no placeholder advertised as a working view.
- Replace unconditional positive design-check rows with actual current validation results. Add unknown/not-run/stale/blocked states and links to findings. Never present green engineering badges for decoration.
- Preserve editor mounts across tab changes, project-keyed lifetimes, undo history, camera/session state, autosave, shortcuts, selection and all existing mutation paths. UI cleanup must not reset a board or dirty the canonical document by merely opening a panel.
- Keep busy/progress/error/approval state persistent and scoped. A short-lived toast alone is insufficient for a workflow-stopping failure. Retry must say which stage it retries; a disabled button must explain its prerequisite accessibly.
- Preserve keyboard-only operation, focus return/trapping, Escape behavior, accessible control names, readable contrast and touch-safe targets. Use real labels for key actions, not unlabeled icon puzzles.
- Test ordinary desktop sizes including 1366×768 and 1920×1080, plus the existing minimum-width case. Smaller widths may collapse sidebars; essential actions, approvals and errors cannot disappear or overlap the canvas.
  The existing minimum-width proof is 1280×720 desktop, not mobile readiness. Include 1440×900 and open/closed drawer/chat states. Do not claim mobile support without measuring it.
- Keep changes cohesive but incremental. Extract focused shell/panel components only where it reduces risk and preserves ownership. Do not move thousands of lines just to make the diff look cleaner.

Acceptance: screenshots and browser interaction show a simpler real workspace. Every visible action works or explains its unavailable state; the actual circuit/board and keyboard behavior survive tab/panel/resizing/reload transitions.

## F — Missing parts and remaining Astra work

Missing parts cannot be solved by inventing a plausible package or pin map.

1. Search published local atomic revisions first. Reuse `sirkit.parts.external-search`, `sirkit.parts.evidence-read`, `app/lib/acquisition/agent-read-port.ts`, admitted sources and the existing cache/quarantine/review pipeline when allowed.
2. Distinguish exact manufacturer/MPN/package identity, evidence availability, stock and pricing. Untrusted supplier text/papers cannot grant capabilities or approve a part.
3. Preserve source/version/time/license/digest provenance. An unavailable connector returns unavailable; do not silently enable suppliers or create unrestricted URL fetch.
4. If no verified part exists, return a precise missing-facts checklist and, where source dimensions/pins permit, an explicitly unverified draft. A draft cannot become PCB-assignable until deterministic mapping checks and required human publication/review pass.
5. Show these blockers and review tasks in the ordinary workflow, not only a technical report. A nonphysical Theory symbol is not automatically a buildable PCB part.

After the existing reliability prerequisites are honestly dispositioned, continue the original additive Astra directive in its own incremental order. Use current official provider documentation and the existing Responses/provider-neutral orchestration paths. Preserve the configured default and qualified model admission; fake SDK compatibility is not live qualification. Initial scope is at most 50 physical component instances, supported qualified layer/via profiles, evidence-backed constraints, sealed placement candidates and bounded routing feedback. No promised guaranteed routing, new swarm or unsupported via technology in this reliability checkpoint.

If that subsequent phase lacks a required live resource, record its exact blocker and finish independent permitted work. Do not broaden this assignment into automatic procurement, fabrication or physical certification.

## G — Verification: prove the user journey and its failure paths

Use production modules, real browser interaction and explicitly isolated fakes. Run heavyweight validation serially on this machine; concurrent full suites can obscure timing failures. Do not classify failures as flakes without reading the actual error and repeated evidence.

Minimum permanent tests:

1. Build and Theory request contracts: scope, auth/CSRF/media refusal, invalid body, deadlines, cancellation and zero provider/domain work before authorization.
2. Intent routing: fresh/existing project, ordinary creation phrasing, PCB requests, pure questions, explicit override, clear route display. No text-only success for a requested create/apply operation.
3. Provider output: omitted optional field versus strict optional null, invalid required/null/unknown keys, missing tool call, truncated/invalid netlist, partial block merge, unknown parts and skipped/failed electrical validation.
4. Schematic proposal review/apply: exact base, explicit approval, canceled approval, intervening edit, project switch, double click, undo/redo, hydration and retry.
5. Missing or conflicting component/footprint/pin authority, draft publication refusal and precise reviewer handoff.
6. Durable sync preflight/review/apply: scope, stale revision, duplicate/idempotent request, no partial mutation and recovery after a boundary/crash.
7. UI/AI shared-command parity, current-context discovery, permitted view/3D controls, denied capabilities, forged/expired grants and no release/purchase escalation.
8. Same-value selection switch, pending numeric preview, Enter/blur duplication, text/padstack identity, same-target A→B→A hint retirement, stable same-selection draft preservation, late BOM/assignment responses and no old-scope write.
9. Placement/routing: frozen component locks, mechanical/geometry constraints, bounded cancel/failure, engine unavailable, unrouted nets, current DRC and stale check invalidation. Keep the unqualified sandbox closed.
10. Truthful UI: unknown/not-run checks, dead Settings closure, real 3D behavior, disabled-action reasons, persistent workflow blockers and no misleading completion.
11. Fresh-browser route through generation, explicit approvals, bindings, PCB sync, placement/routing fixture and export/readiness. Extend `e2e/prompt-to-gerber.spec.ts` and the existing semantic-editor/execution/recovery specs rather than replacing them with route-only proofs.
12. Fresh-browser reload after durable boundaries, tab/project switch, keyboard/focus, minimum width and cross-project isolation. Compare screenshots of the real workspace, not fabricated mockups.

Keep live tests distinct: use only synthetic circuits and the shared remaining spend cap. A live forced-tool turn proves its narrow contract, not live placement quality, a complete PCB journey or physical correctness. Normal-mode authentication and real routing require their actual qualified environment. Record a failure/refusal honestly and preserve usable partial artifacts.

Final gates: targeted suites, TypeScript, whole-repository ESLint, the proportionate full deterministic suite, relevant browser configurations, registry/control/route coverage, secret scan, diff checks, replay/authority invariants and sanctioned generator byte stability. Read real process exit codes. Name every excluded suite/skip and its reason; do not silently disable a gate. Update stale source pins or generated matrices only through their reviewed mechanism and preserve historical evidence.

## H — Evidence and safe integration

Create a compact evidence package under `artifacts/product-reliability-simple-ui/`, using the current branch and truthful dated results:

- `README.md`: outcome, scope and how to run the corrected user journey.
- `progress.md`: incremental checkpoints, current blocker and exact next step for context recovery.
- `reproductions.md`: original failures, requests/observed results and permanent regression paths.
- `root-causes-and-fixes.md`: source/symbol/route citations; separate confirmed causes from hypotheses.
- `workflow-contract.md`: shared stages, approval boundaries, state ownership, scope/revision and recovery behavior.
- `ui-agent-command-coverage.csv`: complete semantic coverage matrix with evidence and dispositions.
- Registry-generated operator manuals and their drift/example-validation evidence.
- `ui-simplification.md`: before/after real screenshots, component changes, responsive and accessibility evidence.
- `validation.md`: exact commands, results, exit codes, CI jobs, exclusions and live versus fake distinctions.
- `live-spend.json`: cumulative approved/reserved/known/uncertain spend without credentials or private payloads.
- `remaining-blockers.md`: unresolved resources/owner decisions, usable behavior, precise unavailable stages and remaining Astra work.
- `final-verdict.md`: working capabilities, actual limitations, verified commit/PR/CI, and whether each requested outcome is complete, partial or blocked.

Keep reports proportional to the change; do not spend the majority of the assignment writing duplicated reports while the core user journey stays broken. Generate repeatable matrices from source rather than hand-maintain hundreds of claims.

Commit coherent real checkpoints under the verified owner's configured Git identity. Do not commit each arbitrary line solely for contribution density. Do not rewrite others' genuine history, add AI coauthor trailers, backdate commits or imply a model authored historical work. Scan staged files/history for secrets before pushing. Use a normal `codex/` branch and PR; attach it in the coding app when supported. Do not merge with failing required checks or unresolved security findings. Preserve concurrent changes and the existing protected checkout.

Update program metadata with new corrective evidence separately from B24's historical `PARTIAL` verdict. Do not relabel blocked live/physical qualification as complete because local CI is green.

## I — Completion criteria and stop conditions

You may report this reliability assignment complete only when:

- The supported fresh-browser fixture journey actually produces, reviews and applies a schematic and PCB, with specific actionable blockers in normal mode where external prerequisites are unavailable.
- The normal user can see the next stage without memorizing hidden controls; permitted operations execute or return a visible, scoped refusal.
- Generation/partial results, saved state, bindings, sync, history and validation statuses remain truthful and revision-consistent.
- The dead/placeholder/misleading controls identified here are fixed or honestly withheld.
- Meaningful UI operations have complete evidence-backed semantic dispositions; allowed AI operations use shared command authority; forbidden operations remain forbidden.
- The simplified real interface is keyboard-accessible, responsive and does not regress editor state or capability coverage.
- Permanent regressions, final-source validation and safe integration are recorded, with live/physical limitations and cumulative spend explicit.

Report deterministic tranche completion separately from the owner's real product outcome. If a normal authorized live request still cannot produce the supported schematic and PCB, that product outcome remains `PARTIAL` or `BLOCKED` with its exact missing prerequisite—even if every recorded fixture test passes. Do not use the criteria above to disguise a fixture-only demonstration as a repaired live product.

If a required live/owner resource blocks a stage, stop only that dependent work and continue safe independent implementation. Ask the owner only for a genuine missing irreversible decision, new authority, necessary resource, additional spend or unresolved overlapping work. A large repository, failed search, long tests or needing another context window is not a reason to stop.

End with an honest handoff: what the owner can now type/click to get a schematic and PCB, what still cannot run and why, exact evidence locations, any remaining Astra work, and the verified branch/PR/CI. Do not say “all done” because an assistant response sounds confident.

**Begin now with checkpoint A, verify the pending work, then implement B–I incrementally. Do not ask whether to review, plan or start.**

---

## J — ADDITIVE OWNER REQUEST: usable multi-sheet schematics and practical workload limits

Added 2026-10-15. Append-only extension to the ongoing assignment. Do not interrupt or discard the checkpoint already in progress, redo completed checkpoints, or change the existing chapter goals. Finish the current reliability and simple-workspace work, then implement this feature incrementally as the next product capability. If A–I are already complete, continue here directly. This request is for implementation and browser evidence, not a proposal document alone.

### J.1 Product outcome

The current single-page schematic becomes crowded when a circuit contains several subsystems. Give one Sirkit project multiple real schematic **sheets**, with a simple sheet navigator and explicit electrical interfaces between subsystems. All sheets still describe **one circuit and one PCB** unless a separate multi-board feature is explicitly requested later.

For example, the user should be able to organize a project as:

```text
System overview
├── Power and references
├── Analog front end and filtering
├── ADC and analog-to-digital interface
├── Microcontroller, clock and programming
└── Connectors and external interfaces
```

The overview shows readable subsystem blocks and their connections. Opening a block shows its actual editable schematic. Named ports, explicit net labels and validated buses carry signals between sheets; do not stretch physical wires across one giant crowded canvas. Do not create separate projects, screenshots, disconnected canvas tabs or separate PCB boards as a substitute.

Aim for a useful, understandable feature, not every feature of a commercial EDA suite. Start with a root overview and ordinary child sheets. Support sensible nesting using the existing model where feasible; do not block the first working feature on a reusable-template marketplace, arbitrary parameterized hierarchy, multi-board harnesses or new specialist-agent infrastructure.

### J.2 Reuse the hierarchy already present; bridge the missing editor path

Inspect current source before selecting the implementation. On 2026-10-15, the code already contains:

- `app/lib/schematic-compiler/types.ts`: sheet definitions/instances, unit-to-sheet assignment, scoped electrical nets, hierarchical port definitions/bindings, signal bundles and per-sheet diagram views.
- `app/lib/schematic-compiler/hierarchy.ts`: `addSheetInstance`, `defineHierarchicalPort`, `bindHierarchicalPort`, `defineSignalBundle` and `instantiateSignalBundle`.
- `app/lib/schematic-compiler/graph.ts`: graph identity, hierarchy/reference checks and scoped net-name validation.
- `app/lib/schematic-compiler/diagram.ts::compileDiagramView`: per-sheet unit filtering, but not a complete rendered parent sheet-symbol/port interface.
- `lib/schematic-types.ts::SchematicState`: the current editor-facing flat component/wire/label arrays and a single `pageSize`.
- `app/lib/connectivity.ts::buildNetUnionFind`: coordinate-only point keys and same-name label unions. Applying that flat behavior across sheets without scoping would create unintended connections.
- `app/lib/pcb/netlist-bridge.ts`: existing PCB publication paths with root-hierarchy assumptions; and `app/lib/schematic-compiler/sync.ts`: an existing project-level synchronization contract. Neither is proof that the current UI flattens hierarchical ports correctly.

Verify these facts against the active tree. Reuse and extend the existing semantic model, canonical commands, storage and validation rather than introducing a competing hierarchy database. Do not replace flat editor state with an unchecked cast, guess that metadata already works end-to-end, or mint upstream compiler approvals to get past a missing prerequisite. Connect the real production path incrementally with explicit conversions and tests.

Sheet membership must be persisted engineering/document state. Active sheet, viewport and navigation history are presentation/session state. Do not store the only copy of circuit connectivity in a React tab, browser DOM, agent message or generated picture.

### J.3 Functional minimum: sheets the user can actually use

Implement through shared commands and the real editor:

1. Create, open, rename and reorder sheets. Show a compact tree or sheet list, current-sheet title and parent breadcrumb. Double-click a subsystem block to enter; provide an obvious Back/Overview action and keyboard navigation.
2. Add, inspect and edit parts, wires, labels and ports on the active sheet. Render only that sheet's diagram items while retaining the complete project graph. Sheet switching must not discard edits or reset undo/redo.
3. Move an existing connected selection or subsystem to a new/existing sheet using a previewable canonical operation. Preserve component, unit, pin, net and reference-designator identities. Resolve selection-boundary connections through explicit ports/labels and show their mapping before applying.
4. Offer “Organize into sheets” for a crowded existing circuit. Group by actual function, connectivity and user intent, not a random count of components. Preview the proposed groups and interface connections. Apply the refactor transactionally; reject an ambiguous or electrically non-equivalent split without changing the design.
5. Keep independent per-sheet diagram layout and viewport. A tidy operation affects the selected sheet by default and preserves manually locked positions. Do not rearrange every sheet because the user edited one resistor.
6. Provide project-wide search and cross-probing: finding a part/net/check result opens the correct sheet and highlights the exact target. A cross-sheet connection can show its destinations and navigate to them.
7. Delete only through an explicit, reversible operation with a clear impact preview. Deleting a populated/referenced sheet must not silently erase circuitry, port bindings or physical parts. Offer a legitimate move/merge alternative where appropriate. Do not require the owner to accept irreversible data loss.
8. Handle mixed and repeated selections correctly. Switching sheets retires active gestures, drafts, pending previews and callbacks belonging to the old sheet, while leaving project state intact. An async result from sheet A cannot write into sheet B through a reused callback.

Keep the new controls consistent with the simplified workspace requested above. A small Sheets panel and contextual tools are preferable to more floating dashboards. Keep single-sheet projects simple; the user must not create five sheets merely to draw a small circuit.

### J.4 Electrical connections must be explicit and scoped

Implement and document one unambiguous connection policy:

- **Local labels** connect only within the same sheet instance. Equal text or equal XY coordinates on different sheets must not create connectivity.
- **Hierarchical ports** connect a child interface to an explicit parent sheet pin/binding. The top-level overview uses those interfaces to connect subsystem blocks. Display names help the user, but stable semantic identities and validated bindings determine the connection.
- **Global/project labels** connect across sheets only when deliberately declared with that scope. Do not turn every ordinary label into a global label to make the feature appear to work.
- Power/ground labels retain their actual voltage, return and isolation domains. Never merge AGND, DGND, PGND, chassis, shield or isolated returns merely because they look similar. Existing explicit ties and rail-domain rules still apply.
- Bus/bundle connections map each actual member explicitly. A bus stroke or a name such as `DATA[0..7]` is not sufficient proof of an electrical connection. Check width/member identity, differential polarity, required ports and supported signal-direction/domain constraints.
- Display port names, direction and useful cross-references. Refuse or clearly flag missing ports, duplicate/incompatible bindings, unresolved endpoints, hierarchy cycles, invalid parent/child references and accidental cross-domain connections.

Validate parent/child electrical membership, not merely that the referenced net IDs exist somewhere in the project. Preserve deliberate disconnected/no-connect states. Use the existing canonical connectivity/ERC authority, extended for sheet scope, instead of writing a second inconsistent checker in the renderer.

Use current official KiCad documentation to inform compatibility, not as a claim that Sirkit already implements it. The official [multi-sheet schematic and connection guide](https://docs.kicad.org/10.0/en/eeschema/eeschema.html#electrical_connections_between_sheets) distinguishes local, global and hierarchical connection scope. Native format work should follow the [official schematic file format](https://dev-docs.kicad.org/en/file-formats/sexpr-schematic/index.html). Pin the format version actually supported; do not claim compatibility with every KiCad version.

### J.5 One project-wide circuit, BOM and PCB

PCB synchronization, ERC, supported SPICE generation, BOM and engineering reads must consume the **whole design**, not only the visible sheet.

- Resolve hierarchical bindings into the project-wide electrical graph and produce the downstream representation deterministically. Include all relevant sheet instances and every physical component exactly once.
- Multiple symbol units of one physical package may appear on different sheets without duplicating the package in the BOM or PCB. Keep component/unit/instance identities distinct.
- Repeated sheet definitions, if supported, require unique instance identities and annotation scopes. Do not short their local nets together or duplicate reference designators. If reusable instances are deferred, refuse them explicitly rather than partially clone them.
- Moving or renaming a sheet without changing circuit meaning must preserve pin-to-net membership and physical part identity. Avoid unnecessary PCB footprint/copper churn. Still honor project revision/digest changes and the existing rules for invalidating stale approvals, proposals or qualifications; never bypass those checks to retain an old green status.
- A genuine connection/part/interface change invalidates dependent checks and sync plans as the existing policy requires. The UI shows affected sheets and downstream changes.
- Any “Sync schematic to PCB” action clearly states that it synchronizes the complete project. Opening the MCU sheet must not make the analog front end disappear from the board.
- Preserve exact component/footprint/pin authority. Hierarchical organization is not permission to invent parts or mapping evidence.

### J.6 AI generation and editing should understand sheets

Extend the existing generation/edit workflow and registry-backed command discovery, not just the system prompt:

1. The AI may propose a functional sheet plan with a short interface list before generating/organizing a larger design. Explain assumptions without demanding an extra owner prompt for every normal step.
2. Keep the generation contract structured: stable sheet identities, owned component/unit identities, named typed interfaces and explicit inter-sheet bindings. Do not rely on prose or same-name string merging to connect subsystems.
3. Ensure the existing build planner's subsystem output can be preserved as sheets rather than flattened and pasted onto the front page. All requested subsystems and their interfaces must be accounted for. A failed block remains a visible incomplete requirement, not an omitted subsystem hidden by `ok: true`.
4. An instruction like “put the ADC interface on its own sheet” should refactor the existing design, not regenerate unrelated circuitry or lose values, annotations, approved parts or connections.
5. An instruction like “change the filter in Analog front end” should resolve the sheet/target unambiguously, use current project and sheet context, and preserve unrelated sheets. An ambiguous duplicate display name requires disambiguation, not a guessed target.
6. Add sheet create/inspect/navigate/rename/reassign/connect/organize operations to the real semantic coverage matrix, permissions, validators and manuals. View navigation remains a view command; structural/connection changes remain properly reviewed canonical mutations.
7. The AI can inspect a bounded sheet summary and explicitly fetch relevant neighboring interfaces/project context. Do not dump every component from every sheet into every tool call or hide unseen dependencies from a mutation.
8. Multiple agents are optional workers on the same canonical project, not independent owners of duplicate sheets. Their results are proposals over pinned bases, checked and integrated through the existing executor. Schedule work incrementally; do not let concurrent agents overwrite one another.

Useful acceptance requests:

> Organize this controller into separate Power, Analog front end, ADC interface, MCU, and Connectors sheets. Show the system connections on an overview. Keep the existing circuit, part identities and one PCB.

> Move the low-pass filter into Analog front end without changing its values or electrical connections, then show where its output reaches the ADC sheet.

> Open MCU, highlight the SPI link to ADC interface, and update the requested component without changing any other sheet.

### J.7 Practical restrictions: remove artificial ceilings, not basic protections

The owner wants a working tool rather than constant arbitrary restrictions. Audit actual limits and distinguish **logical work**, **concurrent workers**, **resource/spend ceilings**, and **permissions**. These are different things.

On inspection, `app/lib/agent/orchestration/scheduler.ts` limits specialists to four plus a coordinator, with serial specialist execution; `router.ts` also contains a deliberately trimmed full-circuit role plan. This explains the reported “five agents” ceiling, but changing one numeric constant would not restore omitted planned work. Recheck the active implementation before editing it.

The current structure called a DAG is a flat role-task list, not an implemented arbitrary dependency graph or recursive spawning system. Bounded sequential sheet tasks are sufficient for the first usable release. Do not turn this feature into an unnecessary scheduler rewrite. If dependent/parallel module execution is later introduced, model actual dependencies and test their ordering, conflict handling and recovery before enabling it.

- Remove unnecessary hardcoded product/UX limits, including a blanket five-agent ceiling where it prevents useful supported work. Replace workload choices with validated, documented configuration and sensible defaults suited to this machine/provider budget.
- Separate the number of subsystem/sheet tasks from simultaneous worker count. A project with more than four subsystems can execute in bounded batches or a queue. Never omit a requested subsystem merely because all workers are occupied.
- Review router task lists, task-DAG cardinality, scheduler parallelism/retries, trace/event limits, context growth and accounting together. Raising a worker cap alone must not silently truncate results or overrun dependent storage/schema bounds.
- Do not require one agent per sheet, enforce an arbitrary five-sheet limit, or conflate the existing initial placement-qualification size limit with the maximum number of sheets an editor can open. Keep measured implementation limits explicit and provide an actionable explanation when one is reached.
- Make safe workload settings visible and avoid repetitive confirmations for actions the existing policy already authorizes. Do not let a model raise its own spend ceiling or execution permissions.
- Retain cancellation, deadlines, finite CPU/memory/token/request bounds, cumulative approved spend, project isolation, revision checks, recoverable saves, correct connectivity, and existing human release/publication/purchase boundaries. Those prevent lost designs or unexpected charges; disabling them is not necessary to make more sheets or queue more tasks.
- Do not begin a new broad security-hardening or compliance chapter during this feature. Focus on functionality and usability while preserving the safeguards already in the product. Do not replace “too many agents” with unbounded concurrency, recursive spawning or uncontrolled paid retries.

Record which unnecessary limits were changed, the old/new values or configuration, why they were safe to change, the measured workload and the remaining actual bounds. The previously authorized US$5 synthetic-test allowance remains cumulative and unchanged; this request does not authorize additional spend.

### J.8 Persistence, compatibility and outputs

1. Version the document contract and migrate an old flat schematic into one default/root sheet without semantic loss. Existing project files, autosave, checkpoints, hydration and export/import roundtrips must remain supported or give an explicit recoverable compatibility refusal.
2. Save every sheet, port, binding and per-sheet diagram state needed to reopen the design. Sheet switching is not a save boundary that drops another sheet's pending canonical work.
3. Keep undo/redo transactions project-wide and coherent. Refactoring a subsystem into a sheet should be a comprehensible transaction, not dozens of independently half-applied edits. Restore interfaces and identity with the inverse operation.
4. Preserve project isolation, stale-result retirement, multi-tab conflict handling and recovery. A stored active-sheet ID that no longer exists falls back visibly to a valid sheet, never crashes or modifies the circuit.
5. Provide project-wide and active-sheet print/SVG/PDF outputs where the existing exporter supports them. If native hierarchical KiCad export is implemented, include the actual root and child files with stable instance/path mapping and validate them with the supported parser/oracle. Do not label separate flat images as a complete native hierarchy or claim an unrun KiCad roundtrip passed.

### J.9 Deliver incrementally and prove the complete feature

Suggested execution order within this checkpoint:

1. Reproduce the current crowded-page behavior and inventory existing partial hierarchy support.
2. Establish the versioned sheet/port/connectivity contract, flat-project migration and canonical operations with tests.
3. Render and navigate real sheets and overview blocks; support ordinary editing and the previewed move-to-sheet operation.
4. Integrate project-wide connectivity/ERC, BOM and PCB synchronization, including existing authority and revision handling.
5. Add sheet-aware AI generation/refactoring and the complete semantic-control/manual coverage.
6. Review/remove the artificial workload caps as described above, then exercise queued work without silently dropping subsystems.
7. Run fresh-browser, persistence/recovery and export tests; record the remaining bounded limitations honestly and continue the existing program.

Required permanent tests and browser evidence:

- Old single-sheet project load/save/export preserves component identities, values and pin-to-net connectivity.
- A root overview plus at least three real subsystem sheets renders, opens and edits; a denser multi-sheet fixture remains readable without giant off-page wire runs or overlapping critical controls.
- Identical coordinates and identical **local** label text on two sheets remain electrically separate; an explicit hierarchical binding connects the intended pins, and only those pins.
- Intentional project-global nets work; missing/invalid ports, hierarchy cycles, conflicting bus mappings and incorrect isolation-domain joins refuse with useful diagnostics.
- Moving a connected subsystem to another sheet preserves the project pin-to-net partition, BOM, physical identities and PCB footprint count. Undo/redo and save/reload restore the expected result.
- Multi-unit parts do not duplicate packages. Repeated instances, if supported, do not alias local nets or annotations.
- Project-wide ERC/BOM/PCB sync include all sheets regardless of the current viewport. Circuit-changing edits invalidate the right downstream evidence; sheet-only presentation changes do not silently change connectivity or wipe board work.
- Async AI/preview results from a retired sheet/project cannot mutate the current sheet. Same-selection draft preservation and A→B→A retirement remain correct.
- More logical subsystem tasks than concurrent worker slots complete through the queue without missing blocks, uncontrolled spawning, unbounded costs or privilege changes.
- A fresh browser creates/organizes a multi-sheet circuit, follows a cross-sheet signal, reviews/applies the complete PCB sync, reloads, and retains the same complete circuit. Distinguish fixture proof from authorized live-model proof.

Add concise implementation notes, coverage/manual updates, migration evidence, real screenshots and exact validation results to the existing evidence package, under a `multi-sheet/` subdirectory if useful. Preserve the current source-generated census/drift gates. Do not produce a large duplicate report set instead of finishing the feature.

**Completion means the user can navigate and edit actual connected subsystem sheets and obtain one correct project-wide circuit/PCB. Schema fields, sheet metadata, AI prose, disconnected tabs or attractive overview boxes alone are not completion. Continue autonomously after each verified increment; ask only for a genuine missing owner decision or external resource.**

---

## K — ADDITIVE OWNER REQUEST: visible progress, persistent recovery, reusable parts and real 3D assets

Added 2026-10-16. Append-only extension: preserve the ongoing builder's work and all earlier checkpoints. Finish the current checkpoint; implement this continuation incrementally, reusing already completed functionality instead of duplicating it. This is a product implementation request, not permission to claim success from a rewritten system prompt.

### K.1 What the owner wants

The assistant should visibly explain what it is doing, keep working intelligently when an initial approach fails, find missing parts/assets from appropriate online sources, validate and import them, use eligible assets in the circuit, and retain them in a reusable library. The same workflow must cover real component 3D models.

Do not give up merely because three or four attempts occurred. Do not promise that an unavailable part or missing evidence can always be found. Persistence means pursuing materially different useful strategies and preserving progress, not repeating an identical failing request forever, fabricating results or treating money and CPU as unlimited.

Prioritize working functionality and clear UX. Do not start a separate compliance/hardening program here; retain the product's existing essential boundaries while implementing the feature.

### K.2 Public progress narration, not private chain-of-thought

Add a live, concise **Work log** to the existing assistant/task UI, expandable for details:

- A brief task/approach summary, followed by observable progress such as “Searching the saved library,” “Checking the exact package,” “Trying the manufacturer's documentation,” “Downloading the footprint,” “Validating pin-to-pad mapping,” “Saved to your library,” and “Waiting for component approval.”
- Short decision summaries based on facts: “This candidate has the wrong package,” “The pin table disagrees with the footprint,” or “The exact revision is already cached.” Explain the relevant evidence and uncertainty without exposing a token-by-token deliberation.
- Source/evidence links, the affected part/sheet/task, stage status, meaningful attempt count and a clear next action when blocked. Do not expose credentials, signed download URLs, private prompts, hidden instructions or unrestricted raw tool payloads.
- Honest separation of intent, tool dispatch, received result, validation, storage, proposal and committed use. “I will import” is not “imported”; a dispatched request is not a completed action; a model sentence is not a receipt.

This is **public progress and reasoning summaries**, not access to the model's private internal chain-of-thought. Never decode or expose provider reasoning/encrypted continuation items, ask the model to reveal hidden deliberations, or simulate a private thinking transcript. If concise public explanations are model-generated, label them as summaries and ground action/completion claims in actual events.

Inspect and reuse `app/lib/agent/contracts.ts`, `loop.ts`, `run-consumer.ts`, `app/lib/agent/orchestration/run-events.ts`, `trace-recorder.ts`, and `app/lib/project/chat-run-view.ts`. The existing loop already emits tool-started/finished/refused events and distinguishes interim versus final text; orchestration has plan/specialist/degraded/partial events. Extend that typed event path and its UI reducer rather than adding an independent stream with conflicting outcomes. Existing interim-text safeguards must not be removed just to make prose appear live.

Emit progress at real stage transitions and useful long-running milestones, not on fake timers that imply nonexistent work. Include stable run/task/call identity, ordering/deduplication and project/sheet ownership. Late events from a retired run cannot update another project. Cancellation, disconnect and recovery have explicit truthful states; opening the task later should recover stored progress rather than replay actions. Keep the default UI quiet and readable; do not replace the simplified workspace with a wall of logs.

### K.3 Replace arbitrary early failure with a persistent recovery controller

First reproduce where the reported three/four-attempt failure actually occurs. Distinguish model steps, identical-call cycle detection, per-request network retries, source pagination, distinct-source searches, candidate validation and whole-task recovery. They are not one global attempt counter.

Current source examples to inspect, not blindly delete:

- `app/lib/atomic/ingestion.ts::collectAdapterPages` defaults to two retries per page and clamps the configured retry count, under a request deadline. That is transport recovery, not the entire missing-part strategy.
- Source-registry/distributor policies can prohibit automatic retries; agent live-MPN budgets and provider quota shares are separate accounting constraints.
- Specialist/loop attempt and time caps are bounded worker executions. A logical task can continue through a persisted queue without keeping one HTTP request or model loop alive indefinitely.

Implement an explicit task record containing requirement/target identity, current strategy, candidates and rejection reasons, attempted sources/queries, evidence references, pending work, next eligible retry time, cancellation state, budget reservations and checkpoint version. Reuse existing durable task/job mechanisms where suitable; do not claim durability from component state or a process-local Map.

Recovery policy:

1. Search the validated local library/cache first. A cache hit should not cause another paid model call or vendor download.
2. When missing, resolve manufacturer, exact MPN, package variant and needed asset/evidence. Use alternate identifiers only with justified identity equivalence; never silently substitute a different part/package.
3. Try permitted alternate sources, manufacturer documents, supported library sources and materially improved queries. Record what changed and why. Exact-MPN sourcing alone may be insufficient when the user supplied only a functional requirement; add an evidence-backed identity-resolution stage rather than inventing an MPN.
4. Retry transient network/server failures with bounded backoff where the source permits it. Respect the actual `Retry-After`; for a long wait, checkpoint/defer until eligible instead of clipping the wait and hammering the server.
5. Treat an empty search, incompatible package or failed candidate validation as a reason to change strategy/candidate—not endlessly retry the same bytes. Preserve rejected evidence so the next pass does not repeat it.
6. Authentication failures, missing credentials, source terms, withdrawn assets, denied access and exhausted provider credit/quota need the appropriate external remedy or another independently permitted source. Do not evade these through alternate identities, account rotation or uncontrolled mirrors.
7. Before a worker deadline expires, checkpoint useful progress and resume in a bounded follow-on task. Preserve exact project/revision context, cancellation and single-owner/CAS semantics. Check the current base again before applying any result obtained later.
8. A genuine exhausted search ends with a precise unsatisfied requirement and the remaining useful options: an evidenced alternative, a draft-creation task, an owner-supplied document/source, or waiting for a named resource. Never manufacture a successful answer merely to avoid a failed status.

Remove arbitrary “three failures means abandon the entire task” behavior where it exists. Keep identical-call cycle guards, finite per-request resources and no-progress detection; route their terminal worker result into the higher-level recovery policy when a distinct useful strategy remains. Cosmetic query changes do not count as new strategies. Do not weaken duplicate suppression to make a retry counter larger.

Expose Cancel, Resume and a useful progress/remaining-work view. Use the existing app job infrastructure; do not create an unrelated OS scheduled task, hidden polling service or Codex automation. Deferred work must be explicit and owned by the user's task.

### K.4 Spending should not require constant micromanagement, but must remain controlled

Do not stop a funded, authorized task merely because the model guesses another attempt might cost something. Let the owner choose a task/project workload policy once, then continue within it without asking for approval on every ordinary retry.

However, “keep trying” is not a new numeric spending ceiling or permission for unbounded charges. Preserve the existing cumulative US$5 synthetic-qualification allowance unless the owner explicitly configures a different limit. Show the remaining allowance and the exact blocker when it is reached; checkpoint rather than discard the task. A new run, resumed worker, alternate provider or subagent does not reset cumulative accounting. Unknown charges remain reserved. No paid API calls are authorized merely by editing this prompt.

Separate free/cache/local work from paid model/vendor operations; continue independent permitted work while a paid stage is blocked. Token counts alone are not a monetary cap. Do not hide provider rate limits or silently route to a more expensive provider. Use the existing spend/admission controls and approved fallback policy.

### K.5 Complete missing-part acquisition: search → obtain → validate → store → use

Build a real acquisition-to-library path, not a browser download button or a model's claim that a footprint exists.

Reuse and inspect:

- `app/lib/acquisition/source-registry.ts`, `external-search.ts`, `agent-read-port.ts`, `admission-control.ts`, `quarantine.ts` and `import-review.ts`;
- `app/lib/distributors/egress.ts` and `app/lib/net/outbound-fetch.ts` for source-constrained transport;
- `app/lib/atomic/ingestion.ts`, `kicad-assets.ts`, `publication-review.ts`, `server-repository.ts` and `server-catalog.ts`;
- the existing source/license/raw-content/evidence/versioned asset schema in `app/lib/db/schema.ts`.

The current external-search/evidence-read agent port is read-only: sourcing observations are not proof of a symbol, footprint, pin mapping or 3D asset. Fill the actual missing integration with dedicated authorized domain commands and reviewed asset sources. Do not disguise a price/stock result as downloadable CAD.

For each candidate:

1. Obtain permitted symbol, footprint, datasheet and model assets from appropriate manufacturer/library services. Use existing admitted sources or add a concrete reviewed source adapter where necessary. Surface unavailable credentials/terms once with an actionable setup path; do not endlessly call an unconfigured source.
2. Download the actual bytes through bounded transport. Verify declared/actual format, size, digest and archive paths; no executable installers, scripts, arbitrary filesystem writes or implicit external-resource fetches. Do not run hostile parsers against the unsandboxed host as a shortcut.
3. Preserve manufacturer/MPN/package/revision, source URL/record/version, retrieval time, license/retention policy, content hashes and evidence links. A hash proves byte identity, not electrical correctness.
4. Parse and validate the actual symbol and footprint. Confirm pin numbers/names/functions, pad mapping, package variant, orientation/pin 1, documented pitch/dimensions, exposed/thermal pads and supported geometry. Equal pin count or a similar-looking picture is insufficient. Show unresolved/conflicting evidence and do not make it assignable.
5. Store the raw assets and normalized versions in the existing appropriate durable library/object store, deduplicated by content plus versioned source identity. A URL, chat message, temporary file or browser cache alone is not storage of a reusable part.
6. Reuse previously approved exact revisions automatically where permissions allow. For a newly acquired candidate, use the existing quarantine/review/publication path; download or structural validity must not auto-mint an approval or mapping certificate. Avoid repetitive review of an unchanged already-approved revision.
7. Return an actual stored revision/asset reference and confirmed publication/eligibility state. The circuit uses that precise eligible revision through the canonical component-binding/proposal path. Pin it so a later vendor update cannot silently change an old project.
8. On reuse, verify hash/status/withdrawal and applicable license freshness. Retain the previous approved version for existing projects under its legitimate retention rules; show a reviewed upgrade/withdrawal path rather than silently substituting new bytes.

If a documented asset genuinely cannot be obtained, support creation of an **unverified draft** from available authoritative pin/dimension evidence, with missing facts explicitly listed. Do not guess hidden pads, body dimensions or pin roles. Draft construction and publication are separate states; ambiguous geometry or mapping cannot be promoted just to finish a circuit.

Expose a simple reusable library with search, source/evidence, asset availability, validation/review status and “Use in project.” Keep project/private/library access scopes explicit. Do not expose one user's licensed/private assets to unrelated users. Online availability does not imply permission to store or redistribute an asset forever; distributor offer-cache retention is not a CAD-asset license. Keep credentials and restricted raw blobs out of Git and public reports.

### K.6 Do the same for real 3D component models

On source inspection, `app/lib/atomic/kicad-assets.ts::createModelAsset` records STEP/VRML metadata and hashes, but its `inspected` flag is not a real geometry inspection. `app/lib/pcb/3d/build-scene.ts` currently builds placeholder component boxes through `geom/footprint-mesh.ts`, whose header explicitly says there is no STEP/VRML loading. Allowed reference extensions and model records therefore do not establish real CAD rendering. Verify the active code before extending it.

Implement the missing complete path:

- Search for a model for the exact package/manufacturer variant, download it from an appropriate licensed source, and retain its original versioned bytes/provenance in the library.
- Parse/inspect supported formats using an appropriately isolated and resource-bounded implementation. Where conversion to a browser-renderable mesh is needed, store a derived artifact linked to source digest, converter/version/options and diagnostics. Metadata ingestion or an HTTP 200 is not a successful conversion.
- Validate units, scale, origin, rotation, coordinate convention, seating plane, top/bottom transforms, body dimensions and useful pin-1 alignment against the footprint/package evidence. Reject a plausible but incompatible model. Do not change footprint pads to fit an incorrect visual model.
- Attach the model to the correct footprint/atomic revision with explicit transforms. Render the actual model in the existing 3D viewer. Preserve camera controls, board selection, layer visibility and the existing view-session command path.
- Cache by immutable asset/conversion identity, load lazily and bound mesh/texture complexity. Prevent remote scripts/textures/references and unsafe archive expansion. Dispose GPU/resources correctly when models/boards are retired; a late model load from project A cannot attach to project B.
- Distinguish `missing`, `downloaded`, `parsed`, `package-matched`, `renderable`, `approximate`, `unsupported` and any genuinely proven mechanical qualification. Do not set `safe`/`verified` because an AI requested it or a boolean was supplied by the browser.
- A clearly labeled generated body/placeholder is an acceptable fallback for visualization. It is not a manufacturer CAD model, a proven height envelope or mechanical clearance evidence. Lack of optional visual CAD should not block an otherwise valid electrical design unless a required mechanical constraint genuinely depends on it.
- Reopening the project or using the same eligible part in another permitted project should reuse the saved model without repeated searching/downloads or paid model calls.

Do not create a second 3D viewer or claim mechanical collision/fit checks passed unless they were actually implemented and run over qualified geometry.

### K.7 Visible end-to-end experience

A typical successful task should show real events resembling:

```text
Checking the saved library for the required part/package.
The first source has no matching footprint; trying another permitted source.
Candidate found. Checking its datasheet and exact pin/pad mapping.
Footprint validated; saved as a versioned library candidate.
Component review required before this new revision can be used.
Approved revision attached to the schematic/PCB through the normal workflow.
Matching 3D model imported and rendered; available for future projects.
```

This is an example of public status wording, not a script to display regardless of results. If only a draft or placeholder exists, say so. If approval, evidence, an external account or a resource is missing, identify that exact state and preserve the useful completed work. Never replace failure with generic “Done” narration.

### K.8 Incremental implementation and acceptance

Implement in this order: current behavior/reproductions → typed public progress UI → persisted recovery strategy → durable part acquisition/reuse → real 3D import/render/reuse → full journey and failure-path tests. Reuse existing behavior where already complete. Maintain the shared command registry, manuals, evidence and progress ledger; no need for another large duplicated report set.

Permanent proof must include:

1. Live action summaries arrive before the final answer, match actual events, remain readable, survive task inspection/reload and never expose hidden reasoning/secrets or claim an uncommitted mutation succeeded.
2. Three unsuccessful source/strategy attempts followed by a valid different strategy can complete the logical task. Identical no-progress retries, auth denial, real `Retry-After`, rate limits, cancellation and spent/uncertain budget remain correctly handled.
3. A worker timeout/checkpoint followed by resume preserves evidence, cost accounting and target identity; it does not redownload, republish or apply the same effect twice. Test disconnect and ambiguous completion explicitly.
4. Missing local part → permitted online fixture source → actual bytes → parse/evidence validation → durable quarantine/review/publication → exact circuit binding. Reopen and reuse with zero external calls on the valid cache-hit path.
5. Wrong package, conflicting pin table, unavailable source, invalid license/retention, oversized/malformed file, hostile content, expired/withdrawn revision and unavailable credentials produce precise states, not guessed assets or repeated blind requests.
6. Real supported 3D fixture bytes convert/load/render at the correct scale/orientation on top and bottom; wrong-package and unsupported models refuse; placeholders are labeled. Reopen/reuse and late-load retirement are tested.
7. Cross-project/private-library isolation, source disclosure, existing publication/approval boundaries and canonical revision/history rules remain intact. No new arbitrary URL fetcher, shell/SQL tool, automatic purchase or unrestricted asset execution is introduced.
8. Fresh-browser progress → acquisition → review handoff → schematic/PCB use → real 3D display → save/reload → library reuse is shown with artifacts and exact test results. Label fake-source/fixture proof separately from any authorized live external-source/model proof.

Record which early-stop behaviors were found and changed, the actual recovery strategy, durable library storage contract, supported rendered formats, source/license limitations and measured remaining spend. A real missing resource can remain blocked; fabricated availability, indefinite looping or a placeholder sold as validated CAD cannot.

**Continue autonomously through useful alternatives and durable checkpoints. Completion means observable progress, a persistent task that does not abandon useful strategies after an arbitrary handful of attempts, and correctly validated/stored/reused parts and 3D assets—not exposed private reasoning, unlimited paid retries or a confident claim that unavailable data was found.**

---

## L — CORRECTIVE OWNER DIRECTIVE: a persistent circuit-building assistant, not a timed request

Added 2026-10-17 after the owner's retry still failed. This is implementation work completing C, D and K, not a new chapter, a replacement roadmap, another Astra expansion, or permission to restart completed work. Preserve A–K and the existing program goals. Prioritize this broken generation journey before optional visual polish or broader orchestration. Execute the increments below in order, verify each, record its state, and continue automatically without asking for another substage prompt.

### L.0 The actual failure and the required change in approach

The owner entered:

```text
build me a simple drone controlling circuitly with 4 motors just a simple one
```

The normal Build interface first reported `All 3 subsystem blocks failed to design.` A local correction increased the shared generation deadline from 40 seconds to 180 seconds, added real cancellation, preserved block errors and passed 488 targeted offline tests. The owner retried and received:

```text
Generating schematic
Preparing request
Generating build netlist
Schematic generation reached its 180 s deadline during design. No complete design was produced.
```

That second result means the user journey is **still not fixed**. The offline tests established orchestration/cancellation behavior, not a successful live drone design. Read `artifacts/product-reliability-simple-ui/generation-failure-fix-2026-10-17.md` as historical evidence, not a completion certificate. Do not present its test count as proof that the owner's request now works.

The owner wants the useful behavior of a coding assistant: understand the goal, inspect the actual project, select documented tools, execute permitted work, observe the results, revise the approach, retain completed work, explain progress, and continue toward a reviewable result. Implement that behavior. Do not promise the same proprietary model/backend, identical intelligence, exposed private chain-of-thought, guaranteed engineering correctness, or success when required evidence/resources genuinely do not exist.

**Do not solve this by changing 180 seconds to a larger magic number, setting Infinity, removing AbortSignals, disabling all limits, or leaving a browser HTTP request open indefinitely.** Replace the request-lifetime task architecture. Finite provider/tool/worker execution windows must checkpoint, yield and resume the logical task rather than erase it or declare the circuit failed just because a window elapsed. A task should be able to continue for hours, or across days when authorized resources and a running worker permit, without pretending that one model call or one HTTP request lasts that long.

### L.1 Reproduce and explain why useful design work is stalling

Begin with the current absolute checkout, instructions, branch/HEAD, dirty-tree inventory and runtime. Preserve the other builder's work and all approved repairs. The working copy remains `C:\Users\robsa\Desktop\sirkit-edit`; `C:\Users\robsa\sirkit` remains protected unless the owner explicitly changes that designation. Do not kill/restart an unrelated worker or dev server as cleanup.

Source observations checked on 2026-10-17; verify them against the current tree:

- `app/page.tsx::handleGenerateSchematic` starts an activity entry and awaits one `POST /api/schematic/build-multi` fetch. Those few client status labels are not a server progress feed or background job.
- `app/lib/schematic/build-result.ts::BUILD_BUDGET` currently sets 180,000 ms, 20 turns per loop and three concurrent loops. Its environment override currently only lowers the iteration ceiling.
- `app/lib/schematic/build-multi-generation.ts::runBuildMultiGeneration` starts one clock before planning, then waits for the whole block pool. Successful blocks and their tool history are not durable checkpoints while another block is stuck.
- `app/lib/build-loop.ts::runBuildToolLoopInternal` keeps messages, surfaced parts/pins, turn counts and ERC correction state in memory. Persisting only a final netlist cannot resume that loop.
- `app/lib/agent/contracts.ts::DEFAULT_AGENT_BUDGET` independently sets six model steps, ten tool calls, 15-second normal tool waits and a 120-second run deadline. `app/lib/agent/loop.ts` clamps long-running tools to the remaining run time. `app/lib/agent/generation-proposals.ts::SchematicGenerationProposalService.invoke` further clamps generation to that time and the Build budget. The 185-second generation descriptor does not defeat its shorter parent deadline.
- `app/lib/schematic/build-boundary.ts`, both provider adapters and `app/lib/parts-search.ts` now carry cancellation/late-result guards. Preserve their actual protections; do not restore the previous late-success or post-cancellation work defects merely to remove a task deadline.

Instrument the real stalled stage with structured, bounded and redacted evidence. For each block, distinguish: waiting on a provider, repeated/no-result catalog queries, incorrect category filters, incompatible candidates, absent authoritative pins/footprints, invalid submission, ERC feedback, an unavailable optional reranker, merge-contract failure, or an actual provider/resource refusal. Record timestamps/durations, operation names, attempt/cursor identities, candidate counts, validation codes, shared-net obligations and public status summaries. Do not dump secrets, private prompts/designs or hidden reasoning into Git or telemetry.

Inspect whether successful provider responses contain search calls but never reach a valid submit. Check result shape, optional-null handling, actual catalog category names, registered tool manuals, pin validation and component-authority eligibility. Do not assume the timeout was the only defect, that the whole catalog contains only its handful of published atomic parts, or that every unqualified component is usable on a PCB. Verify each claim.

Establish the observed cause of this retry if existing logs permit; otherwise label the missing historical detail UNKNOWN and create a deterministic current reproduction. Offline reproductions must not silently make paid calls. Proceed with the architecture and functional repair even if the exact old response was not retained.

### L.2 Separate the durable logical task from a provider turn and worker attempt

Implement one shared, scoped generation-task service reached by both Build and chat. Reuse the actual durable substrate instead of adding a second inconsistent circuit builder.

Inspect and selectively reuse:

- `app/lib/durable-workflow/types.ts::DurableWorkflowRepository`, its scoped commit/loadHead/history contracts, and `app/lib/durable-workflow/server-repository.ts` for revisioned CAS, idempotency and outbox transactions;
- `app/lib/agent/orchestration/store.ts::DurableOrchestrationRunStore` / `DurableOrchestrationResumeStore`, and `app/api/chat/orchestration-runtime.ts::productionStoreFactory`, as digest-bound scoped persistence/composition-root patterns;
- `app/lib/agent/orchestration/run-events.ts` for typed, bounded public progress;
- `app/lib/project/pending-proposal-store.ts` and `generation-proposal-events.ts` for the existing review/intake/currency behavior—not as a substitute for server-side task execution persistence.

Do not claim a worker exists merely because a job type or table exists:

- `app/lib/durable-workflow/outbox.ts::DurableOutboxDispatcher` currently defaults to 30-second leases, sequentially awaits handlers and has no lease-renewal API in its repository contract. Running hours of generation inside one such handler risks duplicate concurrent execution after lease expiry. Implement finite claimed slices or a properly fenced/renewed ownership contract before using it.
- `app/lib/durable-workflow/effects-runtime.ts` and `/api/engineering-effects` are existing effect dispatch, not proof of an independently supervised generation worker.
- `app/lib/spice/server/job-store.ts` holds jobs/listeners in `globalThis` Maps. Its SSE/cancel conventions can inform the UI; its lifetime is not restart-safe storage.
- `app/lib/full-flow/jobs.ts` contains typed state helpers such as `acquireJobLease`, not an executable supervised background service. A `heartbeatAt` field alone is not a heartbeat implementation.

The generation task needs a versioned, validated record with, at minimum: task identity and idempotency key; trusted tenant/project/branch and initiating principal; immutable request/requirements identity; captured schematic base/head and relevant catalog/authority versions; plan/shared interfaces; each block's status and verified intermediate artifacts; pending work/recovery cursor; cumulative attempts/usage/reservations; cancellation and pause intent; worker ownership/fencing; ordered public event cursor; timestamps; and final proposal/result identity. Reuse existing compatible fields/types, not a parallel unvalidated JSON blob.

Store sufficient normalized tool results and surfaced-part/pin identities to resume correctly, with bounded context compaction and provenance. Do not persist or publish private chain-of-thought, credentials or arbitrary opaque SDK objects. If private provider continuation state is genuinely required, use an explicit protected/versioned/retained contract; otherwise reconstruct a valid tool conversation from normalized records. Never replay a model tool result without its corresponding call or fabricate an unobserved provider response.

Suggested states: queued, running, waiting-for-provider, waiting-for-resource, awaiting-review, paused, cancel-requested, cancelled, succeeded, failed, stale. Align with existing vocabulary where appropriate. Define each transition and what evidence justifies it. A running task, a completed generation, a reviewed proposal and an applied circuit are different things.

If durable storage/worker capability is absent, expose the exact setup blocker; do not return a fake accepted job or silently fall back to a process-local Map and advertise recovery. Use isolated test storage and the repository's migration-delivery rules. Do not apply a production migration or invent migration metadata without authorization.

### L.3 Execute many finite slices without abandoning the user's task

Build an actual runnable worker and documented local startup/shutdown path, plus a deployment-appropriate supervision contract. The web server returning 202 is not sufficient. Prove who consumes queued work when the browser closes and how work resumes after a worker/server restart. Do not use unawaited web-route promises, a React component, `setInterval` in a tab, or a detached process with no ownership/recovery as the job engine.

Each claimed slice should perform a bounded unit of useful work, durably commit its normalized result/checkpoint, and schedule the next slice atomically where required. Distinguish taskId, slice/attemptId, provider call identity, block identity and canonical mutation identity. Use monotonic fencing/CAS so a late expired worker cannot overwrite a newer checkpoint or publish a stale result. Avoid claiming a batch whose leases expire while a different item runs sequentially.

Task-level behavior:

- Reaching a worker wall-clock/turn allowance normally yields a checkpoint and queues the next useful slice. It does not become `All blocks failed`, `No complete design was produced`, or an unrecoverable generation error.
- The current 20-turn Build ceiling and six-step/ten-tool chat limits may remain finite **execution-slice** policies, but they must not masquerade as the total work allowed for a persistent design task. Do not just raise all constants or reset counters to hide repeated work.
- Keep cumulative accounting and strategy history across slices/resumes/providers. A duplicate start attaches to the existing intended task; an explicit new user request gets its own identity. Retry and resume are not automatically new tasks.
- A single hung provider/tool call still times out and releases or fences its ownership. It is not allowed to hold a worker forever. Transient failures receive scheduled backoff/jitter and real Retry-After handling; authentication, denied access, quota exhaustion, invalid data, unavailable source credentials and missing evidence have their own actionable states.
- Save successful blocks immediately. Retry/rework only the missing or invalid block unless a changed shared interface invalidates a dependent one. Do not lose two finished subsystems because the third needs another search.
- Detect no-progress loops by semantic operation/input, catalog version, failure and learned constraints—not merely different punctuation in a query. Cache equivalent successful lookups. Try a genuinely different authorized strategy when there is one; when alternatives are genuinely exhausted, preserve the task and expose the exact blocker instead of making infinite identical paid calls.
- Unknown provider completion/charges require reconciliation or retained reservation. Do not claim exactly-once external model billing when the transport cannot guarantee it. Exactly-once canonical effects still require the existing execution/receipt contracts.
- Cancellation is a durable user action, not simply loss of a stream subscriber. Explicit cancellation stops new work, propagates aborts, fences late completions and settles the task truthfully. Define whether a later user action resumes saved work or starts a new task; do not unexpectedly restart a cancelled task.
- Revalidate membership, capabilities, revision currency and source/publication eligibility at continuation and before proposals/effects. A principal revoked while a task was queued cannot retain hidden indefinite authority.

### L.4 Replace the blocking fetch with a real task lifecycle in the existing simple UI

Create the smallest typed canonical endpoint/domain-command surface that fits the current architecture: start/attach, inspect, event replay/subscribe, request cancellation, and resume/retry where valid. Endpoint names are design choices, not pre-existing claims. Apply the repository's canonical authorization/body/read boundaries to every method; update route policy/registry coverage rather than creating a new raw-handler escape hatch.

Task creation should return an accepted task reference promptly after durable acceptance, not wait for the design to finish. If a response is lost after acceptance, an idempotent retry must recover that same task. Status/events/results must remain scoped and accessible only to authorized callers; a guessed task ID is not access control.

Use SSE/NDJSON or a suitable existing transport for live events, with a durable cursor and bounded pagination/replay. Polling fallback must work. Heartbeats convey liveness, not invented engineering progress. Reconnecting or reloading cannot start the model again, lose completed blocks, duplicate event effects or replay a mutation. A subscriber disconnect normally detaches observation; it is not the same as the user pressing Cancel.

The existing workspace should clearly show the actual current phase/block and useful public updates such as checking catalog candidates, validating a pin contract, correcting ERC findings, saving a completed block or waiting for an unavailable resource. Show elapsed time, meaningful progress, a visible Stop control and supported Resume/Retry actions. No fabricated percentage, scripted narration, private chain-of-thought or giant debug wall. Remove the false impression of a frozen three-line activity log without redesigning the whole app again.

Project switch and reload must not attach an old task/result to a new project. Reopening the original project can reattach to its existing authorized task. An edited base becomes stale or explicitly needs rebase/review; do not overwrite a newer sheet when an old background task finishes.

Deliver the final netlist through the SAME catalog resolution, layout validation and review dialog used today. Preserve `complete` versus `partial`, omitted blocks and truthful electrical-check state. Task success means a real validated reviewable artifact exists, not that a start request returned 202 or a model said done. Do not apply a design solely because the worker completed.

### L.5 Make chat use the same durable work instead of owning its lifetime

Update the shared semantic tool/service and version its contract as necessary. A chat turn should be able to start or attach to generation, inspect its state, subscribe/report public progress, request the permitted control action and return the real final artifact when available. Its 120-second conversational deadline may end a turn or yield a continuation; it must not kill an independently accepted design task just because the conversation step ended.

Do not leave two implementations: unlimited-looking Build with still-120-second chat, or long-running chat with a still-blocking Build fetch. Preserve shared task authority, the existing proposal receiver, schema-derived arguments, trusted effective actor, editor scope and approval rules. Add real registered/discoverable status/control operations where needed; a model-facing description without an implemented invocation path is not support.

Do not let chat cancellation accidentally cancel unrelated project tasks, or create an unlimited invisible job for an ordinary engineering question. Document the semantics of Stop answer versus Stop design. Extend the coverage matrix/manuals with these precise distinctions. Update any strict tool/event/proposal schema and replay consumer intentionally; do not force a job-accepted event through a validator that expects a completed sealed proposal.

The assistant must inspect the actual schematic, components, task status and available tools; use shared domain operations; evaluate actual tool outcomes; and report what really happened. Do not add arbitrary shell/SQL, browser-control privileges or unrestricted function execution to emulate a coding assistant. An agent need not call a React button to perform the corresponding legitimate command.

### L.6 Resolve real part-search and engineering blockers instead of just waiting longer

Use the stalled-stage evidence from L.1 to fix the actual bottleneck alongside the task lifecycle. Reuse saved approved components before external searches. Make category/query normalization reflect the actual catalog contract, reuse discovered candidates/pin facts across appropriate blocks, and avoid repeated embeddings/reranking for an identical request and catalog identity. An optional provider already known to be unavailable should not be called repeatedly by every search in the same task; preserve truthful fallback and allow a later genuine configuration/recovery change to be detected.

Where a part is genuinely missing, use K's permitted search/download/validate/store/review/reuse path and existing missing-parts work items. Integrate real missing-resource state into this task instead of throwing away its other blocks. This does not authorize making up a manufacturer part, footprint geometry, pin/pad mapping, source license or availability. A documented unverified draft can be a useful output; it is not a published exact component.

For the four-motor example, preserve the requested functional coverage and explicitly record material assumptions, including motor/control type and supply/current requirements when needed. Resolve essential ambiguity through a concise question or disclosed supportable assumptions rather than silently designing a different circuit. Do not count three arbitrary placeholder blocks as a drone controller or imply firmware/flight qualification was supplied. Module/sheet interfaces must represent actual project-wide nets and pin connections, not just matching prose labels.

The owner's developer-test authorization remains US$5 cumulative, as specified above. Read the current shared ledger; do not assume its previous balance is still current. This builder-test ceiling is distinct from whatever task spending the owner explicitly authorizes in the product. Implement clear product task spending/admission policy without silently minting permission for unbounded API bills. Keep uncertain charges reserved and ensure concurrent slices share the same accounting. No default provider/model upgrade, unmetered failover, purchase or production upload is implied. If bounded live qualification cannot be admitted truthfully, finish offline functionality and identify that exact qualification blocker; do not falsify a live success.

### L.7 Prove the real vertical slice and the recovery boundaries

Add permanent tests using the actual production task service/worker/receivers, isolated durable storage and fake provider/catalog seams. At minimum prove:

1. A three-block design that legitimately needs longer than 180 simulated seconds and more than the old single-slice turn/tool allowances eventually reaches a complete reviewable proposal; time-window expiry queues continuation rather than destroying the task.
2. A 24-hour-or-longer simulated logical task remains valid across many finite slices, worker restart and browser disconnect/reconnect; no need to hold a test open for a real day. This proves lifecycle behavior, not live engineering quality.
3. A hung turn times out; a new attempt can continue under valid ownership. Lease expiry, duplicate consumers, delayed completion and cancellation prevent an old worker from committing over a new one. Repeated resource or platform failure becomes an honest visible state rather than an infinitely failing queue.
4. Successful blocks, validated catalog facts, counters, strategy history and spend/reservations survive a crash. Resume does not redo paid or canonical operations merely because a process forgot its state. Ambiguous external completion is handled honestly.
5. Four or more failed but genuinely different useful strategies can be followed by a successful strategy. Identical no-progress loops cannot burn credits forever. A real missing/evidence/permission/quota blocker retains useful progress with an actionable resolution.
6. Exact task startup replay, ordered event replay, cursor pagination, subscriber disconnect, missing worker and missing storage behave truthfully. No accepted job that will never be consumed is presented as running successfully.
7. Explicit Cancel stops further work and late result intake; Stop answer and Stop design have tested distinct semantics. Refresh/project switch cannot duplicate work or misattach results. Revocation, foreign IDs and stale bases refuse correctly.
8. Build and chat start/inspect/control the SAME production task path; both expose real public progress and reach the same validated review flow. Shared command/tool manuals and the coverage matrix match executable behavior.
9. A fresh-browser synthetic four-motor request produces the actual expected subsystem content and catalog-resolved schematic, not just a task record. Show completion/partial/blocker state, approval handoff, save/reload and subsequent PCB-preparation handoff. ERC/DRC, unresolved components, canonical approval/apply and release remain truthful and enforced.
10. Use at least one other supported ordinary circuit request to show this is a general repair, not a hard-coded answer to the owner's sentence. Fake-backed, live-model, live-catalog and live-router evidence must be labeled separately.

Run affected suites and the normal CI/type/lint/generator gates proportionately; capture actual exit codes. When source-citation pins move, update their actual anchors without weakening behavior or rewriting historical evidence. Do not classify a new functional failure as a performance flake. Verify the current normal-mode UI and correct source checkout, not only a fixture API handler.

### L.8 Incremental execution, evidence and completion

Use this order without waiting for more owner prompts:

1. Reproduction and precise stall/limit map.
2. Validated durable task/checkpoint/ownership contracts and isolated persistence tests.
3. Runnable supervised worker, finite slices, continuation/recovery, accounting and fencing.
4. Shared accepted-job API, real progress, visible Stop/Resume and reload/project-switch behavior.
5. Build/chat semantic parity and final proposal/review integration.
6. Actual catalog/subsystem bottleneck fixes, missing-resource recovery and complete vertical-slice proof.
7. Regression gates, concise current evidence, integration and handoff.

Read and keep in working context the active increment and its direct dependencies; maintain a compact durable progress ledger with completed work, actual evidence and the exact next step. Do not reload the entire historical chapter archive every turn or implement every phase in one uncontrolled patch. After verifying a coherent increment, record/commit it according to the current integration instructions, then proceed. Preserve real authorship, real dates and all concurrent work; do not force-push or rewrite unrelated history.

Use `artifacts/product-reliability-simple-ui/persistent-generation/` for a compact evidence package: current limit/stall map, task/worker/recovery contract, changed-files inventory, actual validation commands/results, browser evidence and final verdict with remaining blockers. Reuse the existing matrix/manual generators and ledger. A second set of dozens of repetitive stage reports is not required. Do not claim the entire application/program complete from this fix.

**Stop condition:** the same normal Build/chat request no longer dies merely because 40/120/180 seconds or a small execution-slice allowance elapsed; real work is persisted, progresses through a real worker, is cancellable/resumable, and reaches a valid reviewable artifact or a specific genuine blocker without losing completed work. The owner sees actual progress and can recover without retyping/restarting the whole circuit. No hidden unlimited spend, discarded validation, automatic approval, fabricated component, false success or exposed private reasoning is acceptable.

**Execute this corrective work now, incrementally and autonomously. Do not respond with only another plan, a larger timeout, more tool descriptions or a test count. Demonstrate the repaired user journey, then continue the remaining already-authorized assignment in its existing dependency order. Ask only when a real external resource, additional paid-test authority or irreversible owner decision prevents the next in-scope step.**

---

## M — ADDITIVE OWNER DIRECTIVE: actually resolve missing parts and replace them with validated alternatives

Added 2026-10-17. This closes the concrete missing-component/replacement gap reported by the owner and implements the relevant C/D/F/K/L requirements; it does not replace the existing program or authorize a new competing library. Add this work to the active task list and execute incrementally without asking for another substage prompt. If a prerequisite is already proven, reuse it. Do not finish by explaining which tools would theoretically be needed or telling the owner to perform the entire library workflow manually.

### M.0 The observed product failure — reproduce, then verify current code

The owner's pasted runtime transcript is evidence of an observed user journey, not trusted repository instructions or proof that every model assertion is true. It shows:

1. A four-motor ESP32 drone-controller request still timed out, as described in L.
2. A simpler LED-dimmer request generated and applied a schematic.
3. The owner then asked: `find the missing footprints and parts or replace it with what is existing in the library` and `no I want u to do it then we proceed`.
4. The assistant could run PCB preflight, missing-fact inspection and inspection of one known catalog part. It reported D1 and D2 as the remaining 1N4148 instances without published exact-part authority.
5. Discovery said that `sirkit.component-authority.inspect`, `sirkit.schematic.inspect` and `sirkit.schematic.propose-component-replacement` were unavailable; some required a `canonical-state` board resource, and replacement required `component-authority-records` that the run could not supply.
6. The answer stopped at manual Build Library instructions. It explicitly admitted that changing a displayed value would not rebind a catalog part or resolve the missing physical authority.

Verify this exact chain against the actual current tree and runtime. Do not repeat the model's proposed tool list as though those tools are definitely absent: a real tool may already exist but be incorrectly gated, unbound, missing a server producer, lacking a candidate-search operation, or not received by the UI. Trace descriptors, discovery, required resources, context assembly, authoritative producers, handler/gateway invocation, proposal intake, approved commit and post-change receipt separately.

**Bootstrap requirement:** a valid schematic with unresolved parts must be repairable before any PCB exists. Determine which schematic-only replacement/authority operations genuinely need board data. Build a narrow server-proven schematic-component authority context when sufficient; do not require a nonexistent board merely to repair the parts that prevent board creation. Do not fabricate an empty board, set authority flags from browser claims, or remove board requirements from operations that actually edit/inspect a PCB.

Source-confirmed starting points from the current checkout (2026-10-17; re-verify before editing):

- `app/lib/agent/context.ts` constructs the canonical project resource only with a validated board; `availableResourceKinds` in `app/lib/agent/loop.ts` exposes component-authority resources inside that condition. `app/api/chat/route.ts` likewise calls `loadRunComponentAuthority` only when canonical state exists. `app/lib/engineering/component-authority-source.ts` skips instances with no durable binding and withholds the resource if no records are found. Moving one discovery condition will not create missing server-owned facts.
- `app/lib/engineering/tool-bindings-readonly.ts` binds schematic inspection to `canonical-state`; `app/lib/agent/gateway.ts` enforces that requirement. The dedicated boardless services in `missing-facts-reads.ts`, `pcb-sync-preflight-reads.ts` and `catalog-inspection-reads.ts` are architectural precedents for narrowly typed, scope/digest-checked schematic-only operations, not permission to bypass the canonical-board binding globally. Locate the actual preflight service path if it has moved.
- The existing external-acquisition path also requires canonical state in `context.ts`, `loop.ts`, `gateway.ts` and `acquisition-reads.ts`. A configured external port therefore does not by itself allow bootstrap searches before PCB creation. Add the appropriate schematic-scoped evidence capability explicitly while preserving source admission/disclosure and without enabling board mutations.
- `sirkit.parts.catalog-inspect` only inspects a known `partId`. The `sirkit.parts.search` descriptor exists, but is not an activated query-search binding; its metadata notes the provider-backed embedding dependency. A known-ID reader is not a usable alternatives search. `sirkit.parts.external-search` accepts exact MPNs, not arbitrary functional-alternative queries; preserve that contract or introduce a separate reviewed discovery path rather than smuggling generic text into it.
- `app/lib/engineering/replacement-proposal-assembler.ts::assembleReplacementProposal` requires a server-owned verified-exact target **and** published atomic/symbol facts for the current component. The descriptor accepts `componentId` and an optional expected-MPN assertion, not an arbitrary alternative selector; the present pin proof supports exact identity mapping. That narrower B14 operation is not the complete unresolved-part resolution feature requested here.

Implement a deliberate **unresolved-component resolution/binding** command/proposal where the old instance lacks a published atomic revision; retain the existing exact-authority replacement path for already-qualified parts. The new path must establish the current symbol's connected pin facts from actual trusted catalog/symbol evidence and the captured schematic, prove its mapping to an eligible target, and disclose ambiguity. It must not require the missing old atomic publication merely to start finding a valid replacement, nor treat browser pin lists as authority. If those source facts cannot be established, return the exact missing evidence/review work item. Preserve the existing deterministic empty-board *reference-digest* helper where its internal contract requires it; never advertise that reference as a real current PCB or use it to unlock unrelated board tools.

### M.1 Required user experience and task semantics

From a current schematic, the owner should be able to say any of:

```text
Resolve the missing parts and footprints, then continue preparing the PCB.
Replace D1 and D2 with suitable alternatives already in the library.
Replace the selected unavailable part with a compatible alternative.
If no suitable local part exists, find the actual part/assets online, import and validate them, save them to the library, then offer the replacement.
```

The system must inspect the actual instances/connectivity/requirements, search actual eligible local alternatives, perform an evidence-based compatibility check, and carry out the permitted acquisition/proposal/review/application work through real domain commands. The task must continue after the appropriate user approvals without requiring the owner to retype the whole original request.

Distinguish an unresolved instance, an unavailable exact MPN, a missing footprint/model, an unpublished revision and an incompatible alternative. A footprint-only repair may preserve the existing exact part; a part replacement changes identity and may need a new symbol/pin mapping. Do not replace a valid part unnecessarily when the missing asset can be resolved for that exact revision. A model not knowing an MPN is not proof the component does not exist.

Previously approved compatible exact revisions should be reused without repeating publication review. Newly obtained or constructed assets follow the existing validation/quarantine/publication rules. Let the assistant do the searching, evidence gathering, import, comparison and preparation; ask the owner only for a material ambiguous engineering choice, required review/approval, missing source access or an actual external blocker. Do not use safety wording as a substitute for implementing an authorized capability.

### M.2 Complete the shared semantic capability chain, not just tool descriptions

Inventory and reuse existing commands/descriptors first. Add or adapt only missing implemented capabilities, with documented schemas, discoverability, permissions and UI parity:

1. **Schematic-instance inspection without a PCB:** stable instance ID/refDes; current catalog/exact revision and status; actual symbol/pins/functions; connected nets and polarity; value/role; relevant constraints; captured scope, lineage/head and schematic digest. A refDes alone is not a durable mutation target.
2. **Candidate search, not only known-ID lookup:** search the local library/catalog by functional role, specifications, package/mounting and actual installed/published asset availability. Return exact revision identities and separate eligible, draft, missing-asset, withdrawn and incompatible results. Candidate selection cannot be restricted to parts whose IDs the model already knows. A sourcing price/stock observation is not a CAD asset or component approval.
3. **Compatibility/evidence evaluation:** compare the actual circuit requirements and old/new pin functions, pin numbering, symbol representation, polarity, package/footprint, pin-to-pad mapping and required electrical ratings. Support an explicit proved pin permutation when necessary; matching pin count, display name or a plausible package hint is not enough. Return compatible, incompatible or unresolved with reasons/evidence and the exact mapping. Do not label a topology match as a complete electrical equivalence proof.
4. **Replacement or asset-binding proposal:** target stable current instances, exact eligible candidate revision, proposed symbol/footprint/mapping changes and the source base. Show old/new identities and material warnings. Preserve reference designators, intended net connectivity, component values/roles and sheet membership unless a separately explicit reviewed change is needed. Replacing both D1 and D2 should be one coherent batch when appropriate, not two uncoordinated edits.
5. **Reviewed canonical application:** use the existing sealed proposal/execution-grant/domain-executor/transaction path. A statement such as `replace D1 and D2` expresses intent; it does not fabricate a review receipt or universal future approval. Reuse any legitimate existing explicit-execution policy rather than imposing duplicate confirmations. Verify the live base, current authority and exact effects at commit. Return the real transaction/receipt and new schematic revision before saying the parts changed.
6. **Post-change verification and continuation:** run actual electrical/netlist checks and the current Prepare PCB preflight, explain any remaining blockers, and continue the existing PCB-plan review/apply flow where permitted. `preflight ready`, `PCB applied`, `routed`, `DRC passed` and `released` remain distinct outcomes.

Build/chat/library controls must share these semantic services. Discover only real bound implementations and accurate resource requirements. Update the executable coverage matrix, generated manuals, schemas and relevant tests. Do not create fake tool aliases, make a UI handler the sole mutation authority, use arbitrary React access, or call a value-text edit a component replacement.

### M.3 When the library lacks the needed part: obtain actual assets, validate, store, then use

Complete K.5's acquisition-to-library path and connect it directly to this replacement task. Reuse the admitted acquisition/source registry, bounded transport, atomic ingestion, review/publication, asset storage and missing-part work items already in the product; verify which links are implemented today.

The assistant should:

1. Search suitable permitted manufacturer/library sources for an exact part or a justified compatible alternative. Use the circuit's actual required ratings/package/interface, not a generic keyword-only substitution. Try meaningful permitted alternatives; do not blindly retry an unavailable credential/source.
2. Retrieve the actual allowed symbol, footprint, datasheet and optional 3D bytes through the existing constrained transport. Respect source access/license/retention; do not scrape around an access denial, execute installers/scripts, fetch arbitrary URLs or write outside approved asset storage.
3. Record exact manufacturer/MPN/package/variant, source/revision/time/license, content hashes and supporting datasheet evidence. Downloaded bytes must really exist in the store; a URL or model-generated JSON description is not an imported footprint.
4. Validate formats and archive paths/resource limits; parse in the appropriate isolation; verify actual pin numbers/names/functions, pad geometry/numbering, package dimensions/orientation/pin 1 and deterministic symbol-to-footprint mapping. Handle conflicting/absent evidence as unresolved, not guessed facts.
5. Store reusable source assets and normalized/derived representations in the existing durable library, deduplicated and versioned with provenance. Preserve private/project/library scope and licensed retention. Raw vendor blobs and credentials do not belong in Git.
6. Run the existing candidate review/publication path. Reuse an unchanged already-approved revision; do not auto-publish a newly downloaded part or let the assistant mint its own authority certificate. Present an actionable review package instead of asking the owner to independently redo the whole research/import job.
7. Once eligible, refer to the exact stored revision in the replacement proposal, commit through the normal authority path and continue the original task. A later source update cannot silently alter an existing project.
8. Reopen the project and reuse the same approved part in another permitted project without repeated downloads or paid search calls when its retained identity/status remains valid. A withdrawn/changed revision requires the established status/upgrade handling.

If no documented asset exists, constructing an **unverified draft** from authoritative available pin/package evidence is allowed where existing policy supports it; disclose all missing facts and require the proper review. Do not fabricate electrical ratings, hidden/thermal pads or undocumented dimensions to make a task complete. A placeholder/draft cannot silently become a manufacturable component. Optional missing 3D visualization must not block an otherwise fully qualified electrical replacement unless a real mechanical requirement depends on it.

Missing external credentials, a license that forbids retention, an unsupported parser or a required independent reviewer is a specific external blocker to preserve in the task. It is not permission to claim online integration was completed, nor a reason to stop independent eligible local-alternative work.

### M.4 Durable execution, approvals and engineering consistency

Integrate with L's persistent task/checkpoint/progress model. Local candidate search, external retrieval, candidate validation, publication review, replacement review, canonical commit and PCB preflight are distinct stages with distinct completion evidence. Waiting for a review/source or a worker slice must retain useful work and resume the same task rather than repeat the original design.

Capture target instance identities plus original schematic/head/authority/candidate digests. After every asynchronous boundary, verify currency before consuming a result or proposing/applying an effect. A user edit, project switch, candidate withdrawal or membership revocation cannot redirect an old result to the latest component or project. Preserve undo/redo, autosave/hydration, canonical receipts and idempotent recovery. An uncertain commit must be reconciled from authoritative history, not submitted again blindly.

For multi-sheet work, preserve local/global/hierarchical connectivity and update project-wide BOM/netlist/PCB sync consistently. If a PCB already exists, determine the actual impact on placed footprints and routed connectivity, require the appropriate additional review, and retire/recompute affected parity/DRC/readiness results. Do not claim an old route or release remains valid after a footprint/pin-mapping change.

Provide public progress tied to real events: inspecting D1/D2, searching eligible local revisions, checking candidate mappings, retrieving a missing asset, validation result, awaiting a specific review, replacement committed with revision, and updated preflight. No private reasoning dump, synthetic success narration or `Nothing changed` followed by a misleading completed action.

Human approval and manufacturing release remain separate. The assistant can prepare and execute permitted component operations; it cannot self-authorize publication, release, qualification or ordering merely because the owner asked it to find alternatives. Use the actual existing role/approval policy and report exactly which stage needs an authorized person.

### M.5 Required proof and implementation order

Execute the smallest working local-alternative vertical slice first, then complete external acquisition/reuse. This can run as a functional increment within L; do not postpone a schematic-only replacement unnecessarily until every unrelated worker/3D/polish feature is finished. Do not declare M complete until its external path is actually implemented and qualified to the extent authorized.

Permanent production-path tests must cover:

1. A valid schematic with **no PCB** and two unresolved instances can discover and invoke the real eligible inspection/search/replacement services. Board-only tools remain correctly withheld. No fake canonical board or browser-supplied authority is accepted.
2. The LED-dimmer D1/D2 reproduction, or a faithful isolated equivalent, selects an actual eligible compatible local revision, produces the right batch mapping/replacement diff, passes through the normal confirmation/application path and returns a new canonical revision. Do not hard-code these refDes, MPNs or catalog IDs into product logic.
3. RefDes, connectivity, polarity, intended values/roles and unaffected components/nets remain correct. Display-only edits cannot satisfy the test. Unknown or incompatible pins/ratings/packages and withdrawn revisions refuse precisely.
4. No local candidate → permitted fixture source → actual CAD/datasheet bytes → parsing/evidence/mapping validation → durable library candidate → required review/publication → eligible replacement → electrical check and PCB preflight. Tests must exercise the real service boundary; a mock returning `published: true` alone is not evidence of the chain.
5. Reopen/reuse from durable storage performs no unnecessary network/download/model work. A second authorized project can use a shared eligible part; a foreign/private one cannot read restricted assets. Changes/withdrawal/licensing restrictions remain handled.
6. Approval refusal, missing credentials/evidence, unavailable source, malformed/hostile assets, task cancellation, stale schematic/candidate, revoked membership, duplicate clicks and crash after ambiguous commit cannot forge authority, corrupt a library, duplicate replacement or overwrite another project.
7. Existing-board replacement correctly handles changed footprint/pin/route effects and stale manufacturing evidence. Undo/redo/save/reload and multi-sheet identity behavior remain consistent.
8. Fresh-browser Build and chat proofs show the actual action, review, commit receipt and updated PCB-preparation state. Tool descriptors/manuals/coverage and discovery agree with executable behavior. Label fake-source, live-source, live-provider and engineering-quality evidence separately.

Follow the current integration and cumulative paid-test limits; do not spend additional credits or alter production accounts/data merely to produce a demo. Inspect current official source/API documentation when implementing an external connector, and record the supported source/format/license boundaries. Add evidence to the existing compact product-reliability package and ledger rather than generating another large duplicated stage-report set.

**Completion means the owner can ask Sirkit to resolve or replace missing parts; the assistant does the actual permitted inspection, search, acquisition, validation, storage and proposal/application work, and continues the existing PCB handoff after the required approvals. A list of hypothetical tools, a changed label, a downloaded-but-unusable asset, manual instructions alone or a claim of a nonexistent part is not completion. Implement this now, incrementally, preserve the original goals, and continue without waiting for separate substage prompts.**
