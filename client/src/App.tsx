import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from './components/Layout'
import { LogoLoader } from './components/LogoLoader'
import { Dashboard } from './pages/Dashboard'
import { Login } from './pages/Login'
import { AttendancePage } from './pages/AttendancePage'
import { EmployeesPage } from './pages/EmployeesPage'
import { LeavesPage } from './pages/LeavesPage'
import { PayrollPage } from './pages/PayrollPage'
import { DocumentsPage } from './pages/DocumentsPage'
import { NoticesPage } from './pages/NoticesPage'
import { OfficePage } from './pages/OfficePage'
import { CompanyPage } from './pages/CompanyPage'
import { GuidePage } from './pages/GuidePage'
import { KioskPage } from './pages/KioskPage'
import { TrashPage } from './pages/TrashPage'
import { useAuth } from './context/AuthContext'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, initializing } = useAuth()

  if (initializing) {
    return <LogoLoader />
  }
  if (!user) {
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
          <Route path="attendance" element={<AttendancePage />} />
          <Route path="employees" element={<EmployeesPage />} />
          <Route path="documents" element={<DocumentsPage />} />
          <Route path="leaves" element={<LeavesPage />} />
          <Route path="payroll" element={<PayrollPage />} />
          <Route path="staff-mgmt" element={<Navigate to="/employees" replace />} />
          <Route path="kiosk" element={<KioskPage />} />
          <Route path="trash" element={<TrashPage />} />
          <Route path="office" element={<OfficePage />} />
          <Route path="company" element={<CompanyPage />} />
          <Route path="notices" element={<NoticesPage />} />
          <Route path="guide" element={<GuidePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}
