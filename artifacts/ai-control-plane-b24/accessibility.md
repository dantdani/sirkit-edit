# B24-D3 - Accessibility and responsive scope (D24-32, OD-215)

Increment B24-D3 of chapter B24 on `chapter/b24-production-qualification`, from `3773c6a` (B24-D2 committed), delivered in one
workflow run as D3a (the rule and census, the in-scope names and announcements, the canvases: sections 0-3 and 5) and D3b (the BOM
dialogs, the minimum width, the two browser specs: the other sections), committed by the lead as one increment (lead decision D21).
Labels: **CONFIRMED** (executed here, or read at the cited file:line), **INFERRED**, **PROPOSED** (written, not yet run),
**RECORDED** (taken from a record), **UNKNOWN**, **NOT MEASURED**, **NOT MET**. No claim of WCAG conformance is made anywhere on this
page beyond what a named case measures (runbook `:144`, `:147`). No assistive-technology run and no automated axe audit took place:
both are owner actions (OD-215: no new dependency), recorded as NOT MEASURED.

## 0. What B24-D3 is

- **The accessible-name rule (D3a, OD-215 "a B17-A accessible-name rule").** `app/lib/engineering/accessible-names.ts` (new,
  node-only) reads B17-A's control sites (`scanControlSites`, unchanged) and gives each exactly one closed status: `named:<source>`,
  `exempt:<reason>` or `unnamed` (section 2). Its census, `accessible-name-census.csv` and `accessible-name-census-summary.json`
  (`scripts/generate-b24-accessible-names.ts`, byte-pinned), joins B17-A's `ui-control-inventory.csv` on the key. CONFIRMED.
- **The gate (D3a).** In scope (section 1): zero `unnamed` sites, the structural rules hold, and no in-scope name is a glyph alone.
  Out of scope: every unnamed site is listed, and the count may only fall: 111 at `3773c6a`, pinned at 102 after D3, with every
  unnamed key in the suite's own frozen list (`UNNAMED_KEYS_AFTER_D3`), so a new unnamed site fails even after the census is
  regenerated; the generator refuses one too, against the census committed at the repository path whatever directory it writes to.
  CONFIRMED (`b24-d3-accessible-names` 1-3; the review round's bypass runs, section 5).
- **Names and announcements (D3a).** The six in-scope unnamed controls the rule found are named (section 5), and the More checks
  button, whose name was its glyph "⋯", carries its title as an `aria-label` too. The chat transcript is a polite `log` live region
  with `aria-busy`, and the chat error and the provider refusal are `alert`s. CONFIRMED by AST (`b24-d3-accessible-names` 2, 6); in
  the browser CONFIRMED (`keyboard-and-focus` 2, the lead's run, section 5).
- **Focus after a run (D3a, the review round).** When a run sent from the prompt ends, focus returns to the prompt only from `body`,
  and only if no pointer was pressed since (a pointer person's focus, and the editor's shortcuts, stay theirs). CONFIRMED by a model
  run of the page's own code (`b24-d3-accessible-names` 11, five runs) and by reading; in the browser CONFIRMED (`keyboard-and-focus`
  2, the lead's run, section 5).
- **The canvases (D3a).** The schematic `<svg>` and the PCB canvas host are declared non-accessible: `role="img"` named by a
  statement that says the drawing is pointer-only and names its keyboard alternative, Go to component. CONFIRMED by AST
  (`b24-d3-accessible-names` 6); in the browser CONFIRMED (`keyboard-and-focus` 5, the lead's run).
- **The BOM dialogs (D3b, OD-215 "the BOM dialogs moved onto the shared dialog").** The four hand-rolled BOM dialogs run on
  `components/ui/dialog.tsx` (Base UI, unchanged): named by their headings, focus inside on open, Escape closes, focus returns to the
  opener, one Close each (the shared one; no button inside named by a glyph alone). CONFIRMED in jsdom (`b24-d3-bom-dialogs`, 16
  cases). Their Tab trap is NOT MEASURED (INFERRED from the shared component).
- **Responsive scope (D3b).** Desktop only: `EDITOR_MIN_WIDTH_PX` is 1,280, and below it `app/layout.tsx` shows `MIN_WIDTH_NOTICE`
  by CSS alone. CONFIRMED by AST (`b24-d3-accessible-names` 6); in the browser CONFIRMED (`minimum-width` 1-3, the lead's run).
- **Keyboard journeys and visible focus (D3b).** `e2e/keyboard-and-focus.spec.ts` (5 cases) and `e2e/minimum-width.spec.ts` (3
  cases) are written; the builder runs no browser (the task names no lock script for one), so their red run on `3773c6a` and their
  green run are the lead's, both recorded in section 5 (CONFIRMED on win32; CI's run is the commit's). [B24-D3 lead, 2026-10-10] Case 1 measured the
  path from AI Chat to the prompt: 95 Tab presses (section 7), a 2.4.3 gap recorded, not fixed.
- **D24-32 closes offline** with the residuals of section 12; nothing here is live, deployed or measured with assistive technology.

## 1. The scope (`ACCESSIBILITY_SCOPE`, OD-215)

OD-215's surfaces, as the exported, closed constant `ACCESSIBILITY_SCOPE` (`app/lib/engineering/accessible-names.ts`) lists them;
`b24-d3-accessible-names` 10 pins this list equal to it, line for line, and any change is a reviewed pin move. A region of
`app/page.tsx` is resolved by AST (the element or function it names must match exactly once; `b24-d3-accessible-names` 1), never by a
line number. B23's ordering-disabled notice (`ProviderExchangePanel.tsx:129`) is static text in reading order and stays unchanged
(`b23-c-ordering-disabled` 6); `ProviderObservationList.tsx` is display only and holds no control site.

- chat: `app/components/chat/AutonomyModeControl.tsx` (the whole file)
- chat: `app/components/chat/ChatMarkdown.tsx` (the whole file)
- chat: `app/components/chat/ExecutionEntryActions.tsx` (the whole file)
- chat: `app/page.tsx`, inside the `<aside>` whose class names `sirkit-chat-panel`
- chat: `app/page.tsx`, inside `function MessageBubble`
- approval dialogs: `app/components/pcb/GrantedExecutionDialog.tsx` (the whole file)
- approval dialogs: `app/components/pcb/PcbProposalReviewDialog.tsx` (the whole file)
- approval dialogs: `app/components/pcb/BoardRevisionDialog.tsx` (the whole file)
- approval dialogs: `app/components/pcb/SnapshotConflictDialog.tsx` (the whole file)
- approval dialogs: `app/components/schematic/ReplacementReviewDialog.tsx` (the whole file)
- approval dialogs: `app/page.tsx`, inside the `<Dialog>` holding `data-testid="schematic-proposal-review"`
- approval dialogs: `app/page.tsx`, inside the `<Dialog>` titled "AI edit proposal — review before applying"
- side panels: `app/page.tsx`, inside the `<aside>` whose class names `border-r border-zinc-800`
- side panels: `app/components/pcb/AssignmentQueuePanel.tsx` (the whole file)
- side panels: `app/components/pcb/BoardRepairPanel.tsx` (the whole file)
- side panels: `app/components/pcb/ComponentReviewPanel.tsx` (the whole file)
- side panels: `app/components/pcb/DrcPanel.tsx` (the whole file)
- side panels: `app/components/pcb/LayerPanel.tsx` (the whole file)
- side panels: `app/components/pcb/ManufacturingWorkflowPanel.tsx` (the whole file)
- side panels: `app/components/pcb/MappingVerificationPanel.tsx` (the whole file)
- side panels: `app/components/pcb/PadstackPanel.tsx` (the whole file)
- side panels: `app/components/pcb/PassivePackagePolicyPanel.tsx` (the whole file)
- side panels: `app/components/pcb/PcbSyncReadinessPanel.tsx` (the whole file)
- side panels: `app/components/pcb/RoutingRulesPanel.tsx` (the whole file)
- side panels: `app/components/parts/AtomicPublicationReviewPanel.tsx` (the whole file)
- side panels: `app/components/editor/BuildLibraryPanel.tsx` (the whole file)
- B23: `app/components/pcb/ProviderExchangePanel.tsx` (the whole file)
- B23: `app/components/pcb/ProviderObservationList.tsx` (the whole file)

In scope: 168 control sites on 22 surfaces (the scope's 28 entries cover 24 files; `ChatMarkdown.tsx` and `ProviderObservationList.tsx`
hold no handler site), at `3773c6a` and after D3. CONFIRMED (the census summary).

## 2. The accessible-name rule and its census

**How it reads the sites.** It re-parses every surface B17-A scans (`DEFAULT_CONTROL_ROOTS`: `app/page.tsx`, `app/components`,
`app/lib/pcb/render/scene.ts`) and recomputes each node's B17 key with B17-A's label order (data-testid > aria-label > title > text >
placeholder > name, `control-surface.ts:56`) and the exported `summarizeHandler`. The recomputed key multiset equals
`scanControlSites`' exactly, and the join is on the key - never on (surface, line, kind, element), which is not unique:
`AssignmentQueuePanel.tsx:27` and `:30` each hold two buttons of the same kind and element (`b24-d3-accessible-names` 1, which names
both lines). `control-surface.ts` and `control-registry.ts` are not edited. CONFIRMED.

**The closed statuses.**

| status | what it means |
|---|---|
| `named:aria-labelledby`, `named:aria-label` | the element's own attribute, non-empty (an expression counts; its literal parts are shown in the census's detail) |
| `named:label-wrap`, `named:label-for` | a labelable element (input, select, textarea, button and their wrappers) inside a `<label>` with text, or whose `id` a `htmlFor` in the same file names |
| `named:text` | name from content: a literal, an expression or an `sr-only` child, for the elements ARIA lets take a name from content (button, a, summary, option, table rows and cells, headings, an explicit role such as `button`, and a component call site such as `Button`); a generic `div`, `span` or `li` and an SVG shape never do |
| `named:title` | the `title` attribute, the last source |
| `named:palette-title` | a command-palette action's `title` |
| `named:forwarded` | a call site of a component in the closed `NAME_FORWARDING` list, whose own JSX forwards the prop (read by AST): `ActivityBarButton.label` to `aria-label` (`app/page.tsx:8331`), `ViewTab.label` to text (`:8357`), BomView's `KindToggle.label` to text |
| `exempt:dialog-titled` | a shared `Dialog` (`@/components/ui/dialog`) whose `DialogContent` holds a `DialogTitle` |
| `exempt:form-submit` | a form whose submit controls are each named by a listed source; otherwise the form is `unnamed` |
| `exempt:listener` | a `shortcut` or `gesture` listener (`addEventListener`) |
| `exempt:click-shield` | B17's `internal.stop-propagation`: a handler that only stops propagation |
| `exempt:backdrop` | `BACKDROP_EXEMPTIONS`: a dismiss-only, content-free backdrop that a named, keyboard-reachable button in the same file also closes; the reason names it by its accessible name, computed in the census's own order ("closed by More checks", the chat's More checks menu) |
| `exempt:canvas-gesture` | a site inside a canvas host declared non-accessible (`CANVAS_HOSTS`, section 3); the reason names the Go-to field in the same file |
| `unnamed` | none of the above: a `placeholder`, `data-testid`, `name` or `id` is never a name (detail `placeholder-only`, `testid-only`, `name-only`, `id-only` or `none`) |

**The structural rules (in scope).** No positive `tabIndex`; no `tabIndex={-1}` on a native control; no click or key handler on a
non-interactive element (div, span, li, tr, td, th, SVG) without a `role`, `tabIndex={0}` and a key handler, unless it is exempt. At
`3773c6a` and after D3: zero problems. CONFIRMED. **A name worded for a person (in scope, the review round).** No in-scope control
is named by a glyph alone (a name with no letter or digit; `*`, a value known only at run time, is not judged): the More checks
button's "⋯" was the one, named since (section 3). Accname takes a lone glyph as the name, so the status stays `named:text` where
it applies; the gate is `b24-d3-accessible-names` 2. CONFIRMED.

**The census.** `artifacts/ai-control-plane-b24/accessible-name-census.csv` (columns `key,surface,kind,element,in_scope,status,detail`;
`key` is B17's, so it joins `ui-control-inventory.csv`) and its summary, byte-pinned by `b24-d3-accessible-names` 1. The generator
refuses to write when a site the render calls `unnamed` is not `unnamed` in the committed census (the ratchet: a new unnamed control
anywhere is named before the census moves), and when a scope region does not resolve. **The ratchet's baseline (the review round).**
The generator reads the census committed at its repository path, `artifacts/ai-control-plane-b24/accessible-name-census.csv`,
whatever output directory it is given, and refuses when that file is missing unless `--bootstrap` is passed (a tree with no census
yet). Because case 1 makes the committed census equal to the render, the census cannot be the suite's baseline: case 3 holds its own
frozen list, `UNNAMED_KEYS_AFTER_D3` (the 102 keys after D3), and the post-D3 count, 102, beside the `3773c6a` record, 111. A key may
leave the list when its control is named; none joins it except by a reviewed pin move. CONFIRMED (section 5).

| | `3773c6a` (the final rule over the commit's surfaces) | after D3 |
|---|---|---|
| sites / surfaces | 631 / 63 | 628 / 63 |
| in scope: sites / unnamed / structural problems | 168 / 6 / 0 | 168 / 0 / 0 |
| out of scope: unnamed (pinned: at most 102 after D3, every key in the frozen list; 111 the `3773c6a` record) | 111 | 102 |

The out-of-scope fall (9): the four BOM dialog backdrops removed (section 4) and five schematic canvas gestures now exempt (the
`<svg>` itself, a wire `polyline`, and the `ComponentSymbol`, `KicadInstanceView` and `NetLabelGlyph` call sites written inside it).
CONFIRMED (both censuses; the `3773c6a` one taken over a `git archive` of the commit's scanned surfaces, outside the repository).

**4.1.2: the census covers handler sites only.** B17-A records the attributes of `CONTROL_EVENT_ATTRIBUTES`
(`control-surface.ts:23-36`). A focusable control with no handler is outside the census and outside the gate: the header's
icon-only, unnamed Settings button (`app/page.tsx:6166`), the submit buttons `app/page.tsx:1993` and `PcbToolbar.tsx:381` (named by
text), the links of `ChatMarkdown.tsx` and `BuildLibraryPanel.tsx`. D3 does not extend the rule to them (D3's choices, OD-237 (d)).

## 3. In-scope names, announcements and the declared canvases

**Named (every in-scope `unnamed` site the rule listed; section 5 has the list).**

| control | fix | source after D3 |
|---|---|---|
| the chat prompt (`app/page.tsx:6953`, two sites: change and key) | `aria-label="Message to the assistant"` on its existing line (`CHAT_PROMPT_LABEL`) | `named:aria-label` |
| the DRC preset `select` (`DrcPanel.tsx:117`) | `aria-label="DRC rule preset"` | `named:aria-label` |
| the component review's decision reason (`ComponentReviewPanel.tsx:194`) | an `aria-label` naming the reference designator, "(required to reject)" | `named:aria-label` |
| the successor rebind reason (`ComponentReviewPanel.tsx:110`) | an `aria-label` naming the reference designator, "(required)" | `named:aria-label` |
| the build library's category search (`BuildLibraryPanel.tsx:490`) | `aria-label="Search this category"` | `named:aria-label` |
| the chat's More checks button (`app/page.tsx:7022`; the review round, security-2) | `aria-label="More checks"` beside its `title`, on its existing line: its content "⋯" named it, and the title was only its description; the B17 key's label stays "More checks" (aria-label before title) | `named:aria-label` (was `named:text` "⋯") |

**The chat transcript (OD-215, `app/page.tsx:6832`, in place).** `role="log"`, `aria-live="polite"`, `aria-relevant="additions
text"`, `aria-busy={loading}` (so an answer that streams is announced once it settles), `aria-label="Conversation with the
assistant"` (`CHAT_TRANSCRIPT_LABEL`). CONFIRMED by AST (`b24-d3-accessible-names` 6); announced by a screen reader: NOT MEASURED.

**Errors are announced.** `genError` (`app/page.tsx:6846`, in place) and `ProviderExchangePanel`'s refusal `p2g-provider-result`
(`ProviderExchangePanel.tsx:171`, in place) carry `role="alert"`. B23's pinned lines `:122`, `:129`, `:157` are unchanged. CONFIRMED by
AST.

**Focus on send.** The prompt is `disabled` while a run streams (`app/page.tsx:6963`), so keyboard focus falls to `body` (the HTML
focus fix-up; INFERRED on `3773c6a`, red there by `keyboard-and-focus` 2, the lead's run). When the run ends, `app/page.tsx:4809` (in
place, on the line that clears the busy flag) returns focus to the prompt, polling up to 30 animation frames for the prompt to be
enabled again - and only when all three hold: the run was sent from the prompt (`chatFocusReturnRef`, declared in place on
`app/page.tsx:2627` and set on `:4466`, the line that sets the busy flag, when the focused element is the prompt), no pointer was
pressed since (the root element's capture-phase `onPointerDownCapture`, in place on `:6046`, clears the flag for a press anywhere,
portals included), and focus is on `body` (focus moved by keyboard, or inside an open dialog, is left where it is). The review
round found the first version stole focus from a pointer person: a click on a canvas that takes no focus leaves focus on `body`, and
the return then sent the editor's single-key shortcuts and Delete into the prompt. The capture handler observes and performs no
command, so it is no B17-A control site (`onPointerDownCapture` is not among `CONTROL_EVENT_ATTRIBUTES`, `control-surface.ts:23-36`;
B17-A's counts unchanged). CONFIRMED by a model run of the page's own code (`b24-d3-accessible-names` 11: sent from the prompt and
untouched, back to the prompt; a pointer press during the run or as the prompt comes back, focus stays on `body`; sent from another
control, stays on `body`; focus moved by keyboard, stays there) and by reading; in the browser CONFIRMED (`keyboard-and-focus` 2, the lead's run).
Not covered: a generate or edit turn (`isGenerating`, `isEditing`) also disables the prompt, and focus is not returned after one
(section 12).

**The canvases declared non-accessible, with Go to as the alternative (OD-215).** The schematic `<svg>` (`app/page.tsx:2088`, in
place) carries `role="img"` and the `SCHEMATIC_CANVAS_STATEMENT` literal; the PCB host (`PcbCanvas.tsx:40`) carries `role="img"` and
`aria-label={PCB_CANVAS_STATEMENT}`. Each statement says the drawing is pointer-only and names "Go to component", the
`aria-label` of `schematic-goto-input` (`app/page.tsx:1987`) and `pcb-goto-input` (`PcbToolbar.tsx:375`). The `canvas-gesture`
exemption applies only inside these two hosts and only to what is written inside them (the rule is lexical: a component defined
elsewhere and rendered into the `<svg>` keeps its own status). CONFIRMED by AST (`b24-d3-accessible-names` 4, 6).

**Wording.** No statement, notice or in-scope name matches B19-E's purchase wording (`b24-d3-accessible-names` 8, reading the
pattern from B19-E's own suite). `app/page.tsx` keeps its 8,459 lines: nine lines changed in place (`:2088`, `:6832`, `:6846`,
`:6953` and `:4809` by D3; `:2627`, `:4466`, `:6046` and `:7022` in the review round, `:4809` again), none added or removed
(`b24-d3-accessible-names` 7; B21's page suites resolve its line citations; B21-E2's control markup counts unchanged). CONFIRMED.

## 4. The dialogs

**The four BOM dialogs on the shared dialog (D3b; discovery section 8 item 10).** `SourcingWorksheetModal`, `HistoryPanel`,
`NotificationsDrawer` and `AlternatesDrawer` (`app/components/bom/BomView.tsx`) render `<Dialog open onOpenChange>` and
`DialogContent` from `components/ui/dialog.tsx` (unchanged). Each is named by its visible heading through `DialogTitle` ("Sourcing
worksheet (CSV, unverified)", "Snapshot history", "Notifications", "Alternates for …"); focus moves inside on open; Escape closes it;
focus returns to its opener - the worksheet to its "Export for distributor ▾" trigger through `finalFocus` (its menu item unmounts on
open), the others to the History button, the bell and the row's alternates control (Base UI returns focus to the element focused when
the dialog opened); and each has exactly one control named "Close", `DialogContent`'s default (`dialog.tsx:45`, `:75`), with no button
inside it named by a glyph alone (a "✕" takes its name from its content, never "Close"; `b24-d3-bom-dialogs` 4 in jsdom and
`b24-d3-accessible-names` 5 by AST, both strengthened in the review round). The drawers' "✕" buttons and the four backdrop `div`s are
gone (the shared overlay dismisses on a pointer press outside); the worksheet keeps its
form's "Cancel"; the worksheet sentence ("Priced from cached offers, … no order is placed.") is unchanged. CONFIRMED in jsdom
(`b24-d3-bom-dialogs` 1-4 for each dialog, 16 of 16; red first on `3773c6a`, 16 of 16). A mutation that drops the worksheet's
`finalFocus` turns its case 3 red (section 5).

**A visual change.** The drawers are positioned by `className` only (`BOM_DRAWER_CLASS`, a right-hand sheet). Through the dialog's
portal they now cover the viewport, not the BOM pane, and the shared overlay (a light blur) replaces the pane's dark backdrop. INFERRED
from the classes; no screenshot was taken here.

**The approval dialogs.** Every in-scope shared `Dialog` (8: the two in `app/page.tsx`'s scope, `GrantedExecutionDialog`,
`PcbProposalReviewDialog`, `BoardRevisionDialog`, `SnapshotConflictDialog`, `ReplacementReviewDialog` and the release confirmation in
`ManufacturingWorkflowPanel`) has a `DialogTitle`. CONFIRMED by AST (`b24-d3-accessible-names` 5).

**The Tab trap (section 8 item 10).** Measured in the browser on the Tier 1 granted-execution card only (`keyboard-and-focus` 4:
focus inside, Tab and Shift+Tab cycling among Close, Cancel and Confirm, Escape cancelling through `onOpenChange`) - CONFIRMED for
that card alone by the lead's run (section 5). For the other approval dialogs and the four BOM dialogs the trap is INFERRED (the
same Base UI component, `dialog.tsx` unchanged); no case measures it (jsdom has no sequential focus navigation).

**[B24-D4, 2026-10-10] The card's focus return (D24-32, 2.4.3).** CI run 38061798204 on `1fe719e` failed `keyboard-and-focus` 4 at
`:235` with focus on `body` after Escape (the entry did read cancelled): the card set no return target, and Base UI's default - the
last element an earlier popup recorded, focus being on `body` when the card opened (the prompt is disabled while the run streams,
section 7) - was none on CI. Fixed in place: the card's `DialogContent` carries `finalFocus={promptFocus}` (`GrantedExecutionDialog.tsx:55`;
`promptFocus` at the end of the file, `:123`, gives the prompt when it is enabled; [B24-D4 review, 2026-10-10] correctness-1: with the
prompt still disabled - the card closed while the run streams - it moves no focus (`false`, `:125`), never Base UI's default, so focus
is on `body` and page.tsx's run-end return, which acts only from `body`, takes it to the prompt when the run ends), as the worksheet
returns focus to its trigger. When the card closes by Escape, Cancel or Confirm, focus lands on the prompt: `b24-d3-bom-dialogs` 5 in
jsdom (red first on `1fe719e`, `d4r2-04-red-card-focus`: focus on `body`; green after, `d4r2-05-green-card-focus`); closed while the
prompt is still disabled, focus is on `body` (not the page's first control, where the default sent it), then on the prompt after
page.tsx's run-end code, run over jsdom: `b24-d3-bom-dialogs` 6 (red first on the D4 tree, `d4fix-03-red-card-focus` and
`d4fix-06-red-card-focus-2`: focus on the page's first control; green after, `d4fix-07-green-part1`). **CONFIRMED** in jsdom only.
The browser proof is case 4's stricter assertion (focus ON the prompt, `keyboard-and-focus.spec.ts:235`, in place, which either path
satisfies), PROPOSED until the lead's run.

**The four hand-rolled dialogs outside OD-215's list** (`b24-d3-accessible-names` 5 pins exactly these, outside `BomView.tsx`):

| dialog | `role="dialog"` | observed focus behaviour (read) | state |
|---|---|---|---|
| `SyncPlacementDialog` | `SyncPlacementDialog.tsx:25` | named (`aria-label`); no focus code | open (a follow-up proposal) |
| the routing rules editor | `RoutingRulesPanel.tsx:193` | named (`aria-label`); no focus code | open |
| `FabDialog` | `FabDialog.tsx:103` | named; focus moved to the panel on open (`:53`), Escape handled (`:108`) | open (no return, no trap) |
| `ShortcutsHelp` | `ShortcutsHelp.tsx:84` | named; focus moved to the panel on open (`:74`), Escape handled (`:88`) | open (no return, no trap) |

D3 does not move them (outside OD-215's list; a stop condition). RECORDED, open.

## 5. Test-first record

All runs local (win32), through the session's vitest lock (2 workers); logs in the session scratchpad.

- **`b24-d3-bom-dialogs`, red on `3773c6a`** (`d3-red-1-bom-dialogs`): 16 failed of 16 - for each dialog, cases 1-3 "Unable to find
  role="dialog" and name …" (no accessible name, so no focus move or Escape could be reached) and case 4 "expected [] to have a length
  of 1" (the drawers' close controls are named "✕"). Green after the move (`d3-green-1-bom-dialogs`): 16 of 16, with the two BOM
  component suites (38 tests in 3 files).
- **Mutation** (`d3-mutation-no-finalfocus`): `finalFocus` removed from the worksheet - its case 3 red (1 failed, 15 passed); the file
  restored byte-identical (sha256 `946ae534…`).
- **`b24-d3-accessible-names`, red 1 on `3773c6a`** (`d3-red-1-accessible-names`): failed to load - "Cannot find module
  '@/app/lib/engineering/accessible-names'".
- **Red 2: the rule in place, before any fix** (`d3-red-2-accessible-names`): 7 failed, 3 passed of 10 (cases 1, 3 and 10 without the
  census and the page; 4 and 6 on the undeclared canvases and the missing literals; 5 on the BOM dialogs; 7, 8 and 9 green). Case 2
  printed the in-scope counterexample list, verbatim:

```
"app/components/editor/BuildLibraryPanel.tsx|change|Input|Search this category…|setSearchQuery (line 489; placeholder-only)",
"app/components/pcb/ComponentReviewPanel.tsx|change|input|review-reason-*|setReasons (line 196; placeholder-only)",
"app/components/pcb/ComponentReviewPanel.tsx|change|input|review-successor-reason-*|setReason (line 112; placeholder-only)",
"app/components/pcb/DrcPanel.tsx|change|select|(none)|drc.setActivePresetId (line 119; none)",
"app/page.tsx|change|Textarea|prompt-input|setInput (line 6955; placeholder-only)",
"app/page.tsx|key|Textarea|prompt-input|e.preventDefault,handleComposerSubmit (line 6956; placeholder-only)",
```

  The rule was then refined twice before any UI edit (BomView's `KindToggle` added to `NAME_FORWARDING`; name from content limited to
  ARIA's name-from-contents elements, so a `div` or an SVG shape is no longer named by its text) and re-run over a `git archive` of
  `3773c6a`'s surfaces (`d3-measure-3773c6a`): the same six in-scope sites, zero structural problems, 111 out of scope - the pinned
  number (`OUT_OF_SCOPE_UNNAMED_AT_3773C6A`).
- **The browser specs**: written, not run here (no browser-run lock script is named in the task, and the builder starts no
  `next dev`). Expected red on `3773c6a`: `keyboard-and-focus` 1 (no prompt named `CHAT_PROMPT_LABEL`), 2 (no log; focus on `body`)
  and 5 (no `img` role); `minimum-width` 3 (no notice). Expected green first, by design, recorded as such: `keyboard-and-focus` 3 (the
  keyboard Go-to existed) and possibly 4 (the shared dialog's trap). The lead runs each once red and once green and keeps the output.

**The review round (2026-10-10).** An adversarial review confirmed six findings; each was reproduced first (logs `d3fix-*`), then
fixed, then re-run. A test-strength finding was reproduced by a deliberate breakage of the source that the old suite let through,
then the strengthened suite was run on the same breakage, then the source was restored byte-identical (sha256).

- **correctness-1, security-1 (the out-of-scope ratchet).** Breakage: an unnamed input (placeholder "x") added to
  `app/components/spice/SpiceStudio.tsx`; the committed census deleted and regenerated (the generator skipped its ratchet when the file
  was absent) and B17-A regenerated. The old suite: 10 of 10 green, 103 unnamed under the bound 111 (`d3fix-c1-repro-old-suite`). With
  the census restored, the old generator also wrote the 103-unnamed census into a fresh output directory, exit 0, because it read its
  baseline from that directory (`d3fix-c1-repro-gen-outdir-old`). The strengthened case 3 on the same breakage: 1 failed, 9 passed -
  "a new unnamed site: ... `app/components/spice/SpiceStudio.tsx|change|input|x|mutate,draft.outputs.find` (... placeholder-only)"
  (`d3fix-c1-red-new-suite-2`; with the count checked first, "expected 103 to be less than or equal to 102", `d3fix-c1-red-new-suite`).
  The fixed generator refused both routes, exit 1: the fresh output directory ("New unnamed controls", `d3fix-c1-gen-outdir-new`) and
  the deleted census ("No committed census ... pass --bootstrap", `d3fix-c1-gen-missing-new`). Restored byte-identical: `SpiceStudio.tsx`
  (`a46b4021…`), the census and its summary (`3c11d42f…`, `150ae9d3…`), B17-A's CSV and summary (`85bd9ad7…`, `282bb333…`).
- **correctness-3 (the drawers' "✕").** Breakage: a "✕" close re-added to `HistoryPanel` and to `AlternatesDrawer` (with
  `title="Close"`). The old suite: 16 of 16 green (`d3fix-c3-repro-old-suite`): a "✕" is named by its content, so the count of
  buttons named "Close" stayed 1. The strengthened `b24-d3-bom-dialogs` 4 and `b24-d3-accessible-names` 5 on the same breakage:
  `HistoryPanel` 4 and `AlternatesDrawer` 4 red ("a button named by a glyph alone"), case 5 red (`BomView.tsx:1535 <button> "✕"`,
  `:1709`) (`d3fix-c3-red-new-suites`). `BomView.tsx` restored byte-identical (`946ae534…`).
- **correctness-2 (the focus return took focus from a pointer person).** New `b24-d3-accessible-names` 11 runs the page's own code
  (send's busy line, the root element's pointer capture, the run end's block) over a focus model, five runs. Red on the D3 code
  (`d3fix-red-current-code`): three runs ended on the prompt where focus belongs on `body` - a pointer press during the run, a pointer
  press as the prompt comes back, a run sent from another control. Fixed in place (section 3: `app/page.tsx:2627`, `:4466`, `:4809`,
  `:6046`); green.
- **security-2 (More checks named by its glyph; its backdrop reason named it by its title).** Red on the D3 code
  (`d3fix-red-current-code`): case 2 listed `app/page.tsx|click|Button|More checks|setMoreMenuOpen: named:text "⋯"`; case 4 found no
  button whose accessible name is "More checks". Fixed: `aria-label="More checks"` in place on `app/page.tsx:7022`, and
  `exemptionProblems` finds a backdrop's closer by its accessible name (`nameOf`, the census's order); green. The census row moved
  from `named:text` "⋯" to `named:aria-label` "More checks".
- **security-3 (labels without execution).** Case 10's state rule, red on the D3 page (`d3fix-red-current-code`): rows 2.1.1, 2.4.3 and
  2.4.7 read "tested in part" on browser cases alone. Its focus-claim rule, red on that page with those three rows set to PROPOSED
  (`d3fix-s3-red-focus-claim-2`): section 0 cited case 6, which asserts nothing about the focus return (a first version of the rule
  missed the claim, which spans a line break, `d3fix-s3-red-focus-claim`; blocks are now flattened). Fixed: the three rows read
  PROPOSED until the lead's run, and the focus return cites case 11; green.
- **After the fixes**: both suites 27 of 27 (`d3fix-green-1`); the gates of section 9 re-run.
- **[B24-D3 lead, 2026-10-10] The browser runs** (local, win32, the session's Playwright lock; logs in the session scratchpad):
  - red on `3773c6a`'s code (`d3-red-browser`; the eight product files D3 changed put back to `3773c6a`'s bytes for the run and
    restored, every sha256 matched): `keyboard-and-focus` 1 red (the prompt named `CHAT_PROMPT_LABEL` not found: no accessible
    name), 2-5 not reached (serial; each reads a name, a log or a role `3773c6a` lacks: INFERRED red); `minimum-width` 3 red (no
    notice), 1 and 2 green by design (the viewport, and the controls inside it at 1,280 px);
  - the first run of the default configuration on the D3 tree (`d3-browser-default-2`): 63 passed, `keyboard-and-focus` 1 failed
    at its unmeasured bound (80 presses; the stops listed reached the routing panel), 4 not run; a measuring run with the bound
    lifted (`d3-measure-case1`, the spec restored byte-identical after): 5 of 5, 13 presses to AI Chat and 95 to the prompt;
  - green on the final bytes (`d3-browser-default-final`, the default configuration): 65 passed, every D3 case among them
    (`keyboard-and-focus` 1-5, `minimum-width` 1-3); `multi-tab` case 1 ended in a Playwright worker-process crash (0xC0000409, no
    assertion failed; the third in that case on this machine, B24-D2's ledger records the others) and its 2 later cases did not run;
    `multi-tab` alone then 3 of 3 (`d3-multitab-alone-1`); the orchestration configuration 4 of 4 (`d3-browser-orch`, on the D3
    product code); evidence PNGs restored by blob hash. `BROWSER_SPECS_EXECUTED` flipped and rows 2.1.1, 2.4.3 and 2.4.7 moved with
    this record (`b24-d3-accessible-names` 10 green, `d3-lead-suites`).

## 6. Responsive scope: desktop only, the minimum width and its notice (OD-215)

- **`EDITOR_MIN_WIDTH_PX` = 1,280** (`app/lib/accessibility/statements.ts:11`): the one width every spec has exercised
  (`devices["Desktop Chrome"]`, `playwright.config.ts:39`), with the chat (384 px, `app/page.tsx:2561`) and the left panel (240 px,
  `:2562`) at their defaults. A lower value needs a spec that proves it; none is proposed. A stated choice (OD-237 (e)).
- **The notice** (`app/layout.tsx:41`): `MIN_WIDTH_NOTICE`, beside the identity banner, `hidden max-[1280px]:block` - Tailwind's
  `max-[1280px]` variant is `@media (width < 1280px)`, so it shows at 1,279 px and below and is hidden at 1,280 and above. CSS only: no
  script, no listener, no control, so no B17-A site (`b24-d3-accessible-names` 6 scans the layout: zero sites).
- **Measured in the browser** by `e2e/minimum-width.spec.ts` (CONFIRMED by the lead's run, section 5): the 1280 x 720 project viewport (1);
  at 1,280 px, with the left panel closed and then open, the notice hidden, the AI Chat button, the schematic Go to field and the chat
  prompt inside the viewport and hit-testable, and no sideways scroll (2); at 1,279 px the notice visible with exactly
  `MIN_WIDTH_NOTICE` (3).
- **Below 768 px**, `app/globals.css:11-27` (unchanged) turns the chat into a fixed overlay. That is the pre-existing behaviour and is
  not qualified: no case measures it, and no tablet or mobile layout is presented as supported (OD-215; discovery section 8 item 12
  stays UNKNOWN with OD-215's defaults applied).

## 7. Keyboard journeys and visible focus (the browser specs)

`e2e/keyboard-and-focus.spec.ts` (fixture runtime, its own context, serial; one `bootstrapSynchronizedBoard` in the uuid namespace
`b24d3000`, which no other spec uses; no mouse after the bootstrap; the fresh load is `page.reload()` plus `expectHydrated`):

1. From a fresh load (the chat closed: `chatOpen` starts `false`, `app/page.tsx:2559`), Tab reaches "AI Chat" (at most 40 presses),
   Enter opens the chat, and Tab reaches the prompt named `CHAT_PROMPT_LABEL` (at most 120 - [B24-D3 lead] measured 95; 80, unmeasured, failed); the press counts and every stop are
   attached to the run. Every stop is visibly focused: its computed outline, box-shadow or border colour once focused differs from
   the same element blurred (measured after 250 ms, past the 150 ms transitions), and no stop is `body`. The path crosses controls
   outside the scope (the header, including the handler-less Settings button; the workspace tabs; the schematic toolbar).
2. "Status." sent with Enter: the `(fixture agent) ` reply inside `[role="log"][aria-live="polite"]`, `aria-busy="false"` after the
   terminal event, focus on the prompt.
3. Shift+Tab to the PCB tab, Enter; Tab to `pcb-goto-input`, "R3", Enter: the selection's primary is a footprint.
4. The Tier 1 card by keyboard (section 4), every stop of the cycle visibly focused; after Escape the entry reads cancelled ("Cancelled
   — nothing was changed."), R3 has not moved (a "Status." turn's editor context before and after), and focus is on the prompt
   ([B24-D4, 2026-10-10] stricter, in place at `:235`; was: focus is not on `body`. PROPOSED until the lead's browser run).
5. Both canvas hosts expose `role="img"` named exactly by their statements, each naming the Go to field case 3 used.

**Visible-focus fixes.** None made: reading the stops on the case 1 path, every control either keeps the browser's own
`:focus-visible` outline (no `outline-none`), draws Base UI's `focus-visible` ring (`Button`, `Textarea`), or changes its border colour
on focus (the AI Brain and autonomy selects, the sheet-size select, the schematic Go to field). CONFIRMED by the lead's run for every stop of case 1's path (95) and the card's cycle; a stop
that fails is fixed in place by a `focus-visible` class on its existing line (a fix that would touch `components/ui/*`, add a
`page.tsx` line or move a B21 or B23 line pin is a STOP).

**After Escape on the card.** Base UI returns focus to the element focused when the card opened; the prompt was disabled then, so
that element is `body`, and Base UI moves focus to `body`'s first tabbable element instead (the header's first button). INFERRED from
`FloatingFocusManager`'s return-focus code; case 4 asserts only that focus is not on `body`. Recorded open (section 12).
[B24-D4, 2026-10-10] That INFERRED fallback was the defect: on CI's runner (run 38061798204) focus stayed on `body` and case 4 failed
at `:235`. The card now returns focus to the prompt through its `finalFocus` (section 4; `b24-d3-bom-dialogs` 5, jsdom), and case 4
asserts focus on the prompt, PROPOSED until the lead's browser run. [B24-D4 review, 2026-10-10] Base UI's default is the last
element an earlier popup recorded (a list it keeps across popups), not `body`'s first tabbable element; closed while the prompt is
still disabled, the card now moves no focus, so focus is on `body` until page.tsx's run-end return takes it to the prompt
(`b24-d3-bom-dialogs` 6, jsdom).

**[B24-D3 lead, 2026-10-10] Case 1's measured path.** On the lead's run, 13 Tab presses reach AI Chat from a fresh load and 95 more
reach the prompt: the chat `<aside>` follows the whole PCB editor in the DOM (the workspace tabs, the PCB toolbar, Go to, the board
and stackup controls, the component review's nine Evidence toggles, the layer panel's Activate and Toggle buttons, the routing
panel's selects), and opening the chat does not move focus into it. Every stop is visibly focused and none is `body` (CONFIRMED).
The first green-path run failed case 1 at the builder's unmeasured bound of 80 presses (`d3-browser-default-2`); the bound is now
120 from the measurement (`keyboard-and-focus.spec.ts:39`, in place). A keyboard person reaches the prompt only across the editor:
a 2.4.3 / 2.4.1 gap, recorded and not fixed here (moving focus into the chat on open, or a skip link, is a change to `app/page.tsx`
outside D3's code list; section 12).

## 8. WCAG 2.2 AA, criterion by criterion

Each row names the case that measures it (the browser cases ran on the lead's runs, section 5), or says NOT MEASURED or NOT MET.
"In part" means the cited cases measure what they say and nothing more. No row claims conformance. A row whose only cases are
browser-spec cases reads PROPOSED, never tested, until the lead's green run of both specs (`b24-d3-accessible-names` 10 holds it to
that through `BROWSER_SPECS_EXECUTED`, which the lead flips to true with the rows, the review round's security-3). [B24-D3 lead, 2026-10-10] Flipped: both specs green, section 5.

| criterion | level | state | evidence |
|---|---|---|---|
| 1.1.1 Non-text Content | A | tested in part | the canvases' text alternatives `b24-d3-accessible-names 6`, `keyboard-and-focus 5`; in-scope icon controls named `b24-d3-accessible-names 2`; the rest is not measured |
| 1.2.1 Audio-only and Video-only (Prerecorded) | A | NOT MEASURED | no media in the scanned surfaces (INFERRED) |
| 1.2.2 Captions (Prerecorded) | A | NOT MEASURED | no media (INFERRED) |
| 1.2.3 Audio Description or Media Alternative (Prerecorded) | A | NOT MEASURED | no media (INFERRED) |
| 1.2.4 Captions (Live) | AA | NOT MEASURED | no media (INFERRED) |
| 1.2.5 Audio Description (Prerecorded) | AA | NOT MEASURED | no media (INFERRED) |
| 1.3.1 Info and Relationships | A | tested in part | labels wired `b24-d3-accessible-names 2`; the transcript a log `b24-d3-accessible-names 6`; dialogs titled `b24-d3-accessible-names 5`, `b24-d3-bom-dialogs 1`; tables and headings are not measured |
| 1.3.2 Meaningful Sequence | A | NOT MEASURED | |
| 1.3.3 Sensory Characteristics | A | NOT MEASURED | |
| 1.3.4 Orientation | AA | NOT MEASURED | no orientation lock in the code (INFERRED); below 1,280 px the layout is not qualified (1.4.10) |
| 1.3.5 Identify Input Purpose | AA | NOT MEASURED | |
| 1.4.1 Use of Color | A | NOT MEASURED | |
| 1.4.2 Audio Control | A | NOT MEASURED | no audio (INFERRED) |
| 1.4.3 Contrast (Minimum) | AA | NOT MEASURED | no contrast tool; an axe audit is the owner's (OD-215) |
| 1.4.4 Resize Text | AA | NOT MEASURED | |
| 1.4.5 Images of Text | AA | NOT MEASURED | |
| 1.4.10 Reflow | AA | NOT MET | desktop only by OD-215: the editor needs 1,280 CSS px; below it the notice says so (`minimum-width 3`) |
| 1.4.11 Non-text Contrast | AA | NOT MEASURED | focus indicators are measured as present (2.4.7), not for contrast |
| 1.4.12 Text Spacing | AA | NOT MEASURED | |
| 1.4.13 Content on Hover or Focus | AA | NOT MEASURED | |
| 2.1.1 Keyboard | A | tested in part | `keyboard-and-focus 1`, `keyboard-and-focus 2`, `keyboard-and-focus 3`, `keyboard-and-focus 4`; the canvases are pointer-only, declared, with Go to as the alternative for selection (`keyboard-and-focus 5`); the panel resizers have no keyboard path (2.5.7) |
| 2.1.2 No Keyboard Trap | A | tested in part | the Tier 1 card only: Escape leaves it `keyboard-and-focus 4`; the BOM dialogs close on Escape `b24-d3-bom-dialogs 3` |
| 2.1.4 Character Key Shortcuts | A | NOT MEASURED | the schematic's single-key shortcuts (a window `keydown` listener) cannot be remapped or turned off (INFERRED; a likely NOT MET, no case) |
| 2.2.1 Timing Adjustable | A | NOT MEASURED | |
| 2.2.2 Pause, Stop, Hide | A | NOT MEASURED | |
| 2.3.1 Three Flashes or Below Threshold | A | NOT MEASURED | |
| 2.4.1 Bypass Blocks | A | NOT MEASURED | no skip link; case 1 of the keyboard spec records how many presses reach the chat: 95 from AI Chat to the prompt on the lead's run (section 7) |
| 2.4.2 Page Titled | A | NOT MET | the document title is "Create Next App" (`app/layout.tsx:20`, read; no case) |
| 2.4.3 Focus Order | A | tested in part | every stop recorded on the path to the prompt `keyboard-and-focus 1`: 95 presses from AI Chat, focus not moved into the opened chat (section 7, a gap); whether the order is meaningful is not judged; [B24-D4, 2026-10-10] the Tier 1 card returns focus to the prompt when it closes `b24-d3-bom-dialogs 5` (CI run 38061798204 found it on `body`, section 4); [B24-D4 review, 2026-10-10] closed while the prompt is still disabled, no focus moves until page.tsx's run-end return takes it to the prompt `b24-d3-bom-dialogs 6` |
| 2.4.4 Link Purpose (In Context) | A | NOT MEASURED | |
| 2.4.5 Multiple Ways | AA | NOT MEASURED | a single-page editor (INFERRED) |
| 2.4.6 Headings and Labels | AA | tested in part | in-scope labels present `b24-d3-accessible-names 2`; dialog headings `b24-d3-bom-dialogs 1`, `b24-d3-accessible-names 5`; their wording is not judged |
| 2.4.7 Focus Visible | AA | tested in part | every stop on the path to the prompt `keyboard-and-focus 1`; the card's three controls `keyboard-and-focus 4`; elsewhere not measured |
| 2.4.11 Focus Not Obscured (Minimum) | AA | NOT MEASURED | |
| 2.5.1 Pointer Gestures | A | NOT MEASURED | |
| 2.5.2 Pointer Cancellation | A | NOT MEASURED | |
| 2.5.3 Label in Name | A | NOT MEASURED | |
| 2.5.4 Motion Actuation | A | NOT MEASURED | no motion input (INFERRED) |
| 2.5.7 Dragging Movements | AA | NOT MET | the panel resizers are pointer drags with no single-pointer or keyboard alternative (`app/page.tsx:6288`, `:6471`) |
| 2.5.8 Target Size (Minimum) | AA | NOT MEASURED | |
| 3.1.1 Language of Page | A | NOT MEASURED | `lang="en"` is read at `app/layout.tsx:31`; no case |
| 3.1.2 Language of Parts | AA | NOT MEASURED | |
| 3.2.1 On Focus | A | NOT MEASURED | |
| 3.2.2 On Input | A | NOT MEASURED | |
| 3.2.3 Consistent Navigation | AA | NOT MEASURED | |
| 3.2.4 Consistent Identification | AA | NOT MEASURED | |
| 3.2.6 Consistent Help | A | NOT MEASURED | |
| 3.3.1 Error Identification | A | tested in part | the chat error and the provider refusal are alerts `b24-d3-accessible-names 6`; their wording is not judged |
| 3.3.2 Labels or Instructions | A | tested in part | in-scope inputs named `b24-d3-accessible-names 2`; out of scope the census lists 102 unnamed sites `b24-d3-accessible-names 3` |
| 3.3.3 Error Suggestion | AA | NOT MEASURED | |
| 3.3.4 Error Prevention (Legal, Financial, Data) | AA | NOT MEASURED | |
| 3.3.7 Redundant Entry | A | NOT MEASURED | |
| 3.3.8 Accessible Authentication (Minimum) | AA | NOT MEASURED | the sign-in page is outside OD-215's scope |
| 4.1.2 Name, Role, Value | A | tested in part | names on handler sites `b24-d3-accessible-names 1`, `b24-d3-accessible-names 2`, `b24-d3-accessible-names 3`; dialogs `b24-d3-accessible-names 5`, `b24-d3-bom-dialogs 1`; canvases `b24-d3-accessible-names 6`; handler sites only (section 2): handler-less focusable controls such as the Settings button (`app/page.tsx:6166`) are outside the census; roles and values are not measured |
| 4.1.3 Status Messages | AA | tested in part | the transcript a polite log with `aria-busy` `b24-d3-accessible-names 6`, `keyboard-and-focus 2`; the two errors alerts `b24-d3-accessible-names 6`; what a screen reader announces is not measured |

## 9. Gates and pins moved

**Pins moved (each regenerated by its generator, never by hand, and reviewed row by row).**

- **B17-A** (`b17-a-control-inventory` 1-2): `ui-control-inventory-summary.json` sites 631 -> 628, surfaces 63 (unchanged), click 354
  -> 347 (four BOM backdrops, three drawer "✕" buttons), dialog 11 -> 15 (the four BOM `Dialog`s), view 312 -> 309; the CSV moves on
  those rows and two relabels (the DRC preset `select`, `(none)` -> "DRC rule preset"; the build library search, "Search this
  category…" -> "Search this category"); every site still matches exactly one rule (`view.bom-chrome`, `view.drc-panel`,
  `view.build-library`); no rule edited. `scripts/generate-b17-control-inventory.ts`.
- **B01 fingerprint** (`action-registry` "the committed control fingerprint"): `ui-control-fingerprint.json` gains "Conversation
  with the assistant", "Message to the assistant" and the schematic canvas statement on `app/page.tsx`, "DRC rule preset" on
  `DrcPanel.tsx` and "Search this category" on `BuildLibraryPanel.tsx`, and loses BomView's "Close" (the alternates drawer's "✕"
  title). The B01 CSV and `api-route-coverage.csv` are byte-identical. `scripts/generate-action-toolability-matrix.ts`.
- **B24-D1's threshold census** (`b24-d1-threshold-census` 5, not named by the task): 302 -> 305 rows - a `budget` row for each D3
  suite and a `yield` row for `b24-d3-accessible-names`; the elapsed counts (48 / 7 / 13) unchanged. The suites spell their budgets
  as numeric literals so the census sees them. `scripts/generate-b24-threshold-census.ts`. The review round moved two counts on the
  `b24-d3-accessible-names` rows in place: budgets 9 -> 10 (case 11) and yields 3 -> 5 (case 11 and its runs); 305 rows unchanged.
- **The new census** and its summary (`scripts/generate-b24-accessible-names.ts`). The review round moved one row: the More checks
  button, `named:text` "⋯" -> `named:aria-label` "More checks" (summary `named:aria-label` 134 -> 135, `named:text` 253 -> 252; in scope
  39 -> 40 and 101 -> 100); unnamed 102 and every other row unchanged. B17-A and the B01 fingerprint did not move in the review
  round (the button's B17 key label stays "More checks", aria-label before title; the fingerprint already held "More checks").

**Unchanged:** `app/page.tsx` at 8,459 lines and B21's line pins; `ProviderExchangePanel.tsx` `:122`, `:129`, `:157`;
`ManufacturingWorkflowPanel.tsx` (no edit); `control-registry.ts` and `control-surface.ts` (no edit); `components/ui/dialog.tsx` (no
edit); the census 168 / 165 / 3 / 0; the tool counts 48 / 37 / 9 / 28; 107 action records; the workflow (no line added: the unit
suites ride A1's directory filter `deterministic-manufacturing.yml:229`, the specs ride `pnpm exec playwright test` `:417`);
`package.json`.

**Gates** (local, win32, sequential through the session's locks, one runner at a time, every runner stopped when it ended; each exit 0
unless it says otherwise; logs `d3-gate-*`, `d3-before-readers`, `d3-tsc-*`, `d3-eslint-1`, `d3-gen-*` in the session scratchpad):

| gate | result |
|---|---|
| before any UI edit, the 79 readers of the files D3 edits (by name: `page.tsx`, `BomView`, `ProviderExchangePanel`, `ComponentReviewPanel`, `BuildLibraryPanel`, `layout.tsx`; B17-A, B01, B19-E's job scope, D1's census) | 78 of 79 files, 940 of 941 tests; the one red `b24-d1-threshold-census` 5, the byte pin D3's two new suites move (regenerated below), exit 1 |
| the two D3 suites with the three closeout scanners (on this page) | 5 files, 53 tests |
| `app/lib/qualification/__tests__` (whole; after the two `b24-d0-ci-split` pin moves) | 42 files passed, 3 skipped; 447 tests passed, 15 skipped |
| `app/lib/engineering/__tests__` | 99 files, 1,107 tests |
| `app/lib/project/__tests__` | 37 files, 294 tests |
| `app/lib/agent/orchestration/__tests__` | 49 files, 460 tests |
| `app/lib/manufacturing-providers/__tests__` with `database/__tests__/b23-b-exchange-ledger-pglite.test.ts` | 30 files, 392 tests |
| `app/lib/auth/__tests__` | 41 files; 479 tests passed, 9 skipped |
| `app/api/parts/__tests__` | 1 file, 19 tests |
| `app/components/{bom,chat,pcb,parts,editor,schematic}/__tests__` | 29 files; 146 tests passed, 1 skipped |
| `app/lib/agent/__tests__` | 36 files, 415 tests |
| `app/api/__tests__` and `app/api/schematic/__tests__` | 29 files, 1,075 tests |
| `app/lib/__tests__`, `app/lib/bom/__tests__`, `app/lib/atomic/__tests__` | 34 files, 496 tests |
| `app/lib/computation/__tests__` | 26 files passed, 2 skipped; 300 tests passed, 18 skipped |
| `b19-e-ci-job-scope` | 1 file, 15 tests |
| tsc (`--noEmit -p tsconfig.json`) | 0 errors (after one TS2339 pair in the rule module, narrowed in place) |
| eslint on the 16 changed TS files | 18 errors, all pre-existing: 14 in `app/page.tsx` (react-hooks, D24-40; none on a D3 line) and 4 in `BomView.tsx` (`react-hooks/set-state-in-effect`, as recorded since B16.0.2); one D3 warning (an unused import) removed |
| every generator (25), once after the gates | zero drift beyond the four reviewed moves above; the four D3-touched generators (B17-A, B01, the threshold census, the accessible-name census) byte-identical on this second run |
| raw control bytes, CR, key-shaped literals in the changed files | none; the repository's secret scan in tree mode (`scripts/scan-secrets.ts`): 4,163 entries, 8 allowlisted lines (B24-A2's), exit 0 |

**Gates re-run in the review round (2026-10-10)**, after the fixes, the same way (logs `d3fix-*`):

| gate | result |
|---|---|
| the two D3 suites with the three closeout scanners (on this page) | 5 files, 54 tests (case 11 added) |
| `app/lib/qualification/__tests__` (whole) | 42 files passed, 3 skipped; 448 tests passed, 15 skipped |
| `app/lib/engineering/__tests__` | 99 files, 1,107 tests |
| `app/lib/project/__tests__` | 37 files, 294 tests |
| `app/lib/agent/orchestration/__tests__` (B21's page suites among them) | 49 files, 460 tests |
| `app/lib/manufacturing-providers/__tests__` with `database/__tests__/b23-b-exchange-ledger-pglite.test.ts` | 30 files, 392 tests |
| `app/lib/auth/__tests__` | 41 files; 479 tests passed, 9 skipped |
| `app/api/parts/__tests__` | 1 file, 19 tests |
| `app/components/{bom,chat,pcb,parts,editor,schematic}/__tests__` | 29 files; 146 tests passed, 1 skipped |
| `app/lib/agent/__tests__` | 36 files, 415 tests |
| `app/api/__tests__` and `app/api/schematic/__tests__` | 29 files, 1,075 tests |
| `app/lib/__tests__`, `app/lib/bom/__tests__`, `app/lib/atomic/__tests__` | 34 files, 496 tests |
| `app/lib/computation/__tests__` | 26 files passed, 2 skipped; 300 tests passed, 18 skipped |
| `b19-e-ci-job-scope` | 1 file, 15 tests |
| tsc (`--noEmit -p tsconfig.json`) | 0 errors |
| eslint on the 16 changed TS files | 18 errors, all pre-existing and on no line the review round touched: 14 in `app/page.tsx` (react-hooks, D24-40) and 4 in `BomView.tsx` (`react-hooks/set-state-in-effect`); 0 warnings |
| every generator (25), once after the fixes | exit 0 each; zero drift against the tree after the four D3-touched generators' first post-fix run (the census row and the threshold counts of section 9), so those four were byte-identical on their second run |
| raw control bytes, CR in the changed files; the secret scan in tree mode | none; 4,163 entries, 8 allowlisted lines, exit 0 |

Never run here: the three Java-capable `app/lib/pcb` suites; `next build`, `next start`, `next dev`; either Playwright configuration
(the lead's runs, section 5).

## 10. Superseded statements (lead decision D5)

Corrections of the discovery, each with its line at `8664964` and re-resolved at `3773c6a` (its text is not edited here; B24-F gathers
every increment's list into one table):

- `8664964:418-419` and `:761` (`3773c6a:418-419` and `:794`), "two `aria-live` regions": true of the explicit attribute
  (`LocalDevIdentityBanner.tsx:36`, `AutonomyModeControl.tsx:158`), but 13 more sites carry implicit live semantics at `3773c6a`
  (CONFIRMED by `git grep`): `role="status"` at `BomView.tsx:1022`, `:1042`, `:1081`, `AtomicPublicationReviewPanel.tsx:245` and
  `app/page.tsx:7071` (the toast); `role="alert"` at `AtomicPublicationReviewPanel.tsx:239`, `:241`, `AssignmentQueuePanel.tsx:28`,
  `BoardRevisionDialog.tsx:69`, `ComponentReviewPanel.tsx:147`, `:148`, `app/page.tsx:6851` and `app/signin/page.tsx:87`. After D3 the
  transcript is a polite log and two more errors are alerts.
- `8664964:421-422`, `:1256` (9.2, "195 rows unlabelled") and `:1361` (9.3, "631 / 63 (195 unlabelled)") (`3773c6a:421-422`, `:1295`,
  `:1400`): B17-A's key label `(none)`, not an accessible-name count; the rule's count at `3773c6a` is 117 unnamed of 631 (6 in scope,
  111 out).
- `8664964:422` (`3773c6a:422`), approval cards "browser-proven modal": a reachability proof (`agent-execution.spec.ts`), not a
  Tab-trap proof; the trap is measured on the Tier 1 card by `keyboard-and-focus` 4.
- `8664964:762-763` (`3773c6a:795-796`), the BOM dialogs' missing focus as INFERRED: CONFIRMED by reading at `3773c6a` (no name, no
  focus call, no Escape handler).
- `8664964:763` (`3773c6a:796`), "one breakpoint class in `app/page.tsx`": `app/globals.css:11-27` also holds `@media (max-width:
  768px)`.
- `8664964:901` (`3773c6a:940`), "OD-42 (no new dependency)": OD-42 concerns the MCP SDK only; D3's no-dependency rule is OD-215's.

## 11. What is not measured (never estimated)

- No assistive-technology run (a person with a screen reader) and no automated axe audit: owner actions (OD-215), NOT MEASURED; no
  LB row is invented for them (the lead decides at the closeout whether OD-217's register gets one).
- Contrast (1.4.3, 1.4.11), target size, text spacing, reflow below 1,280 px, orientation: NOT MEASURED.
- The Tab trap of every dialog but the Tier 1 card; focus order quality; what a live region announces.
- The browser specs on CI's runner until this commit's CI run (the lead's runs, section 5, are local, win32).

## 12. What stays open

- 102 out-of-scope `unnamed` sites (the census lists each; the count may only fall). INFERRED risk: the SPICE studio holds 56 of them.
- Handler-less focusable controls outside the census (4.1.2), the header's unnamed Settings button (`app/page.tsx:6166`) among them.
- The four hand-rolled dialogs outside OD-215's list (section 4): a follow-up proposal.
- The canvases are accessible only through Go to component (selection); every other canvas operation is pointer-only.
- 2.5.7 NOT MET for the panel resizers (`app/page.tsx:6288`, `:6471`); 1.4.10 NOT MET by the desktop-only scope.
- 2.4.2: the document title "Create Next App" (`app/layout.tsx:20`), NOT MET; not in D3's code list, proposed as a follow-up.
- 2.1.4: the schematic's single-key shortcuts, INFERRED, unmeasured.
- Two out-of-scope BOM dismiss buttons (the banner's and the export notice's) are named by the glyph "✕", their `title` "Dismiss"
  only a description: outside the in-scope glyph gate (section 2). INFERRED, low; a follow-up.
- A generate or edit turn (`isGenerating`, `isEditing`) also disables the prompt, and focus is not returned after one (section 3):
  only a chat run sent from the prompt gets it back. INFERRED, low.
- Case 11 runs the page's focus code over a model of the DOM's focus rules, not in a browser; `keyboard-and-focus` 2 is the browser
  proof (CONFIRMED by the lead's run). The pointer capture on the root element is not a B17-A site, by B17-A's own attribute list (section 3).
- After Escape on the Tier 1 card focus lands on the header's first button, not the prompt (section 7), INFERRED, low. [B24-D4,
  2026-10-10] Closed: that fallback was the defect (CI run 38061798204: focus on `body`); the card's `finalFocus` gives the prompt
  (section 4, `b24-d3-bom-dialogs` 5 in jsdom); case 4's stricter browser assertion is PROPOSED until the lead's run. [B24-D4 review,
  2026-10-10] Closed for both paths: closed with the prompt enabled, the card gives the prompt; closed while it is still disabled, the
  card moves no focus and page.tsx's run-end return takes it from `body` to the prompt (`b24-d3-bom-dialogs` 6 in jsdom). Left open:
  that return acts only for a run sent from the prompt with no pointer pressed since (`chatFocusReturnRef`), so a card closed by a
  pointer click while the run streams leaves focus on `body` after the run, by B24-D3's pointer rule. INFERRED, low.
- [B24-D3 lead, 2026-10-10] The chat prompt is 95 Tab presses after AI Chat (section 7): opening the chat does not move focus into
  it and there is no skip link (2.4.3, 2.4.1). CONFIRMED by the lead's run; a follow-up in `app/page.tsx`, not D3's.
- The BOM drawers now cover the viewport through the portal (section 4), INFERRED visual change, low.
- The rule's canvas exemption is lexical (section 3): components defined elsewhere and rendered into the `<svg>` keep their status.

## 13. Citations, as of the B24-D3 tree

Each anchor stands on the line given (`b24-d3-accessible-names` 10 checks it on that line).

[Post-B24, 2026-10-11] C36-C39 and C58-C60 below were refreshed to their current source lines after the UI state and citation-test changes. [Product reliability B, 2026-10-14] C36-C39 refreshed again after the BOM view's request-settlement change (`bom-refresh-lifecycle`): citation maintenance only; the cited code is unchanged. [Product reliability C, 2026-10-14] C14-C21 and C62-C65 (app/page.tsx) re-pointed after the composer submission, the journey strip and the proposal persistence moved the page's lines (8459 -> 8556); citation maintenance only. This refresh keeps the executable citation table current; the dated B24 observations and test-run records above retain their original scope and meaning.

| id | file | line | within | anchor | note |
|---|---|---|---|---|---|
| C1 | `app/lib/engineering/accessible-names.ts` | 35 | — | `export const NAME_SOURCES = Object.freeze(["aria-labelledby", "aria-label", "label-wrap", "label-for", "text", "title", "palette-title",` | the closed name sources |
| C2 | `app/lib/engineering/accessible-names.ts` | 37 | — | `export const EXEMPT_REASONS = Object.freeze(["dialog-titled", "form-submit", "listener", "click-shield", "backdrop", "canvas-gesture"]` | the closed exemption reasons |
| C3 | `app/lib/engineering/accessible-names.ts` | 62 | — | `export const ACCESSIBILITY_SCOPE: readonly ScopeEntry[] = Object.freeze([` | OD-215's surfaces |
| C4 | `app/lib/engineering/accessible-names.ts` | 117 | — | `export const NAME_FORWARDING: readonly NameForwarding[] = Object.freeze([` | the closed forwarding list |
| C5 | `app/lib/engineering/accessible-names.ts` | 129 | — | `export const BACKDROP_EXEMPTIONS: readonly BackdropExemption[] = Object.freeze([` | the closed backdrop list |
| C6 | `app/lib/engineering/accessible-names.ts` | 143 | — | `export const CANVAS_HOSTS: readonly CanvasHost[] = Object.freeze([` | the two declared canvases |
| C7 | `app/lib/engineering/accessible-names.ts` | 360 | — | `const CONTENT_NAMED_TAGS = new Set(["button", "a", "summary", "option", "tr", "td", "th",` | name from content |
| C8 | `app/lib/engineering/accessible-names.ts` | 642 | — | `function structuralProblems(` | the structural rules |
| C9 | `app/lib/engineering/accessible-names.ts` | 666 | — | `export async function computeAccessibleNameCensus(cwd: string)` | the census |
| C10 | `scripts/generate-b24-accessible-names.ts` | 35 | — | `Refused: nothing written. New unnamed controls` | the ratchet (line moved from 26 in the review round) |
| C11 | `app/lib/accessibility/statements.ts` | 11 | — | `export const EDITOR_MIN_WIDTH_PX = 1280;` | the minimum width |
| C12 | `app/lib/accessibility/statements.ts` | 14 | — | `export const MIN_WIDTH_NOTICE =` | the notice |
| C13 | `app/page.tsx` | 2088 | — | `<svg role="img" aria-label="Schematic drawing: pointer-only` | the schematic canvas declared, in place |
| C14 | `app/page.tsx` | 4829 | — | `setLoading(false); const returnFocus = (frames: number): void =>` | focus back to the prompt, in place |
| C15 | `app/page.tsx` | 6923 | — | `role="log" aria-live="polite" aria-relevant="additions text" aria-busy={loading} aria-label="Conversation with the assistant"` | the transcript, in place |
| C16 | `app/page.tsx` | 6937 | — | `<div role="alert" className="px-3 py-1.5 text-xs text-red-400` | the chat error, in place |
| C17 | `app/page.tsx` | 7044 | — | `data-testid="prompt-input" aria-label="Message to the assistant"` | the prompt, in place |
| C18 | `app/page.tsx` | 7054 | — | `disabled={loading \|\| isGenerating \|\| isEditing}` | the prompt is disabled while a run streams |
| C19 | `app/page.tsx` | 6250 | — | `<Button size="sm" variant="ghost" className="text-zinc-300">` | the handler-less, unnamed Settings button |
| C20 | `app/page.tsx` | 6377 | — | `onMouseDown={(e) => startDrag("left", e)}` | a pointer-only resizer (2.5.7) |
| C21 | `app/page.tsx` | 6562 | — | `onMouseDown={(e) => startDrag("right", e)}` | the other resizer |
| C22 | `app/page.tsx` | 1987 | — | `aria-label="Go to component"` | the schematic Go to field |
| C23 | `app/page.tsx` | 2559 | — | `const [chatOpen, setChatOpen]` | the chat starts closed |
| C24 | `app/components/pcb/PcbCanvas.tsx` | 40 | — | `role="img" aria-label={PCB_CANVAS_STATEMENT}` | the PCB host declared |
| C25 | `app/components/pcb/PcbToolbar.tsx` | 375 | — | `aria-label="Go to component"` | the PCB Go to field |
| C26 | `app/components/pcb/ProviderExchangePanel.tsx` | 171 | — | `<div role="alert" className="mt-1 rounded border border-red-500/40` | the refusal, in place |
| C27 | `app/components/pcb/ProviderExchangePanel.tsx` | 129 | — | `data-testid="p2g-ordering-notice"` | the ordering-disabled notice, unchanged |
| C28 | `app/components/pcb/DrcPanel.tsx` | 117 | — | `<select aria-label="DRC rule preset"` | named |
| C29 | `app/components/pcb/ComponentReviewPanel.tsx` | 194 | — | `placeholder="Decision reason (required to reject)" aria-label=` | named |
| C30 | `app/components/pcb/ComponentReviewPanel.tsx` | 110 | — | `placeholder="Rebind reason (required)" aria-label=` | named |
| C31 | `app/components/editor/BuildLibraryPanel.tsx` | 490 | — | `aria-label="Search this category"` | named |
| C32 | `app/layout.tsx` | 41 | — | `data-testid="min-width-notice" className="hidden max-[1280px]:block` | the CSS-only notice |
| C33 | `app/layout.tsx` | 20 | — | `title: "Create Next App",` | 2.4.2 |
| C34 | `app/layout.tsx` | 31 | — | `lang="en"` | 3.1.1 |
| C35 | `app/components/bom/BomView.tsx` | 42 | — | `import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";` | the BOM dialogs on the shared dialog |
| C36 | `app/components/bom/BomView.tsx` | 926 | — | `ref={exportTriggerRef}` | the worksheet's return target |
| C37 | `app/components/bom/BomView.tsx` | 1443 | — | `<DialogContent finalFocus={finalFocus}` | passed as `finalFocus` |
| C38 | `app/components/bom/BomView.tsx` | 1446 | — | `Priced from cached offers, each with its source and when it was observed.` | the worksheet sentence, verbatim |
| C39 | `app/components/bom/BomView.tsx` | 1560 | — | `const BOM_DRAWER_CLASS =` | the drawers, by className only |
| C40 | `components/ui/dialog.tsx` | 45 | — | `showCloseButton = true,` | the default Close |
| C41 | `components/ui/dialog.tsx` | 75 | — | `<span className="sr-only">Close</span>` | its name |
| C42 | `app/components/pcb/GrantedExecutionDialog.tsx` | 54 | — | `onOpenChange={(open) => { if (!open && !busy) onCancel(); }}` | Escape reaches onCancel |
| C43 | `app/components/pcb/GrantedExecutionDialog.tsx` | 57 | — | `<DialogTitle>AI change — confirm before it is made</DialogTitle>` | the card's name |
| C44 | `app/components/pcb/SyncPlacementDialog.tsx` | 25 | — | `role="dialog" aria-modal="true" aria-label="Schematic import placement"` | hand-rolled, outside OD-215 |
| C45 | `app/components/pcb/RoutingRulesPanel.tsx` | 193 | — | `role="dialog" aria-modal="true" aria-label="Routing rules editor"` | hand-rolled, in a scoped file |
| C46 | `app/components/pcb/FabDialog.tsx` | 103 | — | `role="dialog"` | hand-rolled, outside OD-215 |
| C47 | `app/components/pcb/ShortcutsHelp.tsx` | 84 | — | `role="dialog"` | hand-rolled, outside OD-215 |
| C48 | `app/globals.css` | 11 | — | `@media (max-width: 768px) {` | the pre-existing narrow rule, not qualified |
| C49 | `app/lib/engineering/control-surface.ts` | 56 | — | `Human-recognisable label: data-testid > aria-label > title > text > placeholder > name > (none).` | B17-A's label order |
| C50 | `playwright.config.ts` | 39 | — | `devices["Desktop Chrome"]` | the one project |
| C51 | `.github/workflows/deterministic-manufacturing.yml` | 229 | — | `app/lib/qualification/__tests__` | A1's directory filter admits both unit suites |
| C52 | `.github/workflows/deterministic-manufacturing.yml` | 417 | — | `- run: pnpm exec playwright test` | the browser step admits both specs; [B24-D4, 2026-10-10] superseded: since OD-30's split this step leaves both out (`SIRKIT_E2E_SKIP`, `:418-419`) and the appended `page-browser-e2e-b24` runs them (C70; [B24-D4 lead, 2026-10-10] with B24-D2's two specs, by the lead's option (b)) |
| C53 | `.github/workflows/deterministic-manufacturing.yml` | 402 | — | `timeout-minutes: 30` | page-browser-e2e's limit (OD-30) |
| C54 | `.github/workflows/deterministic-manufacturing.yml` | 26 | — | `timeout-minutes: 25` | prompt-to-gerber's limit (OD-30) |
| C55 | `scripts/generate-b24-accessible-names.ts` | 22 | — | `const CENSUS_PATH = "artifacts/ai-control-plane-b24/accessible-name-census.csv";` | the ratchet's baseline, never read from outDir (review round) |
| C56 | `scripts/generate-b24-accessible-names.ts` | 37 | — | `pass --bootstrap for a tree that has none` | a missing baseline refuses (review round) |
| C57 | `app/lib/qualification/__tests__/b24-d3-accessible-names.test.ts` | 76 | — | `const OUT_OF_SCOPE_UNNAMED_AT_3773C6A = 111;` | the `3773c6a` record |
| C58 | `app/lib/qualification/__tests__/b24-d3-accessible-names.test.ts` | 385 | — | `const OUT_OF_SCOPE_UNNAMED_AFTER_D3 = 102;` | the post-D3 pin (review round) |
| C59 | `app/lib/qualification/__tests__/b24-d3-accessible-names.test.ts` | 389 | — | `const UNNAMED_KEYS_AFTER_D3: readonly string[] = [` | the frozen key list (review round) |
| C60 | `app/lib/qualification/__tests__/b24-d3-accessible-names.test.ts` | 498 | — | `const BROWSER_SPECS_EXECUTED = true;` | flipped by the lead after the green browser runs (section 5) |
| C61 | `app/page.tsx` | 2627 | — | `const chatFocusReturnRef = useRef(false);` | the focus-return flag, declared in place (review round) |
| C62 | `app/page.tsx` | 4486 | — | `setLoading(true); chatFocusReturnRef.current = document.activeElement !== null && document.activeElement === document.querySelector('[data-testid="prompt-input"]');` | set when the run is sent from the prompt, in place (review round) |
| C63 | `app/page.tsx` | 4829 | — | `if (!chatFocusReturnRef.current \|\| !prompt` | the return checks the flag every frame, in place (review round) |
| C64 | `app/page.tsx` | 6130 | — | `onPointerDownCapture={() => { chatFocusReturnRef.current = false;` | any pointer press clears it, in place (review round) |
| C65 | `app/page.tsx` | 7119 | — | `title="More checks" aria-label="More checks"` | the More checks button named, in place (review round) |
| C66 | `app/lib/engineering/accessible-names.ts` | 779 | — | `const name = nameOf({ surface: rows[0]!.surface, kind: "click"` | a backdrop's closer found by its accessible name (review round) |
| C67 | `app/components/pcb/GrantedExecutionDialog.tsx` | 55 | — | `<DialogContent className="max-w-xl" finalFocus={promptFocus}>` | [B24-D4, 2026-10-10] the card's return target, in place |
| C68 | `app/components/pcb/GrantedExecutionDialog.tsx` | 125 | — | `return prompt && !prompt.disabled ? prompt : false;` | [B24-D4, 2026-10-10] the prompt when enabled; [B24-D4 review, 2026-10-10] else no focus move (was: Base UI's default, `: true`) |
| C69 | `e2e/keyboard-and-focus.spec.ts` | 235 | — | `await expect(prompt, "focus returns to the prompt after Escape").toBeFocused({ timeout: 10_000 });` | [B24-D4, 2026-10-10] case 4, stricter, in place |
| C70 | `.github/workflows/deterministic-manufacturing.yml` | 651 | — | `run: pnpm exec playwright test e2e/multi-tab.spec.ts e2e/crash-recovery.spec.ts e2e/keyboard-and-focus.spec.ts e2e/minimum-width.spec.ts` | [B24-D4, 2026-10-10] the two specs' job since OD-30's split (`ci-split.md` section 11); [B24-D4 lead, 2026-10-10] `page-browser-e2e-b24`, which also runs B24-D2's two specs (the lead's option (b); Playwright runs the four files in name order, `multi-tab` last) |
