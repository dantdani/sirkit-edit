# B16.0.19 §A — Zero-work refusal proof (CONFIRMED)

`llmRouter.generate` asserted never-called across every refusal class for both
provider routes: unauthenticated (401), foreign/revoked membership (403),
viewer (403), production cross-origin (403 with **0 body pulls**), media
(415), invalid JSON (400), oversized (family boundary + 1 → 413), pre-aborted
(400 `AUTH_BODY_ABORTED`), missing required fields (400), scope mismatch
(403/422), tampered run digest (422). Exactly once on valid/post-provider
paths.

Domain/oracle work equally unreachable on refusals: ck/propose refuses before
`validateRecipeSourceBundle` output is used; cv/run's integrity 422 precedes
oracle execution; cv/readiness's 403 precedes readiness computation;
transaction-free family (no durable stores exist in these routes).

The cross-origin CSRF pin uses a counting body stream — **zero pulls** on all
nine routes.
