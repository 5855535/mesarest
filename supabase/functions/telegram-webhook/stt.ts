// Integración con Groq Cloud — Whisper Speech-to-Text (Deno)
// Modelo: whisper-large-v3-turbo (Rápido, alta precisión en español, capa gratuita generosa)

const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY') ?? ''
const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions'

export interface WhisperTranscriptionResult {
  text: string
  transcriptionMs: number
  success: boolean
  error?: string
}

/**
 * Transcribe un audio binario a texto en español utilizando Groq Whisper.
 */
export async function transcribeWithGroq(
  audioBytes: Uint8Array,
  mimeType: string = 'audio/ogg',
  fileName: string = 'voice.ogg',
): Promise<WhisperTranscriptionResult> {
  const tStart = performance.now()

  if (!GROQ_API_KEY) {
    return {
      text: '',
      transcriptionMs: 0,
      success: false,
      error: 'GROQ_API_KEY no configurada',
    }
  }

  try {
    const formData = new FormData()
    const blob = new Blob([audioBytes], { type: mimeType })
    formData.append('file', blob, fileName)
    formData.append('model', 'whisper-large-v3-turbo')
    formData.append('language', 'es')
    formData.append('response_format', 'json')
    formData.append('temperature', '0')

    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: formData,
    })

    const transcriptionMs = Math.round(performance.now() - tStart)

    if (!res.ok) {
      const errText = await res.text()
      console.error(`[GROQ_WHISPER_ERROR] Status ${res.status}:`, errText)
      return {
        text: '',
        transcriptionMs,
        success: false,
        error: `HTTP ${res.status}: ${errText.slice(0, 200)}`,
      }
    }

    const data = await res.json()
    const text = data?.text?.trim() ?? ''

    return {
      text,
      transcriptionMs,
      success: text.length > 0,
    }
  } catch (err: any) {
    const transcriptionMs = Math.round(performance.now() - tStart)
    console.error('[GROQ_WHISPER_EXCEPTION]:', err)
    return {
      text: '',
      transcriptionMs,
      success: false,
      error: err?.message || 'Error desconocido en transcripción',
    }
  }
}
