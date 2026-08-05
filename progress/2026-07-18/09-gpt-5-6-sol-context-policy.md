# GPT-5.6 Sol and long-context policy

## Changed

- Upgraded the OpenAI SDK from 6.42.0 to 6.48.0 for GPT-5.6 reasoning-effort support.
- Made `gpt-5.6-sol` the OpenAI brain default and configured the protected local runtime to use it.
- Added a centralized OpenAI model profile: 1,050,000-token context and 128,000-token provider output maximum.
- Removed Sirkit's 1,024-token chat cap. The main chat now lets GPT-5.6 govern completion length.
- Kept compact structured schematic planner/tool turns at 4K/8K output budgets. These do not truncate input context; they prevent parallel tool calls from reserving four or five copies of the provider's 128K output maximum and exhausting tokens-per-minute before work starts.
- Kept OpenAI embeddings fixed on `text-embedding-3-small`.
- Added `/api/ai/runtime`, a key-safe metadata endpoint, and surfaced the active model, context size, and `App cap: none` in the AI Chat header.
- Added `X-Sirkit-AI-Model` to streamed chat responses for diagnostics.
- Added safe provider failure classification (authentication, model access, rate limit, request, timeout, or network) so a rate-limit event is no longer mislabeled as a generic outage.
- Increased OpenAI retry tolerance for transient rate windows without silently changing providers.
- Set reasoning effort to `high` for quality-first interactive work. `max` remains an operator option, but a live schematic-loop probe showed it can exceed five minutes even for a tiny design, which is not appropriate as the interactive default.

## Why

The prior UI hid the actual model and the main user-facing paths imposed small output ceilings. The new policy permits 500K-token inputs within GPT-5.6 Sol's provider window without pretending that OpenAI's hard context, output, price, or account-rate limits do not exist.

## Verification

- OpenAI model-access probe: `gpt-5.6-sol` completed successfully.
- Live `/api/ai/runtime`: model `gpt-5.6-sol`, context `1,050,000`, app context cap `null`, reasoning `high`.
- Live `/api/chat`: HTTP 200, provider `openai`, model header `gpt-5.6-sol`.
- Found and corrected the launch-time cause of the screenshot failure: a stale Windows `OPENAI_API_KEY` was shadowing the healthy protected `.env.local` value and returning `insufficient_quota`.
- Live `/api/schematic/build-multi`: HTTP 200; the probe generated a validated 2-component, 3-connection real-parts netlist.
- LLM provider/router/error tests: 8 passing.
- TypeScript: `tsc --noEmit` passed.
