/**
 * useSelection (PCB Stage 17) — thin React adapter over the global
 * SelectionStore (plain observable, see app/lib/pcb/selection.ts). The store
 * stays the single source of truth; React just re-renders on change.
 */

import { useSyncExternalStore } from "react";
import type { SelectionStore, SelectionSet } from "@/app/lib/pcb/selection";

export function useSelection(store: SelectionStore): SelectionSet {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
