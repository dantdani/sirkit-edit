# B14.5 — the parser-diagnostic policy

## What was wrong

TypeScript's parser ERROR-RECOVERS: given `const = ;` it reports
`Variable declaration expected.` and still returns a usable `SourceFile`.
B14.4 consumed that recovered AST and reported the file clean on every
axis — no offender, no opaque load, no root escape — and no API or
permanent assertion looked at diagnostics at all
(`"sourceParseDiagnostics" in gate === false`). Malformed production
source could therefore be declared boundary-clean by a gate that had, in
truth, failed to read it.

## The closure

`sourceParseDiagnostics(files)` returns BOUNDED records for the parser's
syntactic diagnostics:

| field | meaning |
| --- | --- |
| `file` | repository-relative path of the scanned source |
| `code` | TypeScript diagnostic code (number) |
| `message` | normalized message text, truncated to 200 characters |
| `line` / `character` | 1-based position when the diagnostic carries one, else `null` |

Bounds: at most 100 records per invocation and at most 200 characters per
message, so a pathological tree cannot produce unbounded output.

Permanent assertions:

- the **complete scanned production tree** has **ZERO** parse diagnostics
  (B14.5 §2 test 10) — this is the fail-closed gate;
- **malformed** source trips the gate in **every** supported extension —
  `.ts`, `.tsx`, `.js`, `.jsx`, `.mts`, `.cts`, `.mjs`, `.cjs` (test 8);
- **valid** source in every supported extension stays diagnostic-free
  (test 9), so the gate is sound as well as fail-closed;
- record shape and position reporting are asserted (test 7) and the
  bounds are asserted (test 11).

## JS-family extensions need a second channel (adversarial-audit closure)

The audit showed the parser alone is not enough: TypeScript accepts
TS-only grammar under EVERY ScriptKind and reports "…can only be used in
TypeScript files" (8002/8006/8008/8010/8016/8037) from its JS pass, not
from `parseDiagnostics`. A `.js`/`.jsx`/`.mjs`/`.cjs` file that Node would
reject was therefore reported diagnostic-clean. Those four extensions are
now additionally probed with
`ts.transpileModule(source, {reportDiagnostics: true})` — TypeScript's own
syntactic channel — and the records are merged. Permanent tests cover four
invalid fixtures (type annotation, interface, enum, `as`) and four valid
ones (plain ESM, JSX in `.js`, `node:path` import in `.mjs`, CommonJS in
`.cjs`) so the probe adds no false positives.

## An honest note on the mechanism

`parseDiagnostics` is the parser's own diagnostic list and is an internal
property of `SourceFile`. It is read defensively (`?? []`) — but that
defence cannot silently degrade to "clean", because the malformed-fixture
tests in all eight extensions would fail loudly if the property ever
disappeared or changed shape. The gate deliberately does NOT construct a
full `ts.Program`: the boundary walk is a syntactic scan over a file map
(including in-memory injected fixtures), and a program would require
module resolution and type-checking that the gate neither needs nor
should depend on.

Scope, stated plainly: this closes SYNTACTIC parse failures. Semantic
type errors are the job of `tsc --noEmit` (run as a separate mandatory
gate in every stage's validation), not of the capability boundary walker.
