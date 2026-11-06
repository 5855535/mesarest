import { useAuth } from '../auth/AuthProvider'

export default function NoAccess() {
  const { signOut } = useAuth()
  return (
    <div className="min-h-screen grid place-items-center px-4">
      <div className="max-w-sm space-y-3 text-center">
        <h1 className="text-xl font-bold">Sin acceso</h1>
        <p className="text-stone-600">
          Tu cuenta aún no tiene un rol asignado. Pide a un administrador que te dé acceso.
        </p>
        <button onClick={signOut} className="rounded-lg bg-stone-900 px-4 py-2 text-white">
          Cerrar sesión
        </button>
      </div>
    </div>
  )
}
