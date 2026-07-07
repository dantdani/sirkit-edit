// Stub for the PCB undo/redo history stack.
// TODO(Stage 5): the immer-based history stack lands here — full entry types
// (patches, inverse patches, coalescing) replace this stub. This file exists
// now so Stages 3/5 can reference the module path without inventing their own.

export interface HistoryEntry {
  label: string;
}
