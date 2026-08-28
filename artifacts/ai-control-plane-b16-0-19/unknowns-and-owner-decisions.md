# B16.0.19 — Unknowns & owner decisions

## Decisions taken

1. **Deadlines verified** as the reader default 30_000 for both families.
   **CONFIRMED**.
2. **Knowledge tool schema moved to a shared authority** (mandated "if
   needed" — it was: the inline schema had no validator beside it and three
   unbounded string arrays). Bounds chosen: `maxLength: 300` for ref/queue ids
   (the CD-6 id convention). **CONFIRMED**.
3. **Verification id bounds** chosen as `maxLength: 4096` (the CD-8
   semantic-id precedent from B16.0.17.2). **CONFIRMED**.
4. **503→422 reclassification of local proposal failures** — mandated;
   recorded in superseded-claims. **CONFIRMED**.
5. **ck/propose extraction actor** stays `{actorKind: "ai", role: "automation"}`
   with the trusted actorId/sessionId — the historical honest labeling of LLM
   extraction; caller fields cannot enter provenance. **CONFIRMED**.

## Unknowns carried forward

- **R9 live-Supabase production auth remains UNKNOWN.**
- **Remaining migration: 40 raw methods** (baseline 43) — spice family, chat,
  replacement-authority, full-flow and misc routes, plus the 3 factory routes.
  **CONFIRMED**.
- Live-provider strict-mode enforcement rates remain UNKNOWN (zero credits).

## Scope adherence

No new circuit rules, knowledge claims, waivers, approvals, safety or
verification claims, schematic/PCB mutations. Protected original untouched.
B16.0.20 / B16.1 / MCP / multi-agent / provider expansion / safety
certification NOT started.
