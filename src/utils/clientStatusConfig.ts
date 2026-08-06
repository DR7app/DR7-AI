// Status clienti personalizzabili da Centralina Pro (verifica direzione 29/07).
//
// La sezione "Status Clienti" leggeva la tabella `client_status_config`, mai
// creata sul DB: la sezione mostrava solo l'avviso "applica la migration" e
// nulla era personalizzabile. Inoltre i badge in giro per l'admin leggevano
// etichette e colori HARDCODED (ClientStatusContext.TIER_META), quindi anche
// rinominando uno status non cambiava niente a schermo.
//
// Qui la configurazione vive dentro `centralina_pro_config` (riga 'main',
// chiave `client_status`): stessa riga che la Centralina usa gia', nessuna
// migration da applicare, e il salvataggio della Centralina non la tocca
// (savePersisted fa read-modify-write).
//
// I 4 status storici (standard/member/elite/blacklist) non si cancellano — li
// usano filtri campagne, report e logica interna — ma si rinominano e
// ricolorano come tutti gli altri. L'admin puo' aggiungerne di propri: chiave
// generata dallo slug del nome, scritta su customers_extended.status come le
// altre, riconosciuta ovunque (badge, campagne, cron).
import { supabase } from '../supabaseClient'

// Le 4 chiavi storiche non si cancellano: le usano filtri campagne, report e
// logica interna. Gli status aggiunti dall'admin hanno una chiave generata
// (slug del nome) e sono cancellabili.
export type ClientStatusKey = string
export const BUILTIN_STATUS_KEYS = ['standard', 'member', 'elite', 'blacklist'] as const
export type BuiltinStatusKey = typeof BUILTIN_STATUS_KEYS[number]

export function isBuiltinStatus(key: string): boolean {
  return (BUILTIN_STATUS_KEYS as readonly string[]).includes(key)
}

/**
 * Chiave stabile per un nuovo status: slug del nome, con suffisso numerico se
 * gia' preso. Resta scritta sulle schede cliente, quindi non cambia piu' anche
 * se poi il nome viene modificato.
 */
export function makeStatusKey(label: string, existing: string[]): string {
  const base = label
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24) || 'status'
  const taken = new Set(existing)
  if (!taken.has(base) && !isBuiltinStatus(base)) return base
  for (let i = 2; i < 999; i++) {
    const candidate = `${base}_${i}`
    if (!taken.has(candidate)) return candidate
  }
  return `${base}_${existing.length + 1}`
}

/** Gravita' dell'avvertenza mostrata a chi apre la scheda del cliente. */
export type AvvisoLivello = 'info' | 'attenzione' | 'critico'

export interface ClientStatusDef {
  key: ClientStatusKey
  /** Nome mostrato ovunque (badge, scheda cliente, report). */
  label: string
  /** Riga di contesto sotto il nome nella scheda cliente. */
  descrizione: string
  /** Id colore (vedi CLIENT_STATUS_COLORS). */
  colore: string
  /** Avvertenza per lo staff. Vuota = nessun avviso. */
  avviso: string
  avviso_livello: AvvisoLivello
  /** Se false il badge non compare nelle liste (lo status resta assegnabile). */
  badge_visibile: boolean
  ordine: number
}

interface ColorDef {
  id: string
  label: string
  dot: string
  badge: string
  text: string
  banner: string
}

// Classi Tailwind scritte per esteso: niente stringhe composte a runtime, che
// il purge di Tailwind non vedrebbe.
export const CLIENT_STATUS_COLORS: ColorDef[] = [
  { id: 'gray', label: 'Grigio', dot: 'bg-gray-400', badge: 'bg-gray-500/20 text-gray-600 dark:text-gray-300 border-gray-500/50', text: 'text-gray-600 dark:text-gray-300', banner: 'bg-gray-500/10 border-gray-500/30' },
  { id: 'blue', label: 'Blu', dot: 'bg-blue-500', badge: 'bg-blue-500/20 text-blue-600 dark:text-blue-400 border-blue-500/50', text: 'text-blue-600 dark:text-blue-400', banner: 'bg-blue-500/10 border-blue-500/30' },
  { id: 'emerald', label: 'Verde', dot: 'bg-emerald-500', badge: 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/50', text: 'text-emerald-600 dark:text-emerald-400', banner: 'bg-emerald-500/10 border-emerald-500/30' },
  { id: 'amber', label: 'Ambra', dot: 'bg-amber-500', badge: 'bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/50', text: 'text-amber-600 dark:text-amber-400', banner: 'bg-amber-500/10 border-amber-500/30' },
  { id: 'red', label: 'Rosso', dot: 'bg-red-500', badge: 'bg-red-500/20 text-red-600 dark:text-red-400 border-red-500/50', text: 'text-red-600 dark:text-red-400', banner: 'bg-red-500/10 border-red-500/30' },
  { id: 'purple', label: 'Viola', dot: 'bg-purple-500', badge: 'bg-purple-500/20 text-purple-600 dark:text-purple-400 border-purple-500/50', text: 'text-purple-600 dark:text-purple-400', banner: 'bg-purple-500/10 border-purple-500/30' },
  { id: 'gold', label: 'Oro DR7', dot: 'bg-[#C9A96E]', badge: 'bg-[#C9A96E]/20 text-[#8A6E3A] dark:text-[#D4B896] border-[#C9A96E]/50', text: 'text-[#8A6E3A] dark:text-[#D4B896]', banner: 'bg-[#C9A96E]/10 border-[#C9A96E]/30' },
]

export function clientStatusColor(colore: string): ColorDef {
  return CLIENT_STATUS_COLORS.find(c => c.id === colore) || CLIENT_STATUS_COLORS[0]
}

/** Classi del riquadro avvertenza, per gravita'. */
export const AVVISO_LIVELLI: { id: AvvisoLivello; label: string; cls: string }[] = [
  { id: 'info', label: 'Informativa', cls: 'bg-blue-500/10 border-blue-500/30 text-blue-600 dark:text-blue-300' },
  { id: 'attenzione', label: 'Attenzione', cls: 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300' },
  { id: 'critico', label: 'Critica', cls: 'bg-red-500/10 border-red-500/40 text-red-600 dark:text-red-300' },
]

export function avvisoClasses(livello: AvvisoLivello): string {
  return (AVVISO_LIVELLI.find(l => l.id === livello) || AVVISO_LIVELLI[0]).cls
}

// Default = quello che l'admin mostra oggi, cosi' attivare la personalizzazione
// non cambia nulla finche' non si tocca qualcosa.
export const DEFAULT_CLIENT_STATUS: ClientStatusDef[] = [
  { key: 'standard', label: 'New entry', descrizione: 'Cliente senza storico particolare', colore: 'emerald', avviso: '', avviso_livello: 'info', badge_visibile: true, ordine: 1 },
  { key: 'member', label: 'Member', descrizione: 'Cliente fidelizzato', colore: 'blue', avviso: '', avviso_livello: 'info', badge_visibile: true, ordine: 2 },
  { key: 'elite', label: 'Elite', descrizione: 'Alto valore, basso rischio', colore: 'amber', avviso: '', avviso_livello: 'info', badge_visibile: true, ordine: 3 },
  { key: 'blacklist', label: 'Blacklist', descrizione: 'Rischio elevato', colore: 'red', avviso: 'Cliente in blacklist: non procedere senza autorizzazione della direzione.', avviso_livello: 'critico', badge_visibile: true, ordine: 4 },
]

export const CLIENT_STATUS_CONFIG_KEY = 'client_status'
const CONFIG_ROW = 'main'

/** Completa una riga parziale con i default della sua chiave. */
function withDefaults(raw: Partial<ClientStatusDef>, key: ClientStatusKey): ClientStatusDef {
  // Per gli status aggiunti dall'admin non esiste un default di fabbrica: si
  // parte dal neutro (grigio, nessuna avvertenza) e il nome e' obbligatorio.
  const base = DEFAULT_CLIENT_STATUS.find(d => d.key === key)
    || { ...DEFAULT_CLIENT_STATUS[0], label: key, descrizione: '', colore: 'gray', avviso: '' }
  return {
    key,
    label: (raw.label ?? '').trim() || base.label,
    descrizione: raw.descrizione ?? base.descrizione,
    colore: clientStatusColor(raw.colore ?? base.colore).id,
    avviso: raw.avviso ?? base.avviso,
    avviso_livello: (['info', 'attenzione', 'critico'] as AvvisoLivello[]).includes(raw.avviso_livello as AvvisoLivello)
      ? (raw.avviso_livello as AvvisoLivello)
      : base.avviso_livello,
    badge_visibile: raw.badge_visibile !== false,
    ordine: typeof raw.ordine === 'number' ? raw.ordine : base.ordine,
  }
}

/**
 * Normalizza una lista qualsiasi: i 4 status di sistema ci sono sempre, gli
 * status personalizzati vengono dopo, tutti con i campi completi.
 */
export function normalizeClientStatus(raw: unknown): ClientStatusDef[] {
  const list = Array.isArray(raw) ? (raw as Partial<ClientStatusDef>[]) : []
  const builtin = (BUILTIN_STATUS_KEYS as readonly string[])
    .map(key => withDefaults(list.find(r => r?.key === key) || {}, key))
  const custom = list
    .filter(r => typeof r?.key === 'string' && r.key.trim() && !isBuiltinStatus(r.key))
    .map(r => withDefaults(r, r.key as string))
  // Chiavi duplicate: vince la prima (l'ordine di salvataggio).
  const seen = new Set<string>()
  return [...builtin, ...custom]
    .filter(d => (seen.has(d.key) ? false : (seen.add(d.key), true)))
    .sort((a, b) => a.ordine - b.ordine)
}

/** True se lo status esiste ancora nella configurazione. */
export function statusExists(defs: ClientStatusDef[], key: string | null | undefined): boolean {
  return !!key && defs.some(d => d.key === key)
}

/**
 * Legge la configurazione. Ordine: chiave `client_status` in
 * centralina_pro_config → vecchia tabella `client_status_config` (se qualcuno
 * l'aveva gia' compilata su un altro ambiente) → default.
 */
export async function loadClientStatusConfig(): Promise<ClientStatusDef[]> {
  try {
    const { data } = await supabase
      .from('centralina_pro_config')
      .select('config')
      .eq('id', CONFIG_ROW)
      .maybeSingle()
    const cfg = (data?.config || {}) as Record<string, unknown>
    const stored = cfg[CLIENT_STATUS_CONFIG_KEY]
    if (Array.isArray(stored) && stored.length > 0) return normalizeClientStatus(stored)
  } catch { /* rete KO: si prosegue con i fallback */ }

  // Fallback storico: la tabella dedicata, se esiste ed e' popolata.
  try {
    const { data, error } = await supabase
      .from('client_status_config')
      .select('status_key, label, descrizione, color, ordine')
      .order('ordine')
    if (!error && data && data.length > 0) {
      const rows = data as { status_key: string; label: string; descrizione: string | null; color: string; ordine: number }[]
      return normalizeClientStatus(rows.map(r => ({
        key: r.status_key as ClientStatusKey,
        label: r.label,
        descrizione: r.descrizione || '',
        colore: r.color,
        ordine: r.ordine,
      })))
    }
  } catch { /* tabella assente: e' il caso normale */ }

  return normalizeClientStatus([])
}

/**
 * Salva la configurazione. Read-modify-write sull'intera config della riga
 * 'main': la Centralina scrive sulla stessa riga e non deve perdere nulla.
 */
export async function saveClientStatusConfig(list: ClientStatusDef[]): Promise<void> {
  const { data } = await supabase
    .from('centralina_pro_config')
    .select('config')
    .eq('id', CONFIG_ROW)
    .maybeSingle()
  const existing = (data?.config && typeof data.config === 'object' ? data.config : {}) as Record<string, unknown>
  const { error } = await supabase
    .from('centralina_pro_config')
    .upsert({ id: CONFIG_ROW, config: { ...existing, [CLIENT_STATUS_CONFIG_KEY]: normalizeClientStatus(list) } }, { onConflict: 'id' })
  if (error) throw error
}
