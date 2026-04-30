/**
 * Right-side rail visualizing the operative flow + key features.
 * Mirrors the design screenshot.
 */
const FLOW_STEPS = [
    { n: '1', label: 'Registrazione fornitore', desc: 'Inserimento anagrafica con condizioni di pagamento' },
    { n: '2', label: 'Caricamento bolle', desc: 'Ogni bolla caricata e classificata' },
    { n: '3', label: 'Caricamento fatture', desc: 'Fatture ricevute dal fornitore' },
    { n: '4', label: 'Controllo incrociato', desc: 'Sistema confronta automaticamente bolle vs fatture' },
    { n: '5', label: 'Approvazione', desc: 'Solo dopo i controlli si autorizza il pagamento' },
    { n: '6', label: 'Pagamento', desc: 'Registrazione pagamento + ricevuta' },
    { n: '7', label: 'Tutto tracciato e archiviato', desc: 'Storico completo, conformità fiscale' },
]

const FEATURES = [
    { ic: '📤', label: 'Caricamento documenti', desc: 'Bolle e fatture in PDF, JPG, PNG' },
    { ic: '🔍', label: 'Riconoscimento automatico', desc: 'Estrai e confronta importi automaticamente' },
    { ic: '⏰', label: 'Scadenze e promemoria', desc: 'Avvisi puntuali sulle scadenze imminenti' },
    { ic: '📊', label: 'Report intelligenti', desc: 'KPI, anomalie, andamento per fornitore' },
    { ic: '🗄', label: 'Storico completo', desc: 'Tracciabilità di ogni operazione' },
]

export default function FornitoriRightRail() {
    return (
        <aside className="space-y-4">
            <div className="bg-blue-950/30 border border-blue-800/50 rounded-lg p-4">
                <p className="text-sm font-semibold text-blue-200 uppercase tracking-wide mb-3">
                    Flusso operativo completo
                </p>
                <ol className="space-y-3">
                    {FLOW_STEPS.map(s => (
                        <li key={s.n} className="flex gap-3">
                            <span className="flex-shrink-0 w-7 h-7 rounded-full bg-dr7-gold text-black text-xs font-bold flex items-center justify-center">
                                {s.n}
                            </span>
                            <div>
                                <p className="text-sm font-semibold text-theme-text-primary">{s.label}</p>
                                <p className="text-xs text-theme-text-secondary">{s.desc}</p>
                            </div>
                        </li>
                    ))}
                </ol>
            </div>

            <div className="bg-blue-950/30 border border-blue-800/50 rounded-lg p-4">
                <p className="text-sm font-semibold text-blue-200 uppercase tracking-wide mb-3">
                    Funzionalità chiave
                </p>
                <ul className="space-y-3">
                    {FEATURES.map((f, i) => (
                        <li key={i} className="flex gap-3 items-start">
                            <span className="text-xl flex-shrink-0">{f.ic}</span>
                            <div>
                                <p className="text-sm font-semibold text-theme-text-primary">{f.label}</p>
                                <p className="text-xs text-theme-text-secondary">{f.desc}</p>
                            </div>
                        </li>
                    ))}
                </ul>
            </div>
        </aside>
    )
}
