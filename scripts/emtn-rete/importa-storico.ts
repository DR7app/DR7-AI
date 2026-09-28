/**
 * EMTN — carica lo storico DR7 nella rete di una copia venduta.
 *
 * Legge danni, penali (anche solo in fattura) e importi da saldare dal
 * database SORGENTE (DR7) con la stessa regola della tab EMTN, li rende
 * anonimi (niente nomi, contatti, targhe, veicoli, prenotazioni, operatore;
 * codice fiscale solo come impronta HMAC con la chiave della copia) e li
 * scrive in emtn_storico_rete del database DESTINAZIONE.
 *
 * Nella copia: la lista clienti mostra solo i clienti dell'acquirente; queste
 * righe si vedono solo digitando un codice fiscale.
 *
 * Variabili:
 *   SORGENTE_SUPABASE_URL, SORGENTE_SUPABASE_KEY         database DR7 (service role)
 *   DESTINAZIONE_SUPABASE_URL, DESTINAZIONE_SUPABASE_KEY database della copia (service role)
 *   EMTN_RETE_CHIAVE                                      chiave della copia (la stessa va
 *                                                         nelle variabili Netlify della copia)
 * Opzioni:
 *   --prova          calcola e conta, non scrive niente (la destinazione non serve)
 *   --dal=AAAA-MM-GG solo eventi da quella data (contratti con la clausola rete)
 *
 * Uso:  npm run emtn:rete -- --prova
 *       npm run emtn:rete -- --dal=2026-10-01
 * Ogni esecuzione SOSTITUISCE lo storico gia' caricato nella copia.
 */
import { createClient } from '@supabase/supabase-js'
import { raccogliClientiConDanni } from '../../netlify/functions/utils/emtnClientiDanni'
import { righeStoricoRete } from '../../netlify/functions/utils/emtnRete'

const args = process.argv.slice(2)
const prova = args.includes('--prova')
const dal = (args.find(a => a.startsWith('--dal=')) || '').slice(6) || null
if (dal && !/^\d{4}-\d{2}-\d{2}$/.test(dal)) throw new Error('--dal deve essere AAAA-MM-GG')

function env(nome: string): string {
    const v = process.env[nome]
    if (!v) throw new Error(`Variabile mancante: ${nome}`)
    return v
}

async function main() {
    const sorgenteUrl = env('SORGENTE_SUPABASE_URL')
    const chiave = env('EMTN_RETE_CHIAVE')
    if (chiave.length < 32) throw new Error('EMTN_RETE_CHIAVE troppo corta: almeno 32 caratteri casuali')
    const sorgente = createClient(sorgenteUrl, env('SORGENTE_SUPABASE_KEY'), { auth: { persistSession: false } })

    const clients = await raccogliClientiConDanni(sorgente)
    const lotto = new Date().toISOString()
    const righe = righeStoricoRete(clients, chiave, lotto, dal)
    const conCf = clients.filter(c => c.codice_fiscale).length
    const persone = new Set(righe.map(r => r.cf_impronta)).size
    console.log(`Clienti con eventi: ${clients.length} (con codice fiscale: ${conCf}, senza: ${clients.length - conCf})`)
    console.log(`Righe per la rete: ${righe.length} su ${persone} persone${dal ? ` (dal ${dal})` : ''}`)
    const perTipo = righe.reduce<Record<string, number>>((m, r) => { m[r.tipo] = (m[r.tipo] || 0) + 1; return m }, {})
    console.log('Per tipo:', perTipo)

    if (prova) { console.log('Modalita\' prova: nessuna scrittura.'); return }

    const destUrl = env('DESTINAZIONE_SUPABASE_URL')
    if (destUrl.replace(/\/+$/, '') === sorgenteUrl.replace(/\/+$/, '')) {
        throw new Error('Sorgente e destinazione sono lo stesso database: lo storico della rete va nella COPIA, non in DR7.')
    }
    const dest = createClient(destUrl, env('DESTINAZIONE_SUPABASE_KEY'), { auth: { persistSession: false } })

    // Sostituzione: prima le righe nuove, poi via i lotti vecchi. Se l'inserimento
    // si ferma a meta' la copia tiene lo storico precedente.
    for (let i = 0; i < righe.length; i += 500) {
        const { error } = await dest.from('emtn_storico_rete').insert(righe.slice(i, i + 500))
        if (error) {
            await dest.from('emtn_storico_rete').delete().eq('lotto', lotto)
            throw new Error(`Inserimento fallito (niente cambiato nella copia): ${error.message}`)
        }
    }
    const { error: delErr, count } = await dest.from('emtn_storico_rete').delete({ count: 'exact' }).neq('lotto', lotto)
    if (delErr) throw new Error(`Righe nuove caricate ma lotti vecchi non rimossi: ${delErr.message}`)
    console.log(`Caricate ${righe.length} righe (lotto ${lotto}); rimosse ${count ?? 0} righe dei lotti precedenti.`)
}

main().catch(err => { console.error(String(err?.message || err)); process.exit(1) })
