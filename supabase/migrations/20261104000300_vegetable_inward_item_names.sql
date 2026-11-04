-- Vegetable Inward v1 — item names for rows already recorded.
--
-- The picker uses veg_inward_items() (active items only). A recorded row must
-- keep its vegetable name even if that vegetable is later deactivated, so the
-- edge function asks for every item when it labels existing rows.

create or replace function public.veg_inward_item_names()
returns table (item_id uuid, name_en text, name_hi text, name_gu text)
language sql
stable
security definer
set search_path = ''
as $function$
  select i.item_id, i.name_en, i.name_hi, i.name_gu
  from public.inv_vegetable_items i;
$function$;

revoke all on function public.veg_inward_item_names() from public;
revoke all on function public.veg_inward_item_names() from anon;
revoke all on function public.veg_inward_item_names() from authenticated;
grant execute on function public.veg_inward_item_names() to service_role;
