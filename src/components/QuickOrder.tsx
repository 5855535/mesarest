import { useMemo, useState } from 'react'
import { money } from '../lib/format'
import {
  applyProduct,
  parseQuickOrder,
  type CatalogProduct,
  type DeliveryGuess,
  type ParsedLine,
  type ParsedOrder,
} from '../lib/orderParser'
import type { CartLine, ProductFull } from '../lib/types'

interface Props {
  products: ProductFull[]
  onApply: (r: { lines: CartLine[]; table: string | null; deliveryType: DeliveryGuess | null }) => void
}

const STATUS_STYLE: Record<ParsedLine['status'], string> = {
  ok: 'border-stone-200 bg-white',
  ambiguous: 'border-amber-300 bg-amber-50',
  unknown: 'border-red-300 bg-red-50',
  unavailable: 'border-red-300 bg-red-50',
}

export default function QuickOrder({ products, onApply }: Props) {
  const [text, setText] = useState('')
  const [parsed, setParsed] = useState<ParsedOrder | null>(null)

  const catalog = useMemo<CatalogProduct[]>(
    () =>
      products.map((p) => ({
        id: p.id,
        name: p.name,
        aliases: p.aliases ?? [],
        is_available: p.is_available,
        ingredients: p.product_ingredients.map((i) => ({ name: i.name, removable: i.removable })),
        modifiers: p.product_modifiers.map((m) => ({
          id: m.id,
          name: m.name,
          is_available: m.is_available,
        })),
      })),
    [products],
  )
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
  const catById = useMemo(() => new Map(catalog.map((p) => [p.id, p])), [catalog])

  const interpret = () => setParsed(parseQuickOrder(text, catalog))

  const patchLine = (id: string, fn: (l: ParsedLine) => ParsedLine) =>
    setParsed((p) => (p ? { ...p, lines: p.lines.map((l) => (l.id === id ? fn(l) : l)) } : p))

  const choose = (line: ParsedLine, productId: string) => {
    const prod = catById.get(productId)
    if (prod) patchLine(line.id, () => applyProduct(line, prod))
  }

  const remove = (id: string) =>
    setParsed((p) => (p ? { ...p, lines: p.lines.filter((l) => l.id !== id) } : p))

  const allOk = !!parsed && parsed.lines.length > 0 && parsed.lines.every((l) => l.status === 'ok')

  const apply = () => {
    if (!parsed || !allOk) return
    const lines: CartLine[] = parsed.lines.map((l) => {
      const product = byId.get(l.productId!)!
      return {
        key: crypto.randomUUID(),
        product,
        quantity: l.quantity,
        excluded: l.excluded,
        modifiers: product.product_modifiers.filter((m) => l.modifierIds.includes(m.id)),
        notes: '',
      }
    })
    onApply({ lines, table: parsed.table, deliveryType: parsed.deliveryType })
    setText('')
    setParsed(null)
  }

  const estimate = (l: ParsedLine) => {
    const p = l.productId ? byId.get(l.productId) : null
    if (!p) return null
    const extra = p.product_modifiers
      .filter((m) => l.modifierIds.includes(m.id))
      .reduce((s, m) => s + m.extra_price, 0)
    return (p.price + extra) * l.quantity
  }

  return (
    <div className="space-y-3 rounded-2xl bg-white p-4 ring-1 ring-stone-200">
      <div className="flex items-center justify-between">
        <h2 className="font-bold">Pedido rápido</h2>
        <span className="text-xs text-stone-400">Escribe o dicta con el micrófono del teclado</span>
      </div>
      <textarea
        value={text}
        rows={2}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || !e.shiftKey)) {
            e.preventDefault()
            interpret()
          }
        }}
        placeholder="Ej: mesa 1, dos hamburguesas especiales, una sin cebolla, 1 gaseosa"
        className="w-full resize-none rounded-xl border border-stone-300 px-3 py-2 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
      />
      <div className="flex gap-2">
        <button
          onClick={interpret}
          disabled={!text.trim()}
          className="rounded-xl bg-stone-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          Interpretar
        </button>
        {parsed && (
          <button
            onClick={() => setParsed(null)}
            className="rounded-xl px-3 py-2 text-sm text-stone-500 hover:bg-stone-100"
          >
            Limpiar
          </button>
        )}
      </div>

      {parsed && (
        <div className="space-y-3 border-t border-stone-100 pt-3">
          {parsed.lines.length === 0 ? (
            <p className="text-sm text-stone-500">No entendí ningún producto. Prueba con otras palabras.</p>
          ) : (
            <>
              <p className="text-sm text-stone-600">
                Entendí esto{' '}
                {parsed.table && <strong>· Mesa {parsed.table}</strong>}
                {!parsed.table && parsed.deliveryType && (
                  <strong>· {parsed.deliveryType === 'recogida' ? 'Para llevar' : 'Domicilio'}</strong>
                )}
              </p>
              <ul className="space-y-2">
                {parsed.lines.map((l) => {
                  const p = l.productId ? byId.get(l.productId) : null
                  const est = estimate(l)
                  const options =
                    l.status === 'ambiguous'
                      ? products.filter((x) => l.candidates.includes(x.id))
                      : products
                  return (
                    <li key={l.id} className={`rounded-xl border p-3 text-sm ${STATUS_STYLE[l.status]}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          {l.status === 'ok' || l.status === 'unavailable' ? (
                            <p className="font-semibold">
                              {l.quantity} × {p?.name}
                            </p>
                          ) : (
                            <div className="space-y-1">
                              <p className="text-xs text-stone-600">
                                {l.status === 'ambiguous'
                                  ? `¿Cuál quisiste decir con “${l.raw}”?`
                                  : `No reconocí “${l.raw}”. Elige el producto:`}
                              </p>
                              <select
                                defaultValue=""
                                onChange={(e) => choose(l, e.target.value)}
                                className="w-full rounded-lg border border-stone-300 bg-white px-2 py-1.5"
                              >
                                <option value="" disabled>
                                  Elegir producto...
                                </option>
                                {options.map((o) => (
                                  <option key={o.id} value={o.id}>
                                    {o.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}
                          {l.excluded.length > 0 && (
                            <p className="text-xs font-semibold text-red-600">Sin: {l.excluded.join(', ')}</p>
                          )}
                          {p && l.modifierIds.length > 0 && (
                            <p className="text-xs text-stone-600">
                              + {p.product_modifiers.filter((m) => l.modifierIds.includes(m.id)).map((m) => m.name).join(', ')}
                            </p>
                          )}
                          {l.warnings.map((w) => (
                            <p key={w} className="text-xs text-red-700">
                              ⚠ {w}
                            </p>
                          ))}
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          {est !== null && l.status === 'ok' && <span className="font-semibold">{money(est)}</span>}
                          <button onClick={() => remove(l.id)} className="text-xs text-stone-400 hover:text-red-600">
                            Quitar
                          </button>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
              <button
                onClick={apply}
                disabled={!allOk}
                className="w-full rounded-xl bg-brand-600 py-2.5 font-semibold text-white hover:bg-brand-700 disabled:opacity-40"
              >
                Agregar al pedido
              </button>
              {!allOk && (
                <p className="text-center text-xs text-stone-500">
                  Resuelve o quita las líneas marcadas en rojo o amarillo para continuar.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
