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

interface MarketingConfig {
    website_url: string
    google_review_link: string
    instagram_url: string
    facebook_url: string
}

const MARKETING_DEFAULTS: MarketingConfig = {
    website_url: 'https://dr7empire.com',
    google_review_link: 'https://g.page/r/CQwgJt7OYpsfEBM/review',
    instagram_url: 'https://instagram.com/dr7empire',
    facebook_url: 'https://facebook.com/dr7empire',
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
                    const value: MarketingConfig = {
                        website_url: typeof m.website_url === 'string' ? m.website_url : MARKETING_DEFAULTS.website_url,
                        google_review_link: typeof m.google_review_link === 'string' ? m.google_review_link : MARKETING_DEFAULTS.google_review_link,
                        instagram_url: typeof m.instagram_url === 'string' ? m.instagram_url : MARKETING_DEFAULTS.instagram_url,
                        facebook_url: typeof m.facebook_url === 'string' ? m.facebook_url : MARKETING_DEFAULTS.facebook_url,
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
                <h3 className="text-base font-semibold text-theme-text-primary mb-1">Dove vengono usati questi link</h3>
                <ul className="text-[13px] text-theme-text-secondary space-y-1">
                    <li>• <b>Google Review</b>: nei messaggi automatici di richiesta recensione (WhatsApp + email).</li>
                    <li>• <b>Sito / Instagram / Facebook</b>: disponibili come variabili in qualsiasi template di Messaggi di Sistema Pro (es. <code className="text-dr7-gold">{'{website_url}'}</code>, <code className="text-dr7-gold">{'{instagram_url}'}</code>).</li>
                </ul>
                <p className="text-[12px] text-theme-text-muted mt-2">Le modifiche si propagano sito + funzioni server entro ~60 secondi (cache TTL).</p>
            </div>

            <div className="bg-theme-bg-tertiary p-5 rounded-lg border border-theme-border space-y-4 max-w-2xl">
                <label className="block">
                    <span className="block text-[11px] font-medium uppercase tracking-wide text-theme-text-muted mb-1">Sito web</span>
                    <input
                        type="url"
                        value={marketing.website_url}
                        onChange={(e) => update({ website_url: e.target.value })}
                        placeholder="https://dr7empire.com"
                        className="w-full px-3 py-2 rounded-lg bg-theme-bg-primary border border-theme-border text-theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-dr7-gold/40"
                    />
                </label>

                <label className="block">
                    <span className="block text-[11px] font-medium uppercase tracking-wide text-theme-text-muted mb-1">Link Google Review</span>
                    <input
                        type="url"
                        value={marketing.google_review_link}
                        onChange={(e) => update({ google_review_link: e.target.value })}
                        placeholder="https://g.page/r/.../review"
                        className="w-full px-3 py-2 rounded-lg bg-theme-bg-primary border border-theme-border text-theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-dr7-gold/40"
                    />
                    <p className="text-[11px] text-theme-text-muted mt-1.5">Inserito automaticamente nei messaggi di richiesta recensione.</p>
                </label>

                <label className="block">
                    <span className="block text-[11px] font-medium uppercase tracking-wide text-theme-text-muted mb-1">Instagram</span>
                    <input
                        type="url"
                        value={marketing.instagram_url}
                        onChange={(e) => update({ instagram_url: e.target.value })}
                        placeholder="https://instagram.com/dr7empire"
                        className="w-full px-3 py-2 rounded-lg bg-theme-bg-primary border border-theme-border text-theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-dr7-gold/40"
                    />
                </label>

                <label className="block">
                    <span className="block text-[11px] font-medium uppercase tracking-wide text-theme-text-muted mb-1">Facebook</span>
                    <input
                        type="url"
                        value={marketing.facebook_url}
                        onChange={(e) => update({ facebook_url: e.target.value })}
                        placeholder="https://facebook.com/dr7empire"
                        className="w-full px-3 py-2 rounded-lg bg-theme-bg-primary border border-theme-border text-theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-dr7-gold/40"
                    />
                </label>

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
