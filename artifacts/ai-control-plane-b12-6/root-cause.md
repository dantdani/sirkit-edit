# B12.6 — root cause

## The signal-shape mismatch

`createAutosaver` ([app/lib/project/autosave.ts](../../app/lib/project/autosave.ts))
is deliberately truthful and non-throwing: `flush()` runs the pending
write and returns `false` on failure, records
`{ state: "error", detail: reason }`, and KEEPS the write pending
(`pending = true` — "failed writes stay pending — never silently
discarded"). It converts even a THROWING save function into that same
false-return shape. It never throws.

page.tsx's transition hook (introduced in B12.3 §F) guarded the wrong
signal:

```ts
beforeInstall: () => {
  try {
    autosaverRef.current?.flush();   // boolean DISCARDED
    return { ok: true };
  } catch (error) {                  // unreachable: flush() never throws
    return { ok: false, detail: … };
  }
}
```

The B12.3 comment above it ("a failed flush surfaces
`transition-failed`") described the intent, not the behavior: every
`flush()` call — success or failure — flowed into `return { ok: true }`.

## Why every later stage preserved the defect

B12.4 §D and B12.5 §C/§D hardened everything DOWNSTREAM of the hook's
outcome — reactivation, typed installs, pointer commit ordering,
reentrant settlement — all keyed off `{ ok: false }` hook outcomes that
this composition could never produce for a failed save. The B12-family
tests modeled failing flushes with hooks that RETURN `{ ok: false }`
directly (the coordinator's contract), so the coordinator's handling was
proven while the page's translation from autosaver-reality to that
contract went unexercised. The contrast inside the same file is the
tell: the EXPORT handler consumes the boolean correctly
(`const flushed = autosaverRef.current?.flush() ?? true; if (!flushed) …`).

## Consequence (reproduced)

With a quota-failing save pending on project A, requesting project B
yielded `events ["A","B"]`, one `installed` outcome, pointer moved to B,
`saveStatus {state:"error", detail:"quota"}`, `transitionPending` false,
active B interlock — A's unpersisted work left behind on a project that
is no longer visible, current, or flushed by anything (its autosaver was
about to be destroyed by the remount lifecycle), surviving only because
the autosaver keeps failed writes pending in memory until teardown.
