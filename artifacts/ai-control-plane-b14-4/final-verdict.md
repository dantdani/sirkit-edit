# B14.4 — final verdict

**Completion condition:** "B14.4 is complete only when every valid
equivalent import spelling above is detected through AST-based canonical
module resolution, opaque module loads fail closed, approved importer sets
remain unchanged, harmless literals do not trigger false positives, the
replacement runtime remains behaviorally identical, and all functional
tests pass."

**Verdict: MET.**

1. **Every equivalent spelling is detected through AST-based canonical
   resolution.** R1 (comment inside the dynamic-import parentheses), R2
   (comment between `from` and its literal), R3 (escaped module literal,
   decoded by the AST to `./replacement-reauthorization`), and R4
   (statically concatenated `import("…-" + "…")`) are permanent
   tripwires, alongside same-directory/parent-relative/alias/re-export/
   dynamic/require/import-equals/import-type/side-effect/explicit-
   extension/mixed-segment/case-variant/backslash/query-fragment
   spellings, in ALL EIGHT supported production extensions. Extraction is
   the TypeScript parser (comments and formatting cannot affect an AST);
   specifiers and identifiers come from decoded `.text`; resolution
   compares canonical repo-relative module identities, never substrings.
2. **Opaque module loads fail closed.** Any dynamic `import()`/`require()`
   target outside the bounded side-effect-free grammar (literals,
   no-substitution templates, parentheses, `+` concatenation) is reported
   with its file, kind, and argument text; the production tree is pinned
   at ZERO. After the adversarial audit this was extended to
   property-access loader shapes (`require.resolve`, `require.context`,
   `import.meta.resolve`) and to aliased/reflected bare `require`
   references, which now classify or fail closed rather than passing
   silently.
3. **Approved importer sets are unchanged.** The four capability targets
   carry exactly their B14.1/B14.2 sets; the barrel prohibition holds
   (AST re-export check plus a poisoned-barrel tripwire); the test-only
   factory remains absent from production under an identifier gate
   covering aliases, namespace access, destructuring, element access,
   re-exports, and unicode-escaped identifiers.
4. **Harmless literals do not false-positive.** The endpoint's
   `canonicalRevision: "replacement-reauthorization"` string and an
   injected plain-string file are correctly unflagged; the local-`require`
   helper file is exempt from require classification and its exact
   identity is PINNED, so a new shadowing file must be reviewed.
5. **The replacement runtime is behaviorally identical.** No production
   runtime module was modified in this stage. B14 (47), B14.1 (13),
   B14.2 (15), and B14.3 (19) suites pass unchanged, including the
   rendered-dialog production integration: the click still commits exactly
   one canonical transaction and undoes exactly.
6. **All functional tests pass.** FULL SUITE **2755 passed / 20 skipped /
   0 failures** (2775; 317 files passed / 3 skipped); `tsc --noEmit`
   clean; scoped ESLint clean; page.tsx at its exact 14-problem baseline;
   `git diff --check` clean; deterministic pins byte-identical
   (`e66dd9e0…`/`f18e47e0…`/`72ad7c77…`/`5501d810…`); protected original
   at its 6-entry baseline.

**Scan surface — found and closed during this stage.** An independent
five-agent adversarial audit (66 attempts) found ZERO detection-logic
bypasses but FOUR real scan-surface bypasses: the top-level `components/`
tree (reachable via `@/components`), repository-root `middleware.ts` and
`instrumentation.ts` (Next.js executes both in production), and
basename-at-every-depth exclusions silently skipping `app/data/` /
`app/public/` route segments. The walker now covers the whole repository
root with two-tier exclusions, and permanent scratch-root fixtures pin
every formerly invisible location as enumerated and flagged end-to-end.
[adversarial-audit.md](adversarial-audit.md) records the attempts and the
honest residual-risk register.

Classification: **CONFIRMED** — R1–R4 reproductions (probe output
recorded verbatim), every closure above, and the four audit-found
scan-surface bypasses now closed with tripwires. **INFERRED** — that the
eight scanned extensions plus whole-root coverage exhaust the
production-reachable surface for this Next.js app (verified against the
current tree and tsconfig; a future build system that executes source
from an excluded root directory would need the exclusion tiers revisited).
**PROPOSED** — none required. **UNKNOWN** — what a static import gate
structurally cannot see (`eval`, `new Function`, `createRequire`,
module-registry reflection, `webpackIgnore` runtime URL loads): all
verified ABSENT from production trees today, none covered by any
permanent gate, recorded in the residual-risk register rather than
claimed closed.

**B15, PCB mutation exposure, manufacturing release exposure, MCP,
provider expansion, external component APIs, and multi-agent
orchestration are NOT started. Stopped; the evidence package awaits
independent verification.**

---

> **SUPERSESSION NOTE (B14.5).** Verdict point 4's clause "the
> local-`require` helper file is exempt from require classification and its
> exact identity is PINNED, so a new shadowing file must be reviewed" was
> WRONG as a safety claim: the exemption was file-wide and
> declaration-triggered at any depth, so it both hid real global loader
> calls and left the pinned file poisonable. Point 2's fail-closed claim
> also did not extend to malformed source, which the gate silently
> accepted via the parser's error recovery. B14.5 closes all three
> (exemption deleted, production helper renamed `requireRole`, shadows and
> parse diagnostics pinned at ZERO). Every OTHER verdict of this stage —
> AST detection, canonical resolution, opaque fail-closed, unchanged
> approved sets, scan surface, and the untouched replacement runtime —
> stands. See `../ai-control-plane-b14-5/final-verdict.md`.
