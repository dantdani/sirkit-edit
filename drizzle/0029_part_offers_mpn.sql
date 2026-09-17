-- B19-D I5b — a stored distributor offer carries the exact MPN it answers for.
--
-- FORWARD-ONLY. Not applied to any live database by the chapter; an operator applies it deliberately.
--
-- Before B19-D, `part_offers` was keyed by (part_id, distributor) only, and the pricing layer relabelled whatever a vendor
-- returned as the requested MPN — so an offer for `MAX3232CSE+` could be served as `MAX3232CSE`, and two exact parts filed
-- under one catalog row shared one price. The pricing layer now serves a stored offer only when its `mpn` IS the requested
-- exact MPN.
--
-- LEGACY ROW DISPOSITION: existing rows receive NULL and are never served (a NULL MPN matches nothing). Every such row is
-- within its source's retention for at most 24 hours and is then deleted by the offer purge; nothing is backfilled or
-- guessed.

ALTER TABLE "part_offers" ADD COLUMN IF NOT EXISTS "mpn" text;
