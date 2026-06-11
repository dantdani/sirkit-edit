export type KeyBinding =
  | { action: "set-tool"; tool: string }
  | { action: "rotate"; direction: "cw" | "ccw" }
  | { action: "delete-selection" }
  | { action: "exit-tool-or-end-wire" };

export const DEFAULT_KEY_BINDINGS: Record<string, KeyBinding> = {
  "s":         { action: "set-tool", tool: "select" },
  "w":         { action: "set-tool", tool: "wire" },
  "x":         { action: "set-tool", tool: "delete" },
  "r":         { action: "set-tool", tool: "resistor" },
  "c":         { action: "set-tool", tool: "capacitor" },
  "l":         { action: "set-tool", tool: "inductor" },
  "d":         { action: "set-tool", tool: "diode" },
  "v":         { action: "set-tool", tool: "voltage-source" },
  "i":         { action: "set-tool", tool: "current-source" },
  "g":         { action: "set-tool", tool: "ground" },
  "ctrl+r":    { action: "rotate", direction: "cw" },
  "escape":    { action: "exit-tool-or-end-wire" },
  "delete":    { action: "delete-selection" },
  "backspace": { action: "delete-selection" },
};

let currentBindings: Record<string, KeyBinding> = { ...DEFAULT_KEY_BINDINGS };

export function setKeyBindings(custom: Partial<Record<string, KeyBinding>>): void {
  currentBindings = { ...DEFAULT_KEY_BINDINGS, ...custom } as Record<string, KeyBinding>;
}

export function getKeyBindings(): Record<string, KeyBinding> {
  return currentBindings;
}
