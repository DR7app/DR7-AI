/**
 * Copia di cortesia del contratto nella lingua del firmatario (background,
 * fino a 15 minuti: la traduzione di 4 pagine dura piu' di una function normale).
 *
 * POST { contractId, destinatari: [{ phone, name }], prova? } — la chiama
 * signature-init subito dopo il link di firma, solo per i firmatari con un
 * prefisso non italiano. Risponde 202 subito.
 *
 * Il cliente firma sempre il contratto italiano: questa copia porta in testa e
 * in ogni pagina "fa fede esclusivamente il testo in lingua italiana".
 * Stesso contratto (stesso PDF) e stessa lingua = la traduzione gia' fatta si
 * riusa dallo storage, Claude non viene richiamato.
 */
import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import { requireAuth } from './require-auth'
import { funzioneFerma } from './utils/systemControl'
import { langFromPhone, nellaLinguaDelTelefono } from './utils/i18n'
import { traduciContratto, impaginaCopiaCortesia } from './utils/contrattoCortesia'
import { classificaRispostaGreenApi, classificaEccezioneGreenApi, leggiCorpo, rigaLogWhatsapp, type EsitoGreenApi } from './utils/esitoGreenApi'

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const GREEN_API_INSTANCE_ID = process.env.GREEN_API_INSTANCE_ID
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN

type Destinatario = { phone: string; name?: string }

function cleanPhone(phone: string): string {
    let p = String(phone || '').replace(/\D/g, '')
    if (p.startsWith('00')) p = p.substring(2)
    if (p.length === 10) p = '39' + p
    return p
}

export const handler: Handler = async (event) => {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: '' }
    const { error: authErr } = await requireAuth(event)
    if (authErr) return authErr

    const body = (() => { try { return JSON.parse(event.body || '{}') } catch { return {} } })() as { contractId?: string; destinatari?: Destinatario[]; prova?: boolean }
    // prova: si prepara e si salva la copia senza mandarla (verifica della traduzione)
    const prova = body.prova === true
    const contractId = String(body.contractId || '').trim()
    const destinatari = (Array.isArray(body.destinatari) ? body.destinatari : [])
        .map(d => ({ phone: cleanPhone(d?.phone || ''), name: d?.name || '' }))
        .filter(d => d.phone && langFromPhone(d.phone, 'en') !== 'it')
    if (!contractId || destinatari.length === 0) return { statusCode: 400, body: '' }
    if (!GREEN_API_INSTANCE_ID || !GREEN_API_TOKEN || !supabaseUrl || !supabaseServiceKey) return { statusCode: 500, body: '' }

    const fermaWa = await funzioneFerma('invio_whatsapp')
    if (fermaWa) { console.warn('[contratto-cortesia] invio saltato: ' + fermaWa); return { statusCode: 200, body: '' } }

    const sb = createClient(supabaseUrl, supabaseServiceKey, { auth: { autoRefreshToken: false, persistSession: false } })
    const { data: contratto } = await sb.from('contracts').select('id, pdf_url, contract_number').eq('id', contractId).maybeSingle()
    if (!contratto?.pdf_url) { console.error('[contratto-cortesia] contratto senza PDF:', contractId); return { statusCode: 404, body: '' } }

    const r = await fetch(contratto.pdf_url)
    if (!r.ok) { console.error('[contratto-cortesia] PDF non scaricabile:', r.status); return { statusCode: 502, body: '' } }
    const pdf = new Uint8Array(await r.arrayBuffer())
    const impronta = crypto.createHash('sha256').update(pdf).digest('hex').slice(0, 16)
    const numero = String(contratto.contract_number || '')

    const urlPerLingua = new Map<string, string>()
    for (const d of destinatari) {
        const lang = langFromPhone(d.phone, 'en')
        try {
            let url = urlPerLingua.get(lang)
            if (!url) {
                const percorso = `cortesia/${contractId}_${impronta}_${lang}.pdf`
                const pubblico = sb.storage.from('contracts').getPublicUrl(percorso).data.publicUrl
                const esiste = await fetch(pubblico, { method: 'HEAD' }).then(x => x.ok).catch(() => false)
                if (!esiste) {
                    const traduzione = await traduciContratto(pdf, lang)
                    const copia = await impaginaCopiaCortesia(traduzione, numero)
                    const { error } = await sb.storage.from('contracts').upload(percorso, copia, { contentType: 'application/pdf', upsert: true })
                    if (error) throw new Error('Upload copia di cortesia: ' + error.message)
                    console.log(`[contratto-cortesia] ${numero} tradotto in ${lang} con ${traduzione.modello}`)
                }
                url = pubblico
                urlPerLingua.set(lang, url)
            }

            if (prova) { console.log(`[contratto-cortesia] prova: ${url}`); continue }

            const caption = await nellaLinguaDelTelefono(d.phone,
                `Copia di cortesia del contratto ${numero} nella tua lingua, solo per informazione. Il contratto da firmare e' quello in italiano che hai ricevuto con il link: fa fede esclusivamente il testo in lingua italiana.`)
            let esito: EsitoGreenApi
            try {
                const wa = await fetch(`https://api.green-api.com/waInstance${GREEN_API_INSTANCE_ID}/sendFileByUrl/${GREEN_API_TOKEN}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chatId: `${d.phone}@c.us`, urlFile: url, fileName: `${numero || 'contratto'}_${lang}.pdf`, caption }),
                })
                esito = classificaRispostaGreenApi(wa.status, leggiCorpo(await wa.text()))
            } catch (e) {
                esito = classificaEccezioneGreenApi(e)
            }
            await sb.from('sent_messages_log').insert(rigaLogWhatsapp({
                nome: d.name, telefono: d.phone, testo: `${caption}\n\n${url}`, etichetta: 'Contratto copia di cortesia', esito,
            }))
        } catch (e) {
            // La copia di cortesia non e' mai bloccante: il link di firma e'
            // gia' partito. Si registra e si va avanti.
            console.error(`[contratto-cortesia] ${numero} ${lang} non inviata:`, (e as Error).message)
        }
    }
    return { statusCode: 200, body: '' }
}
