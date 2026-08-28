# B16.0.18 §C/§F — Catalog authority (CONFIRMED / by construction)

The migration touched only boundary prologues (plus propose's §E hardening);
all catalog-authority code is byte-identical and covered by the standing
routes.test + component-selection domain suite (green unchanged).

| Rule | Status |
|---|---|
| pinned snapshot required before query/evaluation/proposal | CONFIRMED — catalog: 400 `pinned engineering catalog snapshot is required`; propose: catalog-digest binding 422 (pinned); evaluate validates catalog first |
| exact manufacturer identity resolution uses pinned snapshots only | UNCHANGED — `resolve_identity` operates over the supplied validated snapshot; `manufacturerId and mpn are required` 400 preserved |
| unknown properties remain unknown | UNCHANGED — evaluation carries unknowns; no route fabricates values |
| no route invents price/stock/lifecycle/CAD/footprint/electrical facts | CONFIRMED — sourcing refresh fail-closes rather than inventing; the provider proposal carries only filters; no fetch exists in any route (gated) |
| no fuzzy result becomes exact authority | UNCHANGED — exact atomic identity flows only through pinned `atomicPartRevisionIds`; propose refuses out-of-snapshot revisions (`CD6_AGENT_ATOMIC_REVISION_OUT_OF_SNAPSHOT`, pinned) |
| no provider value becomes verified evidence | CONFIRMED — proposal_only authority; `hardGateResults: []`; `selectedPart: null`; strict output validation before the domain factory |
| no external part-server/distributor integration added | CONFIRMED — the §H gate scans every route for fetch/network/distributor identifiers |
