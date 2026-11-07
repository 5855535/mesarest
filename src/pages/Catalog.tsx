import { useCallback, useEffect, useRef, useState } from 'react'
import { Sparkles, Check, Loader2, X, AlertCircle } from 'lucide-react'
import { money } from '../lib/format'
import { supabase } from '../lib/supabase'
import type { Category, Product } from '../lib/types'

interface ScannedProduct {
  name: string
  description?: string
  price: number
  ingredients?: string[]
  modifiers?: { name: string; extra_price: number }[]
  aliases?: string[]
}

interface ScannedCategory {
  name: string
  products: ScannedProduct[]
}

interface ScanResult {
  categories: ScannedCategory[]
}

export default function Catalog() {
  const [cats, setCats] = useState<Category[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [priceDraft, setPriceDraft] = useState('')

  // Estado para el modal de Escaneo de Carta con IA
  const [scanModalOpen, setScanModalOpen] = useState(false)
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [imageMime, setImageMime] = useState<string>('image/jpeg')
  const [scanning, setScanning] = useState(false)
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)
  const [scanError, setScanError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [importSuccess, setImportSuccess] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

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

  // Manejo de carga de foto de la carta
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setImageMime(file.type || 'image/jpeg')
    const reader = new FileReader()
    reader.onload = () => {
      setPreviewImage(reader.result as string)
      setScanResult(null)
      setScanError(null)
      setScanModalOpen(true)
    }
    reader.readAsDataURL(file)
  }

  // Procesar imagen con Gemini 2.5 Flash
  const processImageWithAI = async () => {
    if (!previewImage) return
    setScanning(true)
    setScanError(null)

    try {
      const base64Data = previewImage.split(',')[1]

      const { data, error } = await supabase.functions.invoke('scan-menu', {
        body: {
          imageBase64: base64Data,
          mimeType: imageMime,
        },
      })

      if (error || !data?.ok) {
        throw new Error(data?.error || error?.message || 'Error analizando la imagen')
      }

      setScanResult(data.data as ScanResult)
    } catch (err: any) {
      setScanError(err.message || 'No se pudo leer la carta con IA')
    } finally {
      setScanning(false)
    }
  }

  // Importar productos escaneados a la base de datos
  const importToCatalog = async () => {
    if (!scanResult) return
    setImporting(true)
    setScanError(null)

    try {
      let sortOrder = cats.length + 1

      for (const cat of scanResult.categories) {
        // 1. Crear o buscar categoría
        let catId: string | null = null
        const existingCat = cats.find((c) => c.name.toLowerCase() === cat.name.toLowerCase())

        if (existingCat) {
          catId = existingCat.id
        } else {
          const { data: newCat, error: catErr } = await supabase
            .from('categories')
            .insert({ name: cat.name, sort_order: sortOrder++ })
            .select('id')
            .single()

          if (catErr) throw catErr
          catId = newCat.id
        }

        // 2. Insertar productos
        let prodSort = 1
        for (const p of cat.products) {
          const { data: newProd, error: pErr } = await supabase
            .from('products')
            .insert({
              category_id: catId,
              name: p.name,
              description: p.description || null,
              price: Math.max(0, p.price || 0),
              aliases: p.aliases || [p.name.toLowerCase()],
              sort_order: prodSort++,
              is_demo: false,
            })
            .select('id')
            .single()

          if (pErr) continue

          // 3. Ingredientes
          if (p.ingredients && p.ingredients.length > 0) {
            const ingRows = p.ingredients.map((ing) => ({
              product_id: newProd.id,
              name: ing,
              removable: true,
            }))
            await supabase.from('product_ingredients').insert(ingRows)
          }

          // 4. Modificadores
          if (p.modifiers && p.modifiers.length > 0) {
            const modRows = p.modifiers.map((m) => ({
              product_id: newProd.id,
              name: m.name,
              extra_price: Math.max(0, m.extra_price || 0),
            }))
            await supabase.from('product_modifiers').insert(modRows)
          }
        }
      }

      setImportSuccess(true)
      await load()
      setTimeout(() => {
        setScanModalOpen(false)
        setImportSuccess(false)
        setPreviewImage(null)
        setScanResult(null)
      }, 2000)
    } catch (err: any) {
      setScanError(err.message || 'Error guardando en el catálogo')
    } finally {
      setImporting(false)
    }
  }

  if (loading) return <p className="text-zinc-500 font-mono text-sm">Cargando catálogo...</p>

  return (
    <div className="max-w-4xl space-y-7 pb-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold font-mono tracking-tight text-zinc-100">CATÁLOGO</h1>
          <p className="text-xs text-zinc-400">
            Edita precios, disponibilidad o sube fotos de la carta con IA
          </p>
        </div>

        {/* Botón para escanear foto de menú con IA */}
        <div className="flex items-center gap-2">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept="image/*"
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="rounded-xl bg-gradient-to-r from-emerald-500 to-sky-500 hover:from-emerald-400 hover:to-sky-400 text-zinc-950 font-bold px-3.5 py-2 text-xs transition flex items-center gap-2 shadow-md"
          >
            <Sparkles className="h-4 w-4" />
            <span>Escanear Carta con Foto (IA)</span>
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded-xl bg-red-950/60 border border-red-800/60 p-3 text-xs text-red-300 font-mono">
          {error}
        </p>
      )}

      {/* Lista de Categorías y Productos */}
      <div className="space-y-6">
        {cats.map((cat) => (
          <section key={cat.id} className="space-y-2.5">
            <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-zinc-400 px-1">
              {cat.name}
            </h2>

            <div className="rounded-2xl bg-zinc-900 border border-zinc-800 divide-y divide-zinc-800/80 overflow-hidden shadow-sm">
              {products
                .filter((p) => p.category_id === cat.id)
                .map((p) => (
                  <div
                    key={p.id}
                    className="flex flex-wrap items-center justify-between gap-3 p-3.5 hover:bg-zinc-850/50 transition"
                  >
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
                          <button
                            onClick={() => setEditing(null)}
                            className="text-xs text-zinc-500 hover:text-zinc-300 px-1"
                          >
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

      {/* MODAL DE ESCANEO DE CARTA CON IA */}
      {scanModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm overflow-y-auto">
          <div className="relative w-full max-w-2xl rounded-2xl bg-zinc-900 border border-zinc-800 p-5 md:p-6 shadow-2xl space-y-4 my-8">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-emerald-400" />
                <h3 className="font-bold text-base text-zinc-100">Escanear Carta con IA</h3>
              </div>
              <button
                onClick={() => setScanModalOpen(false)}
                className="rounded-lg p-1 text-zinc-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {scanError && (
              <div className="rounded-xl bg-red-950/60 border border-red-800/60 p-3 text-xs text-red-300 font-mono flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{scanError}</span>
              </div>
            )}

            {importSuccess && (
              <div className="rounded-xl bg-emerald-950/60 border border-emerald-800/60 p-3 text-xs text-emerald-300 font-mono flex items-center gap-2">
                <Check className="h-4 w-4 shrink-0" />
                <span>¡Productos y categorías importados con éxito al catálogo!</span>
              </div>
            )}

            {/* Vista previa de la foto */}
            {previewImage && !scanResult && (
              <div className="space-y-4">
                <div className="max-h-72 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 flex items-center justify-center p-2">
                  <img
                    src={previewImage}
                    alt="Foto de la carta"
                    className="max-h-68 w-auto object-contain rounded-lg"
                  />
                </div>

                <div className="flex items-center justify-between pt-2">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="text-xs text-zinc-400 hover:text-zinc-200 underline"
                  >
                    Elegir otra foto
                  </button>

                  <button
                    onClick={processImageWithAI}
                    disabled={scanning}
                    className="rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold px-4 py-2 text-xs transition flex items-center gap-2 disabled:opacity-50"
                  >
                    {scanning ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>Analizando carta con Gemini Flash...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4" />
                        <span>Digitalizar Menú con IA</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Resultados detectados por la IA */}
            {scanResult && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono uppercase text-emerald-400 font-bold">
                    Productos detectados en la imagen
                  </span>
                  <span className="text-xs text-zinc-400 font-mono">
                    {scanResult.categories.reduce((acc, c) => acc + c.products.length, 0)} platos encontrados
                  </span>
                </div>

                <div className="max-h-80 overflow-y-auto space-y-3 rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                  {scanResult.categories.map((cat, idx) => (
                    <div key={idx} className="space-y-2">
                      <h4 className="text-xs font-mono font-bold text-sky-400 uppercase">
                        {cat.name}
                      </h4>
                      <div className="space-y-1.5 pl-2 border-l border-zinc-800">
                        {cat.products.map((p, pIdx) => (
                          <div
                            key={pIdx}
                            className="flex items-center justify-between text-xs py-1 border-b border-zinc-900 last:border-0"
                          >
                            <div>
                              <p className="font-semibold text-zinc-200">{p.name}</p>
                              {p.description && (
                                <p className="text-[11px] text-zinc-400 line-clamp-1">
                                  {p.description}
                                </p>
                              )}
                            </div>
                            <span className="font-mono font-bold text-zinc-300 shrink-0 ml-2">
                              {money(p.price)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between pt-2">
                  <button
                    onClick={() => {
                      setScanResult(null)
                      setScanError(null)
                    }}
                    className="text-xs text-zinc-400 hover:text-zinc-200 underline"
                  >
                    Volver a intentar
                  </button>

                  <button
                    onClick={importToCatalog}
                    disabled={importing || importSuccess}
                    className="rounded-xl bg-zinc-100 hover:bg-white text-zinc-950 font-bold px-4 py-2 text-xs transition flex items-center gap-2 disabled:opacity-50"
                  >
                    {importing ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>Guardando en la base de datos...</span>
                      </>
                    ) : (
                      <>
                        <Check className="h-4 w-4 text-emerald-600" />
                        <span>Confirmar e Importar al Menú</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
