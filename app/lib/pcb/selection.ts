/**
 * Global selection store (PCB Stage 17) — plain observable store, history-
 * style (no zustand, no React): the select-move tool writes it synchronously,
 * the scene and the inspector subscribe. Holds `SelectionRef`s so copper
 * items, pads and text are first-class selection citizens, not just
 * footprints.
 *
 * Refs are insertion-ordered and deduped by `refKey`; `primary` is the last
 * clicked/added ref (the inspector's identity row and zoom-to target).
 */

import type { SelectionRef } from "./edit/commands";
import { refKey } from "./edit/commands";

export interface SelectionSet {
  refs: SelectionRef[];
  primary?: SelectionRef;
}

export interface SelectionStore {
  get(): SelectionSet;
  /** Replace the whole selection; `primary` defaults to the last ref. */
  replace(refs: SelectionRef[], primary?: SelectionRef): void;
  /** Add (dedup) — added refs become primary. */
  add(refs: SelectionRef | SelectionRef[]): void;
  /** Shift-click semantics: in → out, out → in (and becomes primary). */
  toggle(ref: SelectionRef): void;
  remove(refs: SelectionRef[]): void;
  clear(): void;
  /** Fires after every change. Returns unsubscribe. */
  subscribe(cb: (s: SelectionSet) => void): () => void;
}

function dedupe(refs: SelectionRef[]): SelectionRef[] {
  const seen = new Set<string>();
  const out: SelectionRef[] = [];
  for (const ref of refs) {
    const key = refKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}

export function createSelectionStore(): SelectionStore {
  let current: SelectionSet = { refs: [] };
  const subscribers = new Set<(s: SelectionSet) => void>();

  function set(next: SelectionSet): void {
    current = next;
    for (const cb of subscribers) cb(current);
  }

  return {
    get(): SelectionSet {
      return current;
    },

    replace(refs: SelectionRef[], primary?: SelectionRef): void {
      const deduped = dedupe(refs);
      set({
        refs: deduped,
        primary: primary ?? (deduped.length > 0 ? deduped[deduped.length - 1] : undefined),
      });
    },

    add(refs: SelectionRef | SelectionRef[]): void {
      const list = Array.isArray(refs) ? refs : [refs];
      if (list.length === 0) return;
      const merged = dedupe([...current.refs, ...list]);
      set({ refs: merged, primary: list[list.length - 1] });
    },

    toggle(ref: SelectionRef): void {
      const key = refKey(ref);
      if (current.refs.some((r) => refKey(r) === key)) {
        const refs = current.refs.filter((r) => refKey(r) !== key);
        const primary =
          current.primary && refKey(current.primary) === key
            ? refs[refs.length - 1]
            : current.primary;
        set({ refs, primary });
      } else {
        set({ refs: [...current.refs, ref], primary: ref });
      }
    },

    remove(refs: SelectionRef[]): void {
      if (refs.length === 0) return;
      const gone = new Set(refs.map(refKey));
      const kept = current.refs.filter((r) => !gone.has(refKey(r)));
      if (kept.length === current.refs.length) return;
      const primary =
        current.primary && gone.has(refKey(current.primary))
          ? kept[kept.length - 1]
          : current.primary;
      set({ refs: kept, primary });
    },

    clear(): void {
      if (current.refs.length === 0 && current.primary === undefined) return;
      set({ refs: [] });
    },

    subscribe(cb: (s: SelectionSet) => void): () => void {
      subscribers.add(cb);
      return () => {
        subscribers.delete(cb);
      };
    },
  };
}
