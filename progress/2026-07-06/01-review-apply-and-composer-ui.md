# Review/apply guardrails and composer simplification

Date: 2026-07-06 - Status: done (type-checked; netlist validation green)

## Problem
The advisory review flow was too easy to over-apply. For prompts such as
"ESP32 with USB-C and LED", the initial schematic generated one MCU, but applying
review suggestions could ask the edit model to reconcile broad "missing part"
findings and accidentally introduce a second controller. The composer also had
three primary actions (Ask, Edit, Generate), which made the submission path feel
busy and ambiguous.

## Changes (`app/page.tsx`)
- Added structured `PendingSuggestion` records with `source`, `category`,
  `severity`, and optional `refs` so review and second-opinion findings can be
  displayed and applied consistently.
- Added support-suggestion filtering. Only bounded support/protection/passive
  fixes (decoupling, pull-ups, series/current-limit resistors, TVS/ESD,
  crystals/load caps, ferrites, etc.) become actionable suggestions.
- Added unsafe suggestion filtering for broad controller/processor additions,
  including "missing MCU/controller" and "second opinion has more ICs" cases.
- Replaced the footer-level "Apply suggestions" button with a Cursor-style
  suggestion tray above the composer:
  - expandable/minimizable summary
  - `Apply`
  - `Ignore`
  - preview of the first few suggestions
- `Apply` now sends a guarded edit instruction:
  - do not add another MCU/controller/processor/module/large IC
  - do not remove, replace, rename, or duplicate the existing controller
  - only local support/protection/passive fixes are allowed
  - broad redesign suggestions are ignored
- Added a post-edit client guard for guarded suggestion applies. If the edit
  result adds a new processor-like part, adds a new `U*` IC, or changes an
  existing processor part ID, the apply is blocked with an error.
- Added `inferComposerAction()` and `handleComposerSubmit()` so one submit path
  can infer ask/edit/generate from the current prompt and schematic state.
- Removed the visible Ask button. Questions are submitted with Enter; Shift+Enter
  inserts a newline. The visible composer button appears only for inferred
  Generate/Edit actions.

## Result
The review system can still surface useful support-circuit suggestions, but the
apply path is bounded and no longer has permission to duplicate the main MCU.
The composer is simpler: type a question and press Enter, or type an edit/generate
prompt and use the context-aware action.

## Verification
- `.\node_modules\.bin\tsc.cmd --noEmit`
- `.\node_modules\.bin\tsx.cmd scripts\netlist-validation.test.ts`

