# B12.7 — root cause

## R1 — the ordering hazard inside `createAutosaver.run()`

```
pending = false;                 // cleared BEFORE the attempt
setStatus("saving");
try { result = save(); }
catch (error) {
  result = { ok: false, reason: error instanceof Error ? error.message
                                                       : String(error) };
                                  // ← String(hostile) THROWS here
}
…
pending = true;                   // ← never reached
setStatus("error", …);            // ← never reached
```

The catch's own diagnostic conversion was a throw path: `String(value)`
invokes `Symbol.toPrimitive`/`toString`, and `error.message` invokes a
getter. A hostile thrown value therefore escaped `run()` BETWEEN
`pending = false` and the failure path's `pending = true` — the exact
window in which the pending write exists nowhere. Status stayed
`"saving"` forever (no state transition ever completed), and the next
`flush()` observed `!pending` and truthfully reported "nothing to do":
`{ ok: true }` with the user's work silently gone. The B12.6 settlement
then converted the ESCAPED exception into a typed failure — masking that
the autosaver underneath had already lost the write.

## R2/R3 — the settlement's catch had the same disease

`settleAutosaveForTransition`'s catch rendered the thrown value with
`error instanceof Error ? error.message : String(error)` — both arms can
throw (hostile `message` getter; unstringifiable object), so the
boundary that exists to convert failures into typed outcomes could
itself throw into the coordinator's hook guard.

(The coordinator caught that and produced `transition-failed`, so no
install proceeded — but the outcome's provenance was accidental, the
detail came from the conversion trap rather than the save failure, and
the pending-loss of R1 sat underneath it.)

## R4 — truthiness where a witness was required

`if (flushed) return { ok: true };` accepted ANY truthy runtime value as
proof of persistence. `flush()`'s contract returns a boolean, but the
settlement is exactly the place where foreign/erroneous implementations
must be witnessed, not trusted: only the literal `true` may settle ok.

## Why B12.6 missed it

B12.6's hostile tests threw `Error` instances with well-behaved
messages and returned genuine booleans — every diagnostic conversion in
scope succeeded. The conversion paths themselves were never treated as
attack surface, though B11.2 §D had already established the pattern
("String(x) invokes a hostile toString") elsewhere in the codebase.
