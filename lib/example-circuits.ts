import type { SchematicState, LogicalNetlist } from "./schematic-types";
import { autoLayout } from "./auto-layout";

export type ExampleCircuit = {
  id: string;
  name: string;
  description: string;
  category: "basics" | "filters" | "amplifiers" | "power" | "oscillators";
  state: SchematicState;
};

// ─── Helper ───────────────────────────────────────────────────────────────────

function fromNetlist(
  components: LogicalNetlist["components"],
  connections: LogicalNetlist["connections"],
): SchematicState {
  return autoLayout({ components, connections, explanation: "" });
}

// ─── Library ──────────────────────────────────────────────────────────────────

export const EXAMPLE_CIRCUITS: ExampleCircuit[] = [

  // ── Basics ──────────────────────────────────────────────────────────────────

  {
    id: "led-9v",
    name: "LED Circuit",
    description: "9V battery → 470 Ω current-limiting resistor → red LED → ground",
    category: "basics",
    state: fromNetlist(
      [
        { id: "V1",   type: "voltage-source", value: "9V"      },
        { id: "R1",   type: "resistor",       value: "470"     },
        { id: "LED1", type: "diode",          value: "Red LED" },
        { id: "GND1", type: "ground",         value: ""        },
      ],
      [
        { from: "V1.+",         to: "R1.left"    },
        { from: "R1.right",     to: "LED1.anode" },
        { from: "LED1.cathode", to: "GND1.pin"   },
        { from: "V1.-",         to: "GND1.pin"   },
      ],
    ),
  },

  {
    id: "voltage-divider",
    name: "Voltage Divider",
    description: "Two 10 kΩ resistors divide 9 V to 4.5 V at the midpoint",
    category: "basics",
    state: fromNetlist(
      [
        { id: "V1",   type: "voltage-source", value: "9V"  },
        { id: "R1",   type: "resistor",       value: "10k" },
        { id: "R2",   type: "resistor",       value: "10k" },
        { id: "GND1", type: "ground",         value: ""    },
      ],
      [
        { from: "V1.+",     to: "R1.left"  },
        { from: "R1.right", to: "R2.left"  },
        { from: "R2.right", to: "GND1.pin" },
        { from: "V1.-",     to: "GND1.pin" },
      ],
    ),
  },

  {
    id: "bypass-capacitor",
    name: "Bypass Capacitor",
    description: "100 nF decoupling capacitor placed across a 5 V power supply rail",
    category: "basics",
    state: fromNetlist(
      [
        { id: "V1",   type: "voltage-source", value: "5V"   },
        { id: "C1",   type: "capacitor",      value: "100n" },
        { id: "GND1", type: "ground",         value: ""     },
      ],
      [
        { from: "V1.+",    to: "C1.left"   },
        { from: "C1.right", to: "GND1.pin" },
        { from: "V1.-",    to: "GND1.pin"  },
      ],
    ),
  },

  // ── Filters ─────────────────────────────────────────────────────────────────

  {
    id: "rc-lowpass-1k",
    name: "RC Low-Pass Filter",
    description: "10 kΩ series + 16 nF shunt → ~1 kHz cutoff; passes DC, attenuates HF",
    category: "filters",
    state: fromNetlist(
      [
        { id: "V1",   type: "voltage-source", value: "1V"  },
        { id: "R1",   type: "resistor",       value: "10k" },
        { id: "C1",   type: "capacitor",      value: "16n" },
        { id: "GND1", type: "ground",         value: ""    },
      ],
      [
        { from: "V1.+",     to: "R1.left"   },
        { from: "R1.right", to: "C1.left"   },
        { from: "C1.right", to: "GND1.pin"  },
        { from: "V1.-",     to: "GND1.pin"  },
      ],
    ),
  },

  {
    id: "rc-highpass-1k",
    name: "RC High-Pass Filter",
    description: "16 nF series cap + 10 kΩ shunt → ~1 kHz cutoff; blocks DC, passes HF",
    category: "filters",
    state: fromNetlist(
      [
        { id: "V1",   type: "voltage-source", value: "1V"  },
        { id: "C1",   type: "capacitor",      value: "16n" },
        { id: "R1",   type: "resistor",       value: "10k" },
        { id: "GND1", type: "ground",         value: ""    },
      ],
      [
        { from: "V1.+",     to: "C1.left"   },
        { from: "C1.right", to: "R1.left"   },
        { from: "R1.right", to: "GND1.pin"  },
        { from: "V1.-",     to: "GND1.pin"  },
      ],
    ),
  },

  {
    id: "series-rlc",
    name: "Series RLC Circuit",
    description: "12 mH + 530 nF + 15 Ω in series — resonant at ~633 Hz",
    category: "filters",
    state: fromNetlist(
      [
        { id: "V1",   type: "voltage-source", value: "1V"   },
        { id: "L1",   type: "inductor",       value: "12m"  },
        { id: "C1",   type: "capacitor",      value: "530n" },
        { id: "R1",   type: "resistor",       value: "15"   },
        { id: "GND1", type: "ground",         value: ""     },
      ],
      [
        { from: "V1.+",     to: "L1.left"   },
        { from: "L1.right", to: "C1.left"   },
        { from: "C1.right", to: "R1.left"   },
        { from: "R1.right", to: "GND1.pin"  },
        { from: "V1.-",     to: "GND1.pin"  },
      ],
    ),
  },

  {
    id: "rl-lowpass",
    name: "RL Low-Pass Filter",
    description: "10 Ω series resistor + 16 mH shunt inductor → ~100 Hz cutoff",
    category: "filters",
    state: fromNetlist(
      [
        { id: "V1",   type: "voltage-source", value: "1V"   },
        { id: "R1",   type: "resistor",       value: "10"   },
        { id: "L1",   type: "inductor",       value: "16m"  },
        { id: "GND1", type: "ground",         value: ""     },
      ],
      [
        { from: "V1.+",     to: "R1.left"   },
        { from: "R1.right", to: "L1.left"   },
        { from: "L1.right", to: "GND1.pin"  },
        { from: "V1.-",     to: "GND1.pin"  },
      ],
    ),
  },

  // ── Power ────────────────────────────────────────────────────────────────────

  {
    id: "half-wave-rectifier",
    name: "Half-Wave Rectifier",
    description: "Single diode clips the negative half-cycle of AC; 1 kΩ load to ground",
    category: "power",
    state: fromNetlist(
      [
        { id: "V1",   type: "voltage-source", value: "1V AC"  },
        { id: "D1",   type: "diode",          value: "1N4007" },
        { id: "R1",   type: "resistor",       value: "1k"     },
        { id: "GND1", type: "ground",         value: ""       },
      ],
      [
        { from: "V1.+",      to: "D1.anode"   },
        { from: "D1.cathode", to: "R1.left"   },
        { from: "R1.right",  to: "GND1.pin"   },
        { from: "V1.-",      to: "GND1.pin"   },
      ],
    ),
  },

  {
    id: "zener-regulator",
    name: "Zener Voltage Regulator",
    description: "470 Ω series resistor + 5.1 V zener clamps output to a regulated 5.1 V",
    category: "power",
    state: fromNetlist(
      [
        { id: "V1",   type: "voltage-source", value: "9V"          },
        { id: "R1",   type: "resistor",       value: "470"         },
        { id: "D1",   type: "diode",          value: "1N4733 5.1V" },
        { id: "GND1", type: "ground",         value: ""            },
      ],
      [
        { from: "V1.+",      to: "R1.left"    },
        { from: "R1.right",  to: "D1.cathode" },
        { from: "D1.anode",  to: "GND1.pin"   },
        { from: "V1.-",      to: "GND1.pin"   },
      ],
    ),
  },

  {
    id: "current-source-load",
    name: "Current Source with Resistive Load",
    description: "20 mA current source driving a 1 kΩ load; voltage across load = 20 V",
    category: "basics",
    state: fromNetlist(
      [
        { id: "I1",   type: "current-source", value: "20m" },
        { id: "R1",   type: "resistor",       value: "1k"  },
        { id: "GND1", type: "ground",         value: ""    },
      ],
      [
        { from: "I1.+",     to: "R1.left"   },
        { from: "R1.right", to: "GND1.pin"  },
        { from: "I1.-",     to: "GND1.pin"  },
      ],
    ),
  },

  {
    id: "lc-tank",
    name: "LC Tank Circuit",
    description: "Parallel LC resonator — inductor and capacitor exchange energy at resonance",
    category: "oscillators",
    state: fromNetlist(
      [
        { id: "V1",   type: "voltage-source", value: "1V"   },
        { id: "L1",   type: "inductor",       value: "1m"   },
        { id: "C1",   type: "capacitor",      value: "100n" },
        { id: "GND1", type: "ground",         value: ""     },
        { id: "GND2", type: "ground",         value: ""     },
      ],
      [
        { from: "V1.+",     to: "L1.left"   },
        { from: "V1.+",     to: "C1.left"   },
        { from: "L1.right", to: "GND1.pin"  },
        { from: "C1.right", to: "GND2.pin"  },
        { from: "V1.-",     to: "GND1.pin"  },
      ],
    ),
  },

];

// ─── Query helpers ────────────────────────────────────────────────────────────

export function getExampleById(id: string): ExampleCircuit | null {
  return EXAMPLE_CIRCUITS.find((e) => e.id === id) ?? null;
}

export function getExamplesByCategory(
  category: ExampleCircuit["category"],
): ExampleCircuit[] {
  return EXAMPLE_CIRCUITS.filter((e) => e.category === category);
}

export function getAllCategories(): ExampleCircuit["category"][] {
  const seen = new Set<ExampleCircuit["category"]>();
  const result: ExampleCircuit["category"][] = [];
  for (const e of EXAMPLE_CIRCUITS) {
    if (!seen.has(e.category)) {
      seen.add(e.category);
      result.push(e.category);
    }
  }
  return result;
}
