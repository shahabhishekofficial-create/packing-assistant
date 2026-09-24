-- Driver delivery V2 rollback reference.
-- Run only if V2 must be removed after verifying no V2 client is active.
-- Existing production RPCs are intentionally not dropped here.

drop function if exists public.driver_invoice_target_v2(text,uuid,uuid);
drop function if exists public.save_driver_item_rejections_v2(text,uuid,uuid,jsonb);
drop function if exists public.get_driver_dashboard_page_v2(text,integer,integer);
drop function if exists public.update_outlet_settings_v2(uuid,uuid,text,integer,text,numeric);
drop function if exists public.create_order_v2(text,text,jsonb);

-- Keep invoice_number and outlet_driver_defaults during rollback unless data retention
-- has been explicitly reviewed; deleting them would remove operational history/defaults.
