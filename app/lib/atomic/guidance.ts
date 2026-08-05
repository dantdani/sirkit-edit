import type { ApplicationGuidance, GuidanceCategory } from "./types";

const ACTIONS: Record<GuidanceCategory, ReadonlySet<string>> = {
  decoupling: new Set(["place_decoupling"]),
  regulator_stability: new Set(["require_input_capacitor", "require_output_capacitor", "review_esr_window"]),
  thermal_pad: new Set(["connect_thermal_pad", "provide_thermal_copper"]),
  boot_strap: new Set(["strap_pin", "review_boot_state"]),
  reset: new Set(["bias_reset", "review_reset_timing"]),
  do_not_connect: new Set(["do_not_connect"]),
  layout: new Set(["review_layout", "keep_loop_compact", "place_near_terminal"]),
  reference_design: new Set(["reference_design"]),
  other: new Set(["review_source_guidance"]),
};

function primitiveNumbers(value: unknown, out: number[] = []): number[] {
  if (typeof value === "number" && Number.isFinite(value)) out.push(value);
  else if (Array.isArray(value)) value.forEach((item) => primitiveNumbers(item, out));
  else if (value && typeof value === "object") {
    if ("dimension" in value && "sourceText" in value) return out;
    Object.values(value as Record<string, unknown>).forEach((item) => primitiveNumbers(item, out));
  }
  return out;
}

/** Stage 5 normalization only; it never turns templates into executable checks. */
export function validateGuidance(item: ApplicationGuidance): string[] {
  const errors: string[] = [];
  if (item.executable !== false) errors.push("Stage 5 guidance cannot be executable");
  if (item.evidenceIds.length === 0) errors.push("guidance requires source evidence");
  if (!item.sourceText.trim()) errors.push("guidance source text/locator excerpt is required");
  if (item.status === "structured_rule_template") {
    const action = item.normalizedTemplate?.action;
    if (typeof action !== "string" || !ACTIONS[item.category].has(action)) errors.push(`unsupported ${item.category} template action`);
    for (const number of primitiveNumbers(item.normalizedTemplate)) {
      if (!item.sourceText.includes(String(number))) errors.push(`numeric value ${number} is not present in source text or a typed sourced quantity`);
    }
  }
  return [...new Set(errors)].sort();
}

