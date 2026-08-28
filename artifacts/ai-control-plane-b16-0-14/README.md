# B16.0.14 — Selector-envelope authorization & footprint-search service closure, tranche 7

The two routes deferred from B16.0.13 are now closed:

- **POST /api/pcb/apply-authorization** → the new canonical
  `selectorEnvelopeJsonRoute` (64 KB / 10 s), preserving its exact legacy
  contract (CSRF-before-body, legacy refusal codes, no-store snapshot).
- **POST /api/pcb/assign/suggest** → `authenticatedJsonRoute` (16 MB / 45 s),
  with its internal HTTP `fetch` replaced by a **direct call to a shared,
  Request-free footprint-search service** — closing the raw-request-origin SSRF
  surface.

The substantive hybrid search was extracted from
`app/api/pcb/footprints/search/route.ts` into
`app/lib/pcb/footprint-search-service.ts`, so the public search route and the
provider loop share ONE implementation and neither reconstructs a request.

## Truthful ordering (the point of the new wrapper)

Project membership cannot be resolved before the body selector exists, so
`selectorEnvelopeJsonRoute` does **not** claim "full authentication before
body". What it guarantees by construction: **exact policy + same-origin CSRF
before any body pull**, a **strictly bounded/deadline-controlled** selector
parse, then **identity + live membership + server-derived role + capability**
authorization *after* selector extraction — and **zero business work** until
all of that succeeds. See
[selector-auth-ordering-proof.md](selector-auth-ordering-proof.md).

## Results at a glance

| Metric | Value |
|---|---|
| Behavioral pins (pre = post) | **14** ([pre-edit-counterexamples.md](pre-edit-counterexamples.md)) |
| Selector-envelope wrapper runtime + structural gates | **13** ([selector-envelope-wrapper-contract.md](selector-envelope-wrapper-contract.md)) |
| B16.0.12 footprint-search parity | **24 / 24 unchanged** after extraction ([public-search-route-parity.md](public-search-route-parity.md)) |
| apply-reauthorization / session-identity / required-apply-role | green unchanged ([trusted-membership-proof.md](trusted-membership-proof.md)) |
| Media behavior (RECORDED) | apply-authorization historically **rejects text/plain** → 415 `body-unsupported-media-type` (preserved) |
| SSRF | closed — no `fetch`, no request URL/origin/host in the route or the service ([ssrf-and-raw-origin-closure.md](ssrf-and-raw-origin-closure.md)) |
| Ratchet | 84 → **82** (2 removed, 0 added) |
| Inventory | **153 total · 71 canonical · 3 factories · 79 raw** |
| Full suite | **PENDING (recorded in test-and-validation-report)**; tsc 0; eslint 0; git clean; generators ×2 byte-stable |

## Documents

pre-edit-counterexamples · selector-envelope-wrapper-contract ·
selector-auth-ordering-proof · apply-authorization-parity · trusted-membership-proof ·
footprint-search-service-contract · public-search-route-parity · assign-suggest-parity ·
ssrf-and-raw-origin-closure · prompt-tool-provider-parity · callback-and-service-confinement ·
ratchet-and-inventory-results · changed-files · test-and-validation-report ·
unknowns-and-owner-decisions · [final-verdict.md](final-verdict.md)

## Scope

No provider/embedding credits, no live DB, no network; `C:\Users\robsa\sirkit`
untouched; 12 tools / replay pins / hashes / internal-only release preserved.
B16.0.15 / B16.1 NOT started.
