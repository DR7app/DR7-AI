// Modifiche manuali ai report (nuova funzione). Layer di override applicato
// SOPRA i dati calcolati del report, PRIMA del calcolo dei totali: cosi' correzioni,
// rimozioni e aggiunte manuali si riflettono anche nelle somme/KPI.
//
// Uso tipico in un report:
//   const ov = await loadReportOverrides('noleggio')
//   const adjusted = applyOverrides(rows, ov, r => r.booking_id)
//   // ...calcola i totali su `adjusted`, non su `rows`.
import { supabase } from '../supabaseClient'

export type OverrideAction = 'edit' | 'remove' | 'add'

export interface ReportOverride {
  id: string
  report_type: string
  row_key: string
  action: OverrideAction
  field: string | null
  value_num: number | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value_json: any | null
  note: string | null
  created_at: string
}

export interface LoadedOverrides {
  raw: ReportOverride[]
  removed: Set<string>
  // key = `${row_key}::${field}` -> valore numerico
  edits: Map<string, number>
  // righe aggiunte a mano (value_json)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  added: Array<{ id: string; row: any; note: string | null }>
  // note per riga (row_key -> note piu' recente)
  notesByRow: Map<string, string>
}

export async function loadReportOverrides(reportType: string): Promise<LoadedOverrides> {
  const empty: LoadedOverrides = { raw: [], removed: new Set(), edits: new Map(), added: [], notesByRow: new Map() }
  try {
    const { data, error } = await supabase
      .from('report_overrides')
      .select('*')
      .eq('report_type', reportType)
      .order('created_at', { ascending: true })
    if (error) return empty
    const raw = (data as ReportOverride[]) || []
    const removed = new Set<string>()
    const edits = new Map<string, number>()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const added: Array<{ id: string; row: any; note: string | null }> = []
    const notesByRow = new Map<string, string>()
    for (const o of raw) {
      if (o.note) notesByRow.set(o.row_key, o.note)
      if (o.action === 'remove') removed.add(o.row_key)
      else if (o.action === 'edit' && o.field != null && o.value_num != null) edits.set(`${o.row_key}::${o.field}`, Number(o.value_num))
      else if (o.action === 'add') added.push({ id: o.id, row: o.value_json || {}, note: o.note })
    }
    return { raw, removed, edits, added, notesByRow }
  } catch {
    return empty
  }
}

/**
 * Applica gli override a una lista di righe. `keyOf` estrae la chiave stabile
 * della riga (es. booking_id). Ritorna la lista modificata: righe rimosse
 * escluse, campi corretti sovrascritti, righe aggiunte in coda.
 * `fields` (opzionale) elenca i campi numerici sovrascrivibili — se un edit
 * riguarda un campo non in `fields` viene comunque applicato via bracket-set.
 */
export function applyOverrides<T extends Record<string, unknown>>(
  rows: T[],
  ov: LoadedOverrides,
  keyOf: (row: T) => string,
): (T & { _overrideNote?: string | null; _isManual?: boolean })[] {
  const out: (T & { _overrideNote?: string | null; _isManual?: boolean })[] = []
  for (const r of rows) {
    const key = keyOf(r)
    if (ov.removed.has(key)) continue
    const copy: Record<string, unknown> = { ...r }
    // applica gli edit per questa riga
    for (const [k, v] of ov.edits) {
      const [rowKey, field] = k.split('::')
      if (rowKey === key) copy[field] = v
    }
    const note = ov.notesByRow.get(key) || null
    out.push({ ...(copy as T), _overrideNote: note })
  }
  // righe aggiunte a mano
  for (const a of ov.added) {
    out.push({ ...(a.row as T), _overrideNote: a.note, _isManual: true, _manualId: a.id } as T & { _overrideNote?: string | null; _isManual?: boolean })
  }
  return out
}

// ── CRUD ──────────────────────────────────────────────────────────────────
async function currentUser(): Promise<string | null> {
  try { const { data } = await supabase.auth.getUser(); return data.user?.id || null } catch { return null }
}

export async function saveEditOverride(reportType: string, rowKey: string, field: string, value: number, note: string | null) {
  const created_by = await currentUser()
  return supabase.from('report_overrides').upsert(
    { report_type: reportType, row_key: rowKey, action: 'edit', field, value_num: value, note, created_by, updated_at: new Date().toISOString() },
    { onConflict: 'report_type,row_key,field' },
  )
}

export async function saveRemoveOverride(reportType: string, rowKey: string, note: string | null) {
  const created_by = await currentUser()
  // Sentinel field='__remove__' per rispettare il vincolo unico (non-null).
  return supabase.from('report_overrides').upsert(
    { report_type: reportType, row_key: rowKey, action: 'remove', field: '__remove__', note, created_by, updated_at: new Date().toISOString() },
    { onConflict: 'report_type,row_key,field' },
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function saveAddOverride(reportType: string, row: any, note: string | null) {
  const created_by = await currentUser()
  const rowKey = `manual_${Date.now()}_${Math.round(performance.now())}`
  return supabase.from('report_overrides').insert(
    { report_type: reportType, row_key: rowKey, action: 'add', value_json: row, note, created_by },
  )
}

export async function deleteOverrideByRow(reportType: string, rowKey: string) {
  return supabase.from('report_overrides').delete().eq('report_type', reportType).eq('row_key', rowKey)
}

export async function deleteOverrideById(id: string) {
  return supabase.from('report_overrides').delete().eq('id', id)
}
