// Modulo CONDIVISO (prefisso _ => non e' una function Netlify): logica di
// riconciliazione fatture ricariche Credit Wallet. Usato sia dalla cron
// schedulata (reconcile-wallet-fatture-cron) sia dall'endpoint HTTP manuale
// (reconcile-wallet-fatture-run-now). Tenere la logica QUI evita che il run-now
// importi un file con schedule() — cosa che Netlify classificherebbe come
// funzione schedulata (non invocabile via HTTP → "Bad request, missing form").
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const ADMIN_URL = process.env.URL || 'https://platform.dr7ai.com'
const WINDOW_DAYS = 14

export interface ReconcileResult {
  checked: number
  generated: number
  backfilled: number
  alreadyOk: number
  failed: number
  failures: Array<{ purchaseId: string; customer?: string; error: string }>
}

export async function reconcileWalletFatture(): Promise<ReconcileResult> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('missing supabase env (VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)')
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const sinceISO = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const result: ReconcileResult = { checked: 0, generated: 0, backfilled: 0, alreadyOk: 0, failed: 0, failures: [] }

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
    // Fattura gia' emessa per questa ricarica?
    const { data: fatt } = await supabase
      .from('fatture')
      .select('id, numero_fattura, pdf_url')
      .eq('note', `wallet_purchase:${p.id}`)
      .maybeSingle()

    // Gia' a posto: fattura esiste E PDF presente (quindi consegnata) -> salta.
    if (fatt && fatt.pdf_url) {
      result.alreadyOk++
      continue
    }

    // Manca la fattura, oppure esiste ma senza PDF (creata-non-consegnata):
    // generate-invoice-from-booking e' idempotente -> crea o fa il backfill
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
        console.log(`[Wallet Fattura Reconcile] OK ${p.id} (${p.customer_name || p.customer_email}) -> ${j.invoice?.numero_fattura || 'OK'} (${fatt ? 'backfill' : 'nuova'})`)
      } else {
        result.failed++
        const err = j?.error || j?.message || `HTTP ${res.status}`
        result.failures.push({ purchaseId: p.id, customer: p.customer_name, error: String(err) })
        console.error(`[Wallet Fattura Reconcile] FAIL ${p.id}: ${err}`)
      }
    } catch (e) {
      result.failed++
      const msg = e instanceof Error ? e.message : String(e)
      result.failures.push({ purchaseId: p.id, customer: p.customer_name, error: msg })
      console.error(`[Wallet Fattura Reconcile] FAIL ${p.id}: ${msg}`)
    }
  }

  return result
}
