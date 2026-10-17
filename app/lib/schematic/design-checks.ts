/**
 * [PR-E] The Build sidebar's design checks, computed from the authoritative schematic and the catalog parts in the cache —
 * never decorative. Two checks the page shows with a real state each:
 *  - "No floating nets": the drawn schematic against its own netlist (`validateSchematicNetlist`: floating pins, broken
 *    connections, self-shorts, unintended merges, unanchored labels, unresolved pins);
 *  - "Supply rails connected": the ERC's supply findings (`supply_missing`, `no_ground`, `supply_short`).
 * A check is `pass`, `findings` (with the bounded messages) or `not_run` with the reason (Theory mode, no catalog parts,
 * parts not loaded yet). The result carries the digest of the schematic it was computed on, so a stale result is never
 * shown as current. "Not run" is never a pass.
 */
import type { BuildLogicalNetlist, SchematicState } from "@/lib/schematic-types";
import type { CachedPart } from "@/app/lib/parts-cache";
import { schematicToBuildNetlist } from "@/lib/schematic-to-netlist";
import { validateSchematicNetlist } from "@/lib/validate-netlist";
import { runErc, type ErcCategory } from "@/lib/erc";

export type DesignCheckState = "pass" | "findings" | "not_run";

export interface DesignCheck {
  id: "floating-nets" | "supply-rails" | "bom";
  label: string;
  state: DesignCheckState;
  /** the number of findings (0 for pass and not_run) */
  count: number;
  /** bounded, human-readable findings (at most `DESIGN_CHECK_FINDINGS_LIMIT`) */
  findings: string[];
  /** why the check did not run (not_run only) */
  reason?: string;
}

export interface DesignChecks {
  /** the digest of the schematic the checks were computed on (the caller compares it with the live digest) */
  digest: string;
  checks: DesignCheck[];
}

export const DESIGN_CHECK_FINDINGS_LIMIT = 5;
const SUPPLY_CATEGORIES: ReadonlySet<ErcCategory> = new Set<ErcCategory>(["supply_missing", "no_ground", "supply_short"]);

const notRun = (id: DesignCheck["id"], label: string, reason: string): DesignCheck => ({ id, label, state: "not_run", count: 0, findings: [], reason });
const fromFindings = (id: DesignCheck["id"], label: string, messages: string[]): DesignCheck =>
  messages.length === 0 ? { id, label, state: "pass", count: 0, findings: [] } : { id, label, state: "findings", count: messages.length, findings: messages.slice(0, DESIGN_CHECK_FINDINGS_LIMIT).map((m) => m.slice(0, 200)) };

/** Compute both checks for a Build-mode schematic. `parts` holds the loaded catalog parts (`getCachedPart`); a placed part
 *  that is not loaded yet makes both checks `not_run` (their pins are unknown), never a pass. */
export function computeDesignChecks(state: SchematicState, parts: Map<string, CachedPart>, digest: string, mode: "build" | "theory"): DesignChecks {
  const kicad = state.kicadComponents ?? [];
  if (mode !== "build") return { digest, checks: [notRun("floating-nets", "No floating nets", "Theory mode has no catalog pins to check"), notRun("supply-rails", "Supply rails connected", "Theory mode has no catalog pins to check")] };
  if (kicad.length === 0) return { digest, checks: [notRun("floating-nets", "No floating nets", "no catalog parts on the sheet"), notRun("supply-rails", "Supply rails connected", "no catalog parts on the sheet")] };
  const missing = kicad.filter((instance) => !parts.has(instance.partId));
  if (missing.length > 0) {
    const reason = `${missing.length} part${missing.length === 1 ? "" : "s"} still loading`;
    return { digest, checks: [notRun("floating-nets", "No floating nets", reason), notRun("supply-rails", "Supply rails connected", reason)] };
  }
  const netlist = schematicToBuildNetlist(state, parts);
  const validation = validateSchematicNetlist(netlist, state, parts);
  const erc = runErc(netlist, new Map([...parts.entries()].map(([id, part]) => [id, { name: part.name, pins: part.pins }] as const)));
  return {
    digest,
    checks: [
      fromFindings("floating-nets", "No floating nets", [...validation.violations.map((violation) => violation.message), ...floatingFindings(netlist, state, parts)]),
      fromFindings("supply-rails", "Supply rails connected", erc.errors.filter((error) => SUPPLY_CATEGORIES.has(error.category)).map((error) => error.message)),
    ],
  };
}

/** A component pin that no wire or label reaches (NC and hidden pins excluded), and a labelled net with a single endpoint
 *  that is not a power rail: the drawn schematic derives its own netlist, so the validator alone cannot see what was never
 *  connected at all. */
function floatingFindings(netlist: BuildLogicalNetlist, state: SchematicState, parts: Map<string, CachedPart>): string[] {
  const endpoints = new Set<string>();
  const labelMembers = new Map<string, Set<string>>();
  for (const connection of netlist.connections) {
    if (connection.kind === "label") {
      endpoints.add(connection.pin);
      const members = labelMembers.get(connection.labelName) ?? new Set<string>();
      members.add(connection.pin);
      labelMembers.set(connection.labelName, members);
    } else {
      endpoints.add(connection.from);
      endpoints.add(connection.to);
    }
  }
  const findings: string[] = [];
  for (const instance of state.kicadComponents ?? []) {
    const part = parts.get(instance.partId);
    if (!part) continue;
    for (const pin of part.pins) {
      if (pin.type === "no_connect" || pin.hidden) continue;
      if (!endpoints.has(`${instance.refDes}.${pin.number}`) && !endpoints.has(`${instance.refDes}.${pin.name}`)) {
        findings.push(`${instance.refDes} pin ${pin.number}${pin.name && pin.name !== "~" ? ` (${pin.name})` : ""} is not connected.`);
      }
    }
  }
  const rail = /^(?:GND|VCC|VDD|VSS|\+?\d+(?:\.\d+)?V\d*|\+\w+)$/i;
  for (const [label, members] of labelMembers) if (members.size === 1 && !rail.test(label)) findings.push(`net "${label}" has a single connection.`);
  return findings;
}
