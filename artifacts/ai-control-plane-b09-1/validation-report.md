# B09.1 — Validation Report (2026-08-08)

| gate | result |
|---|---|
| ESLint `--max-warnings 0` over PcbEditor.tsx, editor-runtime.ts, app/lib/agent/** (incl. all B09/B09.1 tests), /api/chat/route.ts, schematic-proposals.ts, schematic-session.ts, tool-provider-adapters.ts, tool-catalog.ts, ai-preferences.ts, generate-agent-artifacts.ts, and every changed b04/b05/b05.1/b06/b06.1/b07.5 test | **exit 0 — zero errors, zero warnings** |
| app/page.tsx | exactly the pre-existing accepted baseline: 14 errors / 0 warnings (react-hooks compiler family; none in B09.1-touched regions) |
| `npx tsc --noEmit` | **clean** |
| B09 suites (provider contracts 9, loop safety 11, proposals 6) | **26 passed** (updated to v2/provider contracts) |
| NEW B09.1 suites (b09-1-boundary 21, b09-1-recovery 4) | **25 passed** |
| B04–B08.3 regression gate (`b07 b04-tool-registry b08 b06`) | **316 passed** (incl. async ownership, proposal authority, canonical schematic/PCB, owned PCB sync) |
| Combined B04+B05+B06+B07+B08+agent sweep | **421 passed** |
| LLM error/router/provider + build-loop suites | **10 passed** |
| Artifact generators (B04 registry+parity, B05/B05.1 read invocation, B09 agent manifests) | regenerated; byte-consistency tests green inside the gates above |
| Full suite | **2110 passed / 20 skipped / 2 failed** — both TIMING-ONLY perf targets under full parallel load (auto-place 30-footprint <500 ms; route-tool 500-track preview), rerun in isolation: **8/8 and 25/25 green**. No functional failure was relabeled. |

Exposed tool count: **8** (unchanged; pinned by the b04 exact-set
tripwire and the regenerated manifests).
