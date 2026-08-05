import type { PcbBoard } from "@/app/lib/pcb/types";
import type { ConstraintDefinition, ConstraintDocument } from "./types";
import { explainEffectiveRules } from "./explain";
import { previewConstraintTransaction } from "./transactions";

function containsNumericRequirement(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsNumericRequirement);
  const object = value as Record<string, unknown>;
  if (typeof object.dimension === "string" && typeof object.value === "string" && typeof object.unit === "string") return true;
  return Object.values(object).some(containsNumericRequirement);
}

/** Read/propose/preview only. Deliberately has no activation or waiver method. */
export class ConstraintAgentTools {
  constructor(private readonly board: PcbBoard, private readonly projectId: string) {}

  list(): ConstraintDocument[] {
    return structuredClone(this.board.constraintState?.documents ?? []);
  }

  explain(targetId: string) {
    const program = this.board.constraintState?.activeProgram;
    return program ? explainEffectiveRules(program, targetId) : null;
  }

  propose(input: {
    sourceDocumentId: string;
    sourceRevision: string;
    requirementTextRef: string;
    constraints: ConstraintDefinition[];
  }): { documents: ConstraintDocument[]; preview: ReturnType<typeof previewConstraintTransaction> } {
    if (!input.requirementTextRef.trim()) throw new Error("AI proposals require a user requirement or evidence text reference.");
    const proposed = input.constraints.map((constraint) => {
      if (containsNumericRequirement(constraint.requirement) && constraint.evidenceIds.length === 0 && !input.requirementTextRef.startsWith("user:")) {
        throw new Error(`Numeric constraint ${constraint.id} has no evidence or explicit user requirement source.`);
      }
      return {
        ...constraint,
        origin: {
          kind: "ai_proposal" as const,
          sourceId: input.requirementTextRef,
          sourceRevision: input.sourceRevision,
          actorId: "agent:proposal",
          reviewState: "proposed" as const,
        },
        lifecycle: { ...constraint.lifecycle, state: "draft" as const },
      };
    });
    const candidate: ConstraintDocument = {
      schemaVersion: 1,
      id: input.sourceDocumentId,
      revision: 1,
      name: "AI-proposed constraint patch",
      description: `Provenance: ${input.requirementTextRef}. Human approval is required before lifecycle activation.`,
      extendsSetIds: [],
      constraints: proposed,
      relationships: [],
    };
    const documents = [...(this.board.constraintState?.documents ?? []).filter((document) => document.id !== candidate.id), candidate];
    return { documents, preview: previewConstraintTransaction({ board: this.board, projectId: this.projectId, documents }) };
  }
}

