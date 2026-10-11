/**
 * [B24-D3] OD-215 - the accessibility statements and names the editor shows, in one client-safe module with no import.
 *
 * app/page.tsx cannot import them (B21's page suites resolve its line citations, so no line is added there): its copies are
 * string literals pinned equal to these constants by b24-d3-accessible-names case 6, each spelled exactly once in the page.
 * PcbCanvas.tsx and app/layout.tsx import them. The keyboard and minimum-width browser specs read them too.
 */

/** [B24-D3b] OD-215: the editor is qualified for desktop windows at or above this viewport width (CSS pixels); the one width every
 *  browser spec has exercised (`devices["Desktop Chrome"]`, 1280 x 720). Below it the layout is not qualified. */
export const EDITOR_MIN_WIDTH_PX = 1280;

/** [B24-D3b] The notice shown below the minimum width (CSS only: app/layout.tsx; hidden at or above it). */
export const MIN_WIDTH_NOTICE = `Sirkit's editor is supported on desktop windows at least ${EDITOR_MIN_WIDTH_PX.toLocaleString("en-US")} pixels wide. Below that width, panels may overlap or be cut off: widen the window or zoom out.`;

/** [B24-D3a] The schematic canvas is declared non-accessible; its keyboard alternative is the toolbar's Go to component field
 *  (`schematic-goto-input`). */
export const SCHEMATIC_CANVAS_STATEMENT = "Schematic drawing: pointer-only, not readable by assistive technology. From the keyboard, use Go to component in the schematic toolbar to select a component by its reference designator.";

/** [B24-D3a] The PCB canvas is declared non-accessible; its keyboard alternative is the PCB toolbar's Go to component field
 *  (`pcb-goto-input`). */
export const PCB_CANVAS_STATEMENT = "PCB drawing: pointer-only, not readable by assistive technology. From the keyboard, use Go to component in the PCB toolbar to select a footprint by its reference designator.";

/** [B24-D3a] The chat transcript's accessible name (a polite `log` live region, OD-215). */
export const CHAT_TRANSCRIPT_LABEL = "Conversation with the assistant";

/** [B24-D3a] The chat prompt's accessible name (its placeholder is not a name). */
export const CHAT_PROMPT_LABEL = "Message to the assistant";
