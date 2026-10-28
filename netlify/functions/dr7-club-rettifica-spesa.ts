import { getCorsOrigin } from './cors-headers'
import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { hasApprovedOverride } from './utils/verifyOverride'
import { userIsStaff, userHasRole } from './utils/adminRoles'

// 28/10/2026 (direzione): rettifica manuale della spesa annua DR7 Club, cliente
// per cliente. Cambia il livello e la % di cashback, quindi e' denaro: serve
// l'OTP della direzione, verificato QUI. Chi ha il ruolo bypass-otp
// (direzione, sviluppo) procede senza codice; un dipendente senza codice
// valido riceve 403, qualunque cosa dica il browser.

const CODICE_OTP = 'dr7club.rettifica_spesa'

const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method Not Allowed' }

  const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const risposta = (statusCode: number, corpo: unknown) => ({ statusCode, headers, body: JSON.stringify(corpo) })

  try {
    const authHeader = event.headers['authorization']
    if (!authHeader?.startsWith('Bearer ')) return risposta(401, { error: 'Non autorizzato' })
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    if (authError || !user) return risposta(401, { error: 'Token non valido' })
    if (!(await userIsStaff(user.id, user.email))) {
      return risposta(403, { error: 'Riservato agli operatori del gestionale' })
    }

    const { action, user_id, importo, nota, overrideId, id } = JSON.parse(event.body || '{}')

    const autorizzato = async () =>
      (await userHasRole(user.email, 'bypass-otp'))
      || (await hasApprovedOverride(supabase, overrideId, CODICE_OTP))

    if (action === 'elenco') {
      if (!user_id) return risposta(400, { error: 'Cliente obbligatorio' })
      const { data, error } = await supabase
        .from('dr7_club_rettifiche_spesa')
        .select('id, importo, nota, creato_da, created_at')
        .eq('user_id', user_id)
        .order('created_at', { ascending: false })
      if (error) return risposta(500, { error: error.message })
      return risposta(200, { success: true, rettifiche: data || [] })
    }

    if (action === 'crea') {
      const valore = Math.round(Number(importo) * 100) / 100
      if (!user_id) return risposta(400, { error: 'Cliente senza account sito: la spesa DR7 Club e\' legata all\'account' })
      if (!Number.isFinite(valore) || valore === 0) return risposta(400, { error: 'Importo non valido' })
      if (!(await autorizzato())) return risposta(403, { error: 'Serve l\'autorizzazione OTP della direzione' })
      const { data, error } = await supabase
        .from('dr7_club_rettifiche_spesa')
        .insert({
          user_id,
          importo: valore,
          nota: String(nota || '').trim() || null,
          creato_da: user.email || null,
          override_id: typeof overrideId === 'string' ? overrideId : null,
        })
        .select('id, importo, nota, creato_da, created_at')
        .single()
      if (error) return risposta(500, { error: error.message })
      console.log(`[dr7-club-rettifica] ${user.email} rettifica ${valore} EUR su ${user_id}`)
      return risposta(200, { success: true, rettifica: data })
    }

    if (action === 'elimina') {
      if (!id) return risposta(400, { error: 'Rettifica obbligatoria' })
      if (!(await autorizzato())) return risposta(403, { error: 'Serve l\'autorizzazione OTP della direzione' })
      const { error } = await supabase.from('dr7_club_rettifiche_spesa').delete().eq('id', id)
      if (error) return risposta(500, { error: error.message })
      console.log(`[dr7-club-rettifica] ${user.email} elimina rettifica ${id}`)
      return risposta(200, { success: true })
    }

    return risposta(400, { error: 'Azione non valida' })
  } catch (err) {
    return risposta(500, { error: err instanceof Error ? err.message : String(err) })
  }
}

export { handler }
