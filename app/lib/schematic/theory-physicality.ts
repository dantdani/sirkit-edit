/**
 * [B10.2] THE production physical-theory-component rule, shared so no second divergent pin/physicality definition can exist:
 * a theory component is a PHYSICAL part exactly when it has a theory pin contract here (ground symbols and voltage/current
 * sources are sim stimuli with no board footprint).
 *
 * [PR-G, 2026-10-17] Moved here verbatim from the Stage 4 schematic -> board bridge (app/lib/pcb/netlist-bridge.ts), which
 * imports and re-exports it, so every existing consumer reads the same table. The Stage 3 preparation reads
 * (app/lib/pcb-sync/unresolved-instances.ts, PR-C; app/lib/pcb-sync/preflight-read.ts, PR-D) import it from here: Stage 3
 * production code must not import the legacy bridge or its footprint heuristics (the Stage 3 security property,
 * app/lib/pcb-sync/__tests__/contracts-security-property.test.ts). Pure data: no imports, no I/O.
 */

/** Theory pin name → pad number. Diode pad 1 is the cathode (KiCad convention). */
const THEORY_PIN_NUMBERS: Record<string, Record<string, string>> = {
  resistor: { left: "1", right: "2" },
  capacitor: { left: "1", right: "2" },
  inductor: { left: "1", right: "2" },
  diode: { cathode: "1", anode: "2" },
};

/** Returns pinName → pinNumber for a physical theory type, or null for non-physical types. */
export function theoryPinContract(type: string): Readonly<Record<string, string>> | null {
  return THEORY_PIN_NUMBERS[type] ?? null;
}
