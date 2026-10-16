import type { LogicalNetlist, SchematicState } from "./schematic-types";
import { autoLayout } from "./auto-layout";
import { validateTheoryNetlist, type NetlistValidation } from "./validate-netlist";
import { throwAiResponseError, withAiBrain, type AiRequestOwnership } from "@/app/lib/ai-preferences";
import { aiRequestHeaders, type AiRequestScope } from "@/app/lib/project/ai-request";

export interface GenerateSchematicOptions {
  /** [PR-C] the project/branch the request is about: the canonical wrapper refuses a request without its selector. */
  scope: AiRequestScope;
  /** [PR-C] the lifecycle signal: a project switch or unmount aborts the request instead of letting a late answer arrive. */
  signal?: AbortSignal;
  retry?: () => void;
  ownership?: AiRequestOwnership;
}

export async function generateSchematic(prompt: string, options: GenerateSchematicOptions): Promise<{
  state: SchematicState;
  netlist: LogicalNetlist;
  validation: NetlistValidation;
}> {
  const res = await fetch("/api/schematic", {
    method: "POST",
    headers: aiRequestHeaders(options.scope),
    body: JSON.stringify(withAiBrain({ prompt })),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!res.ok) {
    await throwAiResponseError(res, options.retry, options.ownership);
  }
  const netlist = (await res.json()) as LogicalNetlist;
  if (!netlist || typeof netlist !== "object" || !Array.isArray(netlist.components) || !Array.isArray(netlist.connections)) {
    // [PR-C] invalid local output is its own failure class, never laid out as if it were a circuit
    throw new Error("The model's answer was not a schematic netlist (no components and connections). Nothing was changed.");
  }
  const state = autoLayout(netlist);

  // Validate the drawn schematic against the intended netlist (theory mode has
  // no labels to reroute, so we surface findings rather than auto-fixing). warn,
  // not error, so it doesn't trip Next.js's dev error overlay.
  const validation = validateTheoryNetlist(netlist, state);
  if (!validation.ok) {
    console.warn(
      `[generateSchematic] ${validation.violations.length} netlist violation(s):`,
      validation.violations.map((v) => `${v.kind}: ${v.message}`).join("\n  "),
    );
  }

  return { state, netlist, validation };
}
