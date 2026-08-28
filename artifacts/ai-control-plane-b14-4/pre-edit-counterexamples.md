# B14.4 — pre-edit counterexamples (all reproduced before any edit)

Probe: a DISPOSABLE vitest file (`b14-4-probe.test.ts`, deleted after
capture) executed against the UNMODIFIED B14.3 regex gate
(`app/lib/project/__tests__/_import-gate-helpers.ts`), targeting
`app/lib/project/replacement-reauthorization` with the exact production
approved set. Each case was verified on three axes: TypeScript parses it
(zero parse diagnostics), the CURRENT regex gate misses it (no offender),
and (after the closure) the replacement AST gate detects it — the
detection axis is proven by the permanent B14.4 suite tripwires.

Exact probe output (verbatim):

```json
{
 "R1-comment-inside-dynamic-import": {
  "parseDiagnostics": 0,
  "extractedSpecifiers": [],
  "offenders": []
 },
 "R2-comment-between-import-tokens": {
  "parseDiagnostics": 0,
  "extractedSpecifiers": [],
  "offenders": []
 },
 "R3-escaped-module-literal": {
  "parseDiagnostics": 0,
  "extractedSpecifiers": [
   "./replacement\\u002dreauthorization"
  ],
  "offenders": []
 },
 "R4-concatenated-dynamic-import": {
  "parseDiagnostics": 0,
  "extractedSpecifiers": [],
  "offenders": []
 }
}
```

## R1 — comment inside a dynamic import (CONFIRMED)

```ts
const channel = import(
  /* webpackChunkName: "reauth" */
  "../project/replacement-reauthorization"
);
```

TypeScript: 0 parse diagnostics. The regex dynamic-import pattern required
`import(` + optional whitespace + a quote; the comment token broke it —
ZERO specifiers extracted, ZERO offenders.

## R2 — comment between import tokens (CONFIRMED)

```ts
import { createReplacementReauthorization }
  from /* boundary */ "../project/replacement-reauthorization";
```

TypeScript: 0 parse diagnostics. The static-import pattern required
`from` + optional whitespace + a quote; `/* boundary */` broke it — ZERO
specifiers, ZERO offenders.

## R3 — escaped module literal (CONFIRMED)

```ts
import { createReplacementReauthorization }
  from "./replacement-reauthorization";
```

TypeScript: 0 parse diagnostics, and its AST decodes the specifier to the
REAL module name (probe output `R3_DECODED "./replacement-reauthorization"`
from `moduleSpecifier.text`). The regex extracted the RAW escaped text
`./replacement-reauthorization`, which failed path resolution — ZERO
offenders.

## R4 — statically concatenated dynamic import (CONFIRMED)

```ts
const channel =
  import("../project/replacement-" + "reauthorization");
```

TypeScript: 0 parse diagnostics; the argument is a statically evaluable
side-effect-free string expression equal to the protected module. The
regex required one contiguous quoted literal inside the parentheses — ZERO
specifiers, ZERO offenders.

## Extension-coverage gap (CONFIRMED by inspection)

The B14.2/B14.3 production walkers accepted only `/\.(ts|tsx)$/`. A future
`.js`, `.jssx`, `.mts`, `.cts`, `.mjs`, or `.cjs` production importer would
never have been inspected. (Pre-edit scan of the walked trees: no such
files exist today — the B14.4 walker inspects all eight supported
extensions, so any future one is parsed and gated instead of silently
skipped.)

## A soundness constraint discovered pre-edit

`app/lib/pcb/fab/validate-package.ts:68` declares a LOCAL
`const require = (role) => …` helper and calls it with both string
literals and identifiers. A naive AST gate that treats every `require(…)`
call as a CommonJS module load would flag `require(role)` as an opaque
module load (false positive). The closure therefore detects local
`require` bindings per file, exempts ONLY those files from require-call
classification, and PINS the exact exempt set in a permanent test so any
new shadowing file must be explicitly reviewed.
