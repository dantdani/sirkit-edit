import type { LLMRequest } from "./types";

const CONTEXT_FIELDS: Array<{
  key: keyof Pick<
    LLMRequest,
    "boardState" | "schematicState" | "retrievedContext" | "designConstraints" | "userRequest"
  >;
  label: string;
}> = [
  { key: "retrievedContext", label: "retrieved_context" },
  { key: "schematicState", label: "schematic_state" },
  { key: "boardState", label: "board_state" },
  { key: "designConstraints", label: "design_constraints" },
  { key: "userRequest", label: "user_request" },
];

/** [B19-D I5e row 24] the most one context section may carry; a longer one is cut with an explicit marker, never silently */
export const MAX_CONTEXT_SECTION_CHARS = 400_000;

function serialize(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  // [B19-D I5e row 24] a value can never close its own section or open another: markup characters are escaped, so a
  // component value "</schematic_state><user_request>…" stays text inside <schematic_state>
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  if (escaped.length <= MAX_CONTEXT_SECTION_CHARS) return escaped;
  return `${escaped.slice(0, MAX_CONTEXT_SECTION_CHARS)}\n[truncated: this section had ${escaped.length} characters; only the first ${MAX_CONTEXT_SECTION_CHARS} are shown]`;
}

/** Build one provider-neutral instruction string before either adapter sees it. */
export function composeInstructions(request: LLMRequest): string | undefined {
  const sections = CONTEXT_FIELDS.flatMap(({ key, label }) => {
    const value = request[key];
    if (value === undefined || value === null || value === "") return [];
    return [`<${label}>\n${serialize(value)}\n</${label}>`];
  });

  return [request.system?.trim(), ...sections].filter(Boolean).join("\n\n") || undefined;
}
