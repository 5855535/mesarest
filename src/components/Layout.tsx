import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import {
  LayoutDashboard,
  Flame,
  Truck,
  UtensilsCrossed,
  Settings as SettingsIcon,
  LogOut,
  Download,
} from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { NAV } from '../auth/roles'

const ICONS: Record<string, any> = {
  '/panel': LayoutDashboard,
  '/cocina': Flame,
  '/despacho': Truck,
  '/catalogo': UtensilsCrossed,
  '/configuracion': SettingsIcon,
}

const ROLE_LABEL: Record<string, string> = {
  admin: 'Admin',
  caja: 'Caja',
  cocina: 'Cocina',
  despacho: 'Despacho',
}

export default function Layout() {
  const { profile, signOut } = useAuth()
  const items = NAV.filter((n) => profile && n.roles.includes(profile.role))

  const [installPrompt, setInstallPrompt] = useState<any>(null)
  useEffect(() => {
    const handler = (e: any) => {
      e.preventDefault()
      setInstallPrompt(e)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const installPwa = async () => {
    if (!installPrompt) return
    installPrompt.prompt()
    const { outcome } = await installPrompt.userChoice
    if (outcome === 'accepted') setInstallPrompt(null)
  }

  return (
    <div className="h-screen flex flex-col md:flex-row bg-zinc-950 text-zinc-100 overflow-hidden">
      {/* Sidebar minimalista con iconos */}
      <aside className="md:w-56 shrink-0 bg-zinc-900/90 backdrop-blur border-b md:border-b-0 md:border-r border-zinc-800 flex md:flex-col justify-between">
        <div className="flex md:flex-col flex-1 items-center md:items-stretch">
          {/* Logo BKJ.env con Isotipo @ */}
          <div className="px-4 py-3 md:py-5 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-zinc-100 text-zinc-950 font-black text-xs font-mono select-none">
                @
              </span>
              <span className="font-black text-base tracking-tight font-mono text-zinc-100">
                BKJ<span className="text-emerald-400 font-bold">.env</span>
              </span>
            </div>
            <span className="hidden md:inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
          </div>

          {/* Menú de navegación con iconos SVG */}
          <nav className="flex md:flex-col gap-1 px-2 md:px-2.5 overflow-x-auto py-1 flex-1">
            {items.map((i) => {
              const Icon = ICONS[i.to] || LayoutDashboard
              return (
                <NavLink
                  key={i.to}
                  to={i.to}
                  className={({ isActive }) =>
                    `whitespace-nowrap rounded-xl px-3 py-2 text-xs md:text-sm font-medium transition flex items-center gap-2.5 ${
                      isActive
                        ? 'bg-zinc-800 text-white font-semibold border border-zinc-700/80 shadow-sm'
                        : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850'
                    }`
                  }
                >
                  <Icon className="h-4 w-4 shrink-0 stroke-[2.2]" />
                  <span>{i.label}</span>
                </NavLink>
              )
            })}
          </nav>
        </div>

        {/* Pie con perfil y botón PWA */}
        <div className="hidden md:flex flex-col gap-2 p-3 border-t border-zinc-800 text-xs">
          {installPrompt && (
            <button
              onClick={installPwa}
              className="w-full rounded-xl bg-zinc-800 hover:bg-zinc-750 border border-zinc-700 text-zinc-200 py-2 font-semibold transition flex items-center justify-center gap-2"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Instalar en tablet</span>
            </button>
          )}

          <div className="flex items-center justify-between text-zinc-400 px-1 py-0.5">
            <span className="truncate max-w-[120px] font-medium">{profile?.full_name}</span>
            <span className="text-[10px] uppercase font-mono font-bold bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-400 border border-zinc-700/60">
              {profile ? ROLE_LABEL[profile.role] || profile.role : ''}
            </span>
          </div>

          <button
            onClick={signOut}
            className="w-full rounded-lg text-zinc-400 hover:text-red-400 hover:bg-zinc-800/80 py-1.5 font-medium transition text-left px-2 flex items-center justify-between"
          >
            <span>Cerrar sesión</span>
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>

        <button
          onClick={signOut}
          className="md:hidden px-3 text-zinc-400 hover:text-red-400 shrink-0"
          title="Cerrar sesión"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </aside>

      <main className="flex-1 p-3 sm:p-5 md:p-6 overflow-y-auto bg-zinc-950">
        <Outlet />
      </main>
    </div>
  )
}
