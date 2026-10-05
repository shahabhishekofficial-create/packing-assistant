-- Reconcile delivery completion for invoices that were uploaded before the
-- invoice-finalization workflow consistently marked the delivery as completed.

update public.delivery_records
set status='delivered',
    delivered_at=coalesce(delivered_at, invoice_uploaded_at, updated_at, now()),
    delivery_state='DELIVERED',
    state_version=coalesce(state_version,1)+1,
    last_action_at=coalesce(last_action_at,now()),
    updated_at=now()
where invoice_path is not null
  and coalesce(status,'') <> 'delivered';

insert into public.driver_ledger_entries
  (driver_id, delivery_record_id, entry_type, amount, reference_key, metadata)
select dr.driver_id, dr.id, 'DELIVERY_EARNING',
       coalesce(dr.delivery_charge,0),
       'delivery:'||dr.id::text,
       jsonb_build_object('order_id',dr.order_id,'outlet_id',dr.outlet_id,'reconciled_from_invoice',true)
from public.delivery_records dr
where dr.status='delivered'
  and dr.invoice_path is not null
  and not exists (
    select 1 from public.driver_ledger_entries le
    where le.reference_key='delivery:'||dr.id::text
  );