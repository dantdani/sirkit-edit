# B14.5 — lexical `require` and parse-diagnostic closure

The final narrow correction to B14.4. Its AST import extraction,
whole-repository production walker, and every B14 runtime guarantee
(streams, proposal, approval, reauthorization, canonical application)
remain intact — this stage changes ONE production identifier and the
gate's own soundness.

| # | Defect (all reproduced pre-edit) | Closure |
| --- | --- | --- |
| R1 | an unrelated NESTED binding named `require` (a parameter inside one function) exempted the WHOLE file, hiding a global `require()` of the protected channel — `[]` on every axis | the file-wide exemption is DELETED; classification is unconditional; a `require` shadow is itself a boundary violation pinned at ZERO — [lexical-require-policy.md](lexical-require-policy.md) |
| R2 | the single pinned production file was POISONABLE: prepending a global `require()` of a protected module still satisfied the pin and still reported no offender | the production role helper was renamed `require` → `requireRole` (proven byte-for-byte identifier-only); no path allowlist, no digest carve-out, no exemption of any kind remains |
| R3 | TypeScript reported `Variable declaration expected.` for `const = ;` while the gate — consuming the error-recovered AST — reported the file clean, with no diagnostic API in existence | `sourceParseDiagnostics()` returns bounded `{file, code, message, line, character}` records; the complete scanned production tree is pinned at ZERO diagnostics; malformed fixtures in all 8 extensions trip the gate — [parser-diagnostic-policy.md](parser-diagnostic-policy.md) |

An independent three-agent ADVERSARIAL AUDIT (67 attempts) then attacked
the closure. R1/R2/R3 HELD under every attack — but the audit found one
BLOCKING bypass of the wider gate: `createRequire` (node:module) mints a
CommonJS loader bound to ANY name, so a three-line TypeScript-clean file
loaded a protected module with zero signal. That is closed (loader-alias
tracking, immediately-invoked mints, `Module._load` reflection,
fail-closed unclassified references), together with JSDoc `import()`
extraction, JS-family syntactic diagnostics, a widened shadow-kind
inventory, and the removal of name-position false positives —
[adversarial-audit.md](adversarial-audit.md).

Evidence: [pre-edit-counterexamples.md](pre-edit-counterexamples.md) ·
[lexical-require-policy.md](lexical-require-policy.md) ·
[parser-diagnostic-policy.md](parser-diagnostic-policy.md) ·
[adversarial-audit.md](adversarial-audit.md) ·
[regression-evidence.md](regression-evidence.md) ·
[changed-files.md](changed-files.md) ·
[final-verdict.md](final-verdict.md)

Supersession notes were appended to five B14.4 documents (history
preserved), correcting the claim that the local-`require` exemption was a
soundness measure and that the pinned file was safe.
