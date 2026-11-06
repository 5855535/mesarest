import { useCallback, useEffect, useState } from 'react'
import { RotateCw } from 'lucide-react'
import { Skeleton, TableSkeleton } from '../components/Skeleton'
import { money } from '../lib/format'
import { supabase } from '../lib/supabase'

interface OrderRow {
  id: string
  order_number: number
  status: string
  channel: string
  delivery_type: string
  table_label: string | null
  total: number
  created_at: string
  delivered_at: string | null
  order_items: { product_name: string; quantity: number; line_total: number }[]
}

interface TopProduct {
  name: string
  quantity: number
  total: number
}

const CHANNEL_LABEL: Record<string, string> = {
  pos: 'Caja',
  telegram: 'Telegram',
  whatsapp: 'WhatsApp',
}

const STATUS_STYLE: Record<string, { label: string; badge: string }> = {
  nuevo: { label: 'Nuevo', badge: 'bg-sky-500/20 text-sky-300 border-sky-500/30' },
  preparando: { label: 'Preparando', badge: 'bg-amber-500/20 text-amber-300 border-amber-500/30' },
  listo: { label: 'Listo', badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
  recogido: { label: 'En camino', badge: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30' },
  entregado: { label: 'Entregado', badge: 'bg-zinc-800 text-zinc-400 border-zinc-700/60' },
  cancelado: { label: 'Cancelado', badge: 'bg-red-500/20 text-red-400 border-red-500/30' },
}

export default function Dashboard() {
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const { data, error } = await supabase
      .from('orders')
      .select('id, order_number, status, channel, delivery_type, table_label, total, created_at, delivered_at, order_items(product_name, quantity, line_total)')
      .gte('created_at', today.toISOString())
      .order('created_at', { ascending: false })

    if (error) setError(error.message)
    else setOrders(data as unknown as OrderRow[])
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    const ch = supabase
      .channel('dashboard-metrics')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => load())
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [load])

  const entregados = orders.filter((o) => o.status === 'entregado')
  const pendientes = orders.filter((o) => ['nuevo', 'preparando', 'listo', 'recogido'].includes(o.status))
  const ventasHoy = entregados.reduce((s, o) => s + Number(o.total), 0)
  const ticketPromedio = entregados.length > 0 ? ventasHoy / entregados.length : 0

  const porCanal = orders.reduce<Record<string, { count: number; total: number }>>((acc, o) => {
    const k = o.channel
    acc[k] = acc[k] || { count: 0, total: 0 }
    acc[k].count++
    if (o.status === 'entregado') acc[k].total += Number(o.total)
    return acc
  }, {})

  const prodMap = new Map<string, { quantity: number; total: number }>()
  orders.forEach((o) => {
    if (o.status !== 'cancelado') {
      o.order_items?.forEach((it) => {
        const cur = prodMap.get(it.product_name) || { quantity: 0, total: 0 }
        cur.quantity += it.quantity
        cur.total += Number(it.line_total)
        prodMap.set(it.product_name, cur)
      })
    }
  })
  const topProducts: TopProduct[] = Array.from(prodMap.entries())
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 5)

  return (
    <div className="space-y-6 max-w-6xl pb-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold font-mono tracking-tight text-zinc-100">PANEL DE CONTROL</h1>
          <p className="text-xs text-zinc-400">Resumen operativo y ventas del día en tiempo real</p>
        </div>
        <button
          onClick={load}
          className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-mono font-medium text-zinc-300 hover:text-white hover:bg-zinc-800 transition flex items-center gap-1.5"
        >
          <RotateCw className="h-3 w-3" />
          <span>Actualizar</span>
        </button>
      </div>

      {error && <p className="rounded-xl bg-red-950/60 border border-red-800/60 p-3 text-xs text-red-300 font-mono">{error}</p>}

      {/* Tarjetas KPI */}
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <div className="rounded-2xl bg-zinc-900 p-4 border border-zinc-800">
          <p className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-500">Ventas entregadas</p>
          {loading ? (
            <Skeleton className="h-8 w-28 mt-2" />
          ) : (
            <p className="mt-2 text-2xl lg:text-3xl font-black font-mono text-zinc-100">{money(ventasHoy)}</p>
          )}
          <p className="mt-1 text-[11px] text-zinc-400 font-mono">{entregados.length} pedidos cobrados</p>
        </div>

        <div className="rounded-2xl bg-zinc-900 p-4 border border-zinc-800">
          <p className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-500">Pedidos hoy</p>
          {loading ? (
            <Skeleton className="h-8 w-16 mt-2" />
          ) : (
            <p className="mt-2 text-2xl lg:text-3xl font-black font-mono text-zinc-100">{orders.length}</p>
          )}
          <p className="mt-1 text-[11px] text-zinc-400 font-mono">{orders.filter(o => o.status === 'cancelado').length} cancelados</p>
        </div>

        <div className="rounded-2xl bg-zinc-900 p-4 border border-zinc-800">
          <p className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-500">Ticket promedio</p>
          {loading ? (
            <Skeleton className="h-8 w-24 mt-2" />
          ) : (
            <p className="mt-2 text-2xl lg:text-3xl font-black font-mono text-zinc-100">{money(ticketPromedio)}</p>
          )}
          <p className="mt-1 text-[11px] text-zinc-400 font-mono">Por pedido entregado</p>
        </div>

        <div className="rounded-2xl bg-zinc-900 p-4 border border-zinc-800">
          <p className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-500">En proceso</p>
          {loading ? (
            <Skeleton className="h-8 w-16 mt-2" />
          ) : (
            <p className="mt-2 text-2xl lg:text-3xl font-black font-mono text-amber-400">{pendientes.length}</p>
          )}
          <p className="mt-1 text-[11px] text-zinc-400 font-mono">Cocina y despacho</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Top productos */}
        <div className="rounded-2xl bg-zinc-900 p-5 border border-zinc-800 lg:col-span-2">
          <h2 className="text-sm font-mono font-bold uppercase tracking-wider text-zinc-400 mb-4">
            Productos más vendidos hoy
          </h2>
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : topProducts.length === 0 ? (
            <p className="text-xs text-zinc-500 font-mono py-8 text-center">AÚN NO HAY VENTAS REGISTRADAS HOY</p>
          ) : (
            <div className="space-y-2.5">
              {topProducts.map((p, idx) => (
                <div key={p.name} className="flex items-center justify-between border-b border-zinc-800/80 pb-2 text-sm">
                  <div className="flex items-center gap-3">
                    <span className="flex h-5 w-5 items-center justify-center rounded bg-zinc-800 text-[10px] font-mono font-bold text-zinc-400">
                      {idx + 1}
                    </span>
                    <div>
                      <p className="font-semibold text-zinc-200">{p.name}</p>
                      <p className="text-[11px] text-zinc-500 font-mono">{p.quantity} unidades vendidas</p>
                    </div>
                  </div>
                  <p className="font-mono font-bold text-zinc-200 text-xs">{money(p.total)}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Canales */}
        <div className="rounded-2xl bg-zinc-900 p-5 border border-zinc-800">
          <h2 className="text-sm font-mono font-bold uppercase tracking-wider text-zinc-400 mb-4">
            Ventas por canal
          </h2>
          {loading ? (
            <div className="space-y-4 pt-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : (
            <div className="space-y-3">
              {Object.entries(CHANNEL_LABEL).map(([ch, label]) => {
                const data = porCanal[ch] || { count: 0, total: 0 }
                const pct = orders.length > 0 ? Math.round((data.count / orders.length) * 100) : 0
                return (
                  <div key={ch} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="font-medium text-zinc-300">{label}</span>
                      <span className="text-zinc-500 font-mono">{data.count} ({pct}%)</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-950">
                      <div
                        className="h-full bg-zinc-200 transition-all rounded-full"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <p className="text-right text-[10px] text-zinc-500 font-mono">{money(data.total)}</p>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Tabla pedidos de hoy */}
      <div className="rounded-2xl bg-zinc-900 p-5 border border-zinc-800">
        <h2 className="text-sm font-mono font-bold uppercase tracking-wider text-zinc-400 mb-3">
          Pedidos de hoy
        </h2>
        {loading ? (
          <TableSkeleton rows={5} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-zinc-800 font-mono uppercase text-[10px] text-zinc-500">
                <tr>
                  <th className="py-2.5 font-bold">#</th>
                  <th className="py-2.5">Hora</th>
                  <th className="py-2.5">Tipo</th>
                  <th className="py-2.5">Canal</th>
                  <th className="py-2.5">Productos</th>
                  <th className="py-2.5">Estado</th>
                  <th className="py-2.5 text-right font-bold">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 font-sans">
                {orders.map((o) => {
                  const st = STATUS_STYLE[o.status] || { label: o.status, badge: 'bg-zinc-800 text-zinc-400 border-zinc-700' }
                  return (
                    <tr key={o.id} className="hover:bg-zinc-850/40 transition">
                      <td className="py-3 font-mono font-bold text-zinc-100">#{o.order_number}</td>
                      <td className="py-3 text-zinc-500 font-mono">
                        {new Date(o.created_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="py-3 font-medium text-zinc-300">
                        {o.delivery_type === 'mesa' ? `Mesa ${o.table_label}` : o.delivery_type === 'domicilio' ? 'Domicilio' : 'Recogida'}
                      </td>
                      <td className="py-3 text-zinc-400">{CHANNEL_LABEL[o.channel]}</td>
                      <td className="py-3 text-zinc-400 max-w-xs truncate">
                        {o.order_items?.map((it) => `${it.quantity}x ${it.product_name}`).join(', ')}
                      </td>
                      <td className="py-3">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-mono font-bold border ${st.badge}`}>
                          {st.label}
                        </span>
                      </td>
                      <td className="py-3 text-right font-mono font-bold text-zinc-100">{money(Number(o.total))}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
