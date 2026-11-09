import { useEffect, useState } from 'react'
import { supabase } from '../../../supabaseClient'
import {
    AUDIENCE_MESSAGGI_SISTEMA, LIMITE_MESSAGGI_ORA, FASCIA_ORA_DA, FASCIA_ORA_A, FINESTRA_MINUTI,
    riepilogoCodaMessaggio, formattaDataOraRoma, inFasciaInvio,
    type CampagnaInCoda, type RiepilogoCodaMessaggio,
} from '../../../utils/campagneFrequenza'

// 09/11/2026 (direzione): "Tutti i clienti" passa dalla coda degli invii
// massivi, la stessa delle Campagne Marketing (50 l'ora per le due strade
// insieme, 9-21 ora di Roma, il resto il giorno dopo). Qui lo stato della
// coda per UN messaggio: in coda, inviati, falliti, fine stimata.

const ORA = (h: number) => `${String(h).padStart(2, '0')}:00`
const COLONNE = 'id, created_at, status, total_recipients, sent_count, failed_count, audience, audience_filters, completed_at'

interface UltimoGiro { created_at: string; completed_at: string | null; status: string | null; sent_count: number | null; failed_count: number | null; total_recipients: number | null }

export default function CodaTuttiIClientiStato({ templateId }: { templateId: string }) {
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
                    // Tutta la coda (campagne + messaggi di sistema): serve alla fine stimata.
                    supabase.from('marketing_campaigns').select(COLONNE)
                        .in('status', ['pending', 'sending'])
                        .order('created_at', { ascending: true })
                        .limit(200),
                    supabase.from('marketing_campaigns').select(COLONNE)
                        .eq('audience', AUDIENCE_MESSAGGI_SISTEMA)
                        .eq('audience_filters->>system_message_id', templateId)
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
                setRiepilogo(riepilogoCodaMessaggio((attive.data || []) as CampagnaInCoda[], templateId))
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
    }, [templateId])

    return (
        <div className="rounded-md border border-cyan-500/30 bg-cyan-50 dark:bg-cyan-500/5 px-3 py-2 space-y-1">
            <p className="text-[11px] text-theme-text-primary">
                Invio automatico in coda: massimo {LIMITE_MESSAGGI_ORA} messaggi l'ora insieme alle Campagne Marketing (stesso numero WhatsApp), solo dalle {ORA(FASCIA_ORA_DA)} alle {ORA(FASCIA_ORA_A)} ora italiana. Quello che non parte oggi continua il giorno dopo alle {ORA(FASCIA_ORA_DA)}.
            </p>
            {errore && <p className="text-[11px] text-red-600 dark:text-red-400">Stato coda non disponibile: {errore}</p>}
            {riepilogo && riepilogo.inCoda > 0 && (
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-theme-text-secondary">
                    <span>In coda: <span className="font-semibold text-theme-text-primary">{riepilogo.inCoda}</span></span>
                    <span>Inviati: <span className="font-semibold text-theme-text-primary">{riepilogo.inviati}</span></span>
                    {riepilogo.falliti > 0 && <span>Falliti/saltati: <span className="font-semibold text-theme-text-primary">{riepilogo.falliti}</span></span>}
                    {riepilogo.davanti > 0 && <span>Prima di questo, da altre campagne: {riepilogo.davanti}</span>}
                    {inviatiOra != null && <span>Inviati nell'ultima ora (tutti): {inviatiOra}/{LIMITE_MESSAGGI_ORA}</span>}
                    {riepilogo.fineStimata && <span>Fine stimata: <span className="font-semibold text-theme-text-primary">{formattaDataOraRoma(riepilogo.fineStimata)}</span></span>}
                    {!inFasciaInvio() && <span>Fuori fascia: riparte alle {ORA(FASCIA_ORA_DA)}</span>}
                </div>
            )}
            {riepilogo && riepilogo.inCoda === 0 && ultimo && (
                <p className="text-[11px] text-theme-text-muted">
                    Ultimo invio: {formattaDataOraRoma(new Date(ultimo.created_at))}, {ultimo.sent_count || 0} inviati su {ultimo.total_recipients || 0}
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
