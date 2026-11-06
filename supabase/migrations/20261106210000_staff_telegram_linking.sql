-- =====================================================================
-- Migracion 4: Vinculacion de Personal con Telegram
-- Permite distinguir mesero/caja de un cliente comun
-- =====================================================================

alter table public.profiles
  add column if not exists telegram_chat_id bigint unique,
  add column if not exists telegram_username text;

-- Codigos de vinculacion temporal
create table if not exists public.staff_link_codes (
  code        text primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  role        text not null check (role in ('admin', 'caja', 'cocina', 'despacho')),
  expires_at  timestamptz not null default (now() + interval '15 minutes'),
  created_at  timestamptz not null default now()
);

alter table public.staff_link_codes enable row level security;
revoke all on public.staff_link_codes from anon, authenticated;
grant all on public.staff_link_codes to service_role;

-- Solo un admin puede generar codigos desde el panel
create policy staff_codes_admin on public.staff_link_codes
  for all to authenticated
  using (public.app_role() = 'admin')
  with check (public.app_role() = 'admin');

-- Generar codigo de vinculacion (llamado desde el panel web por admin)
create or replace function public.generate_staff_link_code(p_target_user_id uuid default null)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_role text := public.app_role();
  v_target uuid := coalesce(p_target_user_id, v_uid);
  v_target_role text;
  v_code text;
begin
  if v_role <> 'admin' then
    raise exception 'Solo administradores pueden generar codigos de vinculacion' using errcode = '42501';
  end if;

  select role into v_target_role from public.profiles where id = v_target and active;
  if not found then
    raise exception 'Usuario no encontrado o inactivo';
  end if;

  -- Generar codigo legible tipo MESA-4821
  v_code := 'REST-' || lpad((floor(random() * 9000) + 1000)::text, 4, '0');

  -- Limpiar codigos vencidos o previos de ese usuario
  delete from public.staff_link_codes where user_id = v_target or expires_at < now();

  insert into public.staff_link_codes (code, user_id, role)
  values (v_code, v_target, v_target_role);

  return v_code;
end;
$$;

-- Funcion que el bot ejecuta cuando recibe /vincular CODIGO
create or replace function public.link_telegram_staff(
  p_code     text,
  p_chat_id  bigint,
  p_username text default null
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_entry record;
  v_name  text;
begin
  select user_id, role into v_entry
    from public.staff_link_codes
   where upper(btrim(code)) = upper(btrim(p_code))
     and expires_at > now();

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Código inválido o expirado. Solicita uno nuevo al administrador.');
  end if;

  -- Asociar al perfil
  update public.profiles
     set telegram_chat_id = p_chat_id,
         telegram_username = p_username
   where id = v_entry.user_id
   returning full_name into v_name;

  -- Quemar el codigo (un solo uso)
  delete from public.staff_link_codes where upper(code) = upper(btrim(p_code));

  return jsonb_build_object(
    'ok', true,
    'full_name', v_name,
    'role', v_entry.role
  );
end;
$$;

-- Consultar si un chat_id es personal activo
create or replace function public.get_staff_by_telegram(p_chat_id bigint)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_rec record;
begin
  select id, full_name, role into v_rec
    from public.profiles
   where telegram_chat_id = p_chat_id and active;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'id', v_rec.id,
    'full_name', v_rec.full_name,
    'role', v_rec.role
  );
end;
$$;

-- Desvincular Telegram
create or replace function public.unlink_telegram_staff(p_chat_id bigint)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.profiles
     set telegram_chat_id = null,
         telegram_username = null
   where telegram_chat_id = p_chat_id;
  return found;
end;
$$;

grant execute on function public.generate_staff_link_code(uuid) to authenticated, service_role;
grant execute on function public.link_telegram_staff(text, bigint, text) to authenticated, service_role;
grant execute on function public.get_staff_by_telegram(bigint) to authenticated, service_role;
grant execute on function public.unlink_telegram_staff(bigint) to authenticated, service_role;
