import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import { VehicleAlarmProvider } from './contexts/VehicleAlarmContext'
import AlarmNotification from './components/AlarmNotification'

const Login = lazy(() => import('./pages/Login'))
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'))
const AdminRoute = lazy(() => import('./components/AdminRoute'))

function App() {
  return (
    <VehicleAlarmProvider>
      <BrowserRouter>
        <AlarmNotification />
        <Suspense fallback={
          <div style={{ backgroundColor: 'black', color: 'white', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
  )
}

export default App
