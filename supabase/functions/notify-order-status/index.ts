// Edge Function: notify-order-status
// Notifica al cliente por Telegram cuando su pedido sale de cocina o va en camino
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`

async function sendTelegram(chatId: number, text: string) {
  if (!BOT_TOKEN || !chatId) return
  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
    }),
  })
}

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization')
  const apiKey = req.headers.get('apikey')
  if (!authHeader && !apiKey) return new Response('Unauthorized', { status: 401 })

  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  let body: any
  try {
    body = await req.json()
  } catch {
    return new Response('Bad JSON', { status: 400 })
  }

  const { order_id, new_status, delivery_type } = body
  if (!order_id) {
    return new Response('Missing order_id', { status: 400 })
  }

  // Consultar pedido y cliente asociado
  const { data: ord, error } = await supabase
    .from('orders')
    .select('order_number, status, delivery_type, delivery_address, total, table_label, customer_notified_at, customer:customers(telegram_chat_id, full_name)')
    .eq('id', order_id)
    .single()

  if (error || !ord) {
    return new Response('Order not found', { status: 404 })
  }

  const chat = (ord as any).customer?.telegram_chat_id
  if (!chat) {
    return new Response(JSON.stringify({ ok: true, notified: false, reason: 'No telegram chat' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Prevención de duplicados: Si ya se notificó en los últimos 20 segundos, omitir
  if ((ord as any).customer_notified_at) {
    const elapsed = Date.now() - new Date((ord as any).customer_notified_at).getTime()
    if (elapsed < 20_000) {
      return new Response(JSON.stringify({ ok: true, notified: false, reason: 'Already notified recently' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }
  }

  const num = `#${ord.order_number}`
  const effectiveStatus = new_status || ord.status
  const effectiveType = delivery_type || ord.delivery_type

  // Mensaje detallado según el tipo de entrega y el estado
  let mensaje = ''
  if (effectiveType === 'domicilio' && (effectiveStatus === 'recogido' || effectiveStatus === 'entregado')) {
    const dirTxt = ord.delivery_address
      ? `\n📍 *A esta dirección se llevará tu pedido:*\n_${ord.delivery_address}_\n`
      : ''
    mensaje = `🛵 *¡Tu pedido ${num} ya salió del restaurante y va en camino!*${dirTxt}\nEl domiciliario se dirige hacia allá. Por favor ten listo el pago en efectivo.\n\n¡Muchas gracias por tu compra!`
  } else if (effectiveType === 'recogida' && (effectiveStatus === 'listo' || effectiveStatus === 'entregado')) {
    mensaje = `🛍 *¡Tu pedido ${num} ya está listo en el local para que pases a recogerlo!*\n\n¡Te esperamos en el mostrador!`
  } else if (effectiveType === 'mesa' && (effectiveStatus === 'listo' || effectiveStatus === 'entregado')) {
    const mesaTxt = ord.table_label ? ` a la Mesa ${ord.table_label}` : ''
    mensaje = `🍽 *¡Tu pedido ${num} ya está listo y va hacia tu mesa${mesaTxt}!*\n\n¡Buen provecho!`
  } else {
    // Si la orden pasa a un estado que no requiere notificación al cliente
    return new Response(JSON.stringify({ ok: true, notified: false, reason: 'Status does not require notification' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  await sendTelegram(chat, mensaje)

  // Registrar fecha de notificación
  await supabase
    .from('orders')
    .update({ customer_notified_at: new Date().toISOString() })
    .eq('id', order_id)

  return new Response(JSON.stringify({ ok: true, notified: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
