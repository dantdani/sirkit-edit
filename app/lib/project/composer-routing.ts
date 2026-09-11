/**
 * [B18-D I1] Where the chat composer sends a message — pure routing, never authority. "ask" sends a chat turn that the
 * SERVER loop authorizes; "edit" and "generate" only ever produce proposals the user reviews. Nothing here can make a
 * change happen.
 *
 * The first matching rule wins (artifacts/ai-control-plane-b18/chat-execution-ux.md §3):
 *  1. empty → ask;
 *  2. no schematic yet → generate (the design prompt of an empty project, unchanged);
 *  3. begins with generate / design → generate;
 *  4. begins with (please) move / shift / nudge / rotate / turn / flip / put / undo / redo → ask (the explicit grammars);
 *  5. begins with an edit verb or create / build / make / draw AND names a PCB object (silkscreen, via, track, trace,
 *     dimension, copper, zone, pour, keep-out, courtyard, drill, layer, pcb, drc, board outline) → ask — a PCB change
 *     the schematic editor cannot make ("footprint" and "board" alone are excluded: both name schematic-side things too);
 *  6. begins with make <reference designator> → edit;
 *  7. begins with create / build / make / draw → generate;
 *  8. begins with an edit verb (word-bounded) → edit;
 *  9. anything else → ask.
 * A release / publish / order / purchase / qualify / upload / ship word adds the display-only "tier3-release" hint: the
 * assistant never does those, whatever the route.
 */
export type ComposerRoute = "ask" | "edit" | "generate";
export type ComposerHint = "tier3-release";
export interface ComposerRouting { route: ComposerRoute; reason: string; hints: ComposerHint[] }

export const COMPOSER_ROUTE_LABELS: Readonly<Record<ComposerRoute, string>> = Object.freeze({
  ask: "ask the assistant",
  edit: "edit the schematic",
  generate: "generate a schematic",
});

const EDIT_VERB = /^(?:edit|change|set|rename|delete|remove|add|replace|swap|connect|disconnect|rewire|fix|update)\b/;
const GENERATE_VERB = /^(?:create|build|make|draw)\b/;
const EXECUTION_VERB = /^(?:please\s+)?(?:move|shift|nudge|rotate|turn|flip|put|undo|redo)\b/;
const PCB_NOUN = /\b(?:silk(?:screen)?|vias?|tracks?|traces?|dimensions?|copper|zones?|pours?|keep-?outs?|courtyards?|drills?|layers?|pcb|drc|board outline)\b/;
const MAKE_PART = /^make\s+(?:r|c|u|d|led|j|sw)\d+\b/;
const TIER3_WORD = /\b(?:release|publish|order|purchase|buy|qualify|upload|ship)\b/;

export function routeComposerMessage(text: string, hasSchematic: boolean): ComposerRouting {
  const t = text.trim().toLowerCase();
  const hints: ComposerHint[] = TIER3_WORD.test(t) ? ["tier3-release"] : [];
  const routed = (route: ComposerRoute, reason: string): ComposerRouting => ({ route, reason, hints });
  if (!t) return routed("ask", "nothing to send yet");
  if (!hasSchematic) return routed("generate", "the project has no schematic yet: the message describes a circuit to generate");
  if (/^(?:generate|design)\b/.test(t)) return routed("generate", "asks to generate or design a circuit");
  if (EXECUTION_VERB.test(t)) return routed("ask", "a move, rotate, flip, undo or redo request: the assistant handles it");
  if ((EDIT_VERB.test(t) || GENERATE_VERB.test(t)) && PCB_NOUN.test(t)) return routed("ask", "names a PCB object the schematic editor cannot change: the assistant handles it");
  if (MAKE_PART.test(t)) return routed("edit", "changes a named schematic part");
  if (GENERATE_VERB.test(t)) return routed("generate", "asks to create a circuit");
  if (EDIT_VERB.test(t)) return routed("edit", "an edit to the current schematic");
  return routed("ask", "a question or request for the assistant");
}
