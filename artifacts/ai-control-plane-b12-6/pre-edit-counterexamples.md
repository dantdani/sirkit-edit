# B12.6 — pre-edit counterexample (verbatim)

Reproduced against PRODUCTION code before any edit with a disposable
probe (`app/lib/engineering/__tests__/__b126probe__.test.ts`, deleted
after capture; run: `npx vitest run … — 1 passed`). The composition uses
the REAL `createAutosaver` (its actual failure behavior: a failed write
returns `false` from `flush()`, records `{state:"error", detail}`, and
keeps the save PENDING — it does not throw) and the REAL
`ProjectTransitionCoordinator`, with a `beforeInstall` hook copied
verbatim from the current page.tsx composition:

```ts
beforeInstall: () => {
  try {
    autosaver.flush();          // ← boolean return DISCARDED
    return { ok: true };
  } catch (error) {
    return { ok: false, detail: … };  // ← unreachable: flush() never throws
  }
}
```

Sequence: install project A (pointer → A); `schedule()` dirty state
whose save returns `{ ok: false, reason: "quota" }`; request project B.

```
B12.6 R1 OBSERVED: {"events":["A","B"],"outcomes":[{"status":"installed"}],"saveStatus":{"state":"error","detail":"quota"},"transitionPending":false,"interlockRetired":false,"pointerMovedToB":true,"saveCalls":1}
```

**B installed and became current** (`events ["A","B"]`, one `installed`
outcome, pointer moved to B) **while the outgoing project's pending
state had FAILED to persist** (`saveStatus {state:"error",
detail:"quota"}`, the save still pending — a later healthy `flush()`
retried it: `saveCalls` went 1 → 2). The first five observed fields are
byte-identical to the independent verifier's reproduction.

The contrast making this a composition defect rather than an autosaver
defect: the autosaver is truthful (error status, retained pending
state), and the EXPORT handler already consumes the boolean correctly
(`const flushed = autosaverRef.current?.flush() ?? true; if (!flushed) …`)
— only the transition boundary discarded it. The B12.3-era comment above
the hook ("a failed flush surfaces transition-failed") was aspirational:
the `catch` it relied on can never fire, because `flush()` reports
failure by RETURN VALUE, not by exception.
