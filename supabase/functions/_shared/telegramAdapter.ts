// =====================================================================
// RESTAURANT OS — Adaptador Oficial de Telegram Bot API
// =====================================================================

import type {
  ChannelAdapter,
  ChannelType,
  NormalizedIncoming,
  NormalizedOutgoing,
} from './channelTypes.ts'

export class TelegramAdapter implements ChannelAdapter {
  readonly channel: ChannelType = 'telegram'
  private token: string
  private apiUrl: string

  constructor(token: string) {
    this.token = token
    this.apiUrl = `https://api.telegram.org/bot${token}`
  }

  async parseIncoming(update: any): Promise<NormalizedIncoming | null> {
    if (!update) return null

    // 1. Manejo de Botones (Callback Query)
    if (update.callback_query) {
      const cb = update.callback_query
      const chatId = String(cb.message?.chat?.id || '')
      const from = cb.from || {}
      const senderName = [from.first_name, from.last_name].filter(Boolean).join(' ') || 'Usuario'

      // Responder callback query a Telegram para quitar el spinner del botón
      await this.post('answerCallbackQuery', { callback_query_id: cb.id }).catch(() => {})

      return {
        channel: 'telegram',
        senderId: chatId,
        senderName,
        username: from.username || undefined,
        kind: 'action',
        action: {
          id: String(cb.data),
          messageId: cb.message?.message_id,
        },
        raw: update,
      }
    }

    // 2. Manejo de Mensajes Estándar
    const msg = update.message
    if (!msg) return null

    const chatId = String(msg.chat.id)
    const from = msg.from || {}
    const senderName = [from.first_name, from.last_name].filter(Boolean).join(' ') || 'Usuario'
    const username = from.username || undefined

    // A. Ubicación GPS
    if (msg.location) {
      return {
        channel: 'telegram',
        senderId: chatId,
        senderName,
        username,
        kind: 'location',
        location: {
          latitude: msg.location.latitude,
          longitude: msg.location.longitude,
        },
        raw: update,
      }
    }

    // B. Nota de Voz
    if (msg.voice) {
      const audioBytes = await this.downloadFile(msg.voice.file_id)
      return {
        channel: 'telegram',
        senderId: chatId,
        senderName,
        username,
        kind: 'audio',
        audioBytes: audioBytes ?? undefined,
        mimeType: 'audio/ogg',
        raw: update,
      }
    }

    // C. Texto
    if (msg.text) {
      return {
        channel: 'telegram',
        senderId: chatId,
        senderName,
        username,
        kind: 'text',
        text: msg.text.trim(),
        raw: update,
      }
    }

    return null
  }

  async sendOutgoing(msg: NormalizedOutgoing): Promise<boolean> {
    try {
      const payload: Record<string, unknown> = {
        chat_id: msg.recipientId,
        text: msg.text,
        parse_mode: 'Markdown',
      }

      if (msg.buttons && msg.buttons.length > 0) {
        payload.reply_markup = {
          inline_keyboard: msg.buttons.map((row) =>
            row.map((btn) => ({
              text: btn.label,
              callback_data: btn.id,
            })),
          ),
        }
      }

      if (msg.editMessageId) {
        payload.message_id = msg.editMessageId
        await this.post('editMessageText', payload)
      } else {
        await this.post('sendMessage', payload)
      }

      return true
    } catch (err) {
      console.error('[TELEGRAM_ADAPTER_SEND_ERROR]:', err)
      return false
    }
  }

  async downloadFile(fileId: string): Promise<Uint8Array | null> {
    try {
      const fileInfo = await this.post('getFile', { file_id: fileId })
      if (!fileInfo.ok || !fileInfo.result?.file_path) return null

      const fileUrl = `https://api.telegram.org/file/bot${this.token}/${fileInfo.result.file_path}`
      const resp = await fetch(fileUrl)
      if (!resp.ok) return null

      const arrayBuffer = await resp.arrayBuffer()
      return new Uint8Array(arrayBuffer)
    } catch (err) {
      console.error('[TELEGRAM_FILE_DOWNLOAD_ERROR]:', err)
      return null
    }
  }

  private async post(method: string, body: Record<string, unknown>): Promise<any> {
    const res = await fetch(`${this.apiUrl}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return await res.json()
  }
}
