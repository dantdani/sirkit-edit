# B14.5 — changed files

## Production (ONE behaviour-preserving identifier rename)

| file | change |
| --- | --- |
| `app/lib/pcb/fab/validate-package.ts` | the local role helper `require` → `requireRole`, with only its four local call sites updated (lines 68–76, inside `requiredRoleIssues`). PROVEN identifier-only: mechanically reversing the rename reproduces the pre-edit file **byte-for-byte**. No signature, export, message string, error code, manifest field, digest, or control-flow change. `requiredRoleIssues` (the enclosing function) was untouched — the rename was word-boundary scoped. |

No other production module was modified. The B14.3 stream lifecycle, the
`/api/replacement-authority` route, the nonce/binding exchange, proposal
compilation, the approval controller, reauthorization, canonical mutation
execution, history/undo/autosave/persistence/transitions, exposed tools,
and provider adapters are all untouched.

## Gate and tests

| file | change |
| --- | --- |
| `app/lib/project/__tests__/_import-gate-helpers.ts` | the file-wide `declaresLocalRequire` EXEMPTION removed entirely; `require` classification is now unconditional; `collectRequireShadows()` collects declarations named `require` at any scope with positions; `localRequireDeclarations()` (an exemption list) replaced by `requireShadowDeclarations()` (a violation list of `{file, kind, line, character}` records, pinned at zero); NEW `sourceParseDiagnostics()` returning bounded `{file, code, message, line, character}` records; declaration NAMES are not double-counted as opaque loads. AFTER THE ADVERSARIAL AUDIT: loader-minting tracking (`createRequire` aliases incl. renamed imports/namespace members/factory chains, immediately-invoked mints, `Module._load`/`module.require` reflection, fail-closed unclassified `createRequire` references); explicit `node.jsDoc` traversal so JSDoc `import()` types are extracted; `ts.transpileModule({reportDiagnostics:true})` merged for the four JS-family extensions; widened shadow-kind inventory; and NAME-position identifiers (member/key/specifier names) excluded from the fail-closed identifier fallback. |
| `app/lib/project/__tests__/b14-5-lexical-require-and-diagnostics.test.ts` | NEW — 19 permanent tests (§1 six lexical-require tests incl. R1, the in-memory poisoned `validate-package.ts`, block-local, module-level, aliased/reflected fail-closed, and the real-tree zero-shadow pin; §2 five parse-diagnostic tests incl. all-8-extension malformed and valid fixtures, the whole-tree zero pin, and the bounds; §3 three preservation tests incl. harmless literals, all B14.4 import forms, and the byte-for-byte approved sets; §4 five audit-closure tests: createRequire in 8 spellings, JSDoc import types, JS-family TS-syntax diagnostics, name-position soundness, widened shadow kinds). |
| `app/lib/project/__tests__/b14-4-ast-import-gates.test.ts` | test 3 converted from "the exemption is PINNED to one file" to "the production tree contains ZERO `require` shadow declarations"; test 15b's helper assertion now proves the file contains no bare `require` identifier at all rather than that it is exempt, and its `module.require` case was STRENGTHENED from "fails closed as opaque" to "a static protected target is an OFFENDER; a non-static one is opaque". All other assertions unchanged. |

## Artifacts

`artifacts/ai-control-plane-b14-5/` (8 documents, incl. the independent
adversarial-audit record) + supersession notes
appended to the B14.4 evidence (`ast-import-gate-contract.md`,
`capability-boundary-matrix.md`, `regression-evidence.md`,
`final-verdict.md`, `README.md`). All historical files preserved.

## Unchanged

No dependency, provider-configuration, or secret changes. No generated
artifact or deterministic pin changed: `replay-trace-pins.json`
`e66dd9e0…`, `composite-replay-fixtures.json` `f18e47e0…`,
`app/lib/pcb/types.ts` `72ad7c77…`, `pcb-shape-descriptor.ts`
`5501d810…`. Approved importer sets byte-for-byte identical. The
protected original `C:\Users\robsa\sirkit` is untouched (6-entry
pre-existing baseline).
