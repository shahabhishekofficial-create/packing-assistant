update public.inv_staff_users
set name='Warehouse Staff'
where lower(trim(login_name))='__inventory_guest__';
