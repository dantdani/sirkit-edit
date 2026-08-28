# B16.0.10 §D — Prompt, schema & provider parity

## Byte identity

This stage edited ONLY the 8 `route.ts` files (boundary boilerplate → wrapper)
plus tests/ratchet/artifacts. Every prompt, tool schema, and provider module is
untouched:

| Module | Contents | Status |
|---|---|---|
| `app/lib/prompts.ts` | THEORY/BUILD/BUILD_SUBSYSTEM/PLAN/EDIT/EDIT_BUILD/REVIEW/LAYOUT_CRITIC system prompts + THEORY_SUBMIT_SCHEMATIC/PLAN/EDIT_APPLY/REVIEW/LAYOUT_CRITIC tool descriptors | **untouched** — sha1 `eb08600ba23260ed15cfcdce95b0c32ebcdfe086` pre = post (the file was never written this stage; `git diff --check` clean) |
| `app/lib/llm/router.ts`, `app/lib/llm/errors.ts`, `app/lib/llm/request.ts` | provider selection, fallback, quota/error normalization | untouched |
| `app/lib/build-loop.ts` | the shared search_parts → submit_schematic loop | untouched |

## In-route provider parameters (byte-identical, verified by diff)

The migrated callbacks carry the exact historical calls: temperatures (unset /
0 as before), `maxTokens` (2048 schematic; 4_096 planner; 1024 edit; 1536
layout-critic; 2048 review), `toolChoice` names (`submit_schematic`,
`submit_plan`, `apply_edits`, `report_layout_issues`, `report_findings`),
strict-schema settings, message construction (including edit-build's
`Current netlist:\n…\n\nInstruction: …` shape and layout-critic's
image-plus-manifest content array), and `requestedProvider(body.provider)`
routing. The only removed lines are the authorization/media/bounded-reader
boilerplate now provided by the wrapper.

## Behavioral confirmation

The valid-path pins assert requested-provider routing reaches the adapter,
tool-choice processing is unchanged, and provider errors normalize exactly as
before (`providerErrorResponse` → 503; build-loop failure pass-through with
`{error, code, provider}` + status). All 57 pins pass identically pre and post.
