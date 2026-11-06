import type { Role } from '../lib/types'

export interface NavItem {
  to: string
  label: string
  roles: Role[]
}

export const NAV: NavItem[] = [
  { to: '/panel', label: 'Panel', roles: ['admin'] },
  { to: '/cocina', label: 'Cocina', roles: ['admin', 'cocina'] },
  { to: '/despacho', label: 'Despacho', roles: ['admin', 'despacho'] },
  { to: '/catalogo', label: 'Catálogo', roles: ['admin'] },
  { to: '/configuracion', label: 'Configuración', roles: ['admin'] },
]

export const homeFor = (role: Role): string =>
  NAV.find((n) => n.roles.includes(role))?.to ?? '/sin-acceso'
