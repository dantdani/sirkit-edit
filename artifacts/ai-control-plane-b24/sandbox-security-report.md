# B24-F - Sandbox security report

Labels: **CONFIRMED** (read at the cited file:line at `58c0834`, or executed and measured), **INFERRED** (a reading, nothing executed),
**RECORDED** (taken from a record without a claim of our own), **UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION** (needs a live resource the
owner has not supplied; never faked, never claimed). Base: `58c0834`. Written from B22's verdict and adversarial matrix, B24-A1's and
B24-D2's records, and E's matrix row Q4.

## 1. B22's verdict: PARTIAL; production BLOCKED (**RECORDED**)

B22's verdict is PARTIAL (`artifacts/ai-control-plane-b22/final-verdict.md:3`): no measurable isolation boundary can be qualified on any
platform the program controls, so the production simulation runner stays BLOCKED (`artifacts/ai-control-plane-b22/final-verdict.md:17`;
LB-10, OD-134). `executeAuthoritativeSimulation` throws `CD10_AUTHORITATIVE_RUNNER_BLOCKED_NO_VALIDATED_SANDBOX`
(`app/lib/model-simulation/safe-execution.ts:28`), and the CD-10 execute route refuses every request (403, 400 or 409) before its kept
501 text (`b22-a2-blocked-runner`, `b22-c-authority`). **CONFIRMED** at `58c0834`.

## 2. What runs: a diagnostic-only local runner

The diagnostic runner (`app/lib/computation/diagnostic-runner.ts`) starts the one ngspice process, from the digest-pinned install, with
limits the runner enforces itself (a wall clock, bounded output channels, a per-run directory removed afterwards, a whole-tree kill); no
OS limit bounds it on this Windows host (OD-145). Its results are diagnostic evidence, never authority (B22-C). It is not a boundary
against a process of the server user (B22's residuals, `artifacts/ai-control-plane-b22/adversarial-matrix.md:174`). B24-A1 adds an
off-only operator switch, `SIRKIT_DIAGNOSTIC_RUNNER_DISABLED` (`b24-a1-flags`).

## 3. The live adversarial run: class 4 NOT CONTAINED (**RECORDED**, a failing result)

On 2026-10-02 the lead ran `b22-d-adversarial-live` once on the diagnostic runner: 12 of 13 passed, and case 4 (symlink and hardlink
tricks) failed, class 4 NOT CONTAINED - a hardlink planted between the deck write and the spawn was refused by the runner on read, but
ngspice wrote through it (`artifacts/ai-control-plane-b22/adversarial-matrix.md:327`, `:335`). E's matrix records the run `failing` in
Q4's recorded runs (`artifacts/ai-control-plane-b24/qualification-matrix.md:209`); Q4's State stays BLOCKED-LIVE-QUALIFICATION (LB-10,
LB-3, LB-8), and B24-F renders sandbox readiness NOT READY (the sandbox rule, lead decision D4; `final-verdict.md` section 1).

## 4. FreeRouting and kicad-cli: the tree kill since B24-D2 (**CONFIRMED** offline)

B22 left both with a direct-child kill that settled before the child's exit (`artifacts/ai-control-plane-b22/final-verdict.md:100`).
B24-D2 gives both the whole-tree kill and the confirm wait (`app/lib/pcb/process-tree.ts`; OD-145's method), a kill whose exit was not
observed reported in the route attempt's evidence (`b24-d2-process-cleanup`); its dated note stands on B22's line. The live orphan
checks stay BLOCKED-LIVE-QUALIFICATION (LB-3, LB-17).

## 5. The first `next build` (B24-A1, **RECORDED**)

B22 ran no `next build` and left how it serves the engine worker open (`artifacts/ai-control-plane-b22/final-verdict.md:110`); its
production BLOCKED stays until the owner names a production host (`:124`). B24-A1 recorded the first: the lead's local production-mode
run (`next build` 234 s, `engine-worker.mjs` emitted as a hashed asset; `artifacts/ai-control-plane-b24/environments-and-deployment.md:197`)
and CI's `production-smoke` job; no production host is named (OD-190, LB-13).

## 6. Sandbox readiness

NOT READY: class 4 NOT CONTAINED on the diagnostic runner's recorded live run; production BLOCKED-LIVE-QUALIFICATION (LB-10, LB-3, LB-8);
a diagnostic-only runner. The unblocking resource is a qualified OCI engine and the owner-approved B22-A4, then a named production host
(OD-134, OD-147, OD-190).

## 7. What stays open (INFERRED)

- The reach of `taskkill /T` to a real descendant stays INFERRED for anything but a node process tree.
- `/api/simulate`'s own deck screen beside the Studio's, and the fab archive reader that inflates an entry before its total check
  (B22's residuals).
