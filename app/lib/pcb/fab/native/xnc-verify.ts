import { stableJson } from "./stable";
import type { DrillGroup } from "./drill";
import type { ParsedXnc } from "./xnc-parser";
import type { FabDiagnostic } from "./types";

function expected(group: DrillGroup): string[] {
  return group.drills.map((drill) =>
    drill.kind === "hit"
      ? `hit|${stableJson(drill.at)}|${Math.round(drill.diameterNm)}`
      : `slot|${stableJson(drill.start)}|${stableJson(drill.end)}|${Math.round(drill.diameterNm)}`,
  ).sort();
}

function actual(parsed: ParsedXnc): string[] {
  return parsed.objects.map((object) =>
    object.kind === "hit"
      ? `hit|${stableJson(object.at)}|${object.diameterNm}`
      : `slot|${stableJson(object.start)}|${stableJson(object.end)}|${object.diameterNm}`,
  ).sort();
}

export function verifyXnc(group: DrillGroup, parsed: ParsedXnc, file: string): FabDiagnostic[] {
  const diagnostics: FabDiagnostic[] = parsed.errors.map((message) => ({
    code: "XNC_PARSE_ERROR",
    severity: "error",
    category: "format",
    message,
    file,
  }));
  if (parsed.fileFunction !== group.fileFunction) {
    diagnostics.push({
      code: "XNC_FILE_FUNCTION_MISMATCH",
      severity: "error",
      category: "equivalence",
      message: `${file} identifies ${parsed.fileFunction ?? "no function"}; expected ${group.fileFunction}.`,
      file,
    });
  }
  if (stableJson(actual(parsed)) !== stableJson(expected(group))) {
    diagnostics.push({
      code: "XNC_GEOMETRY_MISMATCH",
      severity: "error",
      category: "equivalence",
      message: `${file} drill/slot geometry differs from the manufacturing IR.`,
      file,
    });
  }
  return diagnostics;
}
