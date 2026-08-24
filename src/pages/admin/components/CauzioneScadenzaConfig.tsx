import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'

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

export default function CauzioneScadenzaConfig({ readOnly = false }: { readOnly?: boolean }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [giorni, setGiorni] = useState<number | ''>(14)
  const [modalita, setModalita] = useState<'lavorativi' | 'calendario'>('lavorativi')
  const [orarioInvio, setOrarioInvio] = useState<number | ''>(8)
  const [colonnaMancante, setColonnaMancante] = useState(false)

  useEffect(() => { void load() }, [])

  async function load() {
    setLoading(true)
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
          setGiorni(legacy.data.giorni_restituzione_default ?? 14)
          setOrarioInvio(legacy.data.orario_invio ?? 8)
        }
      } else if (full.data) {
        setGiorni(full.data.giorni_restituzione_default ?? 14)
        setModalita(full.data.modalita_calcolo === 'calendario' ? 'calendario' : 'lavorativi')
        setOrarioInvio(full.data.orario_invio ?? 8)
      }
    } catch (e) {
      toast.error('Errore nel caricamento: ' + (e instanceof Error ? e.message : 'riprova'))
    } finally {
      setLoading(false)
    }
  }

  async function save() {
    const g = Number(giorni)
    if (!Number.isFinite(g) || g < 1 || g > 120) {
      toast.error('Inserisci un numero di giorni tra 1 e 120')
      return
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

      // .select() per contare le righe toccate: se la riga singleton non
      // esistesse l'update non fallirebbe, semplicemente non farebbe nulla.
      const { data, error } = await supabase
        .from('cauzioni_config')
        .update(patch)
        .eq('id', 'main')
        .select('id')
      if (error) throw error
      if (!data || data.length === 0) {
        toast.error('Riga di configurazione non trovata (cauzioni_config id=main).')
        return
      }
      toast.success('Scadenza cauzione aggiornata')
    } catch (e) {
      toast.error('Errore: ' + (e instanceof Error ? e.message : 'riprova'))
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
    return <div className="text-sm text-theme-text-muted py-4">Caricamento configurazione scadenza...</div>
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
            onClick={save}
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
    </div>
  )
}
