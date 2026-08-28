# B16.0.17 §B — Route behavior parity (CONFIRMED)

Each route's prologue
(`export async function POST(request) { const parsed = await scopedJson(request); … }`)
became
`export const POST = authenticatedJsonRoute({ maxBytes: 32_000_000, deadlineMs: 30_000 }, async ({ context, body }) => { const scope = schematicCompilerScopeFromContext(context); … })`
(kicad/inspect takes `{ body }` only — it never consumed the scope). Everything
after the prologue is byte-identical; the 82 pins pass pre = post with zero
assertion changes, and the standing `routes.test.ts` (which exercises real
graphs via `readyGraph()` and the denies-direct-AI-transaction invariant)
passes unchanged.

## Callback projections

| Route | Callback input |
|---|---|
| kicad/inspect | `{ body }` |
| the other nine | `{ context, body }` → `schematicCompilerScopeFromContext(context)` |

None receives Request, Headers, cookies, raw URL, host, origin, or raw body
streams.

## Role separation (policy-exact, unchanged)

| Route group | Permitted roles | viewer |
|---|---|---|
| compare, diff, graph/validate, layout, problem, propose, variants | pcb_editor, reviewer, project_admin, automation | 403 |
| transaction | pcb_editor, reviewer, project_admin | 403 |
| export, kicad/inspect | ALL members | admitted → required-field |

## Material headers preserved

`Cache-Control: no-store` everywhere; `X-Sirkit-AI-Provider` on propose;
`Content-Disposition: attachment; filename="sirkit-cd8-<candidateId sanitized>.json"`
on export — byte-identical.
