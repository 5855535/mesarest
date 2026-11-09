// =====================================================================
// RESTAURANT OS — Adaptador Oficial de WhatsApp Business Cloud API (Meta)
// 100% Oficial, Serverless y sin riesgo de baneo de cuentas.
// =====================================================================

import type {
  ChannelAdapter,
  ChannelType,
  NormalizedIncoming,
  NormalizedOutgoing,
} from './channelTypes.ts'

export class WhatsAppCloudAdapter implements ChannelAdapter {
  readonly channel: ChannelType = 'whatsapp'
  private token: string
  private phoneNumberId: string
  private graphUrl = 'https://graph.facebook.com/v21.0'

  constructor(token: string, phoneNumberId: string) {
    this.token = token
    this.phoneNumberId = phoneNumberId
  }

  /**
   * Responde al desafío GET de verificación de Meta al registrar el Webhook.
   */
  static verifyWebhook(searchParams: URLSearchParams, expectedToken: string): Response | null {
    const mode = searchParams.get('hub.mode')
    const token = searchParams.get('hub.verify_token')
    const challenge = searchParams.get('hub.challenge')

    if (mode === 'subscribe' && token === expectedToken && challenge) {
      return new Response(challenge, { status: 200 })
    }
    return null
  }

  async parseIncoming(body: any): Promise<NormalizedIncoming | null> {
    const entry = body?.entry?.[0]
    const changes = entry?.changes?.[0]?.value
    const message = changes?.messages?.[0]
    const contact = changes?.contacts?.[0]

    if (!message) return null

    const senderId = String(message.from || '')
    const senderName = contact?.profile?.name || 'Cliente WhatsApp'

    // 1. Botón Interactivo presionado
    if (message.type === 'interactive' && message.interactive?.button_reply) {
      return {
        channel: 'whatsapp',
        senderId,
        senderName,
        kind: 'action',
        action: {
          id: message.interactive.button_reply.id,
          payload: message.interactive.button_reply.title,
        },
        raw: body,
      }
    }

    // 2. Ubicación GPS
    if (message.type === 'location' && message.location) {
      return {
        channel: 'whatsapp',
        senderId,
        senderName,
        kind: 'location',
        location: {
          latitude: message.location.latitude,
          longitude: message.location.longitude,
        },
        raw: body,
      }
    }

    // 3. Nota de voz / Audio
    if (message.type === 'audio' && message.audio?.id) {
      const audioBytes = await this.downloadMedia(message.audio.id)
      return {
        channel: 'whatsapp',
        senderId,
        senderName,
        kind: 'audio',
        audioBytes: audioBytes ?? undefined,
        mimeType: message.audio.mime_type || 'audio/ogg',
        raw: body,
      }
    }

    // 4. Texto
    if (message.type === 'text' && message.text?.body) {
      return {
        channel: 'whatsapp',
        senderId,
        senderName,
        kind: 'text',
        text: message.text.body.trim(),
        raw: body,
      }
    }

    return null
  }

  async sendOutgoing(msg: NormalizedOutgoing): Promise<boolean> {
    try {
      const url = `${this.graphUrl}/${this.phoneNumberId}/messages`
      let payload: Record<string, unknown>

      // Aplanar botones (Meta Cloud API admite hasta 3 botones por mensaje interactivo)
      const flatButtons = (msg.buttons || []).flat().slice(0, 3)

      if (flatButtons.length > 0) {
        payload = {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: msg.recipientId,
          type: 'interactive',
          interactive: {
            type: 'button',
            body: { text: msg.text },
            action: {
              buttons: flatButtons.map((btn) => ({
                type: 'reply',
                reply: {
                  id: btn.id,
                  title: btn.label.slice(0, 20), // Máximo 20 caracteres por botón en Meta
                },
              })),
            },
          },
        }
      } else {
        payload = {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: msg.recipientId,
          type: 'text',
          text: {
            preview_url: false,
            body: msg.text,
          },
        }
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const errText = await res.text()
        console.error('[WHATSAPP_SEND_ERROR]:', errText)
        return false
      }

      return true
    } catch (err) {
      console.error('[WHATSAPP_ADAPTER_EXCEPTION]:', err)
      return false
    }
  }

  /**
   * Descarga el archivo multimedia usando el ID de medio de Meta Graph API
   */
  async downloadMedia(mediaId: string): Promise<Uint8Array | null> {
    try {
      // 1. Obtener la URL temporal del archivo
      const metaRes = await fetch(`${this.graphUrl}/${mediaId}`, {
        headers: { Authorization: `Bearer ${this.token}` },
      })
      if (!metaRes.ok) return null
      const metaData = await metaRes.json()
      const mediaUrl = metaData.url
      if (!mediaUrl) return null

      // 2. Descargar los bytes reales
      const fileRes = await fetch(mediaUrl, {
        headers: { Authorization: `Bearer ${this.token}` },
      })
      if (!fileRes.ok) return null
      const buffer = await fileRes.arrayBuffer()
      return new Uint8Array(buffer)
    } catch (err) {
      console.error('[WHATSAPP_DOWNLOAD_MEDIA_ERROR]:', err)
      return null
    }
  }
}
