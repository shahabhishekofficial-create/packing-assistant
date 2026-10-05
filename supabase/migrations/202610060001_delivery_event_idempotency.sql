-- Ensure delivery transition idempotency is enforceable.
-- delivery_transition_v2 uses ON CONFLICT (idempotency_key).
alter table public.delivery_events
  add constraint delivery_events_idempotency_key_key unique (idempotency_key);
