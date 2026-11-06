export type Role = 'admin' | 'caja' | 'cocina' | 'despacho' | 'pending'

export interface Profile {
  id: string
  full_name: string | null
  role: Role
  active: boolean
}

export interface Category {
  id: string
  name: string
  sort_order: number
  is_active: boolean
}

export interface Product {
  id: string
  category_id: string
  name: string
  description: string | null
  price: number
  image_url: string | null
  is_available: boolean
  prep_time_minutes: number
  is_demo: boolean
  aliases: string[]
}

export interface Ingredient {
  id: string
  name: string
  removable: boolean
}

export interface Modifier {
  id: string
  name: string
  extra_price: number
  is_available: boolean
}

export interface ProductFull extends Product {
  product_ingredients: Ingredient[]
  product_modifiers: Modifier[]
}

export interface Customer {
  id: string
  full_name: string
  phone: string | null
  address: string | null
}

export interface CartLine {
  key: string
  product: ProductFull
  quantity: number
  excluded: string[]
  modifiers: Modifier[]
  notes: string
}

export const lineTotal = (l: CartLine) =>
  (l.product.price + l.modifiers.reduce((s, m) => s + m.extra_price, 0)) * l.quantity
