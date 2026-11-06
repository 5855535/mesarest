import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { homeFor } from '../auth/roles'
import { supabase } from '../lib/supabase'

export default function Login() {
  const { session, profile, loading } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!loading && session && profile) return <Navigate to={homeFor(profile.role)} replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError('Credenciales incorrectas')
    setBusy(false)
  }

  return (
    <div className="min-h-screen grid place-items-center bg-zinc-950 px-4 text-zinc-100">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-5 rounded-2xl bg-zinc-900/90 p-8 shadow-2xl border border-zinc-800 backdrop-blur"
      >
        <div>
          <span className="font-mono font-black text-2xl tracking-tight text-zinc-100">
            BKJ<span className="text-emerald-400">.env</span>
          </span>
          <p className="text-xs text-zinc-400 mt-1 font-mono uppercase tracking-wider">
            Restaurant Operations OS
          </p>
        </div>

        <label className="block text-xs font-mono uppercase text-zinc-400">
          Correo
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-zinc-600 focus:outline-none"
          />
        </label>

        <label className="block text-xs font-mono uppercase text-zinc-400">
          Contraseña
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-zinc-600 focus:outline-none"
          />
        </label>

        {error && (
          <p role="alert" className="text-xs text-red-400 font-mono">
            {error}
          </p>
        )}

        <button
          disabled={busy}
          className="w-full rounded-xl bg-zinc-100 py-2.5 font-bold text-sm text-zinc-900 hover:bg-white transition disabled:opacity-50"
        >
          {busy ? 'Iniciando...' : 'Entrar'}
        </button>
      </form>
    </div>
  )
}
