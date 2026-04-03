export interface UserProfile {
  user_id: string
  full_name: string | null
  phone: string | null
  role: 'admin' | 'staff' | 'viewer'
  created_at: string
}

export interface Customer {
  id: string
  full_name: string
  email: string | null
  phone: string | null
  driver_license_number: string | null
  notes: string | null
  created_at: string
  updated_at: string
  membership?: CustomerMembership[] // Array because we might join 1:N, but typically we'll show the active one
}

export interface CustomerMembership {
  id: string
  client_id: string
  package_code: string
  package_name: string
  status: 'active' | 'expired' | 'pending'
  start_date: string
  end_date: string | null
  external_order_id: string | null
  source: string | null
  created_at: string
}

export interface Vehicle {
  id: string
  display_name: string
  plate: string | null
  chassis_number?: string | null  // Numero di Telaio (VIN)
  status: 'available' | 'rented' | 'maintenance' | 'retired'
  daily_rate: number
  price_resident_daily?: number | null
  price_nonresident_daily?: number | null
  category: 'exotic' | 'urban' | 'aziendali' | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata: Record<string, any> | null
  created_at: string
  updated_at: string
  // Fleet Management Fields
  current_km?: number
  insurance_expiry?: string
  tax_expiry?: string
  inspection_expiry?: string
  leasing_expiry?: string
  // Maintenance Tracking
  last_tire_change_km?: number // Legacy field - kept for backward compatibility
  last_tire_change_front_km?: number
  last_tire_change_rear_km?: number
  maintenance_tires_interval_km?: number // Legacy field - kept for backward compatibility
  maintenance_tires_front_interval_km?: number
  maintenance_tires_rear_interval_km?: number
  last_brake_change_km?: number // Legacy field - kept for backward compatibility
  last_brake_change_front_km?: number
  last_brake_change_rear_km?: number
  maintenance_brake_interval_km?: number // Legacy field - kept for backward compatibility
  maintenance_brake_front_interval_km?: number
  maintenance_brake_rear_interval_km?: number
  last_service_km?: number
  last_service_date?: string
  maintenance_service_interval_km?: number
}

export interface VehicleMaintenance {
  vehicle_id: string
  last_service_km: number | null
  last_service_date: string | null
  service_interval_km: number
  service_interval_months: number | null
  last_tire_change_front_km: number | null
  last_tire_change_front_date: string | null
  last_tire_change_rear_km: number | null
  last_tire_change_rear_date: string | null
  tire_interval_km: number | null
  last_brake_change_front_km: number | null
  last_brake_change_front_date: string | null
  last_brake_change_rear_km: number | null
  last_brake_change_rear_date: string | null
  brake_interval_km: number | null
}

export interface VehicleEvent {
  id: string
  vehicle_id: string
  event_type: 'tagliando' | 'gomme' | 'freni' | 'revisione' | 'assicurazione' | 'bollo' | 'altro'
  event_date: string
  km: number
  cost: number | null
  provider: string | null
  notes: string | null
  attachment_url: string | null
  created_at: string
}

export interface Reservation {
  id: string
  customer_id: string
  vehicle_id: string
  start_at: string
  end_at: string
  status: 'pending' | 'confirmed' | 'active' | 'completed' | 'cancelled'
  source: string | null
  total_amount: number
  currency: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addons: Record<string, any> | null
  created_by: string | null
  created_at: string
  updated_at: string
  customers?: Customer
  vehicles?: Vehicle
}

export interface AuditLog {
  id: number
  actor_id: string | null
  action: string
  entity_type: string
  entity_id: string | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  diff: Record<string, any> | null
  created_at: string
}
