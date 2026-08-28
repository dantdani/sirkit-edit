# B12.7 — pre-edit counterexamples (verbatim)

All four reproduced against PRODUCTION code before any edit with a
disposable probe (`app/lib/engineering/__tests__/__b127probe__.test.ts`,
deleted after capture; run: `npx vitest run … — 4 passed (4)`). The
hostile thrown value used throughout traps every conversion path
(`Symbol.toPrimitive`, `toString`, `valueOf` all throw
`Error("conversion trap")`).

## R1 — real createAutosaver pending-loss

Real `createAutosaver` whose save callback throws the unstringifiable
value; pending work scheduled; `settleAutosaveForTransition` called
twice:

```
R1 OBSERVED: {"first":{"ok":false,"detail":"autosave flush threw: conversion trap"},"afterFirst":{"state":"saving"},"second":{"ok":true},"afterSecond":{"state":"saving"},"calls":1}
```

Byte-identical to the independent verifier's observation. `run()` clears
`pending` BEFORE calling `save()`; its catch renders the thrown value
with `String(error)`, whose conversion itself throws BEFORE the failure
path restores `pending = true` and sets the error status. Consequence:
the pending write is LOST (the second settlement reports `{ok:true}`
without ever retrying — `calls` stays 1) and status is stranded at
`"saving"` forever.

## R2 — foreign flush throws an unstringifiable value

`settleAutosaveForTransition` ITSELF throws instead of returning a typed
failure — its catch runs `String(error)` on the hostile value:

```
R2 OBSERVED: settlement threw: conversion trap
```

## R3 — foreign flush throws an Error whose message getter throws

`error instanceof Error` is true, so the catch reads `error.message` —
the getter's exception escapes the settlement:

```
R3 OBSERVED: settlement threw: message trap escape   (thrown Error's message: "message trap")
```

## R4 — truthy non-Boolean flush result

`if (flushed)` is a TRUTHINESS check, so a foreign flush returning
`"yes" as unknown as boolean` settles as success:

```
R4 OBSERVED: {"ok":true}
```
