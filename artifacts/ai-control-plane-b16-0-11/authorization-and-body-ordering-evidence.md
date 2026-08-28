# B16.0.11 — Authorization & body ordering evidence

## Authenticated methods (diff, snapshot POST/GET, notifications GET/PATCH/DELETE)

Runtime ordering inside the canonical wrappers:

1. exact route/method policy → `authorizeRequest` (identity + active
   membership + role + automatic same-origin CSRF on POST/PATCH/DELETE);
2. principal-kind check;
3. media type — 415 before any body pull (JSON methods);
4. bounded read — 8 MB/30 s (diff, snapshot POST) or **16 KB/10 s**
   (notifications PATCH/DELETE), deadline/abort settle once;
5. JSON object parse;
6. the callback — forbidden-authority-key check, then ownership-scoped
   repository work.

Behavioral proof (pre = post): anonymous → 401 with **0 body pulls and 0
repository calls** (both GETs included); production cross-origin → 403 CSRF
with 0 pulls + 0 repo calls on every body method; 415/400/413 all with 0 repo
calls; the forbidden-key refusal fires before any repository access.

## Public methods

`publicJsonRoute` resolves the exact policy first, then media (415, 0 pulls),
then the bounded read (413 at 8 MB + 1; `AUTH_INVALID_JSON` on malformed), and
only then the callback — pinned with zero `buildBomRows`/`buildBom`/repository
calls on every refusal.

## Structural proof

All 12 methods classify `canonical-wrapper` by exact provenance
([bom-route-migration-manifest.csv](bom-route-migration-manifest.csv)); the §A
method-boundary and §C flow gates stay green; the ratchet TRANCHE_4 pins make a
revert to a raw handler fail CI.
