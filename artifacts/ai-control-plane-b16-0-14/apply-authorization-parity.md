# B16.0.14 §E — apply-authorization parity

Migrated to `selectorEnvelopeJsonRoute({ maxBytes: 64_000, deadlineMs: 10_000 })`.
The route module now contains NO raw Request handler (no
`export async function POST`, no `authorizeRequest`, no `readBoundedJson`, no
`new URL(`) — only the wrapper call and the snapshot builder.

## Preserved exactly (pinned pre = post)

| Contract | Behavior |
|---|---|
| media | text/plain REJECTED → 415 `body-unsupported-media-type` (recorded) |
| CSRF | production cross-origin → 403 before any body pull (0 pulls) |
| body bounds | 64 KB / 10 s; over-limit → 413 `payload-too-large`; malformed → `invalid-json`; all `no-store` |
| selector | missing → `scope-required` (400); non-string fields → `scope-malformed` (400) |
| unauthenticated | 401, **no membership evidence** in the body |
| revoked / foreign | 403, no role/revision leak |
| success snapshot | `{ ok, principalId, role, membershipRevision, scope }` with `no-store` |

## Server-derived authority (proven)

The success snapshot's `principalId`, `role`, `membershipRevision`, and `scope`
all come from the trusted context. An attacker body carrying
`role:"admin", actor:"evil", principalId:"spoof", membershipRevision:999` is
ignored: the pin asserts `role === "pcb_editor"` (derived from the membership
"editor"), `principalId === "e1"`, `membershipRevision !== 999`, and
`scope === {trusted tenant/project/branch}`.

## No capability minted / no mutation

The route only REPORTS the live authorization snapshot — it mints no apply
capability, applies no proposal, performs no mutation. The approval
controller's existing comparison behavior is unchanged: the standing
`b16-0-1-apply-reauthorization`, `b16-0-2-required-apply-role`, and
`b16-0-2-session-identity` suites pass unchanged
([trusted-membership-proof.md](trusted-membership-proof.md)).
