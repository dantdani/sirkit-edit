# Switchable AI Brain (OpenAI / Anthropic)

## Request

Make Sirkit's main reasoning model switchable between OpenAI and Anthropic while
keeping OpenAI permanently responsible for embeddings, vector retrieval,
indexing, and memory. Preserve CAD context and typed tools across providers,
persist the choice, record switches as project metadata, keep keys server-side,
and never fail over without the user's approval.

## Architecture

- Added a provider-neutral contract in `app/lib/llm/types.ts` for messages,
  text/image content, tools, tool calls, tool results, responses, streams, usage,
  provider capability checks, and the shared request context.
- Added `OpenAIProvider` (Responses API) and `AnthropicProvider` (Messages API).
  Provider-specific message/tool/image formats are translated only inside these
  two adapters.
- Added `LLMRouter`. It resolves exactly the requested provider and contains no
  automatic fallback path.
- Both adapters receive the same composed system instructions, conversation,
  schematic/board state, retrieved context, design constraints, and user request.
- Normalized assistant tool calls and user tool results support multi-turn CAD
  loops identically on both providers.
- Current-model sampling compatibility is handled in the adapters so unsupported
  `temperature` parameters are not sent to current reasoning models.

## Reasoning surfaces migrated

- Streaming AI chat.
- Theory and catalog-backed schematic generation.
- Multi-block schematic planning and the iterative part-search/build/ERC loop.
- Attribute and topology edits, electrical review, and vision layout criticism.
- PCB routing-rule advice (including trace/via sizing), natural-language board
  edits, and footprint suggestions.
- SPICE Studio's typed proposal/tool loop.

The catalog search still generates and queries its vectors through
`app/lib/embeddings.ts` using OpenAI `text-embedding-3-small`. That file was not
modified. Its best-effort retrieval reranker also remains outside the selectable
main-brain path so the established retrieval pipeline is not rewritten.

## UI and persistence

- Added the **AI Brain** selector to the AI Chat header with OpenAI and Anthropic
  options.
- The UI always states `Brain: ...` and `Embeddings: OpenAI` separately.
- Switching is immediate and preserves the existing chat and design state.
- The selected brain is stored globally for future sessions and in the active
  project record when one exists.
- Each actual project switch appends an `ai-provider-switch` history event with
  timestamp/from/to metadata. Tests prove the schematic and PCB payloads are
  unchanged by this metadata update.
- Project JSON export naturally includes the AI metadata; import and duplication
  preserve it. Older projects without the field still load normally.
- When the PCB layer materializes an unsaved project, it attaches the already
  active global brain without inventing a switch event.
- At narrow widths, AI Chat is now an opaque overlay beside the activity rail,
  rather than shrinking the CAD canvas until toolbars overlap.

## Failure and security behavior

- Provider errors return a sanitized `503 provider_unavailable` response.
- No route silently calls the other provider.
- The visible failure card offers **Retry** and **Use [other provider] instead**.
  The second button is the explicit approval that switches and retries.
- API keys are read only from server environment variables. Browser requests
  contain the provider id, not credentials. Error logging records only a safe
  provider/error-name summary.
- `.env.example` and README document both server keys and optional model
  overrides; neither key uses a `NEXT_PUBLIC_` name.

## Verification

- Provider/router/context/adapter/persistence contract tests: 7 passed.
- Full repository regression: **506 passed, 9 intentionally skipped** across 86
  test files; no failures.
- TypeScript passed.
- Targeted ESLint over the new router/providers, migrated AI routes, PCB/SPICE
  clients, persistence, prompts, and build loop passed. Existing unrelated
  `app/page.tsx` ref-during-render lint findings remain pre-existing.
- Production Next.js build succeeded: all 40 pages generated. The same five
  existing Turbopack Java/ngspice tracing warnings remain unrelated.
- In-app browser checks:
  - switched OpenAI → Anthropic without a refresh;
  - reloaded and confirmed Anthropic remained selected;
  - confirmed `Brain: Anthropic` and `Embeddings: OpenAI` simultaneously;
  - forced invalid server credentials and confirmed OpenAI failure did not
    switch providers;
  - approved **Use Anthropic instead**, confirmed the retry used Anthropic, then
    saw the exact Anthropic failure with **Retry / Use OpenAI instead**;
  - checked the 594 × 840 responsive overlay and restored the normal viewport;
  - browser console errors: zero.
