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
  PanelLeftClose,
  PanelLeftOpen,
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

  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('sidebar-collapsed') === '1',
  )
  const [installPrompt, setInstallPrompt] = useState<any>(null)

  useEffect(() => {
    const handler = (e: any) => {
      e.preventDefault()
      setInstallPrompt(e)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev
      localStorage.setItem('sidebar-collapsed', next ? '1' : '0')
      return next
    })
  }

  const installPwa = async () => {
    if (!installPrompt) return
    installPrompt.prompt()
    const { outcome } = await installPrompt.userChoice
    if (outcome === 'accepted') setInstallPrompt(null)
  }

  return (
    <div className="h-screen flex flex-col md:flex-row bg-zinc-950 text-zinc-100 overflow-hidden">
      {/* Sidebar con opción de minimizar */}
      <aside
        className={`shrink-0 bg-zinc-900/90 backdrop-blur border-b md:border-b-0 md:border-r border-zinc-800 flex md:flex-col justify-between transition-all duration-200 ease-in-out ${
          collapsed ? 'md:w-16' : 'md:w-56'
        }`}
      >
        <div className="flex md:flex-col flex-1 items-center md:items-stretch">
          {/* Cabecera del Sidebar con Logo y botón de minimizar */}
          <div
            className={`py-3 md:py-4 flex items-center shrink-0 border-b border-zinc-800/80 ${
              collapsed
                ? 'px-2 md:justify-center'
                : 'px-4 justify-between'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-zinc-100 text-zinc-950 font-black text-xs font-mono select-none shadow-sm">
                @
              </span>
              {!collapsed && (
                <span className="font-black text-base tracking-tight font-mono text-zinc-100">
                  BKJ<span className="text-emerald-400 font-bold">.env</span>
                </span>
              )}
            </div>

            {/* Botón para minimizar / expandir sidebar (visible en tablets y desktop) */}
            <button
              onClick={toggleCollapsed}
              title={collapsed ? 'Expandir menú lateral' : 'Minimizar menú lateral'}
              className={`hidden md:flex p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition ${
                collapsed ? 'mt-2' : ''
              }`}
            >
              {collapsed ? (
                <PanelLeftOpen className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </button>
          </div>

          {/* Menú de navegación con iconos SVG */}
          <nav className="flex md:flex-col gap-1 px-2 py-2 overflow-x-auto flex-1">
            {items.map((i) => {
              const Icon = ICONS[i.to] || LayoutDashboard
              return (
                <NavLink
                  key={i.to}
                  to={i.to}
                  title={collapsed ? i.label : undefined}
                  className={({ isActive }) =>
                    `whitespace-nowrap rounded-xl transition flex items-center ${
                      collapsed
                        ? 'p-2.5 md:justify-center'
                        : 'px-3 py-2.5 text-xs md:text-sm font-medium gap-2.5'
                    } ${
                      isActive
                        ? 'bg-zinc-800 text-white font-semibold border border-zinc-700/80 shadow-sm'
                        : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850'
                    }`
                  }
                >
                  <Icon className="h-4 w-4 shrink-0 stroke-[2.2]" />
                  {!collapsed && <span>{i.label}</span>}
                </NavLink>
              )
            })}
          </nav>
        </div>

        {/* Pie con perfil, PWA y botón de cerrar sesión */}
        <div
          className={`hidden md:flex flex-col gap-2 p-2.5 border-t border-zinc-800 text-xs ${
            collapsed ? 'items-center' : ''
          }`}
        >
          {installPrompt && !collapsed && (
            <button
              onClick={installPwa}
              className="w-full rounded-xl bg-zinc-800 hover:bg-zinc-750 border border-zinc-700 text-zinc-200 py-2 font-semibold transition flex items-center justify-center gap-2"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Instalar en tablet</span>
            </button>
          )}

          {!collapsed ? (
            <div className="flex items-center justify-between text-zinc-400 px-1 py-0.5">
              <span className="truncate max-w-[120px] font-medium">{profile?.full_name}</span>
              <span className="text-[10px] uppercase font-mono font-bold bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-400 border border-zinc-700/60">
                {profile ? ROLE_LABEL[profile.role] || profile.role : ''}
              </span>
            </div>
          ) : (
            <div
              title={`${profile?.full_name} (${profile ? ROLE_LABEL[profile.role] || profile.role : ''})`}
              className="h-7 w-7 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-[10px] font-mono font-bold text-zinc-300 select-none"
            >
              {profile?.full_name?.charAt(0).toUpperCase() || 'U'}
            </div>
          )}

          <button
            onClick={signOut}
            title="Cerrar sesión"
            className={`rounded-lg text-zinc-400 hover:text-red-400 hover:bg-zinc-800/80 transition flex items-center ${
              collapsed
                ? 'p-2 justify-center'
                : 'w-full py-1.5 px-2 font-medium justify-between'
            }`}
          >
            {!collapsed && <span>Cerrar sesión</span>}
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

      <main className="flex-1 p-2.5 sm:p-4 md:p-6 overflow-y-auto bg-zinc-950">
        <Outlet />
      </main>
    </div>
  )
}
