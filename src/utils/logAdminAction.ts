import { supabase } from '../supabaseClient'

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
  details?: Record<string, any>
) {
  try {
    const admin = await getAdminInfo()
    if (!admin) return

    await supabase.from('admin_activity_log').insert({
      admin_id: admin.id,
      admin_email: admin.email,
      admin_name: admin.nome,
      action,
      entity_type: entity_type || null,
      entity_id: entity_id || null,
      details: details || {},
    })
  } catch (err) {
    console.error('Failed to log admin action:', err)
  }
}
