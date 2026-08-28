# B15.2.2 — unknowns and honest limits

1. **Pre-existing unrelated flake (deliberately NOT repaired).**
   `assignment-queue-panel.test.tsx › physical assignment workbench › does
   not preselect a candidate and requires preview plus explicit exact-plan
   confirmation` failed once in the first full-suite run and once across
   three isolated runs, then passed six consecutive isolated runs. It is
   intermittent **in isolation**, so it is not a load artifact; it imports
   none of the modules this stage changed. Left alone because the stage
   forbids silently repairing unrelated failures. **Recommend separate
   triage.**

2. **Roundrect segment containment relies on convexity.** Rect and roundrect
   are convex, so "both endpoints inside ⇒ segment inside" is sound. This is
   documented in the module and permanently tested (§A R22d). A future
   non-convex outline kind must NOT reuse that branch — polygons already
   take the full boundary-parameter path.

3. **`ExactOutline` is structurally assignable from `BoardOutline`.** The
   compiler passes `board.outline` through a cast. The three kinds and their
   fields match today; if `BoardOutline` gains a kind, the cast must be
   revisited (the exact authority would treat an unknown kind as a polygon
   and fail on missing `points` — fail-closed, but unhelpful).

4. **`validateProposalShape` re-parses the operations on every
   verification.** It calls the canonical `parseBoundedEditRequest` and
   compares the canonical normalized form. That is the point (it proves each
   sealed operation is supported), but it means verification cost scales
   with operation count — bounded at 16 operations, so negligible in
   practice, and recorded here rather than assumed away.

5. **Everything downstream of the sealed core remains unbuilt** (H–K:
   registry exposure, gateway/loop, `pcb_proposal_ready`, review UI,
   approval/apply, durability/recovery). B15.2.2 is core-only; the tool
   stays unexposed at exactly 11 agent tools.
