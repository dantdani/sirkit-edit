# B16.0.17 §A/§D — Zero-work refusal proof (CONFIRMED)

The wrapper runs identity → membership → role → CSRF → media → bounded body
parse BEFORE every callback.

## Provider (propose) — zero on every refusal

`llmRouter.generate` asserted never-called for: unauthenticated (401),
foreign/revoked membership (403), production cross-origin (403, **0 body
pulls**), media (415), invalid JSON (400), oversized 32 MB+1 (413), pre-aborted
(400), missing required fields (400), scope mismatch (422). Exactly once on the
valid path.

## Domain / transaction — zero on refusal

- transaction foreign scope → `createSchematicTransaction` NEVER called (pinned);
- problem foreign scope → 403 before `compileSchematicCompilationProblem`;
- graph-validate/diff/layout/variants/compare scope or integrity failure → 422
  before diff/layout/projection/certification;
- export without the approved chain → `NOT_RELEASED` before any handoff.

## Body-pull evidence

The cross-origin CSRF pin uses a counting body stream and asserts **zero
pulls** — the wrapper refuses before reading the body.
