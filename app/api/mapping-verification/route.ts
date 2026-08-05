import { getDurableWorkflowRepository } from "@/app/lib/durable-workflow/runtime";
import { DurableMappingContextStore, DurableMappingRepository } from "@/app/lib/mapping-verification/durable";
import { mappingStage4FeatureState } from "@/app/lib/mapping-verification/rollout";
import { MappingVerificationService } from "@/app/lib/mapping-verification/service";
import { PhysicalBindingMappingProjector } from "@/app/lib/mapping-verification/stage1-projector";
import { ScopedMappingInvalidationTarget } from "@/app/lib/mapping-verification/invalidation";
import { PostgresPhysicalBindingRepository } from "@/app/lib/physical-binding/server-repository";
import { DurablePcbSyncRepository } from "@/app/lib/pcb-sync/durable";
import { MAPPING_CANDIDATE_VERSION, MAPPING_POLICY_VERSION, MAPPING_REQUEST_VERSION, MAPPING_RESULT_VERSION, MAPPING_VERIFIER_VERSION } from "@/app/lib/mapping-verification/types";
import { mappingApiScope } from "./_scope";
import { createMappingPostHandler } from "./handler";

export const runtime = "nodejs";
const workflow = getDurableWorkflowRepository();
const stage3Repository = new DurablePcbSyncRepository(workflow);
export const stage4ContextProvider = new DurableMappingContextStore(workflow);
export const stage4Repository = new DurableMappingRepository(workflow);
const service = new MappingVerificationService({ provider: stage4ContextProvider, resultStore: stage4ContextProvider, repository: stage4Repository, stage1Projector: new PhysicalBindingMappingProjector(new PostgresPhysicalBindingRepository()), invalidation: new ScopedMappingInvalidationTarget(stage3Repository), effectMode: "outbox" });
export async function GET(request: Request): Promise<Response> { const authorized = mappingApiScope(request); if (!authorized.ok) return authorized.response; const state = mappingStage4FeatureState(); return Response.json({ ok: true, state, authority: "durable_owner_repository_with_recoverable_outbox", capabilities: { inspect: state !== "off", verify: state !== "off", mutate: state === "opt_in" || state === "authoritative_supported_profile", approve: state === "opt_in" || state === "authoritative_supported_profile", selectsFootprint: false, mutatesSchematic: false, mutatesPcb: false }, versions: { request: MAPPING_REQUEST_VERSION, candidate: MAPPING_CANDIDATE_VERSION, result: MAPPING_RESULT_VERSION, policy: MAPPING_POLICY_VERSION, verifier: MAPPING_VERIFIER_VERSION } }, { headers: { "Cache-Control": "no-store", "X-Sirkit-Mapping-Stage4": state } }); }
export const POST = createMappingPostHandler(service, mappingStage4FeatureState);
