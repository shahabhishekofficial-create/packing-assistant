create extension if not exists pgcrypto;

create table if not exists public.driver_accounts (
  id uuid primary key default gen_random_uuid(),
  driver_name text not null,
  login_name text not null unique,
  pin_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.driver_accounts enable row level security;

create table if not exists public.driver_sessions (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.driver_accounts(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
alter table public.driver_sessions enable row level security;

create table if not exists public.delivery_records (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  driver_id uuid not null references public.driver_accounts(id),
  status text not null default 'pending' check(status in ('pending','delivered')),
  delivered_at timestamptz,
  invoice_path text,
  invoice_filename text,
  invoice_mime_type text,
  invoice_uploaded_at timestamptz,
  ocr_status text not null default 'pending' check(ocr_status in ('pending','processing','completed','failed')),
  ocr_result jsonb,
  delivery_charge numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(order_id,outlet_id)
);
alter table public.delivery_records enable row level security;

insert into public.driver_accounts(driver_name,login_name,pin_hash)
values ('Vipul','vipul',crypt('1234',gen_salt('bf'))),('Lux','lux',crypt('1234',gen_salt('bf'))),('Abdul','abdul',crypt('1234',gen_salt('bf')))
on conflict(login_name) do nothing;

create or replace function public.driver_login(p_login_name text,p_pin text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare d public.driver_accounts; v_token text; v_hash text;
begin
  select * into d from public.driver_accounts where login_name=lower(trim(p_login_name)) and active=true;
  if not found or d.pin_hash<>crypt(p_pin,d.pin_hash) then return jsonb_build_object('ok',false,'message','Invalid driver login'); end if;
  v_token=encode(gen_random_bytes(32),'hex'); v_hash=encode(digest(v_token,'sha256'),'hex');
  delete from public.driver_sessions where expires_at<now() or driver_id=d.id;
  insert into public.driver_sessions(driver_id,token_hash,expires_at) values(d.id,v_hash,now()+interval '30 days');
  return jsonb_build_object('ok',true,'token',v_token,'driver_id',d.id,'driver_name',d.driver_name);
end $$;
grant execute on function public.driver_login(text,text) to anon,authenticated;

create or replace function public.get_driver_dashboard(p_session_token text)
returns jsonb language plpgsql security definer set search_path=public as $$
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
  where s.token_hash=v_hash and s.expires_at>now() and a.active=true;

  if not found then
    return jsonb_build_object('ok',false,'message','Session expired');
  end if;

  update public.driver_sessions set last_seen_at=now() where token_hash=v_hash;

  select coalesce(sum(dr.delivery_charge),0)::numeric(12,2)
  into v_earned
  from public.delivery_records dr
  where dr.driver_id=d.id and dr.status='delivered';

  select * into v_order
  from public.orders
  where completed_at is null
  order by created_at desc
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
          'delivery_charge',coalesce(dr.delivery_charge,o.delivery_charge,0),
          'earned',case when dr.status='delivered' then coalesce(dr.delivery_charge,o.delivery_charge,0) else 0 end
        ),
        'items',coalesce((
          select jsonb_agg(
            jsonb_build_object(
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
          where i.order_id=v_order.id and i.outlet_id=o.id
        ),'[]'::jsonb)
      )
      order by o.outlet_rank
    ),
    '[]'::jsonb
  )
  into result
  from public.outlets o
  left join public.delivery_records dr
    on dr.order_id=v_order.id and dr.outlet_id=o.id and dr.driver_id=d.id
  where o.order_id=v_order.id and o.driver=d.driver_name;

  return jsonb_build_object(
    'ok',true,
    'driver_name',d.driver_name,
    'order_id',v_order.id,
    'earned',v_earned,
    'outlets',result
  );
end $$;
grant execute on function public.get_driver_dashboard(text) to anon,authenticated;

insert into storage.buckets(id,name,public) values('delivery-invoices','delivery-invoices',false) on conflict(id) do update set public=false;

alter table public.delivery_records add column if not exists delivery_charge numeric(12,2) not null default 0;
