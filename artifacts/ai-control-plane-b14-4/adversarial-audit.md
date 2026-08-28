# B14.4 — adversarial audit of the AST gate (independent multi-agent)

After the AST gate was implemented and its permanent suite was green, an
independent five-agent audit attacked it: four bypass hunters (exotic
syntax; string/encoding tricks; resolution edge cases; scan-surface gaps)
each empirically testing candidate spellings against the real gate
(TypeScript parse-clean check + gate invocation, scratch tests deleted
after capture), plus one residual-risk auditor. **66 attempts.**

## Detection logic: ZERO bypasses

Every TypeScript-valid spelling that grants runtime access to a protected
module was detected — import attributes/assertions, `export * as ns`,
namespace-nested import-equals, declare-module-nested imports, shebang/BOM
prefixes, `satisfies`/`as`-wrapped dynamic imports, deferred namespace
imports, and every encoding/resolution variant attempted. Non-detections
were all legitimate: parse-invalid syntax (`import?.()`, `import source`),
or zero-runtime-consequence forms (triple-slash `/// <reference path>` —
a compiler-only declaration directive that emits nothing into the bundle
graph; JSDoc `@type` imports — type-only annotations).

## Scan surface: FOUR real bypasses found — ALL CLOSED

All four were `collectProductionFiles` blind spots, not detection defects
(each forbidden source was flagged the moment it was injected into a
FileMap — the walker simply never enumerated the file):

1. the top-level `components/` tree (7 real files, imported via
   `@/components` from `app/page.tsx` and `ReplacementReviewDialog.tsx`);
2. repository-root `middleware.ts` (Next.js executes it on every matched
   request);
3. repository-root `instrumentation.ts` (executed at server startup);
4. basename-at-every-depth exclusions silently skipping legitimate
   `app/data/` / `app/public/` route segments.

Closure: the walker now covers the WHOLE repository root with two-tier
exclusions (every-depth: `node_modules`/`.next`/`.git`/`__tests__`;
root-only: `artifacts`/`data`/`public`/`vendor`), and permanent
scratch-root fixtures (§6 tests 18–20) pin every formerly invisible
location as enumerated-and-flagged plus the exclusion tiers as holding.

## Residual-risk register (honest; static gates have limits)

- **Structurally invisible to ANY static import gate, all verified
  ABSENT-TODAY in production trees:** `eval()`, `new Function`,
  `createRequire`, fs-read-then-execute composites, module-registry
  reflection (`require.cache`, `Module._load`), `webpackIgnore:true`
  runtime URL loads. No other permanent gate forbids these; if introduced
  they would not surface here. (The loader shapes that COULD be classified
  statically — `require.resolve`/`require.context`/`import.meta.resolve`/
  aliased `require`/`module.require` — were hardened to classify or fail
  closed after this audit, with tripwires.)
- **PRESENT-AND-UNCOVERED (out of B14.4 scope, recorded honestly):**
  `child_process` spawns of external binaries (ngspice via `NGSPICE_BIN`,
  kicad-cli via `KICAD_CLI`) in the spice/fab modules — an import-graph
  gate does not constrain external process execution.
- **PRESENT-BUT-COVERED:** `next/dynamic` wrappers around static-literal
  inner `import()` calls (extracted and resolved like any dynamic import;
  a variable-specifier variant would surface as an opaque load).
- **Deliberate over-approximations (soundness posture, documented):**
  type-only references count as offenders; the factory identifier gate
  flags any same-named identifier/string; case-insensitive detection with
  exact-case approval; file-granular local-`require` exemption (pinned to
  the single known helper); symlinks inside walked trees are followed and
  scanned as production.

Full per-attempt records: the workflow journal
(66 attempt entries with parse-diagnostic and gate-response evidence per
spelling).
