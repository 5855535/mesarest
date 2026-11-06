-- =====================================================================
-- RESTAURANT OS - Migracion 1: esquema base (un solo negocio)
-- Roles: admin, caja, cocina, despacho (pending = sin acceso)
-- Regla de oro: el frontend NUNCA escribe pedidos directamente.
-- Los pedidos se crean y cambian de estado solo con las funciones
-- create_order() y set_order_status(), que validan todo en la base.
-- =====================================================================

-- ---------- Utilidades ----------
create or replace function public.touch_updated_at()
returns trigger language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------- Perfiles / roles ----------
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  role        text not null default 'pending'
              check (role in ('admin','caja','cocina','despacho','pending')),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Rol del usuario actual (null si no tiene perfil activo)
create or replace function public.app_role()
returns text language sql stable security definer
set search_path = ''
as $$
  select role from public.profiles
  where id = (select auth.uid()) and active
$$;

create or replace function public.is_staff()
returns boolean language sql stable security definer
set search_path = ''
as $$
  select coalesce(public.app_role() in ('admin','caja','cocina','despacho'), false)
$$;

-- El PRIMER usuario que se registra es admin. Los demas quedan en
-- 'pending' (sin acceso) hasta que un admin les asigne rol.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    case when exists (select 1 from public.profiles) then 'pending' else 'admin' end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Configuracion del negocio (una sola fila) ----------
create table public.business_settings (
  id            boolean primary key default true check (id),
  name          text not null default 'Mi Restaurante',
  phone         text,
  address       text,
  currency      text not null default 'COP',
  timezone      text not null default 'America/Bogota',
  delivery_fee  numeric(10,2) not null default 0 check (delivery_fee >= 0),
  updated_at    timestamptz not null default now()
);
insert into public.business_settings default values;
create trigger trg_settings_updated before update on public.business_settings
  for each row execute function public.touch_updated_at();

-- ---------- Catalogo ----------
create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table public.products (
  id                 uuid primary key default gen_random_uuid(),
  category_id        uuid not null references public.categories(id),
  name               text not null,
  description        text,
  price              numeric(10,2) not null check (price >= 0),
  image_url          text,
  is_available       boolean not null default true,
  prep_time_minutes  int not null default 10 check (prep_time_minutes >= 0),
  sort_order         int not null default 0,
  is_demo            boolean not null default false, -- datos de demostracion
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index idx_products_category on public.products(category_id);
create trigger trg_products_updated before update on public.products
  for each row execute function public.touch_updated_at();

-- Ingredientes de cada producto (los "removable" se pueden excluir)
create table public.product_ingredients (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products(id) on delete cascade,
  name        text not null,
  removable   boolean not null default true,
  unique (product_id, name)
);

-- Modificadores / adicionales con precio extra
create table public.product_modifiers (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references public.products(id) on delete cascade,
  name          text not null,
  extra_price   numeric(10,2) not null default 0 check (extra_price >= 0),
  is_available  boolean not null default true,
  unique (product_id, name)
);

-- ---------- Clientes ----------
create table public.customers (
  id                  uuid primary key default gen_random_uuid(),
  full_name           text not null,
  phone               text,
  address             text,
  telegram_chat_id    bigint unique,
  telegram_username   text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_customers_updated before update on public.customers
  for each row execute function public.touch_updated_at();

-- ---------- Pedidos ----------
create sequence public.order_number_seq start 1001;

create table public.orders (
  id                uuid primary key default gen_random_uuid(),
  order_number      int not null unique default nextval('public.order_number_seq'),
  customer_id       uuid references public.customers(id),
  channel           text not null check (channel in ('pos','telegram','whatsapp')),
  status            text not null default 'nuevo'
                    check (status in ('nuevo','preparando','listo','recogido','entregado','cancelado')),
  delivery_type     text not null check (delivery_type in ('domicilio','recogida')),
  payment_method    text not null check (payment_method in ('efectivo','tarjeta','transferencia','otro')),
  delivery_address  text,
  notes             text,
  subtotal          numeric(12,2) not null default 0,
  delivery_fee      numeric(10,2) not null default 0,
  total             numeric(12,2) not null default 0,
  driver_name       text,
  idempotency_key   text unique,           -- evita pedidos duplicados
  created_by        uuid references auth.users(id),
  created_at        timestamptz not null default now(),
  preparing_at      timestamptz,
  ready_at          timestamptz,
  picked_up_at      timestamptz,
  delivered_at      timestamptz,
  cancelled_at      timestamptz,
  updated_at        timestamptz not null default now(),
  check (delivery_type <> 'domicilio' or delivery_address is not null)
);
create index idx_orders_status_created on public.orders(status, created_at desc);
create index idx_orders_created on public.orders(created_at desc);
create index idx_orders_customer on public.orders(customer_id);
create trigger trg_orders_updated before update on public.orders
  for each row execute function public.touch_updated_at();

create table public.order_items (
  id                    uuid primary key default gen_random_uuid(),
  order_id              uuid not null references public.orders(id) on delete cascade,
  product_id            uuid references public.products(id) on delete set null,
  product_name          text not null,            -- copia del nombre al momento de la venta
  unit_price            numeric(10,2) not null,   -- copia del precio al momento de la venta
  quantity              int not null check (quantity between 1 and 99),
  notes                 text,
  excluded_ingredients  text[] not null default '{}',
  line_total            numeric(12,2) not null
);
create index idx_order_items_order on public.order_items(order_id);

create table public.order_item_modifiers (
  id             uuid primary key default gen_random_uuid(),
  order_item_id  uuid not null references public.order_items(id) on delete cascade,
  name           text not null,
  extra_price    numeric(10,2) not null default 0
);
create index idx_oim_item on public.order_item_modifiers(order_item_id);

create table public.order_status_history (
  id          bigint generated always as identity primary key,
  order_id    uuid not null references public.orders(id) on delete cascade,
  from_status text,
  to_status   text not null,
  changed_by  uuid references auth.users(id),
  note        text,
  changed_at  timestamptz not null default now()
);
create index idx_osh_order on public.order_status_history(order_id);

-- ---------- Auditoria de cambios importantes ----------
create table public.audit_log (
  id          bigint generated always as identity primary key,
  table_name  text not null,
  record_id   text,
  action      text not null,
  old_data    jsonb,
  new_data    jsonb,
  changed_by  uuid,
  changed_at  timestamptz not null default now()
);

create or replace function public.audit_changes()
returns trigger language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and to_jsonb(new) = to_jsonb(old) then
    return new;
  end if;
  insert into public.audit_log (table_name, record_id, action, old_data, new_data, changed_by)
  values (
    tg_table_name,
    coalesce(to_jsonb(new)->>'id', to_jsonb(old)->>'id'),
    tg_op,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end,
    (select auth.uid())
  );
  return coalesce(new, old);
end;
$$;

create trigger trg_audit_products after insert or update or delete on public.products
  for each row execute function public.audit_changes();
create trigger trg_audit_profiles after update or delete on public.profiles
  for each row execute function public.audit_changes();
create trigger trg_audit_settings after update on public.business_settings
  for each row execute function public.audit_changes();

-- =====================================================================
-- FUNCIONES DE NEGOCIO (unica via para crear / cambiar pedidos)
-- =====================================================================

-- Crea un pedido. Los PRECIOS siempre se leen de la base de datos;
-- cualquier precio que mande el cliente se ignora.
-- p_items: [{ "product_id": uuid, "quantity": 2, "notes": "...",
--             "excluded_ingredients": ["cebolla"], "modifier_ids": [uuid] }]
-- Pueden llamarla: admin, caja (POS) y el backend (service_role / Telegram).
create or replace function public.create_order(
  p_channel          text,
  p_delivery_type    text,
  p_payment_method   text,
  p_customer_id      uuid,
  p_delivery_address text,
  p_notes            text,
  p_items            jsonb,
  p_idempotency_key  text default null
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_role      text := public.app_role();
  v_order_id  uuid;
  v_item      jsonb;
  v_prod      record;
  v_mod       record;
  v_item_id   uuid;
  v_qty       int;
  v_mods_sum  numeric;
  v_line      numeric;
  v_subtotal  numeric := 0;
  v_fee       numeric := 0;
  v_excl      text;
  v_excl_ok   text;
  v_excl_list text[];
  v_mod_id    text;
begin
  -- Autorizacion: sin usuario = backend con service_role (anon no tiene permiso de ejecutar)
  if v_uid is not null and coalesce(v_role, '') not in ('admin', 'caja') then
    raise exception 'No autorizado para crear pedidos' using errcode = '42501';
  end if;

  -- Idempotencia: si ya existe un pedido con esa clave, devolverlo
  if p_idempotency_key is not null then
    select id into v_order_id from public.orders where idempotency_key = p_idempotency_key;
    if found then return v_order_id; end if;
  end if;

  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'El pedido no tiene productos';
  end if;
  if jsonb_array_length(p_items) > 50 then
    raise exception 'Demasiados productos en un pedido';
  end if;
  if p_delivery_type = 'domicilio' and coalesce(btrim(p_delivery_address), '') = '' then
    raise exception 'El domicilio requiere una direccion';
  end if;
  if p_customer_id is not null
     and not exists (select 1 from public.customers where id = p_customer_id) then
    raise exception 'Cliente no existe';
  end if;

  if p_delivery_type = 'domicilio' then
    select delivery_fee into v_fee from public.business_settings;
  end if;

  begin
    insert into public.orders (customer_id, channel, delivery_type, payment_method,
                               delivery_address, notes, delivery_fee, idempotency_key, created_by)
    values (p_customer_id, p_channel, p_delivery_type, p_payment_method,
            nullif(btrim(p_delivery_address), ''), nullif(btrim(p_notes), ''),
            coalesce(v_fee, 0), p_idempotency_key, v_uid)
    returning id into v_order_id;
  exception when unique_violation then
    -- Otro proceso creo el mismo pedido al mismo tiempo
    select id into v_order_id from public.orders where idempotency_key = p_idempotency_key;
    if found then return v_order_id; end if;
    raise;
  end;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'quantity')::int;
    if v_qty is null or v_qty < 1 or v_qty > 99 then
      raise exception 'Cantidad invalida';
    end if;

    select p.id, p.name, p.price, p.is_available, c.is_active as cat_active
      into v_prod
      from public.products p
      join public.categories c on c.id = p.category_id
     where p.id = (v_item->>'product_id')::uuid;

    if not found then
      raise exception 'Producto no existe';
    end if;
    if not v_prod.is_available or not v_prod.cat_active then
      raise exception 'Producto no disponible: %', v_prod.name;
    end if;

    -- Ingredientes excluidos: solo los marcados como removibles
    v_excl_list := '{}';
    if jsonb_typeof(v_item->'excluded_ingredients') = 'array' then
      for v_excl in select jsonb_array_elements_text(v_item->'excluded_ingredients') loop
        select name into v_excl_ok from public.product_ingredients
         where product_id = v_prod.id and removable and lower(name) = lower(btrim(v_excl));
        if not found then
          raise exception 'Ingrediente no removible o inexistente: % (%)', v_excl, v_prod.name;
        end if;
        v_excl_list := v_excl_list || v_excl_ok;
      end loop;
    end if;

    insert into public.order_items (order_id, product_id, product_name, unit_price, quantity,
                                    notes, excluded_ingredients, line_total)
    values (v_order_id, v_prod.id, v_prod.name, v_prod.price, v_qty,
            nullif(btrim(v_item->>'notes'), ''), v_excl_list, 0)
    returning id into v_item_id;

    -- Modificadores: deben pertenecer al producto y estar disponibles
    v_mods_sum := 0;
    if jsonb_typeof(v_item->'modifier_ids') = 'array' then
      for v_mod_id in select jsonb_array_elements_text(v_item->'modifier_ids') loop
        select name, extra_price into v_mod from public.product_modifiers
         where id = v_mod_id::uuid and product_id = v_prod.id and is_available;
        if not found then
          raise exception 'Modificador invalido para %', v_prod.name;
        end if;
        insert into public.order_item_modifiers (order_item_id, name, extra_price)
        values (v_item_id, v_mod.name, v_mod.extra_price);
        v_mods_sum := v_mods_sum + v_mod.extra_price;
      end loop;
    end if;

    v_line := (v_prod.price + v_mods_sum) * v_qty;
    update public.order_items set line_total = v_line where id = v_item_id;
    v_subtotal := v_subtotal + v_line;
  end loop;

  update public.orders
     set subtotal = v_subtotal, total = v_subtotal + delivery_fee
   where id = v_order_id;

  insert into public.order_status_history (order_id, from_status, to_status, changed_by)
  values (v_order_id, null, 'nuevo', v_uid);

  return v_order_id;
end;
$$;

-- Cambia el estado de un pedido respetando que rol puede hacer cada paso.
create or replace function public.set_order_status(
  p_order_id   uuid,
  p_new_status text,
  p_note       text default null
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_role  text := public.app_role();
  v_order record;
  v_ok    boolean;
begin
  if v_role is null then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  select id, status, delivery_type into v_order
    from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Pedido no existe';
  end if;
  if p_new_status not in ('nuevo','preparando','listo','recogido','entregado','cancelado') then
    raise exception 'Estado invalido';
  end if;
  if v_order.status = p_new_status then
    return;
  end if;

  v_ok := case v_role
    when 'admin' then true
    when 'cocina' then
         (v_order.status = 'nuevo'      and p_new_status = 'preparando')
      or (v_order.status = 'preparando' and p_new_status in ('listo', 'nuevo'))
      or (v_order.status = 'listo'      and p_new_status = 'preparando')
    when 'despacho' then
         (v_order.status = 'listo' and p_new_status = 'recogido' and v_order.delivery_type = 'domicilio')
      or (v_order.status = 'listo' and p_new_status = 'entregado')
      or (v_order.status = 'recogido' and p_new_status = 'entregado')
    when 'caja' then
         (v_order.status in ('nuevo', 'preparando') and p_new_status = 'cancelado')
      or (v_order.status = 'listo' and p_new_status = 'entregado')
    else false
  end;

  if not coalesce(v_ok, false) then
    raise exception 'Tu rol (%) no puede pasar el pedido de % a %', v_role, v_order.status, p_new_status
      using errcode = '42501';
  end if;

  update public.orders set
    status       = p_new_status,
    preparing_at = case when p_new_status = 'preparando' and preparing_at is null then now() else preparing_at end,
    ready_at     = case when p_new_status = 'listo' then now() else ready_at end,
    picked_up_at = case when p_new_status = 'recogido' then now() else picked_up_at end,
    delivered_at = case when p_new_status = 'entregado' then now() else delivered_at end,
    cancelled_at = case when p_new_status = 'cancelado' then now() else cancelled_at end
  where id = p_order_id;

  insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
  values (p_order_id, v_order.status, p_new_status, v_uid, p_note);
end;
$$;

-- Asignar domiciliario (despacho o admin)
create or replace function public.assign_driver(p_order_id uuid, p_driver text)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if coalesce(public.app_role(), '') not in ('admin', 'despacho') then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  update public.orders set driver_name = nullif(btrim(p_driver), '') where id = p_order_id;
  if not found then
    raise exception 'Pedido no existe';
  end if;
end;
$$;

-- =====================================================================
-- PERMISOS Y ROW LEVEL SECURITY
-- =====================================================================

-- Anonimos: sin acceso a nada en public
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- Los pedidos solo se escriben via funciones (security definer)
revoke insert, update, delete, truncate on
  public.orders, public.order_items, public.order_item_modifiers,
  public.order_status_history, public.audit_log
from authenticated;

-- Funciones: solo usuarios autenticados y el backend
revoke execute on all functions in schema public from public, anon;
grant execute on function public.app_role()        to authenticated, service_role;
grant execute on function public.is_staff()        to authenticated, service_role;
grant execute on function public.create_order(text,text,text,uuid,text,text,jsonb,text)
  to authenticated, service_role;
grant execute on function public.set_order_status(uuid,text,text) to authenticated, service_role;
grant execute on function public.assign_driver(uuid,text)        to authenticated, service_role;

alter table public.profiles             enable row level security;
alter table public.business_settings    enable row level security;
alter table public.categories           enable row level security;
alter table public.products             enable row level security;
alter table public.product_ingredients  enable row level security;
alter table public.product_modifiers    enable row level security;
alter table public.customers            enable row level security;
alter table public.orders               enable row level security;
alter table public.order_items          enable row level security;
alter table public.order_item_modifiers enable row level security;
alter table public.order_status_history enable row level security;
alter table public.audit_log            enable row level security;

-- profiles: cada quien ve el suyo; admin ve y edita todos
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.app_role() = 'admin');
create policy profiles_admin_update on public.profiles for update to authenticated
  using (public.app_role() = 'admin') with check (public.app_role() = 'admin');

-- business_settings
create policy settings_select on public.business_settings for select to authenticated
  using (public.is_staff());
create policy settings_admin_update on public.business_settings for update to authenticated
  using (public.app_role() = 'admin') with check (public.app_role() = 'admin');

-- Catalogo: lectura para todo el personal, escritura solo admin
create policy categories_select on public.categories for select to authenticated
  using (public.is_staff());
create policy categories_admin_write on public.categories for all to authenticated
  using (public.app_role() = 'admin') with check (public.app_role() = 'admin');

create policy products_select on public.products for select to authenticated
  using (public.is_staff());
create policy products_admin_write on public.products for all to authenticated
  using (public.app_role() = 'admin') with check (public.app_role() = 'admin');

create policy ingredients_select on public.product_ingredients for select to authenticated
  using (public.is_staff());
create policy ingredients_admin_write on public.product_ingredients for all to authenticated
  using (public.app_role() = 'admin') with check (public.app_role() = 'admin');

create policy modifiers_select on public.product_modifiers for select to authenticated
  using (public.is_staff());
create policy modifiers_admin_write on public.product_modifiers for all to authenticated
  using (public.app_role() = 'admin') with check (public.app_role() = 'admin');

-- Clientes: cocina NO ve datos de clientes
create policy customers_select on public.customers for select to authenticated
  using (public.app_role() in ('admin', 'caja', 'despacho'));
create policy customers_insert on public.customers for insert to authenticated
  with check (public.app_role() in ('admin', 'caja'));
create policy customers_update on public.customers for update to authenticated
  using (public.app_role() in ('admin', 'caja'))
  with check (public.app_role() in ('admin', 'caja'));
create policy customers_admin_delete on public.customers for delete to authenticated
  using (public.app_role() = 'admin');

-- Pedidos: solo lectura directa para el personal (escritura via funciones)
create policy orders_select on public.orders for select to authenticated
  using (public.is_staff());
create policy order_items_select on public.order_items for select to authenticated
  using (public.is_staff());
create policy oim_select on public.order_item_modifiers for select to authenticated
  using (public.is_staff());
create policy osh_select on public.order_status_history for select to authenticated
  using (public.is_staff());

-- Auditoria: solo admin
create policy audit_admin_select on public.audit_log for select to authenticated
  using (public.app_role() = 'admin');

-- ---------- Realtime ----------
alter publication supabase_realtime add table public.orders;
