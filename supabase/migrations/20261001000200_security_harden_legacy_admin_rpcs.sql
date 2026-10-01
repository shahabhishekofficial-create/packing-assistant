-- Security hardening: remove public execution from confirmed-unused legacy admin payment RPCs.
-- Current admin payment flow uses *_session variants through driver-api.
revoke execute on function public.admin_driver_payment_ledger(text) from anon, authenticated;
revoke execute on function public.admin_record_driver_payment(text, uuid, numeric, timestamptz, text, text) from anon, authenticated;

-- Prevent future public RPC exposure by default. Current API functions retain their
-- existing explicit grants and are not modified by this statement.
alter default privileges in schema public revoke execute on functions from anon, authenticated;
