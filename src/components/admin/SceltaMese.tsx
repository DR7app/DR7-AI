/**
 * Menu "Mese..." della barra Periodo: il mese corrente e i 23 precedenti.
 *
 * 25/09/2026 (direzione): lo stesso menu del Report Noleggio su ogni barra
 * di date (Report, Veicoli, elenchi). Resta selezionato solo se il periodo e'
 * esattamente quel mese intero; sceglierne uno manda il primo e l'ultimo
 * giorno (YYYY-MM-DD, ora locale).
 */
const NOMI_MESI = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre']

function isoLocale(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function mesiDaScegliere(oggi = new Date()): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = []
  for (let i = 0; i < 24; i++) {
    const d = new Date(oggi.getFullYear(), oggi.getMonth() - i, 1)
    out.push({ value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: `${NOMI_MESI[d.getMonth()]} ${d.getFullYear()}` })
  }
  return out
}

/** "YYYY-MM" se da..a e' esattamente un mese intero, altrimenti ''. */
export function meseInteroDi(da: string, a: string): string {
  if (!/^\d{4}-\d{2}-01$/.test(da || '') || (a || '').slice(0, 7) !== da.slice(0, 7)) return ''
  const [y, m] = da.split('-').map(Number)
  return isoLocale(new Date(y, m, 0)) === a ? da.slice(0, 7) : ''
}

export default function SceltaMese({ da, a, onChange }: { da: string; a: string; onChange: (da: string, a: string) => void }) {
  return (
    <select
      value={meseInteroDi(da, a)}
      onChange={(e) => {
        const ym = e.target.value
        if (!ym) return
        const [y, m] = ym.split('-').map(Number)
        onChange(`${ym}-01`, isoLocale(new Date(y, m, 0)))
      }}
      className="px-2 py-1.5 bg-theme-bg-tertiary border border-theme-border-light rounded text-theme-text-primary text-xs"
      title="Scegli un mese intero"
    >
      <option value="">Mese...</option>
      {mesiDaScegliere().map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
    </select>
  )
}
