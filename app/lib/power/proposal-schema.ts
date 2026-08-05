export const POWER_PROPOSAL_TOOL_NAME = "submit_power_architecture_proposal";
export const POWER_PROPOSAL_SYSTEM_INSTRUCTIONS = `You are Sirkit's CD-3 power-architecture exploration assistant. Return exactly one typed abstract proposal through the required tool. Use only IDs present in the pinned problem. Allocate each demand exactly once. Do not invent requirements, source limits, evidence, component classes, part numbers, packages, values, net names, schematic recipes, or coordinates. Questions and assumptions are visible review items, never silent defaults. Selection remains human-only.`;

export const POWER_PROPOSAL_JSON_SCHEMA = {
  name: POWER_PROPOSAL_TOOL_NAME,
  schema: {
    type: "object", additionalProperties: false,
    required: ["schemaVersion", "proposalId", "problemDigest", "lineageId", "title", "summary", "patternIds", "railPartitions", "sequenceOwnership", "protectionStrategy", "assumptions", "questions"],
    properties: {
      schemaVersion: { const: "sirkit.power-proposal.v1" }, proposalId: { type: "string", minLength: 1, maxLength: 160 }, problemDigest: { type: "string", minLength: 1, maxLength: 160 }, lineageId: { type: "string", pattern: "^[a-z][a-z0-9_-]{0,63}$" }, title: { type: "string", minLength: 1, maxLength: 160 }, summary: { type: "string", minLength: 1, maxLength: 800 },
      patternIds: { type: "array", maxItems: 16, items: { type: "string", maxLength: 100 } },
      railPartitions: { type: "array", minItems: 1, maxItems: 64, items: { type: "object", additionalProperties: false, required: ["localId", "semanticRole", "sourceId", "demandIds", "returnRole", "startupClass"], properties: { localId: { type: "string", pattern: "^[a-z][a-z0-9_-]{0,63}$" }, semanticRole: { type: "string", minLength: 1, maxLength: 160 }, sourceId: { type: "string", minLength: 1, maxLength: 160 }, demandIds: { type: "array", minItems: 1, maxItems: 64, items: { type: "string", minLength: 1, maxLength: 160 } }, returnRole: { enum: ["circuit_return", "sensitive_reference_return", "power_switching_return", "isolated_return", "external_reference"] }, startupClass: { enum: ["always_on", "sequenced", "switched", "retained"] } } } },
      sequenceOwnership: { enum: ["hardware", "firmware", "mixed"] }, protectionStrategy: { enum: ["centralized", "distributed"] }, assumptions: { type: "array", maxItems: 32, items: { type: "string", maxLength: 300 } }, questions: { type: "array", maxItems: 32, items: { type: "string", maxLength: 300 } },
    },
  },
} as const;
