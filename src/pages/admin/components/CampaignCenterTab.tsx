/**
 * CampaignCenterTab
 *
 * Placeholder. Il modulo verrà portato dal repo DR7-campaign-center e
 * integrato con Green API + customers_extended + system_messages.
 */
export default function CampaignCenterTab() {
    return (
        <div className="p-6 sm:p-10">
            <div className="max-w-2xl mx-auto rounded-3xl border border-theme-border bg-theme-bg-secondary p-8 sm:p-12 text-center">
                <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-dr7-gold/15 text-dr7-gold mb-5">
                    <svg className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 0 0 4.486-6.336l-3.276 3.277a3.004 3.004 0 0 1-2.25-2.25l3.276-3.276a4.5 4.5 0 0 0-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437 1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008Z" />
                    </svg>
                </div>
                <h2 className="text-2xl font-bold text-theme-text-primary mb-2">Campaign Center</h2>
                <p className="text-sm text-theme-text-muted leading-relaxed mb-4">
                    Modulo in lavorazione. Verrà portato dal repo&nbsp;
                    <code className="px-1.5 py-0.5 bg-theme-bg-tertiary rounded text-dr7-gold font-mono text-xs">DR7-campaign-center</code>
                    &nbsp;e collegato alla tua Green API + lista clienti + Messaggi di Sistema Pro.
                </p>
                <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/15 text-amber-400 text-xs font-semibold">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                    </svg>
                    Lavori in corso
                </span>
            </div>
        </div>
    )
}
