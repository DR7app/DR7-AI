/**
 * Bottom horizontal process visualization — 6 step verifica incrociata.
 */
const STEPS = [
    { n: 1, label: 'Carica bolle', desc: 'Ogni bolla viene digitalizzata e caricata' },
    { n: 2, label: 'Carica fatture', desc: 'Fatture ricevute dal fornitore' },
    { n: 3, label: 'Abbinamento', desc: 'Sistema collega fatture ↔ bolle dello stesso mese' },
    { n: 4, label: 'Verifica', desc: 'Confronto importi, segnale di anomalia se non quadrano' },
    { n: 5, label: 'Approvazione', desc: 'Verifica e approvazione amministrazione' },
    { n: 6, label: 'Pagamento', desc: 'Registrazione pagamento e archiviazione' },
]

export default function FornitoriProcessFlow() {
    return (
        <div className="bg-theme-bg-secondary border border-theme-border rounded-lg p-4">
            <p className="text-sm font-semibold text-theme-text-primary uppercase tracking-wide mb-4 text-center">
                Processo di verifica incrociata
            </p>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
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
