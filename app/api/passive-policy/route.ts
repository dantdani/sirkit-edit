import { getDurableWorkflowRepository } from "@/app/lib/durable-workflow/runtime";
import { DurablePassivePolicyContextStore, DurablePassivePolicyInvalidationTarget, DurablePassivePolicyRepository } from "@/app/lib/passive-policy/durable";
import { DurablePcbSyncRepository } from "@/app/lib/pcb-sync/durable";
import { passivePolicyFeatureState } from "@/app/lib/passive-policy/rollout";
import { PassivePolicyService } from "@/app/lib/passive-policy/service";
import { PASSIVE_EVALUATION_REQUEST_VERSION, PASSIVE_EVALUATION_RESULT_VERSION, PASSIVE_EXCEPTION_CONTRACT_VERSION, PASSIVE_POLICY_EVALUATOR_VERSION, PASSIVE_POLICY_SCHEMA_VERSION, PASSIVE_PREVIEW_VERSION, PASSIVE_PROFILE_SCHEMA_VERSION } from "@/app/lib/passive-policy/types";
import { authenticatedRoute } from "@/app/lib/auth/route-handlers";
import { createPassivePolicyPostHandler } from "./handler";

export const runtime = "nodejs";
const workflow = getDurableWorkflowRepository();
const stage3Repository = new DurablePcbSyncRepository(workflow);
export const stage5PassivePolicyContexts = new DurablePassivePolicyContextStore(workflow);
export const stage5PassivePolicyRepository = new DurablePassivePolicyRepository(workflow);
const service = new PassivePolicyService({ repository: stage5PassivePolicyRepository, contextProvider: stage5PassivePolicyContexts, invalidation: new DurablePassivePolicyInvalidationTarget(stage3Repository), effectMode: "outbox" });

// [B16.0.22] canonical wrapper — authorization inside the wrapper (all-members
// read, no CSRF per the exact policy row); the callback returns the static,
// feature-gated capability document and receives no Request.
export const GET = authenticatedRoute(undefined, () => {
  const state = passivePolicyFeatureState();
  return Response.json({ ok: true, state, verdict: "durable_feature_gated", authority: "durable_owner_repository_with_recoverable_outbox", capabilities: { inspect: state !== "off", evaluate: state !== "off", preview: state !== "off", mutate: state === "opt_in", componentException: state === "opt_in", exceptionLifecycle: state === "opt_in" ? ["approve", "revoke", "supersede"] : [], selectsExactPart: false, manufacturingReady: false, mutatesSchematic: false, mutatesPcb: false }, versions: { policy: PASSIVE_POLICY_SCHEMA_VERSION, profile: PASSIVE_PROFILE_SCHEMA_VERSION, exception: PASSIVE_EXCEPTION_CONTRACT_VERSION, evaluationRequest: PASSIVE_EVALUATION_REQUEST_VERSION, evaluationResult: PASSIVE_EVALUATION_RESULT_VERSION, preview: PASSIVE_PREVIEW_VERSION, evaluator: PASSIVE_POLICY_EVALUATOR_VERSION } }, { headers: { "Cache-Control": "no-store", "X-Sirkit-Passive-Policy-Stage5": state } });
});

export const POST = createPassivePolicyPostHandler(service, passivePolicyFeatureState);
