-- =====================================================================
-- Migracion 3: Sesiones y borradores del bot de Telegram
-- Guarda el pedido en preparacion antes de que el usuario lo confirme
-- =====================================================================

create table if not exists public.telegram_sessions (
  chat_id       bigint primary key,
  step          text not null default 'idle' check (step in ('idle', 'awaiting_confirmation', 'awaiting_address')),
  draft_order   jsonb,
  customer_name text,
  username      text,
  updated_at    timestamptz not null default now()
);

-- Solo service_role accede a esta tabla (el bot corre en el backend)
alter table public.telegram_sessions enable row level security;
revoke all on public.telegram_sessions from anon, authenticated;
grant all on public.telegram_sessions to service_role;
