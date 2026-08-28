# B14.4 — the AST import-gate contract

`app/lib/project/__tests__/_import-gate-helpers.ts` — shared by the B14.2,
B14.3, and B14.4 boundary suites. Uses the repository's EXISTING
`typescript` dependency; no dependency was added.

## Extraction (TypeScript parser, never regex)

Every production file is parsed with `ts.createSourceFile` under the
extension-correct `ScriptKind` (`.tsx`→TSX, `.jsx`→JSX,
`.js`/`.mjs`/`.cjs`→JS, `.ts`/`.mts`/`.cts`→TS). Inspected nodes:

| node | reference kind |
| --- | --- |
| `ImportDeclaration` (incl. side-effect + type-only) | `static-import` |
| `ExportDeclaration` WITH `moduleSpecifier` (incl. `export * from`, `export * as ns from`, named re-exports) | `re-export` |
| `ImportEqualsDeclaration` with an external module reference (`import x = require("…")`) | `import-equals` |
| `ImportTypeNode` (`import("…").T` in type positions) | `import-type` |
| dynamic `import(…)` `CallExpression` | `dynamic-import` |
| `require(…)` `CallExpression` | `require` |

Comments and formatting cannot affect an AST (R1/R2 closed). Specifiers
are taken from `StringLiteralLike.text` — the DECODED value, so escaped
literals resolve to their real module names (R3 closed). Identifier
comparisons (the factory gate) also use decoded `Identifier.text`, so
unicode-escaped identifiers are caught.

## Bounded static evaluation (R4 closed)

Dynamic `import()`/`require()` arguments are evaluated ONLY within a
side-effect-free static grammar: string literals, no-substitution template
literals, parenthesized forms, and binary `+` concatenations composed
entirely of those. Nothing is executed. Anything outside the grammar is an
OPAQUE MODULE LOAD surfaced by `opaqueModuleLoads()` — the capability gate
FAILS CLOSED on it (the permanent suite asserts the real tree has zero and
that an injected one is reported with its file, kind, and argument text).

## The local-`require` exemption (soundness, pinned)

`app/lib/pcb/fab/validate-package.ts` declares a LOCAL
`const require = (role) => …` helper. Files that declare a local binding
named `require` are exempted from require-call classification (their
`require(x)` is not a module load) — and the exact exempt set is PINNED by
the permanent suite (`localRequireDeclarations()`), so a new shadowing
file fails the pin and must be explicitly reviewed. Static imports and
dynamic `import()` in such files remain fully gated.

## Resolution (canonical identity, never substring)

`resolveSpecifier(importerPath, specifier)`:

1. Fail-closed canonicalization: Windows backslashes → `/`;
   `?query`/`#fragment` suffixes stripped (bundler resolvers tolerate
   both).
2. `@/x` → repo-root `x`; `./`/`../` resolved segment-by-segment against
   the importer's directory (`.`/empty segments skipped, `..` pops).
3. Traversal above the repository root → `{kind:"escapes-root"}`,
   surfaced by `rootEscapingImports()` (suite asserts zero in production,
   and that an injected escape is reported).
4. One trailing SUPPORTED source extension stripped
   (`.ts/.tsx/.js/.jsx/.mts/.cts/.mjs/.cjs`).
5. Bare package specifiers are not repo modules.

The authoritative comparison is the canonical repo-relative module
identity. DETECTION is case-insensitive (a case-variant spelling resolves
to the protected file on the case-insensitive filesystems Sirkit develops
on); APPROVAL is exact-case — so a case-variant spelling is flagged even
if its exact-case author would be approved.

## Scan surface (rewritten after the adversarial audit)

`collectProductionFiles()` walks the ENTIRE repository from its root for
ALL EIGHT supported source extensions. Exclusions are TWO-TIER:
`node_modules`/`.next`/`.git`/`__tests__` at every depth (never
production source, or legitimately test-only), and
`artifacts`/`data`/`public`/`vendor` at the REPOSITORY ROOT ONLY. The
adversarial audit proved the earlier `app/`+`scripts/`+`lib/` walk left
REAL production source unenumerated — the top-level `components/` tree
(7 files, imported via `@/components` by `app/page.tsx` and
`ReplacementReviewDialog.tsx`), repository-root production files
(`middleware.ts`/`instrumentation.ts` would execute in production;
`next.config.ts` etc. exist today) — and that basename-at-every-depth
exclusion silently skipped legitimate `app/data/`/`app/public/` route
segments. All three classes are closed and pinned by permanent
scratch-root fixtures (§6). Because every supported extension is parsed
under the correct ScriptKind, a future non-`.ts` production importer is
inspected, not silently skipped (the pre-edit tree contains none).

## Loader-shape hardening (after the adversarial audit)

Property-access loader calls whose BASE identifier is the CommonJS loader
(`require.resolve`, `require.context`, `require.ensure`) and
`import.meta.resolve(…)` are classified exactly like `require()`/`import()`
(static argument → module reference; otherwise → opaque load). Any OTHER
unclassified reference to the bare identifier `require` in a
non-exempt file — aliasing (`const r = require`), reflection
(`module.require`), passing `require` as a value — FAILS CLOSED as an
opaque load (deliberate over-approximation, kept reviewable by the
zero-opaque production pin). A LEADING `#` (a Node package-imports
subpath) classifies as bare instead of being erased by fragment
stripping.

## Performance

One parsed-`SourceFile` cache (keyed by path, validated against the exact
source string) is shared by all gates — the production tree is parsed once
per test run, injected tripwire entries individually. Parent-node tracking
is disabled (no visitor needs it).

---

> **SUPERSESSION NOTE (B14.5).** The section "The local-`require`
> exemption (soundness, pinned)" above is WITHDRAWN. That exemption was
> not a soundness measure — it was a hole. It triggered on ANY declaration
> named `require` at ANY depth, so an unrelated nested parameter
> suppressed classification of genuinely global `require()` calls in the
> same file; and because the pin admitted a FILE rather than a fact, the
> pinned file itself was poisonable by prepending a global `require()` of
> a protected module. B14.5 deletes the exemption (classification is now
> unconditional), renames the production role helper to `requireRole`, and
> reports `require` shadow declarations as boundary violations pinned at
> ZERO. B14.5 also adds `sourceParseDiagnostics()`: this contract
> previously said nothing about the parser error-recovering, so malformed
> source was reported boundary-clean. See `../ai-control-plane-b14-5/`.
