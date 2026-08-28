# B16.0 — unknowns and owner decisions

## Decisions (documented)
1. **Scope of the code migration = the release perimeter.** R02-B1-011 is
   about the release perimeter ("close R02-B1-011 before exposing
   manufacturing release"). The five release-perimeter routes (pcb-sync,
   qualify, release, physical-bindings, assignment-queue) plus chat are
   migrated to server-derived identity. The 12 CD-stage `_scope.ts` families
   remain on the legacy header path as a CLASSIFIED, CI-pinned backlog
   (labelled local-dev convenience) — not silently, but explicitly in
   `auth-route-coverage.csv` and enforced by the forbidden-header gate.
2. **local_dev honors the SELECTOR headers, not identity.** `x-sirkit-{tenant,
   project,branch}-id` remain selectors (allowed); `x-sirkit-{role,actor-id,
   actor-kind}` are ignored for authority (forbidden by the gate on the
   migrated set). The fixed local principal is `project_admin`.
3. **Supabase SDK isolation.** The SDK is imported behind a lazy static
   `import("@supabase/ssr")` inside the identity adapter only; the identity
   LOGIC is fully injected in tests, so no test contacts Supabase Auth.
   Exact versions are locked in `package.json`.
4. **`/api/auth` is a self-service session boundary** (signout), classified
   `body-scope-server-actor` — it needs no project membership (a user logs
   themselves out).

## CONFIRMED
- Forged `x-sirkit-role`/`x-sirkit-actor-id`/`x-sirkit-actor-kind` grant
  nothing on the migrated perimeter; caller headers no longer establish
  identity or role there.
- Production fails closed without configured authentication (403).
- Membership is server-owned; revoked/foreign/insufficient fails closed;
  role derives from a closed table, never metadata.
- The worker boundary can never mint a human; the AI cannot claim human via
  headers or tool args.
- Exactly 12 tools; release stays internal-only.

## INFERRED
- The Supabase adapter's `getClaims()` path is correct against the current
  official SDK (0.12.4) but is exercised in tests only through an injected
  verifier; the live cookie→claims round-trip is validated by the SDK, not by
  this suite. A production smoke test against a real Supabase project is the
  natural follow-up.
- The `proxy.ts` token-refresh wiring follows the official pattern; it is not
  exercised by the node test environment (no Next request pipeline).

## PROPOSED (not done in B16.0)
- Migrate the 12 legacy CD-stage `_scope.ts` families to the trusted context
  (the backlog). Each is straightforward given the shared resolver.
- Bind the sealed PCB/schematic proposal body to `membershipRevision`
  explicitly (today the value is available on the context and a revoked
  member is refused before a new proposal is issued; wiring it into the
  sealed body is a hardening).
- Bring the latent state-changing `none`-identity routes (`bom/snapshot`,
  `spice/*` writes, AI `pcb/*`/`schematic/*`) under an auth policy.

## UNKNOWN
- The pre-existing `pcb-repair-agent` performance-threshold flake
  (`generatedInMs < 250`) — passes 8/8 in isolation; unrelated to B16.0.
