import { PostgresDurableWorkflowRepository } from "./server-repository";

let repository: PostgresDurableWorkflowRepository | null = null;

/** Process singleton over durable PostgreSQL state; correctness still relies on database CAS, not process locks. */
export function getDurableWorkflowRepository(): PostgresDurableWorkflowRepository {
  repository ??= new PostgresDurableWorkflowRepository();
  return repository;
}
