import { describe, expect, it } from "vitest";
import { SchematicHistory } from "../schematic-history";

type Snap = { components: string[]; wires: string[] };
const snap = (label: string): Snap => ({ components: [label], wires: [] });

describe("SchematicHistory (R06 Section 7)", () => {
  it("records, undoes, and redoes exact model states", () => {
    const initial = snap("initial");
    const history = new SchematicHistory<Snap>(initial);
    const first = snap("first");
    const second = snap("second");
    history.record("Added component", first);
    history.record("Moved component", second);

    expect(history.view().canUndo).toBe(true);
    expect(history.undo()).toBe(first);
    expect(history.undo()).toBe(initial);
    expect(history.undo()).toBeNull();
    expect(history.redo()).toBe(first);
    expect(history.redo()).toBe(second);
    expect(history.redo()).toBeNull();
  });

  it("a new operation after undo starts a new branch (future cleared)", () => {
    const history = new SchematicHistory<Snap>(snap("a"));
    history.record("b", snap("b"));
    history.record("c", snap("c"));
    history.undo(); // back to b
    const fork = snap("d");
    history.record("d", fork);
    expect(history.view().canRedo).toBe(false);
    expect(history.undo()).toEqual(snap("b"));
    expect(history.redo()).toBe(fork); // redo now follows the new branch
  });

  it("identity-equal states do not create empty history entries", () => {
    const only = snap("only");
    const history = new SchematicHistory<Snap>(only);
    history.record("noop", only);
    expect(history.view().canUndo).toBe(false);
  });

  it("reset clears both stacks (hydration is not undoable)", () => {
    const history = new SchematicHistory<Snap>(snap("a"));
    history.record("b", snap("b"));
    history.reset(snap("loaded"), "Opened project");
    expect(history.view().canUndo).toBe(false);
    expect(history.view().canRedo).toBe(false);
    expect(history.present).toEqual(snap("loaded"));
  });

  it("evicts oldest entries past the limit without corrupting order", () => {
    const history = new SchematicHistory<Snap>(snap("0"), { limit: 3 });
    for (let index = 1; index <= 6; index++) history.record(`op${index}`, snap(String(index)));
    let undos = 0;
    while (history.undo()) undos++;
    expect(undos).toBe(3);
    expect(history.present).toEqual(snap("3"));
  });

  it("labels are visible in the view for tooltips and history lists", () => {
    const history = new SchematicHistory<Snap>(snap("a"));
    history.record("Generated schematic", snap("b"));
    const view = history.view();
    expect(view.undoLabel).toBe("Generated schematic");
    expect(view.entries.map((entry) => entry.label)).toEqual(["Opened project", "Generated schematic"]);
  });
});
