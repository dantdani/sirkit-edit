# B16.0.17.2 §G — Test & validation report

Zero credits, network, DB — fake SDK clients; the validation path is real.

## Complete suite — exit code 0

```
pnpm exec vitest run --reporter=dot --pool=forks --poolOptions.forks.maxForks=3 --poolOptions.forks.minForks=1
```

| | |
|---|---|
| Test files | **382 passed**, 3 skipped (385) |
| Tests | **4004 passed**, 20 skipped (4024) |
| Failed | **0** |
| Process exit code | **0** |

3991 (B16.0.17.1) + 10 schema-parity + 3 adapter-parity = 4004.

Note: the full-suite run started before a type-annotation-only fix to the
adapter test (untyped mock tuple → explicit typing after a first `tsc` pass
flagged it); the fix changes no runtime behavior, the file passed identically
in the run and standalone (3/3), and the final-source `tsc` is clean.

## Targeted batteries (this session's runs)

| Battery | Result |
|---|---|
| `b16-0-17-2-schema-parity` (NEW, data-driven, incl. live-mutation tripwire + no-hard-code scan) | **10 / 10** |
| `b16-0-17-2-adapter-schema-parity` (NEW, fake SDK clients) | **3 / 3** |
| B16.0.17.1 adversarial + corrected B16.0.17 parity + confinement gate + routes.test + schematic-compiler domain + llm providers + ratchet + adoption | **190 passed** (12 files combined) |

## Static gates

| Gate | Result |
|---|---|
| `tsc --noEmit` (final sources) | **0 errors** |
| Scoped ESLint (agent-tools + both new tests) | **0 problems** |
| `git diff --check` | clean |

## Generators ×2 + §F invariants

Byte-stable ×2; wrapper matrix `cd4aaee0…` and baseline `72cf7733…` both
**IDENTICAL to B16.0.17/17.1** — inventory 91 canonical / 3 factories / 59 raw,
baseline 62, tools exactly 12, prompt/routing/maxTokens/temperature and all
domain authorities unchanged, hashes and replay pins intact — all inside the
passing 4004.
