import { useEffect, useState } from 'react'
import { supabase } from '../../../supabaseClient'
import {
    AUDIENCE_PROMO_AUTOMATICHE, LIMITE_MESSAGGI_ORA, FASCIA_ORA_DA, FASCIA_ORA_A, FINESTRA_MINUTI,
    riepilogoCodaPromo, formattaDataOraRoma, inFasciaInvio,
    type CampagnaInCoda, type RiepilogoCodaMessaggio, type TipoPromoAutomatica,
} from '../../../utils/campagneFrequenza'

// 09/11/2026 (direzione): il modo "broadcast" di Promo Incassi e Maxi Promo
// Gap passa dalla coda degli invii massivi, la stessa di Campagne Marketing e
// Messaggi Sistema Pro "Tutti i clienti" (50 l'ora tutti insieme, 9-21 ora di
// Roma, il resto il giorno dopo). Qui lo stato della coda per UNA promo, come
// CodaTuttiIClientiStato per i messaggi di sistema.

const ORA = (h: number) => `${String(h).padStart(2, '0')}:00`
const COLONNE = 'id, title, created_at, status, total_recipients, sent_count, failed_count, audience, audience_filters, completed_at'

interface UltimoGiro { title: string | null; created_at: string; completed_at: string | null; status: string | null; sent_count: number | null; failed_count: number | null; total_recipients: number | null }

export default function CodaPromoStato({ promo }: { promo: TipoPromoAutomatica }) {
    const [riepilogo, setRiepilogo] = useState<RiepilogoCodaMessaggio | null>(null)
    const [inviatiOra, setInviatiOra] = useState<number | null>(null)
    const [ultimo, setUltimo] = useState<UltimoGiro | null>(null)
    const [errore, setErrore] = useState<string | null>(null)

    useEffect(() => {
        let attivo = true
        async function carica() {
            try {
                const sinceIso = new Date(Date.now() - FINESTRA_MINUTI * 60_000).toISOString()
                const [attive, giri, inviati] = await Promise.all([
                    // Tutta la coda (campagne, messaggi di sistema, promo): serve alla fine stimata.
                    supabase.from('marketing_campaigns').select(COLONNE)
                        .in('status', ['pending', 'sending'])
                        .order('created_at', { ascending: true })
                        .limit(200),
                    supabase.from('marketing_campaigns').select(COLONNE)
                        .eq('audience', AUDIENCE_PROMO_AUTOMATICHE)
                        .eq('audience_filters->>promo', promo)
                        .order('created_at', { ascending: false })
                        .limit(1),
                    supabase.from('marketing_campaign_recipients')
                        .select('id', { count: 'exact', head: true })
                        .eq('status', 'sent')
                        .gte('sent_at', sinceIso),
                ])
                if (attive.error) throw attive.error
                if (giri.error) throw giri.error
                if (!attivo) return
                setRiepilogo(riepilogoCodaPromo((attive.data || []) as CampagnaInCoda[], promo))
                setUltimo(((giri.data || [])[0] as UltimoGiro | undefined) || null)
                setInviatiOra(inviati.error ? null : (inviati.count || 0))
                setErrore(null)
            } catch (e: unknown) {
                if (attivo) setErrore(e instanceof Error ? e.message : String(e))
            }
        }
        carica()
        const t = setInterval(carica, 60_000)
        return () => { attivo = false; clearInterval(t) }
    }, [promo])

    return (
        <div className="rounded-md border border-cyan-500/30 bg-cyan-50 dark:bg-cyan-500/5 px-3 py-2 space-y-1">
            <p className="text-[11px] text-theme-text-primary">
                Broadcast in coda: massimo {LIMITE_MESSAGGI_ORA} messaggi l'ora insieme alle Campagne Marketing e ai Messaggi Sistema Pro (stesso numero WhatsApp), solo dalle {ORA(FASCIA_ORA_DA)} alle {ORA(FASCIA_ORA_A)} ora italiana. Quello che non parte oggi continua il giorno dopo alle {ORA(FASCIA_ORA_DA)}. Un giro al giorno per promo; chi e' gia' in coda o l'ha gia' ricevuta non viene accodato di nuovo.
            </p>
            {errore && <p className="text-[11px] text-red-600 dark:text-red-400">Stato coda non disponibile: {errore}</p>}
            {riepilogo && riepilogo.inCoda > 0 && (
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-theme-text-secondary">
                    <span>In coda: <span className="font-semibold text-theme-text-primary">{riepilogo.inCoda}</span></span>
                    <span>Inviati: <span className="font-semibold text-theme-text-primary">{riepilogo.inviati}</span></span>
                    {riepilogo.falliti > 0 && <span>Falliti/saltati: <span className="font-semibold text-theme-text-primary">{riepilogo.falliti}</span></span>}
                    {riepilogo.davanti > 0 && <span>Prima di questa, da altre campagne: {riepilogo.davanti}</span>}
                    {inviatiOra != null && <span>Inviati nell'ultima ora (tutti): {inviatiOra}/{LIMITE_MESSAGGI_ORA}</span>}
                    {riepilogo.fineStimata && <span>Fine stimata: <span className="font-semibold text-theme-text-primary">{formattaDataOraRoma(riepilogo.fineStimata)}</span></span>}
                    {!inFasciaInvio() && <span>Fuori fascia: riparte alle {ORA(FASCIA_ORA_DA)}</span>}
                </div>
            )}
            {riepilogo && riepilogo.inCoda === 0 && ultimo && (
                <p className="text-[11px] text-theme-text-muted">
                    Ultimo giro{ultimo.title ? ` (${ultimo.title})` : ''}: {formattaDataOraRoma(new Date(ultimo.created_at))}, {ultimo.sent_count || 0} inviati su {ultimo.total_recipients || 0}
                    {(ultimo.failed_count || 0) > 0 ? `, ${ultimo.failed_count} falliti o saltati` : ''}
                    {ultimo.status === 'pending' || ultimo.status === 'sending' ? '' : ultimo.completed_at ? ` (completato ${formattaDataOraRoma(new Date(ultimo.completed_at))})` : ''}.
                </p>
            )}
            {riepilogo && riepilogo.inCoda === 0 && !ultimo && (
                <p className="text-[11px] text-theme-text-muted">Nessun invio in coda.</p>
            )}
        </div>
    )
}
