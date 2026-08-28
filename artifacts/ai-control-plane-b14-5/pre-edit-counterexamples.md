# B14.5 — pre-edit counterexamples (all reproduced before any edit)

Probe: a DISPOSABLE vitest file (`b14-5-probe.test.ts`, deleted after
capture) executed against the UNMODIFIED B14.4 gate
(`app/lib/project/__tests__/_import-gate-helpers.ts`). The permanent
executable form of every case below is the B14.5 suite
(`b14-5-lexical-require-and-diagnostics.test.ts`), which asserts the
CLOSED behaviour.

## R1 — a nested local-require declaration hides a global forbidden require (CONFIRMED)

```ts
const stolen = require("../project/replacement-reauthorization");
function unrelated(require: (x: string) => void) { require("not-a-module"); }
```

Exact pre-edit result:

```json
{"localRequireDeclarations":["app/lib/agent/evil-r1.ts"],"moduleReferences":[],"opaqueModuleLoads":[],"moduleImportOffenders":[]}
```

The unrelated NESTED PARAMETER named `require` set the file-wide
`declaresLocalRequire` flag, which suppressed classification of EVERY
`require(...)` call in the file — including the top-level, genuinely
global one that loads the protected channel module. The gate reported no
reference, no opaque load, and no offender.

## R2 — the pinned production exemption is poisonable (CONFIRMED)

An IN-MEMORY copy of the real `app/lib/pcb/fab/validate-package.ts` (the
file on disk was NOT modified for this reproduction) with a prepended:

```ts
const stolen =
  require("../../project/replacement-reauthorization");
```

Exact pre-edit result:

```json
{"localRequireDeclarations":["app/lib/pcb/fab/validate-package.ts"],"moduleImportOffenders":[],"opaqueModuleLoads":[]}
```

Because that file legitimately declared its own `const require` role
helper, the exemption applied to the whole file — so an added, genuinely
global `require()` of the protected module was invisible. The B14.4 pin
(`localRequireDeclarations === ["app/lib/pcb/fab/validate-package.ts"]`)
was satisfied by the poisoned file too: the pin proved WHICH file was
exempt, never that the exemption was safe.

## R3 — parse diagnostics fail open (CONFIRMED)

Source: `const = ;`

Exact pre-edit result:

```json
{"typescriptParseDiagnostics":["Variable declaration expected."],"gateOffenders":[],"gateOpaqueLoads":[],"gateRootEscapes":[],"diagnosticApiExists":false}
```

TypeScript reports a real syntax error, yet the gate silently consumed the
error-recovered AST and reported the file clean on every axis. No
diagnostic API existed (`"sourceParseDiagnostics" in gate === false`) and
no permanent assertion checked parser diagnostics — so malformed
production source could reach the gate and be declared boundary-clean.
