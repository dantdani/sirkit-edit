// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { compileRequirementsPackage } from "@/app/lib/requirements/compiler";
import { compileInput } from "@/app/lib/requirements/__tests__/fixtures";
import { RequirementsWorkspace } from "../RequirementsWorkspace";

describe("CD-1 requirements workspace status clarity", () => {
  it("shows confirmation, support, blockers, and evidence as separate axes", () => {
    const compiled = compileRequirementsPackage(compileInput()); if (!compiled.ok) throw new Error("compile failed");
    render(<RequirementsWorkspace value={compiled.package} />);
    expect(screen.getByText("Confirmed")).toBeTruthy();
    expect(screen.getByText("Unsupported")).toBeTruthy();
    expect(screen.getByText("Blocking")).toBeTruthy();
    expect(screen.getByText("Evidence passed")).toBeTruthy();
    expect(screen.getByText("0 (planned only)")).toBeTruthy();
  });
});
