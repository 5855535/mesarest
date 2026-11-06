-- =====================================================================
-- DATOS DE DEMOSTRACION (is_demo = true). PRECIOS FICTICIOS, no comerciales.
-- Reemplazar desde el panel admin con el menu real del restaurante.
-- Es seguro ejecutarlo mas de una vez.
-- =====================================================================

insert into public.categories (name, sort_order) values
  ('Hamburguesas', 1),
  ('Perros calientes', 2),
  ('Acompañamientos', 3),
  ('Bebidas', 4),
  ('Combos', 5)
on conflict (name) do nothing;

with c as (select id, name from public.categories),
data(cat, name, descr, price, prep, sort) as (values
  ('Hamburguesas','Hamburguesa Clásica','[DEMO] Carne, queso, lechuga, tomate y cebolla',10000,12,1),
  ('Hamburguesas','Hamburguesa Especial','[DEMO] Doble carne, queso, tocineta, lechuga, tomate y cebolla',15000,15,2),
  ('Perros calientes','Perro Sencillo','[DEMO] Salchicha, queso, cebolla y salsas',8000,8,1),
  ('Perros calientes','Perro Especial','[DEMO] Salchicha, queso, tocineta, papa ripio y salsas',12000,10,2),
  ('Acompañamientos','Papas Fritas','[DEMO] Porción de papas fritas',5000,7,1),
  ('Acompañamientos','Aros de Cebolla','[DEMO] Porción de aros de cebolla',6000,8,2),
  ('Bebidas','Gaseosa','[DEMO] Gaseosa personal',3000,1,1),
  ('Bebidas','Jugo Natural','[DEMO] Jugo de fruta natural',4500,4,2),
  ('Combos','Combo Clásico','[DEMO] Hamburguesa clásica + papas + gaseosa',16000,15,1),
  ('Combos','Combo Especial','[DEMO] Hamburguesa especial + papas + gaseosa',21000,18,2)
)
insert into public.products (category_id, name, description, price, prep_time_minutes, sort_order, is_demo)
select c.id, d.name, d.descr, d.price, d.prep, d.sort, true
from data d join c on c.name = d.cat
where not exists (select 1 from public.products p where p.name = d.name);

-- Ingredientes (removable = se puede excluir)
insert into public.product_ingredients (product_id, name, removable)
select p.id, i.name, i.removable
from public.products p
join (values
  ('Hamburguesa Clásica','Carne',false),('Hamburguesa Clásica','Queso',true),
  ('Hamburguesa Clásica','Lechuga',true),('Hamburguesa Clásica','Tomate',true),
  ('Hamburguesa Clásica','Cebolla',true),
  ('Hamburguesa Especial','Carne',false),('Hamburguesa Especial','Queso',true),
  ('Hamburguesa Especial','Tocineta',true),('Hamburguesa Especial','Lechuga',true),
  ('Hamburguesa Especial','Tomate',true),('Hamburguesa Especial','Cebolla',true),
  ('Perro Sencillo','Salchicha',false),('Perro Sencillo','Queso',true),
  ('Perro Sencillo','Cebolla',true),('Perro Sencillo','Salsas',true),
  ('Perro Especial','Salchicha',false),('Perro Especial','Queso',true),
  ('Perro Especial','Tocineta',true),('Perro Especial','Papa ripio',true),
  ('Perro Especial','Salsas',true)
) as i(product, name, removable) on i.product = p.name
where p.is_demo
on conflict (product_id, name) do nothing;

-- Modificadores / adicionales
insert into public.product_modifiers (product_id, name, extra_price)
select p.id, m.name, m.price
from public.products p
join (values
  ('Hamburguesa Clásica','Queso extra',2000),('Hamburguesa Clásica','Tocineta extra',3000),
  ('Hamburguesa Especial','Queso extra',2000),('Hamburguesa Especial','Tocineta extra',3000),
  ('Perro Sencillo','Queso extra',2000),('Perro Especial','Queso extra',2000)
) as m(product, name, price) on m.product = p.name
where p.is_demo
on conflict (product_id, name) do nothing;

-- Alias para el interprete de texto (nombres en minuscula, como los escribiria el personal)
update public.products p set aliases = a.aliases
from (values
  ('Hamburguesa Clásica',  array['hamburguesa clasica','hamburguesa sencilla','clasica','sencilla','hamburguesas sencillas']),
  ('Hamburguesa Especial', array['hamburguesa especial','especial','hamburguesas especiales','especiales']),
  ('Perro Sencillo',       array['perro sencillo','perro','perros','perros sencillos','hot dog']),
  ('Perro Especial',       array['perro especial','perros especiales']),
  ('Papas Fritas',         array['papas','papitas','papas fritas','porcion de papas']),
  ('Aros de Cebolla',      array['aros','aros de cebolla']),
  ('Gaseosa',              array['gaseosa','gaseosas','coca cola','cocacola','coca','soda']),
  ('Jugo Natural',         array['jugo','jugos','jugo natural']),
  ('Combo Clásico',        array['combo clasico','combo sencillo','combo']),
  ('Combo Especial',       array['combo especial'])
) as a(name, aliases)
where p.name = a.name and p.is_demo;
