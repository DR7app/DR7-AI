/**
 * Top three info cards for the Fornitori section landing.
 * Matches the design provided by the user.
 */
export default function FornitoriPageHeader() {
    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <InfoCard
                icon="📁"
                title="Digitalizzazione completa"
                desc="Mensile più rapida, bolle digitali sempre accessibili."
                tone="emerald"
            />
            <InfoCard
                icon="🛡"
                title="Controllo e precisione"
                desc="Verifica automatica tra bolle e fatture per pagamenti sicuri."
                tone="blue"
            />
            <InfoCard
                icon="✅"
                title="Conteggio automatico"
                desc="Totali, scadenze e modifiche sempre aggiornati in tempo reale."
                tone="amber"
            />
        </div>
    )
}

function InfoCard({ icon, title, desc, tone }: {
    icon: string
    title: string
    desc: string
    tone: 'emerald' | 'blue' | 'amber'
}) {
    const toneMap = {
        emerald: 'border-emerald-700/40 bg-emerald-900/10',
        blue: 'border-blue-700/40 bg-blue-900/10',
        amber: 'border-amber-700/40 bg-amber-900/10',
    }
    return (
        <div className={`rounded-lg border p-4 ${toneMap[tone]}`}>
            <div className="flex items-start gap-3">
                <span className="text-2xl">{icon}</span>
                <div>
                    <p className="text-sm font-semibold text-theme-text-primary">{title}</p>
                    <p className="text-xs text-theme-text-secondary mt-1">{desc}</p>
                </div>
            </div>
        </div>
    )
}
