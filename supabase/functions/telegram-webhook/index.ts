// Supabase Edge Function: telegram-webhook con IA (Gemini 2.5 Flash) y Notas de Voz
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'
import {
  parseQuickOrder,
  type CatalogProduct,
  type ParsedOrder,
} from './orderParser.ts'
import { extractAudioWithGemini, extractWithGemini, type GeminiExtraction } from './gemini.ts'

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? ''
const WEBHOOK_SECRET = Deno.env.get('TELEGRAM_WEBHOOK_SECRET') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`

async function tg(method: string, body: Record<string, unknown>) {
  const r = await fetch(`${TELEGRAM_API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return await r.json()
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString('es-CO')}`
}

async function loadCatalog(): Promise<{ catalog: CatalogProduct[]; byId: Map<string, any>; contextStr: string }> {
  const { data: prods } = await supabase
    .from('products')
    .select('id, name, aliases, price, is_available, product_ingredients(name, removable), product_modifiers(id, name, extra_price, is_available)')
    .eq('is_available', true)

  const catalog: CatalogProduct[] = (prods || []).map((p: any) => ({
    id: p.id,
    name: p.name,
    aliases: p.aliases || [],
    price: Number(p.price),
    is_available: p.is_available,
    ingredients: (p.product_ingredients || []).map((i: any) => ({ name: i.name, removable: i.removable })),
    modifiers: (p.product_modifiers || []).map((m: any) => ({
      id: m.id,
      name: m.name,
      extra_price: Number(m.extra_price),
      is_available: m.is_available,
    })),
  }))

  const byId = new Map(catalog.map((p) => [p.id, p]))

  // Resumen textual para enviar en el prompt de Gemini
  const contextStr = catalog
    .map((p) => {
      const ing = p.ingredients.map((i) => i.name + (i.removable ? ' (removible)' : '')).join(', ')
      const mod = p.modifiers.map((m) => `${m.name} (+${money(m.extra_price || 0)})`).join(', ')
      return `• Producto: "${p.name}" | Precio: ${money(p.price || 0)} | Ingredientes: [${ing}] | Adicionales: [${mod}] | Alias: [${p.aliases.join(', ')}]`
    })
    .join('\n')

  return { catalog, byId, contextStr }
}

// Descarga un archivo de Telegram y lo convierte en Base64
async function downloadTelegramAudio(fileId: string): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const fileInfo = await tg('getFile', { file_id: fileId })
    if (!fileInfo.ok || !fileInfo.result?.file_path) return null

    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileInfo.result.file_path}`
    const resp = await fetch(fileUrl)
    if (!resp.ok) return null

    const arrayBuffer = await resp.arrayBuffer()
    const uint8Array = new Uint8Array(arrayBuffer)
    let binary = ''
    for (let i = 0; i < uint8Array.byteLength; i++) {
      binary += String.fromCharCode(uint8Array[i])
    }
    const base64 = btoa(binary)
    return { base64, mimeType: 'audio/ogg' }
  } catch (err) {
    console.error('Error descargando audio de Telegram:', err)
    return null
  }
}

Deno.serve(async (req) => {
  const secret = req.headers.get('x-telegram-bot-api-secret-token')
  if (WEBHOOK_SECRET && secret !== WEBHOOK_SECRET) {
    return new Response('Unauthorized', { status: 401 })
  }

  if (req.method !== 'POST') return new Response('OK')

  let update: any
  try {
    update = await req.json()
  } catch {
    return new Response('Bad JSON', { status: 400 })
  }

  // 1. MANEJO DE BOTONES (Callback Queries)
  if (update.callback_query) {
    const cb = update.callback_query
    const chatId = cb.message.chat.id
    const data = String(cb.data)

    await tg('answerCallbackQuery', { callback_query_id: cb.id })

    if (data === 'cancel') {
      await supabase.from('telegram_sessions').delete().eq('chat_id', chatId)
      await tg('editMessageText', {
        chat_id: chatId,
        message_id: cb.message.message_id,
        text: '❌ Pedido cancelado.',
      })
      return new Response('OK')
    }

    if (data.startsWith('set_type:')) {
      const type = data.split(':')[1]
      const { data: session } = await supabase
        .from('telegram_sessions')
        .select('*')
        .eq('chat_id', chatId)
        .single()

      if (!session || !session.draft_order) {
        await tg('sendMessage', { chat_id: chatId, text: 'Tu sesión expiró. Escribe o envía tu pedido nuevamente.' })
        return new Response('OK')
      }

      const draft = session.draft_order
      draft.deliveryType = type

      if (type === 'domicilio') {
        await supabase.from('telegram_sessions').update({
          step: 'awaiting_address',
          draft_order: draft,
          updated_at: new Date().toISOString(),
        }).eq('chat_id', chatId)

        await tg('editMessageText', {
          chat_id: chatId,
          message_id: cb.message.message_id,
          text: `🛵 Elegiste *A Domicilio*.\n\nPor favor escribe tu *dirección de entrega*:`,
          parse_mode: 'Markdown',
        })
        return new Response('OK')
      } else {
        draft.address = null
        await supabase.from('telegram_sessions').update({
          step: 'awaiting_confirmation',
          draft_order: draft,
          updated_at: new Date().toISOString(),
        }).eq('chat_id', chatId)

        await showFinalSummary(chatId, cb.message.message_id, draft, false)
        return new Response('OK')
      }
    }

    if (data === 'confirm') {
      const { data: session } = await supabase
        .from('telegram_sessions')
        .select('*')
        .eq('chat_id', chatId)
        .single()

      if (!session || !session.draft_order) {
        await tg('sendMessage', { chat_id: chatId, text: 'Este pedido ya expiró o fue procesado.' })
        return new Response('OK')
      }

      const { data: staff } = await supabase.rpc('get_staff_by_telegram', { p_chat_id: chatId })
      const isStaff = !!staff

      const draft = session.draft_order
      const idempotencyKey = `tg-cb-${cb.id}`

      let customerId: string | null = null
      if (!isStaff) {
        const { data: cust } = await supabase
          .from('customers')
          .select('id')
          .eq('telegram_chat_id', chatId)
          .maybeSingle()

        if (cust) {
          customerId = cust.id
          if (draft.address) {
            await supabase.from('customers').update({ address: draft.address }).eq('id', cust.id)
          }
        } else {
          const { data: newCust } = await supabase
            .from('customers')
            .insert({
              full_name: session.customer_name || 'Cliente Telegram',
              telegram_chat_id: chatId,
              telegram_username: session.username,
              address: draft.address || null,
            })
            .select('id')
            .single()
          if (newCust) customerId = newCust.id
        }
      }

      const notes = isStaff
        ? `Tomado por personal: ${staff.full_name} (@${session.username || 'staff'})`
        : `Cliente Telegram: @${session.username || 'sin_usuario'}`

      const { data: orderId, error: orderErr } = await supabase.rpc('create_order', {
        p_channel: 'telegram',
        p_delivery_type: draft.deliveryType || 'recogida',
        p_payment_method: 'efectivo',
        p_customer_id: customerId,
        p_delivery_address: draft.address || null,
        p_notes: notes,
        p_items: draft.items,
        p_idempotency_key: idempotencyKey,
        p_table_label: draft.table || null,
      })

      if (orderErr) {
        await tg('sendMessage', { chat_id: chatId, text: `⚠️ Error al crear pedido: ${orderErr.message}` })
        return new Response('OK')
      }

      const { data: ord } = await supabase
        .from('orders')
        .select('order_number, total')
        .eq('id', orderId)
        .single()

      await supabase.from('telegram_sessions').delete().eq('chat_id', chatId)

      const num = ord?.order_number ? `#${ord.order_number}` : ''
      const totalTxt = ord?.total ? ` (${money(Number(ord.total))})` : ''

      if (isStaff) {
        await tg('editMessageText', {
          chat_id: chatId,
          message_id: cb.message.message_id,
          text: `✅ *¡Pedido ${num} enviado a cocina${totalTxt}!* \n\n${draft.table ? `Mesa: *${draft.table}*` : 'Para llevar'}. Ya está en la pantalla de cocina.`,
          parse_mode: 'Markdown',
        })
      } else {
        await tg('editMessageText', {
          chat_id: chatId,
          message_id: cb.message.message_id,
          text: `🎉 *¡Pedido ${num} confirmado${totalTxt}!* \n\nTu pedido ya está en preparación en cocina. ¡Gracias por elegirnos!`,
          parse_mode: 'Markdown',
        })
      }

      return new Response('OK')
    }

    return new Response('OK')
  }

  // 2. MANEJO DE MENSAJES ENTRANTES (Texto o Audio de voz)
  const msg = update.message
  if (!msg) return new Response('OK')

  const chatId = msg.chat.id
  const fromUser = msg.from
  const customerName = [fromUser?.first_name, fromUser?.last_name].filter(Boolean).join(' ') || 'Cliente'
  const username = fromUser?.username || null

  const { data: staff } = await supabase.rpc('get_staff_by_telegram', { p_chat_id: chatId })
  const isStaff = !!staff

  // ========================================================
  // CASO A: NOTA DE VOZ (Audio)
  // ========================================================
  if (msg.voice) {
    await tg('sendChatAction', { chat_id: chatId, action: 'typing' })
    const audioData = await downloadTelegramAudio(msg.voice.file_id)

    if (!audioData) {
      await tg('sendMessage', { chat_id: chatId, text: 'No pude procesar el audio. Por favor intenta de nuevo o escríbelo en texto.' })
      return new Response('OK')
    }

    const { catalog, byId, contextStr } = await loadCatalog()
    const aiResult = await extractAudioWithGemini(audioData.base64, audioData.mimeType, contextStr)

    if (!aiResult || aiResult.items.length === 0) {
      await tg('sendMessage', {
        chat_id: chatId,
        text: 'Escuché tu audio pero no alcancé a entender los productos 🤔.\n\nPor favor intenta hablar un poco más claro o escribe tu pedido en texto.',
      })
      return new Response('OK')
    }

    await processParsedItems(chatId, customerName, username, isStaff, staff, aiResult, catalog, byId)
    return new Response('OK')
  }

  // ========================================================
  // CASO B: MENSAJE DE TEXTO
  // ========================================================
  if (!msg.text) return new Response('OK')
  const text = msg.text.trim()

  if (text.startsWith('/vincular')) {
    const parts = text.split(/\s+/)
    if (parts.length < 2) {
      await tg('sendMessage', {
        chat_id: chatId,
        text: 'Debes incluir el código de vinculación. Ejemplo:\n`/vincular REST-1234`',
        parse_mode: 'Markdown',
      })
      return new Response('OK')
    }
    const code = parts[1].trim()
    const { data: linkRes, error: linkErr } = await supabase.rpc('link_telegram_staff', {
      p_code: code,
      p_chat_id: chatId,
      p_username: username,
    })

    if (linkErr || !linkRes?.ok) {
      await tg('sendMessage', {
        chat_id: chatId,
        text: `❌ ${linkRes?.error || linkErr?.message || 'Error al vincular'}`,
      })
      return new Response('OK')
    }

    await tg('sendMessage', {
      chat_id: chatId,
      text: `🎉 *¡Cuenta vinculada con éxito!*\n\nBienvenido *${linkRes.full_name}* (Rol: *${linkRes.role}*).\n\nAhora estás en *Modo Personal*. Puedes tomar pedidos para mesas directamente en texto o con nota de voz 🎙.`,
      parse_mode: 'Markdown',
    })
    return new Response('OK')
  }

  if (text === '/desvincular' && isStaff) {
    await supabase.rpc('unlink_telegram_staff', { p_chat_id: chatId })
    await tg('sendMessage', {
      chat_id: chatId,
      text: 'Tu cuenta de Telegram ha sido desvinculada del restaurante. Ahora estás en modo cliente público.',
    })
    return new Response('OK')
  }

  // Si estábamos esperando la dirección
  const { data: session } = await supabase
    .from('telegram_sessions')
    .select('*')
    .eq('chat_id', chatId)
    .maybeSingle()

  if (session && session.step === 'awaiting_address') {
    const draft = session.draft_order
    draft.address = text

    await supabase.from('telegram_sessions').update({
      step: 'awaiting_confirmation',
      draft_order: draft,
      updated_at: new Date().toISOString(),
    }).eq('chat_id', chatId)

    await showFinalSummary(chatId, null, draft, false)
    return new Response('OK')
  }

  if (text === '/start' || text.toLowerCase() === 'hola') {
    if (isStaff) {
      await tg('sendMessage', {
        chat_id: chatId,
        text: `👨‍🍳 *Modo Personal activo* (${staff.full_name} - ${staff.role})\n\nEnvía pedidos en texto o con una **nota de voz** 🎙:\n👉 _"mesa 3, 2 especiales, 1 cocacola"_\n\nUsa /menu para ver la lista o /desvincular para salir.`,
        parse_mode: 'Markdown',
      })
    } else {
      await tg('sendMessage', {
        chat_id: chatId,
        text: `👋 ¡Hola ${customerName}! Bienvenido a nuestro restaurante.\n\nPuedes pedir en texto o enviarnos una **nota de voz** 🎙 con lo que deseas ordenar.\n\nEscribe /menu para consultar los precios oficiales.`,
        parse_mode: 'Markdown',
      })
    }
    return new Response('OK')
  }

  if (text === '/menu') {
    const { data: cats } = await supabase
      .from('categories')
      .select('name, products(name, price, is_available)')
      .eq('is_active', true)
      .order('sort_order')

    let menuTxt = '📋 *NUESTRO MENÚ*\n\n'
    for (const c of cats || []) {
      const disponibles = (c.products || []).filter((p: any) => p.is_available)
      if (disponibles.length === 0) continue
      menuTxt += `*${c.name.toUpperCase()}*\n`
      for (const p of disponibles) {
        menuTxt += ` • ${p.name} — ${money(Number(p.price))}\n`
      }
      menuTxt += '\n'
    }
    menuTxt += 'Pide por texto o nota de voz 🎙.'
    await tg('sendMessage', { chat_id: chatId, text: menuTxt, parse_mode: 'Markdown' })
    return new Response('OK')
  }

  // 1) Interpretar con reglas locales (Rápido y gratis)
  const { catalog, byId, contextStr } = await loadCatalog()
  const parsed: ParsedOrder = parseQuickOrder(text, catalog)

  const dudas = parsed.lines.length === 0 || parsed.lines.some((l) => l.status !== 'ok')

  // 2) Si las reglas tienen dudas, acudimos a Gemini como respaldo inteligente
  if (dudas) {
    await tg('sendChatAction', { chat_id: chatId, action: 'typing' })
    const aiResult = await extractWithGemini(text, contextStr)

    if (aiResult && aiResult.items.length > 0) {
      await processParsedItems(chatId, customerName, username, isStaff, staff, aiResult, catalog, byId)
      return new Response('OK')
    }
  }

  // Si las reglas funcionaron sin dudas, usamos su resultado directo
  if (parsed.lines.length > 0 && parsed.lines.every((l) => l.status === 'ok')) {
    const aiEquivalent: GeminiExtraction = {
      table: parsed.table,
      deliveryType: parsed.deliveryType,
      items: parsed.lines.map((l) => {
        const prod = byId.get(l.productId!)
        return {
          product_name: prod.name,
          quantity: l.quantity,
          excluded_ingredients: l.excluded,
          modifiers: prod.modifiers.filter((m: any) => l.modifierIds.includes(m.id)).map((m: any) => m.name),
        }
      }),
      unrecognized: [],
    }
    await processParsedItems(chatId, customerName, username, isStaff, staff, aiEquivalent, catalog, byId)
    return new Response('OK')
  }

  // Mensaje cuando no se entendió
  await tg('sendMessage', {
    chat_id: chatId,
    text: `No alcancé a entender los productos 🤔.\n\nIntenta escribir algo como:\n👉 _"2 hamburguesas clásicas y una gaseosa"_\nO envía una nota de voz 🎙. Revisa el /menu para ver la lista.`,
    parse_mode: 'Markdown',
  })
  return new Response('OK')
})

// Procesa los ítems reconocidos (vengan de Reglas o de Gemini) y arma la respuesta
async function processParsedItems(
  chatId: number,
  customerName: string,
  username: string | null,
  isStaff: boolean,
  staff: any,
  extraction: GeminiExtraction,
  catalog: CatalogProduct[],
  byId: Map<string, any>,
) {
  // Regla: Si cliente pide mesa
  if (!isStaff && extraction.table) {
    await tg('sendMessage', {
      chat_id: chatId,
      text: `🍽 *Las mesas se atienden directamente en el local.*\n\nSi deseas pedir *A Domicilio* o *Para Llevar*, envía tu pedido sin indicar mesa. ¡Gracias!`,
      parse_mode: 'Markdown',
    })
    return
  }

  const byName = new Map(catalog.map((p) => [p.name.toLowerCase().trim(), p]))

  let subtotal = 0
  const itemsPayload: any[] = []
  let detalleTxt = ''

  for (const it of extraction.items) {
    const prod = byName.get(it.product_name.toLowerCase().trim())
    if (!prod) continue

    const modifierIds: string[] = []
    let extraSum = 0
    for (const modName of it.modifiers || []) {
      const m = prod.modifiers.find((x: any) => x.name.toLowerCase().includes(modName.toLowerCase().replace('extra', '').trim()))
      if (m && !modifierIds.includes(m.id)) {
        modifierIds.push(m.id)
        extraSum += m.extra_price || 0
      }
    }

    const lineTotal = (prod.price + extraSum) * it.quantity
    subtotal += lineTotal

    itemsPayload.push({
      product_id: prod.id,
      quantity: it.quantity,
      excluded_ingredients: it.excluded_ingredients || [],
      modifier_ids: modifierIds,
    })

    detalleTxt += ` • *${it.quantity}×* ${prod.name} (${money(lineTotal)})\n`
    if (it.excluded_ingredients?.length > 0) {
      detalleTxt += `    _Sin: ${it.excluded_ingredients.join(', ')}_\n`
    }
    if (it.modifiers?.length > 0) {
      detalleTxt += `    _+ ${it.modifiers.join(', ')}_\n`
    }
  }

  if (itemsPayload.length === 0) {
    await tg('sendMessage', {
      chat_id: chatId,
      text: 'No pude encontrar los productos solicitados en el menú. Consulta el /menu para ver la lista disponible.',
    })
    return
  }

  const draft = {
    deliveryType: extraction.deliveryType,
    table: extraction.table || null,
    items: itemsPayload,
    subtotal,
    detalleTxt,
    address: null as string | null,
  }

  // Modo STAFF (Mesero)
  if (isStaff) {
    draft.deliveryType = extraction.table ? 'mesa' : (extraction.deliveryType || 'recogida')
    await supabase.from('telegram_sessions').upsert({
      chat_id: chatId,
      step: 'awaiting_confirmation',
      customer_name: staff.full_name,
      username,
      draft_order: draft,
      updated_at: new Date().toISOString(),
    })
    await showFinalSummary(chatId, null, draft, true)
    return
  }

  // Modo CLIENTE
  if (extraction.deliveryType === 'domicilio') {
    await supabase.from('telegram_sessions').upsert({
      chat_id: chatId,
      step: 'awaiting_address',
      customer_name: customerName,
      username,
      draft_order: draft,
      updated_at: new Date().toISOString(),
    })
    await tg('sendMessage', {
      chat_id: chatId,
      text: `📝 *RESUMEN PREVIO*\n\n${detalleTxt}\nSubtotal: *${money(subtotal)}*\n\n🛵 Elegiste *A Domicilio*. Por favor escribe tu *dirección de entrega* para continuar:`,
      parse_mode: 'Markdown',
    })
    return
  }

  if (extraction.deliveryType === 'recogida') {
    await supabase.from('telegram_sessions').upsert({
      chat_id: chatId,
      step: 'awaiting_confirmation',
      customer_name: customerName,
      username,
      draft_order: draft,
      updated_at: new Date().toISOString(),
    })
    await showFinalSummary(chatId, null, draft, false)
    return
  }

  // Si no especificó tipo
  await supabase.from('telegram_sessions').upsert({
    chat_id: chatId,
    step: 'idle',
    customer_name: customerName,
    username,
    draft_order: draft,
    updated_at: new Date().toISOString(),
  })

  await tg('sendMessage', {
    chat_id: chatId,
    text: `📝 *RESUMEN DE TU PEDIDO*\n\n${detalleTxt}\n💰 *Total:* *${money(subtotal)}*\n\n¿Cómo deseas recibir tu pedido?`,
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🛵 Domicilio', callback_data: 'set_type:domicilio' },
          { text: '🛍 Para llevar (Recogida)', callback_data: 'set_type:recogida' },
        ],
        [{ text: '❌ Cancelar', callback_data: 'cancel' }],
      ],
    },
  })
}

async function showFinalSummary(
  chatId: number,
  editMessageId: number | null,
  draft: any,
  isStaff: boolean,
) {
  const tipoTxt = isStaff && draft.table
    ? `🍽 *Mesa:* ${draft.table}`
    : draft.deliveryType === 'domicilio'
      ? `🛵 *A Domicilio* a: _${draft.address || 'Por confirmar'}_`
      : `🛍 *Para llevar (Recogida en local)*`

  const cabecera = isStaff ? '👨‍🍳 *PEDIDO DE PERSONAL (MESERO)*' : '📝 *CONFIRMACIÓN DE PEDIDO*'
  const botonConfirmar = isStaff ? '✅ Enviar a Cocina' : '✅ Confirmar pedido'

  const texto = `${cabecera}\n\n${tipoTxt}\n\n${draft.detalleTxt}\n💰 *TOTAL:* *${money(draft.subtotal)}*\n_Pago en efectivo al recibir_\n\n¿Confirmar para enviar a preparación?`

  const payload: any = {
    chat_id: chatId,
    text: texto,
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          { text: botonConfirmar, callback_data: 'confirm' },
          { text: '❌ Cancelar', callback_data: 'cancel' },
        ],
      ],
    },
  }

  if (editMessageId) {
    payload.message_id = editMessageId
    await tg('editMessageText', payload)
  } else {
    await tg('sendMessage', payload)
  }
}
