import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseQuickOrder, type CatalogProduct, type ParsedOrder } from './orderParser.ts'

const ing = (name: string, removable = true) => ({ name, removable })
const mod = (id: string, name: string) => ({ id, name, is_available: true })

const catalog: CatalogProduct[] = [
  {
    id: 'clasica', name: 'Hamburguesa Clásica', is_available: true,
    aliases: ['hamburguesa clasica', 'hamburguesa sencilla', 'clasica', 'sencilla', 'hamburguesas sencillas'],
    ingredients: [ing('Carne', false), ing('Queso'), ing('Lechuga'), ing('Tomate'), ing('Cebolla')],
    modifiers: [mod('m-queso', 'Queso extra'), mod('m-toc', 'Tocineta extra')],
  },
  {
    id: 'especial', name: 'Hamburguesa Especial', is_available: true,
    aliases: ['hamburguesa especial', 'especial', 'hamburguesas especiales', 'especiales'],
    ingredients: [ing('Carne', false), ing('Queso'), ing('Tocineta'), ing('Lechuga'), ing('Tomate'), ing('Cebolla')],
    modifiers: [mod('m-queso2', 'Queso extra'), mod('m-toc2', 'Tocineta extra')],
  },
  {
    id: 'perro', name: 'Perro Sencillo', is_available: true,
    aliases: ['perro sencillo', 'perro', 'perros', 'perros sencillos', 'hot dog'],
    ingredients: [ing('Salchicha', false), ing('Queso'), ing('Cebolla'), ing('Salsas')],
    modifiers: [],
  },
  {
    id: 'gaseosa', name: 'Gaseosa', is_available: true,
    aliases: ['gaseosa', 'gaseosas', 'coca cola', 'cocacola', 'coca', 'soda'],
    ingredients: [], modifiers: [],
  },
  {
    id: 'combo', name: 'Combo Especial', is_available: true,
    aliases: ['combo especial'], ingredients: [], modifiers: [],
  },
  {
    id: 'jugo', name: 'Jugo Natural', is_available: false,
    aliases: ['jugo', 'jugos'], ingredients: [], modifiers: [],
  },
]

const summary = (o: ParsedOrder) =>
  o.lines.map((l) => `${l.quantity}x ${l.productId ?? '?'}${l.excluded.length ? ' sin ' + l.excluded.join('+') : ''}${l.modifierIds.length ? ' con ' + l.modifierIds.join('+') : ''}`)

test('ejemplo de mesa con alias y plurales', () => {
  const o = parseQuickOrder('mesa 1, dos hamburguesas sencillas, 1 cocacola', catalog)
  assert.equal(o.table, '1')
  assert.equal(o.deliveryType, 'mesa')
  assert.deepEqual(summary(o), ['2x clasica', '1x gaseosa'])
})

test('"uno sin cebolla" separa una unidad de la linea anterior', () => {
  const o = parseQuickOrder('2 especiales, uno sin cebolla, 1 gaseosa', catalog)
  assert.deepEqual(summary(o), ['1x especial', '1x especial sin Cebolla', '1x gaseosa'])
})

test('sin sobre toda la cantidad cuando coincide', () => {
  const o = parseQuickOrder('dos especiales, dos sin tomate', catalog)
  assert.deepEqual(summary(o), ['2x especial sin Tomate'])
})

test('adicional con "con queso extra"', () => {
  const o = parseQuickOrder('una hamburguesa especial con queso extra', catalog)
  assert.deepEqual(summary(o), ['1x especial con m-queso2'])
})

test('varias exclusiones: "sin cebolla y tomate" y "sin cebolla ni tomate"', () => {
  assert.deepEqual(summary(parseQuickOrder('una especial sin cebolla y tomate', catalog)), ['1x especial sin Cebolla+Tomate'])
  assert.deepEqual(summary(parseQuickOrder('una especial sin cebolla ni tomate', catalog)), ['1x especial sin Cebolla+Tomate'])
})

test('ingrediente no removible genera aviso y no se excluye', () => {
  const o = parseQuickOrder('una especial sin carne', catalog)
  assert.deepEqual(o.lines[0].excluded, [])
  assert.match(o.lines[0].warnings.join(' '), /no se puede quitar/)
})

test('ingrediente inexistente genera aviso', () => {
  const o = parseQuickOrder('una especial sin pepino', catalog)
  assert.match(o.lines[0].warnings.join(' '), /no es un ingrediente/)
})

test('texto ambiguo pide aclaracion con candidatos', () => {
  const o = parseQuickOrder('una hamburguesa', catalog)
  assert.equal(o.lines[0].status, 'ambiguous')
  assert.deepEqual([...o.lines[0].candidates].sort(), ['clasica', 'especial'])
})

test('producto desconocido queda como unknown (no se inventa)', () => {
  const o = parseQuickOrder('tres pizzas', catalog)
  assert.equal(o.lines[0].status, 'unknown')
  assert.equal(o.lines[0].productId, null)
})

test('tolera errores de ortografia', () => {
  const o = parseQuickOrder('una hamburgesa especial', catalog)
  assert.deepEqual(summary(o), ['1x especial'])
})

test('"combo especial" gana sobre "especial"', () => {
  const o = parseQuickOrder('mesa 4, un combo especial', catalog)
  assert.deepEqual(summary(o), ['1x combo'])
  assert.equal(o.table, '4')
})

test('para llevar -> recogida; domicilio -> domicilio', () => {
  const a = parseQuickOrder('para llevar dos perros', catalog)
  assert.equal(a.deliveryType, 'recogida')
  assert.deepEqual(summary(a), ['2x perro'])
  assert.equal(parseQuickOrder('domicilio 1 gaseosa', catalog).deliveryType, 'domicilio')
})

test('producto agotado se marca unavailable', () => {
  const o = parseQuickOrder('un jugo', catalog)
  assert.equal(o.lines[0].status, 'unavailable')
})

test('mesa con palabra numerica y acentos/mayusculas', () => {
  const o = parseQuickOrder('MESA DOS: Una Hamburguesa Clásica, Una Gaseosa', catalog)
  assert.equal(o.table, '2')
  assert.deepEqual(summary(o), ['1x clasica', '1x gaseosa'])
})

test('texto vacio no produce lineas', () => {
  assert.deepEqual(parseQuickOrder('   ', catalog).lines, [])
})
