-- Ensure delivery transition idempotency is enforceable.
-- delivery_transition_v2 uses ON CONFLICT (idempotency_key).
create unique index if not exists delivery_events_idempotency_key_uidx
  on public.delivery_events (idempotency_key)
  where idempotency_key is not null;
