# B16.0.16 §B — Route behavior parity (CONFIRMED)

Each route's boundary prologue
(`export async function POST(request) { const parsed = await scopedJson(request); … }`)
became
`export const POST = authenticatedJsonRoute({ maxBytes: 12_000_000, deadlineMs: 30_000 }, async ({ context, body }) => { const scope = calculationScopeFromContext(context); … })`
(the three body-only routes — corners, evaluate, feedback — take `{ body }`).
Everything after the prologue is byte-identical; the 67 pins pass pre = post
with zero assertion changes.

## Callback projections

| Route | Callback input | Uses scope? |
|---|---|---|
| corners | `{ body }` | no |
| evaluate | `{ body }` | no |
| feedback | `{ body }` | no |
| export | `{ context, body }` | yes → `calculationScopeFromContext(context)` |
| problem | `{ context, body }` | yes |
| propose | `{ context, body }` | yes |
| report | `{ context, body }` | yes |
| transaction | `{ context, body }` | yes |

None receives Request, Headers, cookies, raw URL, host, or origin.

## Role separation (policy-exact, unchanged)

| Route group | Permitted roles | viewer |
|---|---|---|
| corners, evaluate, feedback, problem, propose | pcb_editor, reviewer, project_admin, automation | 403 |
| transaction | pcb_editor, reviewer, project_admin | 403 |
| export, report | ALL members | admitted → required-field |

The wrapper enforces `policy.permittedRoles` via `authorizeRequest` — the same
enforcement `scopedTrustedJson` performed. No fallback widens roles.

## Material headers preserved

`Cache-Control: no-store` on every success path; `X-Sirkit-AI-Provider` on
propose; `Content-Disposition: attachment; filename="sirkit-calculation-<id>.json"`
on export — all byte-identical.
