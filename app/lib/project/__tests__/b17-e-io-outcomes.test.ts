/**
 * [B17-E] Every import/export path declares what it produces (canonical
 * state, an inert proposal, or a file artifact), what it validates, and how
 * the outcome is reported; an unavailable path names its precise blocker.
 * The declarations are pinned to registry records that exist.
 */
import { describe, expect, it } from "vitest";
import { ACTION_COVERAGE_REGISTRY } from "@/app/lib/engineering/action-registry";
import { describeExportRefusal, IO_OUTCOMES, ioOutcomesFor } from "../io-outcome";

describe("B17-E — import/export outcome declarations", () => {
  it("every declaration names an existing registry record, a direction and an outcome class; unavailable paths carry a precise blocker", () => {
    const ids = new Set(ACTION_COVERAGE_REGISTRY.map((record) => record.id));
    for (const declaration of IO_OUTCOMES) {
      expect(ids.has(declaration.recordId), declaration.recordId).toBe(true);
      expect(["canonical-state", "inert-proposal", "file-artifact"]).toContain(declaration.produces);
      expect(["import", "export"]).toContain(declaration.direction);
      expect(declaration.reportedAs.length).toBeGreaterThan(8);
      if (declaration.unavailable) expect(declaration.unavailable.length).toBeGreaterThan(20);
      if (declaration.direction === "import" && !declaration.unavailable) expect(declaration.validation).toBe("structural+semantic");
    }
    // Every import/export record (by id) and the explicit file paths have a declaration.
    const ioRecords = ACTION_COVERAGE_REGISTRY.filter((record) => /import|export/i.test(record.id) || ["project.open-file", "project.save-file", "manufacturing.release"].includes(record.id));
    expect(ioRecords.map((record) => record.id).sort()).toEqual(["manufacturing.export-engineering", "manufacturing.release", "pcb.autoroute-import", "pcb.export-kicad", "project.open-file", "project.save-file", "schematic.import-export-kicad"]);
    for (const record of ioRecords) expect(ioOutcomesFor(record.id).length, record.id).toBeGreaterThan(0);
    // The schematic KiCad import is declared unavailable with its blocker; the export is a file artifact.
    expect(ioOutcomesFor("schematic.import-export-kicad").map((item) => `${item.direction}:${item.produces}:${item.unavailable ? "unavailable" : "available"}`).sort()).toEqual(["export:file-artifact:available", "import:canonical-state:unavailable"]);
    expect(ioOutcomesFor("project.open-file")[0]).toMatchObject({ produces: "canonical-state", validation: "structural+semantic" });
    expect(ioOutcomesFor("pcb.autoroute-import")[0]).toMatchObject({ produces: "canonical-state" });
  });

  it("renders a structured export refusal for a person without leaking beyond the sanitized issues", () => {
    expect(describeExportRefusal(422, { ok: false, code: "SCHEMATIC_STATE_INVALID", error: "The schematic failed canonical identity/geometry validation and was not exported. Nothing was changed.", issues: ["duplicate reference R1", "wire w-3 has 1 vertex", "x", "y"], issueCount: 4 }))
      .toBe("SCHEMATIC_STATE_INVALID — The schematic failed canonical identity/geometry validation and was not exported. Nothing was changed. (4 issues: duplicate reference R1; wire w-3 has 1 vertex; x; …)");
    expect(describeExportRefusal(500, "<html>")).toBe("HTTP 500 — the export was refused; nothing was changed.");
    expect(describeExportRefusal(403, { error: "forbidden" })).toBe("HTTP 403 — forbidden");
  });
});
