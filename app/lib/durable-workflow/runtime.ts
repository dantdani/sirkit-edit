import { PostgresDurableWorkflowRepository } from "./server-repository";
import type { DurableWorkflowRepository } from "./types";
import { fixtureContainer } from "../fixture-runtime/container";
import { fixtureRuntimeEnabled } from "../fixture-runtime/mode";

let repository: PostgresDurableWorkflowRepository | null = null;

/**
 * Process singleton over durable PostgreSQL state; correctness still relies on
 * database CAS, not process locks.
 *
 * [B16-C §5] Under the env-gated FIXTURE RUNTIME (non-production, local_dev
 * only) the repository is the in-memory implementation anchored on globalThis
 * so a running dev server can host the deterministic browser proof with no
 * database. Production runtimes can never select it (`fixtureRuntimeEnabled`).
 */
export function getDurableWorkflowRepository(): DurableWorkflowRepository {
  if (fixtureRuntimeEnabled()) return fixtureContainer().durableRepository;
  repository ??= new PostgresDurableWorkflowRepository();
  return repository;
}
