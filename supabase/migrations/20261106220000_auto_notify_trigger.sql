-- =====================================================================
-- Migracion 5: Disparador automatico para notificar al cliente
-- Se activa cada vez que un pedido pasa a 'entregado'
-- =====================================================================

create extension if not exists pg_net with schema extensions;

create or replace function public.trg_notify_order_delivered()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text := 'https://nhhufbltbcdwpnytzkgh.supabase.co/functions/v1/notify-order-status';
  v_anon text := 'sb_publishable_CGlLJUEIhsFOlvuuOEUSVg_xI_s5_Ey';
begin
  -- Solo se dispara cuando el pedido pasa a entregado
  if new.status = 'entregado' and (old.status is distinct from 'entregado') then
    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_anon,
        'apikey', v_anon
      ),
      body := jsonb_build_object(
        'order_id', new.id,
        'new_status', 'entregado'
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists on_order_delivered_notify on public.orders;
create trigger on_order_delivered_notify
  after update on public.orders
  for each row execute function public.trg_notify_order_delivered();
