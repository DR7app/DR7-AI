// System Control — FEATURE KILL SWITCH e MAINTENANCE MODE.
//
// Spegnere una funzione per una singola azienda, per un gruppo o (solo in
// emergenza) per tutti; oppure metterla in manutenzione con un messaggio
// professionale per gli utenti. Tutto tracciato, tutto reversibile: non si
// cancella nulla, si smette solo di eseguire.
import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { corsHeaders } from './cors-headers'
import { requireAuth } from './require-auth'
import { userHasRole } from './utils/adminRoles'
import { registraAzione, registraConfig, svuotaCacheFunzioni } from './utils/systemControl'

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

// Funzioni spegnibili. Chi aggiunge una funzione nuova la mette qui: e'
// l'elenco che il Super Admin vede nella tab.
//
// `copertura` dice la verita' su cosa ferma davvero l'interruttore:
//  - 'collegata'     : ogni punto che esegue l'azione controlla l'interruttore;
//  - 'parziale'      : alcuni punti si', altri no (`cosaFerma` dice quali);
//  - 'non_collegata' : nessun punto lo controlla ancora. Non si puo' spegnere:
//                      mostrerebbe SPENTA mentre tutto continua a girare.
// Chi collega un nuovo punto usa funzioneFerma() (utils/systemControl.ts) e
// aggiorna qui copertura e cosaFerma.
export type Copertura = 'collegata' | 'parziale' | 'non_collegata'
export const FUNZIONI_SPEGNIBILI: { chiave: string; etichetta: string; descrizione: string; critica: boolean; copertura: Copertura; cosaFerma: string }[] = [
  { chiave: 'prenotazioni_online',  etichetta: 'Prenotazioni dal sito',      descrizione: 'I clienti possono prenotare dal sito pubblico.', critica: true,
    copertura: 'collegata', cosaFerma: 'Le prenotazioni dei clienti dal sito (bloccate nel database, anche con credito wallet). Lo staff prenota sempre dal gestionale; una prenotazione gia pagata viene sempre registrata.' },
  { chiave: 'pagamenti_online',     etichetta: 'Pagamenti online',           descrizione: 'Link di pagamento e checkout Nexi.', critica: true,
    copertura: 'collegata', cosaFerma: 'Checkout Nexi del sito, link di pagamento, link di preautorizzazione cauzione e ricariche. Non ferma gli addebiti su carta salvata gia autorizzati dal cliente ne le conferme di pagamenti gia fatti.' },
  { chiave: 'fatturazione_elettronica', etichetta: 'Fatturazione elettronica', descrizione: 'Trasmissione delle fatture allo SDI.', critica: true,
    copertura: 'collegata', cosaFerma: 'Ogni trasmissione ad Aruba/SDI, manuale e automatica. Le fatture restano in bozza, nessun numero viene consumato.' },
  { chiave: 'invio_whatsapp',       etichetta: 'Invii WhatsApp',             descrizione: 'Tutti i messaggi WhatsApp automatici e manuali.', critica: false,
    copertura: 'collegata', cosaFerma: 'Ogni messaggio WhatsApp ai clienti e allo staff; i messaggi automatici restano in attesa e partono alla riaccensione. Esclusi i codici di sicurezza (OTP, codici wallet): senza, nessuno potrebbe accedere.' },
  { chiave: 'invio_email',          etichetta: 'Invii e-mail',               descrizione: 'Tutte le e-mail automatiche.', critica: false,
    copertura: 'collegata', cosaFerma: 'Ogni e-mail, dal gestionale e dal sito. Esclusi i codici di sicurezza, il recupero password e la verifica dell account.' },
  { chiave: 'firma_elettronica',    etichetta: 'Firma elettronica',          descrizione: 'Invio contratti alla firma.', critica: true,
    copertura: 'collegata', cosaFerma: 'Nuovi invii alla firma di contratti e documenti. Le firme gia inviate restano firmabili.' },
  { chiave: 'cargos',               etichetta: 'Invii CARGOS',               descrizione: 'Comunicazioni obbligatorie.', critica: true,
    copertura: 'collegata', cosaFerma: 'Invio automatico, recupero ogni 30 minuti e invio manuale dalla tab CARGOS.' },
  { chiave: 'campagne_marketing',   etichetta: 'Campagne marketing',         descrizione: 'Invii massivi programmati.', critica: false,
    copertura: 'collegata', cosaFerma: 'Campagne WhatsApp, promo automatiche (Maxi Promo, promo incassi), auguri di compleanno, richieste di recensione e DR7 Privilege.' },
  { chiave: 'messaggi_automatici',  etichetta: 'Messaggi di sistema',        descrizione: 'Promemoria e messaggi automatici pianificati.', critica: false,
    copertura: 'collegata', cosaFerma: 'Messaggi pianificati, promemoria a orario e messaggi legati a un evento (es. conferma di pagamento). Non ferma i codici di sicurezza.' },
  { chiave: 'auto_riparazione',     etichetta: 'Auto-riparazione',           descrizione: 'Il ciclo che ritenta da solo le operazioni fallite.', critica: false,
    copertura: 'collegata', cosaFerma: 'Il ciclo ogni 5 minuti e il controllo orario.' },
  { chiave: 'gestionale',           etichetta: 'Intero gestionale',          descrizione: 'Solo per manutenzione programmata: ferma tutte le funzioni qui sopra.', critica: true,
    copertura: 'collegata', cosaFerma: 'Ferma insieme tutte le funzioni di questo elenco (prenotazioni, pagamenti, invii, fatture, CARGOS, firma). Il gestionale resta consultabile dallo staff.' },
]

const handler: Handler = async (event) => {
  const headers = corsHeaders(event.headers.origin || event.headers.Origin)
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' }

  const { error: authErr, user } = await requireAuth(event)
  if (authErr) return authErr
  const email = (user?.email || '').toLowerCase()
  if (!(await userHasRole(email, 'direzione')) && !(await userHasRole(email, 'developer'))) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Solo direzione o developer.' }) }
  }

  if (event.httpMethod === 'GET') {
    const { data, error } = await supabase.from('sc_flags').select('*').order('chiave')
    if (error && (error.code === '42P01' || error.code === 'PGRST205')) {
      return { statusCode: 200, headers, body: JSON.stringify({ migrazioneEseguita: false, funzioni: FUNZIONI_SPEGNIBILI, flags: [] }) }
    }
    const { data: storico } = await supabase.from('sc_config_history')
      .select('*').order('created_at', { ascending: false }).limit(100)
    return {
      statusCode: 200, headers,
      body: JSON.stringify({ migrazioneEseguita: true, funzioni: FUNZIONI_SPEGNIBILI, flags: data || [], storico: storico || [] }),
    }
  }

  if (event.httpMethod === 'POST') {
    const body = JSON.parse(event.body || '{}') as {
      chiave?: string; business?: string; attiva?: boolean; manutenzione?: boolean
      messaggio?: string; motivo?: string; conferma?: boolean
    }
    if (!body.chiave) return { statusCode: 400, headers, body: JSON.stringify({ error: 'chiave obbligatoria' }) }
    const funzione = FUNZIONI_SPEGNIBILI.find(f => f.chiave === body.chiave)
    if (!funzione) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Funzione sconosciuta' }) }

    const business = body.business || '*'
    const spegnimento = body.attiva === false || body.manutenzione === true
    // Un interruttore che nessuna funzione legge non si spegne: il pannello
    // direbbe SPENTA mentre tutto continua. Riattivare resta sempre possibile.
    if (spegnimento && funzione.copertura === 'non_collegata') {
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ ok: false, messaggio: `«${funzione.etichetta}» non e ancora collegato: spegnerlo non fermerebbe nulla. ${funzione.cosaFerma}` }),
      }
    }
    // Spegnere una funzione critica per TUTTE le aziende esige la conferma
    // esplicita: e' l'unico modo per farlo per sbaglio, e non deve esistere.
    if (spegnimento && business === '*' && funzione.critica && !body.conferma) {
      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          ok: false, richiedeConferma: true,
          messaggio: `Stai per fermare «${funzione.etichetta}» per TUTTE le aziende. Conferma per procedere.`,
        }),
      }
    }

    const { data: prima } = await supabase.from('sc_flags')
      .select('*').eq('chiave', body.chiave).eq('business', business).maybeSingle()

    const riga = {
      chiave: body.chiave,
      business,
      attiva: body.attiva !== undefined ? body.attiva : (prima as { attiva?: boolean } | null)?.attiva ?? true,
      manutenzione: body.manutenzione !== undefined ? body.manutenzione : (prima as { manutenzione?: boolean } | null)?.manutenzione ?? false,
      messaggio: body.messaggio ?? (prima as { messaggio?: string } | null)?.messaggio ?? null,
      motivo: body.motivo || null,
      aggiornato_da: email,
      updated_at: new Date().toISOString(),
    }

    const { data: dopo, error } = await supabase.from('sc_flags')
      .upsert(riga, { onConflict: 'chiave,business' }).select('*').single()

    if (!error && dopo) {
      // Effetto immediato in questa istanza; le altre lo vedono entro 30 s.
      svuotaCacheFunzioni()
      await registraConfig({
        tabella: 'sc_flags', rigaId: String((dopo as { id: string }).id),
        etichetta: `${funzione.etichetta} — ${business === '*' ? 'tutte le aziende' : business}`,
        prima: prima || null, dopo, modificatoDa: email,
      })
    }

    const messaggio = riga.manutenzione
      ? `«${funzione.etichetta}» in manutenzione${business === '*' ? ' per tutte le aziende' : ` per ${business}`}.`
      : riga.attiva
        ? `«${funzione.etichetta}» riattivata${business === '*' ? '' : ` per ${business}`}.`
        : `«${funzione.etichetta}» spenta${business === '*' ? ' per tutte le aziende' : ` per ${business}`}. Nessun dato e stato cancellato.`

    await registraAzione({
      azione: riga.attiva && !riga.manutenzione ? 'riattiva_funzione' : 'disabilita_funzione',
      attoreEmail: email, bersaglioTipo: 'funzione', bersaglioId: body.chiave, business,
      parametri: { attiva: riga.attiva, manutenzione: riga.manutenzione, motivo: body.motivo || null },
      esito: error ? 'errore' : 'ok', messaggio: error?.message || messaggio,
    })

    if (error) return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) }
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, messaggio, flag: dopo }) }
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) }
}

export { handler }
