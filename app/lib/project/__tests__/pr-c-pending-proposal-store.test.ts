// @vitest-environment jsdom
/**
 * [PR-C] The pending schematic proposal survives a reload only against the same authoritative base (checkpoint C,
 * "Artifact and state progression": reload must not lose a proposal, and must never re-offer a stale one). The store is
 * pure browser state; the page restores it only when the live digest equals `baseDigest` (pinned by source below).
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import type { SchematicState } from "@/lib/schematic-types";
import { clearPendingProposal, loadPendingProposal, PENDING_PROPOSAL_MAX_CHARS, savePendingProposal } from "../pending-proposal-store";

const state: SchematicState = { components: [], wires: [], kicadComponents: [{ id: "k1", partId: "p1", x: 0, y: 0, rotation: 0, refDes: "U1", value: "NE555" }], netLabels: [] };
const record = { projectId: "project-a", baseDigest: "sha256:base", state, explanation: "A blinker.", prompt: "make a blinker", validationNote: null };

afterEach(() => window.localStorage.clear());

describe("pending proposal store", () => {
  it("round-trips per project and clears", () => {
    expect(savePendingProposal(record)).toBe(true);
    expect(loadPendingProposal("project-a")).toMatchObject({ ...record, version: 1 });
    expect(loadPendingProposal("project-b")).toBeNull();
    clearPendingProposal("project-a");
    expect(loadPendingProposal("project-a")).toBeNull();
  });

  it("a malformed or foreign record is removed, never offered", () => {
    window.localStorage.setItem("sirkit:pending-proposal:project-a", JSON.stringify({ version: 1, projectId: "project-b", baseDigest: "x", state, explanation: "", prompt: "", validationNote: null, savedAt: "t" }));
    expect(loadPendingProposal("project-a")).toBeNull();
    expect(window.localStorage.getItem("sirkit:pending-proposal:project-a")).toBeNull();
    window.localStorage.setItem("sirkit:pending-proposal:project-a", "{not json");
    expect(loadPendingProposal("project-a")).toBeNull();
    expect(window.localStorage.getItem("sirkit:pending-proposal:project-a")).toBeNull();
  });

  it("an oversized proposal is not persisted (it stays in memory only) and reports so", () => {
    const huge = { ...record, explanation: "x".repeat(PENDING_PROPOSAL_MAX_CHARS) };
    expect(savePendingProposal(huge)).toBe(false);
    expect(loadPendingProposal("project-a")).toBeNull();
  });

  it("the page saves a pinned proposal, restores it only against the same base digest, and clears it on approval or discard (source pins)", () => {
    const page = readFileSync("app/page.tsx", "utf8");
    expect(page).toMatch(/savePendingProposal\(\{ projectId: project\.id, baseDigest: proposalContentDigest\(/); // the CONTENT digest: the sheet size a first save adds must not read as a change
    expect(page).toMatch(/clearPendingProposal\(persistedProposalRef\.current\.projectId\)/); // only the record this mount wrote: a fresh mount never clears before the restore
    expect(page).toMatch(/restorePendingProposalRef\.current\(record\.id\)/); // restored once the opened session reports ready
    expect(page).toMatch(/proposalContentDigest\(gestureCoordinatorRef\.current!\.authoritativeState\(\)\) !== stored\.baseDigest/);
    expect(page).toMatch(/Restored after a reload/);
  });
});
