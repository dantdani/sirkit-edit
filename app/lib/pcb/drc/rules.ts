// DRC rule merging (PCB Stage 12). Effective rule for a (netId, checkKind) is the
// merge chain: default → net-class override → per-net override. Later wins per
// field; only DEFINED fields override. Pure.

import type { DrcRules, DrcRuleSet } from "./types";
import type { NetClass } from "../netclass";

/** Spread `override`'s defined fields over `base`. */
function mergeDefined(base: DrcRuleSet, override?: Partial<DrcRuleSet>): DrcRuleSet {
  if (!override) return base;
  const out: DrcRuleSet = { ...base };
  for (const [k, v] of Object.entries(override) as [keyof DrcRuleSet, number | undefined][]) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** Effective rule set for a net: default → class → per-net override. */
export function effectiveRules(rules: DrcRules, netId: number, netClass: NetClass): DrcRuleSet {
  const withClass = mergeDefined(rules.default, rules.perClass[netClass.id]);
  return mergeDefined(withClass, rules.perNet?.[netId]);
}

/** Largest clearance across default + every class + every per-net override —
 *  used once per DRC run to size the broad-phase R-tree inflation. */
export function maxClearance(rules: DrcRules): number {
  let max = rules.default.clearanceNm;
  for (const override of Object.values(rules.perClass)) {
    if (override?.clearanceNm !== undefined) max = Math.max(max, override.clearanceNm);
  }
  for (const override of Object.values(rules.perNet ?? {})) {
    if (override?.clearanceNm !== undefined) max = Math.max(max, override.clearanceNm);
  }
  return max;
}
