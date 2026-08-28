# B16.0.18 §A/§D — Zero-work refusal proof (CONFIRMED)

The wrapper runs identity → membership → role → CSRF → media → bounded body
parse BEFORE every callback.

## Provider (propose) — zero on every refusal

`llmRouter.generate` asserted never-called for: unauthenticated (401),
foreign/revoked membership (403), production cross-origin (403, **0 body
pulls**), media (415), invalid JSON (400), oversized 12 MB+1 (413),
pre-aborted (400), missing required fields (400), catalog-digest mismatch
(422), scope mismatch (422). Exactly once on the valid + post-provider paths.

## Domain / transaction — zero on refusal

- transaction foreign scope → `createComponentSelectionTransaction` NEVER
  called (pinned);
- export foreign scope → 422 before candidate lookup; unknown candidate → 404
  before any BOM assembly;
- problem foreign scope → 403 before `compileComponentSelectionProblem`;
- solve foreign scope → 422 before the solver;
- sourcing refresh → 503 with zero acquisition (nothing to call — no network
  exists, gated).

## Body-pull evidence

The cross-origin CSRF pin uses a counting body stream and asserts **zero
pulls** for all ten routes.
