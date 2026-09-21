// Presenza in flotta di un veicolo: data di arrivo, uscita e pause (giorni in
// cui il mezzo non era noleggiabile). Salvate in vehicles.metadata
// (in_flotta_dal, in_flotta_al, pause_flotta) e usate da monthly-report per
// contare l'utilizzo solo sui giorni in cui il mezzo era davvero disponibile.
// Si modificano sia dal Report Noleggio sia dalla scheda in Veicoli.
import { useState } from 'react'
import EuropeanDateInput from '../../../components/EuropeanDateInput'

export type PausaFlotta = { dal: string; al: string; motivo: string }
export type DatiFlotta = { dal: string; al: string; pause: PausaFlotta[] }

export default function InFlottaEditor({ vehicleId, dati, onSave, saving }: {
  vehicleId: string
  dati: DatiFlotta
  onSave: (vehicleId: string, dati: DatiFlotta) => void
  saving: boolean
}) {
  const [nuova, setNuova] = useState<PausaFlotta>({ dal: '', al: '', motivo: '' })
  const campo = 'w-32 text-xs bg-theme-bg-tertiary border border-theme-border rounded px-2 py-0.5 text-theme-text-primary'
  const aggiungiPausa = () => {
    if (!nuova.dal || !nuova.al) { alert('Pausa: scegli la data di inizio e di fine.'); return }
    if (nuova.al < nuova.dal) { alert('Pausa: la fine viene prima dell\'inizio.'); return }
    onSave(vehicleId, { ...dati, pause: [...dati.pause, { ...nuova, motivo: nuova.motivo.trim() }].sort((a, b) => a.dal.localeCompare(b.dal)) })
    setNuova({ dal: '', al: '', motivo: '' })
  }
  return (
    <div onClick={e => e.stopPropagation()} className="space-y-2 mb-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-semibold text-theme-text-muted mr-1">Data di arrivo</p>
        <EuropeanDateInput value={dati.dal} onChange={v => onSave(vehicleId, { ...dati, dal: v })} className={campo} />
        <p className="text-xs font-semibold text-theme-text-muted ml-2 mr-1">Uscita dalla flotta</p>
        <EuropeanDateInput value={dati.al} onChange={v => onSave(vehicleId, { ...dati, al: v })} className={campo} placeholder="ancora in flotta" />
        {(dati.dal || dati.al) && (
          <button type="button" onClick={() => onSave(vehicleId, { ...dati, dal: '', al: '' })} className="text-[11px] px-1.5 py-0.5 rounded border border-theme-border text-theme-text-muted hover:text-theme-text-primary">Svuota date</button>
        )}
        {saving && <span className="text-[10px] text-theme-text-muted">Salvataggio…</span>}
      </div>
      <div>
        <p className="text-xs font-semibold text-theme-text-muted mb-1">Pause (mezzo non noleggiabile: non contano nell'utilizzo)</p>
        {dati.pause.map((p, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 text-xs text-theme-text-primary mb-1">
            <span>dal {p.dal.split('-').reverse().join('/')} al {p.al.split('-').reverse().join('/')}</span>
            {p.motivo && <span className="text-theme-text-muted">({p.motivo})</span>}
            <button type="button" onClick={() => onSave(vehicleId, { ...dati, pause: dati.pause.filter((_, j) => j !== i) })} className="text-red-400 hover:text-red-300 text-sm px-1" title="Rimuovi pausa">×</button>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-theme-text-muted">dal</span>
          <EuropeanDateInput value={nuova.dal} onChange={v => setNuova(n => ({ ...n, dal: v }))} className={campo} />
          <span className="text-xs text-theme-text-muted">al</span>
          <EuropeanDateInput value={nuova.al} onChange={v => setNuova(n => ({ ...n, al: v }))} className={campo} />
          <input value={nuova.motivo} onChange={e => setNuova(n => ({ ...n, motivo: e.target.value }))} placeholder="Motivo (es. carrozzeria)"
            className="flex-1 min-w-[10rem] text-xs bg-theme-bg-tertiary border border-theme-border rounded px-2 py-0.5 text-theme-text-primary" />
          <button type="button" onClick={aggiungiPausa} className="text-xs px-2 py-0.5 rounded bg-dr7-gold/20 text-dr7-gold hover:bg-dr7-gold/30 whitespace-nowrap">+ Aggiungi pausa</button>
        </div>
      </div>
    </div>
  )
}


export function leggiDatiFlotta(metadata: unknown): DatiFlotta {
  const m = (metadata && typeof metadata === 'object' ? metadata : {}) as { in_flotta_dal?: unknown; in_flotta_al?: unknown; pause_flotta?: unknown }
  const pause = Array.isArray(m.pause_flotta)
    ? (m.pause_flotta as Array<Record<string, unknown>>)
        .map(p => ({ dal: String(p?.dal || ''), al: String(p?.al || ''), motivo: String(p?.motivo || '') }))
        .filter(p => p.dal && p.al)
    : []
  return { dal: String(m.in_flotta_dal || ''), al: String(m.in_flotta_al || ''), pause }
}

/** Metadata con le date in flotta aggiornate; le altre chiavi restano com'erano. */
export function scriviDatiFlotta(metadata: unknown, dati: DatiFlotta): Record<string, unknown> {
  const meta = (metadata && typeof metadata === 'object') ? { ...(metadata as Record<string, unknown>) } : {}
  if (dati.dal) meta.in_flotta_dal = dati.dal; else delete meta.in_flotta_dal
  if (dati.al) meta.in_flotta_al = dati.al; else delete meta.in_flotta_al
  if (dati.pause.length) meta.pause_flotta = dati.pause; else delete meta.pause_flotta
  return meta
}
