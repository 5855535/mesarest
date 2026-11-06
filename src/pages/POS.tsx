import { useCallback, useEffect, useMemo, useState } from 'react'
import CustomerPicker from '../components/CustomerPicker'
import ProductModal from '../components/ProductModal'
import QuickOrder from '../components/QuickOrder'
import { money } from '../lib/format'
import { supabase } from '../lib/supabase'
import {
  lineTotal,
  type CartLine,
  type Category,
  type Customer,
  type ProductFull,
} from '../lib/types'

type Delivery = 'mesa' | 'recogida' | 'domicilio'
type Payment = 'efectivo' | 'tarjeta' | 'transferencia' | 'otro'

const PAYMENTS: { value: Payment; label: string }[] = [
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'tarjeta', label: 'Tarjeta' },
  { value: 'transferencia', label: 'Transferencia' },
  { value: 'otro', label: 'Otro' },
]

export default function POS() {
  const [cats, setCats] = useState<Category[]>([])
  const [products, setProducts] = useState<ProductFull[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [deliveryFee, setDeliveryFee] = useState(0)
  const [loading, setLoading] = useState(true)

  const [catFilter, setCatFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState<ProductFull | null>(null)

  const [cart, setCart] = useState<CartLine[]>([])
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [delivery, setDelivery] = useState<Delivery>('mesa')
  const [tableLabel, setTableLabel] = useState('')
  const [address, setAddress] = useState('')
  const [payment, setPayment] = useState<Payment>('efectivo')
  const [notes, setNotes] = useState('')

  const [idemKey, setIdemKey] = useState(() => crypto.randomUUID())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<number | null>(null)

  const load = useCallback(async () => {
    const [c, p, cu, s] = await Promise.all([
      supabase.from('categories').select('*').eq('is_active', true).order('sort_order'),
      supabase
        .from('products')
        .select('*, product_ingredients(*), product_modifiers(*)')
        .order('sort_order'),
      supabase.from('customers').select('id, full_name, phone, address').order('full_name'),
      supabase.from('business_settings').select('delivery_fee').single(),
    ])
    if (c.error || p.error) setError((c.error ?? p.error)!.message)
    else {
      setCats(c.data as Category[])
      setProducts(p.data as unknown as ProductFull[])
    }
    if (cu.data) setCustomers(cu.data as Customer[])
    if (s.data) setDeliveryFee(Number(s.data.delivery_fee))
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const visible = useMemo(() => {
    const t = search.trim().toLowerCase()
    const activeCats = new Set(cats.map((c) => c.id))
    return products.filter(
      (p) =>
        activeCats.has(p.category_id) &&
        (catFilter === 'all' || p.category_id === catFilter) &&
        (!t || p.name.toLowerCase().includes(t)),
    )
  }, [products, cats, catFilter, search])

  const subtotal = cart.reduce((s, l) => s + lineTotal(l), 0)
  const fee = delivery === 'domicilio' ? deliveryFee : 0
  const total = subtotal + fee

  const pick = (p: ProductFull) => {
    if (!p.is_available) return
    const needsOptions =
      p.product_ingredients.some((i) => i.removable) ||
      p.product_modifiers.some((m) => m.is_available)
    if (needsOptions) return setModal(p)
    setCart((c) => [
      ...c,
      { key: crypto.randomUUID(), product: p, quantity: 1, excluded: [], modifiers: [], notes: '' },
    ])
  }

  const setQty = (key: string, q: number) =>
    setCart((c) =>
      q <= 0 ? c.filter((l) => l.key !== key) : c.map((l) => (l.key === key ? { ...l, quantity: Math.min(q, 99) } : l)),
    )

  const selectCustomer = (c: Customer | null) => {
    setCustomer(c)
    if (c?.address && !address) setAddress(c.address)
  }

  const confirm = async () => {
    setError(null)
    if (cart.length === 0) return setError('Agrega al menos un producto')
    if (delivery === 'domicilio' && !address.trim()) return setError('Escribe la dirección de entrega')
    if (delivery === 'mesa' && !tableLabel.trim()) return setError('Escribe el número de mesa')
    setBusy(true)
    const { data, error } = await supabase.rpc('create_order', {
      p_channel: 'pos',
      p_delivery_type: delivery,
      p_payment_method: payment,
      p_customer_id: customer?.id ?? null,
      p_delivery_address: delivery === 'domicilio' ? address.trim() : null,
      p_table_label: delivery === 'mesa' ? tableLabel.trim() : null,
      p_notes: notes.trim() || null,
      p_items: cart.map((l) => ({
        product_id: l.product.id,
        quantity: l.quantity,
        notes: l.notes || null,
        excluded_ingredients: l.excluded,
        modifier_ids: l.modifiers.map((m) => m.id),
      })),
      p_idempotency_key: idemKey,
    })
    if (error) {
      setBusy(false)
      // Se refresca el catálogo por si un producto se agotó mientras tanto
      load()
      return setError(error.message)
    }
    const { data: ord } = await supabase.from('orders').select('order_number').eq('id', data).single()
    setSuccess(ord?.order_number ?? null)
    setCart([])
    setCustomer(null)
    setAddress('')
    setNotes('')
    setTableLabel('')
    setDelivery('mesa')
    setPayment('efectivo')
    setIdemKey(crypto.randomUUID())
    setBusy(false)
  }

  if (loading) return <p className="text-stone-500">Cargando productos...</p>

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      {/* Catálogo */}
      <section className="min-w-0 space-y-4">
        <h1 className="text-2xl font-bold">Caja</h1>
        <QuickOrder
          products={products.filter((p) => cats.some((c) => c.id === p.category_id))}
          onApply={({ lines, table, deliveryType }) => {
            setCart((c) => [...c, ...lines])
            if (table) {
              setDelivery('mesa')
              setTableLabel(table)
            } else if (deliveryType) {
              setDelivery(deliveryType)
            }
          }}
        />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar producto..."
          className="w-full rounded-xl border border-stone-300 bg-white px-4 py-2.5"
        />
        <div className="flex gap-2 overflow-x-auto pb-1">
          {[{ id: 'all', name: 'Todos' }, ...cats].map((c) => (
            <button
              key={c.id}
              onClick={() => setCatFilter(c.id)}
              className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium ${
                catFilter === c.id
                  ? 'bg-stone-900 text-white'
                  : 'bg-white text-stone-600 ring-1 ring-stone-200 hover:bg-stone-100'
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {visible.map((p) => (
            <button
              key={p.id}
              onClick={() => pick(p)}
              disabled={!p.is_available}
              className="rounded-xl bg-white p-4 text-left ring-1 ring-stone-200 transition hover:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <p className="font-semibold leading-tight">{p.name}</p>
              <p className="mt-1 line-clamp-2 text-xs text-stone-500">{p.description}</p>
              <p className="mt-3 font-bold text-brand-700">
                {p.is_available ? money(p.price) : 'Agotado'}
              </p>
            </button>
          ))}
          {visible.length === 0 && <p className="text-stone-500">Sin resultados.</p>}
        </div>
      </section>

      {/* Pedido */}
      <aside className="h-fit space-y-4 rounded-2xl bg-white p-5 ring-1 ring-stone-200 lg:sticky lg:top-6">
        <h2 className="text-lg font-bold">Pedido actual</h2>

        {success && (
          <div role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
            Pedido <strong>#{success}</strong> confirmado y enviado a cocina.
            <button onClick={() => setSuccess(null)} className="ml-2 underline">
              Cerrar
            </button>
          </div>
        )}

        {cart.length === 0 ? (
          <p className="text-sm text-stone-500">Selecciona productos del menú.</p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {cart.map((l) => (
              <li key={l.key} className="py-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{l.product.name}</p>
                    {l.excluded.length > 0 && (
                      <p className="text-xs text-red-600">Sin: {l.excluded.join(', ')}</p>
                    )}
                    {l.modifiers.length > 0 && (
                      <p className="text-xs text-stone-500">+ {l.modifiers.map((m) => m.name).join(', ')}</p>
                    )}
                    {l.notes && <p className="text-xs italic text-stone-500">“{l.notes}”</p>}
                  </div>
                  <p className="font-semibold">{money(lineTotal(l))}</p>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <button onClick={() => setQty(l.key, l.quantity - 1)} className="h-7 w-7 rounded-full border border-stone-300">
                    −
                  </button>
                  <span className="w-5 text-center">{l.quantity}</span>
                  <button onClick={() => setQty(l.key, l.quantity + 1)} className="h-7 w-7 rounded-full border border-stone-300">
                    +
                  </button>
                  <button onClick={() => setQty(l.key, 0)} className="ml-auto text-xs text-stone-400 hover:text-red-600">
                    Quitar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <CustomerPicker
          customers={customers}
          value={customer}
          onChange={selectCustomer}
          onCreated={(c) => setCustomers((cs) => [...cs, c])}
        />

        <div className="grid grid-cols-3 gap-2">
          {(['mesa', 'recogida', 'domicilio'] as Delivery[]).map((d) => (
            <button
              key={d}
              onClick={() => setDelivery(d)}
              className={`rounded-lg py-2 text-sm font-medium ${
                delivery === d ? 'bg-stone-900 text-white' : 'ring-1 ring-stone-300 hover:bg-stone-50'
              }`}
            >
              {d === 'mesa' ? 'Mesa' : d === 'recogida' ? 'Recogida' : 'Domicilio'}
            </button>
          ))}
        </div>
        {delivery === 'mesa' && (
          <input
            value={tableLabel}
            maxLength={20}
            onChange={(e) => setTableLabel(e.target.value)}
            placeholder="Mesa (ej: 1, 2, Barra) *"
            className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
          />
        )}
        {delivery === 'domicilio' && (
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Dirección de entrega *"
            className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
          />
        )}

        <select
          value={payment}
          onChange={(e) => setPayment(e.target.value as Payment)}
          className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
        >
          {PAYMENTS.map((p) => (
            <option key={p.value} value={p.value}>
              Pago: {p.label}
            </option>
          ))}
        </select>

        <input
          value={notes}
          maxLength={300}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notas del pedido"
          className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
        />

        <dl className="space-y-1 border-t border-stone-100 pt-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-stone-500">Subtotal</dt>
            <dd>{money(subtotal)}</dd>
          </div>
          {delivery === 'domicilio' && (
            <div className="flex justify-between">
              <dt className="text-stone-500">Domicilio</dt>
              <dd>{money(fee)}</dd>
            </div>
          )}
          <div className="flex justify-between text-lg font-bold">
            <dt>Total</dt>
            <dd>{money(total)}</dd>
          </div>
        </dl>

        {error && (
          <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        )}

        <button
          onClick={confirm}
          disabled={busy || cart.length === 0}
          className="w-full rounded-xl bg-brand-600 py-3 font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {busy ? 'Enviando...' : 'Confirmar pedido'}
        </button>
        <p className="text-center text-xs text-stone-400">
          El total final lo calcula el servidor con los precios vigentes.
        </p>
      </aside>

      {modal && (
        <ProductModal
          product={modal}
          onClose={() => setModal(null)}
          onAdd={(line) => {
            setCart((c) => [...c, line])
            setModal(null)
          }}
        />
      )}
    </div>
  )
}
