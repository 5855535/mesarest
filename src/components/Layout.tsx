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
  Share,
  PlusSquare,
  X,
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
  const [isIos, setIsIos] = useState(false)
  const [showIosGuide, setShowIosGuide] = useState(false)

  useEffect(() => {
    const handler = (e: any) => {
      e.preventDefault()
      setInstallPrompt(e)
    }
    window.addEventListener('beforeinstallprompt', handler)

    // Detectar si es iPhone / iPad (iOS) no instalado en standalone
    const isIosDevice =
      typeof navigator !== 'undefined' &&
      /iPad|iPhone|iPod/.test(navigator.userAgent) &&
      !(window as any).MSStream
    const isStandalone =
      (window.navigator as any).standalone === true ||
      window.matchMedia('(display-mode: standalone)').matches

    if (isIosDevice && !isStandalone) {
      setIsIos(true)
    }

    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev
      localStorage.setItem('sidebar-collapsed', next ? '1' : '0')
      return next
    })
  }

  const handleInstallClick = async () => {
    if (isIos) {
      setShowIosGuide(true)
      return
    }
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
              collapsed ? 'px-2 md:justify-center' : 'px-4 justify-between'
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
          {(installPrompt || isIos) && !collapsed && (
            <button
              onClick={handleInstallClick}
              className="w-full rounded-xl bg-zinc-800 hover:bg-zinc-750 border border-zinc-700 text-zinc-200 py-2 font-semibold transition flex items-center justify-center gap-2"
            >
              <Download className="h-3.5 w-3.5" />
              <span>{isIos ? 'Instalar en iPhone / iPad' : 'Instalar aplicación'}</span>
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

      {/* GUÍA DE INSTALACIÓN PWA PARA IPHONE / IPAD */}
      {showIosGuide && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="relative w-full max-w-sm rounded-2xl bg-zinc-900 border border-zinc-800 p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <Download className="h-4 w-4 text-emerald-400" />
                <h3 className="font-bold text-sm text-zinc-100">Instalar en iPhone o iPad</h3>
              </div>
              <button
                onClick={() => setShowIosGuide(false)}
                className="rounded-lg p-1 text-zinc-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="text-xs text-zinc-300">
              Para instalar esta app en tu iPhone y usarla en pantalla completa:
            </p>

            <ol className="space-y-3 text-xs text-zinc-300">
              <li className="flex items-start gap-2.5 bg-zinc-950 p-2.5 rounded-xl border border-zinc-800">
                <span className="h-5 w-5 rounded-full bg-zinc-800 text-zinc-200 font-mono font-bold text-xs flex items-center justify-center shrink-0">
                  1
                </span>
                <div>
                  <p className="font-semibold text-zinc-100 flex items-center gap-1.5">
                    <span>Toca el botón Compartir</span>
                    <Share className="h-3.5 w-3.5 text-sky-400 inline" />
                  </p>
                  <p className="text-[11px] text-zinc-400 mt-0.5">
                    Está en la barra inferior de Safari (el cuadrado con la flecha arriba).
                  </p>
                </div>
              </li>

              <li className="flex items-start gap-2.5 bg-zinc-950 p-2.5 rounded-xl border border-zinc-800">
                <span className="h-5 w-5 rounded-full bg-zinc-800 text-zinc-200 font-mono font-bold text-xs flex items-center justify-center shrink-0">
                  2
                </span>
                <div>
                  <p className="font-semibold text-zinc-100 flex items-center gap-1.5">
                    <span>Agregar a pantalla de inicio</span>
                    <PlusSquare className="h-3.5 w-3.5 text-emerald-400 inline" />
                  </p>
                  <p className="text-[11px] text-zinc-400 mt-0.5">
                    Baja en las opciones y selecciona &quot;Agregar a pantalla de inicio&quot;.
                  </p>
                </div>
              </li>

              <li className="flex items-start gap-2.5 bg-zinc-950 p-2.5 rounded-xl border border-zinc-800">
                <span className="h-5 w-5 rounded-full bg-zinc-800 text-zinc-200 font-mono font-bold text-xs flex items-center justify-center shrink-0">
                  3
                </span>
                <div>
                  <p className="font-semibold text-zinc-100">Toca &quot;Agregar&quot;</p>
                  <p className="text-[11px] text-zinc-400 mt-0.5">
                    ¡Listo! Aparecerá como una aplicación nativa en tu pantalla.
                  </p>
                </div>
              </li>
            </ol>

            <button
              onClick={() => setShowIosGuide(false)}
              className="w-full rounded-xl bg-zinc-100 hover:bg-white text-zinc-950 font-bold py-2 text-xs transition"
            >
              Entendido
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
