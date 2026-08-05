import type { MappingContext, MappingContextProvider, MappingVerificationRequest, PhysicalTerminalMappingCandidate } from "./types";

export class InMemoryMappingContextProvider implements MappingContextProvider {
  private readonly contexts = new Map<string, MappingContext>();
  private readonly candidates = new Map<string, PhysicalTerminalMappingCandidate>();
  constructor(input: { contexts?: MappingContext[]; candidates?: PhysicalTerminalMappingCandidate[] } = {}) { for (const context of input.contexts ?? []) this.setContext(context); for (const candidate of input.candidates ?? []) this.setCandidate(candidate); }
  setContext(context: MappingContext): void { this.contexts.set(context.contextId, structuredClone(context)); }
  setCandidate(candidate: PhysicalTerminalMappingCandidate): void { this.candidates.set(candidate.mappingCandidateId, structuredClone(candidate)); }
  async getContext(request: MappingVerificationRequest, signal?: AbortSignal): Promise<MappingContext> { if (signal?.aborted) throw new Error("MV_REQUEST_CANCELLED"); const context = this.contexts.get(request.contextId); if (!context) throw new Error("MV_CONTEXT_NOT_FOUND"); return structuredClone(context); }
  async getCandidate(request: MappingVerificationRequest, signal?: AbortSignal): Promise<PhysicalTerminalMappingCandidate> { if (signal?.aborted) throw new Error("MV_REQUEST_CANCELLED"); const candidate = this.candidates.get(request.mappingCandidateId); if (!candidate) throw new Error("MV_CANDIDATE_NOT_FOUND"); return structuredClone(candidate); }
}
