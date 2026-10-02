update public.inv_vegetable_items
set name_en='Baby Corn'
where lower(trim(name_en))='babycorn';

update public.inv_vegetable_items
set name_en='Bok Choy'
where lower(trim(name_en))='bok choi';

update public.inv_vegetable_items
set name_en='Lemongrass'
where lower(trim(name_en))='lemon grass';

update public.inv_vegetable_items
set name_en='Lollo Rosso'
where lower(trim(name_en))='lolo rosso';

insert into public.inv_vegetable_items(name_en,base_uom,is_active,created_by)
select v.name,'kg',true,'admin'
from (values
 ('Arugula'),
 ('Edamame No Pods'),
 ('Edamame With Pods'),
 ('Italian Basil'),
 ('Asparagus'),
 ('Edible Flower'),
 ('Green Zucchini'),
 ('Yellow Zucchini'),
 ('Red Bell Pepper'),
 ('Yellow Bell Pepper'),
 ('Green Capsicum'),
 ('Simpson Lettuce'),
 ('Kale')
) v(name)
where not exists (
 select 1 from public.inv_vegetable_items i where lower(trim(i.name_en))=lower(trim(v.name))
);