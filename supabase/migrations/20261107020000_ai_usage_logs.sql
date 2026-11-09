-- =====================================================================
-- Migracion: Registro de Telemetría y Consumo de IA (Observabilidad)
-- =====================================================================

create table if not exists public.ai_usage_logs (
  id                bigint generated always as identity primary key,
  created_at        timestamptz not null default now(),
  channel           text not null default 'telegram',
  provider          text not null, -- 'groq_whisper' | 'gemini_flash' | 'local_parser'
  operation         text not null, -- 'audio_transcription' | 'order_extraction' | 'menu_scan'
  prompt_tokens     int not null default 0,
  candidates_tokens int not null default 0,
  total_tokens      int not null default 0,
  audio_seconds     numeric(6,2) default 0,
  latency_ms        int not null default 0,
  success           boolean not null default true,
  error_message     text
);

create index if not exists idx_ai_usage_created on public.ai_usage_logs(created_at desc);
create index if not exists idx_ai_usage_provider on public.ai_usage_logs(provider, created_at desc);

alter table public.ai_usage_logs enable row level security;

-- Solo lectura para administradores (panel) y acceso completo para service_role
create policy ai_usage_admin_select on public.ai_usage_logs
  for select to authenticated
  using (public.app_role() = 'admin');

grant all on public.ai_usage_logs to service_role;
grant select on public.ai_usage_logs to authenticated;
