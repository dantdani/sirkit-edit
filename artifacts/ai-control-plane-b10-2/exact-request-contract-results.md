# B10.2 §B — exact selection contract

## Change (`app/api/chat/route.ts`)

`editorContext.selection` now requires EXACTLY `{ refs, primary }`:

- `exactObjectShape(selection, "editorContext.selection", ["refs", "primary"])`
  — a missing `primary` returns 400 (`missing the required key "primary"`)
  BEFORE any provider invocation; unknown/authority-shaped keys keep
  refusing by name (B10.1 behavior preserved).
- `refs` must be an array (400 otherwise).
- `primary` must be `null` or a STRUCTURALLY VALID selection reference —
  validated by THE shared parser `parseSelectionRef` (newly exported from
  `app/lib/agent/context.ts`; the same parser the assembler uses — no
  duplicated shape definition). A malformed primary (e.g. `{kind:"track"}`
  without an id) returns 400.

## Results (`b10-2-closure.test.ts` §B — all pass)

| Case | Result |
| --- | --- |
| `{ refs: [] }` (no primary) — the R4 counterexample | **400** `missing the required key "primary"` |
| `primary: { kind: "track" }` (no id) | **400** "structurally valid selection reference" |
| `primary: null` | 200 (run proceeds) |
| `primary: { kind: "track", id: "t1" }` | 200 (run proceeds) |

The B10/B10.1 suites (complete-contract, authority-claim, and valid-path
cases) remain green — the bridge always emits both keys, so no production
client behavior changed.
