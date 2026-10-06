/**
 * [B23-B3] The provider text screen (runbook B23-B step 6, :980; OD-185). Every string a provider's answer leaves in an observation
 * is UNTRUSTED third-party text. It is shown only when it passes, in this order:
 *  1. the length: at most 256 characters, the exchange record's own bound (`EXCHANGE_LEDGER_BOUNDS.maxNormalizedText`);
 *  2. the characters: printable ASCII and a closed typographic set (B20-C3's `DESCRIPTOR_TEXT_ALLOWED_EXTRA`) - no control character
 *     and no lone UTF-16 surrogate (B2 refuses both in what its record keeps and drops them at the egress; this keeps that), and no
 *     format, bidirectional, other-script or astral character, so no look-alike or invisible spelling is ever shown;
 *  3. no secret shape (the repository's redaction authority, `app/lib/agent/redaction.ts`);
 *  4. B20's directive matcher: alone, and - for the strings one observation shows together - read across their joins.
 * A string that fails is withheld WHOLE, by its field name and the rule it broke, never stripped so the rest can be kept (B20's
 * rule). The screen is defence in depth over display text, as OD-81 says of B20's: it cannot recognise every paraphrase.
 *
 * The matcher below is a VERBATIM copy of A2's (`app/lib/mcp/foreign-tools.ts`), renamed only where a name says MCP: importing
 * that module would put the MCP transport, and with it the egress boundary, into the closure of GET /api/pcb-sync, the route that
 * shows observations, which sends nothing (B20-C3's first-party gate, `descriptor-text.ts`, states the same reason). Pinned by
 * `b23-b-observation` case 4: every copied declaration equals A2's (comments aside, under the reviewed renames) and the two judge a
 * corpus alike, so a change to A2's matcher fails until it is copied here.
 */
import { containsSecretShapedText } from "../agent/redaction";

// -- [B23-B3] A2's directive matcher, copied verbatim from app/lib/mcp/foreign-tools.ts (b23-b-observation case 4 pins it) --

export const PROVIDER_DIRECTIVE_SCAN_CHARS = 8_192;
export const PROVIDER_SKELETON_MAX_EXPANSION = 4;
export const PROVIDER_SKELETON_MAX_CHARS = 32_768;
const NON_PRINTING_MIN = 3;
const NON_PRINTING_SHARE_DIVISOR = 50; // more than 2 %
const NON_PRINTING = /[\p{Cc}\p{Cf}]/gu;
const BIDI_CONTROL = new RegExp(`[${String.fromCharCode(8206)}${String.fromCharCode(8207)}${String.fromCharCode(8234)}-${String.fromCharCode(8238)}${String.fromCharCode(8294)}-${String.fromCharCode(8297)}]`, "u");
const SKELETON_CHUNK_CHARS = 4_096;
const NON_ASCII = /\P{ASCII}/u;
const NFKD_MAX_EXPANSION = 18;
const MARKS = /\p{M}/gu;
const FORMAT = /\p{Cf}/gu;
const LINE_BREAK = "\n";
const DIRECTIVE_MARKERS = new RegExp([
  String.raw`(?:^|[\n\r>\]])[^\S\n\r]*(?:system|assistant|developer)\s*:`,
  String.raw`<\|im_(?:start|end)\|>`,
  String.raw`\[\s*(?:\/\s*)?(?:system|inst)\s*\]`,
  String.raw`(?<!#)#{2,}\s*(?:system|instruction)`,
  String.raw`<\/?(?:system|instructions|tool_call|tool_use|function_call|function_calls|invoke|antml)`,
  "[`]{3}\\s*(?:tool|function|json_tool)",
  String.raw`"function_call"\s*:`,
  String.raw`\.env\b`,
  // the scan starts only at the FIRST letter of a scheme run (the lookbehind, as `redaction.ts` does), and ':' is not in the
  // user class, so the first ':' after "//" is the one the class stops at
  String.raw`[a-z](?<=(?<![a-z0-9+.-])[0-9+.-]*[a-z])[a-z0-9+.-]*:\/\/[^\s/@:]*:[^\s/@]*@`,
].join("|"), "u");
export const PROVIDER_DIRECTIVE_PHRASES: readonly string[] = Object.freeze([
  "ignore|disregard|bypass|forget {all|any|the|your} previous~|preceding~|earlier~|system~|these~|instructions~",
  "=ignore|disregard|bypass|forget {all|any|the|your} above~|prior",
  "ignore|disregard|bypass|forget {all|any|the|your} above|prior {all|any|the|your|system} instructions~|instruction~|rules~|rule~|prompts~|prompt~|directives~|directive~|guidelines~|guideline~",
  "forget everything~|all",
  "new|updated|revised|additional {system} instructions~",
  "override {the} system~|previous~|safety~|policy~",
  "system prompt~",
  "you must~",
  "always call^|invoke^|run^|use^",
  "do+not|don+t|dont|never tell~|mention~|reveal~|inform~|disclose~|show~|log~",
  "without telling~|informing~|asking~|notifying~",
  "*exfiltrat",
  "*jailbreak",
  "api key",
  "apikey",
  "access token",
  "accesstoken",
  "secret|private key",
  "password",
  "credential|credentials",
  "authorization header~",
  // [B20 A2 round 6] within one judged string only ('!')
  "!send|post|upload|email|forward it~|them~|this~|these~|the~",
]);
function compileDirectivePhrases(phrases: readonly string[]): { words: RegExp; stems: RegExp; aligned: RegExp } {
  const words: string[] = [];
  const stems: string[] = [];
  const aligned: string[] = [];
  /** [B20 A2 round 6] a separator a phrase reads across: a space, or the line break that joins two strings of a joined text */
  const JOIN = "[ \\n]";
  for (const entry of phrases) {
    // [B20 A2 round 6] a '!' phrase reads only a space: within one judged string, never across a join
    const alone = entry.startsWith("!");
    const body = alone ? entry.slice(1) : entry;
    const gap = alone ? " " : JOIN;
    const spaced = (letters: string): string => letters.split("").join(`${gap}?`);
    if (body.startsWith("*")) {
      stems.push(body.slice(1));
      aligned.push(`${spaced(body.slice(1))}[a-z]*`);
      continue;
    }
    const separated = body.startsWith("=");
    const slots = (separated ? body.slice(1) : body).split(" ").map((slot) => ({ filler: slot.startsWith("{"), alternatives: slot.replace(/[{}]/g, "").split("|") }));
    const last = slots.length - 1;
    words.push(slots.map((slot, index) => {
      if (slot.filler) return `(?:(?:${slot.alternatives.join("|")})${gap})*`;
      // [B20 A2 follow-up] a '^' word is read as words like any other: after a separator it must end its word
      const alternatives = slot.alternatives.map((alternative) => alternative.replace(/\+/g, gap).replace(/\^$/, "").replace(/~$/, "[a-z]*"));
      return `(?:${alternatives.join("|")})${index < last ? gap : ""}`;
    }).join(""));
    if (separated) continue;
    aligned.push(slots.map((slot, index) => {
      const letters = slot.alternatives.map((alternative) => alternative.replace(/[~^]$/, "").replace(/\+/g, ""));
      if (slot.filler) return `(?:${gap}?(?:${letters.map(spaced).join("|")}))*`;
      const lead = index === 0 ? "" : `${gap}?`;
      if (index !== last) return `${lead}(?:${letters.map(spaced).join("|")})`;
      // a '~' word of the LAST slot: spaced and ending the word, or running on in the word it ends in — [B20 A2 round 6] with its
      // letters contiguous after at most its FIRST letter, and all of them contiguous when it has three letters or fewer (the
      // follow-up split it anywhere before its last two letters; review-4 required all of them contiguous)
      const forms = slot.alternatives.map((alternative, at) => {
        const word = letters[at]!;
        if (!alternative.endsWith("~")) return spaced(word);
        const runOn = word.length <= 3 ? word : `${word.charAt(0)}${gap}?${word.slice(1)}`;
        return `${runOn}[a-z]*|${spaced(word)}`;
      });
      // [B20 A2 follow-up] a '^' word of the LAST slot, glued to the word before it: no space before it, running on in its word
      const glued = index === 0 ? [] : slot.alternatives.flatMap((alternative, at) => (alternative.endsWith("^") ? [`${letters[at]}[a-z]*`] : []));
      return glued.length === 0 ? `${lead}(?:${forms.join("|")})` : `(?:${lead}(?:${forms.join("|")})|${glued.join("|")})`;
    }).join(""));
  }
  // [B20 A2 round 6] every phrase starts after a separator and ends before one: a space or a join
  const atWords = (alternation: string): RegExp => new RegExp(`${JOIN}(?:${alternation})(?=${JOIN})`);
  return { words: atWords(words.join("|")), stems: new RegExp(stems.join("|")), aligned: atWords(aligned.join("|")) };
}
const DIRECTIVE_VOCABULARY = compileDirectivePhrases(PROVIDER_DIRECTIVE_PHRASES);
const LATIN_LOOKALIKES: ReadonlyMap<number, number> = new Map(([
  [0x430, "a"], [0x435, "e"], [0x43a, "k"], [0x43e, "o"], [0x440, "p"], [0x441, "c"], [0x443, "y"], [0x445, "x"], [0x455, "s"], [0x456, "i"],
  [0x458, "j"], [0x4bb, "h"], [0x4cf, "l"], [0x501, "d"], [0x51b, "q"], [0x51d, "w"],
  [0x405, "S"], [0x406, "I"], [0x408, "J"], [0x410, "A"], [0x412, "B"], [0x415, "E"], [0x41a, "K"], [0x41c, "M"], [0x41d, "H"], [0x41e, "O"],
  [0x420, "P"], [0x421, "C"], [0x422, "T"], [0x425, "X"], [0x4ae, "Y"], [0x4c0, "I"], [0x51a, "Q"], [0x51c, "W"],
  [0x3b1, "a"], [0x3b9, "i"], [0x3ba, "k"], [0x3bd, "v"], [0x3bf, "o"], [0x3c1, "p"], [0x3c5, "u"],
  [0x391, "A"], [0x392, "B"], [0x395, "E"], [0x396, "Z"], [0x397, "H"], [0x399, "I"], [0x39a, "K"], [0x39c, "M"], [0x39d, "N"], [0x39f, "O"],
  [0x3a1, "P"], [0x3a4, "T"], [0x3a5, "Y"], [0x3a7, "X"],
  [0x131, "i"], [0x237, "j"], [0x251, "a"], [0x261, "g"],
  // [B20 A2 review-4] the Latin small capitals of A to Z (there is none of X)
  [0x1d00, "a"], [0x299, "b"], [0x1d04, "c"], [0x1d05, "d"], [0x1d07, "e"], [0xa730, "f"], [0x262, "g"], [0x29c, "h"], [0x26a, "i"], [0x1d0a, "j"],
  [0x1d0b, "k"], [0x29f, "l"], [0x1d0d, "m"], [0x274, "n"], [0x1d0f, "o"], [0x1d18, "p"], [0xa7af, "q"], [0x280, "r"], [0xa731, "s"], [0x1d1b, "t"],
  [0x1d1c, "u"], [0x1d20, "v"], [0x1d21, "w"], [0x28f, "y"], [0x1d22, "z"],
  // [B20 A2 review-4] the negative circled and negative squared capitals A to Z
  ...Array.from({ length: 26 }, (_unused, index): readonly [number, string] => [0x1f150 + index, String.fromCharCode(65 + index)]),
  ...Array.from({ length: 26 }, (_unused, index): readonly [number, string] => [0x1f170 + index, String.fromCharCode(65 + index)]),
] as ReadonlyArray<readonly [number, string]>).map(([code, letter]): [number, number] => [code, letter.charCodeAt(0)]));
function wordStreams(skeleton: string, joined: boolean): { words: string; acronym: string; caseless: string } {
  const words: string[] = [" "];
  const acronym: string[] = [" "];
  const caseless: string[] = [" "];
  let previous: "other" | "lower" | "upper" = "other";
  let capitals = 0;
  for (let index = 0; index < skeleton.length; index += 1) {
    let code = skeleton.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < skeleton.length) {
      const low = skeleton.charCodeAt(index + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = (code - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000;
        index += 1;
      }
    }
    if (code >= 0x80) code = LATIN_LOOKALIKES.get(code) ?? code;
    const kind = code >= 97 && code <= 122 ? "lower" : code >= 65 && code <= 90 ? "upper" : "other";
    if (kind === "other") {
      const separator = joined && code === 10 ? LINE_BREAK : " ";
      separate(words, separator);
      separate(acronym, separator);
      separate(caseless, separator);
      previous = "other";
      capitals = 0;
      continue;
    }
    if (kind === "lower" && previous === "upper" && capitals >= 2) {
      words.push(" ");
      const last = acronym.pop()!;
      acronym.push(" ", last);
    }
    if (kind === "upper" && previous === "lower") {
      words.push(" ");
      acronym.push(" ");
    }
    capitals = kind === "upper" ? capitals + 1 : 0;
    const letter = String.fromCharCode(kind === "upper" ? code + 32 : code);
    words.push(letter);
    acronym.push(letter);
    caseless.push(letter);
    previous = kind;
  }
  separate(words, " ");
  separate(acronym, " ");
  separate(caseless, " ");
  return { words: words.join(""), acronym: acronym.join(""), caseless: caseless.join("") };
}

/** [B20 A2 round 6] End a stream's word: ONE separator for a run of non-letters, a line break (a join) winning over a space. */
function separate(stream: string[], separator: string): void {
  const last = stream[stream.length - 1];
  if (last !== " " && last !== LINE_BREAK) stream.push(separator);
  else if (separator === LINE_BREAK) stream[stream.length - 1] = LINE_BREAK;
}
interface ReadText {
  read: string;
  skeleton: string;
}
function boundedSkeleton(text: string, limit: number): { skeleton: string | null; produced: number } {
  if (!NON_ASCII.test(text)) return text.length > limit ? { skeleton: null, produced: 0 } : { skeleton: text, produced: text.length };
  const pieces: string[] = [];
  let length = 0;
  for (let start = 0; start < text.length;) {
    const step = Math.max(1, Math.min(SKELETON_CHUNK_CHARS, Math.floor((limit - length) / NFKD_MAX_EXPANSION)));
    let end = Math.min(text.length, start + step);
    const last = text.charCodeAt(end - 1);
    // a step never ends inside a surrogate pair: one of a single unit takes the whole pair
    if (end < text.length && last >= 0xd800 && last <= 0xdbff) end = end - start > 1 ? end - 1 : end + 1;
    const piece = matcherSkeletonOf(text.slice(start, end));
    length += piece.length;
    if (length > limit) return { skeleton: null, produced: length };
    pieces.push(piece);
    start = end;
  }
  return { skeleton: pieces.join(""), produced: length };
}
function matcherSkeletonOf(text: string): string {
  return text.replace(MARKS, "").normalize("NFKD").replace(MARKS, "");
}
const readOf = (text: string): string => (text.length > PROVIDER_DIRECTIVE_SCAN_CHARS ? text.slice(0, PROVIDER_DIRECTIVE_SCAN_CHARS) : text);
const skeletonCap = (read: string): number => Math.min(read.length * PROVIDER_SKELETON_MAX_EXPANSION, PROVIDER_SKELETON_MAX_CHARS);
function directiveIn(text: ReadText): boolean {
  return readsDirective(text, false);
}
function joinedDirectiveIn(text: ReadText): boolean {
  return readsDirective(text, true);
}
function readsDirective({ read, skeleton }: ReadText, joined: boolean): boolean {
  if (BIDI_CONTROL.test(read)) return true;
  const nonPrinting = (read.match(NON_PRINTING) ?? []).length;
  if (nonPrinting > NON_PRINTING_MIN && nonPrinting * NON_PRINTING_SHARE_DIVISOR > read.length) return true;
  const deleted = NON_ASCII.test(skeleton) ? skeleton.replace(FORMAT, "") : skeleton;
  if (DIRECTIVE_MARKERS.test(deleted.toLowerCase())) return true;
  return phrasesIn(skeleton, joined) || (deleted !== skeleton && phrasesIn(deleted, joined));
}
function phrasesIn(skeleton: string, joined: boolean): boolean {
  const streams = wordStreams(skeleton, joined);
  return DIRECTIVE_VOCABULARY.aligned.test(streams.words)
    || (streams.acronym !== streams.words && DIRECTIVE_VOCABULARY.aligned.test(streams.acronym))
    || DIRECTIVE_VOCABULARY.words.test(streams.caseless)
    || DIRECTIVE_VOCABULARY.stems.test(streams.caseless);
}
export function providerTextReadsAsDirective(text: unknown): "directive" | "clean" | "expanded" {
  try {
    if (typeof text !== "string" || text === "") return "clean";
    const read = readOf(text);
    const { skeleton } = boundedSkeleton(read, skeletonCap(read));
    if (skeleton === null) return "expanded";
    return directiveIn({ read, skeleton }) ? "directive" : "clean";
  } catch {
    return "directive";
  }
}
export const PROVIDER_JOINED_READ_LINES = 64;
export function providerJoinedTextReadsAsDirective(texts: unknown): "directive" | "clean" | "expanded" {
  try {
    if (!Array.isArray(texts)) return "clean";
    const reads: string[] = [];
    const skeletons: string[] = [];
    let room = PROVIDER_DIRECTIVE_SCAN_CHARS;
    let cap = PROVIDER_SKELETON_MAX_CHARS;
    for (let index = 0; index < Math.min(texts.length, PROVIDER_JOINED_READ_LINES) && room > 0; index += 1) {
      const text: unknown = texts[index];
      if (typeof text !== "string" || text === "") continue;
      const read = text.length > room ? text.slice(0, room) : text;
      const built = boundedSkeleton(read, Math.min(skeletonCap(read), cap));
      if (built.skeleton === null) return "expanded";
      room -= read.length;
      cap -= built.skeleton.length;
      reads.push(read);
      skeletons.push(built.skeleton);
    }
    if (reads.length < 2) return "clean";
    return joinedDirectiveIn({ read: reads.join(" "), skeleton: skeletons.join(LINE_BREAK) }) ? "directive" : "clean";
  } catch {
    return "directive";
  }
}

// -- [B23-B3] the screen --

/** The longest provider string the screen reads (the exchange record's bound on a kept field). */
export const PROVIDER_TEXT_MAX_CHARS = 256;
/** Beside printable ASCII (U+0020 to U+007E), the closed typographic set B20-C3 allows first-party text: dashes, curly quotes, the ellipsis, degree, plus-minus, micro, multiplication, the arrow, minus, not-equal and the two inequalities. */
export const PROVIDER_TEXT_ALLOWED_EXTRA: readonly number[] = Object.freeze([
  0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2026, 0x00b0, 0x00b1, 0x00b5, 0x00d7, 0x2192, 0x2212, 0x2260, 0x2264, 0x2265,
]);
const ALLOWED_EXTRA: ReadonlySet<number> = new Set(PROVIDER_TEXT_ALLOWED_EXTRA);
/** Why a provider string is withheld (closed), in the screen's order. */
export const PROVIDER_TEXT_SCREEN_REASONS = Object.freeze(["length", "characters", "secret_shape", "directive", "expanded"] as const);
export type ProviderTextScreenReason = (typeof PROVIDER_TEXT_SCREEN_REASONS)[number];

/** Every UTF-16 unit is printable ASCII or one of the closed set (a lone surrogate and every control character are neither). */
function charactersAllowed(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0x20 && code <= 0x7e) continue;
    if (!ALLOWED_EXTRA.has(code)) return false;
  }
  return true;
}

/** One provider string: null when it may be shown, otherwise the rule it broke. Never throws; anything not a string is `characters`. */
export function screenProviderText(value: unknown): ProviderTextScreenReason | null {
  if (typeof value !== "string") return "characters";
  if (value.length > PROVIDER_TEXT_MAX_CHARS) return "length";
  if (!charactersAllowed(value)) return "characters";
  if (value === "") return null;
  if (containsSecretShapedText(value)) return "secret_shape";
  const read = providerTextReadsAsDirective(value);
  return read === "clean" ? null : read;
}

/** The strings one observation shows together, read across their joins (B20-A4's joined reading): `clean`, `directive` or `expanded`. */
export function screenProviderTextsTogether(values: readonly string[]): "clean" | "directive" | "expanded" {
  return providerJoinedTextReadsAsDirective(values);
}
