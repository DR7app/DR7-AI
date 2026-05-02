/**
 * Horizontal process visualization — 4-step flow.
 * Step 3 (Approvazione) e Step 4 (Pagamento) sono riservati agli amministratori
 * autorizzati (Valerio, Ilenia).
 */
const STEPS = [
    { n: 1, label: 'Carica bolle', desc: 'Carica le bolle/DDT in PDF' },
    { n: 2, label: 'Controllo incrociato', desc: 'Confronto automatico bolle vs fatture dello stesso mese' },
    { n: 3, label: 'Approvazione', desc: 'Autorizzazione al pagamento', adminOnly: true },
    { n: 4, label: 'Pagamento', desc: 'Registrazione pagamento + ricevuta', adminOnly: true },
]

export default function FornitoriProcessFlow() {
    return (
        <div className="bg-theme-bg-secondary border border-theme-border rounded-lg p-4">
            <p className="text-sm font-semibold text-theme-text-primary uppercase tracking-wide mb-3 text-center">
                Flusso operativo
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
                            {s.adminOnly && (
                                <p className="text-[10px] uppercase tracking-wide bg-amber-600/30 text-amber-300 px-2 py-0.5 rounded-full inline-block mb-1">
                                    Solo amministratore
                                </p>
                            )}
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
