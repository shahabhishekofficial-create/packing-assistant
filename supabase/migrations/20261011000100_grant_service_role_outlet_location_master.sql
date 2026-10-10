-- The driver-api Edge Function uses the service_role client after validating custom admin sessions.
-- Grant only the operations required to load and upsert outlet locations.
-- Do not grant direct table access to anon or authenticated clients.
GRANT SELECT, INSERT, UPDATE ON TABLE public.outlet_location_master TO service_role;
