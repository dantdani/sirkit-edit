// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createArchitectureProjectState } from "@/app/lib/architecture/project";
import { architectureCandidate, architectureProblem } from "@/app/lib/architecture/__tests__/fixtures";
import { ArchitectureWorkspace } from "../ArchitectureWorkspace";

afterEach(cleanup);

describe("CD-2 architecture workspace", () => {
  it("shows problem revision, candidate status, coverage, feasibility, and raw metrics separately", () => { const problem = architectureProblem(); const candidate = architectureCandidate(problem); const state = createArchitectureProjectState({ projectId: problem.projectId, branchId: problem.branchId, problem, candidates: [candidate], comparisons: [], selection: null }); render(<ArchitectureWorkspace value={state} />); expect(screen.getByText("CD-02 Functional Architecture")).toBeTruthy(); expect(screen.getByText("Requirement coverage")).toBeTruthy(); expect(screen.getByText("Feasibility and uncertainty")).toBeTruthy(); expect(screen.getByText("Raw decision metrics")).toBeTruthy(); expect(screen.getAllByText("Unknown").length).toBeGreaterThan(0); });
  it("does not enable approval without an authorized selection callback", () => { const problem = architectureProblem(); const state = createArchitectureProjectState({ projectId: problem.projectId, branchId: problem.branchId, problem, candidates: [architectureCandidate(problem)], comparisons: [], selection: null }); render(<ArchitectureWorkspace value={state} />); expect(screen.getByRole("button", { name: "Approve this architecture" })).toHaveProperty("disabled", true); });
});
