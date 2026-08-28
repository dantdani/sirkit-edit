# B14.2 §D — the approval-controller import boundary

## The defect (R2)

`approveAndApplyReplacement` was a public export callable with ordinary
apply dependencies — it issued BOTH capabilities itself, and the permanent
walker protected only `replacement-approval.internal`, so a future API
route, agent runtime, provider adapter, or generic service could import the
controller without tripping any gate.

## The closure

- **Split**: safe `proposal_ready` discrimination moved to
  [replacement-proposal-events.ts](../../app/lib/project/replacement-proposal-events.ts)
  (freely importable, grants nothing); the authority-bearing controller
  became the INTERNAL composition-boundary module
  [replacement-approval-controller.internal.ts](../../app/lib/project/replacement-approval-controller.internal.ts).
- **Permanent walkers** (b14-2-settlement-and-boundaries suite):
  - `replacement-approval-controller.internal` importers ⊆ {itself,
    `app/page.tsx`} — API routes, agent runtime/gateway/loop, provider
    adapters, registries, generic engineering services, scripts, and
    barrels are outside the approved set by construction;
  - `project/replacement-reauthorization` importers ⊆ {itself, the internal
    controller, the approved-replacement service};
  - `__createTestReplacementReauthorizationChannel` referenced by NO
    production file;
  - the engineering barrel exports none of the approval/reauthorization/
    apply capabilities.
- **Negative tripwire**: the walker logic runs over an in-memory file map;
  injecting a synthetic `app/api/evil/route.ts` (and `app/lib/agent/evil.ts`)
  importing the controller — or a synthetic engineering service importing
  the test factory — FAILS the gate, proving the detector actually detects.
- The one-shot `ReplacementApprovalIntent` and its own walker are unchanged.

## The honest guarantee

This boundary proves TRUSTED INTERACTIVE COMPOSITION: the only production
path to the apply service is the shipped review dialog's explicit click
through page.tsx and the internal controller. It is NOT cryptographic proof
of a physical human — no browser API provides that. The load-bearing
evidence remains the rendered-dialog click integration test (which still
commits exactly one transaction through the production transport) plus
these import gates.

---

> **SUPERSESSION NOTE (B14.3).** The channel-module walker described here
> relied on the raw substring `project/replacement-reauthorization`, which a
> same-directory `./replacement-reauthorization` import (or an equivalent
> parent-relative/alias/dynamic/re-export spelling) evaded. The gates now
> EXTRACT and RESOLVE every import specifier against the importing file's
> path (approved importer sets unchanged), with equivalent-spelling
> tripwires and a soundness check (non-import occurrences of the module name
> are ignored). See `../ai-control-plane-b14-3/capability-import-gates.md`.
