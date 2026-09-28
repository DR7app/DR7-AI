// CARGOS — i campi "luogo" del record (nascita, cittadinanza, residenza,
// rilascio documento e patente, secondo guidatore), calcolati in UN solo
// posto per l'invio manuale (CargosTab) e quello automatico
// (cargos-auto-send). Prima ognuno aveva la sua copia, con gli stessi errori.
//
// 26/09/2026 — oltre alla tabella ufficiale, corretti i campi letti:
//  - residenza: citta_residenza (la colonna del form), non `citta` che e' dei
//    soli enti pubblici: il campo 27 partiva sempre vuoto;
//  - cittadinanza: nazionalita, poi nazione (il form scrive `nazione`);
//  - rilascio documento / patente: la colonna vera se c'e', altrimenti il
//    comune di residenza (com'era gia' l'intenzione).
import { RisolutoreLuoghi, dataDaTesto, spiegaLuogo, type OpzioniLuogo } from './luoghiCargos'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Dati = Record<string, any> | null | undefined

export interface LuoghiRecordCargos {
  nascita: string          // campo 25
  cittadinanza: string     // campo 26
  residenza: string        // campo 27
  indirizzo: string        // campo 28 (testo)
  rilascioDocumento: string // campo 31
  rilascioPatente: string  // campo 33
  nascita2: string         // campo 38
  cittadinanza2: string    // campo 39
  patente2: string         // campo 44
  /** Bloccanti: la riga non deve partire. */
  errori: string[]
  /** Da sistemare, ma non bloccano (erano gia' vuoti prima). */
  avvisi: string[]
}

function testo(...v: unknown[]): string {
  for (const x of v) {
    const s = String(x ?? '').trim()
    if (s) return s
  }
  return ''
}

function sorgenti(c: Dati, bd: Dati) {
  const meta = c?.metadata || {}
  const rapp = meta?.rappresentante || {}
  const d2 = bd?.second_driver || bd?.secondDriver || null
  return {
    rapp, d2,
    azienda: c?.tipo_cliente === 'azienda',
    nascita: testo(c?.luogo_nascita, rapp.luogo_nascita, bd?.customer?.birthPlace),
    provNascita: testo(c?.provincia_nascita),
    dataNascita: testo(c?.data_nascita, rapp.data_nascita, bd?.customer?.birthDate),
    cittadinanza: testo(c?.nazionalita, c?.nazione),
    residenza: testo(c?.citta_residenza, c?.citta),
    provResidenza: testo(c?.provincia_residenza, c?.provincia),
    rilascioDoc: testo(rapp.documento?.luogo, c?.luogo_rilascio_documento),
    rilascioPatente: testo(c?.patente_rilasciata_da),
  }
}

/** Tutti i testi da precaricare nel risolutore per questo cliente. */
export function testiLuoghiCliente(c: Dati, bd: Dati): string[] {
  const s = sorgenti(c, bd)
  return [s.nascita, s.cittadinanza, s.residenza, s.rilascioDoc, s.rilascioPatente,
    s.d2?.luogo_nascita, s.d2?.birthPlace, s.d2?.nazionalita].filter(Boolean) as string[]
}

/** Il codice fiscale italiano di chi e' nato in Italia non ha la Z (estero) al 12° carattere. */
function nascitaItalianaDaCF(cf: unknown): boolean {
  const s = String(cf || '').trim().toUpperCase()
  return /^[A-Z]{6}\d{2}[A-Z]\d{2}[A-Y]\d{3}[A-Z]$/.test(s)
}

export function luoghiRecordCargos(r: RisolutoreLuoghi, c: Dati, bd: Dati): LuoghiRecordCargos {
  const s = sorgenti(c, bd)
  const errori: string[] = []
  const avvisi: string[] = []
  const personaFisica = !s.azienda

  const risolvi = (campo: string, t: string, opts: OpzioniLuogo, bloccante: boolean): string => {
    if (!t) return ''
    const e = r.risolvi(t, opts)
    if (e.esito === 'trovato') return e.codice
    const msg = spiegaLuogo(campo, t, e)
    if (msg) (bloccante ? errori : avvisi).push(msg)
    return ''
  }

  // 25 — luogo di nascita: identita' della persona, bloccante (regola 2026-08-20).
  let nascita = ''
  if (!s.nascita) {
    if (personaFisica) errori.push('Luogo di nascita mancante')
  } else {
    nascita = risolvi('Luogo di nascita', s.nascita, { provincia: s.provNascita, alla: dataDaTesto(s.dataNascita) }, personaFisica)
  }

  // 26 — cittadinanza. Se non e' scritta: italiana solo quando il codice
  // fiscale o il luogo di nascita lo dicono (prima era ITALIA per tutti,
  // anche per chi e' nato all'estero). Nato all'estero senza cittadinanza =
  // blocco: non si dichiara italiano chi forse non lo e'.
  let cittadinanza = ''
  if (s.cittadinanza) {
    cittadinanza = risolvi('Cittadinanza', s.cittadinanza, { soloStati: true }, personaFisica)
  } else {
    const nascitaEsito = s.nascita ? r.risolvi(s.nascita, { provincia: s.provNascita, alla: dataDaTesto(s.dataNascita) }) : null
    const natoInItalia = nascitaEsito?.esito === 'trovato' && nascitaEsito.provincia !== 'ES'
    const cf = String(c?.codice_fiscale || '').trim()
    if (!personaFisica || nascitaItalianaDaCF(cf) || (natoInItalia && !/^[A-Z]{6}\d{2}[A-Z]\d{2}Z/i.test(cf))) {
      cittadinanza = r.codice('ITALIA', { soloStati: true })
    } else {
      errori.push('Cittadinanza mancante')
    }
  }

  // 27/28 — residenza: prima partiva sempre vuota; resta non bloccante.
  const residenza = risolvi('Comune di residenza', s.residenza, { provincia: s.provResidenza }, false)
  const indirizzo = `${testo(c?.indirizzo)} ${s.residenza} ${s.provResidenza}`.replace(/\s+/g, ' ').trim()

  // 31/33 — rilascio documento e patente: la colonna vera se riconosciuta,
  // altrimenti il comune di residenza. `patente_rilasciata_da` spesso contiene
  // l'ente ("MIT-UCO"), non un luogo: in quel caso si ripiega senza avvisi.
  const luogoOResidenza = (t: string): string => {
    if (!t) return residenza
    const e = r.risolvi(t, {})
    return e.esito === 'trovato' ? e.codice : residenza
  }
  const rilascioDocumento = luogoOResidenza(s.rilascioDoc)
  const rilascioPatente = luogoOResidenza(s.rilascioPatente)

  // 38/39/44 — secondo guidatore: facoltativo, mai bloccante.
  const d2 = s.d2
  const alla2 = dataDaTesto(testo(d2?.data_nascita, d2?.birthDate))
  const nascita2 = d2 ? risolvi('Luogo di nascita 2° guidatore', testo(d2.luogo_nascita, d2.birthPlace), { alla: alla2 }, false) : ''
  const cittadinanza2 = d2 ? risolvi('Cittadinanza 2° guidatore', testo(d2.nazionalita), { soloStati: true }, false) : ''
  const patente2 = d2 ? r.codice(testo(d2.luogo_nascita), { alla: alla2 }) : ''

  return { nascita, cittadinanza, residenza, indirizzo, rilascioDocumento, rilascioPatente, nascita2, cittadinanza2, patente2, errori, avvisi }
}
