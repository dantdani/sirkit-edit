# B14.4 — AST-proven capability import boundaries (final B14 closure)

Narrow corrective stage over B14.3's STATIC gate (B14.3's runtime
stream-lifecycle closures are independently verified and untouched). The
regex-based specifier extraction was proven incomplete against valid
TypeScript; it is replaced by the TypeScript parser itself.

| # | Defect (all reproduced pre-edit) | Closure |
| --- | --- | --- |
| R1 | a comment INSIDE `import( … )` parentheses blinded the dynamic-import regex | AST `CallExpression`/`ImportKeyword` extraction — comments cannot affect an AST — [ast-import-gate-contract.md](ast-import-gate-contract.md) |
| R2 | a comment between `from` and its literal blinded the static-import regex | AST `ImportDeclaration`/`ExportDeclaration` extraction |
| R3 | `"./replacement-reauthorization"` extracted RAW and failed resolution; TypeScript decodes it to the real module name | decoded `StringLiteralLike.text` everywhere (identifiers too) |
| R4 | `import("../project/replacement-" + "reauthorization")` — statically evaluable, regex-invisible | bounded side-effect-free static evaluation (literals, no-substitution templates, parens, `+`); anything else is an OPAQUE LOAD that FAILS CLOSED |
| — | the walker inspected only `.ts`/`.tsx` | all EIGHT supported production extensions parsed with the correct ScriptKind |

Plus hardened canonical resolution (backslash/query/fragment
canonicalization, extension strip, root-escape rejection surfaced,
case-insensitive detection with exact-case approval), a pinned exemption
for the one real local-`require` helper, and an AST identifier gate for
the test-only factory covering aliased/namespace/destructured/element-
access/re-export/unicode-escaped forms. Approved importer sets are
EXACTLY those of B14.1/B14.2 — [capability-boundary-matrix.md](capability-boundary-matrix.md).

An independent five-agent ADVERSARIAL AUDIT (66 attempts) then attacked
the finished gate: ZERO detection-logic bypasses, but FOUR real
SCAN-SURFACE bypasses — the top-level `components/` tree, repository-root
`middleware.ts`/`instrumentation.ts`, and basename-at-every-depth
exclusions skipping `app/data/`/`app/public/` route segments. All four are
closed (whole-root walk, two-tier exclusions) and pinned by permanent
scratch-root fixtures; loader shapes (`require.resolve`/`require.context`/
`import.meta.resolve`/aliased `require`) were hardened to classify or fail
closed — [adversarial-audit.md](adversarial-audit.md).

Evidence: [pre-edit-counterexamples.md](pre-edit-counterexamples.md) ·
[ast-import-gate-contract.md](ast-import-gate-contract.md) ·
[capability-boundary-matrix.md](capability-boundary-matrix.md) ·
[adversarial-audit.md](adversarial-audit.md) ·
[regression-evidence.md](regression-evidence.md) ·
[changed-files.md](changed-files.md) ·
[final-verdict.md](final-verdict.md)

Supersession notes were added to three B14.3 documents, correcting its
"sound AND complete" claim (sound: yes; complete: no). No production
runtime module was touched; the replacement click still commits exactly
once (B14/B14.1/B14.2/B14.3 suites + the rendered-dialog integration all
green, unmodified).

---

> **SUPERSESSION NOTE (B14.5).** "a pinned exemption for the one real
> local-`require` helper" (above) was itself a defect, not a feature: it
> exempted an entire file whenever any declaration named `require`
> appeared at any depth, hiding real global loader calls, and the pinned
> file could be poisoned. B14.5 deletes the exemption, renames the
> production helper to `requireRole`, pins `require` shadows at ZERO, and
> adds a parse-diagnostic gate (the AST gate previously accepted
> error-recovered malformed source as clean). See
> `../ai-control-plane-b14-5/`.
