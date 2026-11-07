import { useCallback, useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import {
  Copy,
  Check,
  MessageCircle,
  Download,
  Save,
  Send,
  Bot,
  Mic,
  RotateCcw,
  Image as ImageIcon,
  Trash2,
  Loader2,
  Plus,
} from 'lucide-react'
import { Skeleton } from '../components/Skeleton'
import { supabase } from '../lib/supabase'

interface BusinessSettings {
  name: string
  phone: string | null
  address: string | null
  currency: string
  delivery_fee: number
  voice_replies_enabled: boolean
  memory_reorder_enabled: boolean
  menu_images: string[]
}

interface ProfileInfo {
  id: string
  full_name: string | null
  role: string
  telegram_chat_id: number | null
  telegram_username: string | null
}

const BOT_USERNAME = 'Monsterburgeeeeer_bot'
const BOT_URL = `https://t.me/${BOT_USERNAME}`

export default function Settings() {
  const [settings, setSettings] = useState<BusinessSettings | null>(null)
  const [myProfile, setMyProfile] = useState<ProfileInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [linkCode, setLinkCode] = useState<string | null>(null)
  const [codeBusy, setCodeBusy] = useState(false)

  const [qrDataUrl, setQrDataUrl] = useState<string>('')
  const [copied, setCopied] = useState(false)
  const [compressing, setCompressing] = useState(false)

  const menuInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    const [s, u] = await Promise.all([
      supabase.from('business_settings').select('*').single(),
      supabase.auth.getUser(),
    ])

    if (s.data) {
      let images: string[] = []
      if (Array.isArray(s.data.menu_images)) {
        images = s.data.menu_images.slice(0, 3)
      } else if (s.data.menu_image_url) {
        images = [s.data.menu_image_url]
      }

      setSettings({
        name: s.data.name,
        phone: s.data.phone,
        address: s.data.address,
        currency: s.data.currency,
        delivery_fee: Number(s.data.delivery_fee),
        voice_replies_enabled: s.data.voice_replies_enabled ?? true,
        memory_reorder_enabled: s.data.memory_reorder_enabled ?? true,
        menu_images: images,
      })
    }

    if (u.data.user) {
      const { data: p } = await supabase
        .from('profiles')
        .select('id, full_name, role, telegram_chat_id, telegram_username')
        .eq('id', u.data.user.id)
        .single()
      if (p) setMyProfile(p as ProfileInfo)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    QRCode.toDataURL(BOT_URL, {
      width: 400,
      margin: 2,
      color: {
        dark: '#09090b',
        light: '#ffffff',
      },
    }).then(setQrDataUrl)
  }, [load])

  const copyBotLink = async () => {
    try {
      await navigator.clipboard.writeText(BOT_URL)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      /* fallback */
    }
  }

  const downloadQr = () => {
    if (!qrDataUrl) return
    const a = document.createElement('a')
    a.href = qrDataUrl
    a.download = `QR-pedidos-${BOT_USERNAME}.png`
    a.click()
  }

  const shareWhatsapp = () => {
    const restName = settings?.name || 'nuestro restaurante'
    const msg = encodeURIComponent(
      `¡Hola! Ya puedes hacer tus pedidos en ${restName} directo desde tu celular por Telegram aquí:\n${BOT_URL}`,
    )
    window.open(`https://wa.me/?text=${msg}`, '_blank')
  }

  // Manejo de carga y compresión de hasta 3 fotos del menú
  const handleMenuImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0 || !settings) return

    if (settings.menu_images.length >= 3) {
      setError('Ya has alcanzado el límite de 3 imágenes para el menú.')
      return
    }

    setCompressing(true)
    setError(null)

    const remainingSlots = 3 - settings.menu_images.length
    const filesToProcess = Array.from(files).slice(0, remainingSlots)

    let processedCount = 0
    const newCompressedImages: string[] = []

    filesToProcess.forEach((file) => {
      const reader = new FileReader()
      reader.onload = (re) => {
        const img = new Image()
        img.onload = () => {
          const canvas = document.createElement('canvas')
          let width = img.width
          let height = img.height
          const maxDim = 1400
          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width)
              width = maxDim
            } else {
              width = Math.round((width * maxDim) / height)
              height = maxDim
            }
          }
          canvas.width = width
          canvas.height = height
          const ctx = canvas.getContext('2d')
          ctx?.drawImage(img, 0, 0, width, height)
          const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.8)
          newCompressedImages.push(compressedDataUrl)

          processedCount++
          if (processedCount === filesToProcess.length) {
            const updated = [...settings.menu_images, ...newCompressedImages].slice(0, 3)
            setSettings({ ...settings, menu_images: updated })
            setCompressing(false)
            if (menuInputRef.current) menuInputRef.current.value = ''
          }
        }
        img.src = re.target?.result as string
      }
      reader.readAsDataURL(file)
    })
  }

  const removeMenuImage = (indexToRemove: number) => {
    if (!settings) return
    const updated = settings.menu_images.filter((_, idx) => idx !== indexToRemove)
    setSettings({ ...settings, menu_images: updated })
  }

  const saveSettings = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!settings) return
    setError(null)
    setSaved(false)

    const { error: saveErr } = await supabase
      .from('business_settings')
      .update({
        name: settings.name,
        phone: settings.phone,
        address: settings.address,
        delivery_fee: Number(settings.delivery_fee),
        voice_replies_enabled: settings.voice_replies_enabled,
        memory_reorder_enabled: settings.memory_reorder_enabled,
        menu_images: settings.menu_images,
        menu_image_url: settings.menu_images[0] || null,
      })
      .eq('id', true)

    if (saveErr) setError(saveErr.message)
    else {
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    }
  }

  const generateCode = async () => {
    setCodeBusy(true)
    setError(null)
    const { data, error: codeErr } = await supabase.rpc('generate_staff_link_code')
    if (codeErr) setError(codeErr.message)
    else setLinkCode(data as string)
    setCodeBusy(false)
  }

  const unlinkTelegram = async () => {
    if (!myProfile?.telegram_chat_id) return
    setCodeBusy(true)
    await supabase.rpc('unlink_telegram_staff', { p_chat_id: myProfile.telegram_chat_id })
    await load()
    setCodeBusy(false)
  }

  if (loading) {
    return (
      <div className="max-w-3xl space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-44 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-56 w-full" />
      </div>
    )
  }

  return (
    <div className="max-w-3xl space-y-7 pb-10">
      <div>
        <h1 className="text-xl font-bold font-mono tracking-tight text-zinc-100">CONFIGURACIÓN</h1>
        <p className="text-xs text-zinc-400">Canal de pedidos para clientes, IA y ajustes del negocio</p>
      </div>

      {error && (
        <p className="rounded-xl bg-red-950/60 border border-red-800/60 p-3 text-xs text-red-300 font-mono">
          {error}
        </p>
      )}
      {saved && (
        <p className="rounded-xl bg-emerald-950/60 border border-emerald-800/60 p-3 text-xs text-emerald-300 font-mono">
          Cambios guardados con éxito.
        </p>
      )}

      {/* 1. COMPARTIR EL BOT CON LOS CLIENTES */}
      <section className="rounded-2xl bg-zinc-900 p-5 md:p-6 border border-zinc-800 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-400 font-bold">
              Canal de Pedidos para Clientes
            </span>
            <h2 className="text-base font-bold text-zinc-100 mt-0.5">Bot de Telegram Oficial</h2>
          </div>
          <span className="text-xs font-mono font-semibold bg-zinc-800 text-zinc-300 px-2.5 py-1 rounded-full border border-zinc-700/60 flex items-center gap-1.5">
            <Send className="h-3 w-3 text-sky-400" />
            <span>@{BOT_USERNAME}</span>
          </span>
        </div>

        <p className="text-xs text-zinc-400 leading-relaxed">
          Comparte este enlace o imprime el código QR para colocarlo en las mesas, volantes o mostrador.
          Los clientes que abran el bot podrán pedir a domicilio o para llevar inmediatamente.
        </p>

        <div className="flex flex-col sm:flex-row items-center gap-4 bg-zinc-950/80 p-4 rounded-xl border border-zinc-800">
          {qrDataUrl && (
            <div className="shrink-0 bg-white p-2 rounded-xl shadow-sm">
              <img src={qrDataUrl} alt="QR del Bot" className="w-28 h-28 object-contain" />
            </div>
          )}

          <div className="flex-1 space-y-2.5 w-full text-center sm:text-left">
            <div>
              <p className="text-[10px] font-mono text-zinc-500 uppercase">Enlace directo:</p>
              <code className="text-xs font-mono text-zinc-200 select-all break-all">{BOT_URL}</code>
            </div>

            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 pt-1">
              <button
                onClick={copyBotLink}
                className="rounded-lg bg-zinc-800 hover:bg-zinc-750 text-zinc-200 text-xs font-semibold px-3 py-1.5 transition border border-zinc-700 flex items-center gap-1.5"
              >
                {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                <span>{copied ? 'Copiado' : 'Copiar enlace'}</span>
              </button>

              <button
                onClick={shareWhatsapp}
                className="rounded-lg bg-emerald-600/90 hover:bg-emerald-500 text-white text-xs font-bold px-3 py-1.5 transition flex items-center gap-1.5 shadow-sm"
              >
                <MessageCircle className="h-3 w-3 stroke-[2.5]" />
                <span>WhatsApp</span>
              </button>

              <button
                onClick={downloadQr}
                className="rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-xs font-medium px-3 py-1.5 transition border border-zinc-800 flex items-center gap-1.5"
              >
                <Download className="h-3 w-3" />
                <span>Descargar QR</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* 2. VINCULACIÓN TELEGRAM STAFF */}
      <section className="rounded-2xl bg-zinc-900 p-5 md:p-6 border border-zinc-800 space-y-4">
        <div>
          <span className="text-[10px] font-mono uppercase tracking-wider text-sky-400 font-bold">
            Personal del Restaurante
          </span>
          <h2 className="text-base font-bold text-zinc-100 mt-0.5">Modo Mesero en Telegram</h2>
          <p className="text-xs text-zinc-400 mt-1">
            Vincula la cuenta de Telegram de un mesero para que pueda tomar órdenes de mesas físicas directamente.
          </p>
        </div>

        {myProfile?.telegram_chat_id ? (
          <div className="flex items-center justify-between rounded-xl bg-zinc-950 p-3.5 border border-zinc-800">
            <div className="flex items-center gap-2.5">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              <div>
                <p className="text-xs font-semibold text-zinc-200">
                  Vinculado: @{myProfile.telegram_username || myProfile.full_name}
                </p>
                <p className="text-[11px] font-mono text-zinc-500 capitalize">Rol: {myProfile.role}</p>
              </div>
            </div>
            <button
              onClick={unlinkTelegram}
              disabled={codeBusy}
              className="text-xs text-red-400 hover:text-red-300 font-semibold underline px-2 py-1"
            >
              Desvincular
            </button>
          </div>
        ) : linkCode ? (
          <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-950 p-4 text-center space-y-1.5">
            <p className="text-xs text-zinc-400">Envía este comando al bot desde Telegram:</p>
            <code className="text-lg font-mono font-bold text-white bg-zinc-800 px-3 py-1 rounded inline-block">
              /vincular {linkCode}
            </code>
            <p className="text-[10px] text-zinc-500 font-mono">Válido por 15 minutos</p>
          </div>
        ) : (
          <button
            onClick={generateCode}
            disabled={codeBusy}
            className="rounded-xl bg-zinc-800 hover:bg-zinc-750 border border-zinc-700 text-zinc-100 px-4 py-2 text-xs font-bold transition flex items-center gap-2"
          >
            <Send className="h-3 w-3" />
            <span>{codeBusy ? 'Generando...' : 'Vincular mi Telegram como Personal'}</span>
          </button>
        )}
      </section>

      {/* 3. OPCIONES DE INTELIGENCIA ARTIFICIAL Y BOT */}
      {settings && (
        <form onSubmit={saveSettings} className="space-y-7">
          <section className="rounded-2xl bg-zinc-900 p-5 md:p-6 border border-zinc-800 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[10px] font-mono uppercase tracking-wider text-purple-400 font-bold">
                  Inteligencia Artificial y Mensajería
                </span>
                <h2 className="text-base font-bold text-zinc-100 mt-0.5">Comportamiento del Bot</h2>
              </div>
              <Bot className="h-5 w-5 text-purple-400" />
            </div>

            <div className="space-y-4 pt-1">
              {/* Opción A: Notas de voz */}
              <div className="flex items-start justify-between gap-4 p-3.5 rounded-xl bg-zinc-950/80 border border-zinc-800">
                <div className="flex items-start gap-3">
                  <Mic className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-bold text-zinc-200">
                      Responder con Nota de Voz cuando el cliente envíe audio
                    </p>
                    <p className="text-[11px] text-zinc-400 mt-0.5 leading-relaxed">
                      Si el cliente envía un audio de voz, el bot generará una respuesta de audio sintetizada automáticamente.
                    </p>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.voice_replies_enabled}
                  onChange={(e) =>
                    setSettings({ ...settings, voice_replies_enabled: e.target.checked })
                  }
                  className="h-4 w-4 rounded bg-zinc-900 border-zinc-700 accent-emerald-500 cursor-pointer mt-1"
                />
              </div>

              {/* Opción B: Memoria y Lo mismo de siempre */}
              <div className="flex items-start justify-between gap-4 p-3.5 rounded-xl bg-zinc-950/80 border border-zinc-800">
                <div className="flex items-start gap-3">
                  <RotateCcw className="h-5 w-5 text-sky-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-bold text-zinc-200">
                      Memoria de Cliente y &quot;Lo mismo de siempre&quot;
                    </p>
                    <p className="text-[11px] text-zinc-400 mt-0.5 leading-relaxed">
                      El bot recuerda la dirección habitual del cliente y sugiere repetir su último pedido al saludar o cuando pida &quot;lo de siempre&quot;.
                    </p>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.memory_reorder_enabled}
                  onChange={(e) =>
                    setSettings({ ...settings, memory_reorder_enabled: e.target.checked })
                  }
                  className="h-4 w-4 rounded bg-zinc-900 border-zinc-700 accent-sky-500 cursor-pointer mt-1"
                />
              </div>

              {/* Opción C: Subida de hasta 3 fotos oficiales de la carta */}
              <div className="space-y-3 p-4 rounded-xl bg-zinc-950/80 border border-zinc-800">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ImageIcon className="h-4 w-4 text-amber-400" />
                    <label className="text-xs font-bold text-zinc-200">
                      Fotos de la Carta / Menú para el Bot (Hasta 3 imágenes)
                    </label>
                  </div>
                  <span className="text-[11px] font-mono font-bold bg-zinc-800 text-amber-400 px-2 py-0.5 rounded border border-zinc-700/60">
                    {settings.menu_images.length}/3 fotos
                  </span>
                </div>

                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  Sube hasta 3 fotos de tu carta o volante (ej: Hamburguesas, Perros, Bebidas). Cuando los clientes saluden o pidan el menú, el bot les enviará estas fotos directamente.
                </p>

                <input
                  type="file"
                  ref={menuInputRef}
                  onChange={handleMenuImageUpload}
                  accept="image/*"
                  multiple
                  className="hidden"
                />

                {/* Grilla de 3 slots */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                  {settings.menu_images.map((imgUrl, idx) => (
                    <div
                      key={idx}
                      className="relative rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden flex flex-col justify-between group shadow-sm"
                    >
                      <div className="h-36 w-full bg-zinc-950 flex items-center justify-center overflow-hidden">
                        <img
                          src={imgUrl}
                          alt={`Menú ${idx + 1}`}
                          className="h-full w-full object-cover"
                        />
                      </div>
                      <div className="p-2 bg-zinc-900/90 border-t border-zinc-800 flex items-center justify-between text-xs">
                        <span className="font-mono text-[11px] font-bold text-zinc-300">
                          Página {idx + 1} de {settings.menu_images.length}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeMenuImage(idx)}
                          title="Eliminar esta foto"
                          className="rounded p-1 text-red-400 hover:text-red-300 hover:bg-red-950/60 transition"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}

                  {/* Slot para agregar más fotos si no ha llegado al límite de 3 */}
                  {settings.menu_images.length < 3 && (
                    <div
                      onClick={() => menuInputRef.current?.click()}
                      className="h-44 cursor-pointer rounded-xl border border-dashed border-zinc-700 hover:border-zinc-500 bg-zinc-900/40 hover:bg-zinc-900/80 p-4 text-center flex flex-col items-center justify-center gap-2 transition"
                    >
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-zinc-800 text-zinc-300">
                        {compressing ? (
                          <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
                        ) : (
                          <Plus className="h-4 w-4 text-emerald-400" />
                        )}
                      </div>
                      <div>
                        <p className="text-xs font-bold text-zinc-200">
                          {compressing ? 'Optimizando...' : `Subir Foto ${settings.menu_images.length + 1} de 3`}
                        </p>
                        <p className="text-[10px] text-zinc-500 mt-0.5">JPG o PNG desde tu dispositivo</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* 4. DATOS GENERALES DEL RESTAURANTE */}
          <section className="rounded-2xl bg-zinc-900 p-5 md:p-6 border border-zinc-800 space-y-4">
            <h2 className="text-base font-bold text-zinc-100">Datos del Restaurante</h2>

            <div className="space-y-3">
              <label className="block text-xs font-mono uppercase text-zinc-400">
                Nombre comercial
                <input
                  type="text"
                  required
                  value={settings.name}
                  onChange={(e) => setSettings({ ...settings, name: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-zinc-600 focus:outline-none"
                />
              </label>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="block text-xs font-mono uppercase text-zinc-400">
                  Teléfono de contacto
                  <input
                    type="text"
                    value={settings.phone || ''}
                    onChange={(e) => setSettings({ ...settings, phone: e.target.value })}
                    placeholder="300 123 4567"
                    className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-zinc-600 focus:outline-none"
                  />
                </label>

                <label className="block text-xs font-mono uppercase text-zinc-400">
                  Costo de domicilio (COP)
                  <input
                    type="number"
                    min="0"
                    step="500"
                    value={settings.delivery_fee}
                    onChange={(e) =>
                      setSettings({ ...settings, delivery_fee: Number(e.target.value) })
                    }
                    className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-zinc-600 focus:outline-none"
                  />
                </label>
              </div>

              <label className="block text-xs font-mono uppercase text-zinc-400">
                Dirección física
                <input
                  type="text"
                  value={settings.address || ''}
                  onChange={(e) => setSettings({ ...settings, address: e.target.value })}
                  placeholder="Calle 10 # 20 - 30"
                  className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-zinc-600 focus:outline-none"
                />
              </label>
            </div>

            <button
              type="submit"
              className="rounded-xl bg-zinc-100 hover:bg-white text-zinc-900 px-5 py-2.5 font-bold text-xs transition flex items-center gap-1.5"
            >
              <Save className="h-3.5 w-3.5" />
              <span>Guardar cambios</span>
            </button>
          </section>
        </form>
      )}
    </div>
  )
}
