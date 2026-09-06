/**
 * wbData.ts — dai dati veri del gestionale agli elementi di un blocco.
 *
 * ⚠️ FILE CONDIVISO (vedi wbSchema.ts). `npm run wb:sync`.
 *
 * Qui vive la separazione richiesta dal capitolato: il DATO resta del
 * gestionale (veicoli, categorie, listino lavaggio, promozioni), il
 * Website Builder decide soltanto QUALI mostrare e COME. Nessun catalogo
 * viene copiato dentro il builder: se il prezzo cambia in Centralina Pro,
 * cambia sul sito senza toccare la pagina.
 *
 * Una lettura per collezione per pagina, non una per elemento: i blocchi
 * che chiedono la stessa collezione condividono la stessa richiesta.
 */

import type { WbBlock, WbDataSource, WbItem, WbLocale } from './wbSchema'
import { wbId } from './wbSchema'

/** Il minimo che serve: cosi' il file non dipende da @supabase/supabase-js. */
export interface WbSupabaseLike {
  from: (table: string) => {
    select: (cols: string) => any
  }
}

const CATEGORY_ALIASES: Record<string, string[]> = {
  exotic: ['exotic', 'supercars'],
  supercars: ['exotic', 'supercars'],
}

/**
 * Immagine di catalogo servita ridimensionata da Supabase.
 * Stessa trasformazione gia' usata dal sito per il listino lavaggio:
 * evita di scaricare PNG da 1,4 MB per una miniatura.
 */
export function wbOptimized(url: string | null | undefined, width = 800): string {
  if (!url) return ''
  const PUB = '/storage/v1/object/public/'
  if (!url.includes(PUB)) return url
  const base = url.replace(PUB, '/storage/v1/render/image/public/')
  const sep = base.includes('?') ? '&' : '?'
  return `${base}${sep}width=${width}&resize=contain&quality=70`
}

function euro(n: number | null | undefined): string {
  if (n == null || Number.isNaN(Number(n))) return ''
  return `€ ${Number(n).toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pickImage(metadata: any): string {
  const m = metadata || {}
  return m.image || m.image_url || m.hero_image || m.photo || ''
}

// ─── Lettori per collezione ─────────────────────────────────────────────────
async function readVehicles(sb: WbSupabaseLike, ds: WbDataSource): Promise<WbItem[]> {
  let q = (sb.from('vehicles').select('id, display_name, daily_rate, category, status, metadata') as any)
    .neq('status', 'retired')
  if (ds.categoryId) {
    q = q.in('category', CATEGORY_ALIASES[ds.categoryId] || [ds.categoryId])
  }
  if (ds.kind === 'available') q = q.eq('status', 'available')
  if (ds.kind === 'ids' && ds.ids?.length) q = q.in('id', ds.ids)
  q = ds.kind === 'latest'
    ? q.order('created_at', { ascending: false })
    : q.order('display_name', { ascending: true })
  if (ds.limit) q = q.limit(ds.limit)

  const { data, error } = await q
  if (error || !Array.isArray(data)) return []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = data as any[]
  const ordered = ds.kind === 'ids' && ds.ids?.length
    ? ds.ids.map((id) => rows.find((r) => r.id === id)).filter(Boolean)
    : rows
  return ordered.map((v) => ({
    id: String(v.id),
    title: { it: v.display_name, en: v.display_name },
    subtitle: { it: v.category || '', en: v.category || '' },
    price: v.daily_rate ? `${euro(v.daily_rate)} / giorno` : '',
    image: { url: wbOptimized(pickImage(v.metadata)), alt: { it: v.display_name, en: v.display_name } },
    link: { href: `/${v.category || 'flotta'}`, kind: 'page' as const },
    meta: { status: v.status, category: v.category },
  }))
}

async function readCategories(sb: WbSupabaseLike, ds: WbDataSource, lang: WbLocale): Promise<WbItem[]> {
  const { data, error } = await (sb.from('centralina_pro_config').select('config') as any)
    .eq('id', 'main').maybeSingle()
  if (error || !data) return []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cfg = (data as any).config || {}
  const cats = Array.isArray(cfg.categories) ? cfg.categories : []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let list = cats as any[]
  if (ds.kind === 'ids' && ds.ids?.length) {
    list = ds.ids.map((id) => list.find((c) => c.id === id)).filter(Boolean)
  }
  if (ds.limit) list = list.slice(0, ds.limit)
  return list.map((c) => ({
    id: String(c.id),
    title: { it: c.label || c.id, en: c.label_en || c.label || c.id },
    subtitle: { it: '', en: '' },
    image: { url: wbOptimized(c.image || c.image_url || ''), alt: { it: c.label || '', en: c.label || '' } },
    link: { href: `/${c.id}`, kind: 'page' as const },
    meta: { lang },
  }))
}

async function readServices(sb: WbSupabaseLike, ds: WbDataSource): Promise<WbItem[]> {
  let q = (sb.from('car_wash_services')
    .select('id, name, name_en, category, description, description_en, duration, price, display_order, is_active, main_tab, image_url') as any)
    .eq('is_active', true)
  if (ds.business === 'lavaggio') q = q.eq('main_tab', 'lavaggio')
  if (ds.categoryId) q = q.eq('category', ds.categoryId)
  if (ds.kind === 'ids' && ds.ids?.length) q = q.in('id', ds.ids)
  q = q.order('display_order', { ascending: true })
  if (ds.limit) q = q.limit(ds.limit)
  const { data, error } = await q
  if (error || !Array.isArray(data)) return []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any[]).map((s) => ({
    id: String(s.id),
    title: { it: s.name, en: s.name_en || s.name },
    subtitle: { it: s.duration || '', en: s.duration || '' },
    text: { it: s.description || '', en: s.description_en || s.description || '' },
    price: euro(s.price),
    image: { url: wbOptimized(s.image_url || ''), alt: { it: s.name, en: s.name_en || s.name } },
    meta: { category: s.category },
  }))
}

/** Recensioni: le stesse gia' pubblicate sul sito. */
async function readReviews(sb: WbSupabaseLike, ds: WbDataSource): Promise<WbItem[]> {
  const q = (sb.from('reviews').select('id, author_name, rating, comment, created_at') as any)
    .order('created_at', { ascending: false })
    .limit(ds.limit || 6)
  const { data, error } = await q
  if (error || !Array.isArray(data)) return []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any[]).map((r) => ({
    id: String(r.id),
    title: { it: r.author_name || '', en: r.author_name || '' },
    text: { it: r.comment || '', en: r.comment || '' },
    meta: { rating: r.rating ?? 5 },
  }))
}

// ─── Punto d'ingresso ───────────────────────────────────────────────────────
export interface WbResolveOptions {
  /** Promozioni gia' presenti nell'istantanea: non serve una query. */
  promotions?: WbItem[]
  lang?: WbLocale
}

/**
 * Risolve i dati veri per tutti i blocchi che ne hanno bisogno.
 * Non lancia mai: un blocco che non riesce a leggere resta vuoto e la
 * pagina si disegna lo stesso.
 */
export async function wbResolveDynamic(
  sb: WbSupabaseLike,
  blocks: WbBlock[],
  opts: WbResolveOptions = {},
): Promise<Record<string, WbItem[]>> {
  const lang = opts.lang || 'it'
  const out: Record<string, WbItem[]> = {}

  const targets: WbBlock[] = []
  const walk = (list: WbBlock[]) => {
    for (const b of list) {
      if (b.dataSource && b.dataSource.kind !== 'manual') targets.push(b)
      if (b.children?.length) walk(b.children)
    }
  }
  walk(blocks)
  if (!targets.length) return out

  // Blocchi con la stessa richiesta condividono una sola lettura.
  const cache = new Map<string, Promise<WbItem[]>>()
  const keyOf = (ds: WbDataSource) => JSON.stringify([ds.collection, ds.kind, ds.business, ds.categoryId, ds.ids, ds.limit, ds.orderBy])

  await Promise.all(targets.map(async (block) => {
    const ds = block.dataSource!
    const collection = ds.collection
      || (block.type === 'fleet' || block.type === 'vehicles' ? 'vehicles'
        : block.type === 'categories' ? 'categories'
        : block.type === 'services' ? 'services'
        : block.type === 'promotions' ? 'promotions'
        : block.type === 'reviews' ? 'reviews'
        : undefined)
    if (!collection) { out[block.id] = []; return }

    const k = keyOf({ ...ds, collection })
    if (!cache.has(k)) {
      cache.set(k, (async () => {
        try {
          if (collection === 'vehicles') return await readVehicles(sb, ds)
          if (collection === 'categories') return await readCategories(sb, ds, lang)
          if (collection === 'services') return await readServices(sb, ds)
          if (collection === 'reviews') return await readReviews(sb, ds)
          if (collection === 'promotions') return (opts.promotions || []).slice(0, ds.limit || 99)
          return []
        } catch {
          return []
        }
      })())
    }
    out[block.id] = await cache.get(k)!
  }))

  return out
}

/**
 * Le promozioni pubblicate diventano elementi da mostrare in una sezione.
 * Quelle scadute spariscono da sole: la finestra si valuta qui, non a
 * mano dall'operatore.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function wbPromotionItems(overlays: any[], now = Date.now()): WbItem[] {
  return (overlays || [])
    .filter((o) => o.kind === 'promo' && (o.status === 'published' || o.status === 'scheduled'))
    .filter((o) => !o.starts_at || new Date(o.starts_at).getTime() <= now)
    .filter((o) => !o.ends_at || new Date(o.ends_at).getTime() >= now)
    .map((o) => ({
      id: String(o.id || wbId('promo')),
      title: o.config?.title,
      text: o.config?.text,
      image: o.config?.image,
      video: o.config?.video,
      buttons: o.config?.buttons,
      badge: o.config?.badge,
    }))
}
