import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { homeFor } from '../auth/roles'
import type { Role } from '../lib/types'

export function Spinner() {
  return (
    <div className="min-h-screen grid place-items-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-stone-300 border-t-brand-600" />
    </div>
  )
}

/** Exige sesión iniciada y perfil activo con rol asignado. */
export function RequireStaff() {
  const { session, profile, loading } = useAuth()
  if (loading) return <Spinner />
  if (!session) return <Navigate to="/login" replace />
  if (!profile || !profile.active || profile.role === 'pending')
    return <Navigate to="/sin-acceso" replace />
  return <Outlet />
}

/** Exige uno de los roles indicados; si no, redirige a la pantalla propia del rol. */
export function RequireRole({ roles }: { roles: Role[] }) {
  const { profile } = useAuth()
  if (!profile) return null
  if (!roles.includes(profile.role)) return <Navigate to={homeFor(profile.role)} replace />
  return <Outlet />
}
