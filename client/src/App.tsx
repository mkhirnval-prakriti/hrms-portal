import { useEffect, useState } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Dashboard } from './pages/Dashboard'
import { Login } from './pages/Login'
import { Placeholder } from './pages/Placeholder'
import { api } from './api'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<'loading' | 'in' | 'out'>('loading')

  useEffect(() => {
    api('/auth/me')
      .then(() => setState('in'))
      .catch(() => setState('out'))
  }, [])

  if (state === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f0f4f1] text-emerald-800">
        Loading…
      </div>
    )
  }
  if (state === 'out') {
    return <Navigate to="/login" replace />
  }
  return <>{children}</>
}

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="attendance" element={<Placeholder title="Attendance" />} />
          <Route path="employees" element={<Placeholder title="Employees" />} />
          <Route
            path="documents"
            element={<Placeholder title="Document Verification" hint="KYC / ID checks — connect OCR pipeline later." />}
          />
          <Route path="leaves" element={<Placeholder title="Leaves" />} />
          <Route path="payroll" element={<Placeholder title="Payroll" />} />
          <Route path="staff-mgmt" element={<Placeholder title="Staff Management" />} />
          <Route path="kiosk" element={<Placeholder title="Kiosk Mode" />} />
          <Route path="trash" element={<Placeholder title="Trash" />} />
          <Route path="office" element={<Placeholder title="Office Location" />} />
          <Route path="company" element={<Placeholder title="Company" />} />
          <Route path="notices" element={<Placeholder title="Notice Board" />} />
          <Route path="guide" element={<Placeholder title="System Guide" />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  )
}
