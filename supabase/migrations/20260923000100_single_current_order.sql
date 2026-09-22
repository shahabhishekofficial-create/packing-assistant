-- Single current-order invariant for Packing Assistant.
-- The latest completed order remains visible until a new order is created.
-- Creating a new order atomically replaces the previous current order.

alter table public.orders
  add column if not exists is_current boolean not null default false;

update public.orders
set is_current=false;

update public.orders
set is_current=true
where id=(
  select id from public.orders
  order by created_at desc
  limit 1
);

create unique index if not exists orders_one_current_idx
  on public.orders(is_current)
  where is_current=true;

create or replace function public.get_current_order()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order
  from public.orders
  where is_current=true
  order by created_at desc
  limit 1;

  if v_order.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'id',v_order.id,
    'access_token',v_order.access_token,
    'order_name',v_order.order_name,
    'created_at',v_order.created_at,
    'status',v_order.status
  );
end;
$$;

grant execute on function public.get_current_order() to anon, authenticated;

create or replace function public.create_order(
  p_order_name text,
  p_access_token text,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_order_id uuid;
  v_outlet_id uuid;
  v_store text;
  v_item jsonb;
begin
  -- Serialize order creation so two simultaneous uploads cannot create two
  -- current orders.
  perform pg_advisory_xact_lock(839274612);

  if p_order_name is null or trim(p_order_name) = '' then
    raise exception 'Order name is required';
  end if;

  if p_access_token is null or length(p_access_token) < 20 then
    raise exception 'Invalid access token';
  end if;

  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items)=0 then
    raise exception 'Order contains no items';
  end if;

  update public.orders
  set is_current=false
  where is_current=true;

  insert into public.orders(order_name,access_token,is_current)
  values(trim(p_order_name),p_access_token,true)
  returning id into v_order_id;

  for v_store in
    select distinct trim(value->>'store_name')
    from jsonb_array_elements(p_items) value
    where trim(value->>'store_name')<>''
  loop
    insert into public.outlets(order_id,store_name)
    values(v_order_id,v_store)
    returning id into v_outlet_id;

    for v_item in
      select value
      from jsonb_array_elements(p_items) value
      where trim(value->>'store_name')=v_store
    loop
      insert into public.order_items(
        order_id,outlet_id,item_code,product_name,voice_text,
        required_qty,narration_rank
      )
      values(
        v_order_id,
        v_outlet_id,
        trim(v_item->>'item_code'),
        trim(v_item->>'product_name'),
        coalesce(
          nullif(trim(v_item->>'voice_text'),''),
          trim(v_item->>'product_name')
        ),
        (v_item->>'required_qty')::numeric,
        (v_item->>'narration_rank')::integer
      );
    end loop;
  end loop;

  return v_order_id;

exception
  when unique_violation then
    raise exception 'Duplicate outlet/item code detected in this order';
end;
$$;

grant execute on function public.create_order(text,text,jsonb) to anon, authenticated;
