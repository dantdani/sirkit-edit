// DrcRules → KiCad (setup ...) block (PCB Stage 13).
//
// Only the four rules KiCad understands natively are translated (pinned):
// clearance, min track width, min via outer, min via drill. They ride the
// legacy setup tokens (trace_clearance / trace_min / via_min_size /
// via_min_drill) — KiCad 6+ keeps design rules in the project file, but its
// board parser still accepts these v5-era tokens and imports them into the
// board design settings on open.

import type { DrcRules } from "../drc/types";
import { block, sexpr } from "./sexpr-emit";
import { nmToMm } from "./units";

export function emitSetup(rules: DrcRules): string {
  return block("setup", [
    sexpr("pad_to_mask_clearance", 0),
    sexpr("trace_clearance", nmToMm(rules.default.clearanceNm)),
    sexpr("trace_min", nmToMm(rules.default.minTrackWidthNm)),
    sexpr("via_min_size", nmToMm(rules.default.minViaOuterNm)),
    sexpr("via_min_drill", nmToMm(rules.default.minViaDrillNm)),
  ]);
}
