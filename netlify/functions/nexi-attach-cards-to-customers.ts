/**
 * Porta OGNI carta tokenizzata del tab Nexi dentro la scheda cliente.
 *
 * Problema (caso Chiara Loy, 27/08/2026): il tab Nexi elenca le carte da DUE
 * sorgenti — customers_extended.metadata (carte gia' in anagrafica) e
 * nexi_transactions.contract_id (carte tokenizzate al pagamento). Quando il
 * callback non riesce ad abbinare il cliente (email con maiuscole diverse,
 * due schede con la stessa email -> maybeSingle() va in errore, scheda creata
 * dopo il pagamento) la carta resta SOLO nel tab Nexi: la scheda cliente dice
 * "Non tokenizzata" e la direzione non puo' addebitare ne' partire senza
 * cauzione.
 *
 * Questa funzione chiude il buco: per ogni contract_id delle transazioni
 * riuscite che non e' su nessuna scheda, trova la scheda giusta e ci scrive
 * la carta (array metadata.nexi_cards, MAI sovrascrivendo la predefinita).
 *
 * Abbinamento — nell'ordine, e solo su identificatori univoci:
 *   1. booking_details.customer.customerId / id  (id o user_id della scheda)
 *   2. email della transazione o della prenotazione (case-insensitive)
 *   3. nessun match -> con createMissing crea una scheda nuova
 * MAI per telefono o per nome: due lead possono condividere numero e cognome
 * (regola anagrafica roadmap #19) e attaccare la carta alla lead sbagliata
 * significherebbe addebitare la persona sbagliata.
 *
 * Body: { dryRun?: boolean, createMissing?: boolean, contractId?: string }
 *   - dryRun=true (default): riporta cosa farebbe, nessuna scrittura
 *   - createMissing=true: crea la scheda quando non esiste (serve email o nome)
 *   - contractId: limita l'operazione a una sola carta
 */
import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from './require-auth'
import { getCorsOrigin } from './cors-headers'
import { applyTokenizedCardUpdate, listCards } from './utils/nexiCards'

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

// Stessi stati "riuscito" usati da nexi-list-tokenized-cards: cosi' cio' che
// si vede nel tab e' esattamente cio' che questa funzione porta in anagrafica.
const SUCCESS_STATUSES = ['completed', 'paid', 'authorized', 'captured', 'succeeded']
const PAGE_SIZE = 1000

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>

/**
 * PostgREST tronca a 1000 righe per richiesta: senza paginazione le schede
 * (o le transazioni) oltre la millesima risulterebbero "senza carta" e la
 * funzione creerebbe doppioni.
 */
async function fetchAll(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    build: (from: number, to: number) => any,
): Promise<Row[]> {
    const out: Row[] = []
    for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await build(from, from + PAGE_SIZE - 1)
        if (error) throw new Error(error.message)
        const page = (data || []) as Row[]
        out.push(...page)
        if (page.length < PAGE_SIZE) break
    }
    return out
}

const normEmail = (v: unknown): string => String(v || '').trim().toLowerCase()

function displayName(row: Row): string {
    if (row.tipo_cliente === 'azienda') return String(row.denominazione || row.ragione_sociale || '')
    return [row.nome, row.cognome].filter(Boolean).join(' ').trim() || String(row.ragione_sociale || '')
}

/** Dati carta salvati sulla transazione (chiavi nexi_* o quelle brevi). */
function cardFieldsFromTx(txMeta: Row): Row {
    return {
        nexi_card_masked_pan: txMeta.nexi_card_masked_pan || txMeta.masked_pan || txMeta.payment_instrument || '',
        nexi_card_circuit: txMeta.nexi_card_circuit || txMeta.circuit || txMeta.payment_circuit || '',
        nexi_card_type: txMeta.nexi_card_type || txMeta.card_type || '',
        nexi_card_brand: txMeta.nexi_card_brand || txMeta.card_brand || '',
        nexi_card_bin: txMeta.nexi_card_bin || txMeta.bin || '',
    }
}

const handler: Handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': getCorsOrigin(event.headers.origin),
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json',
    }
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' }
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }

    const { error: authErr } = await requireAuth(event)
    if (authErr) return authErr

    if (!supabaseUrl || !supabaseServiceKey) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Missing Supabase config' }) }
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { dryRun = true, createMissing = false, contractId: onlyContractId = '' } =
        JSON.parse(event.body || '{}') as { dryRun?: boolean; createMissing?: boolean; contractId?: string }

    try {
        // ── 1. Tutte le schede cliente, con le carte gia' presenti ──────────
        const customers = await fetchAll((from, to) => supabase
            .from('customers_extended')
            .select('id, user_id, nome, cognome, ragione_sociale, denominazione, tipo_cliente, email, telefono, metadata, updated_at')
            .order('updated_at', { ascending: false })
            .range(from, to))

        const attached = new Set<string>()          // contractId gia' su una scheda
        const byId = new Map<string, Row>()
        const byUserId = new Map<string, Row>()
        const byEmail = new Map<string, Row>()
        // Copia di lavoro dei metadata: piu' carte possono finire sulla stessa
        // scheda nello stesso giro, e ogni applyTokenizedCardUpdate deve
        // partire dal risultato del precedente (altrimenti l'ultima vince).
        const workingMeta = new Map<string, Row>()

        for (const c of customers) {
            for (const card of listCards(c.metadata)) attached.add(card.contractId)
            if (c.id) byId.set(String(c.id), c)
            if (c.user_id) byUserId.set(String(c.user_id), c)
            const em = normEmail(c.email)
            // customers ordinate per updated_at desc: la prima riga per una
            // email e' la scheda piu' recente, quella che l'admin sta usando.
            if (em && !byEmail.has(em)) byEmail.set(em, c)
        }

        // ── 2. Transazioni Nexi riuscite con un contract_id ─────────────────
        const txs = await fetchAll((from, to) => {
            let q = supabase
                .from('nexi_transactions')
                .select('id, order_id, contract_id, customer_email, booking_id, metadata, status, created_at, updated_at')
                .not('contract_id', 'is', null)
                .in('status', SUCCESS_STATUSES)
                .order('created_at', { ascending: false })
                .range(from, to)
            if (onlyContractId) q = q.eq('contract_id', onlyContractId)
            return q
        })

        // Una riga per carta: la transazione piu' recente porta i dati migliori.
        const newestTxByContract = new Map<string, Row>()
        for (const tx of txs) {
            const cid = String(tx.contract_id || '')
            if (!cid) continue
            if (!newestTxByContract.has(cid)) newestTxByContract.set(cid, tx)
        }

        const orphanTxs = [...newestTxByContract.entries()]
            .filter(([cid]) => !attached.has(cid))
            .map(([, tx]) => tx)

        // ── 3. Prenotazioni collegate agli orfani (nome/email/scheda) ───────
        const bookingIds = [...new Set(orphanTxs.map(t => t.booking_id).filter(Boolean).map(String))]
        const bookingById = new Map<string, Row>()
        for (let i = 0; i < bookingIds.length; i += 200) {
            const chunk = bookingIds.slice(i, i + 200)
            const { data } = await supabase
                .from('bookings')
                .select('id, customer_name, customer_email, customer_phone, booking_details')
                .in('id', chunk)
            for (const b of (data || []) as Row[]) bookingById.set(String(b.id), b)
        }

        // ── 4. Abbina (o crea) e scrivi ────────────────────────────────────
        const results: Array<{ contractId: string; customer: string; email: string; status: string; detail?: string }> = []
        let linked = 0
        let created = 0
        let unresolved = 0

        for (const tx of orphanTxs) {
            const cid = String(tx.contract_id)
            const txMeta = (tx.metadata || {}) as Row
            const booking = tx.booking_id ? bookingById.get(String(tx.booking_id)) : null
            const bd = (booking?.booking_details || {}) as Row
            const bdCustomer = (bd.customer || {}) as Row

            const email = normEmail(tx.customer_email || booking?.customer_email || bdCustomer.email)
            const name = String(
                txMeta.customer_name || booking?.customer_name
                || [bdCustomer.nome || bdCustomer.firstName, bdCustomer.cognome || bdCustomer.lastName].filter(Boolean).join(' ')
                || '',
            ).trim()
            const phone = String(booking?.customer_phone || bdCustomer.phone || bdCustomer.telefono || '').trim()

            // 1) id/user_id della scheda salvato nella prenotazione — unico
            //    abbinamento certo al 100%.
            const custIdFromBooking = String(bdCustomer.customerId || bdCustomer.id || bd.customer_id || '')
            let target: Row | null = (custIdFromBooking && (byId.get(custIdFromBooking) || byUserId.get(custIdFromBooking))) || null
            let how = target ? 'id prenotazione' : ''

            // 2) email (case-insensitive): l'unico altro campo univoco.
            if (!target && email && byEmail.has(email)) {
                target = byEmail.get(email)!
                how = 'email'
            }

            const cardFields = cardFieldsFromTx(txMeta)
            const flatUpdate = {
                nexi_contract_id: cid,
                nexi_contract_updated: new Date().toISOString(),
                ...cardFields,
            }
            const pan = String(cardFields.nexi_card_masked_pan || '')

            if (target) {
                const base = workingMeta.get(String(target.id)) || target.metadata || {}
                const nextMeta = applyTokenizedCardUpdate(base, flatUpdate, { makeDefault: false })
                if (!dryRun) {
                    const { error: upErr } = await supabase
                        .from('customers_extended')
                        .update({ metadata: nextMeta, updated_at: new Date().toISOString() })
                        .eq('id', target.id)
                    if (upErr) {
                        results.push({ contractId: cid, customer: displayName(target), email, status: 'errore', detail: upErr.message })
                        continue
                    }
                }
                workingMeta.set(String(target.id), nextMeta)
                attached.add(cid)
                linked++
                results.push({
                    contractId: cid,
                    customer: displayName(target) || email || '—',
                    email,
                    status: dryRun ? 'da_collegare' : 'collegata',
                    detail: `${pan || 'senza PAN'} → scheda esistente (${how})`,
                })
                continue
            }

            // 3) Nessuna scheda: si crea solo se abbiamo almeno email o nome,
            //    altrimenti nascerebbe una lead vuota impossibile da usare.
            if (!createMissing || (!email && !name)) {
                unresolved++
                results.push({
                    contractId: cid,
                    customer: name || '—',
                    email,
                    status: dryRun ? 'da_creare' : 'senza_scheda',
                    detail: `${pan || 'senza PAN'} — nessuna scheda con questa email`,
                })
                continue
            }

            const parts = name.split(/\s+/).filter(Boolean)
            const nuovaScheda: Row = {
                email: email || null,
                nome: parts.length > 1 ? parts.slice(0, -1).join(' ') : (parts[0] || ''),
                cognome: parts.length > 1 ? parts[parts.length - 1] : '',
                telefono: phone || null,
                tipo_cliente: 'persona_fisica',
                source: 'nexi',
                metadata: applyTokenizedCardUpdate({}, flatUpdate, { makeDefault: true }),
            }

            if (dryRun) {
                created++
                results.push({
                    contractId: cid, customer: name || email, email,
                    status: 'da_creare_scheda', detail: `${pan || 'senza PAN'} → nuova scheda cliente`,
                })
                continue
            }

            const { data: ins, error: insErr } = await supabase
                .from('customers_extended')
                .insert(nuovaScheda)
                .select('id, user_id, nome, cognome, tipo_cliente, email, telefono, metadata')
                .single()
            if (insErr || !ins) {
                unresolved++
                results.push({ contractId: cid, customer: name || email, email, status: 'errore', detail: insErr?.message || 'insert fallita' })
                continue
            }
            // La scheda appena creata entra negli indici: le carte successive
            // dello stesso cliente ci finiscono sopra invece di duplicarla.
            byId.set(String(ins.id), ins)
            if (email) byEmail.set(email, ins)
            workingMeta.set(String(ins.id), ins.metadata)
            attached.add(cid)
            created++
            results.push({
                contractId: cid, customer: name || email, email,
                status: 'scheda_creata', detail: `${pan || 'senza PAN'} → nuova scheda cliente`,
            })
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                ok: true,
                mode: dryRun ? 'dry_run' : 'apply',
                carte_transazioni: newestTxByContract.size,
                gia_in_scheda: newestTxByContract.size - orphanTxs.length,
                da_collegare: orphanTxs.length,
                collegate: dryRun ? 0 : linked,
                schede_create: dryRun ? 0 : created,
                da_creare: dryRun ? created : 0,
                senza_scheda: unresolved,
                results: results.slice(0, 300),
            }),
        }
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[nexi-attach-cards-to-customers] Error:', msg)
        return { statusCode: 500, headers, body: JSON.stringify({ error: msg }) }
    }
}

export { handler }
