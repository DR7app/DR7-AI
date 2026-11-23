import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react'
import { ScheletroTesto } from '../../../components/Scheletro'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import ElencoTelefoniConPrefisso from '../../../components/ElencoTelefoniConPrefisso'

/**
 * Scadenza cauzione — Centralina Pro > Cauzioni (24/08/2026).
 *
 * Fino a oggi il termine di restituzione era scritto in due posti che non
 * andavano d'accordo: il trigger DB sommava giorni di CALENDARIO presi da
 * `cauzioni_config`, il codice Netlify imponeva 14 giorni LAVORATIVI scritti in
 * duro. Vinceva chi scriveva per ultimo. Ora la riga singleton
 * `cauzioni_config` e' l'unica fonte e questo pannello e' l'unico posto dove si
 * cambia: la usano sia il trigger sia `sync-booking-cauzione`.
 *
 * Le colonne `giorni_restituzione_terra/mare/altro` esistono nella tabella ma
 * NON sono esposte qui: la tabella `cauzioni` non ha una colonna business su
 * cui applicarle, quindi sarebbero manopole senza effetto.
 */

const FESTIVI_IT = new Set<string>([
  '2025-01-01', '2025-01-06', '2025-04-20', '2025-04-21', '2025-04-25',
  '2025-05-01', '2025-06-02', '2025-08-15', '2025-11-01', '2025-12-08',
  '2025-12-25', '2025-12-26',
  '2026-01-01', '2026-01-06', '2026-04-05', '2026-04-06', '2026-04-25',
  '2026-05-01', '2026-06-02', '2026-08-15', '2026-11-01', '2026-12-08',
  '2026-12-25', '2026-12-26',
  '2027-01-01', '2027-01-06', '2027-03-28', '2027-03-29', '2027-04-25',
  '2027-05-01', '2027-06-02', '2027-08-15', '2027-11-01', '2027-12-08',
  '2027-12-25', '2027-12-26',
])

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function isNonLavorativo(d: Date): boolean {
  const dow = d.getDay()
  return dow === 0 || dow === 6 || FESTIVI_IT.has(ymd(d))
}

/** Stessa formula del trigger DB e di netlify/functions/utils/giorniLavorativi. */
function calcolaScadenza(da: Date, giorni: number, modalita: 'lavorativi' | 'calendario'): Date {
  const cur = new Date(da.getFullYear(), da.getMonth(), da.getDate())
  if (modalita === 'calendario') {
    cur.setDate(cur.getDate() + giorni)
    return cur
  }
  cur.setDate(cur.getDate() + 1)
  while (isNonLavorativo(cur)) cur.setDate(cur.getDate() + 1)
  let contati = 1
  while (contati < giorni) {
    cur.setDate(cur.getDate() + 1)
    if (!isNonLavorativo(cur)) contati++
  }
  return cur
}

const DATA_IT = (d: Date) => d.toLocaleDateString('it-IT', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })

/** Valori del pannello cosi' come stanno nel database (per capire cosa e' cambiato). */
type Salvato = {
  giorni: number | ''
  modalita: 'lavorativi' | 'calendario'
  orarioInvio: number | ''
  avvisoModalita: 'automatico' | 'manuale'
  avvisoOffsets: number[]
  avvisoWhatsapp: string
  avvisoEmail: string
}

/**
 * Comandi esposti a Centralina Pro: il pulsante Salva della barra in basso
 * salva anche questo pannello (22/11/2026). Prima lo salvava SOLO il piccolo
 * "Salva" in cima al pannello: chi cambiava numeri o email dell'avviso e
 * premeva il Salva in basso vedeva "Modifiche salvate" ma al ricarico
 * ritrovava i valori vecchi (la barra scrive centralina_pro_config, questo
 * pannello scrive cauzioni_config).
 */
export type CauzioneScadenzaHandle = {
  save: () => Promise<boolean>
  reload: () => void
}

type Props = {
  readOnly?: boolean
  /** Elenco leggibile delle modifiche non salvate, per la barra in basso. */
  onChangesChange?: (changes: string[]) => void
}

const ordina = (a: number[]) => [...a].sort((x, y) => x - y).join(',')
const normTesto = (v: string) => v.split(/[\n,;]+/).map(x => x.trim()).filter(Boolean).join('\n')

const CauzioneScadenzaConfig = forwardRef<CauzioneScadenzaHandle, Props>(function CauzioneScadenzaConfig({ readOnly = false, onChangesChange }, ref) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [giorni, setGiorni] = useState<number | ''>(14)
  const [modalita, setModalita] = useState<'lavorativi' | 'calendario'>('lavorativi')
  const [orarioInvio, setOrarioInvio] = useState<number | ''>(8)
  const [colonnaMancante, setColonnaMancante] = useState(false)
  // Avviso di scadenza: quando parte, a chi, e se lo manda il cron o l'admin.
  const [avvisoMancante, setAvvisoMancante] = useState(false)
  const [avvisoModalita, setAvvisoModalita] = useState<'automatico' | 'manuale'>('automatico')
  const [avvisoOffsets, setAvvisoOffsets] = useState<number[]>([0])
  const [avvisoWhatsapp, setAvvisoWhatsapp] = useState('')
  const [avvisoEmail, setAvvisoEmail] = useState('')
  const [invioOra, setInvioOra] = useState(false)
  // Esito dell'ultimo "Invia ora". Il toast e' passeggero: quando l'avviso NON
  // parte (nessuna cauzione in scadenza, nessun destinatario, template spento)
  // il motivo deve restare a schermo, altrimenti il pulsante sembra rotto.
  const [esitoInvio, setEsitoInvio] = useState<{ ok: boolean; testo: string } | null>(null)
  const [salvato, setSalvato] = useState<Salvato | null>(null)

  useEffect(() => { void load() }, [])

  const modifiche = useMemo(() => {
    if (!salvato || readOnly) return [] as string[]
    const out: string[] = []
    if (String(giorni) !== String(salvato.giorni)) out.push(`Cauzioni: giorni di restituzione ${giorni || '(vuoto)'}`)
    if (modalita !== salvato.modalita) out.push(`Cauzioni: giorni ${modalita === 'calendario' ? 'di calendario' : 'lavorativi'}`)
    if (String(orarioInvio) !== String(salvato.orarioInvio)) out.push(`Cauzioni: ora avviso ${String(orarioInvio).padStart(2, '0')}:00`)
    if (avvisoModalita !== salvato.avvisoModalita) out.push(`Avviso scadenza cauzione: invio ${avvisoModalita}`)
    if (ordina(avvisoOffsets) !== ordina(salvato.avvisoOffsets)) out.push('Avviso scadenza cauzione: quando inviarlo')
    if (normTesto(avvisoWhatsapp) !== normTesto(salvato.avvisoWhatsapp)) out.push('Avviso scadenza cauzione: numeri WhatsApp')
    if (normTesto(avvisoEmail) !== normTesto(salvato.avvisoEmail)) out.push('Avviso scadenza cauzione: email')
    return out
  }, [salvato, readOnly, giorni, modalita, orarioInvio, avvisoModalita, avvisoOffsets, avvisoWhatsapp, avvisoEmail])

  useEffect(() => { onChangesChange?.(modifiche) }, [modifiche, onChangesChange])
  // Pannello smontato (cambio sezione): niente modifiche fantasma nella barra.
  useEffect(() => () => { onChangesChange?.([]) }, [onChangesChange])

  useImperativeHandle(ref, () => ({
    save: () => (modifiche.length > 0 ? save() : Promise.resolve(true)),
    reload: () => { void load() },
  }))

  async function load() {
    setLoading(true)
    const snap: Salvato = { giorni: 14, modalita: 'lavorativi', orarioInvio: 8, avvisoModalita: 'automatico', avvisoOffsets: [0], avvisoWhatsapp: '', avvisoEmail: '' }
    try {
      // La colonna `modalita_calcolo` arriva con la migrazione 20260824: se non
      // e' ancora stata eseguita, PostgREST fa fallire l'INTERA select. Si
      // riprova senza, cosi' il pannello resta usabile invece di sparire.
      const full = await supabase
        .from('cauzioni_config')
        .select('giorni_restituzione_default, modalita_calcolo, orario_invio')
        .eq('id', 'main')
        .maybeSingle()

      if (full.error) {
        setColonnaMancante(true)
        const legacy = await supabase
          .from('cauzioni_config')
          .select('giorni_restituzione_default, orario_invio')
          .eq('id', 'main')
          .maybeSingle()
        if (legacy.data) {
          snap.giorni = legacy.data.giorni_restituzione_default ?? 14
          snap.orarioInvio = legacy.data.orario_invio ?? 8
        }
      } else if (full.data) {
        snap.giorni = full.data.giorni_restituzione_default ?? 14
        snap.modalita = full.data.modalita_calcolo === 'calendario' ? 'calendario' : 'lavorativi'
        snap.orarioInvio = full.data.orario_invio ?? 8
      }
      // Colonne dell'avviso: select separata, cosi' se la migration
      // 20260824_cauzioni_avviso_scadenza_config non e' stata eseguita il
      // resto del pannello continua a funzionare.
      const avviso = await supabase
        .from('cauzioni_config')
        .select('avviso_modalita, avviso_offsets, avviso_whatsapp, avviso_email')
        .eq('id', 'main')
        .maybeSingle()
      if (avviso.error) {
        setAvvisoMancante(true)
      } else if (avviso.data) {
        snap.avvisoModalita = avviso.data.avviso_modalita === 'manuale' ? 'manuale' : 'automatico'
        const offs = Array.isArray(avviso.data.avviso_offsets) ? avviso.data.avviso_offsets.map(Number) : [0]
        snap.avvisoOffsets = offs.filter(n => Number.isInteger(n) && n >= -3 && n <= 3)
        snap.avvisoWhatsapp = avviso.data.avviso_whatsapp || ''
        snap.avvisoEmail = avviso.data.avviso_email || ''
      }
      setGiorni(snap.giorni)
      setModalita(snap.modalita)
      setOrarioInvio(snap.orarioInvio)
      setAvvisoModalita(snap.avvisoModalita)
      setAvvisoOffsets(snap.avvisoOffsets)
      setAvvisoWhatsapp(snap.avvisoWhatsapp)
      setAvvisoEmail(snap.avvisoEmail)
      setSalvato(snap)
    } catch (e) {
      toast.error('Errore nel caricamento: ' + (e instanceof Error ? e.message : 'riprova'))
    } finally {
      setLoading(false)
    }
  }

  async function inviaOra() {
    setInvioOra(true)
    setEsitoInvio(null)
    try {
      const res = await fetch('/.netlify/functions/trigger-cauzione-avviso', { method: 'POST' })
      // Il corpo puo' NON essere JSON (404 della funzione, 502 di Netlify, pagina
      // di errore): prima si guarda lo stato HTTP. Senza questo controllo un
      // errore del server diventava lo stesso "Niente da inviare" di quando non
      // c'e' davvero nulla da mandare, e il pulsante sembrava non fare niente.
      const raw = await res.text()
      let data: { ok?: boolean; message?: string; error?: string; sent?: number; skipped?: number; errors?: number; email?: { inviate: number; errori: string[]; ferma?: string } } = {}
      try { data = JSON.parse(raw) } catch { /* risposta non JSON */ }
      if (!res.ok) {
        const dettaglio = data.error || data.message || raw.slice(0, 120).trim()
        const testo = res.status === 404
          ? 'Funzione trigger-cauzione-avviso non trovata sul sito (deploy mancante).'
          : `Errore server ${res.status}${dettaglio ? ': ' + dettaglio : ''}`
        setEsitoInvio({ ok: false, testo })
        toast.error(testo, { duration: 8000 })
        return
      }
      const emailKo = !!data.email && (!!data.email.ferma || data.email.errori.length > 0)
      if (data.ok && emailKo) {
        const testo = data.message || 'WhatsApp inviato, email non inviate'
        setEsitoInvio({ ok: false, testo })
        toast.error(testo, { duration: 10000 })
      } else if (data.ok) {
        const testo = data.message || 'Avviso inviato'
        setEsitoInvio({ ok: true, testo })
        toast.success(testo)
      } else {
        const testo = data.message || 'Niente da inviare'
        setEsitoInvio({ ok: false, testo })
        toast(testo, { icon: 'ℹ️', duration: 8000 })
      }
    } catch (e) {
      const testo = 'Errore: ' + (e instanceof Error ? e.message : 'riprova')
      setEsitoInvio({ ok: false, testo })
      toast.error(testo)
    } finally {
      setInvioOra(false)
    }
  }

  async function save(): Promise<boolean> {
    const g = Number(giorni)
    if (!Number.isFinite(g) || g < 1 || g > 120) {
      toast.error('Inserisci un numero di giorni tra 1 e 120')
      return false
    }
    const h = Number(orarioInvio)
    setSaving(true)
    try {
      const patch: Record<string, unknown> = {
        giorni_restituzione_default: g,
        orario_invio: Number.isFinite(h) ? h : 8,
        updated_at: new Date().toISOString(),
      }
      if (!colonnaMancante) patch.modalita_calcolo = modalita
      if (!avvisoMancante) {
        patch.avviso_modalita = avvisoModalita
        patch.avviso_offsets = avvisoOffsets.length > 0 ? [...avvisoOffsets].sort((a, b) => a - b) : [0]
        patch.avviso_whatsapp = avvisoWhatsapp.trim() || null
        patch.avviso_email = avvisoEmail.trim() || null
      }

      // .select() per contare le righe toccate: se la riga singleton non
      // esistesse l'update non fallirebbe, semplicemente non farebbe nulla.
      const { data, error } = await supabase
        .from('cauzioni_config')
        .update(patch)
        .eq('id', 'main')
        .select('id')
      if (error) throw error
      if (!data || data.length === 0) {
        toast.error('Cauzioni: salvataggio non riuscito (riga cauzioni_config non trovata o permesso negato).')
        return false
      }
      // Nessun momento scelto = giorno stesso: lo stato si allinea a cio' che
      // e' stato salvato, altrimenti la barra resterebbe "da salvare".
      if (avvisoOffsets.length === 0) setAvvisoOffsets([0])
      setSalvato({
        giorni: g, modalita, orarioInvio: Number.isFinite(h) ? h : 8, avvisoModalita,
        avvisoOffsets: avvisoOffsets.length > 0 ? avvisoOffsets : [0],
        avvisoWhatsapp: avvisoWhatsapp.trim(), avvisoEmail: avvisoEmail.trim(),
      })
      toast.success('Cauzioni: impostazioni salvate')
      return true
    } catch (e) {
      toast.error('Cauzioni, errore nel salvataggio: ' + (e instanceof Error ? e.message : 'riprova'))
      return false
    } finally {
      setSaving(false)
    }
  }

  const giorniValidi = Number.isFinite(Number(giorni)) && Number(giorni) >= 1
  const oggi = new Date()
  const anteprimaOggi = giorniValidi ? calcolaScadenza(oggi, Number(giorni), modalita) : null
  // Un venerdi' e' il caso che mostra meglio la differenza tra le due modalita'.
  const venerdi = (() => { const d = new Date(oggi); while (d.getDay() !== 5) d.setDate(d.getDate() + 1); return d })()
  const anteprimaVenerdi = giorniValidi ? calcolaScadenza(venerdi, Number(giorni), modalita) : null

  if (loading) {
    return <ScheletroTesto righe={4} className="py-4" />
  }

  return (
    <div className="rounded-xl border border-theme-border bg-theme-bg-secondary p-4 mb-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-sm font-bold text-theme-text-primary">Scadenza restituzione cauzione</h3>
          <p className="text-xs text-theme-text-muted mt-0.5">
            Entro quanto la cauzione va restituita al cliente, a partire dalla riconsegna del veicolo.
            Vale per le nuove cauzioni e per quelle a cui cambia la data di riconsegna.
          </p>
        </div>
        {!readOnly && (
          <button
            type="button"
            onClick={() => { void save() }}
            disabled={saving || !giorniValidi}
            className="shrink-0 px-3 h-9 rounded-lg bg-dr7-gold text-white text-xs font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {saving ? 'Salvataggio...' : 'Salva'}
          </button>
        )}
      </div>

      {colonnaMancante && (
        <p className="mb-3 text-[11px] leading-snug text-amber-600 dark:text-amber-400">
          Migrazione <code>20260824_cauzioni_scadenza_config.sql</code> non ancora eseguita: si puo' cambiare il
          numero di giorni, ma la modalita' resta quella attuale finche' la migrazione non viene applicata.
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-theme-text-muted font-semibold mb-1">Giorni</label>
          <input
            type="text"
            inputMode="numeric"
            disabled={readOnly}
            value={giorni}
            onChange={e => {
              const v = e.target.value.replace(/[^0-9]/g, '')
              setGiorni(v === '' ? '' : Number(v))
            }}
            className="w-full px-2.5 h-9 rounded-lg border border-theme-border bg-theme-bg-primary text-sm text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-dr7-gold disabled:opacity-60"
          />
        </div>

        <div>
          <label className="block text-[10px] uppercase tracking-wider text-theme-text-muted font-semibold mb-1">Modalita</label>
          <select
            disabled={readOnly || colonnaMancante}
            value={modalita}
            onChange={e => setModalita(e.target.value === 'calendario' ? 'calendario' : 'lavorativi')}
            className="w-full px-2.5 h-9 rounded-lg border border-theme-border bg-theme-bg-primary text-sm text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-dr7-gold disabled:opacity-60"
          >
            <option value="lavorativi">Giorni lavorativi (lun-ven, festivi esclusi)</option>
            <option value="calendario">Giorni di calendario</option>
          </select>
        </div>

        <div>
          <label className="block text-[10px] uppercase tracking-wider text-theme-text-muted font-semibold mb-1">Ora avviso scadenza</label>
          <select
            disabled={readOnly}
            value={orarioInvio}
            onChange={e => setOrarioInvio(Number(e.target.value))}
            className="w-full px-2.5 h-9 rounded-lg border border-theme-border bg-theme-bg-primary text-sm text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-dr7-gold disabled:opacity-60"
          >
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
            ))}
          </select>
        </div>
      </div>

      {/* Anteprima: mostra il risultato PRIMA di salvare, cosi' non si scopre
          la regola dalla prima cauzione sbagliata. */}
      <div className="mt-3 rounded-lg bg-theme-bg-tertiary border border-theme-border p-3">
        <div className="text-[10px] uppercase tracking-wider text-theme-text-muted font-semibold mb-1.5">Anteprima</div>
        {anteprimaOggi && anteprimaVenerdi ? (
          <ul className="space-y-1 text-xs text-theme-text-secondary">
            <li>Riconsegna <strong>oggi</strong> ({DATA_IT(oggi)}) &rarr; scadenza <strong className="text-theme-text-primary">{DATA_IT(anteprimaOggi)}</strong></li>
            <li>Riconsegna <strong>venerdi</strong> ({DATA_IT(venerdi)}) &rarr; scadenza <strong className="text-theme-text-primary">{DATA_IT(anteprimaVenerdi)}</strong></li>
          </ul>
        ) : (
          <p className="text-xs text-theme-text-muted">Inserisci un numero di giorni valido.</p>
        )}
        {modalita === 'lavorativi' && (
          <p className="mt-2 text-[11px] text-theme-text-muted">
            Il conteggio parte dal primo giorno lavorativo <em>dopo</em> la riconsegna: se il veicolo torna venerdi, il giorno 1 e' il lunedi successivo.
          </p>
        )}
      </div>

      <p className="mt-2 text-[11px] text-theme-text-muted">
        Una scadenza forzata a mano su una singola cauzione non viene mai ricalcolata da questa impostazione.
      </p>

      {/* ── Avviso di scadenza: quando, a chi, come ─────────────────────── */}
      <div className="mt-5 pt-4 border-t border-theme-border">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h4 className="text-sm font-bold text-theme-text-primary">Avviso di scadenza</h4>
            <p className="text-xs text-theme-text-muted mt-0.5">
              Quando far partire l'avviso rispetto alla scadenza, e a chi mandarlo.
              Il testo e' quello di Messaggi di Sistema Pro (Scadenza Cauzione A/B/C).
            </p>
          </div>
          {!readOnly && (
            <button
              type="button"
              onClick={inviaOra}
              disabled={invioOra || avvisoMancante}
              className="shrink-0 px-3 h-9 rounded-lg border border-theme-border text-theme-text-primary text-xs font-semibold hover:bg-theme-bg-hover transition-colors disabled:opacity-50"
              title="Manda subito l'avviso per le cauzioni che rientrano nei momenti scelti"
            >
              {invioOra ? 'Invio...' : 'Invia ora'}
            </button>
          )}
        </div>

        {esitoInvio && (
          <p
            className={`mb-3 text-[11px] leading-snug ${esitoInvio.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}
            role="status"
          >
            {esitoInvio.testo}
            {!esitoInvio.ok && (
              <span className="block text-theme-text-muted">
                &quot;Invia ora&quot; usa le impostazioni gia' salvate: se hai appena cambiato i momenti o i
                destinatari, premi prima Salva.
              </span>
            )}
          </p>
        )}

        {avvisoMancante && (
          <p className="mb-3 text-[11px] leading-snug text-amber-600 dark:text-amber-400">
            Migrazione <code>20260824_cauzioni_avviso_scadenza_config.sql</code> non ancora eseguita: fino ad allora
            numeri ed email dell'avviso non si possono salvare e gli avvisi cauzioni allo staff non partono.
          </p>
        )}

        <div className="mb-3">
          <label className="block text-[10px] uppercase tracking-wider text-theme-text-muted font-semibold mb-1.5">
            Quando (rispetto alla scadenza)
          </label>
          <div className="flex flex-wrap gap-1.5">
            {[-3, -2, -1, 0, 1, 2, 3].map(off => {
              const attivo = avvisoOffsets.includes(off)
              const label = off === 0
                ? 'Giorno stesso'
                : off < 0
                  ? `${Math.abs(off)} ${Math.abs(off) === 1 ? 'giorno' : 'giorni'} prima`
                  : `${off} ${off === 1 ? 'giorno' : 'giorni'} dopo`
              return (
                <button
                  key={off}
                  type="button"
                  disabled={readOnly || avvisoMancante}
                  onClick={() => setAvvisoOffsets(prev => prev.includes(off) ? prev.filter(x => x !== off) : [...prev, off])}
                  className={`px-2.5 h-8 rounded-lg text-xs font-semibold border transition-colors disabled:opacity-50 ${
                    attivo
                      ? 'bg-dr7-gold text-white border-dr7-gold'
                      : 'bg-theme-bg-primary text-theme-text-secondary border-theme-border hover:bg-theme-bg-hover'
                  }`}
                >{label}</button>
              )
            })}
          </div>
          <p className="mt-1.5 text-[11px] text-theme-text-muted">
            Si possono scegliere piu' momenti: ogni cauzione riceve un avviso per ciascuno.
            Nessuna scelta = solo il giorno stesso.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-theme-text-muted font-semibold mb-1">Invio</label>
            <select
              disabled={readOnly || avvisoMancante}
              value={avvisoModalita}
              onChange={e => setAvvisoModalita(e.target.value === 'manuale' ? 'manuale' : 'automatico')}
              className="w-full px-2.5 h-9 rounded-lg border border-theme-border bg-theme-bg-primary text-sm text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-dr7-gold disabled:opacity-60"
            >
              <option value="automatico">Automatico (lo manda il sistema)</option>
              <option value="manuale">Manuale (solo con "Invia ora")</option>
            </select>
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-wider text-theme-text-muted font-semibold mb-1">Numero WhatsApp</label>
            <ElencoTelefoniConPrefisso
              disabled={readOnly || avvisoMancante}
              value={avvisoWhatsapp}
              onChange={setAvvisoWhatsapp}
            />
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-wider text-theme-text-muted font-semibold mb-1">Email</label>
            <textarea
              disabled={readOnly || avvisoMancante}
              value={avvisoEmail}
              onChange={e => setAvvisoEmail(e.target.value)}
              rows={2}
              placeholder="nome@dr7.app, uno per riga"
              className="w-full px-2.5 py-2 rounded-lg border border-theme-border bg-theme-bg-primary text-sm text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-dr7-gold disabled:opacity-60"
            />
          </div>
        </div>

        <p className="mt-2 text-[11px] text-theme-text-muted">
          Questi numeri ed email sono gli unici usati per le cauzioni: ricevono questo avviso e il promemoria
          giornaliero delle cauzioni da restituire. Gli avvisi non partono mai tra le 22:00 e le 07:00, tranne con "Invia ora".
        </p>
      </div>
    </div>
  )
})

export default CauzioneScadenzaConfig
