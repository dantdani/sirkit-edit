import { engineeringId } from "./stable";
import type { DerivedArtifactState, EngineeringChangeSet, ProjectRevision } from "./types";
import type { DerivedKind } from "./dependency";

export interface VerificationJob {
  jobId: string;
  projectId: string;
  branchId: string;
  revision: ProjectRevision;
  artifactKind: DerivedKind;
  evaluatorId: string;
  evaluatorVersion: string;
  scope: string;
  changeSet: EngineeringChangeSet;
  inputDigests: string[];
  priority: number;
  seed: number;
  cancellationToken: string;
  status: "queued" | "running" | "cancelled" | "completed" | "rejected_stale" | "failed";
}

export interface VerificationJobResult<T = unknown> {
  jobId: string;
  projectId: string;
  branchId: string;
  revision: ProjectRevision;
  evaluatorId: string;
  evaluatorVersion: string;
  artifactKind: DerivedKind;
  scope: string;
  value: T;
  digest: string;
  durationMs: number;
}

export class RevisionBoundScheduler {
  private jobs: VerificationJob[] = [];
  private cancelled = new Set<string>();
  private generation = 0;
  constructor(private readonly maximumQueue = 128) {}

  enqueue(input: Omit<VerificationJob, "jobId" | "cancellationToken" | "status">): VerificationJob {
    const scopeKey = `${input.projectId}\0${input.branchId}\0${input.artifactKind}\0${input.scope}`;
    for (const job of this.jobs) if (`${job.projectId}\0${job.branchId}\0${job.artifactKind}\0${job.scope}` === scopeKey && (job.status === "queued" || job.status === "running")) { job.status = "cancelled"; this.cancelled.add(job.cancellationToken); }
    this.jobs = this.jobs.filter((job) => job.status !== "cancelled"); if (this.jobs.length >= this.maximumQueue) throw new Error("VERIFICATION_QUEUE_FULL");
    this.generation += 1; const jobId = engineeringId("job", { project: input.projectId, branch: input.branchId, artifact: input.artifactKind, scope: input.scope, revision: input.revision.canonicalStateDigest, evaluator: input.evaluatorVersion, change: input.changeSet.transactionId, generation: this.generation });
    const job: VerificationJob = { ...structuredClone(input), jobId, cancellationToken: engineeringId("cancel", { jobId, generation: this.generation }), status: "queued" }; this.jobs.push(job); this.jobs.sort((a, b) => a.priority - b.priority || a.jobId.localeCompare(b.jobId)); return structuredClone(job);
  }

  take(): VerificationJob | undefined { const job = this.jobs.find((item) => item.status === "queued"); if (!job) return undefined; job.status = "running"; return structuredClone(job); }
  cancel(jobId: string): boolean { const job = this.jobs.find((item) => item.jobId === jobId); if (!job || job.status === "completed") return false; job.status = "cancelled"; this.cancelled.add(job.cancellationToken); return true; }
  isCancelled(token: string): boolean { return this.cancelled.has(token); }

  acceptResult(result: VerificationJobResult, currentRevision: ProjectRevision, expectedEvaluatorVersion: string): { accepted: boolean; reason: string } {
    const job = this.jobs.find((item) => item.jobId === result.jobId); if (!job) return { accepted: false, reason: "UNKNOWN_JOB" }; if (job.status === "cancelled" || this.cancelled.has(job.cancellationToken)) return { accepted: false, reason: "JOB_CANCELLED" };
    if (result.projectId !== currentRevision.projectId || result.branchId !== currentRevision.branchId || result.revision.canonicalStateDigest !== currentRevision.canonicalStateDigest || result.revision.headSequence !== currentRevision.headSequence) { job.status = "rejected_stale"; return { accepted: false, reason: "STALE_RESULT" }; }
    if (result.evaluatorVersion !== expectedEvaluatorVersion || result.evaluatorId !== job.evaluatorId || result.artifactKind !== job.artifactKind) { job.status = "failed"; return { accepted: false, reason: "EVALUATOR_OR_SCHEMA_MISMATCH" }; }
    job.status = "completed"; return { accepted: true, reason: "CURRENT_RESULT" };
  }

  queueDepth(): number { return this.jobs.filter((job) => job.status === "queued" || job.status === "running").length; }
  snapshot(): VerificationJob[] { return structuredClone(this.jobs); }
}

export function jobResultToArtifact<T>(result: VerificationJobResult<T>): DerivedArtifactState<T> {
  return { artifactId: engineeringId("artifact", { kind: result.artifactKind, revision: result.revision.canonicalStateDigest }), artifactKind: result.artifactKind, scope: result.scope, inputRevisionVector: structuredClone(result.revision), evaluatorVersion: result.evaluatorVersion, status: "current", value: structuredClone(result.value), invalidatedByTransactionIds: [], computedAt: new Date().toISOString(), durationMs: result.durationMs, digest: result.digest, equivalenceStatus: "not_compared" };
}
