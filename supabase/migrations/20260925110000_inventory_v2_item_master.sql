-- Inventory V2 Item Master lookup hardening
-- Earlier additive V2 migrations already provide inv_v2_items/RPCs.
-- This migration only hardens lookup/cache access and indexes.

create index if not exists inv_barcode_lookup_cache_fetched_at_idx
  on public.inv_barcode_lookup_cache(fetched_at desc);

create index if not exists inv_v2_item_barcodes_barcode_idx
  on public.inv_v2_item_barcodes(barcode);

alter table public.inv_barcode_lookup_cache enable row level security;
alter table public.inv_v2_item_barcodes enable row level security;
alter table public.inv_v2_items enable row level security;
alter table public.inv_v2_audit_log enable row level security;

revoke all on public.inv_barcode_lookup_cache from public, anon, authenticated;
revoke all on public.inv_v2_item_barcodes from public, anon, authenticated;
revoke all on public.inv_v2_items from public, anon, authenticated;
revoke all on public.inv_v2_audit_log from public, anon, authenticated;

-- END OF PART 1/1
