import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { corsHeaders } from './cors-headers'
import { requireAuth } from './require-auth'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export const handler: Handler = async (event) => {
  const headers = corsHeaders(event.headers.origin)

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' }
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: '{"error":"Method not allowed"}' }

  const { error: authErr } = await requireAuth(event)
  if (authErr) return authErr

  try {
    // Fetch all auth users with admin API
    const allUsers: any[] = []
    let page = 1
    const perPage = 1000

    while (true) {
      const { data: { users }, error } = await supabase.auth.admin.listUsers({
        page,
        perPage,
      })
      if (error) throw error
      if (!users || users.length === 0) break
      allUsers.push(...users.map(u => ({
        id: u.id,
        email: u.email,
        created_at: u.created_at,
        email_confirmed_at: u.email_confirmed_at,
        last_sign_in_at: u.last_sign_in_at,
        // 26/08/2026: i metadati auth servono come rete di sicurezza per il
        // nome (vedi sotto): chi si e' iscritto con Google, o la cui scheda
        // non e' stata scritta, il nome ce l'ha SOLO qui.
        meta: (u.user_metadata || {}) as Record<string, any>,
      })))
      if (users.length < perPage) break
      page++
    }

    // Get credit balances
    const { data: balances } = await supabase
      .from('user_credit_balance')
      .select('user_id, balance')

    const balanceMap = new Map<string, number>()
    if (balances) {
      for (const b of balances) {
        balanceMap.set(b.user_id, b.balance)
      }
    }

    // Get customer names from customers_extended.
    // 26/08/2026: PostgREST tronca a 1000 righe. Senza paginazione tutti gli
    // iscritti oltre i primi 1000 risultavano SENZA nome e cognome.
    const customers: any[] = []
    const CHUNK = 1000
    // Colonne opzionali: se una manca su questo database, PostgREST rifiuta
    // TUTTA la query e l'elenco resterebbe vuoto. Meglio perdere il nome del
    // rappresentante che perdere l'intera lista degli iscritti.
    const COLONNE_BASE = 'user_id, email, nome, cognome, telefono, denominazione, ragione_sociale, ente_ufficio'
    let colonne = `${COLONNE_BASE}, rappresentante_nome, rappresentante_cognome`
    for (let offset = 0; ; offset += CHUNK) {
      let { data: pageRows, error: custErr } = await supabase
        .from('customers_extended')
        .select(colonne)
        .order('id', { ascending: true })
        .range(offset, offset + CHUNK - 1)
      if (custErr && colonne !== COLONNE_BASE) {
        console.warn('[list-site-users] colonne rappresentante assenti, ripiego:', custErr.message)
        colonne = COLONNE_BASE
        const retry = await supabase
          .from('customers_extended')
          .select(colonne)
          .order('id', { ascending: true })
          .range(offset, offset + CHUNK - 1)
        pageRows = retry.data
        custErr = retry.error
      }
      if (custErr) throw custErr
      if (!pageRows || pageRows.length === 0) break
      customers.push(...pageRows)
      if (pageRows.length < CHUNK) break
    }

    // Indice per user_id e, come riserva, per email normalizzata: le schede
    // create prima del collegamento all'account hanno user_id NULL.
    const custMap = new Map<string, any>()
    const custByEmail = new Map<string, any>()
    for (const c of customers) {
      if (c.user_id) custMap.set(c.user_id, c)
      const em = (c.email || '').trim().toLowerCase()
      if (em && !custByEmail.has(em)) custByEmail.set(em, c)
    }

    // Nome preso dai metadati auth quando la scheda non ce l'ha:
    // nome/cognome espliciti, altrimenti full_name/fullName/name spezzato.
    const daMetadati = (meta: Record<string, any>) => {
      const nome = (meta.nome || meta.first_name || meta.given_name || '').trim()
      const cognome = (meta.cognome || meta.last_name || meta.family_name || '').trim()
      if (nome || cognome) return { nome, cognome }
      const intero = String(meta.full_name || meta.fullName || meta.name || '').trim()
      if (!intero) return { nome: '', cognome: '' }
      const parti = intero.split(/\s+/)
      return { nome: parti[0], cognome: parti.slice(1).join(' ') }
    }

    const enriched = allUsers.map(u => {
      const email = (u.email || '').trim().toLowerCase()
      const c = custMap.get(u.id) || (email ? custByEmail.get(email) : null)
      let nome = (c?.nome || '').trim()
      let cognome = (c?.cognome || '').trim()
      if (!nome && !cognome) {
        const m = daMetadati(u.meta || {})
        nome = m.nome
        cognome = m.cognome
      }
      // Azienda registrata dal sito: la persona e' il rappresentante legale.
      if (!nome && !cognome) {
        nome = (c?.rappresentante_nome || u.meta?.rappresentanteNome || '').trim()
        cognome = (c?.rappresentante_cognome || u.meta?.rappresentanteCognome || '').trim()
      }
      // Azienda / Pubblica Amministrazione: nome e cognome sono vuoti per
      // costruzione, il nome vero e' la ragione sociale o l'ente.
      // `company_name` e' la chiave scritta dall'iscrizione rapida del sito
      // (AuthContext.signup): senza, le aziende arrivate da li' restavano
      // senza nessun nome visibile.
      const azienda = (c?.denominazione || c?.ragione_sociale || c?.ente_ufficio
        || u.meta?.denominazione || u.meta?.enteUfficio || u.meta?.company_name
        || u.meta?.ragione_sociale || '').trim()

      return {
        id: u.id,
        email: u.email,
        created_at: u.created_at,
        email_confirmed_at: u.email_confirmed_at,
        last_sign_in_at: u.last_sign_in_at,
        balance: balanceMap.get(u.id) || 0,
        nome,
        cognome,
        azienda,
        telefono: (c?.telefono || u.meta?.telefono || u.meta?.phone || '').trim(),
      }
    })

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, users: enriched, total: enriched.length }),
    }
  } catch (err: any) {
    console.error('[list-site-users] Error:', err)
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) }
  }
}
