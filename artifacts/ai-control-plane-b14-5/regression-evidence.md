# B14.5 — regression evidence

## New permanent suite

**`app/lib/project/__tests__/b14-5-lexical-require-and-diagnostics.test.ts`
(19 tests)** — every mandated regression:

| mandated test | test |
| --- | --- |
| R1 is detected | §1 1 (global load ⇒ offender; the nested parameter reported as a shadow at line 2, char 20) |
| the in-memory poisoned `validate-package.ts` is detected | §1 2 (poisoned copy ⇒ offender; the real on-disk file clean, shadow-free, opaque-free — disk untouched) |
| a local require PARAMETER cannot hide an outer require | §1 1 (and §1 5 beside an alias) |
| a BLOCK-local require cannot hide another scope | §1 3 |
| a MODULE-LEVEL local require creates no exemption | §1 4 (static import caught; shadow reported; a shadowed `require()` call with a forbidden specifier is itself an offender) |
| an aliased global require still fails closed | §1 5 (`const r = require` ⇒ opaque; non-static dynamic target ⇒ opaque) |
| the real production tree has zero local-require shadows | §1 6 (plus: the renamed helper contains `requireRole` and no bare `require`) |
| malformed source in every supported extension produces a diagnostic | §2 8 (all 8) and §2 7 (record shape: file, code, message, line, character) |
| valid source in every extension remains diagnostic-free | §2 9 (all 8) |
| comments and harmless strings remain non-offenders | §3 12 |
| all B14.4 import forms remain detected | §3 13 (11 forms incl. escaped, concatenated, import-equals, import-type, re-export, alias, require.resolve) |
| approved importer sets remain byte-for-byte unchanged | §3 14 (literal set assertions + the real tree clean under them) |

Plus §2 10 (the COMPLETE scanned tree pinned at ZERO parse diagnostics —
the fail-closed gate) and §2 11 (record/message bounds), and §4 — the
closures found by the independent adversarial audit:

| audit finding | test |
| --- | --- |
| **BLOCKING**: `createRequire`-minted loaders were invisible | §4 15 — 8 spellings (node:module / bare `module` / renamed import / namespace member / immediately-invoked / factory-alias chain / `process.getBuiltinModule` / `Module._load`) all ⇒ offender; an unclassified `createRequire` reference and a non-static minted target ⇒ opaque |
| JSDoc `import()` types in JS-family files were invisible | §4 16 |
| TS-only syntax in a JS-family file was reported clean | §4 17 (4 invalid ⇒ diagnostics; 4 valid, incl. JSX in `.js` and CommonJS in `.cjs`, ⇒ clean) |
| false positives on name positions spelled `require` | §4 18 (object key, member read, type member, enum member, word-boundary neighbours ⇒ all clean on every axis) |
| incomplete shadow-kind inventory | §4 19 (enum, namespace, class/function expression, getter, interface, namespace-import) |

## Updated files (corrected, never weakened)

- `b14-4-ast-import-gates` — test 3 now asserts ZERO `require` shadow
  declarations in production (was: the exemption is pinned to one file);
  test 15b asserts the helper contains no bare `require` identifier, and
  the `module.require` case was strengthened from "fails closed as opaque"
  to "a static protected target is an OFFENDER; a non-static one is
  opaque". 22 tests, all green.

## Results

| battery | result |
| --- | --- |
| b14-5 suite | **19/19** |
| b14-4 suite (over the corrected gate) | 22/22 |
| B14 + B14.1 + B14.2 + B14.3 + B11.5 + manufacturing/fab/release battery (16 files) | **176/176** |
| manufacturing-release-gate · build-bundle · native-fab · release-persistence · fab-presets | 23/23 — package validation, Gerber/XNC readback, deterministic release manifest, and release gates all unchanged after the rename |
| **FULL SUITE** | **2774 passed / 20 skipped / 0 failures (2794; 318 files passed / 3 skipped)** |

The full suite passed on its FIRST invocation this stage — no load flakes
occurred, so no flake classification was needed. The count is exactly
B14.4's 2755 plus the 19 new tests.

`tsc --noEmit` clean; scoped ESLint clean on every changed file; page.tsx
at its exact 14-problem baseline; `git diff --check` clean. Deterministic
pins UNCHANGED (`e66dd9e0…`, `f18e47e0…`, `72ad7c77…`, `5501d810…`);
registry/tool counts unchanged; approved importer sets byte-for-byte
identical. No dependency, provider-configuration, or secret changes. The
protected original `C:\Users\robsa\sirkit` remains at its 6-entry
pre-existing baseline.

## Manufacturing determinism

The rename is proven identifier-only by construction: mechanically
reversing `requireRole` → `require` reproduces the pre-edit file
byte-for-byte (empty `diff`). `validateFabricationFiles` is exercised by
`manufacturing-release-gate.test.ts` (GERBER_PARSE_ERROR / XNC_PARSE_ERROR
/ role-swap invalidity), which passes unchanged, as do the bundle, native
fab, fab-preset, and release-persistence suites. No generated artifact or
deterministic pin moved.
