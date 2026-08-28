# B16.1A — unknowns & owner decisions

## Decisions taken this stage

1. **Did not redo the merged integration.** PR #2 (one integration commit +
   the pnpm CI fix, correct authorship, no AI trailer) had already landed on
   `main` before this stage's ten-group commit plan arrived. Splitting it now
   would require rewriting published history — forbidden. The grouping is
   recorded as a map in [commit-plan.md](commit-plan.md). **CONFIRMED**.
2. **Benchmark §F hardening** (failure artifacts + junit) added as a separate
   commit — the only genuine §F gap; no thresholds/assertions touched.
3. **CRLF root fix.** The Windows checkout had smudged the tree to CRLF,
   which (a) broke the `\n`-pattern source-scan gate in
   `b16-0-2-session-identity` and (b) shifted the route-file sha1s inside the
   regenerated ratchet baseline. Fixed at the root: local re-checkout as LF
   plus a committed `.gitattributes` (`* text=auto eol=lf`; renormalization
   produced ZERO content changes — the blobs were already LF). After the fix
   the sanctioned generators reproduce the committed files BYTE-IDENTICALLY.
4. **Restored, not committed, the CRLF-era regenerated baseline/matrix** —
   the transient regen delta was a checkout artifact, not content drift.

## Residuals / owner options (no action taken unilaterally)

- **GitHub App installations** cannot be enumerated with the CLI OAuth token;
  owner can confirm none exist at github.com/settings/installations.
- **Branch protection on `main` is OFF** — no required checks are formally
  enforced; benchmark-quality runs on PRs but a direct push would bypass it.
  Recommend a protection rule requiring `benchmark-core`. Owner decision.
- **The closed PR #1 branch** (`integration/ai-control-plane-b16-0`) still
  exists remotely; its unmerged commit message carries an AI co-author
  trailer. It is retained only as a recoverable backup; deleting it after
  this stage merges is an owner option.
- **Action SHA-pinning** (supply-chain hardening of `actions/*@v4` tags to
  full commit SHAs) — recommended, not silently changed.
- **Repo-wide ESLint debt**: 33 pre-existing errors (React refs/effect rules)
  in old UI files (`app/page.tsx`, `app/components/pcb/*`), untouched by any
  B16.x stage; this stage's only code change is workflow YAML. Recorded, not
  hidden.
- **LIVE Supabase** behavior (real network/project) remains UNKNOWN — only
  the SDK boundary contract is proven (B16.0.24.1).

## Honest limitations restated

Access revocation cannot erase clones or downloads Shantanu (or anyone) made
while access existed; historical commits remain visible to any reader of the
private repository.
