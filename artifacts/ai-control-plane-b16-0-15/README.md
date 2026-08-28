# B16.0.15 — Manufacturing qualification & release boundary migration, tranche 8

The final two high-risk manufacturing routes are now canonical-wrapper adopted:

- **POST /api/pcb/qualify** → `authenticatedJsonRoute({ maxBytes: 8_000_000, deadlineMs: 30_000 })` (authenticated-release; **pcb_editor | project_admin**).
- **POST /api/pcb/release** → `authenticatedJsonRoute({ maxBytes: 8_000_000, deadlineMs: 30_000 })` (authenticated-release; **project_admin only**).

Both previously composed `scopedPcbSyncJson`; that shared helper is **kept**
(pcb-sync still depends on it) and given Request-free companions
(`pcbSyncScopeFromContext`, `pcbSyncForbiddenAuthorityRefusal`,
`PCB_SYNC_API_DEADLINE_MS`) so the two routes adopt the wrapper's trusted
context + parsed body without weakening the family.

## The discovered deadline (CONFIRMED)

`scopedTrustedJson` passes **no** `deadlineMs`, so the reader's **30 s default**
(`DEFAULT_BODY_DEADLINE_MS`) has always applied. The wrapper adopts
`deadlineMs: 30_000` explicitly — the exact existing value, not a new one.

## Results at a glance

| Metric | Value |
|---|---|
| Behavioral pins (pre = post) | **23** ([pre-edit-counterexamples.md](pre-edit-counterexamples.md)) |
| Manufacturing boundary + tripwire gates | **10** ([internal-only-release-proof.md](internal-only-release-proof.md)) |
| Role separation | viewer/commenter/reviewer → 403; pcb_editor reaches qualify but never release; only project_admin reaches release ([role-and-policy-proof.md](role-and-policy-proof.md)) |
| Forbidden authority keys | snapshot/board/path → exact `AUTH_AUTHORITATIVE_INPUT_FORBIDDEN` (byte-identical, in-callback) |
| Zero-work on every refusal | getBoard / router / qualifyLayout / authority.save / authority.get / releasePackage all zero ([expensive-work-zero-call-proof.md](expensive-work-zero-call-proof.md)) |
| Release locator | pinned from trusted context + **stored** authority revision/digest; attacker body fields ignored ([release-authority-pinning.md](release-authority-pinning.md)) |
| Release bytes/headers | ZIP body + all 4 `X-Sirkit-*` headers + Content-Disposition preserved ([release-artifact-byte-and-header-parity.md](release-artifact-byte-and-header-parity.md)) |
| Internal-only release | discovery internal-only / not-callable / agentExposed false; **exactly 12** tools; neither route is an agent tool ([internal-only-release-proof.md](internal-only-release-proof.md)) |
| Ratchet | 82 → **80** (2 removed, 0 added) |
| Inventory | **153 total · 73 canonical · 3 factories · 77 raw** |
| Full suite | **recorded in [test-and-validation-report.md](test-and-validation-report.md)**; tsc 0; eslint 0; git clean; generators ×2 byte-stable |

## Documents

pre-edit-counterexamples · [manufacturing-route-migration-manifest.csv](manufacturing-route-migration-manifest.csv) ·
qualification-boundary-parity · qualification-transactional-safety ·
release-boundary-parity · release-authority-pinning ·
release-artifact-byte-and-header-parity · role-and-policy-proof ·
expensive-work-zero-call-proof · abort-and-settlement-evidence ·
internal-only-release-proof · request-and-callback-confinement ·
ratchet-and-inventory-results · changed-files · test-and-validation-report ·
superseded-claims · unknowns-and-owner-decisions · [final-verdict.md](final-verdict.md)

## Scope

No provider credits, no live routing process, no live DB writes, no network;
`C:\Users\robsa\sirkit` untouched. B16.0.16 / B16.1 NOT started.
