# B16.0.13 §F — PCB advisory non-mutation proof

The three provider routes remain ADVISORY — proposal output, never
authoritative mutation:

| Claim | Evidence |
|---|---|
| AI rules output does not mutate the board | from-brief consumes only `{brief, board:{netNames,hasIcs}}` summaries and emits a rule DELTA for client-side review; input pinned unchanged (frozen JSON compare) |
| Edit assistance does not apply edits | assist emits validated `EditCommand[]` for the client's `compileEdits`/`previewEdits` gates (unchanged); digest input pinned unchanged; no board handle exists server-side |
| Repair-agent output does not commit changes | the plan-only `PCBToolService` (B08.2) holds NO mutation authority — any mutation attempt refuses `canonical_authority_missing` (unchanged code); board input pinned byte-unchanged after a full valid call |
| Suggested operations remain subject to existing validation | command/rule validation and unknown-id filtering code is byte-preserved (standing assist-validation + from-brief suites green) |
| Hallucinated ids filtered/refused as before | unchanged validators; standing suites pin them |
| No new agent tool exposed; no approval/apply capability minted | the tool-exposure gate (exactly 12) and the B12–B15 approval-machinery suites pass unchanged inside the full run |

The wrapper migration touched none of the advisory/validation logic — only the
boundary prologue moved.
