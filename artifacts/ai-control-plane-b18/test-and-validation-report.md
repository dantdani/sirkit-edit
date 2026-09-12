# B18 — test and validation report

Labels: **CONFIRMED** (executed and measured), **INFERRED** (code reading), **RECORDED** (written down without a claim),
**UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION**.

Every number here was produced on the final tree of `chapter/b18-agent-execution`, not remembered from an increment.

## 1. Runs

| run | scope | result |
|---|---|---|
| broad unit/integration | the agent, chat and agent routes, execution grants, engineering, project, auth, API tripwires, PCB proposal/repair/ai, the fixture runtime, the recovery pipeline and the PCB/chat components | **268 files, 3439 passed, 10 skipped** — CONFIRMED |
| browser (Playwright, real Chromium, fixture runtime) | `e2e/agent-execution.spec.ts` | **29/29 passed, 11.1 min** — CONFIRMED |
| typecheck | `tsc --noEmit` on the whole tree | 0 errors — CONFIRMED |
| lint | `eslint` on every file this chapter changed | clean (`app/page.tsx` carries 14 pre-existing `react-hooks/refs` findings, unchanged in count by B18) — CONFIRMED |
| generators | all seven (agent artifacts, tool registry, B11 evaluation, action toolability, read invocation, B10 availability, B17 control inventory) | idempotent: **zero drift** on the final tree — CONFIRMED |
| ratchets | `b16-1c-invariant-tripwires` (158 routes = 155 + 3 + 0), `b17-f-agent-exposure` | pass — CONFIRMED |

The 10 skips are the pre-existing live-Supabase matrix (LB-1), skipped by design without their marker.

## 2. What the browser suite covers

29 cases against the REAL application under the fixture runtime and the scripted agent: the eight mandatory scenarios
(§7 of `scenarios.md`), the chat execution UX (entries, labels, notes, Stop, Undo-in-chat, the history hold, autonomy),
and the tamper cases (a grant altered in transit, a forged handle, a stale base, altered operations past the receiver, a
forged Tier 3 name, a nested delegation). 20 evidence screenshots are committed under `evidence/`.

## 3. The closing adversarial pass

Before any verdict, six verifiers (workflow `wf_d1783a33-a63`) were each given ONE load-bearing B18 claim and told to
refute it from the source. Three could not, and named the mechanisms that stopped them:

- **Tier 3 is inaccessible.** Nine routes were tried (a renamed descriptor, a lifted grant family, a nested delegation, a
  view command, a proposal that compiles into a Tier 3 operation, an HTTP route with the run's actor, three injectable
  test seams, and the older PCB AI surface). Each dead-ends on an independently enforced mechanism: the registry
  constructor throws on an agent-exposed release-class descriptor; the gateway's class dispatch refuses anything that is
  not read / view-session / propose / reviewed-granted-mutate; a grant must name a canonical command inside a closed
  eight-family list and the minter hardcodes tier 1; provider names resolve only against the run's own toolset; and
  `/api/pcb/qualify` and `/api/pcb/release` refuse a non-human actor before any durable read — while nothing under
  `app/lib/agent` makes an HTTP call at all.
- **Tier 2 stays human-only.** No auto-apply, no default, no page effect, no recovery path and no tool applies a sealed
  proposal or a layout candidate.
- **The exposure set is exactly the reviewed list**, with the one correction recorded below.

Three refuted something. All three are acted on, not argued with.

## 4. What the adversarial pass found, and what was done

| # | finding | action |
|---|---|---|
| V-1 | The chat's "nothing was changed" label keyed on the model having written prose BESIDE the tool call. A model that writes nothing there and simply answers "Done." after a refused or failed call reached the user unlabelled — and that answer became the next run's history. | **FIXED.** The label now triggers on what the run did: it ended, prepared nothing, and had a failed attempt. The regression in `b18-e-claimed-nothing.test.ts` fails on the pre-fix rule. |
| V-2 | The same label fired on innocent runs: a question answered from a successful read, with a preamble, was told "nothing was changed". | **FIXED** by the same rule (an attempt that failed, not the presence of prose), with its own pin. |
| V-3 | A landed granted execution could be settled NOT COMMITTED, permanently: reopening the editor's lineage replaces the canonical transaction log wholesale, so after a crash that lost the journal's commit record the sweep read absence of evidence as evidence of absence. | **FIXED.** The evidence answer now names the lineage it can speak for, and the sweep says it cannot tell rather than asserting a change did not happen. `b18-e-lost-settlement.test.ts` fails on the pre-fix code in both cases. |
| V-4 | The resolved-execution counter was stream-derived without a bound: more settlements than grants could resolve one still in flight and suppress the "written before the outcome" label. | **FIXED** (clamped to what was issued), with a pin. Full per-grant identity in the reducer remains future work. |
| V-5 | Two rows of the closeout table overstated the browser's reach (the runbook's exact move sentence on the explicit path; 7a's binding invariant). | **CORRECTED** in §7 of `scenarios.md`, and the via row's browser case strengthened to assert the read's own run-log line. |
| V-6 | `pcb.dimension` was re-tiered from topology-or-geometry to reversible during B18. | **RECORDED** in `unknowns-and-owner-decisions.md` §3: a deliberate OD-13/OD-11 decision the runbook's PCB Tier 1 list called for, not a silent relaxation. |
| V-7 | Five further observations with no live path (a journal eviction bound, an adopted-revision fallback, a missing import gate, name-pattern enforcement, the older PCB AI surface). | **RECORDED** as F18-1 to F18-5 with evidence. |

One more was found by CI rather than by a verifier: the browser spec kept its own COPY of the label sentence, so
rewording the source left the e2e asserting a string the product no longer says. The spec now imports the constant.

## 5. Defects found by proving the scenarios (B18-E)

Three product defects, each fixed with a regression that fails on the pre-fix code:

1. **A run could claim a change and leave nothing contradicting it** (E9) — the page now says "nothing was changed" in
   its own words, from counters the stream cannot forge.
2. **Scenario 3 was unreachable in the real application** (E11): the only board read exceeds the model's
   60,000-character result budget on the browser journey's board, so the model received `output_too_large_for_model` and
   could plan nothing. The bounded mechanical read exists because of it.
3. **A sealed component replacement could never be applied on any project with more than one bound component** (E16):
   the seal and the apply load different breadths of component authority, and the whole record set was sealed into the
   digest the operation carries. Found by running scenario 4 in the browser; single-record fixtures on both sides had
   hidden it from every unit test.

Two further truthfulness defects were fixed where the human reads them: a Tier 2 review that never showed the geometry it
was asking approval for (E12), and a refused apply that produced a transient toast and no chat line at all (E15).

## 6. Environment notes (RECORDED)

The browser suite runs in 4.4 to 11.3 minutes when the host has free memory. While E18 was being verified this machine
reached 34.1 GB committed of a 36.5 GB limit with about 0 GB free physical, and the suite became unreliable — 15.7
minutes instead of 4.4 with a failure in its first test, a 300 s timeout in the Undo/Redo-wait case, and once no fixture
banner at all. No product change lies between those runs and the green ones; CI runs the suite on a clean runner and is
the authority for the whole-suite result.
