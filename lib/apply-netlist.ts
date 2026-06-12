import type { LogicalNetlist, SchematicState } from "./schematic-types";
import { autoLayout } from "./auto-layout";
import { validateTheoryNetlist, type NetlistValidation } from "./validate-netlist";

export async function generateSchematic(prompt: string): Promise<{
  state: SchematicState;
  netlist: LogicalNetlist;
  validation: NetlistValidation;
}> {
  const res = await fetch("/api/schematic", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Schematic API failed: ${err}`);
  }
  const netlist = (await res.json()) as LogicalNetlist;
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
