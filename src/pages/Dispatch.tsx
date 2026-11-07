import { useCallback, useEffect, useState } from 'react'
import { MessageCircle, Phone, MapPin, ExternalLink, Check, Bike } from 'lucide-react'
import { CardSkeleton } from '../components/Skeleton'
import { SwipeableCard } from '../components/SwipeableCard'
import { money } from '../lib/format'
import { supabase } from '../lib/supabase'

interface DOrder {
  id: string
  order_number: number
  status: string
  delivery_type: 'mesa' | 'recogida' | 'domicilio'
  table_label: string | null
  delivery_address: string | null
  total: number
  payment_method: string
  created_at: string
  ready_at: string | null
  delivered_at: string | null
  notes: string | null
  customer: { full_name: string; phone: string | null } | null
  order_items: { product_name: string; quantity: number }[]
}

const SELECT =
  'id, order_number, status, delivery_type, table_label, delivery_address, total, payment_method, notes, created_at, ready_at, delivered_at, ' +
  'customer:customers(full_name, phone), order_items(product_name, quantity)'

const mapsUrl = (address: string) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`

const waUrl = (phone: string, orderNum: number) => {
  const clean = phone.replace(/\D/g, '')
  const num = clean.length === 10 ? `57${clean}` : clean
  const text = encodeURIComponent(`¡Hola! Nos comunicamos sobre tu pedido #${orderNum}.`)
  return `https://wa.me/${num}?text=${text}`
}

function typeBadge(o: DOrder) {
  if (o.delivery_type === 'mesa') return `MESA ${o.table_label || '?'}`
  return o.delivery_type === 'domicilio' ? 'DOMICILIO' : 'LLEVAR'
}

export default function Dispatch() {
  const [tab, setTab] = useState<'activos' | 'archivados'>('activos')
  const [active, setActive] = useState<DOrder[]>([])
  const [archived, setArchived] = useState<DOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [actRes, archRes] = await Promise.all([
      supabase
        .from('orders')
        .select(SELECT)
        .in('status', ['listo', 'recogido'])
        .order('ready_at', { ascending: true }),
      supabase
        .from('orders')
        .select(SELECT)
        .eq('status', 'entregado')
        .order('delivered_at', { ascending: false })
        .limit(30),
    ])

    if (actRes.error || archRes.error) {
      setError((actRes.error || archRes.error)!.message)
    } else {
      setActive(actRes.data as unknown as DOrder[])
      setArchived(archRes.data as unknown as DOrder[])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    const ch = supabase
      .channel('dispatch-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => load())
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [load])

  const markOut = async (o: DOrder) => {
    setBusyId(o.id)
    setError(null)

    // Actualización optimista inmediata
    setActive((prev) => prev.filter((item) => item.id !== o.id))
    setArchived((prev) => [
      { ...o, status: 'entregado', delivered_at: new Date().toISOString() },
      ...prev,
    ])

    const { error: err } = await supabase.rpc('set_order_status', {
      p_order_id: o.id,
      p_new_status: 'entregado',
    })

    if (err) {
      setError(err.message)
      await load()
    }
    setBusyId(null)
  }

  const list = tab === 'activos' ? active : archived

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {/* Encabezado */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold font-mono tracking-tight text-zinc-100">DESPACHO</h1>
          <p className="text-xs text-zinc-400">Desliza o toca para marcar salida / entrega</p>
        </div>

        <div className="grid grid-cols-2 rounded-xl bg-zinc-900 border border-zinc-800 p-0.5 text-xs font-semibold">
          <button
            onClick={() => setTab('activos')}
            className={`rounded-lg px-3 py-1.5 transition ${
              tab === 'activos'
                ? 'bg-zinc-800 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Listos ({active.length})
          </button>
          <button
            onClick={() => setTab('archivados')}
            className={`rounded-lg px-3 py-1.5 transition ${
              tab === 'archivados'
                ? 'bg-zinc-800 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Salidos ({archived.length})
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded-lg bg-red-950/60 border border-red-800/60 p-3 text-xs text-red-300 font-mono">
          {error}
        </p>
      )}

      {loading ? (
        <CardSkeleton count={4} />
      ) : list.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-800 py-16 text-center text-zinc-600">
          <p className="text-xs font-mono uppercase tracking-wider">
            {tab === 'activos' ? 'Sin pedidos esperando salida' : 'Sin pedidos salidos hoy'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {list.map((o) => {
            const isDelivery = o.delivery_type === 'domicilio'
            const cash = o.payment_method === 'efectivo'
            const isBusy = busyId === o.id
            const isArchived = o.status === 'entregado'

            const cardContent = (
              <article
                onClick={isArchived || isBusy ? undefined : () => markOut(o)}
                className={`group relative flex flex-col justify-between rounded-2xl bg-zinc-900 p-4 transition select-none border ${
                  isArchived
                    ? 'opacity-50 border-zinc-800/60 cursor-default'
                    : 'border-zinc-800 hover:border-zinc-700 cursor-pointer active:scale-[0.99] shadow-md'
                } ${isBusy ? 'opacity-30' : ''}`}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl font-black font-mono text-zinc-100">
                        #{o.order_number}
                      </span>
                      <span className="rounded bg-zinc-800 border border-zinc-700/80 px-2 py-0.5 text-[11px] font-mono font-bold text-zinc-300">
                        {typeBadge(o)}
                      </span>
                    </div>

                    <div className="text-right">
                      <p className="text-base font-extrabold font-mono text-zinc-100">
                        {money(Number(o.total))}
                      </p>
                      {cash && !isArchived && (
                        <span className="rounded bg-amber-500/20 text-amber-300 text-[10px] font-mono font-bold px-1.5 py-0.5 uppercase">
                          Cobrar efectivo
                        </span>
                      )}
                    </div>
                  </div>

                  {(o.customer || o.delivery_address) && (
                    <div className="mt-2.5 rounded-xl bg-zinc-950/60 p-2.5 text-xs space-y-1.5 border border-zinc-800/80">
                      {o.customer?.full_name && (
                        <p className="font-bold text-zinc-200">{o.customer.full_name}</p>
                      )}

                      <div
                        className="flex flex-wrap items-center gap-2 pt-0.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {o.customer?.phone && (
                          <a
                            href={waUrl(o.customer.phone, o.order_number)}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-2 py-1 text-xs font-semibold hover:bg-emerald-500/20 flex items-center gap-1.5"
                          >
                            <MessageCircle className="h-3 w-3 stroke-[2.5]" />
                            <span>WhatsApp</span>
                          </a>
                        )}

                        {o.customer?.phone && (
                          <a
                            href={`tel:${o.customer.phone}`}
                            className="rounded bg-zinc-800 text-zinc-300 px-2 py-1 text-xs hover:bg-zinc-700 flex items-center gap-1.5"
                          >
                            <Phone className="h-3 w-3" />
                            <span>Llamar</span>
                          </a>
                        )}

                        {isDelivery && o.delivery_address && (
                          <a
                            href={mapsUrl(o.delivery_address)}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded bg-sky-500/20 text-sky-300 border border-sky-500/30 px-2 py-1 text-xs font-semibold hover:bg-sky-500/30 flex items-center gap-1.5"
                          >
                            <MapPin className="h-3 w-3" />
                            <span>Maps</span>
                            <ExternalLink className="h-2.5 w-2.5 opacity-60" />
                          </a>
                        )}
                      </div>

                      {isDelivery && o.delivery_address && (
                        <p className="text-zinc-400 font-mono text-[11px] truncate pt-0.5">
                          {o.delivery_address}
                        </p>
                      )}
                    </div>
                  )}

                  <div className="mt-2.5 text-xs text-zinc-300">
                    <p className="line-clamp-2 font-medium">
                      {o.order_items?.map((it) => `${it.quantity}x ${it.product_name}`).join(' · ')}
                    </p>
                    {o.notes && (
                      <p className="text-[11px] italic text-zinc-400 mt-1">Nota: {o.notes}</p>
                    )}
                  </div>
                </div>

                {!isArchived && (
                  <div className="mt-3.5 pt-2 border-t border-zinc-800/60 flex items-center justify-between text-[11px] font-mono">
                    <span className="text-zinc-500">
                      {isBusy ? 'Notificando salida...' : 'Desliza 👉 o toca'}
                    </span>
                    <span className="text-emerald-400 font-bold group-hover:text-emerald-300 transition flex items-center gap-1.5">
                      {isDelivery ? (
                        <>
                          <Bike className="h-3.5 w-3.5" />
                          <span>EN CAMINO</span>
                        </>
                      ) : (
                        <>
                          <Check className="h-3.5 w-3.5" />
                          <span>ENTREGAR</span>
                        </>
                      )}
                    </span>
                  </div>
                )}
              </article>
            )

            if (isArchived) {
              return <div key={o.id}>{cardContent}</div>
            }

            return (
              <SwipeableCard
                key={o.id}
                onSwipeRight={() => markOut(o)}
                onClick={() => markOut(o)}
                swipeRightLabel={isDelivery ? 'Marcar En Camino' : 'Entregar'}
                swipeRightIcon={isDelivery ? <Bike className="h-5 w-5" /> : <Check className="h-5 w-5" />}
                threshold={85}
                disabled={isBusy}
              >
                {cardContent}
              </SwipeableCard>
            )
          })}
        </div>
      )}
    </div>
  )
}
