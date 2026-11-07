import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Bell,
  BellOff,
  Undo2,
  ArrowRight,
  Flame,
  CheckCheck,
  Maximize2,
  Minimize2,
  HelpCircle,
  SlidersHorizontal,
} from 'lucide-react'
import { CardSkeleton } from '../components/Skeleton'
import { SwipeableCard } from '../components/SwipeableCard'
import { supabase } from '../lib/supabase'

type KStatus = 'nuevo' | 'preparando' | 'listo'

interface KItem {
  id: string
  product_name: string
  quantity: number
  notes: string | null
  excluded_ingredients: string[]
  order_item_modifiers: { id: string; name: string }[]
}

interface KOrder {
  id: string
  order_number: number
  status: KStatus
  channel: 'pos' | 'telegram' | 'whatsapp'
  delivery_type: 'mesa' | 'recogida' | 'domicilio'
  table_label: string | null
  notes: string | null
  created_at: string
  order_items: KItem[]
}

const SELECT =
  'id, order_number, status, channel, delivery_type, table_label, notes, created_at, ' +
  'order_items(id, product_name, quantity, notes, excluded_ingredients, order_item_modifiers(id, name))'

function typeBadge(o: KOrder) {
  if (o.delivery_type === 'mesa') return `MESA ${o.table_label || '?'}`
  return o.delivery_type === 'domicilio' ? 'DOMICILIO' : 'LLEVAR'
}

function beep() {
  try {
    const Ctx = window.AudioContext
    const ctx = new Ctx()
    ;[880, 1175].forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = freq
      osc.connect(gain)
      gain.connect(ctx.destination)
      const t = ctx.currentTime + i * 0.18
      gain.gain.setValueAtTime(0.25, t)
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16)
      osc.start(t)
      osc.stop(t + 0.17)
    })
    setTimeout(() => ctx.close(), 800)
  } catch {
    /* audio no disponible */
  }
}

export default function Kitchen() {
  const [orders, setOrders] = useState<KOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [live, setLive] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [sound, setSound] = useState(() => localStorage.getItem('kitchen-sound') === '1')
  const [flash, setFlash] = useState<Set<string>>(new Set())
  const [busyId, setBusyId] = useState<string | null>(null)
  const [view, setView] = useState<'activos' | 'listos'>('activos')
  const [isFullscreen, setIsFullscreen] = useState(false)

  // Densidad: 'auto' (se ajusta según la cantidad), 'compact' o 'normal'
  const [density, setDensity] = useState<'auto' | 'compact' | 'normal'>(
    () => (localStorage.getItem('kitchen-density') as any) || 'auto',
  )

  const seen = useRef<Set<string> | null>(null)
  const soundRef = useRef(sound)
  soundRef.current = sound

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('orders')
      .select(SELECT)
      .in('status', ['nuevo', 'preparando', 'listo'])
      .order('created_at', { ascending: true })
    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }
    setError(null)
    const list = data as unknown as KOrder[]

    const ids = new Set(list.map((o) => o.id))
    if (seen.current) {
      const fresh = list.filter((o) => o.status === 'nuevo' && !seen.current!.has(o.id))
      if (fresh.length > 0) {
        if (soundRef.current) beep()
        setFlash((f) => new Set([...f, ...fresh.map((o) => o.id)]))
        setTimeout(() => {
          setFlash((f) => {
            const n = new Set(f)
            fresh.forEach((o) => n.delete(o.id))
            return n
          })
        }, 10000)
      }
    }
    seen.current = new Set([...(seen.current ?? []), ...ids])
    setOrders(list)
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    let timer: ReturnType<typeof setTimeout> | undefined
    const debounced = () => {
      clearTimeout(timer)
      timer = setTimeout(load, 300)
    }
    const channel = supabase
      .channel('kitchen-orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, debounced)
      .subscribe((status) => setLive(status === 'SUBSCRIBED'))

    const poll = setInterval(load, 25000)
    const tick = setInterval(() => setNow(Date.now()), 30000)
    const onVisible = () => document.visibilityState === 'visible' && load()
    document.addEventListener('visibilitychange', onVisible)

    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFsChange)

    return () => {
      clearTimeout(timer)
      clearInterval(poll)
      clearInterval(tick)
      document.removeEventListener('visibilitychange', onVisible)
      document.removeEventListener('fullscreenchange', onFsChange)
      supabase.removeChannel(channel)
    }
  }, [load])

  const toggleSound = () => {
    const next = !sound
    setSound(next)
    localStorage.setItem('kitchen-sound', next ? '1' : '0')
    if (next) beep()
  }

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {})
      setIsFullscreen(true)
    } else {
      document.exitFullscreen?.().catch(() => {})
      setIsFullscreen(false)
    }
  }

  const cycleDensity = () => {
    setDensity((prev) => {
      const next = prev === 'auto' ? 'compact' : prev === 'compact' ? 'normal' : 'auto'
      localStorage.setItem('kitchen-density', next)
      return next
    })
  }

  // Avance optimista instantáneo (0 ms lag)
  const advance = async (o: KOrder) => {
    const next: KStatus | null =
      o.status === 'nuevo' ? 'preparando' : o.status === 'preparando' ? 'listo' : null
    if (!next) return

    setBusyId(o.id)
    setError(null)

    setOrders((prev) =>
      prev.map((item) => (item.id === o.id ? { ...item, status: next } : item)),
    )

    const { error: err } = await supabase.rpc('set_order_status', {
      p_order_id: o.id,
      p_new_status: next,
    })

    if (err) {
      setError(err.message)
      await load()
    }
    setBusyId(null)
  }

  // Retroceso optimista instantáneo
  const rewind = async (o: KOrder) => {
    const prev: KStatus | null =
      o.status === 'listo' ? 'preparando' : o.status === 'preparando' ? 'nuevo' : null
    if (!prev) return

    setBusyId(o.id)
    setError(null)

    setOrders((list) =>
      list.map((item) => (item.id === o.id ? { ...item, status: prev } : item)),
    )

    const { error: err } = await supabase.rpc('set_order_status', {
      p_order_id: o.id,
      p_new_status: prev,
    })

    if (err) {
      setError(err.message)
      await load()
    }
    setBusyId(null)
  }

  const minutes = (o: KOrder) =>
    Math.max(0, Math.floor((now - new Date(o.created_at).getTime()) / 60000))

  const nuevos = orders.filter((o) => o.status === 'nuevo')
  const preparando = orders.filter((o) => o.status === 'preparando')
  const listos = orders.filter((o) => o.status === 'listo')

  // Auto-adaptación: si hay 3 o más pedidos activos, compacta automáticamente respetando el límite mínimo de tamaño
  const totalActivos = nuevos.length + preparando.length
  const isCompact = density === 'compact' || (density === 'auto' && totalActivos >= 3)

  return (
    <div className="space-y-3">
      {/* Barra de control superior para Tablet */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-3">
          <h1 className="text-xl md:text-2xl font-black font-mono tracking-tight text-zinc-100 flex items-center gap-2">
            <Flame className="h-5 w-5 text-emerald-400" />
            <span>COCINA</span>
          </h1>
          <span className="flex items-center gap-1.5 text-xs text-zinc-400 font-mono">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                live ? 'bg-emerald-400 shadow-sm shadow-emerald-400/50 animate-pulse' : 'bg-red-500'
              }`}
            />
            <span className="hidden sm:inline">{live ? 'EN VIVO' : 'RECONECTANDO'}</span>
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Selector de Vistas: Activos vs Listos */}
          <div className="grid grid-cols-2 rounded-xl bg-zinc-900 border border-zinc-800 p-0.5 text-xs font-semibold">
            <button
              onClick={() => setView('activos')}
              className={`rounded-lg px-3 py-1.5 transition flex items-center gap-1.5 ${
                view === 'activos'
                  ? 'bg-zinc-800 text-white shadow-sm border border-zinc-700/60'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <span>En Cocina</span>
              <span className="rounded bg-zinc-700/80 px-1.5 py-0.2 text-[10px] font-mono">
                {totalActivos}
              </span>
            </button>
            <button
              onClick={() => setView('listos')}
              className={`rounded-lg px-3 py-1.5 transition flex items-center gap-1.5 ${
                view === 'listos'
                  ? 'bg-zinc-800 text-white shadow-sm border border-zinc-700/60'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <span>Listos</span>
              <span className="rounded bg-zinc-700/80 px-1.5 py-0.2 text-[10px] font-mono">
                {listos.length}
              </span>
            </button>
          </div>

          {/* Selector de Tamaño / Densidad de tarjetas */}
          <button
            onClick={cycleDensity}
            title={`Tamaño de tarjetas: ${
              density === 'auto'
                ? 'Automático (se adapta al número de pedidos)'
                : density === 'compact'
                  ? 'Compacto'
                  : 'Normal'
            }`}
            className="rounded-xl px-2.5 py-1.5 text-xs font-mono transition border bg-zinc-900 border-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-800 flex items-center gap-1.5"
          >
            <SlidersHorizontal className="h-3.5 w-3.5 text-sky-400" />
            <span className="capitalize">{density}</span>
          </button>

          {/* Timbre Sonoro */}
          <button
            onClick={toggleSound}
            title={sound ? 'Silenciar alarma' : 'Activar timbre sonoro'}
            className={`rounded-xl p-2 text-sm transition border ${
              sound
                ? 'bg-zinc-800 border-zinc-700 text-emerald-400 shadow-sm'
                : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {sound ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
          </button>

          {/* Botón Pantalla Completa para Tablet */}
          <button
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa para Tablet'}
            className="rounded-xl p-2 text-sm transition border bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Sugerencia táctil */}
      <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400 bg-zinc-900/60 border border-zinc-800/80 rounded-xl px-3 py-1.5">
        <span className="flex items-center gap-2">
          <HelpCircle className="h-3.5 w-3.5 text-sky-400 shrink-0" />
          <span>
            <strong className="text-zinc-200">En Tablet:</strong> Desliza{' '}
            <strong className="text-emerald-400">👉 a la derecha</strong> para avanzar o{' '}
            <strong className="text-amber-400">👈 a la izquierda</strong> para retroceder.
          </span>
        </span>
      </div>

      {error && (
        <p className="rounded-xl bg-red-950/60 border border-red-800/60 p-3 text-xs text-red-300 font-mono">
          {error}
        </p>
      )}

      {/* Skeletons durante carga */}
      {loading ? (
        <div className="grid gap-3.5 grid-cols-1 landscape:grid-cols-2 md:grid-cols-2">
          <CardSkeleton count={2} />
          <CardSkeleton count={2} />
        </div>
      ) : view === 'activos' ? (
        /* En horizontal (landscape) o en pantallas md: SIEMPRE quedan 2 columnas lado a lado (horizontal) */
        <div className="grid grid-cols-1 landscape:grid-cols-2 md:grid-cols-2 gap-3.5 items-start">
          {/* COLUMNA 1: NUEVOS (Izquierda) */}
          <section className="space-y-2.5 rounded-2xl bg-zinc-900/40 p-2.5 sm:p-3 border border-zinc-800/80">
            <header className="flex items-center justify-between px-1">
              <span className="text-xs font-bold font-mono tracking-wider text-sky-400 uppercase flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-sky-400 animate-pulse" />
                1. Nuevos por Preparar
              </span>
              <span className="rounded-lg bg-sky-950/60 border border-sky-800/60 px-2 py-0.5 text-xs font-mono font-bold text-sky-300">
                {nuevos.length}
              </span>
            </header>

            {nuevos.length === 0 && (
              <div className="py-14 text-center border border-dashed border-zinc-800/80 rounded-xl">
                <p className="text-xs font-mono text-zinc-600">SIN PEDIDOS NUEVOS</p>
              </div>
            )}

            <div
              className={`grid gap-2.5 ${
                isCompact && nuevos.length >= 4 ? 'grid-cols-1 xl:grid-cols-2' : 'grid-cols-1'
              }`}
            >
              {nuevos.map((o) => (
                <SwipeableCard
                  key={o.id}
                  onSwipeRight={() => advance(o)}
                  onClick={() => advance(o)}
                  swipeRightLabel="Preparar"
                  swipeRightIcon={<Flame className="h-4 w-4" />}
                  threshold={isCompact ? 65 : 80}
                  disabled={busyId === o.id}
                >
                  <KitchenCard
                    order={o}
                    minutes={minutes(o)}
                    isFlashing={flash.has(o.id)}
                    isBusy={busyId === o.id}
                    isCompact={isCompact}
                    actionText="DESLIZA 👉 PREPARAR"
                  />
                </SwipeableCard>
              ))}
            </div>
          </section>

          {/* COLUMNA 2: PREPARANDO (Derecha) */}
          <section className="space-y-2.5 rounded-2xl bg-zinc-900/40 p-2.5 sm:p-3 border border-zinc-800/80">
            <header className="flex items-center justify-between px-1">
              <span className="text-xs font-bold font-mono tracking-wider text-amber-400 uppercase flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-amber-400" />
                2. En Preparación
              </span>
              <span className="rounded-lg bg-amber-950/60 border border-amber-800/60 px-2 py-0.5 text-xs font-mono font-bold text-amber-300">
                {preparando.length}
              </span>
            </header>

            {preparando.length === 0 && (
              <div className="py-14 text-center border border-dashed border-zinc-800/80 rounded-xl">
                <p className="text-xs font-mono text-zinc-600">NADA EN PREPARACIÓN</p>
              </div>
            )}

            <div
              className={`grid gap-2.5 ${
                isCompact && preparando.length >= 4 ? 'grid-cols-1 xl:grid-cols-2' : 'grid-cols-1'
              }`}
            >
              {preparando.map((o) => (
                <SwipeableCard
                  key={o.id}
                  onSwipeRight={() => advance(o)}
                  onSwipeLeft={() => rewind(o)}
                  onClick={() => advance(o)}
                  swipeRightLabel="Listo"
                  swipeRightIcon={<CheckCheck className="h-4 w-4" />}
                  swipeLeftLabel="Regresar a Nuevos"
                  swipeLeftIcon={<Undo2 className="h-4 w-4" />}
                  threshold={isCompact ? 65 : 80}
                  disabled={busyId === o.id}
                >
                  <KitchenCard
                    order={o}
                    minutes={minutes(o)}
                    isFlashing={flash.has(o.id)}
                    isBusy={busyId === o.id}
                    isCompact={isCompact}
                    onRewind={(e) => {
                      e.stopPropagation()
                      rewind(o)
                    }}
                    actionText="DESLIZA 👉 LISTO"
                  />
                </SwipeableCard>
              ))}
            </div>
          </section>
        </div>
      ) : (
        /* VISTA LISTOS / ARCHIVADOS */
        <section className="space-y-2.5 max-w-2xl mx-auto">
          {listos.length === 0 && (
            <div className="py-16 text-center border border-dashed border-zinc-800/80 rounded-xl">
              <p className="text-xs font-mono text-zinc-600">NO HAY PEDIDOS LISTOS</p>
            </div>
          )}
          {listos.map((o) => (
            <SwipeableCard
              key={o.id}
              onSwipeLeft={() => rewind(o)}
              swipeLeftLabel="Regresar a Preparación"
              swipeLeftIcon={<Undo2 className="h-4 w-4" />}
              threshold={isCompact ? 65 : 80}
              disabled={busyId === o.id}
            >
              <div className="flex items-center justify-between rounded-xl bg-zinc-900 p-3.5 border border-zinc-800 text-sm shadow-md">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-black text-base text-zinc-100">
                      #{o.order_number}
                    </span>
                    <span className="text-[10px] uppercase font-mono font-bold bg-zinc-800 text-zinc-300 px-2 py-0.5 rounded border border-zinc-700/60">
                      {typeBadge(o)}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400 mt-1 font-medium">
                    {o.order_items.map((it) => `${it.quantity}x ${it.product_name}`).join(', ')}
                  </p>
                  {o.notes && <p className="text-xs text-zinc-500 italic mt-0.5">“{o.notes}”</p>}
                </div>

                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    rewind(o)
                  }}
                  disabled={busyId === o.id}
                  className="rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-bold text-zinc-300 hover:text-white hover:bg-zinc-700 transition flex items-center gap-1.5 shrink-0"
                >
                  <Undo2 className="h-3.5 w-3.5" />
                  <span>Regresar</span>
                </button>
              </div>
            </SwipeableCard>
          ))}
        </section>
      )}
    </div>
  )
}

function KitchenCard({
  order: o,
  minutes: mins,
  isFlashing,
  isBusy,
  isCompact = false,
  onRewind,
  actionText,
}: {
  order: KOrder
  minutes: number
  isFlashing: boolean
  isBusy: boolean
  isCompact?: boolean
  onRewind?: (e: React.MouseEvent) => void
  actionText: string
}) {
  const late = mins >= 18
  const warn = mins >= 10 && mins < 18

  return (
    <article
      className={`group relative rounded-xl transition border shadow-md flex flex-col justify-between ${
        isCompact ? 'p-3 min-h-[115px]' : 'p-4 md:p-5 min-h-[145px]'
      } ${
        isFlashing
          ? 'animate-pulse border-sky-400 bg-sky-950/25 ring-2 ring-sky-400/40'
          : late
            ? 'border-red-500/80 bg-red-950/15 ring-1 ring-red-500/30'
            : warn
              ? 'border-amber-500/70 bg-amber-950/15'
              : 'border-zinc-800 hover:border-zinc-700 bg-zinc-900'
      } ${isBusy ? 'opacity-40 pointer-events-none' : ''}`}
    >
      <div>
        {/* Cabecera del ticket con número y badge */}
        <div className="flex items-start justify-between gap-1.5">
          <div className="flex items-center gap-2">
            <span
              className={`font-black font-mono tracking-tight text-white ${
                isCompact ? 'text-xl' : 'text-2xl md:text-3xl'
              }`}
            >
              #{o.order_number}
            </span>
            <span
              className={`rounded border border-zinc-700/80 font-mono font-bold text-zinc-200 bg-zinc-800 ${
                isCompact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs'
              }`}
            >
              {typeBadge(o)}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            {onRewind && (
              <button
                onClick={onRewind}
                title="Regresar a Nuevos"
                className="rounded p-1 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition"
              >
                <Undo2 className={isCompact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
              </button>
            )}
            <span
              className={`font-mono font-bold rounded border ${
                isCompact ? 'text-[11px] px-1.5 py-0.2' : 'text-xs px-2.5 py-1'
              } ${
                late
                  ? 'bg-red-500/20 text-red-300 border-red-500/50 animate-pulse'
                  : warn
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/50'
                    : 'bg-zinc-800 text-zinc-400 border-zinc-700/60'
              }`}
            >
              {mins}m
            </span>
          </div>
        </div>

        {/* Lista de productos con límite mínimo de texto legible (text-xs) */}
        <ul
          className={`border-t border-zinc-800/80 ${
            isCompact ? 'mt-2 pt-2 space-y-1' : 'mt-3 pt-3 space-y-1.5'
          }`}
        >
          {o.order_items.map((it) => (
            <li key={it.id} className="text-zinc-100">
              <p className={`font-bold leading-tight ${isCompact ? 'text-xs' : 'text-sm'}`}>
                <span className="font-mono mr-1.5 px-1 py-0.2 rounded text-[11px] bg-zinc-800 text-white font-black">
                  {it.quantity}×
                </span>
                {it.product_name}
              </p>

              {it.excluded_ingredients.length > 0 && (
                <p className="text-[11px] font-bold text-red-400 mt-0.5 pl-6">
                  🚫 SIN: {it.excluded_ingredients.join(', ')}
                </p>
              )}

              {it.order_item_modifiers.length > 0 && (
                <p className="text-[11px] text-sky-400 font-medium mt-0.5 pl-6">
                  + {it.order_item_modifiers.map((m) => m.name).join(', ')}
                </p>
              )}

              {it.notes && (
                <p className="text-[11px] italic text-amber-300/90 mt-0.5 pl-6">“{it.notes}”</p>
              )}
            </li>
          ))}
        </ul>

        {o.notes && (
          <div
            className={`rounded-lg bg-amber-950/20 border border-amber-800/40 text-amber-200 ${
              isCompact ? 'mt-2 p-1.5 text-[11px]' : 'mt-2.5 p-2 text-xs'
            }`}
          >
            <strong className="uppercase font-mono text-[9px] tracking-wider text-amber-400 block mb-0.5">
              Nota:
            </strong>
            {o.notes}
          </div>
        )}
      </div>

      {/* Pie táctil para tablet */}
      <div
        className={`border-t border-zinc-800/60 flex items-center justify-between font-mono ${
          isCompact ? 'mt-2 pt-1.5 text-[10px]' : 'mt-3 pt-2 text-[11px]'
        }`}
      >
        <span className="text-zinc-500">Desliza o toca</span>
        <span className="text-emerald-400 font-bold flex items-center gap-1 group-hover:translate-x-1 transition-transform">
          <span>{actionText}</span>
          <ArrowRight className={isCompact ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
        </span>
      </div>
    </article>
  )
}
