/**
 * Horizontal process visualization — 4-step flow.
 *
 * Le fatture arrivano automaticamente da Aruba SDI; al fornitore basta caricare
 * le bolle, controllare l'incrocio, gestire le scadenze e archiviare il pagamento.
 */
const STEPS = [
    { n: 1, label: 'Carica bolle', desc: 'Carica le bolle/DDT ricevute dal fornitore (PDF, JPG, PNG)' },
    { n: 2, label: 'Controllo incrociato', desc: 'Confronto automatico bolle vs fatture Aruba dello stesso mese, totali e differenze' },
    { n: 3, label: 'Scadenze e pagamento', desc: 'Visualizza scadenze in arrivo, autorizza e registra pagamento + ricevuta' },
    { n: 4, label: 'Archivio', desc: 'Storico completo, conformita\' fiscale, tracciabilita\' di ogni operazione' },
]

export default function FornitoriProcessFlow() {
    return (
        <div className="bg-theme-bg-secondary border border-theme-border rounded-lg p-4">
            <p className="text-sm font-semibold text-theme-text-primary uppercase tracking-wide mb-1 text-center">
                Flusso operativo
            </p>
            <p className="text-xs text-theme-text-muted text-center mb-4">
                Le fatture vengono importate automaticamente da Aruba SDI. Tu carichi solo le bolle, il sistema fa il resto.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                {STEPS.map((s, i) => (
                    <div key={s.n} className="relative">
                        <div className="bg-theme-bg-tertiary/50 border border-theme-border rounded-lg p-3 h-full">
                            <div className="flex items-center gap-2 mb-2">
                                <span className="w-7 h-7 rounded-full bg-dr7-gold text-black text-xs font-bold flex items-center justify-center">
                                    {s.n}
                                </span>
                                <p className="text-sm font-semibold text-theme-text-primary">{s.label}</p>
                            </div>
                            <p className="text-xs text-theme-text-secondary">{s.desc}</p>
                        </div>
                        {i < STEPS.length - 1 && (
                            <div className="hidden md:block absolute top-1/2 -right-2 -translate-y-1/2 text-dr7-gold text-lg font-bold pointer-events-none">→</div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    )
}
