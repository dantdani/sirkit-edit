# B22 — Sandboxed engineering computation and simulation (`chapter/b22-sandboxed-computation`)

Labels: **CONFIRMED** (executed and measured, or read at the cited file:line), **INFERRED** (code reading), **PROPOSED** (designed, not
exercised), **RECORDED** (written down without a claim), **UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION**.

Base: `d0d2ec8` (B21 merged normally in PR #11 as `e109d76`, verdict PARTIAL; SEC-1 merged normally in PR #12 as `d0d2ec8`). Mission (runbook
`:882-942`): named, bounded engineering computation without a general shell and without code or process execution bypassing project
authority; immutable runtime profiles; a measurable isolation boundary or, failing that, production authority kept BLOCKED with a
diagnostic-only runner that is never called authoritative.

| checkpoint | artifact | state |
|---|---|---|
| SEC-1 corrective security branch (D22-3; the ngspice half of D22-5) | `sec-1-spice-deck-injection.md`; code `app/lib/spice/netlist.ts`, `server/worker.ts`, `server/job-store.ts`, `app/api/spice/models/smoke-test/route.ts`; suite `app/lib/spice/__tests__/sec-1-deck-injection.test.ts` (268 cases) | CONFIRMED offline (test-first, three rounds; the final screen cut to ngspice-46's executing set from the lead's benign probes p0-p13); end-to-end exploitation INFERRED, never run; merged `d0d2ec8` (PR #12) |
| discovery | `discovery.md` (seven read-only readers, one synthesizer; D22-1..24, OD-134..OD-150; re-verified on the SEC-1 tree by eight verifiers, section 9) | RECORDED; production runner expected to stay BLOCKED (no OCI engine reachable on this host, LB-6) |
| B22-A1 security corrections SEC-1 left (D22-4's remainder; D22-5 kicad-cli's environment; D22-8 output caps for kicad-cli and FreeRouting; OD-150's approval half; OD-146 CI admission) | `deck-and-secret-corrections.md`; code `app/lib/computation/output-bounds.ts`, `app/lib/spice/models.ts`, `netlist.ts`, `ai-approval.ts`, `server/worker.ts`, `server/job-store.ts`, `app/api/spice/models/smoke-test/route.ts`, `app/api/spice/runs/[id]/bundle/route.ts`, `app/api/spice/ai/route.ts`, `app/components/spice/SpiceStudio.tsx`, `app/lib/pcb/fab/kicad-cli-runner.ts`, `build-bundle.ts`, `app/lib/pcb/autoroute/runner.ts`; suites `app/lib/computation/__tests__/b22-a1-*.test.ts` (six, 134 tests) | CONFIRMED offline (test-first: 64 red / 25 green of 89 on `0432fb8`; an adversarial review's 16 confirmed findings each reproduced first - 40 red of 393 on the first fix, nine deliberate breakages caught - then fixed; 134 green; every spawn faked, no process run; the installed ngspice-46 code models read, never run); the kicad-cli allowlist's adequacy and the ngspice card and token readings INFERRED; production authority still BLOCKED; [B22-A1 lead] the lead's non-ASCII continuation fix (probes p14-p22): 137 green |
