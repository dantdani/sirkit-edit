# B10 pre-edit counterexamples (R1–R8)

Captured with a transient script (`scripts/_tmp-b10-repro.ts`, deleted after
capture) against the unmodified post-B09.3 tree. Exact output:

## R1 — production page.tsx sends no PCB board

```
body mentions editorContext: false
body mentions boardState: false
body mentions board: false
```

The `/api/chat` fetch body carried provider/messages/scope/schematicState/
schematicHeadMark only.

## R2 — the server path exists but is browser-unreachable

```
board-inspect with directly supplied board: read ok: true
```

A valid board passed DIRECTLY to `assembleAgentRunContext` enabled board
reads through the gateway — proving the entire server boundary worked and
only the browser leg was missing.

## R3 — unsaved state.board differs from authoritativeRecord

```
durable pcbRevisionId: pcb2-9fca4404347d2f71
working pcbRevisionId: pcb2-eb0f34ab1b18733a
authorityRef-based bridge would serve the DURABLE board and miss the edit: true
authorityRef written only from authoritativeRecord (sync/apply): true
```

`authorityRef` mirrors the durable sync record only; an unsaved outline
edit changes the working copy's semantic revision. An authorityRef-based
bridge would silently serve stale state — hence the bridge reads
`state.board` (via the live board ref) exclusively.

## R4 — no project-generation-owned editor snapshot bridge existed

```
EditorContextBridge in app: false
editor-context module exists: false
```

## R5 — selection.inspect unexposed and strict-incompatible

```
agentExposed: false
schema has maxItems: true
strictCompatibility: REFUSED (STRICT_SCHEMA_UNSUPPORTED:$.properties.refs.maxItems: unknown or unsupported key)
```

## R6 — nested properties-without-type silently inferred (Entry Gate 0)

```
ACCEPTED; nested a became: {"properties":{"x":{"type":"string"}},"required":["x"],
                            "additionalProperties":false,"type":"object"}
items-without-array-type rejected: … (already guarded by B09.3 for this shape)
```

`toStrictSchema` silently added `type: "object"` to a nested schema that
never declared one. Closure: object-only and array-only keywords now
require an EXPLICIT base type and the `convert()` inference branch is
removed.

## R7 — no component-authority resource producer in the agent route

```
agent bundle seals component-authority-records: false
```

## R8 — pre-B10 browser chat exposed no canonical PCB reads

```
browser-shaped toolset: ["sirkit.schematic.propose-tier1-edit"]
```

All eight are closed and permanently regression-tested in
`app/lib/agent/__tests__/b10-editor-context.test.ts` and
`app/api/chat/__tests__/b10-chat-boundary.test.ts`.
