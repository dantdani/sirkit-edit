/** @vitest-environment jsdom */

/**
 * [PR-C] The workflow strip renders a `JourneyView` as ten stage chips with their status as data and text, one real next-action
 * button that reports its action id, and - when disabled - the reason in the title and as visible text beside the button.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deriveJourney, JOURNEY_STAGES, type JourneyView } from "@/app/lib/workflow/journey";
import { JourneyStrip } from "../JourneyStrip";

afterEach(cleanup);

const QUALIFIED = { boardExists: true, syncing: false, unresolvedCount: 0, bindingReviewPending: 0, preflight: "ready_no_changes", applying: false, workflowState: "qualified", routingStale: false, drcCurrent: true, released: false } as const;

describe("[PR-C] JourneyStrip", () => {
  it("renders the ten stages as a labelled list with the status as a data attribute and as text, the current stage marked", () => {
    const view = deriveJourney({ hasSchematic: true, pcb: { ...QUALIFIED, routingStale: true } });
    render(<JourneyStrip view={view} onAction={() => {}} />);
    const list = screen.getByRole("list", { name: "Workflow stages" });
    expect(list.querySelectorAll("li")).toHaveLength(10);
    for (const id of JOURNEY_STAGES) {
      const chip = screen.getByTestId(`journey-stage-${id}`);
      const stage = view.stages.find((entry) => entry.id === id)!;
      expect(chip.getAttribute("data-status"), id).toBe(stage.status);
      expect(chip.textContent, id).toContain(stage.label);
    }
    expect(screen.getByTestId("journey-stage-requirements").getAttribute("data-status")).toBe("succeeded");
    expect(screen.getByTestId("journey-stage-routing").getAttribute("data-status")).toBe("partial");
    expect(screen.getByTestId("journey-stage-export").getAttribute("data-status")).toBe("awaiting_approval");
    // the status is text, never colour alone: the word is in the chip (visible for an open stage, visually hidden otherwise)
    expect(screen.getByTestId("journey-stage-routing").textContent).toContain("(partial)");
    expect(screen.getByTestId("journey-stage-export").textContent).toContain("(awaiting approval)");
    expect(screen.getByTestId("journey-stage-requirements").textContent).toContain("(done)");
    // the current stage (routing: stale) is the one marked, with its note
    expect(screen.getByTestId("journey-stage-routing").getAttribute("aria-current")).toBe("step");
    expect(screen.getByTestId("journey-stage-routing").textContent).toContain("re-route before releasing");
    expect(list.querySelectorAll("[aria-current='step']")).toHaveLength(1);
  });

  it("the next action is ONE real button that reports its action id; it is the only button in the strip", () => {
    const onAction = vi.fn();
    const view = deriveJourney({ hasSchematic: true, pcb: QUALIFIED });
    render(<JourneyStrip view={view} onAction={onAction} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    const button = screen.getByTestId("journey-next-action") as HTMLButtonElement;
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("type")).toBe("button");
    expect(button.textContent).toBe("Request release");
    expect(button.textContent).not.toMatch(/finish/i);
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith("request_release");
    expect(screen.queryByTestId("journey-next-action-reason")).toBeNull();
  });

  it("a disabled action carries its reason in the title and as visible text beside the button, and never fires", () => {
    const onAction = vi.fn();
    const view = deriveJourney({ hasSchematic: true, mode: "theory", pcb: { ...QUALIFIED, boardExists: false, preflight: "none", workflowState: null } });
    expect(view.nextAction).toMatchObject({ actionId: "prepare_pcb", enabled: false });
    render(<JourneyStrip view={view} onAction={onAction} />);
    const button = screen.getByTestId("journey-next-action") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("title")).toBe(view.nextAction!.reason);
    expect(screen.getByTestId("journey-next-action-reason").textContent).toBe(view.nextAction!.reason);
    fireEvent.click(button);
    expect(onAction).not.toHaveBeenCalled();
  });

  it("no next action (a running stage, or everything done) renders no button; compact mode keeps the status as hidden text", () => {
    const running = deriveJourney({ generating: true });
    expect(running.nextAction).toBeNull();
    const { unmount } = render(<JourneyStrip view={running} onAction={() => {}} compact />);
    expect(screen.queryByTestId("journey-next-action")).toBeNull();
    expect(screen.getByTestId("journey-stage-schematic_proposal").getAttribute("data-status")).toBe("running");
    expect(screen.getByTestId("journey-stage-schematic_proposal").textContent).toContain("(running)");
    unmount();
    const released: JourneyView = deriveJourney({ hasSchematic: true, pcb: { ...QUALIFIED, workflowState: "released", released: true } });
    render(<JourneyStrip view={released} onAction={() => {}} />);
    expect(screen.queryByRole("button")).toBeNull();
    for (const id of JOURNEY_STAGES) expect(screen.getByTestId(`journey-stage-${id}`).getAttribute("data-status"), id).toBe("succeeded");
  });
});
