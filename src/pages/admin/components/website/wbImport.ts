/**
 * wbImport.ts — porta il sito ATTUALE dentro il Website Builder.
 *
 * Regola numero uno del capitolato: subito dopo l'importazione il sito
 * deve apparire uguale a prima. Per questo l'importazione:
 *
 *  · legge i contenuti reali gia' amministrati (`centralina_pro_config.
 *    config.site_copy`, la stessa fonte che il sito usa oggi), non una
 *    copia scritta a mano;
 *  · ricostruisce la home con le stesse sezioni che ci sono adesso:
 *    lo scorrimento dei video piu' la griglia delle categorie;
 *  · crea tutte le pagine in BOZZA, con l'interruttore "prende il posto
 *    della pagina attuale" SPENTO. Finche' un operatore non lo accende,
 *    il sito continua a servire i componenti React esistenti.
 *
 * Cioe': importare non cambia una virgola di cio' che vede un cliente.
 * E' il passo che rende modificabile quello che c'e', non un restyling.
 */

import { supabase } from '../../../../supabaseClient'
import type {
  WbBlock, WbFooterConfig, WbHeaderConfig, WbItem, WbMenuItem,
  WbPageContent, WbText,
} from './shared/wbSchema'
import { wbId } from './shared/wbSchema'
import { wbCreateBlock } from './wbRegistry'
import {
  wbCreatePage, wbListPages, wbUpdatePage, wbSaveNavigation, wbUpdateSite,
  wbLog, type WbSiteRow,
} from './wbApi'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

const t = (it?: string, en?: string): WbText => ({ it: it || '', en: en || it || '' })

function blocco(type: string, patch: Partial<WbBlock>): WbBlock {
  const b = wbCreateBlock(type)
  if (!b) throw new Error(`Tipo di blocco sconosciuto: ${type}`)
  return {
    ...b,
    ...patch,
    content: { ...(b.content || {}), ...(patch.content || {}) },
    settings: { ...(b.settings || {}), ...(patch.settings || {}) },
    layout: { ...(b.layout || {}), ...(patch.layout || {}) },
    style: { ...(b.style || {}), ...(patch.style || {}) },
  }
}

export interface WbImportResult {
  ok: boolean
  create: string[]
  saltate: string[]
  errore?: string
}

/** Legge la riga di configurazione che alimenta il sito oggi. */
async function leggiSiteCopy(): Promise<Any> {
  const { data, error } = await supabase
    .from('centralina_pro_config').select('config').eq('id', 'main').maybeSingle()
  if (error) throw new Error(error.message)
  return (data?.config as Any)?.site_copy || {}
}

// ─── Home ───────────────────────────────────────────────────────────────────
/**
 * La home attuale: uno scorrimento di video a tutto schermo (senza testo
 * sopra, come oggi) e sotto la griglia delle categorie, con la prima card
 * a doppia larghezza. Il titolo H1 resta nascosto alla vista, esattamente
 * come nel codice attuale.
 */
function costruisciHome(sc: Any): WbPageContent {
  const home = sc.home || {}
  const slides: WbItem[] = Array.isArray(home.hero_slides)
    ? home.hero_slides.map((s: Any) => ({
        id: s.id || wbId('i'),
        video: { url: s.video_src, autoplay: true, loop: true, muted: true, controls: false, preload: 'auto' },
      }))
    : []

  const hero = blocco('hero-slider', {
    name: 'Copertina video',
    content: {
      title: t(home.seo_h1_it, home.seo_h1_en),
      items: slides,
    },
    settings: {
      autoplaySeconds: Number(home.hero_autoplay_seconds ?? 8),
      // Come adesso: il titolo esiste per Google ma non si vede.
      titleVisuallyHidden: true,
    },
    layout: { width: 'full', minHeight: 680, align: 'center', padTop: 0, padBottom: 0, padLeft: 0, padRight: 0 },
    style: { overlayOpacity: 0, bgColor: '#000000' },
  })

  // Le card della home leggono le categorie vere: aggiungerne una in
  // Centralina Pro la fa comparire qui senza toccare la pagina.
  const cards = blocco('categories', {
    name: 'Categorie',
    content: { title: t('', '') },
    dataSource: { kind: 'auto', collection: 'categories' },
    layout: { width: 'contained', columns: 2, gap: 32, padTop: 96, padBottom: 96, padLeft: 24, padRight: 24 },
    style: { bgColor: '#000000' },
    settings: { cardVariant: 'cover', aspectRatio: '16/9', showPrice: false },
  })

  return { sections: [hero, cards] }
}

// ─── Chi siamo ──────────────────────────────────────────────────────────────
function costruisciAbout(sc: Any): WbPageContent | null {
  const a = sc.about
  if (!a) return null
  const sezioni: WbBlock[] = []

  sezioni.push(blocco('heading', {
    name: 'Titolo',
    content: { text: t(a.story_title_it, a.story_title_en) },
    settings: { headingLevel: 1 },
    layout: { width: 'narrow', align: 'center', padTop: 96, padBottom: 24 },
    typography: { preset: 'h1', align: 'center' },
  }))

  const paragrafi = Array.isArray(a.story_paragraphs) ? a.story_paragraphs : []
  if (paragrafi.length) {
    sezioni.push(blocco('text', {
      name: 'Storia',
      content: {
        text: {
          it: paragrafi.map((p: Any) => p.text_it).filter(Boolean).join('\n\n'),
          en: paragrafi.map((p: Any) => p.text_en).filter(Boolean).join('\n\n'),
        },
      },
      layout: { width: 'narrow', padTop: 0, padBottom: 48 },
    }))
  }

  if (a.story_outro_main_it || a.story_outro_sub_it) {
    sezioni.push(blocco('cta', {
      name: 'Chiusura',
      content: {
        title: t(a.story_outro_main_it, a.story_outro_main_en),
        text: t(a.story_outro_sub_it, a.story_outro_sub_en),
        buttons: [],
      },
      layout: { align: 'center', padTop: 24, padBottom: 64 },
    }))
  }

  const fondatori = Array.isArray(a.founders) ? a.founders : []
  if (fondatori.length) {
    sezioni.push(blocco('cards', {
      name: 'Fondatori',
      content: {
        items: fondatori.map((f: Any) => ({
          id: f.id || wbId('i'),
          title: t(f.name, f.name),
          subtitle: t(f.role_it, f.role_en),
          image: { url: f.photo_src, alt: t(f.alt_it, f.alt_en) },
        })),
      },
      dataSource: { kind: 'manual' },
      layout: { columns: Math.min(3, fondatori.length), gap: 32, padTop: 48, padBottom: 96 },
      settings: { cardVariant: 'boxed', aspectRatio: '3/4', showPrice: false },
    }))
  }

  return { sections: sezioni }
}

// ─── FAQ ────────────────────────────────────────────────────────────────────
function costruisciFaq(sc: Any): WbPageContent | null {
  const raw = sc.faq
  if (!raw) return null
  const entries: Any[] = Array.isArray(raw) ? raw : (Array.isArray(raw.entries) ? raw.entries : [])
  if (!entries.length) return null
  const meta = Array.isArray(raw) ? {} : raw
  return {
    sections: [
      blocco('faq', {
        name: 'Domande frequenti',
        content: {
          eyebrow: t(meta.eyebrow_it, meta.eyebrow_en),
          title: t(meta.page_title_it || 'Domande frequenti', meta.page_title_en || 'FAQ'),
          subtitle: t(meta.subtitle_it, meta.subtitle_en),
          items: entries.map((e: Any) => ({
            id: e.id || wbId('i'),
            title: t(e.question, e.question_en || e.question),
            text: t(e.answer, e.answer_en || e.answer),
          })),
        },
        settings: { headingLevel: 1, firstOpen: true, multiple: false },
        layout: { align: 'center', padTop: 96, padBottom: 96 },
      }),
    ],
  }
}

// ─── Contatti ───────────────────────────────────────────────────────────────
function costruisciContatti(sc: Any): WbPageContent | null {
  const c = sc.contact
  const f = sc.footer || {}
  if (!c && !f.contact_company_name) return null
  const sezioni: WbBlock[] = [
    blocco('contact', {
      name: 'Modulo contatti',
      content: {
        title: t(c?.page_title_it || 'Contattaci', c?.page_title_en || 'Contact us'),
        subtitle: t(c?.subtitle_it, c?.subtitle_en),
      },
      settings: { headingLevel: 1 },
      layout: { width: 'narrow', padTop: 96, padBottom: 48 },
    }),
  ]
  if (f.contact_legal_address_it) {
    sezioni.push(blocco('map', {
      name: 'Dove siamo',
      content: { address: f.contact_operative_address_it || f.contact_legal_address_it },
      layout: { minHeight: 380, padTop: 0, padBottom: 96 },
    }))
  }
  return { sections: sezioni }
}

// ─── Navigazione ────────────────────────────────────────────────────────────
/**
 * L'alberatura reale di dr7.app, la stessa che l'onglet Sito gia' usa.
 * Viene preparata ma NON attivata: il sito continua a disegnare il suo
 * header e il suo footer finche' gli interruttori nelle Impostazioni
 * globali restano spenti.
 */
function costruisciHeader(sc: Any): WbHeaderConfig {
  const h = sc.header || {}
  const voce = (label: string, en: string, href: string): WbMenuItem =>
    ({ id: wbId('m'), label: t(label, en), kind: 'page', href, visible: true })

  return {
    items: [
      {
        id: wbId('m'),
        label: t(h.explore_label_it || 'Esplora', h.explore_label_en || 'Explore'),
        kind: 'group',
        mega: true,
        visible: true,
        children: [
          voce(h.menu_mobilita_title_it || 'Mobilita', h.menu_mobilita_title_en || 'Mobility', '/flotta'),
          voce(h.menu_mare_title_it || 'Mare', h.menu_mare_title_en || 'Sea', '/noleggio-mare'),
          voce(h.menu_aria_title_it || 'Aria', h.menu_aria_title_en || 'Air', '/noleggio-aria'),
          voce(h.menu_property_title_it || 'Soggiorni', h.menu_property_title_en || 'Stays', '/soggiorni'),
          voce(h.menu_servizi_title_it || 'Lavaggio e Meccanica', h.menu_servizi_title_en || 'Wash & Mechanics', '/prime-wash'),
          voce(h.menu_club_title_it || 'DR7 Club', h.menu_club_title_en || 'DR7 Club', '/membership'),
        ],
      },
      voce(h.credit_wallet_label_it || 'Credit Wallet', h.credit_wallet_label_en || 'Credit Wallet', '/credit-wallet'),
      voce(h.contact_cta_it || 'Contattaci', h.contact_cta_en || 'Contact us', '/contact'),
    ],
    settings: {
      align: 'left',
      sticky: true,
      transparent: true,
      showLanguage: true,
      showLogin: true,
      mobileMode: 'drawer',
    },
  }
}

function costruisciFooter(sc: Any): WbFooterConfig {
  const f = sc.footer || {}
  const colonna = (titolo: string, links: Any[]): { id: string; title: WbText; items: WbMenuItem[] } => ({
    id: wbId('col'),
    title: t(titolo),
    items: (links || []).map((l: Any) => ({
      id: wbId('m'),
      label: t(l.label_it || l.label, l.label_en || l.label),
      kind: (String(l.href || '').startsWith('http') ? 'url' : 'page') as WbMenuItem['kind'],
      href: l.href || l.to || '/',
      visible: true,
    })),
  })

  return {
    columns: [
      colonna('Divisioni', f.division_links || []),
      colonna('Azienda', f.corporate_links || []),
      colonna('Legale', f.legal_links || []),
    ].filter((c) => c.items.length > 0),
    settings: {
      text: t(f.network_text_it, f.network_text_en),
      copyright: t(f.bottom_copyright_it || f.bottom_copyright, f.bottom_copyright_en || f.bottom_copyright),
      showSocial: true,
      showNewsletter: false,
    },
  }
}

// ─── Importazione ───────────────────────────────────────────────────────────
export async function wbImportSitoAttuale(site: WbSiteRow): Promise<WbImportResult> {
  const create: string[] = []
  const saltate: string[] = []
  try {
    const sc = await leggiSiteCopy()
    const esistenti = await wbListPages(site.id)
    const gia = new Set(esistenti.map((p) => p.slug))

    const daCreare: { slug: string; title: string; content: WbPageContent | null; isHome?: boolean; seoTitle?: WbText; seoDescr?: WbText }[] = [
      {
        slug: '/', title: 'Home', isHome: true, content: costruisciHome(sc),
        seoTitle: t(sc.home?.seo_h1_it, sc.home?.seo_h1_en),
      },
      { slug: '/about', title: 'Chi Siamo', content: costruisciAbout(sc) },
      { slug: '/faq', title: 'Domande frequenti', content: costruisciFaq(sc) },
      { slug: '/contact', title: 'Contatti', content: costruisciContatti(sc) },
    ]

    for (const p of daCreare) {
      if (!p.content) { saltate.push(`${p.title} (nessun contenuto da importare)`); continue }
      if (gia.has(p.slug)) { saltate.push(`${p.title} (esiste gia')`); continue }
      const riga = await wbCreatePage(site.id, {
        slug: p.slug,
        title: p.title,
        content: p.content,
        isHome: p.isHome,
        seo: {
          title: p.seoTitle,
          description: p.seoDescr,
          robotsIndex: true,
          robotsFollow: true,
        },
      })
      if (riga) {
        // Bozza + interruttore spento: il sito non cambia.
        await wbUpdatePage(riga.id, { status: 'draft', overrides_route: false })
        create.push(p.title)
      } else {
        saltate.push(`${p.title} (creazione non riuscita)`)
      }
    }

    await wbSaveNavigation(site.id, 'header', costruisciHeader(sc))
    await wbSaveNavigation(site.id, 'footer', costruisciFooter(sc))

    // Dati aziendali riusati da footer, moduli e schede contatto.
    const f = sc.footer || {}
    await wbUpdateSite(site.id, {
      settings: {
        ...(site.settings || {}),
        site_name: f.contact_company_name || site.settings?.site_name || 'DR7 Empire',
        whatsapp: f.contact_whatsapp_number || '',
        whatsapp_url: f.contact_whatsapp_url || '',
        address: f.contact_operative_address_it || f.contact_legal_address_it || '',
        legal_address: f.contact_legal_address_it || '',
        piva: f.contact_piva || '',
        copyright: f.bottom_copyright_it || f.bottom_copyright || '',
        social: Array.isArray(f.social_links)
          ? f.social_links.map((s: Any) => ({ label: s.label || s.name, url: s.href || s.url, icon: s.icon }))
          : [],
        // Gli interruttori che decidono se il sito usa header e footer del
        // builder. Spenti: e' cio' che rende l'importazione a rischio zero.
        use_builder_header: false,
        use_builder_footer: false,
      },
    })

    await wbLog(site.id, 'import.site', 'site', site.id, `Importate ${create.length} pagine`, { create, saltate })
    return { ok: true, create, saltate }
  } catch (e) {
    return { ok: false, create, saltate, errore: e instanceof Error ? e.message : 'Errore' }
  }
}
