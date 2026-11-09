// =====================================================================
// RESTAURANT OS — Módulo Text-to-Speech (ElevenLabs con fallback gratuito)
// Permite voces naturales en español con cuota mensual gratuita
// =====================================================================

const ELEVENLABS_DEFAULT_VOICE_ID = 'pNInz6obpgDQGcFmaJgB' // Adam / Voz estándar

export async function generateElevenLabsSpeech(
  text: string,
  apiKey?: string | null,
  voiceId?: string | null,
): Promise<{ audioBytes: Uint8Array; mimeType: string } | null> {
  const key = apiKey || Deno.env.get('ELEVENLABS_API_KEY')
  const voice = voiceId || Deno.env.get('ELEVENLABS_VOICE_ID') || ELEVENLABS_DEFAULT_VOICE_ID

  if (!key) {
    return generateFreeTtsSpeech(text)
  }

  try {
    const cleanText = text.replace(/[*_`#]/g, '').slice(0, 200)
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voice}`

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: cleanText,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      }),
    })

    if (!res.ok) {
      console.warn('[ELEVENLABS_TTS_WARN] Status:', res.status, await res.text())
      return generateFreeTtsSpeech(text)
    }

    const buffer = await res.arrayBuffer()
    return {
      audioBytes: new Uint8Array(buffer),
      mimeType: 'audio/mpeg',
    }
  } catch (err) {
    console.error('[ELEVENLABS_TTS_ERROR]:', err)
    return generateFreeTtsSpeech(text)
  }
}

async function generateFreeTtsSpeech(text: string): Promise<{ audioBytes: Uint8Array; mimeType: string } | null> {
  try {
    const cleanText = text.replace(/[*_`#]/g, '').slice(0, 180)
    const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(cleanText)}&tl=es&client=tw-ob`
    const res = await fetch(ttsUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      },
    })
    if (res.ok) {
      const buffer = await res.arrayBuffer()
      return {
        audioBytes: new Uint8Array(buffer),
        mimeType: 'audio/mpeg',
      }
    }
  } catch (e) {
    console.error('[FREE_TTS_ERROR]:', e)
  }
  return null
}

export async function sendTelegramVoice(
  botToken: string,
  chatId: number,
  audio: { audioBytes: Uint8Array; mimeType: string },
): Promise<boolean> {
  try {
    const blob = new Blob([audio.audioBytes], { type: audio.mimeType })
    const form = new FormData()
    form.append('chat_id', String(chatId))
    form.append('voice', blob, 'respuesta.mp3')

    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendVoice`, {
      method: 'POST',
      body: form,
    })
    return res.ok
  } catch (err) {
    console.error('[SEND_TELEGRAM_VOICE_ERROR]:', err)
    return false
  }
}
