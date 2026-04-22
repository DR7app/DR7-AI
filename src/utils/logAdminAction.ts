import { supabase } from '../supabaseClient'
import { logger } from '../utils/logger'

interface AdminCache {
  id: string
  email: string
  nome: string | null
}

let cachedAdmin: AdminCache | null = null

async function getAdminInfo(): Promise<AdminCache | null> {
  if (cachedAdmin) return cachedAdmin

  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const { data } = await supabase
      .from('admins')
      .select('id, email, nome')
      .eq('user_id', user.id)
      .single()

    if (data) {
      cachedAdmin = { id: data.id, email: data.email, nome: data.nome }
      return cachedAdmin
    }
  } catch (err) {
    console.error('Failed to load admin info for logging:', err)
  }
  return null
}

export function clearAdminCache() {
  cachedAdmin = null
}

export async function logAdminAction(
  action: string,
  entity_type?: string,
  entity_id?: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  details?: Record<string, any>
) {
  try {
    const admin = await getAdminInfo()
    if (!admin) return

    // Whitelist of action names known to pass the CHECK constraint on the
    // admin_activity_log table. Anything outside this list is mapped to
    // edit_booking + the real action goes into details._subaction.
    const ALLOWED = new Set([
      'login', 'create_booking', 'edit_booking', 'delete_booking',
      'cancel_booking', 'cancel_carwash', 'cancel_mechanical',
      'generate_contract', 'resend_contract', 'generate_fattura',
      'extend_booking', 'mark_paid', 'create_penalty', 'create_danni',
      'create_danni_penali', 'create_carwash', 'delete_carwash',
      'generate_carwash_fattura', 'create_mechanical', 'delete_mechanical',
      'generate_mechanical_fattura', 'edit_customer', 'delete_customer',
      'update_customer_status', 'delete_fattura', 'bulk_delete_fatture',
      'create_nota_di_credito', 'send_sdi', 'send_trustera_document',
      'delete_trustera_document', 'mark_extension_paid',
      'mark_booking_extensions_paid', 'mark_all_customer_paid',
      'mark_fattura_item_paid', 'mark_type_paid', 'partial_payment',
      'delete_extension', 'delete_unpaid_booking', 'cassa_cauzione',
      'limitation_override_approved',
    ])

    const safeAction = ALLOWED.has(action) ? action : 'edit_booking'
    const safeDetails = ALLOWED.has(action)
      ? (details || {})
      : { ...(details || {}), _subaction: action }

    const { error: insertError } = await supabase.from('admin_activity_log').insert({
      admin_id: admin.id,
      admin_email: admin.email,
      admin_name: admin.nome,
      action: safeAction,
      entity_type: entity_type || null,
      entity_id: entity_id || null,
      details: safeDetails,
    })
    if (insertError) console.error('[LOG] Insert failed:', insertError)
    else logger.log('[LOG] Insert OK:', action)
  } catch (err) {
    console.error('Failed to log admin action:', err)
  }
}
