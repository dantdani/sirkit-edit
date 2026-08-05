// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { saveProjectPcbRelease } from "@/lib/persistence";
import { createEmptyBoard } from "../types";
import { pcbRevisionId } from "../revision";
import type { ManufacturingReleaseManifest } from "../readiness/types";

const projectId = "release-history-project";

function manifest(transactionId: string): ManufacturingReleaseManifest {
  return {
    schemaVersion: "sirkit.manufacturing-release.v1",
    transactionId,
    projectIdentity: projectId,
    disposition: "verified_manufacturing_release",
    verified: true,
    designRevision: "pcb2-release",
    claim: "PCB_FABRICATION_CHECKS",
    readinessState: "ready",
    readinessReportId: "ready1-release",
    policyVersion: "pcb-fabrication-checks/1.0.0",
    checkVersions: [],
    manufacturingProfile: { id: "jlcpcb-2l", version: 1 },
    exporterVersion: "kicad-assisted/1",
    generatedAt: "2026-07-17T00:00:00.000Z",
    warnings: [],
    waiverIds: [],
    artifacts: [{ path: "board.GTL", kind: "gerber", bytes: 4, sha256: "abcd" }],
  };
}

beforeEach(() => {
  localStorage.clear();
  const board = createEmptyBoard();
  localStorage.setItem(`sirkit:project:${projectId}`, JSON.stringify({
    id: projectId,
    name: "Release history",
    state: { components: [], wires: [] },
    pcb: board,
    createdAt: 1,
    updatedAt: 1,
  }));
});

describe("manufacturing release persistence", () => {
  it("stores historical evidence without changing the PCB semantic revision", () => {
    const before = JSON.parse(localStorage.getItem(`sirkit:project:${projectId}`)!) as { pcb: ReturnType<typeof createEmptyBoard> };
    const revision = pcbRevisionId(before.pcb);
    expect(saveProjectPcbRelease(projectId, manifest("release-1"))).toBe(true);
    expect(saveProjectPcbRelease(projectId, manifest("release-1"))).toBe(true);
    const after = JSON.parse(localStorage.getItem(`sirkit:project:${projectId}`)!) as {
      pcb: ReturnType<typeof createEmptyBoard>;
      pcbReleases: ManufacturingReleaseManifest[];
    };
    expect(after.pcbReleases).toEqual([manifest("release-1")]);
    expect(pcbRevisionId(after.pcb)).toBe(revision);
  });
});
