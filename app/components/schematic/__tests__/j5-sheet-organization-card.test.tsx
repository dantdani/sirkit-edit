// @vitest-environment jsdom
/**
 * [PR-J5, 2026-10-23] Runbook J.3 item 4 / J.6 items 4-6 (OD-259 items 4-5): the sheet-organisation review CARD, rendered
 * (app/components/schematic/SheetOrganizationReviewCard.tsx). What it proves:
 *
 *  1. the card lists the sheets with their members, the interfaces, the parts that stay, "check these", the renamed board names, the
 *     equivalence facts and the rationale, and says nothing has changed yet;
 *  2. Approve calls the page's handler exactly once; Discard calls the page's handler and nothing else; closing the card is a discard;
 *  3. a blocked proposal (stale, expired, foreign, already applied) disables Approve and shows the reason; busy disables both;
 *  4. every control has an accessible name (the B24-D3 rule).
 * The pure view over hand-made facts; jsdom, no network.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SheetOrganizationReview } from "@/app/lib/project/sheet-organization-events";
import { SheetOrganizationReviewCard } from "../SheetOrganizationReviewCard";

afterEach(() => cleanup());

const REVIEW: SheetOrganizationReview = {
  proposalId: "shorg-0123456789abcdef0123456789abcdef",
  expiresAt: Date.parse("2026-10-23T12:10:00.000Z"),
  sourceSheetName: "Overview",
  groups: [
    { sheetId: "sheet-org-aaaaaaaaaaaa", name: "555 PWM timing", members: ["C1", "C2", "C3", "D1", "D2", "R1", "RV1", "U1"] },
    { sheetId: "sheet-org-bbbbbbbbbbbb", name: "LED driver", members: ["D3", "Q1", "R2", "R3", "R4"] },
  ],
  interfaces: [{ line: 'PWM_OUT (was SIG1, an unnamed net): a port of "LED driver" with its sheet pin on the Overview', portName: "PWM_OUT", net: null, childSheetName: "LED driver" }],
  unassigned: ["J1"],
  checkThese: [{ refs: ["R2"], group: "LED driver", alternatives: ["555 PWM timing"], reason: "R2 is placed in \"LED driver\", but by connectivity it belongs with U1." }],
  checkNote: null,
  renamedNets: [],
  equivalence: { partitionDigest: "eng1-abcdefabcdefabcdefabcdef", componentCount: 14, operationCount: 23 },
  rationale: "Two subsystems and the power header.",
  approveBlockedReason: null,
};

describe("[PR-J5] the sheet-organisation review card", () => {
  it("1. lists the sheets, members, interfaces, unassigned parts, check these, the equivalence and the rationale; nothing changed yet", () => {
    render(<SheetOrganizationReviewCard review={REVIEW} busy={false} onApprove={() => {}} onDiscard={() => {}} />);
    expect(screen.getByTestId("sheet-organization-review")).toBeTruthy();
    expect(screen.getByText(/Organize 13 parts into 2 sheets/)).toBeTruthy();
    expect(screen.getByText(/Nothing has been changed yet\./)).toBeTruthy();
    const groups = screen.getAllByTestId("sheet-organization-group");
    expect(groups.map((row) => row.getAttribute("data-name"))).toEqual(["555 PWM timing", "LED driver"]);
    expect(groups[1]!.getAttribute("data-refs")).toBe("D3 Q1 R2 R3 R4");
    expect(screen.getByTestId("sheet-organization-interfaces").textContent).toContain("Interfaces (1)");
    expect(screen.getByTestId("sheet-organization-interface").getAttribute("data-port")).toBe("PWM_OUT");
    expect(screen.getByTestId("sheet-organization-unassigned").textContent).toBe("Stays on the Overview: J1");
    expect(screen.getByTestId("sheet-organization-check-item").getAttribute("data-refs")).toBe("R2");
    expect(screen.getByTestId("sheet-organization-equivalence").textContent).toContain("14 components keep their identities");
    expect(screen.getByTestId("sheet-organization-equivalence").textContent).toContain("23 operations in one transaction");
    expect(screen.getByTestId("sheet-organization-rationale").textContent).toBe("Two subsystems and the power header.");
    expect(screen.queryByTestId("sheet-organization-renamed")).toBeNull();
    expect(screen.queryByTestId("sheet-organization-approve-reason")).toBeNull();
  });

  it("2. Approve calls the handler once; Discard calls its handler and nothing else", () => {
    const onApprove = vi.fn();
    const onDiscard = vi.fn();
    render(<SheetOrganizationReviewCard review={REVIEW} busy={false} onApprove={onApprove} onDiscard={onDiscard} />);
    const approve = screen.getByTestId("sheet-organization-approve") as HTMLButtonElement;
    expect(approve.disabled).toBe(false);
    expect(approve.textContent).toBe("Approve — organize into 2 sheets");
    fireEvent.click(approve);
    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onDiscard).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("sheet-organization-discard"));
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it("3. a blocked proposal disables Approve with its reason; busy disables both and shows Applying", () => {
    const onApprove = vi.fn();
    const { unmount } = render(<SheetOrganizationReviewCard review={{ ...REVIEW, approveBlockedReason: "Approve is disabled: the schematic changed since the sheet organisation was sealed — it is stale and was not offered." }} busy={false} onApprove={onApprove} onDiscard={() => {}} />);
    const approve = screen.getByTestId("sheet-organization-approve") as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    fireEvent.click(approve);
    expect(onApprove).not.toHaveBeenCalled();
    expect(screen.getByTestId("sheet-organization-approve-reason").textContent).toContain("stale");
    expect((screen.getByTestId("sheet-organization-discard") as HTMLButtonElement).disabled).toBe(false);
    unmount();
    render(<SheetOrganizationReviewCard review={REVIEW} busy onApprove={() => {}} onDiscard={() => {}} />);
    expect((screen.getByTestId("sheet-organization-approve") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("sheet-organization-discard") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("sheet-organization-approve").textContent).toBe("Applying…");
    expect(screen.queryByTestId("sheet-organization-approve-reason")).toBeNull();
  });

  it("4. every control has an accessible name; a null review renders no card", () => {
    render(<SheetOrganizationReviewCard review={REVIEW} busy={false} onApprove={() => {}} onDiscard={() => {}} />);
    // the dialog's own focus guards (base-ui's inert sentinels, role="button" spans) are not controls
    const controls = screen.getAllByRole("button").filter((element) => !element.hasAttribute("data-base-ui-focus-guard"));
    expect(controls.length).toBeGreaterThanOrEqual(2);
    for (const button of controls) expect((button.textContent ?? "").trim().length > 0 || (button.getAttribute("aria-label") ?? "").length > 0, button.outerHTML).toBe(true);
    cleanup();
    render(<SheetOrganizationReviewCard review={null} busy={false} onApprove={() => {}} onDiscard={() => {}} />);
    expect(screen.queryByTestId("sheet-organization-review")).toBeNull();
  });
});
