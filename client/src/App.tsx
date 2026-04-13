import { Suspense, lazy } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from './components/Layout'
import { LogoLoader } from './components/LogoLoader'
import { Login } from './pages/Login'
import { ForgotPassword } from './pages/ForgotPassword'
import { PageSkeleton } from './components/PageSkeleton'
import { useAuth } from './context/AuthContext'

const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })))
const AttendancePage = lazy(() => import('./pages/AttendancePage').then((m) => ({ default: m.AttendancePage })))
const EmployeesPage = lazy(() => import('./pages/EmployeesPage').then((m) => ({ default: m.EmployeesPage })))
const LeavesPage = lazy(() => import('./pages/LeavesPage').then((m) => ({ default: m.LeavesPage })))
const PayrollPage = lazy(() => import('./pages/PayrollPage').then((m) => ({ default: m.PayrollPage })))
const DocumentsPage = lazy(() => import('./pages/DocumentsPage').then((m) => ({ default: m.DocumentsPage })))
const NoticesPage = lazy(() => import('./pages/NoticesPage').then((m) => ({ default: m.NoticesPage })))
const OfficePage = lazy(() => import('./pages/OfficePage').then((m) => ({ default: m.OfficePage })))
const CompanyPage = lazy(() => import('./pages/CompanyPage').then((m) => ({ default: m.CompanyPage })))
const GuidePage = lazy(() => import('./pages/GuidePage').then((m) => ({ default: m.GuidePage })))
const KioskPage = lazy(() => import('./pages/KioskPage').then((m) => ({ default: m.KioskPage })))
const TrashPage = lazy(() => import('./pages/TrashPage').then((m) => ({ default: m.TrashPage })))
const CrmPage = lazy(() => import('./pages/CrmPage').then((m) => ({ default: m.CrmPage })))
const ReportsPage = lazy(() => import('./pages/ReportsPage').then((m) => ({ default: m.ReportsPage })))
const IdentityEnrollmentPage = lazy(() =>
  import('./pages/IdentityEnrollmentPage').then((m) => ({ default: m.IdentityEnrollmentPage }))
)
const BiometricAdminPage = lazy(() =>
  import('./pages/BiometricAdminPage').then((m) => ({ default: m.BiometricAdminPage }))
)

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
        <Route path="/login/forgot" element={<ForgotPassword />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route
            index
            element={
              <Suspense fallback={<PageSkeleton />}>
                <Dashboard />
              </Suspense>
            }
          />
          <Route
            path="attendance"
            element={
              <Suspense fallback={<PageSkeleton rows={6} />}>
                <AttendancePage />
              </Suspense>
            }
          />
          <Route
            path="identity"
            element={
              <Suspense fallback={<PageSkeleton rows={5} />}>
                <IdentityEnrollmentPage />
              </Suspense>
            }
          />
          <Route
            path="biometric-requests"
            element={
              <Suspense fallback={<PageSkeleton rows={5} />}>
                <BiometricAdminPage />
              </Suspense>
            }
          />
          <Route
            path="reports"
            element={
              <Suspense fallback={<PageSkeleton rows={5} />}>
                <ReportsPage />
              </Suspense>
            }
          />
          <Route
            path="crm"
            element={
              <Suspense fallback={<PageSkeleton rows={6} />}>
                <CrmPage />
              </Suspense>
            }
          />
          <Route
            path="employees"
            element={
              <Suspense fallback={<PageSkeleton rows={6} />}>
                <EmployeesPage />
              </Suspense>
            }
          />
          <Route
            path="documents"
            element={
              <Suspense fallback={<PageSkeleton rows={6} />}>
                <DocumentsPage />
              </Suspense>
            }
          />
          <Route
            path="leaves"
            element={
              <Suspense fallback={<PageSkeleton rows={6} />}>
                <LeavesPage />
              </Suspense>
            }
          />
          <Route
            path="payroll"
            element={
              <Suspense fallback={<PageSkeleton rows={6} />}>
                <PayrollPage />
              </Suspense>
            }
          />
          <Route path="staff-mgmt" element={<Navigate to="/employees" replace />} />
          <Route
            path="kiosk"
            element={
              <Suspense fallback={<PageSkeleton />}>
                <KioskPage />
              </Suspense>
            }
          />
          <Route
            path="trash"
            element={
              <Suspense fallback={<PageSkeleton rows={6} />}>
                <TrashPage />
              </Suspense>
            }
          />
          <Route
            path="office"
            element={
              <Suspense fallback={<PageSkeleton />}>
                <OfficePage />
              </Suspense>
            }
          />
          <Route
            path="company"
            element={
              <Suspense fallback={<PageSkeleton />}>
                <CompanyPage />
              </Suspense>
            }
          />
          <Route
            path="notices"
            element={
              <Suspense fallback={<PageSkeleton />}>
                <NoticesPage />
              </Suspense>
            }
          />
          <Route
            path="guide"
            element={
              <Suspense fallback={<PageSkeleton />}>
                <GuidePage />
              </Suspense>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}
