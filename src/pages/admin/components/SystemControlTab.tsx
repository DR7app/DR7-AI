// ═══════════════════════════════════════════════════════════════════════════
// DR7 A.I SYSTEM CONTROL — il centro operativo tecnico della piattaforma.
//
// Sette viste: stato generale, problemi, collegamenti, operazioni ferme,
// interruttori, strumenti, prestazioni, storico e rapporti tecnici.
//
// Accesso: direzione o developer. Chiunque altro vede una riga di cortesia,
// non un errore.
// ═══════════════════════════════════════════════════════════════════════════
import { useState } from 'react'
import { useAdminRole } from '../../../hooks/useAdminRole'
import PanoramicaView from './systemcontrol/PanoramicaView'
import ProblemiView from './systemcontrol/ProblemiView'
import IntegrazioniView from './systemcontrol/IntegrazioniView'
import OperazioniView from './systemcontrol/OperazioniView'
import InterruttoriView from './systemcontrol/InterruttoriView'
import StrumentiView from './systemcontrol/StrumentiView'
import PrestazioniView from './systemcontrol/PrestazioniView'
import StoricoView from './systemcontrol/StoricoView'
import IncidentiView from './systemcontrol/IncidentiView'

type Vista = 'panoramica' | 'problemi' | 'integrazioni' | 'operazioni' | 'interruttori' | 'strumenti' | 'prestazioni' | 'storico' | 'incidenti'

const VISTE: { id: Vista; label: string; sottotitolo: string }[] = [
  { id: 'panoramica',   label: 'Stato generale',  sottotitolo: 'Come sta la piattaforma adesso' },
  { id: 'problemi',     label: 'Problemi',        sottotitolo: 'Errori raggruppati, diagnosi e azioni' },
  { id: 'integrazioni', label: 'Collegamenti',    sottotitolo: 'Salute di ogni servizio esterno' },
  { id: 'operazioni',   label: 'Operazioni ferme',sottotitolo: 'Cosa non e andato a buon fine' },
  { id: 'interruttori', label: 'Interruttori',    sottotitolo: 'Spegni o metti in manutenzione una funzione' },
  { id: 'strumenti',    label: 'Strumenti',       sottotitolo: 'Job, cache, account' },
  { id: 'prestazioni',  label: 'Prestazioni',     sottotitolo: 'Cosa e lento e cosa sbaglia' },
  { id: 'storico',      label: 'Storico',         sottotitolo: 'Audit, configurazioni, avvisi, backup' },
  { id: 'incidenti',    label: 'Rapporti tecnici',sottotitolo: 'Da consegnare allo sviluppatore' },
]

export default function SystemControlTab() {
  const { hasRole, loading } = useAdminRole()
  const [vista, setVista] = useState<Vista>('panoramica')
  const [problemaDaAprire, setProblemaDaAprire] = useState<string | null>(null)

  if (loading) return <p className="text-sm text-theme-text-muted">Caricamento...</p>

  if (!hasRole('direzione') && !hasRole('developer')) {
    return (
      <div className="bg-theme-bg-secondary/50 rounded-xl border border-theme-border px-5 py-8 text-center">
        <p className="text-sm text-theme-text-secondary">
          Il System Control e riservato alla direzione e agli sviluppatori.
        </p>
      </div>
    )
  }

  const corrente = VISTE.find(v => v.id === vista)!

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-light text-theme-text-primary">DR7 A.I System Control</h1>
        <p className="text-sm text-theme-text-secondary mt-1 max-w-3xl leading-relaxed">
          Il centro tecnico della piattaforma: qui vedi cosa non funziona spiegato in italiano, cosa il gestionale
          ha gia sistemato da solo, cosa puoi sistemare tu con un pulsante e cosa invece richiede davvero uno
          sviluppatore. Nessuna operazione di questa pagina modifica il codice o cancella dati.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {VISTE.map(v => (
          <button key={v.id} onClick={() => setVista(v.id)} title={v.sottotitolo}
            className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
              vista === v.id
                ? 'bg-[#007aff] text-white border-[#007aff]'
                : 'bg-theme-bg-tertiary text-theme-text-secondary border-theme-border hover:text-theme-text-primary'
            }`}>
            {v.label}
          </button>
        ))}
      </div>

      <p className="text-xs text-theme-text-muted -mt-2">{corrente.sottotitolo}</p>

      {vista === 'panoramica' && (
        <PanoramicaView
          onApriProblema={id => { setProblemaDaAprire(id); setVista('problemi') }}
          onCambiaVista={v => setVista(v as Vista)}
        />
      )}
      {vista === 'problemi' && (
        <ProblemiView idIniziale={problemaDaAprire} onApertoCambiato={id => { if (!id) setProblemaDaAprire(null) }} />
      )}
      {vista === 'integrazioni' && <IntegrazioniView />}
      {vista === 'operazioni' && <OperazioniView />}
      {vista === 'interruttori' && <InterruttoriView />}
      {vista === 'strumenti' && <StrumentiView />}
      {vista === 'prestazioni' && <PrestazioniView />}
      {vista === 'storico' && <StoricoView />}
      {vista === 'incidenti' && <IncidentiView />}
    </div>
  )
}
