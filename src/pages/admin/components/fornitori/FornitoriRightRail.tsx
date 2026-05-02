/**
 * Right-side rail — semplificato a 4 step.
 * Step 3 (Approvazione) e Step 4 (Pagamento) sono riservati agli amministratori
 * autorizzati (Valerio, Ilenia).
 */
const FLOW_STEPS = [
    { n: '1', label: 'Carica bolle', desc: 'Ogni bolla caricata e classificata' },
    { n: '2', label: 'Controllo incrociato', desc: 'Sistema confronta bolle vs fatture' },
    { n: '3', label: 'Approvazione', desc: 'Solo dopo i controlli si autorizza il pagamento', adminOnly: true },
    { n: '4', label: 'Pagamento', desc: 'Registrazione pagamento + ricevuta', adminOnly: true },
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
                                <p className="text-sm font-semibold text-theme-text-primary">
                                    {s.label}
                                    {s.adminOnly && (
                                        <span className="ml-2 text-[10px] uppercase tracking-wide bg-amber-600/30 text-amber-300 px-2 py-0.5 rounded-full align-middle">
                                            Solo Valerio / Ilenia
                                        </span>
                                    )}
                                </p>
                                <p className="text-xs text-theme-text-secondary">{s.desc}</p>
                            </div>
                        </li>
                    ))}
                </ol>
            </div>
        </aside>
    )
}
