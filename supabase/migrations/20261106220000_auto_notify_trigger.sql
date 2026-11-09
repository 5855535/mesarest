-- =====================================================================
-- Migracion 5: Disparador automatico para notificar al cliente
-- Se activa:
--   * Cuando un pedido a domicilio pasa a 'recogido' (en camino)
--   * Cuando un pedido para recoger o en mesa pasa a 'listo'
-- =====================================================================

create extension if not exists pg_net with schema extensions;

-- Campos opcionales para configurar webhook de notificaciones sin hardcodear URLs
alter table public.business_settings
  add column if not exists notify_function_url text,
  add column if not exists notify_function_key text;

create or replace function public.trg_notify_order_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_key text;
  v_should_notify boolean := false;
begin
  -- Reglas de disparo:
  -- 1. Domicilio: se notifica cuando pasa a 'recogido' (el repartidor sale con el pedido en camino)
  -- 2. Recogida o Mesa: se notifica cuando pasa a 'listo' (el pedido ya esta preparado)
  if new.delivery_type = 'domicilio' and new.status = 'recogido' and (old.status is distinct from 'recogido') then
    v_should_notify := true;
  elsif new.delivery_type in ('recogida', 'mesa') and new.status = 'listo' and (old.status is distinct from 'listo') then
    v_should_notify := true;
  end if;

  if not v_should_notify then
    return new;
  end if;

  -- Obtener configuracion dinamicamente:
  -- 1. Parametros del sistema en PostgreSQL si estan configurados
  -- 2. Columnas en business_settings
  select
    coalesce(
      nullif(current_setting('app.settings.edge_functions_url', true), ''),
      s.notify_function_url
    ),
    coalesce(
      nullif(current_setting('app.settings.anon_key', true), ''),
      s.notify_function_key
    )
  into v_url, v_key
  from public.business_settings s
  limit 1;

  -- Si no hay URL configurada, se omite limpiamente sin interrumpir la transaccion
  if v_url is null or btrim(v_url) = '' then
    return new;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', case when v_key is not null and btrim(v_key) <> '' then 'Bearer ' || v_key else '' end,
      'apikey', coalesce(v_key, '')
    ),
    body := jsonb_build_object(
      'order_id', new.id,
      'new_status', new.status,
      'delivery_type', new.delivery_type
    )
  );

  return new;
exception when others then
  -- Garantizar que un fallo de red o del endpoint externo nunca aborte la transaccion de pedido
  raise warning 'Error en llamada net.http_post de notificacion: %', sqlerrm;
  return new;
end;
$$;

-- Eliminar trigger anterior si existia
drop trigger if exists on_order_delivered_notify on public.orders;
drop trigger if exists on_order_status_notify on public.orders;

create trigger on_order_status_notify
  after update on public.orders
  for each row execute function public.trg_notify_order_status();
