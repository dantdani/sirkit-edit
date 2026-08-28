# B16.0.11 — Unknowns & owner decisions

## Documented behaviors preserved (not silently altered)

1. **Public BOM compute stays public.** The six download/compute methods remain
   unauthenticated by policy — an anonymous caller can spend distributor-pricing
   compute. Making them authenticated is a product/policy change the mandate
   explicitly reserves for a separate owner decision.
2. **Unreachable kind-branch difference.** The removed request-taking scope
   helper returned `BOM_API_UNAUTHENTICATED` 401 for a non-"authenticated"
   principal kind; the wrapper returns `AUTH_UNSUPPORTED_PRINCIPAL` 403 on that
   branch. With authenticated-only policy rows the branch is unreachable (any
   passing principal is of kind "authenticated"), so no pinned contract
   changes; recorded for completeness.
3. **DELETE /api/bom/notifications reads a body.** The older wrapper matrix
   suggested `authenticatedRoute`; production behavior (bounded JSON body,
   16 KB / 10 s) was treated as authoritative and the corrected target
   (`authenticatedJsonRoute`) is now reflected in the generated matrices.
4. **Cart-pin URL correction.** Three pre-edit pins posted to a synthetic
   placeholder path; corrected to the real route paths (the wrapper resolves
   the exact policy from the path, as production does). Zero assertion changes;
   disclosed in behavioral-parity-results.

## Unknowns carried forward

- **R9 live-Supabase production auth remains UNKNOWN** (identity via injected
  seams only; no live DB contacted).
- Remaining migration: **98 raw methods** (baseline 101 incl. factory entries)
  across spice, pcb, chat, calculation, schematic-compiler and other families;
  the high-risk streaming routes (chat, replacement-authority) still need their
  dedicated wrapper variants.

## Scope adherence

Work confined to `sirkit-edit`; `C:\Users\robsa\sirkit` untouched; no live
distributor calls; no database migrations or writes; no provider credits; no
prompt/provider changes; B16.0.12 / B16.1 / MCP / multi-agent /
manufacturing-release exposure NOT started.
