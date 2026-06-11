/**
 * Maps a KiCad library file basename (e.g. "MCU_Espressif") to a single
 * user-facing top-level category (e.g. "Microcontrollers").
 *
 * Two layers: an explicit map for the most common libraries, then prefix-based
 * fallbacks so libraries we haven't enumerated still land somewhere sensible.
 * Anything unmatched becomes "Other".
 */

const MAIN_CATEGORY_MAP: Record<string, string> = {
  // Passives & power
  Device: "Passive Components",
  Switch: "Switches & Relays",
  Relay: "Switches & Relays",
  Battery: "Power Sources",
  Transformer: "Magnetics",
  Ferrite: "Passive Components",

  // Connectors
  Connector: "Connectors",
  Connector_Generic: "Connectors",
  Connector_USB: "Connectors",
  Connector_Audio: "Connectors",
  Connector_RF: "Connectors",

  // Microcontrollers
  MCU_ST_STM32F4: "Microcontrollers",
  MCU_ST_STM32F0: "Microcontrollers",
  MCU_Microchip_ATmega: "Microcontrollers",
  MCU_Microchip_ATtiny: "Microcontrollers",
  MCU_Microchip_PIC16: "Microcontrollers",
  MCU_Espressif: "Microcontrollers",
  MCU_Nordic: "Microcontrollers",
  MCU_RaspberryPi: "Microcontrollers",

  // Analog
  Amplifier_Operational: "Op-Amps",
  Amplifier_Audio: "Op-Amps",
  Comparator: "Comparators",
  Reference_Voltage: "Voltage References",

  // Power management
  Regulator_Linear: "Voltage Regulators",
  Regulator_Switching: "Voltage Regulators",
  Power_Management: "Power Management",
  Power_Protection: "Power Management",

  // Discretes
  Diode: "Diodes",
  Diode_Bridge: "Diodes",
  Diode_Laser: "Diodes",
  LED: "LEDs",
  Transistor_BJT: "Transistors",
  Transistor_FET: "Transistors",
  Transistor_IGBT: "Transistors",

  // Sensors
  Sensor: "Sensors",
  Sensor_Temperature: "Sensors",
  Sensor_Motion: "Sensors",
  Sensor_Humidity: "Sensors",
  Sensor_Current: "Sensors",
  Sensor_Optical: "Sensors",

  // Digital / interface / memory
  Logic_74xx: "Logic",
  Logic_74xgxx: "Logic",
  Logic_CMOS_4000: "Logic",
  Memory_Flash: "Memory",
  Memory_EEPROM: "Memory",
  Memory_RAM: "Memory",
  Interface_UART: "Interface ICs",
  Interface_USB: "Interface ICs",
  Interface_CAN_LIN: "Interface ICs",
  Driver_Motor: "Drivers",
  Driver_LED: "Drivers",
  Driver_FET: "Drivers",
  RF_Module: "RF / Wireless",
  RF_Bluetooth: "RF / Wireless",
  Timer: "Timers & Oscillators",
  Oscillator: "Timers & Oscillators",
};

const PREFIX_RULES: { prefix: string; category: string }[] = [
  { prefix: "MCU_", category: "Microcontrollers" },
  { prefix: "Sensor_", category: "Sensors" },
  { prefix: "Connector", category: "Connectors" },
  { prefix: "Regulator_", category: "Voltage Regulators" },
  { prefix: "Amplifier_", category: "Op-Amps" },
  { prefix: "Comparator", category: "Comparators" },
  { prefix: "Driver_", category: "Drivers" },
  { prefix: "RF_", category: "RF / Wireless" },
  { prefix: "Logic_", category: "Logic" },
  { prefix: "Memory_", category: "Memory" },
  { prefix: "Interface_", category: "Interface ICs" },
  { prefix: "FPGA_", category: "FPGAs" },
  { prefix: "CPLD_", category: "FPGAs" },
  { prefix: "DSP_", category: "Microcontrollers" },
  { prefix: "Diode", category: "Diodes" },
  { prefix: "Transistor_", category: "Transistors" },
  { prefix: "Power_", category: "Power Management" },
  { prefix: "Oscillator", category: "Timers & Oscillators" },
  { prefix: "Timer", category: "Timers & Oscillators" },
  { prefix: "Sensor", category: "Sensors" },
  { prefix: "Connector_", category: "Connectors" },
  { prefix: "4xxx", category: "Logic" },
  { prefix: "74", category: "Logic" },
];

/** Resolve a library basename to its user-facing main category. */
export function categorizeLib(libName: string): string {
  if (libName in MAIN_CATEGORY_MAP) return MAIN_CATEGORY_MAP[libName];
  for (const { prefix, category } of PREFIX_RULES) {
    if (libName.startsWith(prefix)) return category;
  }
  return "Other";
}
