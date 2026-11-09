// =====================================================================
// RESTAURANT OS — Parser unificado de pedidos en texto libre (español)
// Compatible con Deno (Supabase Edge Functions) y Node/Vite (Frontend)
//
// Módulo puro SIN dependencias externas.
// IMPORTANTE: este módulo solo PROPONE. Nunca decide precios finales
// ni confirma pedidos. La base de datos valida todo en create_order().
// =====================================================================

export interface CatalogProduct {
  id: string
  name: string
  aliases: string[]
  is_available: boolean
  price?: number
  ingredients: { name: string; removable: boolean }[]
  modifiers: { id: string; name: string; extra_price?: number; is_available: boolean }[]
}

export type LineStatus = 'ok' | 'ambiguous' | 'unknown' | 'unavailable'
export type DeliveryGuess = 'mesa' | 'recogida' | 'domicilio'

export interface ParsedLine {
  id: string
  raw: string
  quantity: number
  productId: string | null
  candidates: string[] // ids de productos posibles si hay ambigüedad
  excluded: string[]
  modifierIds: string[]
  warnings: string[]
  status: LineStatus
  // Texto pendiente de resolver cuando se elija el producto
  exclRaw: string[]
  addRaw: string[]
  fullText: string
}

export interface ParsedOrder {
  lines: ParsedLine[]
  table: string | null
  deliveryType: DeliveryGuess | null
  warnings: string[]
}

const NUM_WORDS: Record<string, number> = {
  un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6,
  siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
}

// ---------------------------------------------------------------- utilidades

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s,;+\n]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

function stem(token: string): string {
  if (token.length <= 3) return token
  if (/(l|n|r)es$/.test(token)) return token.slice(0, -2)
  if (token.endsWith('s')) return token.slice(0, -1)
  return token
}

export function stemPhrase(s: string): string {
  return normalize(s)
    .split(/\s+/)
    .filter(Boolean)
    .map(stem)
    .join(' ')
}

function containsPhrase(hay: string, needle: string): boolean {
  return needle !== '' && ` ${hay} `.includes(` ${needle} `)
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  const dp: number[] = Array.from({ length: n + 1 }, (_, i) => i)
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= n; j++) {
      const cur = dp[j]
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1])
      prev = cur
    }
  }
  return dp[n]
}

let counter = 0
const newId = () => `l${++counter}`

// ------------------------------------------------------- búsqueda de producto

interface Index {
  product: CatalogProduct
  names: string[]
}

function buildIndex(catalog: CatalogProduct[]): Index[] {
  return catalog.map((p) => {
    const raw = [p.name, ...(p.aliases ?? [])]
    const set = new Set<string>()
    for (const r of raw) {
      const s = stemPhrase(r)
      if (s) set.add(s)
    }
    return { product: p, names: Array.from(set) }
  })
}

function findProduct(coreText: string, index: Index[]): { product: CatalogProduct | null; candidates: CatalogProduct[] } {
  if (!coreText) return { product: null, candidates: [] }
  const target = stemPhrase(coreText)
  if (!target) return { product: null, candidates: [] }

  for (const entry of index) {
    if (entry.names.some((n) => n === target)) {
      return { product: entry.product, candidates: [] }
    }
  }

  const matches = index.filter((e) => e.names.some((n) => containsPhrase(target, n) || containsPhrase(n, target)))
  if (matches.length === 1) return { product: matches[0].product, candidates: [] }
  if (matches.length > 1) {
    const exactWordMatch = matches.find((e) => e.names.some((n) => target.split(/\s+/).includes(n)))
    if (exactWordMatch && matches.length === 2) {
      return { product: null, candidates: matches.map((m) => m.product) }
    }
    return { product: null, candidates: matches.map((m) => m.product) }
  }

  const scored: { p: CatalogProduct; d: number }[] = []
  for (const entry of index) {
    let minD = Infinity
    for (const n of entry.names) {
      const d = levenshtein(target, n)
      if (d < minD) minD = d
    }
    const maxAllowed = target.length <= 4 ? 1 : target.length <= 8 ? 2 : 3
    if (minD <= maxAllowed) scored.push({ p: entry.product, d: minD })
  }
  scored.sort((a, b) => a.d - b.d)
  if (!scored.length) return { product: null, candidates: [] }
  if (scored.length === 1 || (scored[1] && scored[1].d > scored[0].d + 1)) {
    return { product: scored[0].p, candidates: [] }
  }
  const top = scored.filter((x) => x.d === scored[0].d)
  return { product: null, candidates: top.map((x) => x.p) }
}

// ----------------------------------------- ingredientes y modificadores

/** Aplica un producto a una línea: resuelve exclusiones, adicionales y estado. */
export function applyProduct(line: ParsedLine, product: CatalogProduct): ParsedLine {
  const warnings: string[] = []
  const excluded: string[] = []
  const modifierIds: string[] = []

  for (const raw of line.exclRaw) {
    const t = stemPhrase(raw)
    const ing = product.ingredients.find((i) => {
      const n = stemPhrase(i.name)
      return n === t || containsPhrase(t, n) || containsPhrase(n, t)
    })
    if (!ing) warnings.push(`"${raw}" no es un ingrediente de ${product.name}`)
    else if (!ing.removable) warnings.push(`${ing.name} no se puede quitar de ${product.name}`)
    else if (!excluded.includes(ing.name)) excluded.push(ing.name)
  }

  const modTokens = (s: string) => stemPhrase(s).split(/\s+/).filter(Boolean)
  for (const raw of line.addRaw) {
    const tokens = modTokens(raw).filter((t) => !['con', 'extra', 'adicional', 'adicionales', 'de', 'mas'].includes(t))
    if (!tokens.length) continue
    const m = product.modifiers.find((mm) => {
      const mt = modTokens(mm.name)
      return tokens.every((t) => mt.includes(t))
    })
    if (!m) warnings.push(`No hay adicional "${raw}" para ${product.name}`)
    else if (!modifierIds.includes(m.id)) modifierIds.push(m.id)
  }

  const unavailable = !product.is_available
  if (unavailable) warnings.push(`${product.name} está agotado`)
  for (const id of modifierIds) {
    const m = product.modifiers.find((x) => x.id === id)
    if (m && !m.is_available) warnings.push(`El adicional ${m.name} no está disponible`)
  }

  return {
    ...line,
    productId: product.id,
    excluded,
    modifierIds,
    status: unavailable ? 'unavailable' : 'ok',
    warnings: [...line.warnings, ...warnings],
    candidates: [],
  }
}

// ------------------------------------------------------------------ parser

const KEYWORD = /\b(sin|con|extra|adicional(?:es)?)\b/

function splitSegments(text: string): string[] {
  return text
    .split(/[\n,;+]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function extractQuantity(s: string): { quantity: number; hasQty: boolean; rest: string } {
  const numMatch = s.match(/^(\d+)\s*(?:x\s*)?(.*)$/)
  if (numMatch) {
    const q = parseInt(numMatch[1], 10)
    return { quantity: q > 0 && q < 100 ? q : 1, hasQty: true, rest: numMatch[2].trim() }
  }
  const first = s.split(/\s+/)[0]
  if (first && first in NUM_WORDS) {
    return { quantity: NUM_WORDS[first], hasQty: true, rest: s.slice(first.length).trim() }
  }
  return { quantity: 1, hasQty: false, rest: s }
}

function splitList(s: string): string[] {
  return s
    .split(/\s+ni\s+|\s+e\s+|\s+y\s+/)
    .map((x) => x.trim())
    .filter(Boolean)
}

export function parseQuickOrder(input: string, catalog: CatalogProduct[]): ParsedOrder {
  const result: ParsedOrder = { lines: [], table: null, deliveryType: null, warnings: [] }
  const index = buildIndex(catalog)
  const byId = new Map(catalog.map((p) => [p.id, p]))

  let text = normalize(input)
  if (!text) return result

  // Mesa: "mesa 3", "mesa barra"
  const mesa = text.match(/\bmesa\s*(?:numero\s*|no\s*)?([a-z0-9]+)/)
  if (mesa) {
    const w = mesa[1]
    result.table = w in NUM_WORDS ? String(NUM_WORDS[w]) : w
    result.deliveryType = 'mesa'
    text = text.replace(mesa[0], ' ')
  }
  // Para llevar / domicilio
  if (/\b(para llevar|llevar|recoger|recogida|recoge)\b/.test(text)) {
    result.deliveryType = 'recogida'
    text = text.replace(/\b(para llevar|llevar|recoger|recogida|recoge)\b/g, ' ')
  } else if (/\b(domicilio|a domicilio|para domicilio|delivery)\b/.test(text)) {
    result.deliveryType = 'domicilio'
    text = text.replace(/\b(domicilio|a domicilio|para domicilio|delivery)\b/g, ' ')
  }

  let last: ParsedLine | null = null
  let lastMode: 'sin' | 'con' | null = null

  const push = (line: ParsedLine) => {
    result.lines.push(line)
    last = line
  }

  const replaceLine = (prev: ParsedLine, next: ParsedLine) => {
    const idx = result.lines.findIndex((l) => l.id === prev.id)
    if (idx !== -1) result.lines[idx] = next
    last = next
  }

  for (const seg of splitSegments(text)) {
    const { quantity, hasQty, rest } = extractQuantity(seg)

    // Separar núcleo (producto) de "sin ..." y "con/extra ..."
    const kw = rest.search(KEYWORD)
    const coreText = (kw === -1 ? rest : rest.slice(0, kw)).trim()
    const tail = kw === -1 ? '' : rest.slice(kw)

    const exclRaw: string[] = []
    const addRaw: string[] = []
    if (tail) {
      const parts = tail.split(/\b(?=sin\b|con\b|extra\b|adicional(?:es)?\b)/).map((p) => p.trim()).filter(Boolean)
      for (const p of parts) {
        if (/^sin\b/.test(p)) {
          exclRaw.push(...splitList(p.replace(/^sin\s+/, '')))
        } else {
          addRaw.push(...splitList(p.replace(/^(?:con|extra|adicional(?:es)?)\s+/, '')))
        }
      }
    }

    const { product, candidates } = findProduct(coreText, index)
    const base: ParsedLine = {
      id: newId(),
      raw: seg,
      quantity,
      productId: null,
      candidates: [],
      excluded: [],
      modifierIds: [],
      warnings: [],
      status: 'unknown',
      exclRaw,
      addRaw,
      fullText: seg,
    }

    // 1) Producto reconocido
    if (product) {
      push(applyProduct(base, product))
      lastMode = exclRaw.length ? 'sin' : addRaw.length ? 'con' : null
      continue
    }
    // 2) Ambiguo
    if (candidates.length > 1) {
      push({ ...base, status: 'ambiguous', candidates: candidates.map((c) => c.id) })
      lastMode = null
      continue
    }

    // 3) Sin producto: "una sin cebolla" -> variante de la línea anterior
    const prev = last as ParsedLine | null
    if (!coreText && (exclRaw.length || addRaw.length) && prev && prev.productId) {
      const prod = byId.get(prev.productId)!
      if (hasQty && quantity < prev.quantity) {
        prev.quantity -= quantity
        const variant = applyProduct(
          {
            ...prev,
            id: newId(),
            raw: seg,
            quantity,
            exclRaw: [...prev.exclRaw, ...exclRaw],
            addRaw: [...prev.addRaw, ...addRaw],
            fullText: `${prev.fullText} ${seg}`,
          },
          prod,
        )
        push(variant)
      } else {
        replaceLine(
          prev,
          applyProduct(
            {
              ...prev,
              exclRaw: [...prev.exclRaw, ...exclRaw],
              addRaw: [...prev.addRaw, ...addRaw],
              fullText: `${prev.fullText} ${seg}`,
            },
            prod,
          ),
        )
      }
      lastMode = exclRaw.length ? 'sin' : addRaw.length ? 'con' : null
      continue
    }

    // 4) Continuación: "sin cebolla y tomate" -> "tomate" se suma a lo anterior
    if (!hasQty && !tail && coreText && prev && prev.productId && lastMode) {
      const prod = byId.get(prev.productId)!
      replaceLine(
        prev,
        applyProduct(
          {
            ...prev,
            exclRaw: lastMode === 'sin' ? [...prev.exclRaw, coreText] : prev.exclRaw,
            addRaw: lastMode === 'con' ? [...prev.addRaw, coreText] : prev.addRaw,
            fullText: `${prev.fullText} ${coreText}`,
          },
          prod,
        ),
      )
      continue
    }

    // 5) No entendido
    push({ ...base, status: 'unknown', warnings: [`No encontré "${seg}" en el menú`] })
    lastMode = null
  }

  return result
}
