# B16.0.12 §I — /api/ai/runtime secret non-disclosure

## Adversarial fixture

The pin stubs DISTINCTIVE sentinel values into every credential-bearing
environment variable the runtime process could see:

```
OPENAI_API_KEY, ANTHROPIC_API_KEY, KICAD_HTTP_LIBRARY_TOKEN,
SIRKIT_WORKFLOW_WORKER_SECRET, DATABASE_URL (with an embedded password),
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY
```

The FULL serialized response is then scanned: **no sentinel value — and no
occurrence of the substring `SENTINEL` at all — appears anywhere** in the
output.

## Shape confinement

The response contains exactly `{ providers: { openai, anthropic }, embeddings }`
— model ids, labels, token windows, and reasoning effort only. No API keys,
tokens, credentials, raw env dumps, provider headers, project/session identity,
or upstream error details. `Cache-Control: no-store` pinned.

## Boundary

The route is now `publicRoute` — the callback receives only `meta` (it uses
nothing from the request at all); the model-config helpers
(`openai-config.ts`) read env internally and return only profile metadata,
never key material (they never touch `OPENAI_API_KEY`).
