import { useCallback, useEffect, useRef, useState } from 'react'
import { Bell, BellOff, Undo2, ArrowRight } from 'lucide-react'
import { CardSkeleton } from '../components/Skeleton'
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
  if (o.delivery_type === 'mesa') return `MESA ${o.table_label}`
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

    return () => {
      clearTimeout(timer)
      clearInterval(poll)
      clearInterval(tick)
      document.removeEventListener('visibilitychange', onVisible)
      supabase.removeChannel(channel)
    }
  }, [load])

  const toggleSound = () => {
    const next = !sound
    setSound(next)
    localStorage.setItem('kitchen-sound', next ? '1' : '0')
    if (next) beep()
  }

  const advance = async (o: KOrder) => {
    const next: KStatus | null =
      o.status === 'nuevo' ? 'preparando' : o.status === 'preparando' ? 'listo' : null
    if (!next) return

    setBusyId(o.id)
    setError(null)
    const { error } = await supabase.rpc('set_order_status', {
      p_order_id: o.id,
      p_new_status: next,
    })
    if (error) setError(error.message)
    await load()
    setBusyId(null)
  }

  const rewind = async (e: React.MouseEvent, o: KOrder) => {
    e.stopPropagation()
    const prev: KStatus | null =
      o.status === 'listo' ? 'preparando' : o.status === 'preparando' ? 'nuevo' : null
    if (!prev) return

    setBusyId(o.id)
    setError(null)
    const { error } = await supabase.rpc('set_order_status', {
      p_order_id: o.id,
      p_new_status: prev,
    })
    if (error) setError(error.message)
    await load()
    setBusyId(null)
  }

  const minutes = (o: KOrder) => Math.max(0, Math.floor((now - new Date(o.created_at).getTime()) / 60000))

  const nuevos = orders.filter((o) => o.status === 'nuevo')
  const preparando = orders.filter((o) => o.status === 'preparando')
  const listos = orders.filter((o) => o.status === 'listo')

  return (
    <div className="space-y-4">
      {/* Barra de control superior minimalista */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold font-mono tracking-tight text-zinc-100">COCINA</h1>
          <span className="flex items-center gap-1.5 text-xs text-zinc-400 font-mono">
            <span className={`h-2 w-2 rounded-full ${live ? 'bg-emerald-400 shadow-sm shadow-emerald-400/50' : 'bg-red-500'}`} />
            {live ? 'EN VIVO' : 'RECONECTANDO'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Selector Activos / Archivados */}
          <div className="grid grid-cols-2 rounded-xl bg-zinc-900 border border-zinc-800 p-0.5 text-xs font-semibold">
            <button
              onClick={() => setView('activos')}
              className={`rounded-lg px-3 py-1.5 transition ${
                view === 'activos' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              En Cocina ({nuevos.length + preparando.length})
            </button>
            <button
              onClick={() => setView('listos')}
              className={`rounded-lg px-3 py-1.5 transition ${
                view === 'listos' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Listos ({listos.length})
            </button>
          </div>

          <button
            onClick={toggleSound}
            title={sound ? 'Silenciar alarma' : 'Activar sonido'}
            className={`rounded-xl p-2 text-sm transition border ${
              sound
                ? 'bg-zinc-800 border-zinc-700 text-zinc-100'
                : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {sound ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {error && <p className="rounded-lg bg-red-950/60 border border-red-800/60 p-3 text-xs text-red-300 font-mono">{error}</p>}

      {/* Skeletons durante carga */}
      {loading ? (
        <div className="grid gap-4 md:grid-cols-2">
          <CardSkeleton count={2} />
          <CardSkeleton count={2} />
        </div>
      ) : view === 'activos' ? (
        <div className="grid gap-3.5 md:grid-cols-2">
          {/* NUEVOS */}
          <section className="space-y-3 rounded-2xl bg-zinc-900/50 p-3 border border-zinc-800/80">
            <header className="flex items-center justify-between px-1">
              <span className="text-xs font-bold font-mono tracking-wider text-sky-400 uppercase flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-sky-400" />
                Nuevos
              </span>
              <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs font-mono font-bold text-zinc-300">
                {nuevos.length}
              </span>
            </header>

            {nuevos.length === 0 && (
              <p className="py-14 text-center text-xs font-mono text-zinc-600">SIN PEDIDOS NUEVOS</p>
            )}

            <div className="space-y-2.5">
              {nuevos.map((o) => (
                <KitchenCard
                  key={o.id}
                  order={o}
                  minutes={minutes(o)}
                  isFlashing={flash.has(o.id)}
                  isBusy={busyId === o.id}
                  onClick={() => advance(o)}
                  actionText="PREPARAR"
                />
              ))}
            </div>
          </section>

          {/* PREPARANDO */}
          <section className="space-y-3 rounded-2xl bg-zinc-900/50 p-3 border border-zinc-800/80">
            <header className="flex items-center justify-between px-1">
              <span className="text-xs font-bold font-mono tracking-wider text-amber-400 uppercase flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-amber-400" />
                En Preparación
              </span>
              <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs font-mono font-bold text-zinc-300">
                {preparando.length}
              </span>
            </header>

            {preparando.length === 0 && (
              <p className="py-14 text-center text-xs font-mono text-zinc-600">NADA EN PREPARACIÓN</p>
            )}

            <div className="space-y-2.5">
              {preparando.map((o) => (
                <KitchenCard
                  key={o.id}
                  order={o}
                  minutes={minutes(o)}
                  isFlashing={flash.has(o.id)}
                  isBusy={busyId === o.id}
                  onClick={() => advance(o)}
                  onRewind={(e) => rewind(e, o)}
                  actionText="MARCAR LISTO"
                />
              ))}
            </div>
          </section>
        </div>
      ) : (
        /* VISTA LISTOS / ARCHIVADOS */
        <section className="space-y-2.5 max-w-2xl mx-auto">
          {listos.length === 0 && (
            <p className="py-16 text-center text-xs font-mono text-zinc-600">NO HAY PEDIDOS LISTOS</p>
          )}
          {listos.map((o) => (
            <div
              key={o.id}
              className="flex items-center justify-between rounded-xl bg-zinc-900 p-3.5 border border-zinc-800 text-sm"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-zinc-100">#{o.order_number}</span>
                  <span className="text-[10px] uppercase font-mono font-bold bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded">
                    {typeBadge(o)}
                  </span>
                </div>
                <p className="text-xs text-zinc-400 mt-1">
                  {o.order_items.map((it) => `${it.quantity}x ${it.product_name}`).join(', ')}
                </p>
              </div>

              <button
                onClick={(e) => rewind(e, o)}
                disabled={busyId === o.id}
                className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:text-white flex items-center gap-1"
              >
                <Undo2 className="h-3 w-3" />
                <span>Regresar</span>
              </button>
            </div>
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
  onClick,
  onRewind,
  actionText,
}: {
  order: KOrder
  minutes: number
  isFlashing: boolean
  isBusy: boolean
  onClick: () => void
  onRewind?: (e: React.MouseEvent) => void
  actionText: string
}) {
  const late = mins >= 20
  const warn = mins >= 10

  return (
    <article
      onClick={isBusy ? undefined : onClick}
      className={`group relative cursor-pointer select-none rounded-xl bg-zinc-900 p-4 transition active:scale-[0.99] border ${
        isFlashing
          ? 'animate-pulse border-sky-400 bg-sky-950/20 shadow-md'
          : late
            ? 'border-red-500/70 bg-red-950/10'
            : warn
              ? 'border-amber-500/60 bg-amber-950/10'
              : 'border-zinc-800 hover:border-zinc-700'
      } ${isBusy ? 'opacity-40' : ''}`}
    >
      <div className="flex items-start justify-between">
        <div>
          <span className="text-2xl font-black font-mono tracking-tight text-white">#{o.order_number}</span>
          <span className="ml-2.5 rounded bg-zinc-800 border border-zinc-700/80 px-2 py-0.5 text-[11px] font-mono font-bold text-zinc-300">
            {typeBadge(o)}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {onRewind && (
            <button
              onClick={onRewind}
              title="Regresar"
              className="rounded p-1 text-zinc-500 hover:text-zinc-200"
            >
              <Undo2 className="h-3.5 w-3.5" />
            </button>
          )}
          <span
            className={`font-mono text-xs font-bold px-2 py-0.5 rounded ${
              late ? 'bg-red-500/20 text-red-400' : warn ? 'bg-amber-500/20 text-amber-400' : 'bg-zinc-800 text-zinc-400'
            }`}
          >
            {mins}m
          </span>
        </div>
      </div>

      <ul className="mt-3 space-y-1.5 border-t border-zinc-800/80 pt-2.5 text-sm">
        {o.order_items.map((it) => (
          <li key={it.id}>
            <p className="font-semibold text-zinc-100">
              <span className="text-zinc-400 font-mono mr-1.5">{it.quantity}×</span>
              {it.product_name}
            </p>
            {it.excluded_ingredients.length > 0 && (
              <p className="text-xs font-bold text-red-400">
                SIN: {it.excluded_ingredients.join(', ')}
              </p>
            )}
            {it.order_item_modifiers.length > 0 && (
              <p className="text-xs text-zinc-400">
                + {it.order_item_modifiers.map((m) => m.name).join(', ')}
              </p>
            )}
            {it.notes && <p className="text-xs italic text-zinc-400">“{it.notes}”</p>}
          </li>
        ))}
      </ul>

      {o.notes && (
        <p className="mt-2.5 rounded bg-zinc-800/60 p-2 text-xs text-zinc-300 border border-zinc-700/40">
          Nota: {o.notes}
        </p>
      )}

      {/* Pie táctil discreto con icono de flecha */}
      <div className="mt-3 pt-2 border-t border-zinc-800/60 flex items-center justify-between text-[11px] font-mono">
        <span className="text-zinc-500">1 toque = avanzar</span>
        <span className="text-zinc-300 font-bold group-hover:text-white transition flex items-center gap-1">
          <span>{actionText}</span>
          <ArrowRight className="h-3 w-3" />
        </span>
      </div>
    </article>
  )
}
