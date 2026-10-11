# B24-F - Threat-model closure register (D24-39; OD-220)

Labels: **CONFIRMED** (read at the cited file:line at `58c0834`, or executed and measured), **INFERRED** (a reading, nothing executed),
**RECORDED** (taken from a chapter's own record without a claim of our own), **BLOCKED-LIVE-QUALIFICATION** (needs a live resource the
owner has not supplied; never faked, never claimed). Base: `58c0834` on `chapter/b24-production-qualification` (B24-E committed).
Written by hand (OD-220) from the seven numbered defect registers and their closure records; checked by `b24-f-registers` 1-3.

## 1. Scope

This register closes the program's numbered defect registers, one row per defect: B18's findings F18-1..F18-5, B19's D19-1..D19-12,
and the defect headings of the B20, B21, B22, B23 and B24 discoveries (D20-1..D20-36, D21-1..D21-48, D22-1..D22-24, D23-1..D23-21,
D24-1..D24-43): 189 rows. B21's reader ids above D21-48 (up to D21-59) are sources of those defects, not rows. B24's register
holds D24-41..D24-43 beside D24-1..D24-40: B24-B2 and B24-D2 opened them by dated lines in the discovery's section 4.

It is a closure register, not a threat model. Earlier threat modelling exists and is its input (section 2): B03.1's, B09's and B13's
security-boundary pages, the CD-10 stage report's threat-model section, and B22's threat model and adversarial matrix. Those are
chapter-scoped; this register claims no threat modelling for any other chapter, and it adds none of its own: each row's state is the
one its chapter recorded, re-read at `58c0834` (RECORDED), with the later closures B24 made named beside it.
`app/lib/requirements/verification.ts:12` names a threat model only as a review input and is not a source.

## 2. Inputs (the threat-model sources, exactly)

| source | path:line |
|---|---|
| B03.1 security boundary (the "Full threat model" of `artifacts/ai-control-plane-b03/revision-history-contract.md:120-121`) | `artifacts/ai-control-plane-b03-1/security-boundary.md:1` |
| B09 security boundary | `artifacts/ai-control-plane-b09/security-boundary.md:1` |
| B13 security boundary | `artifacts/ai-control-plane-b13/security-boundary.md:1` |
| CD-10 stage report, `## Threat model` | `docs/stage-reports/SIRKIT_CD_10_MODEL_BACKED_SIMULATION_IMPLEMENTATION.md:55` |
| B22 threat model, section 4 (threats, controls, enforcement and tests) | `artifacts/ai-control-plane-b22/threat-model.md:117` |
| B22 threat model, section 5 (what stays open) | `artifacts/ai-control-plane-b22/threat-model.md:140` |
| B22 adversarial matrix, section 6 (residuals) | `artifacts/ai-control-plane-b22/adversarial-matrix.md:174` |
| B22 adversarial matrix, section 10 (the lead's live run) | `artifacts/ai-control-plane-b22/adversarial-matrix.md:323` |

## 3. The registers read

| register | path:line | rows | closure states read from |
|---|---|---|---|
| F18 | `artifacts/ai-control-plane-b18/unknowns-and-owner-decisions.md:22` | 5 | the table's judgement column (`:20-26`) |
| D19 | `artifacts/ai-control-plane-b19/discovery.md:64` | 12 | the table and `artifacts/ai-control-plane-b19/test-and-validation-report.md:80` |
| D20 | `artifacts/ai-control-plane-b20/discovery.md:150` | 36 | `artifacts/ai-control-plane-b20/unknowns-and-owner-decisions.md:73` |
| D21 | `artifacts/ai-control-plane-b21/discovery.md:547` | 48 | `artifacts/ai-control-plane-b21/unknowns-and-owner-decisions.md:62` |
| D22 | `artifacts/ai-control-plane-b22/discovery.md:472` | 24 | `artifacts/ai-control-plane-b22/unknowns-and-owner-decisions.md:71` |
| D23 | `artifacts/ai-control-plane-b23/discovery.md:490` | 21 | `artifacts/ai-control-plane-b23/unknowns-and-owner-decisions.md:67` |
| D24 | `artifacts/ai-control-plane-b24/discovery.md:552` | 43 | the dated closure clauses under each defect and section 10 |

## 4. The states (closed set)

- `closed`: the chapter's record closes the defect; the row names a suite or a commit that a record binds to the row's own closing
  increment (CI checkouts are shallow, so a commit is checked by its record, never through git); B24-Fb's two rows name
  `this commit (B24-Fb)`, which the closeout replaces with the SHA in place. [B24-closeout review, 2026-10-11] correctness-6: replaced
  at commit 2/2 - D24-39 and D24-40 name `7ce1236`, B24-F's one commit (B24-Fa and B24-Fb landed together), with B24-F as their
  closing increment, the increment a record binds the commit to (B24-F's ledger section's successor, closeout 1/2's, records
  `7ce1236`; `b24-f-registers` 2); `b24-f-verdict-lines` 7 holds that no row names `this commit`.
- `closed in part`: part closed, the rest named in the residual.
- `closed as recorded`: the chapter recorded the defect as an accepted bound, a decision or a limit and changed nothing more.
- `open`: nothing closes it at `58c0834`; the residual names who would.
- `BLOCKED-LIVE-QUALIFICATION (LB-n)`: its remaining part needs a live resource; each LB is a row of
  `artifacts/remaining-builder-program/LIVE_BLOCKERS.md`.

A row's suite is the one the closing record names, or `none` when the record names none; `none` never means no test exists.

A commit is bound to its row's closing increment by one of four records, read as text at `58c0834` (`b24-f-registers` 2): the
increment's own `EXECUTION_LEDGER.md` section or the section after it (a paragraph says "this commit", and the next increment records
its base), a B19..B23 `changed-files.md` row naming the commit with the increment, B19's test-and-validation row for its I-increment,
or a B24 discovery closure line of the increment. B24-F's own pages are never read, so no row vouches for itself. B24-E's four rows
(D24-33..D24-36) name no commit: at `58c0834` no record but B24-F's own pages binds E's commit (`58c0834` itself; E's paragraph is the
last one), so each stands on its suite; the closeout may write the commit in place once B24-F's ledger paragraph records it as its
base.

Counts: 189 rows - 132 closed, 20 closed in part, 21 closed as recorded, 12 open, 4 BLOCKED-LIVE-QUALIFICATION. [B24-closeout,
2026-10-10] Since commit 2/2: 133 closed and 19 closed in part (D24-38 re-read, section 5); the rest unchanged.

## 5. The register

| id | defect (paraphrase) | state | closing increment | commit | suite | residual |
|---|---|---|---|---|---|---|
| F18-1 | the durable execution journal holds 32 entries and evicts terminal ones first | closed as recorded | B18 validation | `cf8ad68` | none | an accepted bound: a 33rd unfinished execution drops the oldest recovery record |
| F18-2 | a proven commit's revision is taken from the grant's expectation when the live one cannot be computed | closed as recorded | B18 validation | `cf8ad68` | none | a B18-C review-3 decision; the adopted transaction id is proven from the canonical ledger |
| F18-3 | the layout-candidate apply path has no AST import gate naming its importers | open | - | - | none | a gate for a later hardening pass (B18's judgement); applying still needs the human's panel action |
| F18-4 | the name-based never-exposed patterns are enforced at run time for mutate candidates only | closed as recorded | B18 validation | `cf8ad68` | none | a slip fails CI rather than failing closed at run time |
| F18-5 | the older DRC-repair tool service can commit an autonomous layout behind a route-local allowlist | closed as recorded | B18 validation | `cf8ad68` | none | outside the control plane; closed today by the allowlist and an absent router |
| D19-1 | an anonymous BOM route drove paid live pricing with a caller-supplied cache bypass | closed | B19 I2 | `85a0fa9` | none | - |
| D19-2 | raw distributor error text was reflected to unauthenticated callers | closed | B19 I2 | `85a0fa9` | none | - |
| D19-3 | a distributor key travels in the query string by the vendor's design | closed as recorded | B19 I1 | `237e433` | none | a vendor constraint contained: never logged, never in a message, never redirected |
| D19-4 | no distributor call had a timeout or an abort signal | closed | B19 I1 | `237e433` | none | - |
| D19-5 | every outbound response was read without a size bound | closed | B19 I1 | `237e433` | none | - |
| D19-6 | the cross-verify call followed redirects with its bearer and reflected the remote body | closed | B19 I2b | `c5b972c` | none | - |
| D19-7 | a symbol's licence was enforced at publication but not at export | closed | B19 I5a | `bea0d35` | none | - |
| D19-8 | DigiKey was called faster than its documented limit | closed | B19 I3 | `c452155` | none | - |
| D19-9 | stored offers ignored the vendors' storage terms | closed | B19 I3 | `c452155` | none | - |
| D19-10 | the operator refresh job refreshed nothing after live pricing became a grant | closed | B19 I3 | `c452155` | none | - |
| D19-11 | one distributor was used against its terms | closed as recorded | B19 I3 | `c452155` | none | the source is disabled pending OD-32 |
| D19-12 | the aggregator connector sends a pre-issued token that expires | closed as recorded | B19 closeout | `3296753` | none | recorded, not changed; the live contract is LB-15's |
| D20-1 | the registry had no per-protocol exposure dimension | closed | B20-B1 | `77125bd` | none | - |
| D20-2 | a list built from the agent set would have advertised the granted Tier 1 executions | closed | B20-B1 | `77125bd` | none | - |
| D20-3 | no bearer principal and no audience or issuer validation | closed | B20-B2 | `0e80b30` | none | its live half is recorded BLOCKED-LIVE in B20's table |
| D20-4 | same-origin CSRF refused a missing Origin on every authenticated non-GET row | closed | B20-B2 | `0e80b30` | none | - |
| D20-5 | no route class, identity source or wrapper for a bearer JSON-RPC endpoint | closed | B20-B2 | `0e80b30` | none | - |
| D20-6 | no server-side canonical state for a browser-less read | closed | B20-B3 | `78c0339` | none | - |
| D20-7 | selection and view-session controls have no path outside the chat stream | open | - | - | none | deferred under OD-49 |
| D20-8 | proposals and layout candidates exist only as run-stream events | open | - | - | none | deferred under OD-50, OD-82 and OD-87 |
| D20-9 | the membership revision was not bound into reads or traces | closed | B20-B3 | `78c0339` | none | - |
| D20-10 | no invocation or idempotency identity for reads or proposals | closed | B20-B3 | `78c0339` | none | - |
| D20-11 | trace contracts could not record an MCP principal or an external server | closed | B20-A4, B20-B3 | `3b4b337` | none | - |
| D20-12 | parity was two-way and output schemas never passed the structural validator | closed | B20-C1 | `b3aa13f` | none | - |
| D20-13 | no name-spelling rule for MCP tool names | closed | B20-A2, B20-C1 | `b3aa13f` | none | - |
| D20-14 | no cursor pagination, cache scope or listing identity | closed | B20-B1, B20-C2 | `b3aa13f` | none | - |
| D20-15 | no lexical or injection gate on names, titles, descriptions or annotations | closed | B20-A2, B20-C3 | `b3aa13f` | none | - |
| D20-16 | the egress dropped response headers and never parsed non-2xx bodies | closed | B20-A1 | `0ae9b57` | none | - |
| D20-17 | no server-side SSE reader | closed | B20-A1 | `0ae9b57` | none | - |
| D20-18 | no MCP client: negotiation, discovery, schema validation | closed | B20-A2 | `f3c3473` | none | - |
| D20-19 | no OAuth 2.1 client machinery or credential store | closed | B20-A3 | `b2b16e4` | none | the credential store deferred (OD-46) |
| D20-20 | the allowlist was host-level with no canonical URI or descriptor digest | closed | B20-A1, B20-A2 | `f3c3473` | none | - |
| D20-21 | quotas and breakers had no per-tool dimension | closed | B20-A0 | `c79b723` | none | - |
| D20-22 | no normalizer from an MCP result into an observation record | closed | B20-A4 | `3b4b337` | none | - |
| D20-23 | a DNS rebinding window between admission and connect | closed as recorded | B20-D | `3cb6f04` | none | the residual window is OD-51's recorded limit |
| D20-24 | same-origin redirects re-sent caller headers | closed | B20-A1 | `0ae9b57` | none | - |
| D20-25 | the stdio transport's prerequisites are absent | open | - | - | none | deferred under OD-47 |
| D20-26 | no MCP feature flag | closed | B20-A0 | `c79b723` | none | - |
| D20-27 | the CI admission guard covered the b19 suites only | closed | B20-A0 | `c79b723` | none | - |
| D20-28 | no in-repo proof of the endpoint's wire-level answers | closed | B20-D | `3cb6f04` | none | - |
| D20-29 | provider-native MCP connectors are not rendered and their live behaviour is unverifiable | closed | B20-A5 | `6e3efa7` | none | its live half is recorded BLOCKED-LIVE in B20's table |
| D20-30 | stale statements that Sirkit has no MCP | closed | B20 closeout | `8a5637f` | none | - |
| D20-31 | no scope or step-up model | closed | B20-A3 | `b2b16e4` | none | - |
| D20-32 | the branch is a validated selector, never authorized | closed as recorded | B20 closeout | `96a0314` | none | recorded, not changed |
| D20-33 | the grant identity was unreachable for a non-cookie principal | closed | B20-B1 | `77125bd` | none | - |
| D20-34 | cancellation does not reach sealing, minting or the placement engine | closed in part | B20-B4 | `5d97728` | none | the placement half closed; the rest recorded |
| D20-35 | three route matrices were regenerated by convention only | closed | B20-B2 | `0e80b30` | none | - |
| D20-36 | no environment-scoped, project-bound principal for a stdio process | open | - | - | none | deferred under OD-47 |
| D21-1 | no orchestration contracts: request, result, proposed action, tool request | closed | B21-A | `4b6d0e2` | none | - |
| D21-2 | no provider-neutral evidence reference shape | closed | B21-A | `4b6d0e2` | none | - |
| D21-3 | no durable record of plans, results, decisions and calls | closed in part | B21-A, B21-E2 (2/2) | `b4a0ec5` | none | the per-task trace record by E2; the rest by A |
| D21-4 | no bounded scheduler and no route-level idempotency | closed | B21-B, B21-E3 | `fafc90e` | none | a message sent again without its key is a new run (recorded) |
| D21-5 | no task-complexity router | closed | B21-B | `b3d168b` | none | - |
| D21-6 | no DAG caps | closed | B21-B | `b3d168b` | none | cost unpriced by decision (OD-107) |
| D21-7 | no role definitions | closed | B21-C | `5f1b498` | none | - |
| D21-8 | no least-privilege tool subset per role | closed | B21-C | `5f1b498` | none | the approver's-role gap below the executor stays unreached by construction |
| D21-9 | a new descriptor would move the reviewed exposure pins | closed as recorded | B21-C | `5f1b498` | none | the pin-move rule; B21 added no descriptor |
| D21-10 | no merge of specialist results | closed | B21-D, B21-D2 | `d5d3f05` | none | a disagreement in prose is carried as unverified claims, never escalated |
| D21-11 | provider and model identity not carried uniformly | closed | B21-D, B21-E2 (2/2) | `b4a0ec5` | none | - |
| D21-12 | no dissent record and no trace of pre-invocation refusals | closed in part | B21-D, B21-E2 (2/2) | `b4a0ec5` | none | open as its addendum states |
| D21-13 | sealed artifacts not wrapped for the merge | closed | B21-D | `21ae845` | none | the candidate's own base is D21-34 |
| D21-14 | no detection of a topology contradiction | closed as recorded | B21-D, B21-D2 | `d5d3f05` | none | no ERC exists; two sealed conflicting Tier 1 edits escalate |
| D21-15 | no detection of contradictory readiness claims | closed in part | B21-D | `21ae845` | none | another role's readiness prose is not detected |
| D21-16 | no detection of a contradictory part choice | closed | B21-D, B21-D3, B21-E3 | `fafc90e` | none | a part named only in prose is not detected |
| D21-17 | no rejection of stale results | closed | B21-B, B21-D, B21-E3 | `fafc90e` | none | a commit landing during one request's DAG is not seen by that request |
| D21-18 | no provider failure policy for specialists | closed | B21-E1, B21-E4 | `d03f182` | none | what opens the breaker is D21-42's; the live 429 behaviour is LB-9's |
| D21-19 | no per-role provider routing | closed | B21-E1 | `deac588` | none | - |
| D21-20 | no strict result tool for specialists | closed in part | B21-E1 | `deac588` | none | as policy only; its live acceptance is LB-9's |
| D21-21 | no stop reasons for specialist runs | closed | B21-E1 | `deac588` | none | the coordinator's loop unchanged |
| D21-22 | no additive run events or status line | closed | B21-E2 | `b4a0ec5` | none | provider streaming has no production caller |
| D21-23 | no offline evaluation of the twelve runbook cases | closed | B21-F | `513d69a` | none | - |
| D21-24 | no replay capsules for orchestration | closed | B21-F | `513d69a` | none | four cases proven through the POST, not as capsules |
| D21-25 | no live evaluation with real models | BLOCKED-LIVE-QUALIFICATION (LB-9) | B21-A, B21-F | `513d69a` | none | the record-only command, never run (OD-125) |
| D21-26 | CI admitted no b21 suite | closed | B21-A | `4b6d0e2` | none | - |
| D21-27 | standing statements describe the chat as one loop alone | closed | B21 closeout (1/2) | `6cff540` | `b21-closeout-statements` | - |
| D21-28 | the orchestration record has no outbox effect | closed as recorded | B21-A | `4b6d0e2` | none | - |
| D21-29 | two record questions left open | closed as recorded | B21-A | `4b6d0e2` | none | OD-118; B21's UNKNOWNs 3 and 4 |
| D21-30 | no browser proof of the flag-on chat | closed | B21-F, B21-F2 | `3cd7e0a` | none | - |
| D21-31 | a role table question for the owner | closed as recorded | B21-C | `5f1b498` | none | OD-123 |
| D21-32 | an embedding constant pulls the SDK chain into the schema's closure | open | - | - | none | a follow-up outside B21 |
| D21-33 | the scheduler takes the loop by injection | closed as recorded | B21-B | `b3d168b` | none | no follow-up |
| D21-34 | a layout candidate's own base is not bound | open | - | - | none | a follow-up outside B21 (a v2 candidate) |
| D21-35 | the readiness verifier is injected, not moved | closed as recorded | B21-D | `21ae845` | none | an optional follow-up outside B21 |
| D21-36 | a retired envelope had no production caller | closed | B21 closeout (1/2) | `6cff540` | `b21-closeout-statements` | the other exports recorded, none retired (31 rows since B24-Fa) |
| D21-37 | a contradicted loser beside a presented winner | closed | B21-D3 | `a4aba95` | none | OD-122's open question |
| D21-38 | a part-kind swap naming only an MPN stays one turn | closed | B21-E4 | `d03f182` | none | recorded |
| D21-39 | the coordinator's first turn is not gated | closed | B21-E4 | `d03f182` | none | gated, not metered (D21-42) |
| D21-40 | no browser clause for the evaluation | closed | B21-F | `513d69a` | none | - |
| D21-41 | the coordinator trace's task ids are redacted | closed | B21-E2 (2/2) | `b4a0ec5` | none | option A is the owner's |
| D21-42 | what opens the provider breaker for the DAG | open | - | - | none | the owner's OD-115 option |
| D21-43 | the flag-on browser run needs its own config | closed | B21-F2 | `3cd7e0a` | none | its remainder closed as D21-45 |
| D21-44 | the merge does not record an evidence gap | closed | B21-F3 | `9d2014a` | none | what the coordinator says of the gap is model judgement |
| D21-45 | no browser proof of rejection and resume | closed | B21-F2b | `d8680ea` | none | - |
| D21-46 | the merge's view does not name the stored records | closed | B21-D4 | `b52a26a` | none | - |
| D21-47 | a Cancel is not recorded on the resume record | open | - | - | none | a later product increment |
| D21-48 | the merged envelope's header states the proposal bound per specialist | open | - | - | none | a later increment (model-facing text) |
| D22-1 | no measurable isolation boundary can be qualified on this host | BLOCKED-LIVE-QUALIFICATION (LB-10) | B22-A2 | `c037627` | `b22-a2-blocked-runner` | the production runner stays blocked (OD-134) |
| D22-2 | no immutable runtime profile binds an executable | closed in part | B22-A2, B22-A3 | `e483838` | `b22-a3-diagnostic-runner` | kicad-cli and FreeRouting profiles are not digest-checked; the OCI half is LB-10's |
| D22-3 | the SPICE deck path admitted caller and model text as live deck lines | closed | SEC-1 | `d0d2ec8` | none | end-to-end exploitation through a live run is recorded, not measured |
| D22-4 | the model screen let reads outside the run directory through | closed in part | B22-A1, B22-C, B22-A3 | `a269e7a` | none | two deck screens remain (D22-4 in part) |
| D22-5 | spawns inherited the server environment | closed in part | SEC-1, B22-A1, B22-A3 | `e483838` | none | reopened under OD-156: the win32 child's environment |
| D22-6 | the CD-10 routes trusted a provider, environment and manifest from the body | closed in part | B22-C | `a269e7a` | `b22-c-authority` | execute still takes its lowering manifest from the body, behind the 409 |
| D22-7 | the Studio job store dropped completed results | closed | B22-C | `a269e7a` | `b22-c-job-store-terminal` | the Studio record is still marked cancelled at the request |
| D22-8 | output and temporary files were not bounded or separated | closed in part | B22-A1, B22-A3, B22-D | `c9fbbb0` | none | the live adversarial run's class 4 was not contained |
| D22-9 | kill reached the direct child only and cancellation ran before exit | closed | B22-A3, B24-D2 | `3773c6a` | `b24-d2-process-cleanup` | the live orphan runs are LB-3's and LB-17's |
| D22-10 | the raw output parsers lost values silently | closed | B22-C, B22-D | `c9fbbb0` | none | - |
| D22-11 | locale, timezone, randomness and thread count were uncontrolled | closed in part | B22-A2, B22-A3 | `e483838` | none | controlled for the diagnostic ngspice runs only |
| D22-12 | no server-held, digest-bound simulation evidence | closed in part | B22-C | `a269e7a` | none | no route binds a repository (OD-141) |
| D22-13 | evidence identities were not collision-resistant | closed | B22-C | `a269e7a` | none | - |
| D22-14 | records and UI overstated diagnostic subprocess output | closed | B22-C, B22 closeout (1/2) | `85439e7` | `b22-closeout-statements` | - |
| D22-15 | no named computation and no vocabulary for one | closed | B22-B | `b4c7be7` | `b22-b-catalog` | off in production chat until the owner opts in (OD-158) |
| D22-16 | B22's tools would move lexical pins; three titles were stale | closed | B22-B, B22 closeout (1/2) | `85439e7` | `b22-closeout-statements` | - |
| D22-17 | in-process engines could not be stopped at their budget | closed in part | B22-B | `b4c7be7` | `b22-b-bounded-host` | the placement engine has no worker entry; B24-A3 bounds the anonymous preview's work (D24-8) |
| D22-18 | the external-process census was wrong for three routes | closed | B22-A2 | `c037627` | `b22-a2-process-census` | - |
| D22-19 | CD-10 authority has no execution path and no corpus | closed in part | B22-C | `a269e7a` | none | the authoritative path waits for LB-10 |
| D22-20 | no adversarial test touched a real process | closed | B22-D | `c9fbbb0` | `b22-d-adversarial` | the live run recorded class 4 NOT CONTAINED, diagnostic only |
| D22-21 | the SPICE AI cited browser-supplied run records as evidence | closed | B22-C | `a269e7a` | none | labelled caller-supplied until D22-12's binding |
| D22-22 | the design the reserved OD numbers wait for is absent | closed as recorded | B22-B | `b4c7be7` | none | OD-83..OD-86 and OD-88 stay unspent |
| D22-23 | no live-blocker row named the blocked runner | closed | B22-A2 | `c037627` | none | LB-10 recorded |
| D22-24 | CI admitted no b22 suite | closed | B22-A1 | `50fe156` | none | - |
| D23-1 | no reviewed descriptor for any manufacturer or quote service | closed | B23-A1 | `79fa18b` | `b23-a-provider-registry` | every provider fact is a 2026-10-01 summary (OD-181 (a)) |
| D23-2 | neither descriptor shape could express the B23-A fields | closed in part | B23-A1 | `79fa18b` | `b23-a-provider-registry` | closed as a shape; most values are UNKNOWN |
| D23-3 | the egress boundary could not send an upload | closed | B23-B2 | `0cd3f59` | `b23-b-bounded-upload` | the rebinding window stays OD-51's limit |
| D23-4 | no outbound idempotency and no ambiguous-outcome state | closed | B23-B2, B23-C | `4e71563` | `b23-b-exchange-ledger` | - |
| D23-5 | no receipt, quote or staleness store | closed | B23-B2, B23-B3 | `8bca09e` | `b23-b-stale-quote` | no live observation exists (LB-11) |
| D23-6 | nothing presented exactly which files and fields would leave | closed | B23-B1 | `0c78e93` | none | a stated deviation: identifiers inside the board's file-safe name, disclosed |
| D23-7 | no per-request approval naming a provider and purpose | closed | B23-B1 | `0c78e93` | `b23-b-revalidation` | - |
| D23-8 | the Tier 3 floor saw a file-sending tool only by a word in its id | closed | B23-A2 | `da36d51` | `b23-a-tier3-vocabulary` | the claims check does not follow the prefix withdrawal (OD-182 (c)) |
| D23-9 | the route vocabulary could not mark a transfer or spend route | closed | B23-A2, B23-B1 | `0c78e93` | `b23-a-route-vocabulary` | - |
| D23-10 | ordering was absent rather than visibly disabled | closed | B23-C | `4e71563` | `b23-c-ordering-disabled` | LB-12 |
| D23-11 | nothing existed for an enabled ordering path | closed | B23-C | `4e71563` | `b23-c-order-contract` | offline only, with no production caller (LB-12) |
| D23-12 | the no-order tripwire matched names only | closed | B23-A2 | `da36d51` | `b23-a-no-order-structural` | a neutrally named function is seen only through the classification |
| D23-13 | no server-owned definition of physical evidence | closed | B23-D | `dfd51e3` | `b23-d-physical-evidence-contract` | offline: no record exists and nothing creates one (LB-5) |
| D23-14 | latent library paths could advance a hardware claim | closed | B23-D | `dfd51e3` | `b23-d-latent-claim-paths` | not rewired; the hardening list stands before any caller |
| D23-15 | the assembled-release block was pinned only generically | closed | B23-D | `dfd51e3` | `b23-d-assembled-release-blocked` | LB-5 |
| D23-16 | two documents claimed a quote-tool answer no record supports | closed | B23 closeout (1/2) | `b6c6b0d` | `b23-closeout-statements` | the claim vocabulary is finite (19 forms) |
| D23-17 | the current flag compared the authority by revision only | closed | B23-B3 | `8bca09e` | `b23-b-stale-quote` | - |
| D23-18 | only the JLCPCB two-layer bare-board profile can produce a release | closed as recorded | B23-A1 | `79fa18b` | none | the scope limit stands |
| D23-19 | no live-blocker row for live DFM/quote or an ordering sandbox | closed | B23-A1 | `79fa18b` | none | LB-11 and LB-12 recorded |
| D23-20 | CI admitted no b23 suite | closed | B23-A1, B23-B2 | `0cd3f59` | `b19-e-ci-job-scope` | - |
| D23-21 | four CD-12 throwing stubs were pinned by no test | closed | B23-A2 | `da36d51` | `b23-a-cd12-stubs` | - |
| D24-1 | two runtime states only, and CI never built the production one | closed | B24-A1 | `1b2c08c` | `b24-a1-environment-profile` | hosted staging and production are LB-13's |
| D24-2 | no supported rollback | closed | B24-A4 | `72c1376` | `b24-a4-rollback` | offline on PGlite; the real platform is LB-14's |
| D24-3 | one all-powerful database role and row security on one table | closed in part | B24-A4 | `72c1376` | `b24-a4-rls-default-deny` | row security closed offline on PGlite; the server's owning role is unchanged and still bypasses it, and the application role is recorded, not applied (OD-192); the real roles and Data API exposure are LB-14's |
| D24-4 | single-valued secrets, no rotation window, no CI scan | closed | B24-A2 | `b3b6b05` | `b24-a2-secret-rotation` | - |
| D24-5 | the only security header was an image source policy | closed | B24-A2 | `b3b6b05` | `b24-a2-headers` | the served headers of a hosted deployment are LB-13's |
| D24-6 | the Supabase side of the origin allowlist was unrecorded | closed as recorded | B24-A2 | `b3b6b05` | `b24-a2-origin-allowlist` | verified only in staging (LB-1, LB-13) |
| D24-7 | no backup, restore, recovery, failover or reconnect evidence | closed | B24-A4 | `72c1376` | `b24-a4-restore` | offline on PGlite; PITR and failover are LB-14's |
| D24-8 | anonymous callers could spend provider credit and block the server | closed | B24-A3 | `3cd7d6e` | `b24-a3-abuse-limits` | per-process windows (OD-197) |
| D24-9 | no health or readiness check | closed | B24-A1 | `1b2c08c` | `b24-a1-readiness` | staging dependency health is LB-13's |
| D24-10 | provider and model configuration was unversioned | closed | B24-A1 | `1b2c08c` | `b24-a1-configuration` | - |
| D24-11 | no sandbox kill switch and no flag inventory | closed | B24-A1 | `1b2c08c` | `b24-a1-flags` | - |
| D24-12 | opt-in tests could reach real data | closed | B24-A4 | `72c1376` | `b24-a4-test-isolation` | - |
| D24-13 | no retention or deletion policy for traces and audit records | closed | B24-C2 | `600d1ba` | `b24-c2-retention` | never run against a live database |
| D24-14 | no versioned golden catalog and no six-class taxonomy | closed | B24-B1 | `b0af256` | `b24-b1-catalog` | the deterministic offline class is failing on D24-42 |
| D24-15 | evaluation and map-pinning suites ran in no CI job | closed | B24-B2 | `4738aa3` | `b24-b2-ci-admission` | - |
| D24-16 | three runbook areas had no evaluation | closed | B24-B2 | `4738aa3` | `b24-b2-power-ground` | one recorded counterexample, D24-42 |
| D24-17 | no map of the twenty required scenarios | closed | B24-B3 | `a405db9` | `b24-b3-scenario-map` | several scenarios stand in part or by deviation (OD-206) |
| D24-18 | the model-in-loop class had one never-run command and no money bound | closed | B24-B3 | `a405db9` | `b24-b3-model-in-loop` | offline only; live runs are LB-2's, LB-7's and LB-9's |
| D24-19 | opt-in live suites could report green without the resource | closed | B24-B3 | `a405db9` | `b24-b3-live-suite-honesty` | - |
| D24-20 | the coordinator's run trace was built and thrown away | closed | B24-C1 | `4ec18eb` | `b24-c1-durable-trace` | offline; no live database |
| D24-21 | 22 model-calling paths left no durable usage record | closed | B24-C1 | `4ec18eb` | `b24-c1-llm-call-record` | offline; no live database |
| D24-22 | a trace could not say who asked or what the user saw | closed | B24-C2 | `600d1ba` | `b24-c2-attribution` | - |
| D24-23 | cost, budgets and step latency were recorded nowhere | closed | B24-C2 | `600d1ba` | `b24-c2-cost` | unpriced until the owner supplies a price table |
| D24-24 | Tier 2 approvals are recorded in the browser only | closed as recorded | B24-C3 | `ba4f562` | `b24-c3-recorded-limits` | nothing built (OD-210) |
| D24-25 | three stores kept text without the redaction authority | closed | B24-C2 | `600d1ba` | `b24-c2-redaction` | - |
| D24-26 | stored traces had no reader and no export | closed | B24-C3 | `ba4f562` | `b24-c3-trace-read` | the access audit stays deferred (OD-211) |
| D24-27 | no latency was measured or gated | closed | B24-D1 | `3d5f225` | `b24-d1-latency-policy` | the runner baseline is recorded BLOCKED (`baseline_missing`, OD-212) |
| D24-28 | fragile real-clock thresholds gated CI | closed | B24-D1 | `3d5f225` | `b24-d1-threshold-census` | - |
| D24-29 | memory was never measured and a routed board could not be read whole | closed in part | B24-D2 | `3773c6a` | `b24-d2-board-read` | D24-43 leaves the paged read unusable by a strict-mode provider |
| D24-30 | multi-tab and crash recovery were proven in-process only | closed | B24-D2, B24-D4 | `6e4e1bb` | `b24-d2-working-copy` | OD-214's open item: a committing tab stalled past the window |
| D24-31 | FreeRouting and kicad-cli kills reached the direct child only | closed | B24-D2 | `3773c6a` | `b24-d2-process-cleanup` | the live orphan runs are LB-3's and LB-17's |
| D24-32 | accessibility and responsive behaviour were untested | closed | B24-D3, B24-D4 | `6e4e1bb` | `b24-d3-accessible-names` | desktop only (OD-215); the Tab trap measured on one card |
| D24-33 | the live-blocker register was not in one vocabulary | closed | B24-E | - | `b24-e-register` | - |
| D24-34 | no browser spec runs in production auth | BLOCKED-LIVE-QUALIFICATION (LB-1, LB-13) | B24-E | - | `b24-e-production-auth-config` | the harness is written offline; the run needs an isolated project (OD-191) |
| D24-35 | nothing can record fabrication or test evidence | BLOCKED-LIVE-QUALIFICATION (LB-5) | B24-E | - | `b24-e-register` | nothing built (OD-218) |
| D24-36 | the deterministic 555 release is time-bound | closed as recorded | B24-E | - | `b24-e-register` | valid through 2027-09-09 (OD-219) |
| D24-37 | no generator joins the coverage, permission and agent maps; no generator inventory | closed | B24-Fa | - | `b24-f-maps` | the regenerate-all and drift command recorded, not built (OD-220) |
| D24-38 | the hand-written current-system, permission and database pages are stale | closed | B24-Fa, B24-closeout | - | `b24-f-maps` | [B24-closeout, 2026-10-10] re-read at commit 2/2: closed in part (B24-Fa) until closeout 1/2 noted the stale lines; every row of the superseded-statement table is handled since (`b24-f-registers` 7, 8 and 10) - 142 noted, 39 noted nearby, 12 rewritten, 8 never noted in place, and 5 not noted with the reason in place, their own sources calling the line still true or unchanged |
| D24-39 | no threat-model closure register exists | closed in part | B24-F | `7ce1236` | `b24-f-registers` | the register is written; its states are re-read at the closeout [B24-closeout, 2026-10-10] commit 2/2 re-read D24-38 (closed) and the twelve open rows (section 6, unchanged); the other rows stand as recorded at `58c0834`; [B24-closeout review, 2026-10-11] B24-Fb's half, in B24-F's commit (section 4: the closing increment and commit written in place for `this commit (B24-Fb)`) |
| D24-40 | the program's own records would not support the final report | closed in part | B24-F | `7ce1236` | `b24-f-registers` | OD-5/OD-19 and the integrity measurements are the closeout's [B24-closeout, 2026-10-10] both done: OD-5 and OD-19 at commit 1/2, the three integrity lines answered at commit 2/2 (`final-verdict.md` section 5.3); in part still: no CI eslint step until `5dfae2b` merges, and the corrective branches unmerged (OD-221); [B24-closeout review, 2026-10-11] B24-Fb's half, in B24-F's commit (section 4) |
| D24-41 | the benchmark corpus had no executor for CD-9 | closed | B24-D1 | `3d5f225` | `b24-b2-corpus-nightly` | the nightly job's run is not recorded |
| D24-42 | a delete removes a whole wire that also joins surviving pins | open | - | - | `b24-b2-power-ground` | the owner's decision (OD-229, proposed) |
| D24-43 | a strict-mode provider cannot call a read whose optional arguments it leaves unset | open | - | - | `b24-d2-board-read` | proposed fix OD-236 |

## 6. What stays open (INFERRED)

- The states are each chapter's record re-read at `58c0834`; this page re-ran no closing suite. A record that a later increment made
  stale is named in its residual only where B24 closed the remainder (D22-9 by B24-D2) or narrowed it (D22-17 by B24-A3).
- The open rows are the ones their records leave open: F18-3, D20-7, D20-8, D20-25, D20-36, D21-32, D21-34, D21-42, D21-47, D21-48,
  D24-42 and D24-43. The closeout re-reads them at the final SHA. [B24-closeout, 2026-10-10] Re-read at commit 2/2: each stays open at
  `26dc8b8`. After `58c0834` no production line changed but four comment notes, and one generator was added
  (`scripts/generate-b24-maps.ts`; `git diff --name-status 58c0834 26dc8b8`, read-only), so no closing change landed; D24-42 and D24-43
  wait for OD-229 and OD-236 (proposed).
- D24-3 is closed in part although its closure clause reads "closed offline": OD-192 applies the row-security half and keeps the
  application role PROPOSED (`artifacts/remaining-builder-program/OWNER_DECISIONS.md:2733`), so the defect's role half stands offline
  too (the review round, 2026-10-10; `b24-f-registers` 2 pins the row).
