# B14.4 — regression evidence

## New permanent suite

**`app/lib/project/__tests__/b14-4-ast-import-gates.test.ts` (22 tests)**
covering every mandated tripwire:

| mandated tripwire | test |
| --- | --- |
| same-directory relative import | §3 9 (`same-directory`) — plus the retained B14.3 §E tripwires, now over the AST gate |
| parent-relative import | §3 9 (`parent-relative`) |
| `@/` alias import | §3 9 (`alias`) |
| static re-export | §3 9 (`static-re-export`, `named-re-export`) + §5 17 (poisoned barrel) |
| dynamic import | §3 9 (`dynamic-import`) |
| require | §3 9 (`require`) |
| ImportEqualsDeclaration | §3 9 (`import-equals`) + §3 12 (intent variant) |
| import-type syntax | §3 9 (`import-type`, `type-only-import`) |
| comments between import tokens (R2) | §2 6 |
| comments inside dynamic import (R1) | §2 5 |
| escaped module literals (R3) | §2 7 |
| statically concatenated dynamic imports (R4) | §2 8 (incl. parenthesized + template composition) |
| explicit source extensions | §3 9 (`explicit-extension`); resolution unit §4 15 |
| mixed `.`/`..` spellings | §3 9 (`mixed-dot-segments`) |
| opaque non-static dynamic import failing closed | §4 13 (variable, template-substitution, and require variants — exact file/kind/argument reported); §4 14 (grammar bounds) |
| each supported production extension | §3 10 (all 8, forbidden import detected in every one) |
| harmless non-import string literals unflagged | §1 4 (endpoint `canonicalRevision` literal + injected plain-string file) |
| the real current production tree remains clean | §1 1 (all four targets, over the WHOLE-ROOT scan) + §1 2 (zero opaque, zero escaping) + §1 3 (local-require pin) |
| fails while present, passes ONLY once removed or approved | §3 11 |

Beyond the mandate: §3 9 also proves windows-backslash, `?query`/`#fragment`
suffix, and case-variant spellings; §4 15b proves the post-audit
loader-shape hardening (`require.resolve`/`import.meta.resolve` static →
offender; `require.context`/aliased/reflected `require` → opaque; the
pinned local-require helper stays silent); §4 15c proves leading-`#`
subpath preservation; §5 16 proves five factory access forms plus
unicode-escaped identifiers; §6 18–20 pin the adversarially found
scan-surface bypasses closed (scratch-root fixture: `components/`, root
`middleware.ts`/`instrumentation.ts`, `app/data/`/`app/public/` route
segments all enumerated AND flagged end-to-end; root-only and every-depth
exclusion tiers held; the real tree's `components/` + root files verified
scanned).

## Updated files (strengthened or admitted, never weakened)

- `b14-2` / `b14-3` suites — UNMODIFIED assertions now execute over the
  AST gate (same `moduleImportOffenders` signature); whole-tree gate tests
  carry explicit 60 s timeouts for the one-time TypeScript parse.
- `b11-5-capture-exactness` §D 12 — the b14-4 suite registered through the
  gate's DESIGNED admission mechanism: a justification predicate asserting
  its scratch root is `join(tmpdir(), …)` AND every write-primitive call
  line is rooted there; the admission lapses if the confinement is ever
  relaxed.

## Results

| battery | result |
| --- | --- |
| b14-4 suite | **22/22** |
| b14-2 + b14-3 suites (over the AST gate) | 15/15 + 19/19 |
| all B14 + B14.1 suites incl. the rendered-dialog production integration | **60/60** |
| b11-5 capture-exactness (the write gate, with the new admission) | 18/18 |
| **FULL SUITE** | **2755 passed / 20 skipped / 0 failures (2775; 317 files passed / 3 skipped)** |

Two earlier full-suite invocations each had exactly one failure of
`route-tool.test.ts › route tool — perf › direct live preview avoids
catastrophic slowdown with 500 tracks` (5 s timeout under the 5-fork load,
once with a vitest worker-RPC `Timeout calling "onTaskUpdate"` error) —
classified a LOAD FLAKE per the stage rule only after it passed
independently (25/25) with ZERO source changes, and the final full run
above contains zero failures. One earlier run also caught a REAL gate
interaction — the B11.5 write gate correctly flagged the new scratch-root
fixture — resolved through that gate's documented justification mechanism,
not by weakening it.

`tsc --noEmit` clean; scoped ESLint clean; page.tsx at its exact
14-problem baseline; `git diff --check` clean. Registry/tool counts and
every deterministic pin UNCHANGED (`e66dd9e0…`/`f18e47e0…`/`72ad7c77…`/
`5501d810…`). No dependency changes (the gate uses the repository's
existing `typescript`), no provider credits or configuration changes, no
secrets. The independent adversarial audit (66 attempts) is recorded in
[adversarial-audit.md](adversarial-audit.md).

---

> **SUPERSESSION NOTE (B14.5).** Test 3 in the table above ("the
> local-`require` exemption is PINNED to the one known helper file") tested
> the wrong property: it proved WHICH file was exempt, never that the
> exemption was safe. B14.5 reproduced both failure directions (an
> unrelated nested parameter hiding a real global load; the pinned file
> poisonable) plus a third — the gate reporting malformed source as clean —
> and closed all three. That test now asserts ZERO `require` shadow
> declarations in production; test 15b now asserts the helper contains no
> bare `require` identifier at all. Suite count for b14-4 is unchanged at
> 22. See `../ai-control-plane-b14-5/regression-evidence.md`.
