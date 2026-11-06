import { useState } from 'react'
import { money } from '../lib/format'
import type { CartLine, ProductFull } from '../lib/types'

interface Props {
  product: ProductFull
  onAdd: (line: CartLine) => void
  onClose: () => void
}

export default function ProductModal({ product, onAdd, onClose }: Props) {
  const [quantity, setQuantity] = useState(1)
  const [excluded, setExcluded] = useState<string[]>([])
  const [modIds, setModIds] = useState<string[]>([])
  const [notes, setNotes] = useState('')

  const removable = product.product_ingredients.filter((i) => i.removable)
  const mods = product.product_modifiers.filter((m) => m.is_available)

  const toggle = (list: string[], v: string) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v]

  const chosen = mods.filter((m) => modIds.includes(m.id))
  const unit = product.price + chosen.reduce((s, m) => s + m.extra_price, 0)

  const add = () =>
    onAdd({
      key: crypto.randomUUID(),
      product,
      quantity,
      excluded,
      modifiers: chosen,
      notes: notes.trim(),
    })

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-end bg-black/50 sm:place-items-center"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-md space-y-5 overflow-auto rounded-t-2xl bg-white p-6 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2 className="text-xl font-bold">{product.name}</h2>
          <p className="text-sm text-stone-500">{product.description}</p>
        </div>

        {removable.length > 0 && (
          <fieldset>
            <legend className="mb-2 text-sm font-semibold">Quitar ingredientes</legend>
            <div className="flex flex-wrap gap-2">
              {removable.map((i) => {
                const off = excluded.includes(i.name)
                return (
                  <button
                    key={i.id}
                    type="button"
                    onClick={() => setExcluded(toggle(excluded, i.name))}
                    className={`rounded-full border px-3 py-1 text-sm ${
                      off
                        ? 'border-red-300 bg-red-50 text-red-700 line-through'
                        : 'border-stone-300 hover:bg-stone-50'
                    }`}
                  >
                    {i.name}
                  </button>
                )
              })}
            </div>
          </fieldset>
        )}

        {mods.length > 0 && (
          <fieldset>
            <legend className="mb-2 text-sm font-semibold">Adicionales</legend>
            <div className="space-y-1">
              {mods.map((m) => (
                <label key={m.id} className="flex cursor-pointer items-center justify-between rounded-lg border border-stone-200 px-3 py-2 text-sm">
                  <span className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={modIds.includes(m.id)}
                      onChange={() => setModIds(toggle(modIds, m.id))}
                      className="h-4 w-4 accent-orange-600"
                    />
                    {m.name}
                  </span>
                  <span className="text-stone-500">+{money(m.extra_price)}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <label className="block text-sm font-semibold">
          Notas
          <input
            value={notes}
            maxLength={200}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ej: bien cocida"
            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 font-normal"
          />
        </label>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setQuantity(Math.max(1, quantity - 1))}
              className="h-9 w-9 rounded-full border border-stone-300 text-lg"
            >
              −
            </button>
            <span className="w-6 text-center font-semibold">{quantity}</span>
            <button
              type="button"
              onClick={() => setQuantity(Math.min(99, quantity + 1))}
              className="h-9 w-9 rounded-full border border-stone-300 text-lg"
            >
              +
            </button>
          </div>
          <button
            type="button"
            onClick={add}
            className="rounded-xl bg-brand-600 px-5 py-2.5 font-semibold text-white hover:bg-brand-700"
          >
            Agregar · {money(unit * quantity)}
          </button>
        </div>
      </div>
    </div>
  )
}
