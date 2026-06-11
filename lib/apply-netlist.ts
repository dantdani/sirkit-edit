import type { LogicalNetlist, SchematicState } from "./schematic-types";
import { autoLayout } from "./auto-layout";

export async function generateSchematic(prompt: string): Promise<{
  state: SchematicState;
  netlist: LogicalNetlist;
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
  return { state, netlist };
}
