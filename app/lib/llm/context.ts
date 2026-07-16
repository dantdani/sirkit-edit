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

function serialize(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
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
