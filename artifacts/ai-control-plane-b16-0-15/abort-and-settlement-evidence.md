# B16.0.15 §G — Abort & settlement evidence (CONFIRMED)

## No `exposeAbortSignal` needed (INFERRED → CONFIRMED)

Neither manufacturing route ever consumed `request.signal` (the pre-edit raw
handlers had no signal reference). The expensive/durable work lives entirely in
the callback, which the wrapper does not invoke until the bounded reader has
fully and successfully read the body. A pre-aborted request is therefore
refused by the reader BEFORE the callback — so no qualification, router
resolution, routing process, durable authority load, or release generation can
begin. Exposing the signal would add capability the routes do not use, so the
wrapper is adopted WITHOUT `exposeAbortSignal`.

## Proven (pins)

| Property | Evidence |
|---|---|
| auth/membership/role/CSRF/media/bounded-parse/body-validation all precede expensive work | every refusal pin shows zero durable/expensive calls |
| a pre-aborted request cannot start qualification / router / process / release load / release gen | pin: pre-aborted → 400 `AUTH_BODY_ABORTED`, all seven seams zero |
| oversized / never-ending bodies settle under the bounded reader | 8 MB+1 → 413; the shared 30 s deadline bounds a stalled body (the standing B16.0.4 bounded-reader suite) |
| reader cancellation is non-blocking; late rejection not unhandled | inherited from the canonical `readBoundedJsonObject` (proven in the standing bounded-json suite) — unchanged by this stage |
| exactly one terminal response per request | the wrapper returns a single Response on every path; no route code races a second response |
| no durable mutation begins after a boundary refusal | zero `publishBoard`/`authoritySave`/`releasePackage` on all refusals |

The autonomous qualification executor and release gate were NOT redesigned in
this stage (§G).
