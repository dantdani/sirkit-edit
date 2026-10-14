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
