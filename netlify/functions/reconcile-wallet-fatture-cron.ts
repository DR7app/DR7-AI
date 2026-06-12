import { Handler, schedule } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

/**
 * BACKSTOP — garantisce la fattura per OGNI ricarica Credit Wallet.
 *
 * Problema risolto: la generazione fattura nella callback Nexi
 * (nexi-callback.js → generate-invoice-from-booking, ramo wallet_purchase)
 * è non-bloccante: se PDF/WhatsApp/SDI o la chiamata stessa falliscono in
 * modo transitorio, la ricarica risulta comunque "succeeded" ma SENZA fattura
 * e senza alcun alert (caso Massimo Runchina €1000, 2026-06-12).
 *
 * Questa cron, ogni 15 minuti, ripesca le ricariche pagate (succeeded) degli
 * ultimi WINDOW_DAYS giorni e, se manca la fattura O manca il PDF (creata ma
 * non consegnata), richiama generate-invoice-from-booking che è IDEMPOTENTE
 * (marker note `wallet_purchase:<id>`): crea la fattura se manca, altrimenti
 * ri-genera PDF + invia WhatsApp + invia a SDI. Riprova ad ogni giro finché
 * riesce → la fattura arriva SEMPRE, anche se il tentativo inline fallisce.
 *
 * WINDOW_DAYS=14 evita di emettere retroattivamente ricariche molto vecchie
 * (decisione fiscale/contabile): copre solo i fallimenti recenti.
 */
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const ADMIN_URL = process.env.URL || 'https://platform.dr7ai.com'
const WINDOW_DAYS = 14

interface CronResult {
  checked: number
  generated: number
  backfilled: number
  alreadyOk: number
  failed: number
  failures: Array<{ purchaseId: string; customer?: string; error: string }>
}

export async function reconcileWalletFatture(): Promise<CronResult> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('missing supabase env (VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)')
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const sinceISO = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const result: CronResult = { checked: 0, generated: 0, backfilled: 0, alreadyOk: 0, failed: 0, failures: [] }

  // Ricariche pagate recenti
  const { data: purchases, error } = await supabase
    .from('credit_wallet_purchases')
    .select('id, recharge_amount, customer_name, customer_email, created_at')
    .eq('payment_status', 'succeeded')
    .gte('created_at', sinceISO)
    .order('created_at', { ascending: false })
    .limit(500)
  if (error) throw error

  for (const p of purchases || []) {
    result.checked++
    // Fattura già emessa per questa ricarica?
    const { data: fatt } = await supabase
      .from('fatture')
      .select('id, numero_fattura, pdf_url')
      .eq('note', `wallet_purchase:${p.id}`)
      .maybeSingle()

    // Già a posto: fattura esiste E PDF presente (quindi consegnata) → salta.
    if (fatt && fatt.pdf_url) {
      result.alreadyOk++
      continue
    }

    // Manca la fattura, oppure esiste ma senza PDF (creata-non-consegnata):
    // generate-invoice-from-booking è idempotente → crea o fa il backfill
    // (PDF + WhatsApp + SDI).
    try {
      const res = await fetch(`${ADMIN_URL}/.netlify/functions/generate-invoice-from-booking`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purchaseType: 'wallet_purchase', purchaseId: p.id, includeIVA: true }),
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const j: any = await res.json().catch(() => ({}))
      if (res.ok && (j.success || j.backfilled || j.invoice)) {
        if (fatt) result.backfilled++
        else result.generated++
        console.log(`[Wallet Fattura Cron] OK ${p.id} (${p.customer_name || p.customer_email}) → ${j.invoice?.numero_fattura || 'OK'} (${fatt ? 'backfill' : 'nuova'})`)
      } else {
        result.failed++
        const err = j?.error || j?.message || `HTTP ${res.status}`
        result.failures.push({ purchaseId: p.id, customer: p.customer_name, error: String(err) })
        console.error(`[Wallet Fattura Cron] FAIL ${p.id}: ${err}`)
      }
    } catch (e) {
      result.failed++
      const msg = e instanceof Error ? e.message : String(e)
      result.failures.push({ purchaseId: p.id, customer: p.customer_name, error: msg })
      console.error(`[Wallet Fattura Cron] FAIL ${p.id}: ${msg}`)
    }
  }

  return result
}

const reconcileHandler: Handler = async () => {
  console.log('[Wallet Fattura Cron] start')
  try {
    const result = await reconcileWalletFatture()
    console.log('[Wallet Fattura Cron] done', JSON.stringify(result))
    return { statusCode: 200, body: JSON.stringify(result) }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[Wallet Fattura Cron] fatal', msg)
    return { statusCode: 500, body: JSON.stringify({ error: msg }) }
  }
}

// Ogni 15 minuti. Esposto anche come HTTP (/.netlify/functions/reconcile-wallet-fatture-cron)
// per esecuzione manuale immediata.
export const handler = schedule('*/15 * * * *', reconcileHandler)
