// @vitest-environment jsdom
/**
 * B16-C.3 — "another session published a newer revision" is its own dialog:
 * it names the expected and current revisions and offers Refresh / Rebase /
 * Not now as explicit acts. It is never shown without the server's conflict
 * details (malformed input and server failures keep their own messages).
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SnapshotConflictDialog } from "../SnapshotConflictDialog";
import type { PcbSyncSnapshotRevisionConflictDetails } from "@/app/lib/pcb-sync/types";

const CONFLICT: PcbSyncSnapshotRevisionConflictDetails = {
  kind: "snapshot_revision", expectedRevision: 2, currentRevision: 5,
  currentSnapshotDigest: "sha256:current-snapshot-digest-0123456789", currentSchematicRevision: "schematic:other-session", currentSchematicDigest: "sha256:other",
  attemptedSchematicRevision: "schematic:mine", attemptedSnapshotDigest: "sha256:mine-snapshot-digest-9876543210",
};

afterEach(() => cleanup());

describe("SnapshotConflictDialog (B16-C.3)", () => {
  it("names both revisions and offers refresh / rebase / not now", () => {
    const onRefresh = vi.fn(), onRebase = vi.fn(), onDismiss = vi.fn();
    render(<SnapshotConflictDialog conflict={CONFLICT} busy={false} onRefresh={onRefresh} onRebase={onRebase} onDismiss={onDismiss} />);
    expect(screen.getByTestId("snapshot-conflict-dialog").textContent).toContain("Another session published a newer schematic revision");
    expect(screen.getByTestId("snapshot-conflict-expected").textContent).toBe("revision 2");
    expect(screen.getByTestId("snapshot-conflict-current").textContent).toContain("revision 5");
    expect(screen.getByTestId("snapshot-conflict-current").textContent).toContain("schematic:other-se");
    fireEvent.click(screen.getByTestId("snapshot-conflict-refresh"));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("snapshot-conflict-rebase"));
    expect(onRebase).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("snapshot-conflict-dismiss"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("is closed without details and its actions are disabled while a sync is running", () => {
    const { rerender } = render(<SnapshotConflictDialog conflict={null} busy={false} onRefresh={() => {}} onRebase={() => {}} onDismiss={() => {}} />);
    expect(screen.queryByTestId("snapshot-conflict-dialog")).toBeNull();
    rerender(<SnapshotConflictDialog conflict={CONFLICT} busy={true} onRefresh={() => {}} onRebase={() => {}} onDismiss={() => {}} />);
    expect((screen.getByTestId("snapshot-conflict-rebase") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("snapshot-conflict-refresh") as HTMLButtonElement).disabled).toBe(true);
  });
});
