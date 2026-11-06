-- =====================================================================
-- Migracion 2: pedidos en mesa + alias de productos
--  * delivery_type admite 'mesa' (con numero/nombre de mesa obligatorio)
--  * products.aliases: nombres alternativos ("coca cola", "sencilla")
--    que usara el interprete de texto (caja rapida y bot de Telegram)
--  * create_order recibe p_table_label
-- =====================================================================

alter table public.orders drop constraint orders_delivery_type_check;
alter table public.orders add constraint orders_delivery_type_check
  check (delivery_type in ('mesa', 'recogida', 'domicilio'));

alter table public.orders add column table_label text;
alter table public.orders add constraint orders_mesa_requires_table
  check (delivery_type <> 'mesa' or coalesce(btrim(table_label), '') <> '');

alter table public.products add column aliases text[] not null default '{}';

-- Se reemplaza la funcion (cambia la firma, por eso se borra la anterior)
drop function public.create_order(text, text, text, uuid, text, text, jsonb, text);

create or replace function public.create_order(
  p_channel          text,
  p_delivery_type    text,
  p_payment_method   text,
  p_customer_id      uuid,
  p_delivery_address text,
  p_notes            text,
  p_items            jsonb,
  p_idempotency_key  text default null,
  p_table_label      text default null
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
  -- Autorizacion: sin usuario = backend con service_role (anon no puede ejecutar)
  if v_uid is not null and coalesce(v_role, '') not in ('admin', 'caja') then
    raise exception 'No autorizado para crear pedidos' using errcode = '42501';
  end if;

  -- Idempotencia
  if p_idempotency_key is not null then
    select id into v_order_id from public.orders where idempotency_key = p_idempotency_key;
    if found then return v_order_id; end if;
  end if;

  if p_delivery_type not in ('mesa', 'recogida', 'domicilio') then
    raise exception 'Tipo de entrega invalido';
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
  if p_delivery_type = 'mesa' and coalesce(btrim(p_table_label), '') = '' then
    raise exception 'El pedido en mesa requiere el numero de mesa';
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
                               delivery_address, table_label, notes, delivery_fee,
                               idempotency_key, created_by)
    values (p_customer_id, p_channel, p_delivery_type, p_payment_method,
            case when p_delivery_type = 'domicilio' then nullif(btrim(p_delivery_address), '') end,
            case when p_delivery_type = 'mesa' then btrim(p_table_label) end,
            nullif(btrim(p_notes), ''), coalesce(v_fee, 0), p_idempotency_key, v_uid)
    returning id into v_order_id;
  exception when unique_violation then
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

revoke execute on function public.create_order(text,text,text,uuid,text,text,jsonb,text,text)
  from public, anon;
grant execute on function public.create_order(text,text,text,uuid,text,text,jsonb,text,text)
  to authenticated, service_role;
