# B14.5 — final verdict

**Completion condition:** "B14.5 is complete only when no local binding can
suppress unrelated module-loader detection, the existing pinned production
file cannot be poisoned, every parser diagnostic fails the production gate,
approved importer sets remain unchanged, manufacturing behavior stays
deterministic, all replacement guarantees remain green, and all functional
tests pass."

**Verdict: MET.**

1. **No local binding can suppress unrelated detection.** The file-wide
   exemption is deleted; classification is unconditional. A nested
   parameter, a block-local binding, and a module-level binding named
   `require` each leave a global forbidden load fully detected (R1 closed),
   and each is itself reported as a shadow declaration with its kind and
   position. The production tree is pinned at **ZERO** shadows.
2. **The formerly pinned file cannot be poisoned.** An in-memory
   `validate-package.ts` with a prepended global
   `require("…/replacement-reauthorization")` is an OFFENDER (R2 closed);
   the real on-disk file is clean on every axis because its role helper is
   now `requireRole` — the shadow was removed at the source rather than
   trusted by the gate. No path allowlist and no digest carve-out exists.
3. **Every parser diagnostic fails the gate.** `sourceParseDiagnostics()`
   returns bounded `{file, code, message, line, character}` records; the
   complete scanned tree is pinned at **ZERO**; malformed source trips the
   gate in all eight supported extensions and valid source in all eight
   stays clean (R3 closed). After the audit, the four JS-family extensions
   are additionally probed through TypeScript's own syntactic channel, so
   a `.js`/`.jsx`/`.mjs`/`.cjs` file carrying TS-only syntax can no longer
   be called clean.
4. **Approved importer sets are byte-for-byte unchanged** and asserted as
   literals; the three capability targets and the test-only factory remain
   clean over the whole-root scan (1140 files), and the audit independently
   confirmed that result is non-vacuous.
5. **Manufacturing behaviour is deterministic and unchanged.** The rename
   is provably identifier-only (reversing it reproduces the original file
   byte-for-byte); package validation, Gerber/XNC readback, the
   deterministic release manifest, the verified release gates, and every
   fab/bundle/persistence suite pass unchanged; no generated artifact or
   deterministic pin moved.
6. **Every replacement guarantee is green and all functional tests pass.**
   No B14 runtime module was touched. FULL SUITE **2774 passed / 20
   skipped / 0 failures** (2794; 318 files passed / 3 skipped) on the first
   invocation — no load flakes, so no flake classification was required;
   `tsc --noEmit` clean; scoped ESLint clean; page.tsx at its 14-problem
   baseline; `git diff --check` clean; protected original at its 6-entry
   baseline. The rendered production replacement click still commits
   exactly once and undoes exactly (b14-1 production integration, green
   unchanged).

**Found and closed during this stage.** An independent three-agent audit
(67 attempts) confirmed the R1/R2/R3 closures held under every attack, but
found one **BLOCKING** bypass and four smaller gaps — all closed with
permanent tripwires: `createRequire`-minted CommonJS loaders bound to any
name (a three-line, TypeScript-clean, runtime-proven route that produced
zero signal on every axis); JSDoc `import()` types invisible to the
extractor; JS-family syntactic diagnostics missed; an incomplete shadow-kind
inventory; and false positives on identifiers spelled `require` in name
positions. [adversarial-audit.md](adversarial-audit.md) records all of it,
including what remains structurally out of reach.

Classification: **CONFIRMED** — R1–R3 reproductions (probe output recorded
verbatim), every closure above, the audit-found `createRequire` bypass and
its closure, and the byte-for-byte identity of the rename. **INFERRED** —
that `parseDiagnostics` plus the JS-family transpile probe covers
TypeScript's syntactic channel for the scanned extensions (verified against
`ts.createProgram` and `transpileModule` ground truth for every fixture
tried). **PROPOSED** — none required. **UNKNOWN** — string-encoded loaders
(`eval`, `new Function`) remain invisible to any purely static gate and are
absent from production today; checker-side grammar errors are covered by
the separate mandatory `tsc --noEmit` gate, not by this walker.

**B15, PCB mutation exposure, manufacturing-release exposure, MCP, provider
expansion, external component APIs, and multi-agent orchestration are NOT
started. Stopped; the evidence package awaits independent verification.**
