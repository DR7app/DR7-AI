import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import { Toaster } from 'react-hot-toast'
import { VehicleAlarmProvider } from './contexts/VehicleAlarmContext'
import { ThemeProvider } from './contexts/ThemeContext'
import AlarmNotification from './components/AlarmNotification'
import LateReturnAlarm from './components/admin/LateReturnAlarm'

const Login = lazy(() => import('./pages/Login'))
const ResetPassword = lazy(() => import('./pages/ResetPassword'))
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'))
const AdminRoute = lazy(() => import('./components/AdminRoute'))
const ReferralPage = lazy(() => import('./pages/ReferralPage'))

function App() {
  return (
    <ThemeProvider>
      <VehicleAlarmProvider>
        <BrowserRouter>
          <Toaster
            position="top-right"
            toastOptions={{
              duration: 3000,
              style: {
                background: '#1a1a2e',
                color: '#fff',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '12px',
              },
              success: {
                iconTheme: { primary: '#d4af37', secondary: '#1a1a2e' },
              },
              error: {
                duration: 5000,
                iconTheme: { primary: '#ef4444', secondary: '#1a1a2e' },
              },
            }}
          />
          <AlarmNotification />
          <LateReturnAlarm />
          <Suspense fallback={
            <div className="bg-theme-bg-primary text-theme-text-primary min-h-screen flex items-center justify-center">
              <div>Loading...</div>
            </div>
          }>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/referral" element={<ReferralPage />} />
              <Route
                path="/admin"
                element={
                  <AdminRoute>
                    <AdminDashboard />
                  </AdminRoute>
                }
              />
              <Route path="/" element={<Navigate to="/login" replace />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </VehicleAlarmProvider>
    </ThemeProvider>
  )
}

export default App
