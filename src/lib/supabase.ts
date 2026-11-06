import { createClient } from '@supabase/supabase-js'

// Toma las variables del entorno del build o las claves públicas por defecto
const url =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined) ||
  'https://nhhufbltbcdwpnytzkgh.supabase.co'

const key =
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ||
  'sb_publishable_CGlLJUEIhsFOlvuuOEUSVg_xI_s5_Ey'

export const supabase = createClient(url, key)
