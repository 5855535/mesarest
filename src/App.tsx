import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import { homeFor } from './auth/roles'
import { RequireRole, RequireStaff, Spinner } from './components/Guards'
import Layout from './components/Layout'
import Catalog from './pages/Catalog'
import Dashboard from './pages/Dashboard'
import Dispatch from './pages/Dispatch'
import Kitchen from './pages/Kitchen'
import Login from './pages/Login'
import NoAccess from './pages/NoAccess'
import POS from './pages/POS'
import Settings from './pages/Settings'

function Home() {
  const { profile, session, loading } = useAuth()
  if (loading) return <Spinner />
  if (!session) return <Navigate to="/login" replace />
  return <Navigate to={profile ? homeFor(profile.role) : '/sin-acceso'} replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/sin-acceso" element={<NoAccess />} />
          <Route element={<RequireStaff />}>
            <Route element={<Layout />}>
              <Route element={<RequireRole roles={['admin']} />}>
                <Route path="/panel" element={<Dashboard />} />
                <Route path="/catalogo" element={<Catalog />} />
                <Route path="/configuracion" element={<Settings />} />
              </Route>
              <Route element={<RequireRole roles={['admin', 'caja']} />}>
                <Route path="/pos" element={<POS />} />
              </Route>
              <Route element={<RequireRole roles={['admin', 'cocina']} />}>
                <Route path="/cocina" element={<Kitchen />} />
              </Route>
              <Route element={<RequireRole roles={['admin', 'despacho']} />}>
                <Route path="/despacho" element={<Dispatch />} />
              </Route>
            </Route>
          </Route>
          <Route path="*" element={<Home />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
