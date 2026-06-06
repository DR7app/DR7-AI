import { Handler, HandlerEvent, HandlerResponse } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL!
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const adminApiToken = process.env.ADMIN_API_TOKEN!

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey)

const ALLOWED_ORIGINS = [
  // 2026-06-05: migrazione dominio (admin -> dr7ai.com, sito -> dr7.app).
  // Additivo: nuovi e vecchi domini insieme durante la transizione.
  // 2026-06-06: admin ora su platform.dr7ai.com (dr7ai.com = landing CRM).
  'https://platform.dr7ai.com',
  'https://dr7ai.com',
  'https://www.dr7ai.com',
  'https://dr7.app',
  'https://www.dr7.app',
  'https://admin.dr7empire.com',
  'http://localhost:5173',
  'http://localhost:8888',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:8888'
]

function corsHeaders(origin: string = ALLOWED_ORIGINS[0]): Record<string, string> {
  // Allow the requesting origin if it's in the allowed list, otherwise use the first one
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Content-Type': 'application/json'
  }
}

function response(statusCode: number, body: any, origin?: string): HandlerResponse {
  return {
    statusCode,
    headers: corsHeaders(origin),
    body: JSON.stringify(body)
  }
}

function unauthorized(origin?: string): HandlerResponse {
  return response(401, { error: 'Unauthorized' }, origin)
}

async function logAudit(actorId: string | null, action: string, entityType: string, entityId: string | null, diff: any) {
  try {
    await supabase.from('audit_log').insert({
      actor_id: actorId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      diff
    })
  } catch (error) {
    console.error('Failed to log audit:', error)
  }
}

export const handler: Handler = async (event: HandlerEvent): Promise<HandlerResponse> => {
  const origin = event.headers.origin || event.headers.Origin || ALLOWED_ORIGINS[0]

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders(origin),
      body: ''
    }
  }

  const authHeader = event.headers.authorization || event.headers.Authorization
  const token = authHeader?.replace('Bearer ', '')

  if (token !== adminApiToken) {
    return unauthorized(origin)
  }

  const path = event.path.replace('/.netlify/functions/admin', '')
  const method = event.httpMethod

  try {
    // GET /customers
    if (path === '/customers' && method === 'GET') {
      // Fetch from both customers and customers_extended tables
      const [customersResult, customersExtendedResult] = await Promise.all([
        supabase
          .from('customers')
          .select('*')
          .order('created_at', { ascending: false }),
        supabase
          .from('customers_extended')
          .select('*')
          .order('created_at', { ascending: false })
      ])

      if (customersResult.error && customersExtendedResult.error) {
        throw customersResult.error || customersExtendedResult.error
      }

      // Merge data from both tables, converting customers_extended format
      const oldCustomers = customersResult.data || []
      const newCustomers = (customersExtendedResult.data || []).map((c: any) => ({
        id: c.id,
        full_name: c.tipo_cliente === 'azienda'
          ? c.denominazione
          : `${c.nome || ''} ${c.cognome || ''}`.trim(),
        email: c.email,
        phone: c.telefono,
        driver_license_number: null,
        notes: null,
        created_at: c.created_at,
        updated_at: c.created_at
      }))

      // Combine both, removing duplicates by id
      const allCustomers = [...oldCustomers, ...newCustomers]
      const uniqueCustomers = Array.from(
        new Map(allCustomers.map(c => [c.id, c])).values()
      )

      return response(200, { data: uniqueCustomers }, origin)
    }

    // POST /customers
    if (path === '/customers' && method === 'POST') {
      const body = JSON.parse(event.body || '{}')
      const { full_name, email, phone, driver_license_number, notes } = body

      const { data, error } = await supabase
        .from('customers')
        .insert({
          full_name,
          email: email || null,
          phone: phone || null,
          driver_license_number: driver_license_number || null,
          notes: notes || null
        })
        .select()
        .single()

      if (error) throw error

      await logAudit(null, 'create', 'customer', data.id, body)
      return response(201, { data }, origin)
    }

    // PATCH /customers
    if (path === '/customers' && method === 'PATCH') {
      const body = JSON.parse(event.body || '{}')
      const { id, full_name, email, phone, driver_license_number, notes } = body

      const { data: oldData } = await supabase
        .from('customers')
        .select('*')
        .eq('id', id)
        .single()

      const { data, error } = await supabase
        .from('customers')
        .update({
          full_name,
          email: email || null,
          phone: phone || null,
          driver_license_number: driver_license_number || null,
          notes: notes || null,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single()

      if (error) throw error

      await logAudit(null, 'update', 'customer', id, { old: oldData, new: data })
      return response(200, { data }, origin)
    }

    // GET /vehicles
    if (path === '/vehicles' && method === 'GET') {
      const { data, error } = await supabase
        .from('vehicles')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) throw error
      return response(200, { data }, origin)
    }

    // POST /vehicles
    if (path === '/vehicles' && method === 'POST') {
      const body = JSON.parse(event.body || '{}')
      const { display_name, plate, status, daily_rate } = body

      const { data, error } = await supabase
        .from('vehicles')
        .insert({
          display_name,
          plate: plate || null,
          status: status || 'available',
          daily_rate: parseFloat(daily_rate)
        })
        .select()
        .single()

      if (error) throw error

      await logAudit(null, 'create', 'vehicle', data.id, body)
      return response(201, { data }, origin)
    }

    // PATCH /vehicles
    if (path === '/vehicles' && method === 'PATCH') {
      const body = JSON.parse(event.body || '{}')
      const { id, display_name, plate, status, daily_rate } = body

      const { data: oldData } = await supabase
        .from('vehicles')
        .select('*')
        .eq('id', id)
        .single()

      const { data, error } = await supabase
        .from('vehicles')
        .update({
          display_name,
          plate: plate || null,
          status,
          daily_rate: parseFloat(daily_rate),
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single()

      if (error) throw error

      await logAudit(null, 'update', 'vehicle', id, { old: oldData, new: data })
      return response(200, { data }, origin)
    }

    // GET /reservations
    if (path === '/reservations' && method === 'GET') {
      const { data, error } = await supabase
        .from('reservations')
        .select('*, customers(*), vehicles(*)')
        .order('start_at', { ascending: false })

      if (error) throw error
      return response(200, { data }, origin)
    }

    // POST /reservations
    if (path === '/reservations' && method === 'POST') {
      const body = JSON.parse(event.body || '{}')
      const { customer_id, vehicle_id, start_at, end_at, status, source, total_amount, currency } = body

      const { data, error } = await supabase
        .from('reservations')
        .insert({
          customer_id,
          vehicle_id,
          start_at,
          end_at,
          status: status || 'pending',
          source: source || 'admin',
          total_amount: parseFloat(total_amount),
          currency: currency || 'USD'
        })
        .select()
        .single()

      if (error) throw error

      await logAudit(null, 'create', 'reservation', data.id, body)
      return response(201, { data }, origin)
    }

    // PATCH /reservations
    if (path === '/reservations' && method === 'PATCH') {
      const body = JSON.parse(event.body || '{}')
      const { id, customer_id, vehicle_id, start_at, end_at, status, source, total_amount, currency } = body

      const { data: oldData } = await supabase
        .from('reservations')
        .select('*')
        .eq('id', id)
        .single()

      const { data, error } = await supabase
        .from('reservations')
        .update({
          customer_id,
          vehicle_id,
          start_at,
          end_at,
          status,
          source,
          total_amount: parseFloat(total_amount),
          currency,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single()

      if (error) throw error

      await logAudit(null, 'update', 'reservation', id, { old: oldData, new: data })
      return response(200, { data }, origin)
    }

    // GET /export/reservations.csv
    if (path === '/export/reservations.csv' && method === 'GET') {
      const { data, error } = await supabase
        .from('reservations')
        .select('id, start_at, end_at, status, total_amount, currency, source')
        .order('start_at', { ascending: false })

      if (error) throw error

      // Escape CSV values to prevent formula injection
      const escCsv = (val: any): string => {
        const s = String(val ?? '')
        if (s.match(/^[=+\-@\t\r]/) || s.includes(',') || s.includes('"') || s.includes('\n')) {
          return '"' + s.replace(/"/g, '""') + '"'
        }
        return s
      }

      const csv = [
        'id,start_at,end_at,status,total_amount,currency,source',
        ...data.map((r: any) =>
          [r.id, r.start_at, r.end_at, r.status, r.total_amount, r.currency, r.source || ''].map(escCsv).join(',')
        )
      ].join('\n')

      return {
        statusCode: 200,
        headers: {
          ...corsHeaders(origin),
          'Content-Type': 'text/csv',
          'Content-Disposition': 'attachment; filename="reservations.csv"'
        },
        body: csv
      }
    }

    return response(404, { error: 'Not found' }, origin)

  } catch (error: any) {
    console.error('Function error:', error)
    return response(500, { error: 'Internal server error' }, origin)
  }
}
