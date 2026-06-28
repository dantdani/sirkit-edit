# Layer-2 LLM design review

Date: 2026-06-26 · Status: done (ground-truth builder unit-tested)

## What
An advisory, non-blocking LLM critic layered ON TOP of the deterministic
validator — the "does this circuit make sense?" pass (missing pull-ups,
decoupling, current-limit resistors, floating enable pins, undriven power).

- **`lib/netlist-review.ts`** (`buildReviewInput`) — computes the exact net
  partition (components + nets + an explicit floating-pins list) as ground
  truth, deterministically, so the model reasons over the netlist not pixels.
- **`/api/schematic/review`** — `claude-sonnet-4-6` returns findings via a
  forced tool; the route **cross-checks** any "unconnected" claim against the
  ground-truth floating set and **drops contradicted findings** (anti-hallucination).
- **Chat surface** — a **Review** button (in the bottom row beside
  Ask/Edit/Generate) posts findings as a chat message.
- **Auto-run** — a debounced (~1.2s) effect runs the review after an AI
  generate/edit (token bumps in lockstep with the state update); coalesces
  rapid edits. Not on manual canvas edits.

This is a grounded + verified critic, not a vanilla LLM-as-judge — the
deterministic netlist overrules it on anything checkable.

## Files
`lib/netlist-review.ts`, `app/api/schematic/review/route.ts`, `app/lib/prompts.ts`, `app/page.tsx`
