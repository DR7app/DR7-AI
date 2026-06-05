/**
 * SocialLinksTab — sub-tab top-level dentro la sezione Marketing.
 *
 * Era un sub-tab annidato dentro CampagnaMarketingTab; spostato fuori
 * perché concettualmente non appartiene alle campagne (configura URL
 * usati ovunque nel sistema), e perché trovarlo nascosto in un sub-tab
 * di un altro tab non era intuitivo.
 *
 * Storage: centralina_pro_config.config.marketing.* (chiave singleton).
 * I consumer (cron compleanno, review request, manuale BirthdaysTab,
 * ecc.) leggono via getMarketingConfig() o lettura diretta.
 */
import { useEffect, useState } from 'react'
import { supabase } from '../../../supabaseClient'
import Button from './Button'
import toast from 'react-hot-toast'

interface CustomLink {
    id: string
    title: string
    url: string
}

interface MarketingConfig {
    website_url: string
    google_review_link: string
    instagram_url: string
    facebook_url: string
    custom_links: CustomLink[]
}

const MARKETING_DEFAULTS: MarketingConfig = {
    website_url: 'https://dr7.app',
    google_review_link: 'https://g.page/r/CQwgJt7OYpsfEBM/review',
    instagram_url: 'https://instagram.com/dr7empire',
    facebook_url: 'https://facebook.com/dr7empire',
    custom_links: [],
}

function uid(): string {
    return Math.random().toString(36).slice(2, 10)
}

function slugifyTitle(title: string): string {
    return title.toLowerCase().trim()
        .replace(/[^a-z0-9\s-_]/g, '')
        .replace(/[\s-]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '')
        .substring(0, 30) || 'link'
}

export default function SocialLinksTab() {
    const [marketing, setMarketing] = useState<MarketingConfig>(MARKETING_DEFAULTS)
    const [savedMarketing, setSavedMarketing] = useState<MarketingConfig>(MARKETING_DEFAULTS)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        (async () => {
            const { data, error } = await supabase
                .from('centralina_pro_config')
                .select('config')
                .eq('id', 'main')
                .maybeSingle()
            if (!error && data) {
                const m = (data.config as Record<string, unknown> | null)?.marketing as Partial<MarketingConfig> | undefined
                if (m) {
                    const rawCustom = Array.isArray(m.custom_links) ? m.custom_links as Partial<CustomLink>[] : []
                    const value: MarketingConfig = {
                        website_url: typeof m.website_url === 'string' ? m.website_url : MARKETING_DEFAULTS.website_url,
                        google_review_link: typeof m.google_review_link === 'string' ? m.google_review_link : MARKETING_DEFAULTS.google_review_link,
                        instagram_url: typeof m.instagram_url === 'string' ? m.instagram_url : MARKETING_DEFAULTS.instagram_url,
                        facebook_url: typeof m.facebook_url === 'string' ? m.facebook_url : MARKETING_DEFAULTS.facebook_url,
                        custom_links: rawCustom
                            .filter((l): l is CustomLink => typeof l?.title === 'string' && typeof l?.url === 'string')
                            .map(l => ({ id: l.id || uid(), title: l.title, url: l.url })),
                    }
                    setMarketing(value)
                    setSavedMarketing(value)
                }
            }
            setLoading(false)
        })()
    }, [])

    const isDirty = JSON.stringify(marketing) !== JSON.stringify(savedMarketing)
    const update = (patch: Partial<MarketingConfig>) => setMarketing({ ...marketing, ...patch })

    async function handleSave() {
        setSaving(true)
        try {
            // Re-read the latest config so we don't clobber other sections
            // (Centralina Pro: categories, fasce, insurance, etc.)
            const { data: row, error: readErr } = await supabase
                .from('centralina_pro_config')
                .select('config')
                .eq('id', 'main')
                .maybeSingle()
            if (readErr) throw readErr
            const currentConfig = (row?.config as Record<string, unknown>) || {}
            const newConfig = { ...currentConfig, marketing }
            const { error: writeErr } = await supabase
                .from('centralina_pro_config')
                .upsert({ id: 'main', config: newConfig }, { onConflict: 'id' })
            if (writeErr) throw writeErr
            setSavedMarketing(marketing)
            toast.success('Social links aggiornati')
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'errore sconosciuto'
            toast.error(`Errore salvataggio: ${msg}`)
        } finally {
            setSaving(false)
        }
    }

    function handleDiscard() {
        setMarketing(savedMarketing)
    }

    if (loading) {
        return <div className="text-theme-text-muted text-sm py-8 text-center">Caricamento...</div>
    }

    return (
        <div className="space-y-6">
            <div className="bg-theme-bg-secondary/50 p-4 rounded-lg border border-theme-border">
                <h2 className="text-xl font-bold text-theme-text-primary">Social Links</h2>
                <p className="text-theme-text-muted text-sm">
                    Configura i link a sito, Google Review e social. Vengono usati nei messaggi di recensione e disponibili come variabili nei template di sistema.
                </p>
            </div>

            <div className="bg-theme-bg-secondary/50 p-4 rounded-lg border border-theme-border">
                <h3 className="text-base font-semibold text-theme-text-primary mb-1">Come usarli nei messaggi</h3>
                <ul className="text-[13px] text-theme-text-secondary space-y-1">
                    <li>• Ogni link ha la sua variabile mostrata accanto al campo (es. <code className="text-dr7-gold">{'{website}'}</code>, <code className="text-dr7-gold">{'{review_link}'}</code>, <code className="text-dr7-gold">{'{instagram}'}</code>, <code className="text-dr7-gold">{'{facebook}'}</code>).</li>
                    <li>• Scrivi la variabile dentro un template di Messaggi di Sistema Pro: viene sostituita con l'URL al momento dell'invio.</li>
                    <li>• <b>Link personalizzati</b>: sotto puoi aggiungere link extra (es. TikTok, YouTube). Ogni titolo crea automaticamente una nuova variabile <code className="text-dr7-gold">{'{<slug>}'}</code> che appare anche nella legenda di Messaggi di Sistema Pro.</li>
                </ul>
                <p className="text-[12px] text-theme-text-muted mt-2">Le modifiche sono effettive subito sul sito e nei messaggi (lettura live, niente cache).</p>
            </div>

            <div className="bg-theme-bg-tertiary p-5 rounded-lg border border-theme-border space-y-4 max-w-2xl">
                <FixedLinkRow
                    label="Sito web"
                    variableName="website"
                    value={marketing.website_url}
                    placeholder="https://dr7.app"
                    onChange={(v) => update({ website_url: v })}
                />

                <FixedLinkRow
                    label="Link Google Review"
                    variableName="review_link"
                    value={marketing.google_review_link}
                    placeholder="https://g.page/r/.../review"
                    onChange={(v) => update({ google_review_link: v })}
                    hint="Inserito automaticamente nei messaggi di richiesta recensione."
                />

                <FixedLinkRow
                    label="Instagram"
                    variableName="instagram"
                    value={marketing.instagram_url}
                    placeholder="https://instagram.com/dr7empire"
                    onChange={(v) => update({ instagram_url: v })}
                />

                <FixedLinkRow
                    label="Facebook"
                    variableName="facebook"
                    value={marketing.facebook_url}
                    placeholder="https://facebook.com/dr7empire"
                    onChange={(v) => update({ facebook_url: v })}
                />

                {/* Link personalizzati — admin puo' aggiungere/modificare/eliminare
                    qualsiasi numero di link aggiuntivi (es. TikTok, YouTube,
                    LinkedIn, link prodotti specifici, ecc.). Ogni link diventa
                    una variabile {<slug>} usabile nei template di Messaggi
                    di Sistema Pro (slug = lowercase + underscore del titolo). */}
                <div className="border-t border-theme-border pt-4 mt-4">
                    <div className="flex items-center justify-between mb-2">
                        <div>
                            <h4 className="text-sm font-semibold text-theme-text-primary">Link personalizzati</h4>
                            <p className="text-[11px] text-theme-text-muted">Aggiungi link extra (TikTok, YouTube, ecc.). Ogni link diventa una variabile <code className="text-dr7-gold">{'{slug}'}</code> nei template.</p>
                        </div>
                        <button
                            type="button"
                            onClick={() => update({ custom_links: [...marketing.custom_links, { id: uid(), title: '', url: '' }] })}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-dr7-gold/15 text-dr7-gold border border-dr7-gold/40 hover:bg-dr7-gold/25 transition-colors"
                        >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/></svg>
                            Aggiungi link
                        </button>
                    </div>

                    {marketing.custom_links.length === 0 ? (
                        <div className="text-[12px] text-theme-text-muted italic py-3 text-center bg-theme-bg-primary/40 rounded-lg border border-dashed border-theme-border">
                            Nessun link personalizzato. Premi "Aggiungi link" per crearne uno.
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {marketing.custom_links.map((link, idx) => {
                                const slug = link.title.trim() ? slugifyTitle(link.title) : ''
                                return (
                                    <div key={link.id} className="grid grid-cols-[1fr_2fr_auto] gap-2 items-start bg-theme-bg-primary/60 rounded-lg p-2.5 border border-theme-border">
                                        <div>
                                            <input
                                                type="text"
                                                value={link.title}
                                                onChange={(e) => {
                                                    const next = [...marketing.custom_links]
                                                    next[idx] = { ...next[idx], title: e.target.value }
                                                    update({ custom_links: next })
                                                }}
                                                placeholder="Titolo (es. TikTok)"
                                                className="w-full px-2 py-1.5 rounded-md bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-xs focus:outline-none focus:ring-1 focus:ring-dr7-gold/40"
                                            />
                                            {slug && (
                                                <div className="text-[10px] text-theme-text-muted mt-1">
                                                    Variabile: <code className="text-dr7-gold">{`{${slug}}`}</code>
                                                </div>
                                            )}
                                        </div>
                                        <input
                                            type="url"
                                            value={link.url}
                                            onChange={(e) => {
                                                const next = [...marketing.custom_links]
                                                next[idx] = { ...next[idx], url: e.target.value }
                                                update({ custom_links: next })
                                            }}
                                            placeholder="https://..."
                                            className="w-full px-2 py-1.5 rounded-md bg-theme-bg-tertiary border border-theme-border text-theme-text-primary text-xs focus:outline-none focus:ring-1 focus:ring-dr7-gold/40"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => update({ custom_links: marketing.custom_links.filter(l => l.id !== link.id) })}
                                            className="px-2 py-1.5 rounded-md bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 transition-colors"
                                            title="Elimina"
                                        >
                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                                        </button>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>

                <div className="flex justify-end gap-2 pt-2">
                    <Button variant="secondary" onClick={handleDiscard} disabled={!isDirty || saving}>
                        Annulla
                    </Button>
                    <Button onClick={handleSave} disabled={!isDirty || saving}>
                        {saving ? 'Salvataggio...' : 'Salva'}
                    </Button>
                </div>
            </div>
        </div>
    )
}

/**
 * FixedLinkRow — input per uno dei 4 link "fissi" (Sito, Review, IG, FB).
 * Cestino svuota il campo (URL → '') che fa sparire la variabile dai
 * messaggi inviati. Salva confermare il vuoto.
 */
function FixedLinkRow({
    label,
    variableName,
    value,
    placeholder,
    onChange,
    hint,
}: {
    label: string
    variableName: string
    value: string
    placeholder: string
    onChange: (v: string) => void
    hint?: string
}) {
    return (
        <label className="block">
            <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-medium uppercase tracking-wide text-theme-text-muted">{label}</span>
                <code className="text-[10px] text-dr7-gold bg-dr7-gold/10 border border-dr7-gold/30 px-1.5 py-0.5 rounded">{`{${variableName}}`}</code>
            </div>
            <div className="flex gap-2">
                <input
                    type="url"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={placeholder}
                    className="flex-1 px-3 py-2 rounded-lg bg-theme-bg-primary border border-theme-border text-theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-dr7-gold/40"
                />
                <button
                    type="button"
                    onClick={() => onChange('')}
                    disabled={!value}
                    className="px-2 py-2 rounded-lg bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    title="Svuota campo (poi salva per confermare)"
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                </button>
            </div>
            {hint && <p className="text-[11px] text-theme-text-muted mt-1.5">{hint}</p>}
        </label>
    )
}
