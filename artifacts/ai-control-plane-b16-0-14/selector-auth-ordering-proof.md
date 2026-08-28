# B16.0.14 §B — Selector-auth ordering proof (truthful)

## What is NOT claimed

This wrapper does **not** authenticate before the body. Project membership is
keyed by the project selector, which lives *in* the body, so membership cannot
be resolved until the selector is read. Claiming "full authentication before
body" here would be false.

## What IS guaranteed (and proven)

| Guarantee | Proof |
|---|---|
| Exact policy resolved first; fail closed if missing/incompatible | `policyFor` → 500 `policy-missing` gate |
| Same-origin CSRF **before any body pull** | production cross-origin → 403 with a counting body stream showing **0 pulls** (both the tranche pin and the wrapper gate) |
| Selector parse is strictly bounded + deadline-controlled | 64 KB / 10 s reader; oversized → 413 `payload-too-large`, malformed → `invalid-json`, both settle once |
| Identity/membership/role/capability AFTER selector extraction | valid selector + no identity → 401; malformed selector → `scope-malformed` **without** invoking identity (no 401 leaks through) |
| Selector never becomes authority | body `role/actor/principalId` ignored — resolved role is the **server-derived** `pcb_editor`, principal the verified `e1` |
| Zero business work until full authorization succeeds | the callback (the only place business logic runs) is unreachable until steps 1–9 pass; every refusal pin shows the snapshot/candidates never computed |

## Ordering trace (apply-authorization)

```
policy(/api/pcb/apply-authorization, POST)  →  requiresAuth+requiresCsrf ✓
  → requireSameOrigin(request)              →  403 (prod cross-origin), 0 body pulls
  → readBoundedJsonBody(64KB/10s)           →  413/415/400 legacy codes, no-store
  → scope envelope validation               →  scope-required / scope-malformed (400)
  → resolveTrustedRequestContext(selector)  →  401 unauth / 403 no-active-membership
  → policy.permittedRoles enforcement       →  403 AUTH_ROLE_DENIED (unreachable here: all roles permitted)
  → callback({ context })                   →  200 snapshot (server-derived role/principal/revision)
```
