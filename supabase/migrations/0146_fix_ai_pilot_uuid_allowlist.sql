-- Pilot membership is an explicit UUID allowlist. The two requested stores
-- were initialized once by 0144; future store inserts or renames must never
-- widen the pilot merely because a display name matches.

drop trigger if exists stores_initialize_ai_pilot_scope on public.stores;
drop function if exists private.ai_sync_named_pilot_store();
