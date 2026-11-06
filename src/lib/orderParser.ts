// =====================================================================
// Interprete de pedidos en texto libre (espanol). SIN dependencias:
// se puede reutilizar tal cual en el backend (bot de Telegram).
//
// IMPORTANTE: este modulo solo PROPONE. Nunca decide precios, totales
// ni confirma pedidos. La base de datos valida todo en create_order().
// =====================================================================

export interface CatalogProduct {
  id: string
  name: string
  aliases: string[]
  is_available: boolean
  ingredients: { name: string; removable: boolean }[]
  modifiers: { id: string; name: string; is_available: boolean }[]
}

export type LineStatus = 'ok' | 'ambiguous' | 'unknown' | 'unavailable'
export type DeliveryGuess = 'mesa' | 'recogida' | 'domicilio'

export interface ParsedLine {
  id: string
  raw: string
  quantity: number
  productId: string | null
  candidates: string[] // ids de productos posibles si hay ambiguedad
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
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 0; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
  return dp[a.length][b.length]
}

let counter = 0
const newId = () => `l${++counter}`

// ------------------------------------------------------- busqueda de producto

interface Index {
  product: CatalogProduct
  names: string[]
}

function buildIndex(catalog: CatalogProduct[]): Index[] {
  return catalog.map((product) => ({
    product,
    names: [product.name, ...product.aliases].map(stemPhrase).filter(Boolean),
  }))
}

function scoreProduct(core: string, names: string[]): number {
  let best = 0
  for (const n of names) {
    let s = 0
    if (core === n) s = 1000 + n.length
    else if (containsPhrase(core, n)) s = 500 + n.length
    else if (core.length >= 4 && containsPhrase(n, core)) s = 200 + core.length
    else {
      const d = levenshtein(core, n)
      const tolerance = n.length >= 8 ? 2 : n.length >= 4 ? 1 : 0
      if (d <= tolerance) s = 100 - d
    }
    if (s > best) best = s
  }
  return best
}

function matchProduct(
  core: string,
  index: Index[],
): { product: CatalogProduct | null; candidates: CatalogProduct[] } {
  if (!core) return { product: null, candidates: [] }
  const scored = index
    .map((i) => ({ p: i.product, s: scoreProduct(core, i.names) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
  if (scored.length === 0) return { product: null, candidates: [] }
  const top = scored.filter((x) => x.s === scored[0].s)
  if (top.length === 1) return { product: top[0].p, candidates: [] }
  return { product: null, candidates: top.map((x) => x.p) }
}

// ----------------------------------------- ingredientes y modificadores

/** Aplica un producto a una linea: resuelve exclusiones, adicionales y estado. */
export function applyProduct(line: ParsedLine, product: CatalogProduct): ParsedLine {
  const warnings: string[] = []
  const excluded: string[] = []
  const modifierIds: string[] = []

  for (const raw of line.exclRaw) {
    const t = stemPhrase(raw)
    if (!t) continue
    const ing = product.ingredients.find((i) => {
      const n = stemPhrase(i.name)
      return n === t || containsPhrase(t, n) || containsPhrase(n, t)
    })
    if (!ing) warnings.push(`"${raw}" no es un ingrediente de ${product.name}`)
    else if (!ing.removable) warnings.push(`${ing.name} no se puede quitar de ${product.name}`)
    else if (!excluded.includes(ing.name)) excluded.push(ing.name)
  }

  const modTokens = (name: string) =>
    stemPhrase(name).split(' ').filter((w) => w !== 'extra')

  const full = stemPhrase(line.fullText)
  for (const m of product.modifiers) {
    if (containsPhrase(full, stemPhrase(m.name)) && !modifierIds.includes(m.id)) {
      modifierIds.push(m.id)
    }
  }
  for (const raw of line.addRaw) {
    const tokens = stemPhrase(raw).split(' ').filter((w) => w && w !== 'extra')
    if (tokens.length === 0) continue
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
    candidates: [],
    excluded,
    modifierIds,
    warnings,
    status: unavailable ? 'unavailable' : 'ok',
  }
}

// ------------------------------------------------------------------ parser

const KEYWORD = /\b(sin|con|extra|adicional(?:es)?)\b/

function splitSegments(text: string): string[] {
  return text
    .split(/[,;\n+]|\s+y\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function extractQuantity(seg: string): { quantity: number; hasQty: boolean; rest: string } {
  const digits = seg.match(/^(\d{1,2})\s*x?\s*(.*)$/)
  if (digits) return { quantity: Math.max(1, Number(digits[1])), hasQty: true, rest: digits[2] }
  const first = seg.split(' ')[0]
  if (first in NUM_WORDS) {
    return { quantity: NUM_WORDS[first], hasQty: true, rest: seg.slice(first.length).trim() }
  }
  return { quantity: 1, hasQty: false, rest: seg }
}

function splitList(s: string): string[] {
  return s
    .split(/\s+ni\s+|\s+e\s+/)
    .map((x) => x.trim())
    .filter(Boolean)
}

export function parseQuickOrder(input: string, catalog: CatalogProduct[]): ParsedOrder {
  const index = buildIndex(catalog)
  const byId = new Map(catalog.map((p) => [p.id, p]))
  const result: ParsedOrder = { lines: [], table: null, deliveryType: null, warnings: [] }

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
  }
  if (/\bdomicilio\b/.test(text)) {
    result.deliveryType = 'domicilio'
    text = text.replace(/\bdomicilio\b/g, ' ')
  }

  let last: ParsedLine | null = null
  let lastMode: 'sin' | 'con' | null = null

  const push = (l: ParsedLine) => {
    result.lines.push(l)
    last = l
  }
  const replaceLine = (old: ParsedLine, next: ParsedLine) => {
    result.lines[result.lines.indexOf(old)] = next
    last = next
  }

  for (const seg of splitSegments(text)) {
    const { quantity, hasQty, rest } = extractQuantity(seg)

    // separar nucleo (producto) de "sin ..." y "con/extra ..."
    const kw = rest.search(KEYWORD)
    const coreText = (kw === -1 ? rest : rest.slice(0, kw)).trim()
    const tail = kw === -1 ? '' : rest.slice(kw)
    const exclRaw: string[] = []
    const addRaw: string[] = []
    for (const m of tail.matchAll(/\bsin\s+(.+?)(?=\s+(?:con|extra|adicional(?:es)?)\b|$)/g))
      exclRaw.push(...splitList(m[1]))
    for (const m of tail.matchAll(/\b(?:con|extra|adicional(?:es)?)\s+(.+?)(?=\s+(?:sin|con|extra|adicional(?:es)?)\b|$)/g))
      addRaw.push(...splitList(m[1]))

    const core = stemPhrase(coreText)
    const { product, candidates } = matchProduct(core, index)

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

    // 3) Sin producto: "una sin cebolla" -> variante de la linea anterior
    const prev = last as ParsedLine | null
    if (!core && (exclRaw.length || addRaw.length) && prev && prev.productId) {
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
      lastMode = exclRaw.length ? 'sin' : 'con'
      continue
    }

    // 4) Continuacion: "sin cebolla y tomate" -> "tomate" se suma a lo anterior
    if (!hasQty && !tail && coreText && prev && prev.productId && lastMode) {
      const prod = byId.get(prev.productId)!
      replaceLine(
        prev,
        applyProduct(
          {
            ...prev,
            exclRaw: lastMode === 'sin' ? [...prev.exclRaw, coreText] : prev.exclRaw,
            addRaw: lastMode === 'con' ? [...prev.addRaw, coreText] : prev.addRaw,
            fullText: prev.fullText,
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
