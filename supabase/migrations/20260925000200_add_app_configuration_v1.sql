-- Central operational configuration v1.
-- Rollback (manual): drop trigger app_config_v1_audit on public.app_config_v1;
-- drop function public.app_config_v1_audit_trigger();
-- drop table public.app_config_audit_v1;
-- drop table public.app_config_v1;

create table if not exists public.app_config_v1 (
  config_key text primary key,
  section text not null check (section in ('driver','packing','inventory','system')),
  label text not null,
  description text not null default '',
  enabled boolean not null default true,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now(),
  updated_by text not null default 'system'
);

create index if not exists app_config_v1_section_sort_idx
  on public.app_config_v1(section, sort_order, config_key);

alter table public.app_config_v1 enable row level security;
revoke all on public.app_config_v1 from anon, authenticated;

create table if not exists public.app_config_audit_v1 (
  id bigint generated always as identity primary key,
  config_key text not null,
  old_enabled boolean,
  new_enabled boolean not null,
  changed_at timestamptz not null default now(),
  changed_by text not null default 'admin'
);

create index if not exists app_config_audit_v1_key_time_idx
  on public.app_config_audit_v1(config_key, changed_at desc);

alter table public.app_config_audit_v1 enable row level security;
revoke all on public.app_config_audit_v1 from anon, authenticated;

create or replace function public.app_config_v1_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.app_config_audit_v1(config_key, old_enabled, new_enabled, changed_by)
  values (new.config_key, old.enabled, new.enabled, coalesce(new.updated_by,'admin'));
  return new;
end;
$$;

revoke execute on function public.app_config_v1_audit_trigger() from public, anon, authenticated;

drop trigger if exists app_config_v1_audit on public.app_config_v1;
create trigger app_config_v1_audit
after update of enabled on public.app_config_v1
for each row
when (old.enabled is distinct from new.enabled)
execute function public.app_config_v1_audit_trigger();

insert into public.app_config_v1(config_key,section,label,description,enabled,sort_order)
values
('driver.invoice_gallery_upload','driver','Allow invoice gallery upload','When ON, drivers can choose the normal phone image picker. When OFF, camera capture is preferred.',true,10),
('driver.invoice_number_required','driver','Invoice number required','Driver must enter an invoice number before delivery can be completed.',true,20),
('driver.invoice_photo_required','driver','Invoice photo required','Driver must provide the invoice/bill image before delivery can be completed.',true,30),
('driver.short_rejection','driver','Short rejection','Allow drivers to report short quantities at outlet delivery.',true,40),
('driver.damage_rejection','driver','Damage rejection','Allow drivers to report damaged quantities at outlet delivery.',true,50),
('driver.damage_photo_required','driver','Damage photo required','Require photo evidence for every damaged item before delivery.',true,60),
('driver.rejection_confirmation','driver','Rejection confirmation','Require the driver to complete the delivery rejection check before delivery.',true,70),
('packing.voice_narration','packing','Voice narration','Speak the current product and required quantity.',true,10),
('packing.auto_advance','packing','Auto next item','Automatically open the next item after a packing action.',true,20),
('packing.partial_packing','packing','Allow partial packing','Show and allow the Partial action for packing staff.',true,30),
('packing.missing_marking','packing','Allow missing marking','Show and allow the Missing action for packing staff.',true,40),
('packing.show_completed_outlets','packing','Show completed outlets','Keep completed outlets visible in the packing outlet list.',false,50),
('inventory.barcode_scanning','inventory','Barcode scanning','Allow camera and barcode-input scanning in Inventory.',true,10),
('inventory.manual_search','inventory','Manual item search','Allow manual inventory item search.',true,20),
('inventory.offline_mode','inventory','Offline mode','Allow Inventory to queue counts while temporarily offline.',true,30),
('system.update_notifications','system','Update notifications','Show a non-blocking app update notification when a new build is available.',true,10),
('system.dashboard_auto_refresh','system','Dashboard auto refresh','Allow the Admin Dashboard to refresh live operational data automatically.',true,20),
('system.maintenance_mode','system','Maintenance mode','Temporarily block operational screens and show the maintenance message.',false,30)
on conflict (config_key) do update set
  section=excluded.section,
  label=excluded.label,
  description=excluded.description,
  sort_order=excluded.sort_order;

revoke all on function public.app_config_v1_audit_trigger() from public, anon, authenticated;
