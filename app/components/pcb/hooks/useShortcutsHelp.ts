/**
 * useShortcutsHelp (PCB Stage 16): `?` opens the cheat sheet anywhere in the
 * PCB module (except while typing in a field); Esc closes. Exposes open state
 * so PcbEditor can gate global shortcuts while ANY modal is up.
 */

import { useEffect, useRef, useState } from "react";

export interface ShortcutsHelpHandle {
  open: boolean;
  show(): void;
  hide(): void;
}

export function useShortcutsHelp(isBlocked?: () => boolean): ShortcutsHelpHandle {
  const [open, setOpen] = useState(false);
  const blockedRef = useRef(isBlocked);
  useEffect(() => {
    blockedRef.current = isBlocked;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target;
      const editable =
        t instanceof HTMLElement &&
        (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if (editable) return;
      if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (blockedRef.current?.()) return; // another modal owns the screen
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return { open, show: () => setOpen(true), hide: () => setOpen(false) };
}
