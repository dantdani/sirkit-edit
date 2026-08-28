# B16.0.18 §B — Route behavior parity (CONFIRMED)

Each route's prologue
(`export async function POST(request) { const parsed = await scopedJson(request); … }`)
became
`export const POST = authenticatedJsonRoute({ maxBytes: 12_000_000, deadlineMs: 30_000 }, async ({ context, body }) => { const scope = componentSelectionScopeFromContext(context); … })`
— the five routes that never consumed the scope (alternative, catalog,
evaluate, feedback, sourcing) take `{ body }` only. Business logic is
byte-identical except the propose route's §E error-boundary restructure
(an intentional, mandated change pinned in the NEW proposal-validation suite;
the §A parity suite pins only contracts identical pre = post, and passes with
zero assertion changes).

## Callback projections

| Routes | Callback |
|---|---|
| alternative, catalog, evaluate, feedback, sourcing | `{ body }` |
| export, problem, propose, solve, transaction | `{ context, body }` → `componentSelectionScopeFromContext(context)` |

None receives Request, Headers, cookies, raw URL, host, origin, or streams.

## Role separation (policy-exact, unchanged)

| Route group | Permitted | viewer |
|---|---|---|
| alternative, evaluate, feedback, problem, propose, solve, sourcing | pcb_editor, reviewer, project_admin, automation | 403 |
| transaction | pcb_editor, reviewer, project_admin | 403 |
| catalog, export | ALL members | admitted → required-field |

## Material headers preserved

`Cache-Control: no-store` everywhere; `X-Sirkit-AI-Provider` on propose;
`Retry-After: 300` on sourcing refresh; export's
`Content-Disposition: attachment; filename="sirkit-preliminary-bom-<id>.json"`
— byte-identical.
