# B14.5 — adversarial audit of the closure (independent, 3 agents, 67 attempts)

After the R1–R3 closures were implemented and green, an independent
three-agent audit attacked them: scope/shadow evasion, diagnostic blind
spots, and integration/false positives. Every claim was verified
empirically against the real gate and against TypeScript ground truth
(`parseDiagnostics`, `transpileModule`, `ts.createProgram`), with scratch
tests deleted afterwards.

## R1/R2 closure: HELD under every attack

No declaration form suppressed detection. Catch-clause parameters,
for-of bindings, destructuring with rename, default parameter values,
`declare function require`, ambient blocks, class members — in every case
the global forbidden load still surfaced as an offender, and the shadow
itself was reported. The real-tree pins (zero shadows, zero opaque loads,
zero diagnostics, zero offenders for all three capability targets across
**1140 scanned files**) were confirmed independently, and confirmed
NON-VACUOUS: removing an approved importer from its approved set makes the
detector fire on it, so the clean result is earned.

## One BLOCKING finding — closed

**`createRequire` (node:module) mints a CommonJS loader bound to any
name.** A three-line, TypeScript-clean ESM file
(`const load = createRequire(import.meta.url); load("…/replacement-reauthorization")`)
loaded the protected module with ZERO signal on every axis, because the
identifier fallback only fired on the name `require`. The auditor proved
the route real at runtime (`createRequire(import.meta.url)("node:path").join`
is a function) across 7 spellings plus `module.constructor._load` and
`process.getBuiltinModule("module")`.

Closed: loader-minting calls are now tracked. Bindings initialized from
`createRequire(…)` (including through renamed imports, namespace members,
and factory-alias chains) are LOADER ALIASES whose calls classify exactly
like `require(…)`; immediately-invoked mints and `Module._load` /
`module.require` reflection are classified directly; any unclassified
`createRequire` reference fails closed as an opaque load; a non-static
minted target is opaque. All 8 spellings plus both fail-closed shapes are
permanent tripwires (§4 test 15).

## Two hardening findings — closed

- **JSDoc `import()` types were invisible.** `ts.forEachChild` does not
  descend into a node's JSDoc, so `/** @type {import("…").T} */` — the
  JS-family spelling of the import-type form the gate claims to detect —
  was never extracted, on live scan surface (the tree contains
  `.mjs` production files). The visitor now walks `node.jsDoc` explicitly
  (§4 test 16).
- **JS-family syntactic diagnostics were missed.** TypeScript's parser
  accepts TS-only grammar under every ScriptKind and reports
  "…can only be used in TypeScript files" (8002/8006/8008/8010/8016/8037)
  from its JS pass instead, so a `.js`/`.jsx`/`.mjs`/`.cjs` file that Node
  would reject was reported diagnostic-clean. Those four extensions are
  now additionally probed with `ts.transpileModule({reportDiagnostics:true})`
  — TypeScript's own syntactic channel — and the results merged (§4
  test 17, with valid-source counter-checks so JSX in `.js` and CommonJS
  in `.cjs` stay clean).

## Two cosmetic findings — closed

- **Shadow inventory was incomplete** (enum, namespace, function/class
  expression names, accessors, interfaces, namespace imports produced an
  opaque load but no shadow record, so a future violation would be
  attributed the wrong kind). The kind list is widened and pinned (§4
  test 19). No bypass existed — every form already failed closed.
- **False positives on idiomatic non-loader code.** Any identifier spelled
  `require` in a NAME position — a member read (`cfg.require`), an object
  key (webpack `externals: { require: … }`), a JSX prop, a type member,
  an enum member — was reported as an opaque load and would have failed
  the ZERO-opaque production pin. Name positions are now excluded (§4
  test 18). This cannot hide a loader call: a real call has the loader as
  its callee or base, both classified independently.

## Residual, honestly recorded

`new Function` / `eval` string-encoded loaders remain invisible to any
purely static gate (verified ABSENT from production today; B14.4's
residual-risk register already carries this class). Checker-side grammar
errors that TypeScript raises outside both the parser and the JS
syntactic pass (e.g. `const z;` → 1155, `with` → 1101) are still not
reported by the gate; they are caught by the mandatory `tsc --noEmit`
gate that every stage runs. Fail-closed over-approximation remains for
genuine loader references in non-loading positions (`typeof require`
guards, `require.main === module`), which is deliberate: reviewable,
never silent.
