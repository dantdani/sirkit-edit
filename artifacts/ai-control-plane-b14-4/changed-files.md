# B14.4 — changed files

## Tests / gates (NO production runtime module was touched)

| file | change |
| --- | --- |
| `app/lib/project/__tests__/_import-gate-helpers.ts` | REWRITTEN: regex specifier extraction replaced by TypeScript AST inspection (ImportDeclaration, ExportDeclaration+specifier, ImportEqualsDeclaration, ImportTypeNode, dynamic `import()`, `require()`), bounded side-effect-free static string evaluation, opaque-load + root-escape + local-require surfacing, hardened canonical resolution (backslash/query/fragment canonicalization, extension strip, root-escape rejection, case-insensitive detection with exact-case approval), AST identifier gate for the factory name, the shared 8-extension WHOLE-ROOT production walker with two-tier exclusions (every-depth: node_modules/.next/.git/__tests__; root-only: artifacts/data/public/vendor — closing the adversarially proven components//root-file/route-segment blind spots), property-access + aliased loader-shape classification (require.resolve/require.context/import.meta.resolve; bare `require` references fail closed), leading-# subpath preservation, and a shared parsed-source cache. `moduleImportOffenders(files, modulePath, approved)` keeps its exact signature, so the B14.2/B14.3 suites gained the AST gate without modification of their assertions. |
| `app/lib/project/__tests__/b14-4-ast-import-gates.test.ts` | NEW — 22 permanent tests: real-tree cleanliness for all four targets over the WHOLE-ROOT scan; zero opaque/escaping/unpinned-require production state; soundness (harmless literals unflagged); R1–R4 tripwires; 17-form spelling battery (incl. windows-backslash, query/fragment suffix, explicit extension, mixed segments, case variant, type-only, import-equals, import-type, side-effect); per-extension battery (all 8); injected→removed→approved lifecycle; controller/intent batteries; opaque fail-closed; loader-shape battery (require.resolve/import.meta.resolve offenders, require.context/aliased/reflected `require` opaque, exempt file silent); leading-# preservation; bounded static-eval grammar; resolution unit proofs; factory identifier forms (incl. unicode-escaped identifiers); AST barrel check + poisoned-barrel tripwire; §6 scan-surface scratch-root fixtures (adversarial bypass locations enumerated + flagged end-to-end, exclusion tiers held, real-tree components//root coverage). |
| `app/lib/project/__tests__/b14-2-settlement-and-boundaries.test.ts` | test 15b given an explicit 60 s timeout (the whole-tree TypeScript parse exceeds the 5 s default on first run in a fresh worker). Assertions unchanged. |
| `app/lib/project/__tests__/b14-3-stream-lifecycle-and-gates.test.ts` | §E tests 17/18 given explicit 60 s timeouts. Assertions unchanged. |

## Artifacts

`artifacts/ai-control-plane-b14-4/` (8 documents, incl. the independent
adversarial-audit record) + supersession notes on
the B14.3 import-gate evidence (`capability-import-gates.md`,
`regression-evidence.md`, `final-verdict.md`), correcting the B14.3 claim
that the regex gate was "sound as well as complete".

## NOT changed (B14.3 runtime behavior preserved verbatim)

`bounded-stream.ts`, `replacement-authority/route.ts`,
`replacement-reauthorization.ts`, `replacement-approval-controller.internal.ts`,
`replacement-approval.internal.ts`, `approved-replacement-mutations.ts`,
`replacement-proposal-assembler.ts`, proposal/adoption/journal/history/
autosave/persistence/transition modules, provider adapters, tool catalog,
action registry — untouched. No dependency changes (the gate uses the
existing `typescript` devDependency), no provider configuration, no
secrets. All deterministic pins byte-identical
(`e66dd9e0…`/`f18e47e0…`/`72ad7c77…`/`5501d810…`); protected original
`C:\Users\robsa\sirkit` untouched (6-entry baseline verified).
