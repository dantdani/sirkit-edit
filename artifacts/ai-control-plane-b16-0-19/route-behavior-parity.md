# B16.0.19 §B — Route behavior parity (CONFIRMED)

Prologues (`scopedJson(request)`) became `authenticatedJsonRoute` callbacks:
`{ body }` for ck/applicability, ck/compile, ck/compose; `{ context, body }` +
the family projector for ck/problem, ck/propose, cv/problem, cv/propose,
cv/readiness, cv/run. Business logic byte-identical EXCEPT the two propose
routes' §D/§F error-boundary hardening (intentional; pinned in the separate
proposal-validation suite). All 77 §A pins pass pre = post with zero assertion
changes; both standing route suites pass unchanged.

## Role separation — all nine routes deny viewer (403); permitted =
pcb_editor, reviewer, project_admin, automation (both propose routes are
provider-credit). Pinned per-route.

## Material headers preserved

`Cache-Control: no-store` on every success; `X-Sirkit-AI-Provider` on both
propose routes — byte-identical.
