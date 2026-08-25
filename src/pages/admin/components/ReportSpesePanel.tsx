/**
 * Pannello "Spese" del report — bottone accanto ad Aggiorna + elenco delle
 * spese ricorrenti e una tantum del business, con quanto pesano sul periodo
 * attualmente mostrato.
 *
 * Scrittura riservata alla DIREZIONE (richiesta 25/08/2026): queste righe
 * cambiano il Margine Netto dell'intero business. Chi non e' direzione vede
 * comunque il dettaglio — deve poter capire da dove esce il margine — ma i
 * campi sono in sola lettura. Il gate e' anche in RLS
 * (dr7_can_edit_report_spese), non solo qui.
 */
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import EuropeanDateInput from '../../../components/EuropeanDateInput'
import { useAdminRole } from '../../../hooks/useAdminRole'
import type { ReportSpesa, SpesaTipo } from '../../../hooks/useReportSpese'

const MESI = [
  'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre',
]

/** Importi digitati all'italiana: "1.250,50" → 1250.5. Mai type="number". */
function parseAmt(s: string): number {
  return Number(String(s).replace(/\./g, '').replace(',', '.')) || 0
}

/** 'YYYY-MM-01' ⇄ selettori mese/anno, senza passare da Date (niente fusi). */
function ymParts(iso?: string | null): { m: number; y: number } | null {
  const s = String(iso || '').slice(0, 7)
  if (!/^\d{4}-\d{2}$/.test(s)) return null
  const [y, m] = s.split('-').map(Number)
  return { m, y }
}
function toYm(y: number, m: number): string {
  return `${y}-${String(m).padStart(2, '0')}-01`
}

/** Mese/anno: due select, cosi' non dipende dal formato locale del browser. */
function MonthPicker({ value, onChange, disabled, allowEmpty, emptyLabel }: {
  value?: string | null
  onChange: (iso: string | null) => void
  disabled?: boolean
  allowEmpty?: boolean
  emptyLabel?: string
}) {
  const now = new Date()
  const parts = ymParts(value)
  const anni: number[] = []
  for (let y = now.getFullYear() - 4; y <= now.getFullYear() + 4; y++) anni.push(y)
  const cls = 'text-xs bg-theme-bg-tertiary border border-theme-border rounded px-1.5 py-1 text-theme-text-primary disabled:opacity-60'

  return (
    <div className="flex items-center gap-1">
      <select
        className={cls}
        disabled={disabled}
        value={parts ? parts.m : ''}
        onChange={e => {
          if (!e.target.value) { onChange(null); return }
          onChange(toYm(parts?.y ?? now.getFullYear(), Number(e.target.value)))
        }}
      >
        {allowEmpty && <option value="">{emptyLabel || '—'}</option>}
        {MESI.map((nome, i) => <option key={nome} value={i + 1}>{nome}</option>)}
      </select>
      <select
        className={cls}
        disabled={disabled}
        value={parts ? parts.y : ''}
        onChange={e => {
          if (!e.target.value) { onChange(null); return }
          onChange(toYm(Number(e.target.value), parts?.m ?? 1))
        }}
      >
        {allowEmpty && <option value="">{emptyLabel || '—'}</option>}
        {anni.map(y => <option key={y} value={y}>{y}</option>)}
      </select>
    </div>
  )
}

type RigaCalcolata = ReportSpesa & { mensilita: number; pesa: number }

export default function ReportSpesePanel({
  righe, totali, saving, fmt, periodoLabel,
  onCreate, onUpdate, onRemove,
}: {
  righe: RigaCalcolata[]
  totali: { ricorrenti: number; unaTantum: number; totale: number; mesi: string[] }
  saving: boolean
  fmt: (n: number) => string
  periodoLabel: string
  onCreate: (row: Omit<ReportSpesa, 'id' | 'business'>) => Promise<string | null>
  onUpdate: (id: string, patch: Partial<ReportSpesa>) => Promise<string | null>
  onRemove: (id: string) => Promise<string | null>
}) {
  const { hasRole, loading: roleLoading } = useAdminRole()
  const canEdit = !roleLoading && hasRole('direzione')

  const [open, setOpen] = useState(false)
  // Bozza della nuova riga, per tipo: i due elenchi hanno campi diversi.
  const [draftTipo, setDraftTipo] = useState<SpesaTipo | null>(null)
  const [dLabel, setDLabel] = useState('')
  const [dAmount, setDAmount] = useState('')
  const [dDal, setDDal] = useState<string | null>(null)
  const [dAl, setDAl] = useState<string | null>(null)
  const [dData, setDData] = useState('')

  useEffect(() => {
    if (!open) { setDraftTipo(null); setDLabel(''); setDAmount(''); setDDal(null); setDAl(null); setDData('') }
  }, [open])

  function apriBozza(tipo: SpesaTipo) {
    const oggi = new Date()
    setDraftTipo(tipo)
    setDLabel(''); setDAmount('')
    setDDal(toYm(oggi.getFullYear(), oggi.getMonth() + 1))
    setDAl(null)
    setDData(oggi.toISOString().slice(0, 10))
  }

  async function salvaBozza() {
    if (!draftTipo) return
    const label = dLabel.trim()
    const amount = parseAmt(dAmount)
    if (!label) { toast.error('Inserisci una voce di spesa'); return }
    if (amount <= 0) { toast.error('Inserisci un importo maggiore di zero'); return }
    if (draftTipo === 'ricorrente' && !dDal) { toast.error('Indica da quale mese parte la spesa'); return }
    if (draftTipo === 'una_tantum' && !dData) { toast.error('Indica la data della spesa'); return }

    const err = await onCreate(draftTipo === 'ricorrente'
      ? { tipo: 'ricorrente', label, amount, dal: dDal, al: dAl || null }
      : { tipo: 'una_tantum', label, amount, data: dData })
    if (err) { toast.error(err); return }
    toast.success('Spesa aggiunta')
    setDraftTipo(null)
  }

  async function elimina(r: RigaCalcolata) {
    if (!confirm(`Eliminare la spesa "${r.label}"?\n\nIl Margine Netto del report cambiera' di conseguenza.`)) return
    const err = await onRemove(r.id)
    if (err) toast.error(err); else toast.success('Spesa eliminata')
  }

  const ricorrenti = righe.filter(r => r.tipo === 'ricorrente')
  const unaTantum = righe.filter(r => r.tipo === 'una_tantum')
  const inputCls = 'text-xs bg-theme-bg-tertiary border border-theme-border rounded px-2 py-1 text-theme-text-primary disabled:opacity-60'

  function RigaEditabile({ r }: { r: RigaCalcolata }) {
    const attiva = r.pesa > 0
    return (
      <div className={`flex flex-wrap items-center gap-2 rounded-lg border px-2 py-1.5 ${attiva ? 'border-theme-border bg-theme-bg-primary' : 'border-theme-border/40 bg-theme-bg-primary/40'}`}>
        <input
          className={`${inputCls} flex-1 min-w-[140px]`}
          defaultValue={r.label}
          disabled={!canEdit}
          onBlur={e => { const v = e.target.value.trim(); if (v && v !== r.label) onUpdate(r.id, { label: v }) }}
        />
        <input
          className={`${inputCls} w-24 text-right`}
          defaultValue={String(r.amount).replace('.', ',')}
          inputMode="decimal"
          disabled={!canEdit}
          onBlur={e => { const v = parseAmt(e.target.value); if (v !== r.amount) onUpdate(r.id, { amount: v }) }}
        />
        {r.tipo === 'ricorrente' ? (
          <div className="flex items-center gap-1.5 text-[11px] text-theme-text-muted">
            <span>Da</span>
            <MonthPicker value={r.dal} disabled={!canEdit} onChange={iso => iso && onUpdate(r.id, { dal: iso })} />
            <span>A</span>
            <MonthPicker value={r.al} disabled={!canEdit} allowEmpty emptyLabel="in corso" onChange={iso => onUpdate(r.id, { al: iso })} />
          </div>
        ) : (
          <div className="w-36">
            <EuropeanDateInput
              value={r.data || ''}
              disabled={!canEdit}
              onChange={iso => iso && onUpdate(r.id, { data: iso })}
            />
          </div>
        )}
        <span className={`text-xs tabular-nums font-semibold ${attiva ? 'text-red-400' : 'text-theme-text-muted'}`}>
          {attiva ? `−${fmt(r.pesa)}` : 'fuori periodo'}
        </span>
        {r.tipo === 'ricorrente' && r.mensilita > 1 && (
          <span className="text-[10px] text-theme-text-muted">({r.mensilita} mensilita&apos;)</span>
        )}
        {canEdit && (
          <button onClick={() => elimina(r)} className="text-red-400 hover:text-red-300 text-sm px-1" title="Elimina">×</button>
        )}
      </div>
    )
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        title="Spese ricorrenti e una tantum di questo business"
        className={`px-6 py-2 font-semibold rounded-full transition-colors border ${open
          ? 'bg-dr7-gold text-white border-dr7-gold'
          : 'bg-theme-text-primary/5 text-theme-text-primary border-theme-border hover:bg-theme-text-primary/10'
          }`}
      >
        Spese{totali.totale > 0 ? ` · −${fmt(totali.totale)}` : ''}
      </button>

      {open && (
        <>
          {/* Clic fuori = chiudi, senza intrappolare il resto della pagina. */}
          <div className="fixed inset-0 z-[55]" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 w-[min(92vw,720px)] z-[56] rounded-xl border border-theme-border bg-theme-bg-secondary shadow-2xl p-4 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-theme-text-primary">Spese — {periodoLabel}</h3>
                <p className="text-[11px] text-theme-text-muted mt-0.5">
                  Le ricorrenti pesano una volta per ogni mese del periodo in cui sono attive.
                  Le une tantum solo se la data cade nel periodo.
                </p>
              </div>
              {saving && <span className="text-[10px] text-theme-text-muted shrink-0">Salvataggio…</span>}
            </div>

            {!canEdit && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-theme-text-secondary">
                Solo la direzione puo&apos; modificare le spese. Qui vedi il dettaglio in sola lettura.
              </div>
            )}

            {/* ── Ricorrenti ── */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-theme-text-muted uppercase tracking-wide">Ricorrenti</p>
                <span className="text-xs text-red-400 font-semibold tabular-nums">−{fmt(totali.ricorrenti)}</span>
              </div>
              {ricorrenti.length === 0 && <p className="text-[11px] text-theme-text-muted">Nessuna spesa ricorrente.</p>}
              {ricorrenti.map(r => <RigaEditabile key={r.id} r={r} />)}
              {canEdit && draftTipo !== 'ricorrente' && (
                <button onClick={() => apriBozza('ricorrente')} className="text-xs px-2 py-1 rounded bg-dr7-gold/20 text-dr7-gold hover:bg-dr7-gold/30">
                  + Aggiungi ricorrente
                </button>
              )}
            </div>

            {/* ── Una tantum ── */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-theme-text-muted uppercase tracking-wide">Non ricorrenti</p>
                <span className="text-xs text-red-400 font-semibold tabular-nums">−{fmt(totali.unaTantum)}</span>
              </div>
              {unaTantum.length === 0 && <p className="text-[11px] text-theme-text-muted">Nessuna spesa una tantum.</p>}
              {unaTantum.map(r => <RigaEditabile key={r.id} r={r} />)}
              {canEdit && draftTipo !== 'una_tantum' && (
                <button onClick={() => apriBozza('una_tantum')} className="text-xs px-2 py-1 rounded bg-dr7-gold/20 text-dr7-gold hover:bg-dr7-gold/30">
                  + Aggiungi non ricorrente
                </button>
              )}
            </div>

            {/* ── Bozza nuova riga ── */}
            {canEdit && draftTipo && (
              <div className="rounded-lg border border-dr7-gold/40 bg-dr7-gold/5 p-3 space-y-2">
                <p className="text-[11px] font-semibold text-dr7-gold">
                  Nuova spesa {draftTipo === 'ricorrente' ? 'ricorrente (importo mensile)' : 'non ricorrente (una tantum)'}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    className={`${inputCls} flex-1 min-w-[160px]`}
                    placeholder={draftTipo === 'ricorrente' ? 'Voce (es. Affitto, Stipendi, Commercialista)' : 'Voce (es. Riparazione, Consulenza)'}
                    value={dLabel}
                    onChange={e => setDLabel(e.target.value)}
                    autoFocus
                  />
                  <input
                    className={`${inputCls} w-24 text-right`}
                    placeholder={draftTipo === 'ricorrente' ? '€/mese' : '€'}
                    inputMode="decimal"
                    value={dAmount}
                    onChange={e => setDAmount(e.target.value)}
                  />
                  {draftTipo === 'ricorrente' ? (
                    <div className="flex items-center gap-1.5 text-[11px] text-theme-text-muted">
                      <span>Da</span>
                      <MonthPicker value={dDal} onChange={setDDal} />
                      <span>A</span>
                      <MonthPicker value={dAl} allowEmpty emptyLabel="in corso" onChange={setDAl} />
                    </div>
                  ) : (
                    <div className="w-36"><EuropeanDateInput value={dData} onChange={setDData} /></div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={salvaBozza} disabled={saving} className="text-xs px-3 py-1 rounded bg-dr7-gold text-white font-semibold disabled:opacity-50">Salva</button>
                  <button onClick={() => setDraftTipo(null)} className="text-xs px-3 py-1 rounded border border-theme-border text-theme-text-secondary">Annulla</button>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between border-t border-theme-border pt-2">
              <span className="text-xs text-theme-text-muted">Totale spese del periodo</span>
              <span className="text-base font-bold text-red-400 tabular-nums">−{fmt(totali.totale)}</span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
