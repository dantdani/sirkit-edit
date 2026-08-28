# B16.0.24 §E/§G — provider / process zero-call evidence

All refusals cause zero external work. Pinned via fake seams whose call logs
are asserted empty.

## Chat (fake agent adapter, zero credits)

| refusal | provider `start` |
|---|---|
| media 415 (zero body pulls) | 0 |
| 413 board-capable | 0 |
| authority-shaped / unknown key 400 | 0 |
| messages / scope / editorContext shape 400 | 0 |
| production cross-origin 403 | 0 |
| viewer role 403 `AUTH_ROLE_DENIED` | **0** (pinned) |
| a valid single-turn run | **exactly 1** (pinned) |

## Simulate (scripted fake child, zero real processes)

| refusal | `spawn` calls |
|---|---|
| unauthenticated 401 | 0 |
| no components / no source / no ground 400 | 0 |
| netlist-generation / injection-guard 400 | 0 |
| a valid run | **exactly 1**, no shell (pinned) |

No live provider credit is spent and no live simulator is launched in any test:
the LLM router, agent adapter, `node:child_process.spawn`, and `fs/promises`
are all mocked. **CONFIRMED.**
