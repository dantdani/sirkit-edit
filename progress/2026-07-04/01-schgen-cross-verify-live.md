# SchGen cross-verify — live end-to-end + "2nd opinion" button

Date: 2026-07-04 · Status: done (endpoint verified live; type-checked, lint-clean)

## (b) Endpoint verification (probed the live HF endpoint)
- Auth + reachability: OK.
- Custom handler IS deployed (returns `{code}`, wraps "The user request is:").
- Generates real SchGen DSL (6 add_schematic_symbol, 3 connect_pins, 4 add_label,
  2 write_out_all_wires) in ~80 s.
- After the reasoning/repetition handler fix: **non-degenerate** output (no more
  "I'm repeating / stuck" loops).

### Bugs found + fixed
1. **Route (mine):** HF's endpoint router requires an `inputs` key — it 400s on
   `{prompt}` before the handler runs. Route now sends `{inputs, prompt,
   parameters:{max_new_tokens:4096}}`, timeout raised to 240 s.
   (`app/api/schematic/cross-verify/route.ts`)
2. **Handler degeneration (redeploy):** gpt-oss looped in its analysis channel.
   Fixed with `reasoning_effort="low"` (the key lever) + `repetition_penalty=1.1`
   + `no_repeat_ngram_size=4`. (`schgen-endpoint/handler.py`)

### Known caveat
The model now wraps the code in a markdown explanation rather than pure Python.
Harmless for cross-verify: `parseSchGenSource` regex-scans for DSL calls anywhere,
so the netlist still extracts. (A cleaner `_extract_final_python` that pulls just
the fenced code block is a future handler tweak.)

## (a) "2nd opinion" button (`app/page.tsx`)
- New button beside Tidy/Review: calls `/api/schematic/cross-verify` with the
  remembered design prompt + current state, renders the diff findings (⚠️/ℹ️ +
  agreement %) into chat. Advisory, non-blocking.
- Added `lastDesignPrompt` state (captured in `handleGenerateSchematic`) so the
  second opinion designs the SAME request; falls back to the input box.
- Busy state `isSecondOpinion` ("Consulting…"); mutually disabled with Tidy/Review.
- No-ops gracefully with a chat note when the endpoint isn't configured.

## Latency reality
~1–2 min per call (20B model). This is a deliberate, patient action — correctly a
separate button, NOT folded into the fast Claude Review.

## Verification
`npx tsc --noEmit` clean · eslint: route/handler clean, page.tsx unchanged at its
19 pre-existing hooks errors.
