// Supabase Edge Function: scan-menu
// Analiza fotos de cartas/menús de restaurantes con Gemini 2.5 Flash
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1'

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? ''
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`

const SYSTEM_PROMPT = `Eres un asistente experto en digitalización de cartas y menús de restaurantes.
Tu tarea es leer cuidadosamente la imagen del menú físico o digital y extraer de manera estructurada todas las categorías y productos.

REGLAS:
1. Extrae el nombre de la categoría (ej: "Hamburguesas", "Bebidas", "Perros calientes", etc.).
2. Para cada producto extrae:
   - name: Nombre exacto del producto.
   - description: Ingredientes o descripción visibles.
   - price: Precio numérico limpio (ej: "$15.000" -> 15000). Si no tiene precio o es ilegible pon 0.
   - ingredients: Lista de ingredientes que componen el plato.
   - modifiers: Lista de adicionales con su precio extra si están en la carta.
   - aliases: Array de 2 a 4 variantes en minúscula de cómo lo pediría un comensal (ej: ["especial", "hamburguesa especial"]).
3. Responde ÚNICAMENTE con un JSON válido con esta estructura:
{
  "categories": [
    {
      "name": "Nombre Categoría",
      "products": [
        {
          "name": "Nombre Producto",
          "description": "Descripción corta",
          "price": 12000,
          "ingredients": ["Ingrediente 1", "Ingrediente 2"],
          "modifiers": [
            { "name": "Adicional", "extra_price": 2000 }
          ],
          "aliases": ["alias 1", "alias 2"]
        }
      ]
    }
  ]
}`

Deno.serve(async (req) => {
  // CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    })
  }

  try {
    const { imageBase64, mimeType } = await req.json()
    if (!imageBase64) {
      return new Response(JSON.stringify({ error: 'Falta la imagen' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })
    }

    if (!GEMINI_API_KEY) {
      return new Response(JSON.stringify({ error: 'Falta configurar GEMINI_API_KEY en Supabase' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })
    }

    const res = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: `${SYSTEM_PROMPT}\n\nAnaliza la imagen adjunta de la carta y extrae los productos y categorías:` },
              {
                inlineData: {
                  mimeType: mimeType || 'image/jpeg',
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
      const errText = await res.text()
      console.error('Gemini Vision Error:', errText)
      return new Response(JSON.stringify({ error: `Error de Gemini: ${errText}` }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })
    }

    const data = await res.json()
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text
    if (!raw) {
      return new Response(JSON.stringify({ error: 'No se obtuvo respuesta de la IA' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })
    }

    const parsed = JSON.parse(raw)
    return new Response(JSON.stringify({ ok: true, data: parsed }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Error desconocido' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }
})
