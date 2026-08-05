# Footprint Resolver Stage 2

## Contract

`FootprintResolutionService` is the only Stage 2 entry point for footprint decisions. It accepts `sirkit.footprint-resolution-request.v1`, authorizes project read access, loads one tenant/project/branch/board/component/variant snapshot from Stage 1, runs bounded adapters, freezes the context, and passes it to the pure deterministic engine.

The engine returns `sirkit.footprint-resolution-result.v1`. `resolved` means exactly one current selected binding passed approval, technical validation, freshness, conflict, package compatibility, immutable footprint availability, verified pin-pad mapping and Stage 1 readiness for the declared purpose. It never means “only candidate,” “highest score,” “looks similar,” or “AI suggested it.”

## Source precedence

1. selected Stage 1 binding;
2. approved exact-part binding;
3. approved explicit component assignment;
4. approved symbol-attached fact;
5. approved normalized-package mapping;
6. passive-policy hook, disabled until Stage 5;
7. suggestions/legacy/AI, never authoritative.

Precedence is applied after validation, eligibility and conflict analysis. Two materially different approved applicable assets block; array order and confidence never break a tie. Equivalent aliases merge only when immutable part/package/asset/mapping identity agrees. Library nicknames and display names are not identity; content and mapping digests are.

## Purposes

- `preview`, `layout_transfer`, `migration_analysis`, and `shadow_comparison` require the full layout-safe selected/approved/current/verified contract.
- `manufacturing_assessment` additionally requires every Stage 1 manufacturing gate.
- Explicit current DNP returns `not_applicable` without a fake footprint.

## Status priority

Blocking conflict wins first; then integrity/validation failure, stale/revision mismatch, unavailable source/asset, unsupported state, explicit ambiguity, missing data, approval, and deferred user decision. All blockers remain in the result even when one status summarizes them. Stale approval/validation digests are classified as stale evidence rather than generic corruption.

## Bounds and security

- 256 candidates and 256 requests per batch.
- 2,048 trace steps.
- 1,500 ms per adapter.
- 4 MB JSON API body.
- `application/json` required.
- Tenant/project/branch/actor scope comes from server-side request headers and overwrites body scope.
- Diagnostic trace requires reviewer/admin authority.
- Adapter exceptions and secrets are not returned.
- Telemetry contains a project pseudonym, versions, status/reason/source/disposition and timings—never component IDs or raw tenant/project IDs.
- Cache is disabled (`no-cache/1`) because measured evaluation is cheap and invalidation risk is not justified.

## API

`GET /api/footprint-resolution` reports exact versions, policy, read-only state and rollout boundary. `POST` supports `resolve`, `explain`, `batch`, and `compare`. Every response is `no-store`. Ordinary component blockers are returned as structured results; malformed/unauthorized/system-level requests fail before persistence.

## Shadow mode

`withFootprintResolverShadow` executes production first and always returns that exact value. When enabled, it performs one bounded resolver call and emits a stable comparison category. Failure or timeout becomes `new_error`; it cannot write back or change schematic-to-PCB output. The known generic-capacitor discrepancy is classified as high-risk `legacy_default_new_requires_policy`.

## Stage 3 integration rule

Do not feed suggestions, `consideredCandidates`, display strings, or legacy comparison output into board creation. Stage 3 may consume only `status === "resolved"` plus `resolvedBinding`, and must verify the supplied dependency digest/revisions immediately before applying an undoable schematic-to-PCB transaction.

