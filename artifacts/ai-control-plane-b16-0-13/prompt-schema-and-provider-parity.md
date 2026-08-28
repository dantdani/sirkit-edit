# B16.0.13 §E — Prompt, schema & provider parity

This stage edited ONLY the five `route.ts` files' boundary prologues plus
tests/ratchet/artifacts. Every prompt, tool schema, and provider module is
untouched, and each route's in-file provider parameters are byte-preserved:

| Route | Preserved in-file (verbatim) |
|---|---|
| from-brief | `RULE_DELTA_TOOL` (`emit_rule_delta`), forced toolChoice, system prompt, token limits, rule-delta validation/filtering |
| edit/assist | `emit_edits` / `ask_user` / `query_items` tools, `toolChoice: "required"`, the query_items 3-call cap, digest-based prompting, command validation |
| repair/agent | `PCB_AI_TOOLS` filtered by `ALLOWED_TOOLS`, `toolChoice: "auto"`, temperature 0, maxTokens 3000, the 8-iteration loop, plan-only tool service |
| autoroute | no provider — the FreeRouting option construction, DSN generation, pass policy unchanged |
| gerbers | no provider — fab/DRC preset handling, engine selection (kicad / native-beta), preflight/package actions unchanged |

Untouched modules: `app/lib/llm/*` (router, errors, request), `app/lib/prompts.ts`,
the PCB tool schemas, `app/lib/pcb/autoroute/*`, `app/lib/pcb/fab/*`.
`requestedProvider(body.provider)` routing byte-identical and asserted
behaviorally (repair valid path; from-brief/assist error paths). Provider
error normalization (`providerErrorResponse` → 503) pinned exactly once per
call. Fallback/quota behavior lives in the untouched router.
