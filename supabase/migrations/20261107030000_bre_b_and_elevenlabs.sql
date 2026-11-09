-- =====================================================================
-- Migracion: Soporte para pagos Bre-B / Transferencia, Anti-fraude de comprobantes
-- y configuración de voz personalizada con ElevenLabs
-- =====================================================================

alter table public.business_settings
  add column if not exists bre_b_enabled boolean not null default false,
  add column if not exists bre_b_key text,
  add column if not exists bre_b_holder_name text,
  add column if not exists bre_b_bank_name text default 'Bre-B / Nequi / Bancolombia',
  add column if not exists elevenlabs_api_key text,
  add column if not exists elevenlabs_voice_id text default 'pNInz6obpgDQGcFmaJgB';

-- Tabla para prevenir estafas y reciclaje de comprobantes de pago
create table if not exists public.payment_receipts (
  id                bigint generated always as identity primary key,
  order_id          uuid references public.orders(id) on delete set null,
  reference_number  text not null unique,
  amount            numeric(12,2) not null,
  bank              text,
  payer_name        text,
  receipt_date      text,
  raw_ocr           jsonb,
  created_at        timestamptz not null default now()
);

create index if not exists idx_payment_receipts_ref on public.payment_receipts(reference_number);

alter table public.payment_receipts enable row level security;

create policy payment_receipts_admin_select on public.payment_receipts
  for select to authenticated
  using (public.app_role() = 'admin');

grant all on public.payment_receipts to service_role;
grant select on public.payment_receipts to authenticated;

-- Permitir el paso awaiting_payment_receipt en telegram_sessions
alter table public.telegram_sessions drop constraint if exists telegram_sessions_step_check;
alter table public.telegram_sessions add constraint telegram_sessions_step_check
  check (step in ('idle', 'awaiting_confirmation', 'awaiting_address', 'awaiting_payment_receipt'));
