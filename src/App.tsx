import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Suspense } from 'react'
import { Toaster } from 'react-hot-toast'
import { VehicleAlarmProvider } from './contexts/VehicleAlarmContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { ClientStatusProvider } from './contexts/ClientStatusContext'
import ErrorBoundary from './components/ErrorBoundary'
import AlarmNotification from './components/AlarmNotification'
import LateReturnAlarm from './components/admin/LateReturnAlarm'
import lazyWithRetry from './utils/lazyWithRetry'

const Login = lazyWithRetry(() => import('./pages/Login'))
const ResetPassword = lazyWithRetry(() => import('./pages/ResetPassword'))
const AdminDashboard = lazyWithRetry(() => import('./pages/admin/AdminDashboard'))
const AdminRoute = lazyWithRetry(() => import('./components/AdminRoute'))
const ReferralPage = lazyWithRetry(() => import('./pages/ReferralPage'))
const FirmaPage = lazyWithRetry(() => import('./pages/FirmaPage'))
const RegistrazioneClientePage = lazyWithRetry(() => import('./pages/RegistrazioneClientePage'))

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
              iconTheme: { primary: '#19C2D6', secondary: '#1a2332' },
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
            <Route path="/registrazione-cliente/:token" element={<RegistrazioneClientePage />} />
            <Route
              path="/admin"
              element={
                <AdminRoute>
                  <ClientStatusProvider>
                    <VehicleAlarmProvider>
                      <AlarmNotification />
                      <LateReturnAlarm />
                      <AdminDashboard />
                    </VehicleAlarmProvider>
                  </ClientStatusProvider>
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
