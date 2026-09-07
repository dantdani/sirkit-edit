/**
 * B16.1C §F — what a schematic proposal will change, stated for the human
 * review dialog before anything is applied. Pure over schematic states.
 */

import type { SchematicState } from "@/lib/schematic-types";

export interface SchematicProposalSummary {
  /** True when the current schematic has content that will be replaced. */
  replaces: boolean;
  currentPartCount: number;
  currentWireCount: number;
  parts: string[];
  partCount: number;
  wireCount: number;
  netLabels: string[];
  headline: string;
  details: string[];
}

function refOf(part: { refDes?: string; id: string; value?: string }): string {
  return `${part.refDes ?? part.id}${part.value ? `=${part.value}` : ""}`;
}

export function describeSchematicProposal(next: SchematicState, current: Pick<SchematicState, "components" | "wires" | "kicadComponents" | "netLabels">): SchematicProposalSummary {
  const currentPartCount = current.components.length + (current.kicadComponents?.length ?? 0);
  const currentWireCount = current.wires.length + (current.netLabels?.length ?? 0);
  const replaces = currentPartCount > 0 || currentWireCount > 0;
  const parts = [...next.components.map((item) => `${item.id}=${item.value}`), ...(next.kicadComponents ?? []).map(refOf)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const netLabels = [...new Set((next.netLabels ?? []).map((label) => label.name))].sort();
  const partCount = parts.length, wireCount = next.wires.length;
  const headline = replaces ? `Replace the current schematic (${currentPartCount} part${currentPartCount === 1 ? "" : "s"}, ${currentWireCount} wire${currentWireCount === 1 ? "" : "s"}/labels) with the generated one?` : "Apply the generated schematic to the empty sheet?";
  const details = [
    `${partCount} part${partCount === 1 ? "" : "s"}: ${parts.join(", ") || "none"}`,
    `${wireCount} wire${wireCount === 1 ? "" : "s"}${netLabels.length ? `, net labels: ${netLabels.join(", ")}` : ""}`,
    replaces ? "Every existing component, wire and label on this sheet is removed by the apply (one undoable transaction)." : "Nothing existing is removed.",
  ];
  return { replaces, currentPartCount, currentWireCount, parts, partCount, wireCount, netLabels, headline, details };
}
