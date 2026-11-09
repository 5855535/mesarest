// Integración con Google Gemini API (Deno)
// Modelo: gemini-2.5-flash (rápido, multimodal: audio + texto, cuota gratuita)

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? ''
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`

export interface GeminiExtraction {
  table: string | null
  deliveryType: 'mesa' | 'recogida' | 'domicilio' | null
  items: {
    product_name: string
    quantity: number
    excluded_ingredients: string[]
    modifiers: string[]
  }[]
  unrecognized: string[]
}

const SYSTEM_PROMPT = `Eres el asistente de toma de pedidos de un restaurante.
Tu ÚNICA tarea es interpretar lo que pide el usuario (sea texto o audio) y relacionarlo con el CATÁLOGO OFICIAL que te proporciono.

REGLAS ESTRICTAS:
1. NUNCA inventes productos ni precios. Si piden algo que no está en el catálogo, agrégalo a "unrecognized".
2. Identifica cantidades numéricas (ej: "dos" -> 2). Por defecto es 1.
3. Extrae ingredientes excluidos (ej: "sin cebolla") y adicionales pedidos.
4. Identifica si mencionan una mesa (ej: "mesa 4") o si es domicilio/para llevar.
5. Responde ÚNICAMENTE con un objeto JSON válido, sin texto adicional, sin bloques de código markdown, con esta estructura exacta:
{
  "table": "string o null",
  "deliveryType": "mesa" | "recogida" | "domicilio" | null,
  "items": [
    {
      "product_name": "nombre EXACTO del catálogo",
      "quantity": 1,
      "excluded_ingredients": ["nombre"],
      "modifiers": ["nombre"]
    }
  ],
  "unrecognized": ["cosas que pidió pero no existen en el catálogo"]
}`

/**
 * Consulta a Gemini con texto libre cuando las reglas tienen dudas.
 */
export async function extractWithGemini(
  userText: string,
  catalogContext: string,
  onUsage?: (metrics: AudioInferenceMetrics) => void,
): Promise<GeminiExtraction | null> {
  const tStart = performance.now()
  if (!GEMINI_API_KEY) {
    onUsage?.({ inferenceMs: 0, promptTokens: 0, candidatesTokens: 0, success: false, error: 'GEMINI_API_KEY no configurada' })
    return null
  }

  try {
    const prompt = `CATÁLOGO OFICIAL DISPONIBLE:\n${catalogContext}\n\nMENSAJE DEL CLIENTE:\n"${userText}"`

    const res = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          { role: 'user', parts: [{ text: `${SYSTEM_PROMPT}\n\n${prompt}` }] }
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
        },
      }),
    })

    const inferenceMs = Math.round(performance.now() - tStart)

    if (!res.ok) {
      const errText = await res.text()
      console.error('Error Gemini API:', errText)
      onUsage?.({ inferenceMs, promptTokens: 0, candidatesTokens: 0, success: false, error: `HTTP ${res.status}: ${errText.slice(0, 100)}` })
      return null
    }

    const data = await res.json()
    const promptTokens = data.usageMetadata?.promptTokenCount ?? 0
    const candidatesTokens = data.usageMetadata?.candidatesTokenCount ?? 0

    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text
    if (!raw) {
      onUsage?.({ inferenceMs, promptTokens, candidatesTokens, success: false, error: 'Respuesta vacía' })
      return null
    }

    const extraction = JSON.parse(raw) as GeminiExtraction
    onUsage?.({ inferenceMs, promptTokens, candidatesTokens, success: true })
    return extraction
  } catch (err: any) {
    const inferenceMs = Math.round(performance.now() - tStart)
    console.error('Fallo en extractWithGemini:', err)
    onUsage?.({ inferenceMs, promptTokens: 0, candidatesTokens: 0, success: false, error: err?.message || 'Excepción' })
    return null
  }
}

export interface AudioInferenceMetrics {
  inferenceMs: number
  promptTokens: number
  candidatesTokens: number
  success: boolean
  error?: string
}

export interface AudioExtractionResult {
  extraction: GeminiExtraction | null
  metrics: AudioInferenceMetrics
}

/**
 * Transcribe y extrae el pedido de una nota de voz (audio OGG/Opus de Telegram),
 * midiendo latencia exacta, tokens consumidos y diagnóstico de respuesta.
 */
export async function extractAudioWithGemini(
  audioBase64: string,
  mimeType: string,
  catalogContext: string,
): Promise<AudioExtractionResult> {
  const tStart = performance.now()
  const baseMetrics: AudioInferenceMetrics = {
    inferenceMs: 0,
    promptTokens: 0,
    candidatesTokens: 0,
    success: false,
  }

  if (!GEMINI_API_KEY) {
    baseMetrics.error = 'GEMINI_API_KEY no configurada'
    return { extraction: null, metrics: baseMetrics }
  }

  try {
    const prompt = `CATÁLOGO OFICIAL DISPONIBLE:\n${catalogContext}\n\nEscucha este audio de un cliente de restaurante y extrae su pedido siguiendo las reglas.`

    const res = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: `${SYSTEM_PROMPT}\n\n${prompt}` },
              {
                inlineData: {
                  mimeType: mimeType || 'audio/ogg',
                  data: audioBase64,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
        },
      }),
    })

    const inferenceMs = Math.round(performance.now() - tStart)
    baseMetrics.inferenceMs = inferenceMs

    if (!res.ok) {
      const errText = await res.text()
      console.error(`[GEMINI_AUDIO_ERROR] Status ${res.status}:`, errText)
      baseMetrics.error = `HTTP ${res.status}: ${errText.slice(0, 200)}`
      return { extraction: null, metrics: baseMetrics }
    }

    const data = await res.json()
    baseMetrics.promptTokens = data.usageMetadata?.promptTokenCount ?? 0
    baseMetrics.candidatesTokens = data.usageMetadata?.candidatesTokenCount ?? 0

    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text
    if (!raw) {
      baseMetrics.error = 'Respuesta vacía de Gemini'
      return { extraction: null, metrics: baseMetrics }
    }

    const extraction = JSON.parse(raw) as GeminiExtraction
    baseMetrics.success = true
    return { extraction, metrics: baseMetrics }
  } catch (err: any) {
    baseMetrics.inferenceMs = Math.round(performance.now() - tStart)
    baseMetrics.error = err?.message || 'Error desconocido'
    console.error('[GEMINI_AUDIO_EXCEPTION]:', err)
    return { extraction: null, metrics: baseMetrics }
  }
}

export interface ReceiptExtraction {
  amount: number
  reference: string
  bank: string
  date?: string
  isValidReceipt: boolean
}

const RECEIPT_SYSTEM_PROMPT = `Eres un auditor experto en validación y lectura de comprobantes bancarios y transferencias en Colombia (Nequi, Daviplata, Bancolombia, Bre-B, Llaves, etc.).
Tu tarea es analizar la imagen del comprobante y extraer con máxima precisión:
1. amount: Valor numérico total transferido (ej: "$35.000" -> 35000). Si no se lee claramente pon 0.
2. reference: Número de comprobante, referencia, MUP o número de aprobación (ej: "M1234567"). Si no se lee pon "".
3. bank: Entidad de origen o destino (ej: "Nequi", "Bancolombia", "Daviplata", "Bre-B").
4. date: Fecha u hora visible.
5. isValidReceipt: boolean. true si la imagen muestra una transferencia o pago exitoso real. false si es un error, fallo, o imagen no relacionada.

Responde ÚNICAMENTE un objeto JSON válido con esta estructura:
{
  "amount": 35000,
  "reference": "M1234567",
  "bank": "Nequi",
  "date": "09/11/2026",
  "isValidReceipt": true
}`

export async function validateReceiptWithGemini(
  imageBase64: string,
  mimeType: string = 'image/jpeg',
): Promise<ReceiptExtraction | null> {
  if (!GEMINI_API_KEY) return null

  try {
    const res = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: `${RECEIPT_SYSTEM_PROMPT}\n\nAnaliza la imagen de este comprobante y extrae los datos:` },
              {
                inlineData: {
                  mimeType,
                  data: imageBase64,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
        },
      }),
    })

    if (!res.ok) {
      console.error('[GEMINI_RECEIPT_ERROR]:', await res.text())
      return null
    }

    const data = await res.json()
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text
    if (!raw) return null

    return JSON.parse(raw) as ReceiptExtraction
  } catch (err) {
    console.error('[GEMINI_RECEIPT_EXCEPTION]:', err)
    return null
  }
}
