import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import { VehicleAlarmProvider } from './contexts/VehicleAlarmContext'
import { ThemeProvider } from './contexts/ThemeContext'
import AlarmNotification from './components/AlarmNotification'
import LateReturnAlarm from './components/admin/LateReturnAlarm'

const Login = lazy(() => import('./pages/Login'))
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'))
const AdminRoute = lazy(() => import('./components/AdminRoute'))

function App() {
  return (
    <ThemeProvider>
      <VehicleAlarmProvider>
        <BrowserRouter>
          <AlarmNotification />
          <LateReturnAlarm />
          <Suspense fallback={
            <div className="bg-theme-bg-primary text-theme-text-primary min-h-screen flex items-center justify-center">
              <div>Loading...</div>
            </div>
          }>
            <Routes>
              <Route path="/login" element={<Login />} />
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
