import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Customer } from '../lib/types'

interface Props {
  customers: Customer[]
  value: Customer | null
  onChange: (c: Customer | null) => void
  onCreated: (c: Customer) => void
}

const input = 'w-full rounded-lg border border-stone-300 px-3 py-2 text-sm'

export default function CustomerPicker({ customers, value, onChange, onCreated }: Props) {
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [error, setError] = useState<string | null>(null)

  const matches = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return []
    return customers
      .filter((c) => c.full_name.toLowerCase().includes(t) || (c.phone ?? '').includes(t))
      .slice(0, 5)
  }, [q, customers])

  const create = async () => {
    setError(null)
    if (!name.trim()) return setError('El nombre es obligatorio')
    const { data, error } = await supabase
      .from('customers')
      .insert({
        full_name: name.trim(),
        phone: phone.trim() || null,
        address: address.trim() || null,
      })
      .select('id, full_name, phone, address')
      .single()
    if (error) return setError(error.message)
    onCreated(data as Customer)
    onChange(data as Customer)
    setCreating(false)
    setName('')
    setPhone('')
    setAddress('')
  }

  if (value) {
    return (
      <div className="flex items-center justify-between rounded-lg bg-stone-100 px-3 py-2 text-sm">
        <div className="min-w-0">
          <p className="truncate font-medium">{value.full_name}</p>
          <p className="truncate text-xs text-stone-500">{value.phone ?? 'Sin teléfono'}</p>
        </div>
        <button onClick={() => onChange(null)} className="text-xs text-stone-500 hover:text-red-600">
          Quitar
        </button>
      </div>
    )
  }

  if (creating) {
    return (
      <div className="space-y-2 rounded-lg border border-stone-200 p-3">
        <input className={input} placeholder="Nombre *" value={name} onChange={(e) => setName(e.target.value)} />
        <input className={input} placeholder="Teléfono" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <input className={input} placeholder="Dirección" value={address} onChange={(e) => setAddress(e.target.value)} />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex gap-2">
          <button onClick={create} className="rounded-lg bg-stone-900 px-3 py-1.5 text-sm text-white">
            Guardar cliente
          </button>
          <button onClick={() => setCreating(false)} className="text-sm text-stone-500">
            Cancelar
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="relative space-y-1">
      <div className="flex gap-2">
        <input
          className={input}
          placeholder="Buscar cliente (nombre o teléfono)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button
          onClick={() => setCreating(true)}
          className="shrink-0 rounded-lg border border-stone-300 px-3 text-sm hover:bg-stone-50"
        >
          Nuevo
        </button>
      </div>
      {matches.length > 0 && (
        <ul className="rounded-lg border border-stone-200 bg-white shadow-sm">
          {matches.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => {
                  onChange(c)
                  setQ('')
                }}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-stone-50"
              >
                {c.full_name} <span className="text-stone-400">{c.phone}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
