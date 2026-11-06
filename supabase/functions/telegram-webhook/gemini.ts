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
): Promise<GeminiExtraction | null> {
  if (!GEMINI_API_KEY) return null

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

    if (!res.ok) {
      console.error('Error Gemini API:', await res.text())
      return null
    }

    const data = await res.json()
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text
    if (!raw) return null

    return JSON.parse(raw) as GeminiExtraction
  } catch (err) {
    console.error('Fallo en extractWithGemini:', err)
    return null
  }
}

/**
 * Transcribe y extrae el pedido de una nota de voz (audio OGG/Opus de Telegram).
 */
export async function extractAudioWithGemini(
  audioBase64: string,
  mimeType: string,
  catalogContext: string,
): Promise<GeminiExtraction | null> {
  if (!GEMINI_API_KEY) return null

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

    if (!res.ok) {
      console.error('Error Gemini Audio:', await res.text())
      return null
    }

    const data = await res.json()
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text
    if (!raw) return null

    return JSON.parse(raw) as GeminiExtraction
  } catch (err) {
    console.error('Fallo en extractAudioWithGemini:', err)
    return null
  }
}
