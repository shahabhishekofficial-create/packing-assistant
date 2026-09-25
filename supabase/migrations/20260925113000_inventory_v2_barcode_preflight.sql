-- Inventory V2 barcode preflight lookup
-- Additive RPC only. No existing table or legacy RPC is altered.

create or replace function public.inv_v2_lookup_linked(
  p_session_token text,
  p_barcode text
)
returns table(item_id uuid,item_name text,active boolean)
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not public.inv_require_admin(p_session_token) then
    raise exception 'Unauthorized';
  end if;
  return query
  select i.id,i.name,i.active
  from public.inv_v2_item_barcodes b
  join public.inv_v2_items i on i.id=b.item_id
  where b.barcode=trim(p_barcode);
end;
$$;

revoke all on function public.inv_v2_lookup_linked(text,text) from public;
grant execute on function public.inv_v2_lookup_linked(text,text) to anon, authenticated;

-- END OF PART 1/1
