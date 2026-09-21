/**
 * [B20 A2] The foreign-descriptor gates: what a server's tool definitions may become inside Sirkit (discovery D20-15
 * foreign half, D20-13 namespace isolation; reference notes section 6; OD-52, OD-58).
 *
 * A foreign definition is UNTRUSTED DATA. Nothing here trusts a name, a title, a description, an annotation or a schema:
 * each is gated, and a definition that fails any gate is EXCLUDED with a closed reason code — never repaired, never
 * truncated into shape, never partly kept. One malformed tool never prevents the others.
 *  - identity: the server's `name` must match the specification's alphabet and is otherwise never echoed; the Sirkit-side
 *    identity is namespaced and reversible (`mcp.<serverId>.<name>`, provider-facing `mcp_<serverId>__<name>` through the
 *    existing `agentProviderName` mapping), so a foreign tool can never take or shadow a `sirkit.` id — and a name that
 *    spells one is refused outright. A name that does not fit the provider alphabet and 64 characters, or that collides
 *    after the mapping, is excluded rather than truncated or renamed.
 *  - text: `title` and `description` are display-only (inert, bounded, the sent token and secret shapes redacted). One
 *    that carries a DIRECTIVE — an instruction aimed at a model, a role or tool-call marker, exfiltration phrasing, a URL
 *    with credentials, or more than a bounded share of non-printing and bidirectional characters — excludes the tool.
 *    Fail closed: the directive is never stripped so the rest can be kept.
 *  - annotations: parsed into a closed record of four optional booleans and used to GRANT NOTHING. Sirkit classifies
 *    every foreign tool as an external read observation whatever the server claims; `readOnlyHint: false` or
 *    `destructiveHint: true` excludes the tool (B20-A is read-only), and `readOnlyHint: true` earns nothing.
 *  - schemas: accepted only within the proven provider wire subset (`validateSchemaStructure`, `validateWireSubset` of
 *    `app/lib/agent/provider-tools.ts` — unchanged, reused), plus explicit refusal of `$ref` / `$defs` / `$id` /
 *    `$anchor` / `$dynamicRef`, of a non-2020-12 dialect, and of the size, depth, subschema and property bounds (OD-58:
 *    no JSON Schema library). `x-mcp-header` is the ONE extension keyword allowed, validated as section 3 of the
 *    specification defines it (narrowed to string / integer / boolean: a stated limit). An invalid OUTPUT schema drops
 *    the output schema and keeps the tool; an invalid INPUT schema excludes it. `icons`, `_meta` and every unknown field
 *    are dropped. [B20 A2 review] A schema's own text is server text too: property names match a closed pattern, enum
 *    and const strings are inert and bounded, every description and title is scanned for a directive and then scrubbed,
 *    and every one of them is compared case-folded with the sent token — a directive or an echo in either schema
 *    excludes the tool. An INPUT schema is accepted only within what the call-time validator evaluates.
 *    [B20 A2 review-2] Every string kept VERBATIM (the tool name, a property name, an enum or const string, an
 *    `x-mcp-header` token) is scanned raw and with `_`, `.`, `-` and camelCase boundaries read as spaces; the display text
 *    is compared with the token before the display bound cuts it; and one listing's scrub work has ONE budget.
 *    [B20 A2 review-3] ONE directive matcher reads every judged string — the name, the title and description, every schema
 *    description, title, enum and const value, property name and `x-mcp-header` token — as WORDS (any run of non-letters is
 *    one space, any case boundary another) and SQUASHED (no spaces), against ONE phrase list (`MCP_DIRECTIVE_PHRASES`), so no
 *    separator, case run or its absence carries a directive through; each judged string is read ONCE, its skeleton bounded
 *    to 4 x its length (`text_expansion`) and charged to the listing's budget BEFORE it is scanned; and the size bound
 *    counts UTF-8 bytes.
 * Every bound is judged BEFORE the work it bounds (S5), every accepted descriptor is a NEW frozen object built field by
 * field (never the server's object, and no key from server data is ever created on it: S6), and `acceptForeignTools`
 * never throws (S4).
 */
import { agentProviderName } from "../agent/provider-tools";
import { validateSchemaStructure, validateWireSubset } from "../agent/provider-tools";
import { MCP_PARAM_HEADER_MAX, scrubWindow, skeletonCarries, skeletonOf } from "./http-transport";
import { displayText } from "./negotiation";
import { MCP_SERVER_ID_PATTERN, MCP_TOOL_NAME_PATTERN, type McpServerRegistryEntry } from "./server-registry";

/** How many definitions of one server are read at all; the rest are counted (reference notes section 6: paging). */
export const MCP_TOOLS_PER_SERVER_MAX = 500;
export const MCP_TOOL_TITLE_MAX_CHARS = 120;
export const MCP_TOOL_DESCRIPTION_MAX_CHARS = 1_000;
/** The schema bounds (S5): each judged before the walk, the validators or the copy it protects. */
export const MCP_SCHEMA_MAX_BYTES = 32_768;
export const MCP_SCHEMA_MAX_DEPTH = 8;
export const MCP_SCHEMA_MAX_SUBSCHEMAS = 256;
export const MCP_SCHEMA_MAX_PROPERTIES = 64;
/**
 * [B20 A2 review] The retained strings of one schema — property names, description and title values, enum and const
 * strings — COUNTED during the walk and judged before any of them is scanned (S5), and the closed shapes of the two kinds
 * that are kept verbatim: a property name is a bounded identifier, an enum or const string a bounded inert value.
 */
export const MCP_SCHEMA_MAX_STRINGS = 1_024;
export const MCP_SCHEMA_PROPERTY_NAME_MAX_CHARS = 64;
export const MCP_SCHEMA_VALUE_MAX_CHARS = 256;
/** How much of a title or description the directive scan reads: more than the scrub's own window, so nothing kept is unread. */
export const MCP_DIRECTIVE_SCAN_CHARS = 8_192;
/**
 * [B20 A2 review-2] The ONE scrub budget of an `acceptForeignTools` call (one listing): how many texts the display scrub reads
 * and how many characters, each text charged up to its scrub window BEFORE any of the tool's text is scanned or scrubbed (S5).
 * The scrub runs NFC twice, quadratic in ICU on a run of ill-ordered combining marks, and it was bounded per SCHEMA only: 500
 * tools could make it read about 7 000 full windows (65.9 s, measured). The characters are the transport's per-call scrub
 * budget (`MCP_SCRUB_MAX_CHARS_PER_CALL`): one listing scrubs no more than one `mcpPost` may: 0.6 s at that worst case, measured.
 * The strings bound the fixed cost of one scrub call (about 2.6 microseconds, measured, even for one character): 500 tools
 * x 32 texts, rounded to a power of two. The safer reading charges the tool's own title and description too: they are the
 * same work, and 500 of them alone took 5.0 s at the worst case.
 */
export const MCP_LISTING_SCRUB_MAX_STRINGS = 16_384;
export const MCP_LISTING_SCRUB_MAX_CHARS = 262_144;
/**
 * [B20 A2 review-3] The SCAN half of the same budget: the characters the directive matcher reads in one listing, each judged
 * string charged by its skeleton length (never less than the characters read of it) BEFORE it is scanned. The scans ran
 * outside the budget: 500 tools of U+FDFA enum values took 28.1 s (measured). 2 097 152 = 8 x the scrubbed characters; the
 * matcher reads about 60 ns a character (measured), so a listing's scan stays near 0.2 s.
 */
export const MCP_LISTING_SCAN_MAX_CHARS = 2_097_152;
/**
 * [B20 A2 review-3] NFKD expands one code point up to 18 x (U+FDFA). The skeleton of a judged string may be at most 4 x the
 * characters read of it (a Hangul syllable is 3, a squared unit sign 3) and never more than 4 x the scan window: past
 * either the tool is `text_expansion`, and the skeleton is computed in chunks that stop there, never expanded whole.
 */
export const MCP_SKELETON_MAX_EXPANSION = 4;
export const MCP_SKELETON_MAX_CHARS = 32_768;
/** The Sirkit-side namespaces of a foreign tool (OD-52). */
export const MCP_FOREIGN_TOOL_ID_PREFIX = "mcp.";
export const MCP_FOREIGN_PROVIDER_PREFIX = "mcp_";
/** The 2020-12 dialect, the only one a foreign schema may name (`$schema`, at the root only). */
const JSON_SCHEMA_2020_12: ReadonlySet<string> = new Set(["https://json-schema.org/draft/2020-12/schema", "https://json-schema.org/draft/2020-12/schema#"]);
const REF_KEYWORDS: ReadonlySet<string> = new Set(["$ref", "$defs", "$id", "$anchor", "$dynamicRef", "$dynamicAnchor", "$recursiveRef", "$recursiveAnchor", "$vocabulary", "definitions"]);
const PROTOTYPE_KEYS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);
/** [B20 A2 review] a property name: the tool-name alphabet, bounded (the length is judged first) */
const PROPERTY_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;
/** [B20 A2 review] what an enum or const string kept verbatim may not carry: the characters the inert scrub would rewrite */
const NOT_INERT = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;
/** [B20 A2 review] the types `validateAgainstSchema` switches on: one string each (a type array, "null", anyOf and const it cannot evaluate) */
const CALLABLE_TYPES: ReadonlySet<string> = new Set(["object", "array", "string", "number", "integer", "boolean"]);
const X_MCP_HEADER = "x-mcp-header";
/** the nodes one foreign schema may copy: its serialised size is already bounded to 32 768 bytes */
const SCHEMA_COPY_NODES = 50_000;
/** RFC 7230 tchar, bounded to what `Mcp-Param-{Name}` may carry. */
const TCHAR_TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,64}$/;
const HEADER_PARAM_TYPES: ReadonlySet<string> = new Set(["string", "integer", "boolean"]);
/** A name Sirkit's own registry owns: a foreign tool never spells one, at any case. */
const RESERVED_NAME_PREFIXES: readonly string[] = ["sirkit.", "mcp."];
/** the share of non-printing characters a text may carry before it is read as an obfuscated directive */
const NON_PRINTING_MIN = 3;
const NON_PRINTING_SHARE_DIVISOR = 50; // more than 2 %
const NON_PRINTING = /[\p{Cc}\p{Cf}]/gu;
/** LRM, RLM, the four embedding/override controls and the four isolates — built by code point so the source stays ASCII. */
const BIDI_CONTROL = new RegExp(`[${String.fromCharCode(8206)}${String.fromCharCode(8207)}${String.fromCharCode(8234)}-${String.fromCharCode(8238)}${String.fromCharCode(8294)}-${String.fromCharCode(8297)}]`, "u");
/** [B20 A2 review-3] what a skeleton is computed in (the transport's own chunk), and what has none but itself */
const SKELETON_CHUNK_CHARS = 4_096;
const NON_ASCII = /\P{ASCII}/u;

/**
 * The raw directive MARKERS — role and system-prompt markers, tool-call markup, a `.env` path and a URL with credentials — as
 * ONE alternation of literals over the bounded, skeleton-folded, lowercased copy of a text. [B20 A2 review-3] The phrases
 * aimed at a model left this alternation for `MCP_DIRECTIVE_PHRASES`: every marker here is kept as it was.
 * [B20 A2 review] Linear in the scanned text: no two adjacent quantifiers can split one run between them, and a
 * quantified run is entered only at its FIRST character. The comment used to claim this while four alternatives broke it:
 * the URL-credential marker started at every letter of a scheme run and split a colon run between two classes (cubic —
 * the class A1 review-2 closed in `redaction.ts`), `#{2,}` started at every '#' of a run, `\[\s*\/?\s*` split a run of
 * spaces between two `\s*`, and a line start's `\s*` ran over the newlines that are line starts themselves. Each rewrite
 * matches exactly the texts the old alternative matched (pinned).
 */
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

/**
 * [B20 A2 review-3] THE directive vocabulary: the phrases that read as an instruction aimed at a model, as WORDS. It is the
 * single source of truth of both readings below, derived from the round-2 alternation — every phrase that held is here —
 * with four additions: `forget` among the override verbs, `your` among their fillers, `instructions` among their objects,
 * and `dont`. A phrase is slots separated by one space; a slot is its alternatives separated by '|'; '+' joins the words
 * of one alternative (`do+not`); a slot in braces is zero or more filler words; a trailing '~' lets that LAST word run on,
 * as the round-2 alternation did (`log~`: logs, logged); a phrase opening with '*' is a stem, found anywhere.
 */
export const MCP_DIRECTIVE_PHRASES: readonly string[] = Object.freeze([
  "ignore|disregard|bypass|forget {all|any|the|your} previous~|prior~|preceding~|above~|earlier~|system~|these~|instructions~",
  "forget everything~|all",
  "new|updated|revised|additional {system} instructions~",
  "override {the} system~|previous~|safety~|policy~",
  "system prompt~",
  "you must",
  "always call|invoke|run|use",
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
  "send|post|upload|email|forward it~|them~|this~|these~|the~",
]);

/**
 * [B20 A2 review-3] The phrase list compiled ONCE into the two readings of the one matcher. WORDS: each phrase as whole words
 * at a word start, over a stream of lower-case letters and single spaces (a '~' word runs on to its word's end). SQUASHED:
 * every phrase of three or more words or twelve or more letters, and every stem, as a plain substring of the stream without
 * its spaces — what finds a directive spelled with no separator at all or across a case run no split reads; a shorter
 * phrase is read as words only, so a benign identifier that merely contains it (`musty`, `systemic`) is not refused. Both
 * are alternations of literals entered at a word start or a letter, linear in the stream (measured: about 60 ns a character).
 */
function compileDirectivePhrases(phrases: readonly string[]): { words: RegExp; squashed: RegExp } {
  const words: string[] = [];
  const squashed: string[] = [];
  const letters = (alternative: string): string => alternative.replace(/~$/, "").replace(/\+/g, "");
  for (const phrase of phrases) {
    if (phrase.startsWith("*")) {
      squashed.push(phrase.slice(1));
      continue;
    }
    const slots = phrase.split(" ").map((slot) => ({ filler: slot.startsWith("{"), alternatives: slot.replace(/[{}]/g, "").split("|") }));
    words.push(slots.map((slot, index) => {
      if (slot.filler) return `(?:(?:${slot.alternatives.join("|")}) )*`;
      const alternatives = slot.alternatives.map((alternative) => alternative.replace(/\+/g, " ").replace(/~$/, "[a-z]*"));
      return `(?:${alternatives.join("|")})${index < slots.length - 1 ? " " : ""}`;
    }).join(""));
    let expansions: string[][] = [[]];
    for (const slot of slots.filter((entry) => !entry.filler)) {
      expansions = expansions.flatMap((prefix) => slot.alternatives.map((alternative) => [...prefix, ...alternative.replace(/~$/, "").split("+")]));
    }
    for (const expansion of expansions) if (expansion.length >= 3 || expansion.join("").length >= 12) squashed.push(expansion.join(""));
    // with a filler word a phrase has three words at least: squashed with one or more fillers
    if (slots.some((slot) => slot.filler)) squashed.push(slots.map((slot) => `(?:${slot.alternatives.map(letters).join("|")})${slot.filler ? "+" : ""}`).join(""));
  }
  return { words: new RegExp(` (?:${words.join("|")})(?= )`), squashed: new RegExp(squashed.join("|")) };
}
const DIRECTIVE_VOCABULARY = compileDirectivePhrases(MCP_DIRECTIVE_PHRASES);

/**
 * [B20 A2 review-3] Letters NFKD leaves alone that ARE a basic Latin letter in form — Cyrillic and Greek ones, and four Latin
 * ones — folded to it (case kept) before the word streams are built: `іgnore` (U+0456) reads as `ignore`. A partial fold
 * (not the UTS #39 confusables table): a stated limit.
 */
const LATIN_LOOKALIKES: ReadonlyMap<number, number> = new Map(([
  [0x430, "a"], [0x435, "e"], [0x43a, "k"], [0x43e, "o"], [0x440, "p"], [0x441, "c"], [0x443, "y"], [0x445, "x"], [0x455, "s"], [0x456, "i"],
  [0x458, "j"], [0x4bb, "h"], [0x4cf, "l"], [0x501, "d"], [0x51b, "q"], [0x51d, "w"],
  [0x405, "S"], [0x406, "I"], [0x408, "J"], [0x410, "A"], [0x412, "B"], [0x415, "E"], [0x41a, "K"], [0x41c, "M"], [0x41d, "H"], [0x41e, "O"],
  [0x420, "P"], [0x421, "C"], [0x422, "T"], [0x425, "X"], [0x4ae, "Y"], [0x4c0, "I"], [0x51a, "Q"], [0x51c, "W"],
  [0x3b1, "a"], [0x3b9, "i"], [0x3ba, "k"], [0x3bd, "v"], [0x3bf, "o"], [0x3c1, "p"], [0x3c5, "u"],
  [0x391, "A"], [0x392, "B"], [0x395, "E"], [0x396, "Z"], [0x397, "H"], [0x399, "I"], [0x39a, "K"], [0x39c, "M"], [0x39d, "N"], [0x39f, "O"],
  [0x3a1, "P"], [0x3a4, "T"], [0x3a5, "Y"], [0x3a7, "X"],
  [0x131, "i"], [0x237, "j"], [0x251, "a"], [0x261, "g"],
] as const).map(([code, letter]): [number, number] => [code, letter.charCodeAt(0)]));

/**
 * [B20 A2 review-3] The WORD stream of a skeleton — every maximal run of characters that is not a letter (a digit, a space,
 * any punctuation or symbol, any other script) is ONE space, and every case boundary is a space: lower to upper (`fooBar`),
 * and a run of capitals into lower case KEPT WHOLE (`IGNOREprevious`, `ignorePREVIOUSinstructions`) — lower-cased, between
 * single spaces. The safer reading adds the ACRONYM stream, where such a run gives its last capital to the next word
 * (`APIKey` reads `api key`, as round 2 read it), and the SQUASHED stream: the letters without any space. One pass.
 */
function wordStreams(skeleton: string): { words: string; acronym: string; squashed: string } {
  const words: string[] = [" "];
  const acronym: string[] = [" "];
  const squashed: string[] = [];
  let previous: "other" | "lower" | "upper" = "other";
  let capitals = 0;
  for (let index = 0; index < skeleton.length; index += 1) {
    let code = skeleton.charCodeAt(index);
    if (code >= 0x80) code = LATIN_LOOKALIKES.get(code) ?? code;
    const kind = code >= 97 && code <= 122 ? "lower" : code >= 65 && code <= 90 ? "upper" : "other";
    if (kind === "other") {
      if (words[words.length - 1] !== " ") words.push(" ");
      if (acronym[acronym.length - 1] !== " ") acronym.push(" ");
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
    squashed.push(letter);
    previous = kind;
  }
  if (words[words.length - 1] !== " ") words.push(" ");
  if (acronym[acronym.length - 1] !== " ") acronym.push(" ");
  return { words: words.join(""), acronym: acronym.join(""), squashed: squashed.join("") };
}

export type McpToolExclusionReason =
  | "not_an_object"
  | "name_invalid"
  | "reserved_namespace"
  | "duplicate_name"
  | "name_unrepresentable"
  | "name_collision"
  | "description_directive"
  | "declared_write"
  | "input_schema_missing"
  | "input_schema_too_large"
  | "input_schema_too_deep"
  | "input_schema_too_many_subschemas"
  | "input_schema_too_many_properties"
  | "input_schema_ref_keyword"
  | "input_schema_dialect"
  | "input_schema_unsupported"
  | "x_mcp_header_invalid"
  /** [B20 A2 review] the name, a property name, an enum / const string or an `x-mcp-header` token carries the sent token */
  | "credential_echo"
  /** [B20 A2 review-2] the tool's text would take the listing past its one scrub budget: excluded whole, never partly scrubbed */
  | "schema_text_budget"
  /** [B20 A2 review-3] a judged string whose skeleton would pass 4 x its length: excluded before it is expanded */
  | "text_expansion";

/** One `x-mcp-header` property, as `tool-call.ts` mirrors it into a request header. */
export interface McpHeaderParameter {
  /** the annotated property's own name (the last step of `path`) */
  readonly property: string;
  /** [B20 A2 review] the property names from the schema root to it: where `prepareMcpToolCall` reads the value (own properties only) */
  readonly path: readonly string[];
  readonly token: string;
  readonly header: string;
  readonly type: "string" | "integer" | "boolean";
}

/** The four hints of `ToolAnnotations` (reference notes section 6), parsed and TRUSTED FOR NOTHING. */
export interface McpToolAnnotations {
  readonly readOnlyHint: boolean | null;
  readonly destructiveHint: boolean | null;
  readonly idempotentHint: boolean | null;
  readonly openWorldHint: boolean | null;
}

export interface McpAcceptedTool {
  readonly serverId: string;
  /** the name as the server spells it — what `tools/call` and `Mcp-Name` carry */
  readonly name: string;
  /** the Sirkit-side id: namespaced and reversible, never a `sirkit.` id (OD-52) */
  readonly toolId: string;
  readonly providerName: string;
  /** display-only, untrusted: never an instruction to a model (A4 enforces that at the observation boundary) */
  readonly title: string | null;
  readonly description: string | null;
  readonly untrusted: true;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema: Readonly<Record<string, unknown>> | null;
  /** the server declared an output schema this client would not accept: the tool is kept without one */
  readonly outputSchemaDropped: boolean;
  readonly headerParameters: readonly McpHeaderParameter[];
  readonly annotations: McpToolAnnotations;
  /** Sirkit's own classification of EVERY foreign tool, whatever the server's annotations claim */
  readonly observation: "external-read";
}

export interface McpToolExclusion {
  readonly serverId: string;
  /** the validated name, or `(unnamed tool #n)` — a refused name is never echoed */
  readonly label: string;
  readonly reason: McpToolExclusionReason;
}

export interface McpForeignToolSet {
  readonly serverId: string;
  readonly accepted: readonly McpAcceptedTool[];
  readonly excluded: readonly McpToolExclusion[];
  /** how many definitions were read at all (at most `MCP_TOOLS_PER_SERVER_MAX`) */
  readonly considered: number;
  /** how many the server listed past that bound: counted, never read */
  readonly notRead: number;
}

export interface McpForeignToolContext {
  /** the token `mcpPost` would send to this row (`mcpRedactionSubjects`): a text that carries it is replaced whole */
  redact?: readonly string[];
  /** provider names another source already holds; a foreign name that maps onto one is excluded, never renamed */
  reservedProviderNames?: Iterable<string>;
}

// ── The accepted brand ────────────────────────────────────────────────────────

const accepted = new WeakSet<object>();

/** Whether this exact object is a descriptor THESE gates built: `callMcpTool` will send nothing else. */
export function isAcceptedMcpTool(value: unknown): value is McpAcceptedTool {
  return typeof value === "object" && value !== null && accepted.has(value);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Define an own data property, so a `__proto__` key from server data is a KEY and never a prototype (S6). */
function define(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

/** [B20 A2 review-3] One judged string as the matcher reads it: what is read of it (bounded) and its skeleton, computed ONCE. */
interface ReadText {
  read: string;
  skeleton: string;
}

/**
 * [B20 A2 review-3] The skeleton of `text` (the transport's `skeletonOf`: NFKD without marks and format characters), or null
 * once it passes `limit` characters: computed in chunks that never end inside a surrogate pair (the skeleton of a text is
 * the skeletons of such chunks, as `skeletonCarries` relies on), so no more than one chunk's expansion past `limit` is ever
 * built. An ASCII text is its own skeleton.
 */
function boundedSkeleton(text: string, limit: number): string | null {
  if (!NON_ASCII.test(text)) return text.length > limit ? null : text;
  const pieces: string[] = [];
  let length = 0;
  for (let start = 0; start < text.length;) {
    let end = Math.min(text.length, start + SKELETON_CHUNK_CHARS);
    const last = text.charCodeAt(end - 1);
    if (end < text.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
    const piece = skeletonOf(text.slice(start, end));
    length += piece.length;
    if (length > limit) return null;
    pieces.push(piece);
    start = end;
  }
  return pieces.join("");
}

/** [B20 A2 review-3] What the matcher reads of a string: its first `MCP_DIRECTIVE_SCAN_CHARS` characters. */
const readOf = (text: string): string => (text.length > MCP_DIRECTIVE_SCAN_CHARS ? text.slice(0, MCP_DIRECTIVE_SCAN_CHARS) : text);
/** [B20 A2 review-3] The most a read text's skeleton may hold: 4 x its length, and never more than 4 x the scan window. */
const skeletonCap = (read: string): number => Math.min(read.length * MCP_SKELETON_MAX_EXPANSION, MCP_SKELETON_MAX_CHARS);

/**
 * [B20 A2 review-3] THE directive matcher of every judged string. Raw: any bidirectional control, more than a bounded share
 * of non-printing characters, and the markers (`DIRECTIVE_MARKERS`) over the lowercased skeleton, as before. Then the
 * phrases (`MCP_DIRECTIVE_PHRASES`) over the WORD and ACRONYM streams of the skeleton, and the long phrases over its
 * SQUASHED stream: `IGNORE/PREVIOUS/INSTRUCTIONS`, `ignorePREVIOUSinstructions` and `IGNOREPREVIOUSINSTRUCTIONS` read alike.
 * Linear in the read text and its skeleton, both of which the caller has charged.
 */
function directiveIn({ read, skeleton }: ReadText): boolean {
  if (BIDI_CONTROL.test(read)) return true;
  const nonPrinting = (read.match(NON_PRINTING) ?? []).length;
  if (nonPrinting > NON_PRINTING_MIN && nonPrinting * NON_PRINTING_SHARE_DIVISOR > read.length) return true;
  if (DIRECTIVE_MARKERS.test(skeleton.toLowerCase())) return true;
  const streams = wordStreams(skeleton);
  return DIRECTIVE_VOCABULARY.words.test(streams.words)
    || (streams.acronym !== streams.words && DIRECTIVE_VOCABULARY.words.test(streams.acronym))
    || DIRECTIVE_VOCABULARY.squashed.test(streams.squashed);
}

/**
 * Whether a string reads as an instruction to a model: the one matcher (`directiveIn`) over its first
 * `MCP_DIRECTIVE_SCAN_CHARS` characters. A text past the scan window is never read: what this client keeps of it is
 * shorter than the window (a stated limit). [B20 A2 review-3] A string whose skeleton would pass its bound fails closed.
 * `acceptOne` reads the tool NAME with it (128 ASCII characters at most); every other judged string is read once, and
 * charged, by `readJudged`.
 */
export function carriesDirective(raw: unknown): boolean {
  if (typeof raw !== "string" || raw === "") return false;
  const read = readOf(raw);
  const skeleton = boundedSkeleton(read, skeletonCap(read));
  return skeleton === null || directiveIn({ read, skeleton });
}

/**
 * [B20 A2 review-3] Read the judged strings of one tool ONCE, each charged to the listing's scan budget (`left` is what remains
 * of it) by its skeleton length — never less than the characters read of it — BEFORE any of them is scanned. A string whose
 * skeleton would pass its bound is `text_expansion`, one that would pass what remains `schema_text_budget`; either way the
 * skeleton stops being built there. The finding's U+FDFA values were scanned outside the budget: 28.1 s for 500 tools.
 */
function readJudged(texts: readonly string[], left: number): { ok: true; reads: ReadText[]; charge: number } | { ok: false; reason: "text_expansion" | "schema_text_budget" } {
  const reads: ReadText[] = [];
  let charge = 0;
  for (const text of texts) {
    const read = readOf(text);
    const room = left - charge;
    if (read.length > room) return { ok: false, reason: "schema_text_budget" };
    const cap = skeletonCap(read);
    const skeleton = boundedSkeleton(read, Math.min(cap, room));
    if (skeleton === null) return { ok: false, reason: cap <= room ? "text_expansion" : "schema_text_budget" };
    charge += Math.max(read.length, skeleton.length);
    reads.push({ read, skeleton });
  }
  return { ok: true, reads, charge };
}

/**
 * [B20 A2 review-3] Whether `text` takes more than `max` bytes in UTF-8, counted in one pass over its UTF-16 units without a
 * copy and stopped at `max + 1` (a unit is at least one byte, so a longer text is over at once; a surrogate pair is 4 bytes).
 */
function utf8Exceeds(text: string, max: number): boolean {
  if (text.length > max) return true;
  let bytes = 0;
  for (let index = 0; index < text.length && bytes <= max; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length && (text.charCodeAt(index + 1) & 0xfc00) === 0xdc00) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes > max;
}

/** The four hints, each only when it IS a boolean own property; everything else the server wrote is ignored. */
function readAnnotations(raw: unknown): McpToolAnnotations {
  const read = (key: string): boolean | null => {
    if (!isPlainObject(raw) || !Object.hasOwn(raw, key)) return null;
    const value = raw[key];
    return typeof value === "boolean" ? value : null;
  };
  return Object.freeze({ readOnlyHint: read("readOnlyHint"), destructiveHint: read("destructiveHint"), idempotentHint: read("idempotentHint"), openWorldHint: read("openWorldHint") });
}

// ── Schemas ───────────────────────────────────────────────────────────────────

type SchemaFailure = Extract<McpToolExclusionReason, `input_schema_${string}` | "x_mcp_header_invalid" | "description_directive" | "credential_echo">;
type SchemaResult = { ok: true; schema: Record<string, unknown>; headers: McpHeaderParameter[] } | { ok: false; reason: SchemaFailure };
/** [B20 A2 review-2] A schema the walk has read and COUNTED, its retained strings not judged yet: what the budget is charged by */
type SchemaWalk = { ok: true; schema: Record<string, unknown>; headers: McpHeaderParameter[]; texts: RetainedText[] } | { ok: false; reason: SchemaFailure };

interface Frame {
  source: Record<string, unknown>;
  target: Record<string, unknown>;
  depth: number;
  /** [B20 A2 review] the property names from the root when every step was a `properties` step (the only place `x-mcp-header` may sit), else null */
  path: readonly string[] | null;
}

/**
 * [B20 A2 review] One retained schema string, recorded by the walk and judged only once the walk has COUNTED them all (S5):
 * a property name or an enum / const string kept verbatim, or a description / title (`annotation`) kept scrubbed — the
 * walk defines it raw at its place, so key order is kept, and the judgement replaces or removes it.
 */
type RetainedText =
  | { kind: "identifier" | "value"; text: string }
  | { kind: "annotation"; text: string; target: Record<string, unknown>; key: string; maxChars: number };

/**
 * A plain JSON value copied ITERATIVELY (a deeply nested body can never exhaust the stack), with every key defined as
 * an own data property — a `__proto__` key from server data is a key and never a prototype (S6) — under a hard depth
 * and node budget. Over either budget it answers nothing: the caller decides what that means.
 */
export function boundedJsonCopy(value: unknown, depthBudget: number, nodeBudget: number): { ok: true; value: unknown } | { ok: false } {
  if (value === null || typeof value !== "object") return { ok: true, value };
  let nodes = 0;
  const root: unknown = Array.isArray(value) ? [] : {};
  const stack: Array<{ source: object; target: unknown; depth: number }> = [{ source: value, target: root, depth: 1 }];
  while (stack.length > 0) {
    const frame = stack.pop()!;
    nodes += 1;
    if (nodes > nodeBudget || frame.depth > depthBudget) return { ok: false };
    const entries: Array<[string, unknown]> = Array.isArray(frame.source)
      ? frame.source.map((item, index) => [String(index), item])
      : Object.entries(frame.source as Record<string, unknown>);
    for (const [key, child] of entries) {
      if (child !== null && typeof child === "object") {
        const next: unknown = Array.isArray(child) ? [] : {};
        if (Array.isArray(frame.target)) (frame.target as unknown[]).push(next);
        else define(frame.target as Record<string, unknown>, key, next);
        stack.push({ source: child as object, target: next, depth: frame.depth + 1 });
      } else if (Array.isArray(frame.target)) {
        (frame.target as unknown[]).push(child);
      } else {
        define(frame.target as Record<string, unknown>, key, child);
      }
    }
  }
  return { ok: true, value: root };
}

/** [B20 A2 review] A property name kept as a KEY: a bounded identifier, never a member of Object.prototype (the call-time validator reads `required` with `in`). */
function isPropertyName(name: string): boolean {
  return name.length <= MCP_SCHEMA_PROPERTY_NAME_MAX_CHARS && PROPERTY_NAME_PATTERN.test(name) && !PROTOTYPE_KEYS.has(name) && !Object.hasOwn(Object.prototype, name);
}

/**
 * [B20 A2 review] Whether `validateAgainstSchema` (the call-time validator, unchanged) evaluates every node of an accepted
 * copy: it switches on ONE `type` string (or answers by `enum` alone), has no `anyOf` branch and never reads `const`. An
 * input schema it cannot evaluate would be a tool that can never be called, or a constraint that is never enforced.
 */
function callValidatorEvaluates(schema: Record<string, unknown>): boolean {
  const stack: unknown[] = [schema];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!isPlainObject(node) || node.anyOf !== undefined || node.const !== undefined) return false;
    if (node.type === undefined ? node.enum === undefined : !(typeof node.type === "string" && CALLABLE_TYPES.has(node.type))) return false;
    if (isPlainObject(node.properties)) for (const child of Object.values(node.properties)) stack.push(child);
    if (node.items !== undefined) stack.push(node.items);
  }
  return true;
}

/**
 * [B20 A2 review] The retained strings of one schema, judged once the walk has counted them: a name or a value carrying the
 * sent token (case-folded skeleton) is `credential_echo`; any of them reading as a directive is `description_directive`;
 * a description or title that passes is replaced by its scrubbed, bounded text — whole by the marker when it still carries
 * the token — or removed when nothing of it is left.
 * [B20 A2 review-2] A string kept verbatim (a name, an enum or const value, an `x-mcp-header` token) is read raw AND as words:
 * an enum or const value used to be read raw only, a name split on `_`, `.` and `-` only.
 * [B20 A2 review-3] Every one of them, a description or title too, is read by the ONE matcher (`directiveIn`) from the read
 * `readJudged` made and charged: `reads[i]` is the read of `texts[i]`.
 */
function judgeRetainedTexts(texts: readonly RetainedText[], reads: readonly ReadText[], redact: readonly string[]): SchemaFailure | null {
  for (let index = 0; index < texts.length; index += 1) {
    const entry = texts[index]!;
    const read = reads[index];
    if (read === undefined) return "description_directive"; // never: every retained string was read before it is judged
    if (entry.kind === "annotation") {
      if (directiveIn(read)) return "description_directive";
      const kept = displayText(entry.text, entry.maxChars, redact);
      if (kept === null) delete entry.target[entry.key];
      else entry.target[entry.key] = kept;
      continue;
    }
    if (skeletonCarries(entry.text, redact, true)) return "credential_echo";
    if (directiveIn(read)) return "description_directive";
  }
  return null;
}

/**
 * One foreign schema, read once: the size, then ONE iterative walk that enforces the depth, subschema and property
 * bounds, refuses every `$…` keyword and a foreign dialect, collects the `x-mcp-header` annotations with their path,
 * and builds a fresh copy without them.
 * [B20 A2 review] The walk also COUNTS every string it retains (at most `MCP_SCHEMA_MAX_STRINGS`, else too large) and holds
 * the two verbatim kinds to their closed shapes; none of them is scanned here.
 * [B20 A2 review-2] The judgement is a second step (`judgeForeignSchema`), so the listing's scrub budget is charged for both
 * schemas of a tool before any of its text is scanned. A structural refusal ends the walk: its strings are never judged.
 */
function walkForeignSchema(raw: unknown, input: boolean, redact: readonly string[]): SchemaWalk {
  if (!isPlainObject(raw)) return { ok: false, reason: "input_schema_missing" };
  let serialized: string;
  try {
    serialized = JSON.stringify(raw) ?? "";
  } catch {
    return { ok: false, reason: "input_schema_too_large" };
  }
  // [B20 A2 review-3] BYTES, as the page and the specification say: the UTF-16 length let 20 000 e-acute (40 080 bytes) through
  if (utf8Exceeds(serialized, MCP_SCHEMA_MAX_BYTES)) return { ok: false, reason: "input_schema_too_large" };

  const schema: Record<string, unknown> = {};
  const headers: McpHeaderParameter[] = [];
  const tokens = new Set<string>();
  const texts: RetainedText[] = [];
  /** [B20 A2 review] one more retained string: false when that is one too many */
  const retain = (entry: RetainedText): boolean => texts.push(entry) <= MCP_SCHEMA_MAX_STRINGS;
  /** [B20 A2 review] an enum or const string kept verbatim: bounded (the length first) and inert, then retained */
  const verbatimValue = (text: string): SchemaFailure | null => {
    if (text.length > MCP_SCHEMA_VALUE_MAX_CHARS || NOT_INERT.test(text)) return "input_schema_unsupported";
    return retain({ kind: "value", text }) ? null : "input_schema_too_large";
  };
  const stack: Frame[] = [{ source: raw, target: schema, depth: 1, path: [] }];
  let subschemas = 0;
  while (stack.length > 0) {
    const frame = stack.pop()!;
    subschemas += 1;
    if (subschemas > MCP_SCHEMA_MAX_SUBSCHEMAS) return { ok: false, reason: "input_schema_too_many_subschemas" };
    if (frame.depth > MCP_SCHEMA_MAX_DEPTH) return { ok: false, reason: "input_schema_too_deep" };
    for (const key of Object.keys(frame.source)) {
      if (REF_KEYWORDS.has(key)) return { ok: false, reason: "input_schema_ref_keyword" };
      const value = frame.source[key];
      if (key === "$schema") {
        if (frame.source !== raw || typeof value !== "string" || !JSON_SCHEMA_2020_12.has(value)) return { ok: false, reason: "input_schema_dialect" };
        continue; // the dialect is the default one: it is never copied into the accepted schema
      }
      if (key === X_MCP_HEADER) {
        const token = typeof value === "string" ? value : "";
        const type = frame.source.type;
        const path = frame.path;
        if (!input || path === null || path.length === 0 || !TCHAR_TOKEN.test(token) || typeof type !== "string" || !HEADER_PARAM_TYPES.has(type)) return { ok: false, reason: "x_mcp_header_invalid" };
        if (tokens.has(token.toLowerCase()) || headers.length >= MCP_PARAM_HEADER_MAX) return { ok: false, reason: "x_mcp_header_invalid" };
        // [B20 A2 review] a tchar token can spell a b64token: the sent token, in any case, is never a header name
        if (skeletonCarries(token, redact, true)) return { ok: false, reason: "credential_echo" };
        tokens.add(token.toLowerCase());
        // [B20 A2 review-2] the token is kept verbatim (a header name): judged with the other retained strings, as a name is
        if (!retain({ kind: "identifier", text: token })) return { ok: false, reason: "input_schema_too_large" };
        headers.push(Object.freeze({ property: path[path.length - 1]!, path: Object.freeze([...path]), token, header: `Mcp-Param-${token}`, type: type as "string" | "integer" | "boolean" }));
        continue; // the extension keyword never reaches the accepted schema
      }
      if (key === "properties" && isPlainObject(value)) {
        const names = Object.keys(value);
        if (names.length > MCP_SCHEMA_MAX_PROPERTIES) return { ok: false, reason: "input_schema_too_many_properties" };
        const properties: Record<string, unknown> = {};
        define(frame.target, key, properties);
        for (const name of names) {
          // [B20 A2 review] a property name becomes a KEY of the accepted schema: a closed identifier or nothing (S1, S6)
          if (!isPropertyName(name)) return { ok: false, reason: "input_schema_unsupported" };
          if (!retain({ kind: "identifier", text: name })) return { ok: false, reason: "input_schema_too_large" };
          const child = value[name];
          if (isPlainObject(child)) {
            const next: Record<string, unknown> = {};
            define(properties, name, next);
            stack.push({ source: child, target: next, depth: frame.depth + 1, path: frame.path === null ? null : [...frame.path, name] });
          } else {
            const copied = boundedJsonCopy(child, MCP_SCHEMA_MAX_DEPTH * 2, SCHEMA_COPY_NODES);
            if (!copied.ok) return { ok: false, reason: "input_schema_too_deep" };
            define(properties, name, copied.value); // not a schema object: the validators refuse it below
          }
        }
        continue;
      }
      if (key === "items" && isPlainObject(value)) {
        const next: Record<string, unknown> = {};
        define(frame.target, key, next);
        stack.push({ source: value, target: next, depth: frame.depth + 1, path: null });
        continue;
      }
      if (key === "anyOf" && Array.isArray(value)) {
        const members: unknown[] = [];
        define(frame.target, key, members);
        for (const member of value) {
          if (isPlainObject(member)) {
            const next: Record<string, unknown> = {};
            members.push(next);
            stack.push({ source: member, target: next, depth: frame.depth + 1, path: null });
          } else {
            const copied = boundedJsonCopy(member, MCP_SCHEMA_MAX_DEPTH * 2, SCHEMA_COPY_NODES);
            if (!copied.ok) return { ok: false, reason: "input_schema_too_deep" };
            members.push(copied.value);
          }
        }
        continue;
      }
      // [B20 A2 review] the retained strings of a schema node: a description or title is kept scrubbed (defined raw HERE so
      // key order is kept, then judged), an enum member or a const that is a string is kept verbatim in its closed shape
      if ((key === "description" || key === "title") && typeof value === "string") {
        if (!retain({ kind: "annotation", text: value, target: frame.target, key, maxChars: key === "title" ? MCP_TOOL_TITLE_MAX_CHARS : MCP_TOOL_DESCRIPTION_MAX_CHARS })) return { ok: false, reason: "input_schema_too_large" };
        define(frame.target, key, value);
        continue;
      }
      if (key === "enum" && Array.isArray(value)) {
        for (const member of value) {
          const refused = typeof member === "string" ? verbatimValue(member) : null;
          if (refused !== null) return { ok: false, reason: refused };
        }
      }
      if (key === "const" && typeof value === "string") {
        const refused = verbatimValue(value);
        if (refused !== null) return { ok: false, reason: refused };
      }
      const copied = boundedJsonCopy(value, MCP_SCHEMA_MAX_DEPTH * 2, SCHEMA_COPY_NODES);
      if (!copied.ok) return { ok: false, reason: "input_schema_too_deep" };
      define(frame.target, key, copied.value);
    }
  }
  return { ok: true, schema, headers, texts };
}

/**
 * The judgement of a walked schema: [B20 A2 review] every retained string was counted by the walk, and only now is any of
 * them scanned (`judgeRetainedTexts`, [B20 A2 review-3] from the reads `readJudged` charged); then the two repository
 * validators over the copy, and an INPUT schema (`input`) must also be one the call-time validator evaluates
 * (`callValidatorEvaluates`).
 */
function judgeForeignSchema(walked: Extract<SchemaWalk, { ok: true }>, reads: readonly ReadText[], input: boolean, redact: readonly string[]): SchemaResult {
  const judged = judgeRetainedTexts(walked.texts, reads, redact);
  if (judged !== null) return { ok: false, reason: judged };
  const schema = walked.schema;
  // a tool's arguments are an object: a string, array or enum root can never describe them (as `toStrictSchema` requires)
  if (schema.type !== "object") return { ok: false, reason: "input_schema_unsupported" };
  if (validateSchemaStructure(schema).length > 0 || validateWireSubset(schema).length > 0) return { ok: false, reason: "input_schema_unsupported" };
  if (input && !callValidatorEvaluates(schema)) return { ok: false, reason: "input_schema_unsupported" };
  return { ok: true, schema, headers: walked.headers };
}

/** [B20 A2 review-2] What one `acceptForeignTools` call has spent of its one scrub budget. */
interface ScrubBudget { strings: number; chars: number }
/** [B20 A2 review-3] ... and of the scan half of that budget: the characters of every judged string, by its skeleton (`readJudged`). */
interface ListingBudget extends ScrubBudget { judged: number }

/**
 * [B20 A2 review-2] What the display scrub of one tool would read, counted before any of it runs: one string per text and
 * each text's characters up to its scrub window (4 x its bound, extended by the longest redaction subject). Nothing is read
 * but the lengths.
 */
function scrubCharge(texts: ReadonlyArray<{ text: unknown; maxChars: number }>, redact: readonly string[]): ScrubBudget {
  const charge: ScrubBudget = { strings: 0, chars: 0 };
  for (const { text, maxChars } of texts) {
    if (typeof text !== "string") continue;
    charge.strings += 1;
    charge.chars += Math.min(text.length, scrubWindow(maxChars, redact));
  }
  return charge;
}

/** [B20 A2 review-2] The descriptions and titles of a walked schema: the texts its judgement scrubs. */
function annotationsOf(walked: SchemaWalk | null): Array<{ text: unknown; maxChars: number }> {
  return walked !== null && walked.ok ? walked.texts.filter((entry) => entry.kind === "annotation") : [];
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

// ── acceptForeignTools ────────────────────────────────────────────────────────

/**
 * Turn one server's tool definitions into accepted descriptors and exclusions. Never throws: a definition that cannot
 * even be read is excluded like any other. [B20 A2 review-2] The call has ONE scrub budget (`MCP_LISTING_SCRUB_MAX_STRINGS`,
 * `MCP_LISTING_SCRUB_MAX_CHARS`), spent in listing order: a tool whose text would pass what remains is `schema_text_budget`.
 * [B20 A2 review-3] The same budget holds the scan (`MCP_LISTING_SCAN_MAX_CHARS`): every judged string is charged by its
 * skeleton before the matcher reads it.
 */
export function acceptForeignTools(server: McpServerRegistryEntry, rawTools: unknown, context: McpForeignToolContext = {}): McpForeignToolSet {
  const acceptedTools: McpAcceptedTool[] = [];
  const excluded: McpToolExclusion[] = [];
  let considered = 0;
  let notRead = 0;
  let serverId = "";
  try {
    const id: unknown = (server as { id?: unknown } | null)?.id;
    serverId = typeof id === "string" && MCP_SERVER_ID_PATTERN.test(id) ? id : "";
  } catch {
    serverId = "";
  }
  if (serverId === "" || !Array.isArray(rawTools)) {
    return Object.freeze({ serverId, accepted: Object.freeze([]), excluded: Object.freeze([]), considered: 0, notRead: 0 });
  }

  let redact: readonly string[] = [];
  let reserved = new Set<string>();
  try {
    const given = context?.redact;
    if (Array.isArray(given)) redact = given.filter((entry): entry is string => typeof entry === "string" && entry !== "");
    const names = context?.reservedProviderNames;
    if (names !== undefined && names !== null) reserved = new Set(Array.from(names).filter((entry): entry is string => typeof entry === "string"));
  } catch {
    redact = [];
    reserved = new Set<string>();
  }

  notRead = Math.max(0, rawTools.length - MCP_TOOLS_PER_SERVER_MAX);
  const names = new Set<string>();
  const providerNames = new Set<string>(reserved);
  // [B20 A2 review-2] ONE scrub budget for the whole call: every tool is charged against what the tools before it spent
  // [B20 A2 review-3] and its scan half, charged the same way
  const budget: ListingBudget = { strings: 0, chars: 0, judged: 0 };
  for (let index = 0; index < rawTools.length && index < MCP_TOOLS_PER_SERVER_MAX; index += 1) {
    considered += 1;
    const position = index + 1;
    try {
      const outcome = acceptOne(serverId, rawTools[index], names, providerNames, redact, budget);
      if (outcome.ok) {
        names.add(outcome.tool.name);
        providerNames.add(outcome.tool.providerName);
        acceptedTools.push(outcome.tool);
      } else {
        excluded.push(Object.freeze({ serverId, label: outcome.label ?? `(unnamed tool #${position})`, reason: outcome.reason }));
      }
    } catch {
      excluded.push(Object.freeze({ serverId, label: `(unnamed tool #${position})`, reason: "not_an_object" }));
    }
  }
  return Object.freeze({ serverId, accepted: Object.freeze(acceptedTools), excluded: Object.freeze(excluded), considered, notRead });
}

type AcceptOne = { ok: true; tool: McpAcceptedTool } | { ok: false; reason: McpToolExclusionReason; label?: string };

function acceptOne(serverId: string, raw: unknown, names: ReadonlySet<string>, providerNames: ReadonlySet<string>, redact: readonly string[], budget: ListingBudget): AcceptOne {
  if (!isPlainObject(raw)) return { ok: false, reason: "not_an_object" };
  const name: unknown = raw.name;
  // the length is judged before the pattern: a megabyte-long name meets no regex (S5)
  if (typeof name !== "string" || name.length > 128 || !MCP_TOOL_NAME_PATTERN.test(name)) return { ok: false, reason: "name_invalid" };
  // [B20 A2 review] the alphabet admits a b64token without '+', '/' or '=': a name that IS the sent token, in any case, is
  // refused before any exclusion could echo it, and reported by position only (S2)
  if (skeletonCarries(name, redact, true)) return { ok: false, reason: "credential_echo" };
  // [B20 A2 review-2] the name is kept verbatim and becomes the provider name a model reads: one that reads as a directive
  // (`ignore.previous.instructions`, `ignorePreviousInstructions`) is excluded, and reported by position only
  // [B20 A2 review-3] read by the one matcher BEFORE any exclusion could echo it (128 ASCII characters at most: it is charged
  // with the tool's own text below, and every other judged string is charged before it is read)
  if (carriesDirective(name)) return { ok: false, reason: "description_directive" };
  const lower = name.toLowerCase();
  if (RESERVED_NAME_PREFIXES.some((prefix) => lower.startsWith(prefix))) return { ok: false, reason: "reserved_namespace", label: name };
  if (names.has(name)) return { ok: false, reason: "duplicate_name", label: name };

  const toolId = `${MCP_FOREIGN_TOOL_ID_PREFIX}${serverId}.${name}`;
  let providerName: string;
  try {
    providerName = agentProviderName(`${MCP_FOREIGN_PROVIDER_PREFIX}${serverId}__${name}`);
  } catch {
    return { ok: false, reason: "name_unrepresentable", label: name };
  }
  if (providerNames.has(providerName)) return { ok: false, reason: "name_collision", label: name };

  // [B20 A2 review-3] the tool's own name, title and description, read ONCE and charged to the listing's scan budget BEFORE the
  // title and description are scanned: past the budget, or past its skeleton bound, a tool is excluded unread
  const own = readJudged([name, raw.title, raw.description].filter((text): text is string => typeof text === "string"), MCP_LISTING_SCAN_MAX_CHARS - budget.judged);
  if (!own.ok) return { ok: false, reason: own.reason, label: name };
  budget.judged += own.charge;
  // the raw text is judged for a directive BEFORE it is scrubbed: a scrub would hide the marker, not the intent
  if (own.reads.slice(1).some(directiveIn)) return { ok: false, reason: "description_directive", label: name };

  const annotations = readAnnotations(raw.annotations);
  if (annotations.readOnlyHint === false || annotations.destructiveHint === true) return { ok: false, reason: "declared_write", label: name };

  const inputWalk = walkForeignSchema(raw.inputSchema, true, redact);
  if (!inputWalk.ok) return { ok: false, reason: inputWalk.reason, label: name };
  // [B20 A2 review-2] an output schema the WALK refuses is dropped unjudged: its strings are never scanned or scrubbed, nothing
  // of it is kept, and it is charged nothing. [B20 A2 review-3] Every refusal of the walk: not an object, not serialisable,
  // over 32 768 UTF-8 bytes, a `$…` keyword, a `$schema` off the root or not 2020-12, an `x-mcp-header`, a bound on depth,
  // subschemas, properties or retained strings, a property name outside its closed pattern, an enum or const string over
  // 256 characters or not inert, or a non-schema value past the copy's own budget
  const outputWalk = raw.outputSchema === undefined ? null : walkForeignSchema(raw.outputSchema, false, redact);
  let outputSchemaDropped = outputWalk !== null && !outputWalk.ok;

  // [B20 A2 review-2] the listing's one scrub budget, charged for everything this tool would scrub — its own title and
  // description and the descriptions and titles of both schemas — BEFORE any of it is scanned or scrubbed: a tool that would
  // pass the budget is excluded whole, never partly scrubbed and never accepted unscrubbed
  const charge = scrubCharge([
    { text: raw.title, maxChars: MCP_TOOL_TITLE_MAX_CHARS },
    { text: raw.description, maxChars: MCP_TOOL_DESCRIPTION_MAX_CHARS },
    ...annotationsOf(inputWalk),
    ...annotationsOf(outputWalk),
  ], redact);
  if (budget.strings + charge.strings > MCP_LISTING_SCRUB_MAX_STRINGS || budget.chars + charge.chars > MCP_LISTING_SCRUB_MAX_CHARS) {
    return { ok: false, reason: "schema_text_budget", label: name };
  }
  // [B20 A2 review-3] every retained string of both schemas — property names, enum and const values, `x-mcp-header` tokens,
  // descriptions and titles — read ONCE and charged to the scan budget by its skeleton BEFORE any of it is scanned
  const retained = outputWalk !== null && outputWalk.ok ? [...inputWalk.texts, ...outputWalk.texts] : inputWalk.texts;
  const schemaReads = readJudged(retained.map((entry) => entry.text), MCP_LISTING_SCAN_MAX_CHARS - budget.judged);
  if (!schemaReads.ok) return { ok: false, reason: schemaReads.reason, label: name };
  budget.strings += charge.strings;
  budget.chars += charge.chars;
  budget.judged += schemaReads.charge;

  const input = judgeForeignSchema(inputWalk, schemaReads.reads.slice(0, inputWalk.texts.length), true, redact);
  if (!input.ok) return { ok: false, reason: input.reason, label: name };

  let outputSchema: Record<string, unknown> | null = null;
  if (outputWalk !== null && outputWalk.ok) {
    const output = judgeForeignSchema(outputWalk, schemaReads.reads.slice(inputWalk.texts.length), false, redact);
    if (output.ok) outputSchema = output.schema;
    // [B20 A2 review] a directive or the sent token in the output schema is the SERVER's intent, not a malformed schema:
    // the tool is excluded, as for the input schema, rather than kept without its output schema
    // [B20 A2 review-2] — when the walk FINISHED: a structural refusal met first dropped the schema above, unjudged
    else if (output.reason === "description_directive" || output.reason === "credential_echo") return { ok: false, reason: output.reason, label: name };
    else outputSchemaDropped = true;
  }

  const tool: McpAcceptedTool = Object.freeze({
    serverId,
    name,
    toolId,
    providerName,
    title: displayText(raw.title, MCP_TOOL_TITLE_MAX_CHARS, redact),
    description: displayText(raw.description, MCP_TOOL_DESCRIPTION_MAX_CHARS, redact),
    untrusted: true,
    inputSchema: deepFreeze(input.schema),
    outputSchema: outputSchema === null ? null : deepFreeze(outputSchema),
    outputSchemaDropped,
    headerParameters: Object.freeze(input.headers),
    annotations,
    observation: "external-read",
  });
  accepted.add(tool);
  return { ok: true, tool };
}
