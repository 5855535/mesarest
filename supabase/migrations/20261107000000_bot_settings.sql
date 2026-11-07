-- =====================================================================
-- Migracion: Opciones de Inteligencia Artificial y Bot
-- =====================================================================

alter table public.business_settings
  add column if not exists voice_replies_enabled boolean not null default true,
  add column if not exists memory_reorder_enabled boolean not null default true,
  add column if not exists menu_image_url text;
