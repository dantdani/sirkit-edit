# B13 — security boundary

| Invariant | How it holds |
| --- | --- |
| Search candidates are never authority | the loader emits candidates separately; `consumeReplacementAuthority` requires `verified-exact` + a server-owned `exactAuthority`; candidates never classify verified |
| Model ranking is never authority | the loader reads durable repositories only; no model/provider call participates |
| Display text and pin count are never authority | authority derives from binding facet states + atomic confirmation, never from text or counts |
| Browser claims are never authority | the chat body/editor-context contracts carry no authority field (`ALLOWED_BODY_KEYS`/`ALLOWED_EDITOR_CONTEXT_KEYS` + `exactObjectShape` authority-key rejection); the assembler reads authority only from the server loader; #14 gate |
| A valid MPN without exact atomic/assets/mapping authority is insufficient | an MPN string (selected or permitted alternative) without a complete `exactAuthority` → `incomplete_identity`/`wrong_part`; #15/#16 |
| Cross-project records are refused | loader drops any aggregate whose scope ≠ the authenticated scope (checked on set AND selected binding); envelope scope pinning; inspector foreign-project rejection; #9 |
| Conflicting records are never merged | duplicate/conflicting aggregates → `conflict: present`, no exact authority; inspector never merges; #7/#8 |
| Missing/unavailable data remains UNKNOWN | no aggregate → no record (inspector `unknown`); DB/atomic failure/timeout/abort → `unavailable`, resource withheld; never a fabricated verified set; #2, #11, #12, #24 |
| Asset substitution is impossible | every installed asset field is derived from / exact-compared against the server-owned record; any divergence → `asset_mismatch` before grant registration; #18 |
| B13 performs no mutation | the loader and the tool are read-only (`operationClass: "read"`); `consumeReplacementAuthority` only mints an unexecuted grant; no executor path runs; #26 |
| Manufacturing release remains API-only, non-agent-executable | untouched; the agent-exposed set is exactly the ten read/propose tools, no release/mutate/destructive tool exposed |
| Static provider exposure gains no mutation/release tool | the only exposure change is the component-authority READ tool; B04/B09/B10/B11/B12 exposure tripwires assert read/propose-only and no apply/approval/release |

## Trust boundary statement

Digest verification proves envelope INTEGRITY and CONSISTENCY. B13 adds
the missing production leg: the envelope content is now produced by a
server-only loader over durable, authenticated-scope facts, so an
in-process caller can no longer be the source of authority — the records
come from the repositories, the exact identity is confirmed against the
published atomic revision, and the grant installs only server-owned asset
identifiers. No secrets, credentials, connections, supplier internals, or
SDK objects enter the record, the envelope, the summary, or the trace.
