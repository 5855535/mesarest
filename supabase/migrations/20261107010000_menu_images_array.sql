-- =====================================================================
-- Migracion: Soporte para hasta 3 imagenes de la carta/menu
-- =====================================================================

alter table public.business_settings
  add column if not exists menu_images jsonb not null default '[]'::jsonb;
