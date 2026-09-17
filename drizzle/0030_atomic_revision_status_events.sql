-- B19-E E3 — append-only withdrawal events for published atomic part revisions.
--
-- FORWARD-ONLY. Not applied to any live database by the chapter; an operator applies it deliberately.
--
-- A published revision's `publication_state` is part of its record hash (app/lib/atomic/catalog.ts), so deprecating,
-- superseding or revoking it can never edit the row in place: the id recomputed at publication would stop matching. A
-- withdrawal is therefore one immutable event row, written in the same transaction as its `atomic_audit_events` row. States
-- only move forward (published -> deprecated -> superseded -> revoked, skipping allowed), so each state is entered at most
-- once per revision and the latest event is the revision's catalog status. OD-38: deprecated and superseded revisions keep
-- serving existing pins and are excluded from new selection; a revoked revision fails closed everywhere.
--
-- EXISTING ROW DISPOSITION: no rows are written. Every revision already published stays published (no event).
-- Hand-written (like 0026): IF NOT EXISTS so re-applying is a no-op.

CREATE TABLE IF NOT EXISTS "atomic_revision_status_events" (
  "id" text PRIMARY KEY NOT NULL,
  "revision_id" text NOT NULL,
  "to_state" text NOT NULL,
  "successor_revision_id" text,
  "actor_id" text NOT NULL,
  "actor_role" text NOT NULL,
  "reason" text NOT NULL,
  "at" timestamp with time zone NOT NULL,
  "audit_event_id" text NOT NULL,
  CONSTRAINT "atomic_status_event_to_state_check" CHECK ("to_state" IN ('deprecated', 'superseded', 'revoked')),
  CONSTRAINT "atomic_status_event_reason_check" CHECK (btrim("reason") <> ''),
  CONSTRAINT "atomic_status_event_successor_check" CHECK ("successor_revision_id" IS NULL OR "successor_revision_id" <> "revision_id"),
  CONSTRAINT "atomic_status_event_actor_check" CHECK (btrim("actor_id") <> '' AND lower(btrim("actor_id")) !~ '^(llm|ocr|agent):' AND "actor_role" IN ('publisher', 'admin')),
  CONSTRAINT "atomic_status_event_revision_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."atomic_part_revisions"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "atomic_status_event_successor_fk" FOREIGN KEY ("successor_revision_id") REFERENCES "public"."atomic_part_revisions"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "atomic_status_event_audit_fk" FOREIGN KEY ("audit_event_id") REFERENCES "public"."atomic_audit_events"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "atomic_status_event_revision_state_uniq" ON "atomic_revision_status_events" USING btree ("revision_id", "to_state");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "atomic_status_event_successor_idx" ON "atomic_revision_status_events" USING btree ("successor_revision_id");
