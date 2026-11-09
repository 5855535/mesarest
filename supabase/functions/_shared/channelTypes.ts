// =====================================================================
// RESTAURANT OS — Contrato unificado de Adaptadores Multicanal
// Desacopla la lógica de negocio de los proveedores de mensajería (Telegram, WhatsApp, Web)
// =====================================================================

export type ChannelType = 'telegram' | 'whatsapp' | 'web'

export type MessageKind = 'text' | 'audio' | 'location' | 'action'

export interface NormalizedButton {
  id: string
  label: string
}

export interface NormalizedIncoming {
  channel: ChannelType
  senderId: string // chat_id (Telegram), teléfono E.164 (WhatsApp) o sessionId (Web)
  senderName: string
  username?: string
  kind: MessageKind
  text?: string
  audioBytes?: Uint8Array
  mimeType?: string
  location?: {
    latitude: number
    longitude: number
  }
  action?: {
    id: string
    payload?: string
    messageId?: number | string
  }
  raw?: unknown
}

export interface NormalizedOutgoing {
  recipientId: string
  text: string
  buttons?: NormalizedButton[][]
  images?: string[]
  editMessageId?: number | string
}

export interface ChannelAdapter {
  readonly channel: ChannelType
  parseIncoming(body: any): Promise<NormalizedIncoming | null>
  sendOutgoing(msg: NormalizedOutgoing): Promise<boolean>
}
