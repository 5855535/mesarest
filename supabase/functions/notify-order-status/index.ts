// Edge Function: notify-order-status
// Notifica al cliente por Telegram cuando su pedido sale de cocina
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
  if (!authHeader) return new Response('Unauthorized', { status: 401 })

  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  let body: any
  try {
    body = await req.json()
  } catch {
    return new Response('Bad JSON', { status: 400 })
  }

  const { order_id } = body
  if (!order_id) {
    return new Response('Missing order_id', { status: 400 })
  }

  // Consultar pedido y cliente asociado
  const { data: ord, error } = await supabase
    .from('orders')
    .select('order_number, delivery_type, delivery_address, total, customer:customers(telegram_chat_id, full_name)')
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

  const num = `#${ord.order_number}`

  // Mensaje exacto de que va en camino o listo para recoger
  let mensaje = ''
  if (ord.delivery_type === 'domicilio') {
    mensaje = `🛵 *¡Tu pedido ${num} ya salió del restaurante y va en camino a tu dirección!*\n\nPor favor ten listo el pago en efectivo. ¡Muchas gracias por tu compra!`
  } else if (ord.delivery_type === 'recogida') {
    mensaje = `🛍 *¡Tu pedido ${num} ya está listo en el local para que pases a recogerlo!*\n\n¡Te esperamos!`
  } else {
    mensaje = `🍽 *¡Tu pedido ${num} ya va hacia tu mesa!*\n\n¡Buen provecho!`
  }

  await sendTelegram(chat, mensaje)

  return new Response(JSON.stringify({ ok: true, notified: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
