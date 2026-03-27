import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import { Toaster } from 'react-hot-toast'
import { VehicleAlarmProvider } from './contexts/VehicleAlarmContext'
import { ThemeProvider } from './contexts/ThemeContext'
import ErrorBoundary from './components/ErrorBoundary'
import AlarmNotification from './components/AlarmNotification'
import LateReturnAlarm from './components/admin/LateReturnAlarm'

const Login = lazy(() => import('./pages/Login'))
const ResetPassword = lazy(() => import('./pages/ResetPassword'))
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'))
const AdminRoute = lazy(() => import('./components/AdminRoute'))
const ReferralPage = lazy(() => import('./pages/ReferralPage'))
const FirmaPage = lazy(() => import('./pages/FirmaPage'))

function App() {
  return (
    <ErrorBoundary>
    <ThemeProvider>
      <BrowserRouter>
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 3000,
            style: {
              background: '#1a2332',
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '12px',
            },
            success: {
              iconTheme: { primary: '#2d8a7e', secondary: '#1a2332' },
            },
            error: {
              duration: 5000,
              iconTheme: { primary: '#ef4444', secondary: '#1a2332' },
            },
          }}
        />
        <Suspense fallback={
          <div className="bg-theme-bg-primary text-theme-text-primary min-h-screen flex items-center justify-center">
            <div className="text-center">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-yellow-600 mx-auto mb-3"></div>
              <p className="text-sm opacity-60">Caricamento...</p>
            </div>
          </div>
        }>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/referral" element={<ReferralPage />} />
            <Route path="/firma/:token" element={<FirmaPage />} />
            <Route
              path="/admin"
              element={
                <AdminRoute>
                  <VehicleAlarmProvider>
                    <AlarmNotification />
                    <LateReturnAlarm />
                    <AdminDashboard />
                  </VehicleAlarmProvider>
                </AdminRoute>
              }
            />
            <Route path="/" element={<Navigate to="/login" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ThemeProvider>
    </ErrorBoundary>
  )
}

export default App
