create extension if not exists pgcrypto;

-- Safe migration for the live driver system.
alter table public.delivery_records add column if not exists driver_id uuid references public.driver_accounts(id);
alter table public.delivery_records add column if not exists invoice_path text;
alter table public.delivery_records add column if not exists invoice_filename text;
alter table public.delivery_records add column if not exists invoice_mime_type text;
alter table public.delivery_records add column if not exists invoice_uploaded_at timestamptz;
alter table public.delivery_records add column if not exists ocr_status text not null default 'pending';
alter table public.delivery_records add column if not exists ocr_result jsonb;
alter table public.delivery_records add column if not exists delivery_charge numeric(12,2) not null default 0;
alter table public.delivery_records add column if not exists rejection_photos jsonb not null default '[]'::jsonb;

update public.delivery_records dr
set driver_id=da.id
from public.driver_accounts da
where dr.driver_id is null
  and lower(coalesce(dr.driver,''))
  = lower(da.driver_name);

insert into storage.buckets(id,name,public)
values('delivery-evidence','delivery-evidence',false)
on conflict(id) do update set public=false;

create or replace function public.get_driver_dashboard(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  d public.driver_accounts;
  v_order public.orders;
  v_hash text;
  result jsonb;
  v_earned numeric(12,2);
begin
  v_hash=encode(digest(p_session_token,'sha256'),'hex');

  select a.* into d
  from public.driver_accounts a
  join public.driver_sessions s on s.driver_id=a.id
  where s.token_hash=v_hash
    and s.expires_at>now()
    and a.active=true;

  if not found then
    return jsonb_build_object('ok',false,'message','Session expired');
  end if;

  update public.driver_sessions
  set last_seen_at=now()
  where token_hash=v_hash;

  select coalesce(sum(dr.delivery_charge),0)::numeric(12,2)
  into v_earned
  from public.delivery_records dr
  where dr.driver_id=d.id
    and dr.status='delivered';

  -- Keep the driver's route visible after packing order completion.
  select o0.* into v_order
  from public.orders o0
  where exists(
    select 1 from public.outlets oo
    where oo.order_id=o0.id
      and oo.driver=d.driver_name
  )
  order by o0.created_at desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'ok',true,
      'driver_name',d.driver_name,
      'order_id',null,
      'earned',v_earned,
      'outlets',jsonb_build_array()
    );
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'outlet_id',o.id,
        'outlet_name',o.store_name,
        'rank',o.outlet_rank,
        'status',o.status,
        'completed_at',o.completed_at,
        'delivery',jsonb_build_object(
          'status',coalesce(dr.status,'pending'),
          'delivered_at',dr.delivered_at,
          'invoice_path',dr.invoice_path,
          'invoice_uploaded_at',dr.invoice_uploaded_at,
          'rejection_photos',coalesce(dr.rejection_photos,'[]'::jsonb),
          'delivery_charge',coalesce(dr.delivery_charge,o.delivery_charge,0),
          'earned',case when dr.status='delivered'
            then coalesce(dr.delivery_charge,o.delivery_charge,0)
            else 0 end
        ),
        'items',coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'item_id',i.id,
              'item_code',i.item_code,
              'product_name',i.product_name,
              'required_qty',i.required_qty,
              'packed_qty',i.packed_qty,
              'missing_qty',i.missing_qty,
              'status',upper(coalesce(i.status,'PENDING')),
              'reason',coalesce(i.reason,'')
            )
            order by i.narration_rank nulls last,i.product_name
          )
          from public.order_items i
          where i.order_id=v_order.id
            and i.outlet_id=o.id
        ),'[]'::jsonb)
      )
      order by o.outlet_rank
    ),
    '[]'::jsonb
  )
  into result
  from public.outlets o
  left join public.delivery_records dr
    on dr.order_id=v_order.id
   and dr.outlet_id=o.id
   and dr.driver_id=d.id
  where o.order_id=v_order.id
    and o.driver=d.driver_name;

  return jsonb_build_object(
    'ok',true,
    'driver_name',d.driver_name,
    'order_id',v_order.id,
    'earned',v_earned,
    'outlets',result
  );
end $$;

grant execute on function public.get_driver_dashboard(text) to anon,authenticated;