-- [B24-A4] DOWN for 0031_rls_default_deny (OD-193). Class: lossless - it reads and writes no row, so it runs whatever the
-- data. The same list as 0031, in reverse order; `project_members` keeps 0027's row security and policy.
--
-- Reviewed SQL, kept outside the forward file: every byte of a forward migration is in its checksum and every non-comment chunk
-- of it runs forward (app/lib/db/migrations/manifest.ts), so an executable DOWN section inside the forward file would run on the
-- way up and, once edited, be checksum drift on every database that applied it. The rollback manifest
-- (app/lib/db/migrations/rollback.ts) binds this file to its forward migration's checksum and to its own;
-- `pnpm run db:migrate -- --rollback <name> --confirm <the typed confirmation>` runs it only while that migration is the newest
-- applied one, in one transaction with the removal of its ledger row, under the runner's advisory lock.

ALTER TABLE "sirkit_schema_migrations" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "simulation_waveform_artifacts" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "simulation_verification_problems" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "simulation_testbench_registries" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "simulation_runs" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "simulation_readiness_reports" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "simulation_model_registries" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "simulation_coverage_matrices" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "simulation_coverage_denominators" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "simulation_campaigns" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "schematic_transaction_records" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "schematic_semantic_graphs" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "schematic_semantic_diffs" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "schematic_round_trip_certificates" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "schematic_pcb_sync_contracts" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "schematic_diagram_views" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "schematic_decisions" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "schematic_completeness_reports" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "schematic_compiler_upstream_signoffs" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "schematic_compilation_problems" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "schematic_candidates" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "schematic_artifact_manifests" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "requirement_transaction_records" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "requirement_source_revisions" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "release_manifests" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "release_level_assessments" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "release_engineering_project_states" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "release_engineering_problems" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "programmable_device_evidence_snapshots" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "procurement_snapshots" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "power_upstream_signoffs" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "power_transaction_records" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "power_selection_decisions" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "power_architecture_problems" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "power_architecture_candidates" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "physical_readiness_assessments" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "physical_binding_sets" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "physical_binding_revisions" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "physical_binding_migration_records" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "physical_binding_audit_events" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "pcb_footprints" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "parts_atomic_links" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "parts" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "part_offers" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "model_simulation_project_states" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "manufacturing_artifact_manifests" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "libraries" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "interface_upstream_signoffs" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "interface_transaction_records" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "interface_selection_decisions" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "interface_planning_problems" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "interface_planning_candidates" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "interface_pin_fact_snapshots" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "interface_pin_allocations" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "hardware_release_candidates" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "full_flow_stage_invocations" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "full_flow_run_events" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "full_flow_run_contexts" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "full_flow_replay_bundles" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "full_flow_project_states" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "full_flow_final_verdicts" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "full_flow_candidate_graphs" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "firmware_bringup_readiness_decisions" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "firmware_bringup_project_states" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "firmware_bringup_problems" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "firmware_bringup_packages" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "firmware_bringup_coverage_reports" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "durable_workflow_replays" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "durable_workflow_records" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "durable_workflow_outbox" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "durable_workflow_heads" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "design_requirement_packages" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "design_capability_profiles" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "constraint_waivers" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "constraint_set_revisions" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "constraint_programs" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "constraint_program_activations" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "constraint_evaluations" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "component_selection_upstream_signoffs" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "component_selection_transaction_records" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "component_selection_sourcing_snapshots" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "component_selection_problems" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "component_selection_offer_observations" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "component_selection_evaluations" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "component_selection_decisions" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "component_selection_catalog_snapshots" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "component_selection_candidates" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "component_selection_alternatives" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "compiled_circuit_recipes" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "circuit_waivers" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "circuit_verification_upstream_signoffs" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "circuit_verification_transaction_records" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "circuit_verification_project_states" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "circuit_verification_problems" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "circuit_rule_registries" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "circuit_rule_denominators" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "circuit_recipe_source_bundles" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "circuit_recipe_libraries" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "circuit_recipe_definitions" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "circuit_readiness_reports" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "circuit_oracle_runs" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "circuit_oracle_parity_reports" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "circuit_knowledge_upstream_signoffs" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "circuit_knowledge_transaction_records" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "circuit_knowledge_problems" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "circuit_knowledge_pcb_foundation_signoffs" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "circuit_findings" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "calculation_upstream_signoffs" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "calculation_transaction_records" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "calculation_reports" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "calculation_registry_snapshots" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "calculation_problems" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "calculation_graphs" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "calculation_decisions" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "bom_snapshots" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "bom_notifications" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "autonomous_hardware_design_runs" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "authoritative_boms" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "atomic_supplier_parts" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "atomic_sources" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "atomic_source_records" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "atomic_selections" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "atomic_revision_status_events" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "atomic_raw_objects" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "atomic_part_revisions" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "atomic_offer_snapshots" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "atomic_mapping_certificates" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "atomic_manufacturers" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "atomic_licenses" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "atomic_guidance" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "atomic_generic_devices" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "atomic_families" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "atomic_exact_parts" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "atomic_evidence" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "atomic_claims" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "atomic_cad_assets" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "atomic_audit_events" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "architecture_transaction_records" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "architecture_selection_decisions" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "architecture_problems" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "architecture_comparisons" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "architecture_candidates" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "alternates" DISABLE ROW LEVEL SECURITY;
