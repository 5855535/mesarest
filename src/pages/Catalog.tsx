import { useCallback, useEffect, useState } from 'react'
import { money } from '../lib/format'
import { supabase } from '../lib/supabase'
import type { Category, Product } from '../lib/types'

export default function Catalog() {
  const [cats, setCats] = useState<Category[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [priceDraft, setPriceDraft] = useState('')

  const load = useCallback(async () => {
    const [c, p] = await Promise.all([
      supabase.from('categories').select('*').order('sort_order'),
      supabase.from('products').select('*').order('sort_order'),
    ])
    if (c.error || p.error) setError((c.error ?? p.error)!.message)
    else {
      setCats(c.data as Category[])
      setProducts(p.data as Product[])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const update = async (id: string, patch: Partial<Product>) => {
    setError(null)
    const { error } = await supabase.from('products').update(patch).eq('id', id)
    if (error) setError(error.message)
    else await load()
  }

  const savePrice = async (id: string) => {
    const price = Number(priceDraft)
    if (!Number.isFinite(price) || price < 0) return setError('Precio inválido')
    await update(id, { price })
    setEditing(null)
  }

  if (loading) return <p className="text-zinc-500 font-mono text-sm">Cargando catálogo...</p>

  return (
    <div className="max-w-4xl space-y-7 pb-10">
      <div>
        <h1 className="text-xl font-bold font-mono tracking-tight text-zinc-100">CATÁLOGO</h1>
        <p className="text-xs text-zinc-400">
          Edita precios y disponibilidad de productos en tiempo real
        </p>
      </div>

      {error && <p className="rounded-xl bg-red-950/60 border border-red-800/60 p-3 text-xs text-red-300 font-mono">{error}</p>}

      <div className="space-y-6">
        {cats.map((cat) => (
          <section key={cat.id} className="space-y-2.5">
            <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-zinc-400 px-1">
              {cat.name}
            </h2>

            <div className="rounded-2xl bg-zinc-900 border border-zinc-800 divide-y divide-zinc-800/80 overflow-hidden">
              {products
                .filter((p) => p.category_id === cat.id)
                .map((p) => (
                  <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 p-3.5 hover:bg-zinc-850/50 transition">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-sm text-zinc-100">{p.name}</p>
                        {p.is_demo && (
                          <span className="rounded bg-zinc-800 border border-zinc-700/80 px-1.5 py-0.2 text-[10px] font-mono font-bold text-amber-400">
                            DEMO
                          </span>
                        )}
                      </div>
                      <p className="truncate text-xs text-zinc-400 mt-0.5">{p.description}</p>
                    </div>

                    <div className="flex items-center gap-3">
                      {editing === p.id ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            min={0}
                            step={500}
                            autoFocus
                            value={priceDraft}
                            onChange={(e) => setPriceDraft(e.target.value)}
                            className="w-24 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100 font-mono"
                          />
                          <button
                            onClick={() => savePrice(p.id)}
                            className="rounded-lg bg-zinc-100 text-zinc-900 px-2.5 py-1 text-xs font-bold hover:bg-white"
                          >
                            OK
                          </button>
                          <button onClick={() => setEditing(null)} className="text-xs text-zinc-500 hover:text-zinc-300 px-1">
                            ✕
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            setEditing(p.id)
                            setPriceDraft(String(p.price))
                          }}
                          className="rounded-lg bg-zinc-950 border border-zinc-800 hover:border-zinc-700 px-2.5 py-1 text-xs font-mono font-bold text-zinc-200 transition"
                          title="Toca para editar precio"
                        >
                          {money(p.price)} ✎
                        </button>
                      )}

                      <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-zinc-300 bg-zinc-950 border border-zinc-800 px-2.5 py-1 rounded-lg">
                        <input
                          type="checkbox"
                          checked={p.is_available}
                          onChange={(e) => update(p.id, { is_available: e.target.checked })}
                          className="h-3.5 w-3.5 rounded bg-zinc-900 border-zinc-700 accent-emerald-500"
                        />
                        <span className={p.is_available ? 'text-zinc-300' : 'text-zinc-500'}>
                          {p.is_available ? 'Disponible' : 'Agotado'}
                        </span>
                      </label>
                    </div>
                  </div>
                ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
