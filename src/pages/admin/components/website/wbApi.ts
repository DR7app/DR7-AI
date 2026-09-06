/**
 * wbApi.ts — l'unico punto da cui il Website Builder parla col database.
 *
 * Nessun componente dell'interfaccia scrive direttamente su Supabase: se
 * domani cambia lo schema si tocca solo questo file. Tutte le funzioni
 * restituiscono dati gia' normalizzati e non lanciano mai per un problema
 * di rete — l'interfaccia mostra un avviso, non una pagina bianca.
 *
 * La migrazione `supabase/migrations/20260904_website_builder.sql` deve
 * essere stata eseguita. Finche' non lo e', `wbMigrazioneEseguita()`
 * restituisce false e la tab lo dice esplicitamente invece di riempirsi
 * di errori.
 */

import { supabase } from '../../../../supabaseClient'
import type {
  WbHeaderConfig, WbFooterConfig, WbOverlay, WbPageContent,
  WbScript, WbSeo, WbSnapshot, WbTheme, WbThemeTokens,
} from './shared/wbSchema'
// La normalizzazione degli indirizzi e' una regola pura: vive nel file
// condiviso perche' vada provata senza tirarsi dietro il client Supabase.
import { wbNormalizeSlug } from './shared/wbSchema'

export const WB_SITE_KEY = 'dr7'
export const WB_TENANT = 'dr7'
export const WB_BUCKET = 'website-media'

// ─── Tipi di riga ───────────────────────────────────────────────────────────
export interface WbSiteRow {
  id: string
  tenant_id: string
  key: string
  name: string
  domain: string | null
  favicon_url: string | null
  default_locale: string
  locales: string[]
  settings: Record<string, unknown>
  active_theme_id: string | null
  published_version_id: string | null
  published_at: string | null
  updated_at: string
}

export interface WbPageRow {
  id: string
  site_id: string
  slug: string
  title: string
  status: 'draft' | 'scheduled' | 'published' | 'archived'
  is_home: boolean
  overrides_route: boolean
  sort_order: number
  seo: WbSeo
  draft_content: WbPageContent
  published_content: WbPageContent | null
  scheduled_at: string | null
  unpublish_at: string | null
  published_at: string | null
  last_edited_by: string | null
  last_edited_at: string | null
  created_at: string
  updated_at: string
}

export interface WbMediaRow {
  id: string
  site_id: string
  kind: 'image' | 'video' | 'icon' | 'document'
  folder: string
  filename: string
  storage_path: string | null
  url: string
  mime: string | null
  size_bytes: number | null
  width: number | null
  height: number | null
  alt: { it?: string; en?: string }
  title: string | null
  caption: { it?: string; en?: string }
  focal_x: number
  focal_y: number
  tags: string[]
  video_poster_url: string | null
  created_at: string
}

export interface WbVersionRow {
  id: string
  site_id: string
  number: number
  label: string | null
  note: string | null
  summary: Record<string, unknown>
  author: string | null
  restored_from: string | null
  created_at: string
}

export interface WbTemplateRow {
  id: string
  site_id: string
  kind: 'section' | 'page'
  name: string
  description: string | null
  preview_url: string | null
  payload: unknown
  created_by: string | null
  created_at: string
}

export interface WbAuditRow {
  id: number
  action: string
  object_type: string | null
  object_label: string | null
  author: string | null
  meta: Record<string, unknown>
  created_at: string
}

// ─── Diagnostica ────────────────────────────────────────────────────────────
let migrazioneOk: boolean | null = null

/** La migrazione e' stata eseguita? Una sola verifica per sessione. */
export async function wbMigrazioneEseguita(): Promise<boolean> {
  if (migrazioneOk !== null) return migrazioneOk
  const { error } = await supabase.from('wb_sites').select('id').limit(1)
  // 42P01 = tabella inesistente. Un errore di permessi invece significa
  // che la migrazione c'e' ma questo operatore non ha il diritto: e' un
  // caso diverso e va detto in modo diverso.
  migrazioneOk = !(error && (error.code === '42P01' || /does not exist/i.test(error.message)))
  return migrazioneOk
}

// ─── Sito ───────────────────────────────────────────────────────────────────
export async function wbGetSite(): Promise<WbSiteRow | null> {
  const { data, error } = await supabase
    .from('wb_sites')
    .select('*')
    .eq('tenant_id', WB_TENANT)
    .eq('key', WB_SITE_KEY)
    .maybeSingle()
  if (error) { console.error('[wb] wbGetSite', error); return null }
  return (data as WbSiteRow) || null
}

export async function wbUpdateSite(id: string, patch: Partial<WbSiteRow>): Promise<boolean> {
  const { error } = await supabase.from('wb_sites').update(patch).eq('id', id)
  if (error) { console.error('[wb] wbUpdateSite', error); return false }
  return true
}

// ─── Pagine ─────────────────────────────────────────────────────────────────
export async function wbListPages(siteId: string): Promise<WbPageRow[]> {
  const { data, error } = await supabase
    .from('wb_pages')
    .select('*')
    .eq('site_id', siteId)
    .order('sort_order', { ascending: true })
    .order('slug', { ascending: true })
  if (error) { console.error('[wb] wbListPages', error); return [] }
  return (data as WbPageRow[]) || []
}

export async function wbGetPage(id: string): Promise<WbPageRow | null> {
  const { data, error } = await supabase.from('wb_pages').select('*').eq('id', id).maybeSingle()
  if (error) { console.error('[wb] wbGetPage', error); return null }
  return (data as WbPageRow) || null
}

export interface WbCreatePageInput {
  slug: string
  title: string
  content?: WbPageContent
  seo?: WbSeo
  isHome?: boolean
}

export async function wbCreatePage(siteId: string, input: WbCreatePageInput): Promise<WbPageRow | null> {
  const { data, error } = await supabase
    .from('wb_pages')
    .insert({
      site_id: siteId,
      slug: wbNormalizeSlug(input.slug),
      title: input.title,
      is_home: !!input.isHome,
      status: 'draft',
      draft_content: input.content || { sections: [] },
      seo: input.seo || { robotsIndex: true, robotsFollow: true },
      created_by: await wbCurrentUser(),
      last_edited_by: await wbCurrentUser(),
      last_edited_at: new Date().toISOString(),
    })
    .select()
    .single()
  if (error) { console.error('[wb] wbCreatePage', error); return null }
  await wbLog(siteId, 'page.create', 'page', data.id, input.title)
  return data as WbPageRow
}

export async function wbUpdatePage(id: string, patch: Partial<WbPageRow>): Promise<boolean> {
  const body: Record<string, unknown> = { ...patch }
  if (patch.slug) body.slug = wbNormalizeSlug(patch.slug)
  body.last_edited_by = await wbCurrentUser()
  body.last_edited_at = new Date().toISOString()
  const { error } = await supabase.from('wb_pages').update(body).eq('id', id)
  if (error) { console.error('[wb] wbUpdatePage', error); throw new Error(wbErrore(error)) }
  return true
}

/** Salvataggio della sola bozza: e' cio' che fa anche il salvataggio automatico. */
export async function wbSaveDraft(id: string, content: WbPageContent): Promise<boolean> {
  return wbUpdatePage(id, { draft_content: content })
}

export async function wbDeletePage(siteId: string, id: string, label: string): Promise<boolean> {
  const { error } = await supabase.from('wb_pages').delete().eq('id', id)
  if (error) { console.error('[wb] wbDeletePage', error); return false }
  await wbLog(siteId, 'page.delete', 'page', id, label)
  return true
}

export async function wbDuplicatePage(siteId: string, page: WbPageRow): Promise<WbPageRow | null> {
  const base = wbNormalizeSlug(`${page.slug === '/' ? '/home' : page.slug}-copia`)
  const existing = await wbListPages(siteId)
  let slug = base
  let n = 2
  while (existing.some((p) => p.slug === slug)) { slug = `${base}-${n}`; n += 1 }
  return wbCreatePage(siteId, {
    slug,
    title: `${page.title} (copia)`,
    content: JSON.parse(JSON.stringify(page.draft_content)),
    seo: JSON.parse(JSON.stringify(page.seo || {})),
  })
}

/**
 * Una sola home per sito: il vincolo esiste anche nel database
 * (indice parziale), qui si toglie il flag alla precedente prima di
 * metterlo alla nuova, altrimenti l'aggiornamento verrebbe respinto.
 */
export async function wbSetHome(siteId: string, pageId: string): Promise<boolean> {
  const { error: e1 } = await supabase
    .from('wb_pages').update({ is_home: false })
    .eq('site_id', siteId).eq('is_home', true)
  if (e1) { console.error('[wb] wbSetHome/reset', e1); return false }
  const { error: e2 } = await supabase.from('wb_pages').update({ is_home: true }).eq('id', pageId)
  if (e2) { console.error('[wb] wbSetHome/set', e2); return false }
  await wbLog(siteId, 'page.set_home', 'page', pageId, '')
  return true
}

// ─── Temi ───────────────────────────────────────────────────────────────────
export async function wbListThemes(siteId: string): Promise<WbTheme[]> {
  const { data, error } = await supabase
    .from('wb_themes').select('id, name, tokens, is_builtin')
    .eq('site_id', siteId).order('created_at', { ascending: true })
  if (error) { console.error('[wb] wbListThemes', error); return [] }
  return (data as WbTheme[]) || []
}

export async function wbCreateTheme(siteId: string, name: string, tokens: WbThemeTokens): Promise<WbTheme | null> {
  const { data, error } = await supabase
    .from('wb_themes')
    .insert({ site_id: siteId, name, tokens, created_by: await wbCurrentUser() })
    .select('id, name, tokens').single()
  if (error) { console.error('[wb] wbCreateTheme', error); return null }
  await wbLog(siteId, 'theme.create', 'theme', data.id, name)
  return data as WbTheme
}

export async function wbUpdateTheme(id: string, patch: { name?: string; tokens?: WbThemeTokens }): Promise<boolean> {
  const { error } = await supabase.from('wb_themes').update(patch).eq('id', id)
  if (error) { console.error('[wb] wbUpdateTheme', error); return false }
  return true
}

export async function wbDeleteTheme(siteId: string, id: string, name: string): Promise<boolean> {
  const { error } = await supabase.from('wb_themes').delete().eq('id', id)
  if (error) { console.error('[wb] wbDeleteTheme', error); return false }
  await wbLog(siteId, 'theme.delete', 'theme', id, name)
  return true
}

export async function wbSetActiveTheme(siteId: string, themeId: string, name: string): Promise<boolean> {
  const ok = await wbUpdateSite(siteId, { active_theme_id: themeId })
  if (ok) await wbLog(siteId, 'theme.activate', 'theme', themeId, name)
  return ok
}

// ─── Navigazione ────────────────────────────────────────────────────────────
export async function wbGetNavigation(siteId: string, key: 'header' | 'footer'): Promise<{ draft: unknown; published: unknown } | null> {
  const { data, error } = await supabase
    .from('wb_navigation').select('draft, published')
    .eq('site_id', siteId).eq('key', key).maybeSingle()
  if (error) { console.error('[wb] wbGetNavigation', error); return null }
  return (data as { draft: unknown; published: unknown }) || null
}

export async function wbSaveNavigation(
  siteId: string, key: 'header' | 'footer', draft: WbHeaderConfig | WbFooterConfig,
): Promise<boolean> {
  const { error } = await supabase
    .from('wb_navigation')
    .upsert({ site_id: siteId, key, draft, updated_by: await wbCurrentUser() }, { onConflict: 'site_id,key' })
  if (error) { console.error('[wb] wbSaveNavigation', error); throw new Error(wbErrore(error)) }
  return true
}

// ─── Media ──────────────────────────────────────────────────────────────────
export interface WbMediaFilter {
  kind?: WbMediaRow['kind'] | 'all'
  folder?: string
  search?: string
  tag?: string
  limit?: number
}

export async function wbListMedia(siteId: string, filter: WbMediaFilter = {}): Promise<WbMediaRow[]> {
  let q = supabase.from('wb_media').select('*').eq('site_id', siteId)
  if (filter.kind && filter.kind !== 'all') q = q.eq('kind', filter.kind)
  if (filter.folder) q = q.eq('folder', filter.folder)
  if (filter.tag) q = q.contains('tags', [filter.tag])
  if (filter.search) q = q.ilike('filename', `%${filter.search}%`)
  q = q.order('created_at', { ascending: false }).limit(filter.limit || 300)
  const { data, error } = await q
  if (error) { console.error('[wb] wbListMedia', error); return [] }
  return (data as WbMediaRow[]) || []
}

export const WB_MAX_IMAGE_MB = 12
export const WB_MAX_VIDEO_MB = 200
export const WB_MIME_OK = [
  'image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif', 'image/svg+xml',
  'video/mp4', 'video/webm', 'video/quicktime',
  'application/pdf', 'font/woff', 'font/woff2',
]

function kindOf(mime: string): WbMediaRow['kind'] {
  if (mime.startsWith('video/')) return 'video'
  if (mime === 'image/svg+xml') return 'icon'
  if (mime.startsWith('image/')) return 'image'
  return 'document'
}

/**
 * Misura l'immagine prima di caricarla: larghezza e altezza servono al
 * sito per riservare lo spazio (niente salti di layout) e all'editor per
 * avvisare quando una foto e' sproporzionata.
 */
function misuraImmagine(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') return resolve(null)
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve({ width: img.naturalWidth, height: img.naturalHeight }) }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null) }
    img.src = url
  })
}

/**
 * Ridimensiona e comprime le foto troppo grandi prima del caricamento.
 * Un JPEG da 6000 px non serve a nessuno su una pagina web e pesa dieci
 * volte il necessario. SVG, video e documenti passano intatti.
 */
async function ottimizzaImmagine(file: File, maxLato = 2400, qualita = 0.82): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml' || file.type === 'image/gif') return file
  const misure = await misuraImmagine(file)
  if (!misure) return file
  if (misure.width <= maxLato && misure.height <= maxLato && file.size < 900_000) return file
  const scala = Math.min(1, maxLato / Math.max(misure.width, misure.height))
  const w = Math.round(misure.width * scala)
  const h = Math.round(misure.height * scala)
  const bitmap = await createImageBitmap(file).catch(() => null)
  if (!bitmap) return file
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return file
  ctx.drawImage(bitmap, 0, 0, w, h)
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/webp', qualita))
  if (!blob || blob.size >= file.size) return file
  return new File([blob], file.name.replace(/\.\w+$/, '') + '.webp', { type: 'image/webp' })
}

export interface WbUploadResult { ok: boolean; media?: WbMediaRow; error?: string }

export async function wbUploadMedia(
  site: WbSiteRow, file: File, folder = '',
): Promise<WbUploadResult> {
  if (!WB_MIME_OK.includes(file.type)) {
    return { ok: false, error: `Tipo di file non accettato (${file.type || 'sconosciuto'}).` }
  }
  const isVideo = file.type.startsWith('video/')
  const maxMb = isVideo ? WB_MAX_VIDEO_MB : WB_MAX_IMAGE_MB
  if (file.size > maxMb * 1024 * 1024) {
    return { ok: false, error: `File troppo pesante: massimo ${maxMb} MB.` }
  }

  const prepared = await ottimizzaImmagine(file)
  const misure = await misuraImmagine(prepared)
  const safeName = prepared.name.replace(/[^\w.\-]+/g, '_').slice(-90)
  const cartella = folder.replace(/[^\w\-/]+/g, '').replace(/^\/+|\/+$/g, '')
  // Percorso per tenant e per sito: due clienti diversi non condividono
  // nemmeno il prefisso dei file.
  const path = [site.tenant_id, site.key, cartella, `${Date.now()}_${safeName}`]
    .filter(Boolean).join('/')

  const { error: upErr } = await supabase.storage.from(WB_BUCKET)
    .upload(path, prepared, { cacheControl: '31536000', upsert: false, contentType: prepared.type })
  if (upErr) return { ok: false, error: wbErrore(upErr) }

  const { data: pub } = supabase.storage.from(WB_BUCKET).getPublicUrl(path)

  const { data, error } = await supabase.from('wb_media').insert({
    site_id: site.id,
    kind: kindOf(prepared.type),
    folder: cartella,
    filename: prepared.name,
    storage_path: path,
    url: pub.publicUrl,
    mime: prepared.type,
    size_bytes: prepared.size,
    width: misure?.width ?? null,
    height: misure?.height ?? null,
    created_by: await wbCurrentUser(),
  }).select().single()
  if (error) {
    // La riga non e' entrata: si toglie anche il file, altrimenti resta
    // un orfano che nessuna interfaccia mostrera' mai.
    await supabase.storage.from(WB_BUCKET).remove([path])
    return { ok: false, error: wbErrore(error) }
  }
  return { ok: true, media: data as WbMediaRow }
}

export async function wbUpdateMedia(id: string, patch: Partial<WbMediaRow>): Promise<boolean> {
  const { error } = await supabase.from('wb_media').update(patch).eq('id', id)
  if (error) { console.error('[wb] wbUpdateMedia', error); return false }
  return true
}

/**
 * Cancella un media.
 *
 * Il file viene tolto dallo storage SOLO se non e' citato da nessuna
 * versione pubblicata: una versione vecchia deve poter essere
 * ripristinata con le sue immagini. Se e' ancora citato, sparisce dalla
 * libreria ma il file resta.
 */
export async function wbDeleteMedia(siteId: string, media: WbMediaRow): Promise<{ ok: boolean; fileTenuto?: boolean }> {
  const usato = await wbMediaUsatoInVersioni(siteId, media.url)
  const { error } = await supabase.from('wb_media').delete().eq('id', media.id)
  if (error) { console.error('[wb] wbDeleteMedia', error); return { ok: false } }
  if (!usato && media.storage_path) {
    await supabase.storage.from(WB_BUCKET).remove([media.storage_path])
  }
  await wbLog(siteId, 'media.delete', 'media', media.id, media.filename, { fileTenuto: usato })
  return { ok: true, fileTenuto: usato }
}

async function wbMediaUsatoInVersioni(siteId: string, url: string): Promise<boolean> {
  if (!url) return false
  const { data, error } = await supabase
    .from('wb_versions').select('snapshot').eq('site_id', siteId)
    .order('created_at', { ascending: false }).limit(30)
  if (error || !data) return true // nel dubbio si tiene il file
  return (data as { snapshot: unknown }[]).some((v) => JSON.stringify(v.snapshot).includes(url))
}

/** Sostituisce il file di un media tenendo lo stesso indirizzo pubblico. */
export async function wbReplaceMedia(site: WbSiteRow, media: WbMediaRow, file: File): Promise<WbUploadResult> {
  if (!media.storage_path) return { ok: false, error: 'Media senza percorso: caricane uno nuovo.' }
  if (!WB_MIME_OK.includes(file.type)) return { ok: false, error: 'Tipo di file non accettato.' }
  const prepared = await ottimizzaImmagine(file)
  const misure = await misuraImmagine(prepared)
  const { error: upErr } = await supabase.storage.from(WB_BUCKET)
    .upload(media.storage_path, prepared, { upsert: true, cacheControl: '3600', contentType: prepared.type })
  if (upErr) return { ok: false, error: wbErrore(upErr) }
  await wbUpdateMedia(media.id, {
    mime: prepared.type, size_bytes: prepared.size,
    width: misure?.width ?? null, height: misure?.height ?? null,
  })
  await wbLog(site.id, 'media.replace', 'media', media.id, media.filename)
  return { ok: true, media: { ...media, mime: prepared.type, size_bytes: prepared.size } }
}

export async function wbMediaFolders(siteId: string): Promise<string[]> {
  const { data, error } = await supabase.from('wb_media').select('folder').eq('site_id', siteId)
  if (error || !data) return []
  const set = new Set<string>()
  for (const r of data as { folder: string }[]) if (r.folder) set.add(r.folder)
  return [...set].sort()
}

// ─── Popup / banner / promozioni ────────────────────────────────────────────
export async function wbListOverlays(siteId: string, kind?: WbOverlay['kind']): Promise<WbOverlay[]> {
  let q = supabase.from('wb_overlays').select('*').eq('site_id', siteId)
  if (kind) q = q.eq('kind', kind)
  const { data, error } = await q.order('sort_order').order('created_at', { ascending: false })
  if (error) { console.error('[wb] wbListOverlays', error); return [] }
  return (data as WbOverlay[]) || []
}

export async function wbSaveOverlay(siteId: string, o: Partial<WbOverlay> & { kind: WbOverlay['kind']; name: string }): Promise<WbOverlay | null> {
  const body = {
    site_id: siteId, kind: o.kind, name: o.name,
    status: o.status || 'draft',
    config: o.config || {}, targeting: o.targeting || {},
    starts_at: o.starts_at || null, ends_at: o.ends_at || null,
    sort_order: o.sort_order ?? 0,
  }
  const q = o.id
    ? supabase.from('wb_overlays').update(body).eq('id', o.id).select().single()
    : supabase.from('wb_overlays').insert({ ...body, created_by: await wbCurrentUser() }).select().single()
  const { data, error } = await q
  if (error) { console.error('[wb] wbSaveOverlay', error); throw new Error(wbErrore(error)) }
  await wbLog(siteId, o.id ? 'overlay.update' : 'overlay.create', o.kind, data.id, o.name)
  return data as WbOverlay
}

export async function wbDeleteOverlay(siteId: string, id: string, name: string): Promise<boolean> {
  const { error } = await supabase.from('wb_overlays').delete().eq('id', id)
  if (error) { console.error('[wb] wbDeleteOverlay', error); return false }
  await wbLog(siteId, 'overlay.delete', 'overlay', id, name)
  return true
}

// ─── Script e integrazioni ──────────────────────────────────────────────────
export async function wbListScripts(siteId: string): Promise<(WbScript & { enabled: boolean })[]> {
  const { data, error } = await supabase.from('wb_scripts').select('*').eq('site_id', siteId).order('created_at')
  if (error) { console.error('[wb] wbListScripts', error); return [] }
  return (data as (WbScript & { enabled: boolean })[]) || []
}

export async function wbSaveScript(siteId: string, s: Partial<WbScript> & { enabled?: boolean; id?: string }): Promise<boolean> {
  const body = {
    site_id: siteId, name: s.name || 'Script', provider: s.provider || null,
    placement: s.placement || 'body_end', code: s.code || '',
    consent_category: s.consent_category || 'marketing', enabled: !!s.enabled,
  }
  const q = s.id
    ? supabase.from('wb_scripts').update(body).eq('id', s.id)
    : supabase.from('wb_scripts').insert({ ...body, created_by: await wbCurrentUser() })
  const { error } = await q
  if (error) { console.error('[wb] wbSaveScript', error); throw new Error(wbErrore(error)) }
  await wbLog(siteId, s.id ? 'script.update' : 'script.create', 'script', s.id || '', body.name)
  return true
}

export async function wbDeleteScript(siteId: string, id: string, name: string): Promise<boolean> {
  const { error } = await supabase.from('wb_scripts').delete().eq('id', id)
  if (error) { console.error('[wb] wbDeleteScript', error); return false }
  await wbLog(siteId, 'script.delete', 'script', id, name)
  return true
}

// ─── Modelli ────────────────────────────────────────────────────────────────
export async function wbListTemplates(siteId: string, kind?: 'section' | 'page'): Promise<WbTemplateRow[]> {
  let q = supabase.from('wb_templates').select('*').eq('site_id', siteId)
  if (kind) q = q.eq('kind', kind)
  const { data, error } = await q.order('created_at', { ascending: false })
  if (error) { console.error('[wb] wbListTemplates', error); return [] }
  return (data as WbTemplateRow[]) || []
}

export async function wbSaveTemplate(siteId: string, kind: 'section' | 'page', name: string, payload: unknown, description?: string): Promise<boolean> {
  const { error } = await supabase.from('wb_templates').insert({
    site_id: siteId, kind, name, description: description || null,
    payload, created_by: await wbCurrentUser(),
  })
  if (error) { console.error('[wb] wbSaveTemplate', error); throw new Error(wbErrore(error)) }
  await wbLog(siteId, 'template.create', kind, '', name)
  return true
}

export async function wbDeleteTemplate(siteId: string, id: string, name: string): Promise<boolean> {
  const { error } = await supabase.from('wb_templates').delete().eq('id', id)
  if (error) { console.error('[wb] wbDeleteTemplate', error); return false }
  await wbLog(siteId, 'template.delete', 'template', id, name)
  return true
}

// ─── Versioni, pubblicazione, ripristino ────────────────────────────────────
export async function wbListVersions(siteId: string, limit = 60): Promise<WbVersionRow[]> {
  const { data, error } = await supabase
    .from('wb_versions')
    .select('id, site_id, number, label, note, summary, author, restored_from, created_at')
    .eq('site_id', siteId).order('number', { ascending: false }).limit(limit)
  if (error) { console.error('[wb] wbListVersions', error); return [] }
  return (data as WbVersionRow[]) || []
}

export async function wbGetVersionSnapshot(id: string): Promise<WbSnapshot | null> {
  const { data, error } = await supabase.from('wb_versions').select('snapshot').eq('id', id).maybeSingle()
  if (error) { console.error('[wb] wbGetVersionSnapshot', error); return null }
  return (data?.snapshot as WbSnapshot) || null
}

export interface WbPublishResult { ok: boolean; number?: number; pages?: number; error?: string }

/**
 * Pubblica. Tutto il lavoro sta nella funzione SQL: una transazione sola,
 * quindi il sito non puo' mostrare meta' vecchio e meta' nuovo. Se
 * fallisce, resta online l'ultima versione valida.
 */
export async function wbPublish(siteId: string, label?: string, note?: string, pageIds?: string[]): Promise<WbPublishResult> {
  const { data, error } = await supabase.rpc('wb_publish_site', {
    p_site_id: siteId,
    p_label: label || null,
    p_note: note || null,
    p_page_ids: pageIds && pageIds.length ? pageIds : null,
  })
  if (error) return { ok: false, error: wbErrore(error) }
  const r = data as { number: number; pages: number }
  return { ok: true, number: r?.number, pages: r?.pages }
}

export async function wbRestore(versionId: string): Promise<WbPublishResult> {
  const { data, error } = await supabase.rpc('wb_restore_version', { p_version_id: versionId })
  if (error) return { ok: false, error: wbErrore(error) }
  const r = data as { number: number }
  return { ok: true, number: r?.number }
}

/** Anteprima: l'istantanea costruita sulle BOZZE, mai sul pubblicato. */
export async function wbPreviewSnapshot(siteId: string): Promise<WbSnapshot | null> {
  const { data, error } = await supabase.rpc('wb_preview_site', { p_site_id: siteId })
  if (error) { console.error('[wb] wbPreviewSnapshot', error); return null }
  return (data as WbSnapshot) || null
}

// ─── Registro operazioni ────────────────────────────────────────────────────
export async function wbListAudit(siteId: string, limit = 80): Promise<WbAuditRow[]> {
  const { data, error } = await supabase
    .from('wb_audit_log')
    .select('id, action, object_type, object_label, author, meta, created_at')
    .eq('site_id', siteId).order('created_at', { ascending: false }).limit(limit)
  if (error) { console.error('[wb] wbListAudit', error); return [] }
  return (data as WbAuditRow[]) || []
}

export async function wbLog(
  siteId: string, action: string, objectType: string, objectId: string,
  label: string, meta: Record<string, unknown> = {},
): Promise<void> {
  // Il registro non deve mai far fallire l'operazione che sta tracciando.
  try {
    await supabase.from('wb_audit_log').insert({
      site_id: siteId, action, object_type: objectType,
      object_id: objectId || null, object_label: label || null,
      author: await wbCurrentUser(), meta,
    })
  } catch (e) {
    console.warn('[wb] audit', e)
  }
}

// ─── Utilita' ───────────────────────────────────────────────────────────────
let cachedUser: string | null = null
export async function wbCurrentUser(): Promise<string> {
  if (cachedUser) return cachedUser
  const { data } = await supabase.auth.getUser()
  cachedUser = data.user?.email || 'sconosciuto'
  return cachedUser
}

/** Messaggio d'errore leggibile. I codici Postgres non dicono niente all'operatore. */
export function wbErrore(error: { message?: string; code?: string } | null): string {
  if (!error) return 'Errore sconosciuto'
  const m = error.message || ''
  if (error.code === '23505' || /duplicate key/i.test(m)) return 'Esiste gia un elemento con questo indirizzo.'
  if (error.code === '42501' || /permission denied|row-level security/i.test(m)) {
    return 'Permesso negato: chiedi alla direzione il diritto sul Website Builder.'
  }
  if (error.code === '42P01') return 'La migrazione del Website Builder non e ancora stata eseguita.'
  if (/Permesso negato/i.test(m)) return m
  if (/Pubblicazione annullata/i.test(m)) return m
  return m || 'Errore'
}

// Riesportata per comodita' di chi importa dal livello dati.
export { wbNormalizeSlug }
