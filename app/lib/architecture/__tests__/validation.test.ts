import { describe, expect, it } from "vitest";
import { architectureProposal, architectureProblem } from "./fixtures";
import { validateArchitectureProposal } from "../validation";

function codes(mutate: (value: ReturnType<typeof architectureProposal>) => void): string[] { const problem = architectureProblem(); const proposal = architectureProposal(problem); mutate(proposal); return validateArchitectureProposal(proposal, problem).map((item) => item.code); }

describe("CD-2 strict proposal and graph validation", () => {
  it("accepts the deterministic seed proposal", () => { const problem = architectureProblem(); expect(validateArchitectureProposal(architectureProposal(problem), problem)).toEqual([]); });
  it("rejects unknown top-level fields", () => { expect(codes((item) => Object.assign(item, { surprise: true }))).toContain("PROPOSAL_UNKNOWN_FIELDS"); });
  it("rejects unknown nested fields", () => { expect(codes((item) => Object.assign(item.blocks[0], { x: 10 }))).toContain("PROPOSAL_ITEM_UNKNOWN_FIELDS"); });
  it("rejects concrete part identifiers", () => { expect(codes((item) => { item.blocks[0].description = "Use STM32 controller"; })).toContain("PROPOSAL_CONCRETE_IMPLEMENTATION_FORBIDDEN"); });
  it("rejects multiple roots", () => { expect(codes((item) => { item.blocks[1].parentLocalId = null; })).toContain("ARCHITECTURE_ROOT_CARDINALITY"); });
  it("rejects hierarchy cycles", () => { expect(codes((item) => { item.blocks[0].parentLocalId = item.blocks[1].localId; })).toContain("BLOCK_HIERARCHY_CYCLE"); });
  it("rejects a missing block parent", () => { expect(codes((item) => { item.blocks[1].parentLocalId = "block_missing"; })).toContain("BLOCK_PARENT_NOT_FOUND"); });
  it("rejects a port with no owning block", () => { expect(codes((item) => { item.ports[0].blockLocalId = "block_missing"; })).toContain("PORT_BLOCK_NOT_FOUND"); });
  it("rejects producer direction inversion", () => { expect(codes((item) => { item.ports.find((port) => port.localId === item.flows[0].producerPortLocalId)!.direction = "input"; })).toContain("FLOW_PRODUCER_DIRECTION_INVALID"); });
  it("rejects consumer direction inversion", () => { expect(codes((item) => { item.ports.find((port) => port.localId === item.flows[0].consumerPortLocalIds[0])!.direction = "output"; })).toContain("FLOW_CONSUMER_DIRECTION_INVALID"); });
  it("rejects incompatible flow kinds", () => { expect(codes((item) => { item.ports.find((port) => port.localId === item.flows[0].consumerPortLocalIds[0])!.flowKind = "thermal"; })).toContain("FLOW_KIND_MISMATCH"); });
  it("rejects unconnected required ports", () => { expect(codes((item) => { item.flows = []; })).toContain("REQUIRED_PORT_UNCONNECTED"); });
  it("rejects references outside the exact problem revision", () => { expect(codes((item) => { item.blocks[1].requirementRefs = ["requirement:foreign"]; })).toContain("REQUIREMENT_REFERENCE_NOT_FOUND"); });
  it("rejects global local-ID reuse", () => { expect(codes((item) => { item.ports[0].localId = item.blocks[0].localId; })).toContain("LOCAL_ID_REUSE"); });
  it("rejects a stale problem digest", () => { expect(codes((item) => { item.problemDigest = "arch1-stale"; })).toContain("PROPOSAL_PROBLEM_DIGEST_MISMATCH"); });
  it("fails closed on missing collections without throwing", () => { const problem = architectureProblem(); const proposal = architectureProposal(problem) as unknown as Record<string, unknown>; delete proposal.ports; expect(() => validateArchitectureProposal(proposal as never, problem)).not.toThrow(); expect(validateArchitectureProposal(proposal as never, problem).map((item) => item.code)).toContain("PROPOSAL_COLLECTION_REQUIRED"); });
  it("rejects invalid runtime enum values", () => { expect(codes((item) => { item.ports[0].direction = "sideways" as never; })).toContain("PROPOSAL_ENUM_INVALID"); });
});
