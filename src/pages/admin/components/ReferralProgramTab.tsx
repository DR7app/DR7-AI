import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'
import toast from 'react-hot-toast'

type ActiveSection = 'overview' | 'participants'

interface SiteReferral {
  referee_user_id: string
  referee_name: string
  referee_email: string | null
  referee_signup_date: string
  referrer_user_id: string
  referrer_name: string
  referrer_code: string | null
  referrer_email: string | null
  bonus_amount: number | null
  bonus_date: string | null
}

interface SiteReferrer {
  user_id: string
  name: string
  email: string | null
  referral_code: string | null
  created_at: string | null
}

export default function ReferralProgramTab() {
  const [activeSection, setActiveSection] = useState<ActiveSection>('overview')
  const [searchQuery, setSearchQuery] = useState('')

  // Panoramica (Referral dal Sito)
  const [siteReferrals, setSiteReferrals] = useState<SiteReferral[]>([])
  const [siteLoading, setSiteLoading] = useState(false)

  // Partecipanti (referrers — customers who invited at least one other user)
  const [referrers, setReferrers] = useState<SiteReferrer[]>([])
  const [referrersLoading, setReferrersLoading] = useState(false)

  useEffect(() => {
    loadSiteReferrals()
    loadReferrers()
  }, [])

  async function callReferralAdmin(action: string, body: Record<string, unknown> = {}) {
    const token = (await supabase.auth.getSession()).data.session?.access_token
    const res = await fetch('/.netlify/functions/referral-admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, ...body }),
    })
    const json = await res.json()
    if (!res.ok || json.error) {
      throw new Error(json.error || `HTTP ${res.status}`)
    }
    return json
  }

  async function loadSiteReferrals() {
    setSiteLoading(true)
    try {
      const json = await callReferralAdmin('site_referrals')
      setSiteReferrals((json.referrals || []) as SiteReferral[])
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[ReferralProgramTab] site referrals error:', err)
      toast.error(`Errore caricamento Panoramica: ${msg}`)
    } finally {
      setSiteLoading(false)
    }
  }

  async function loadReferrers() {
    setReferrersLoading(true)
    try {
      const json = await callReferralAdmin('site_referrers')
      setReferrers((json.referrers || []) as SiteReferrer[])
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[ReferralProgramTab] referrers error:', err)
      toast.error(`Errore caricamento partecipanti: ${msg}`)
    } finally {
      setReferrersLoading(false)
    }
  }

  const filteredReferrers = referrers.filter((r) => {
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    return (
      r.name.toLowerCase().includes(q) ||
      (r.email && r.email.toLowerCase().includes(q)) ||
      (r.referral_code && r.referral_code.toLowerCase().includes(q))
    )
  })

  return (
    <div className="space-y-6">
      {/* Section Toggle */}
      <div className="flex gap-2 flex-wrap">
        {(['overview', 'participants'] as const).map((section) => (
          <button
            key={section}
            onClick={() => setActiveSection(section)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
              activeSection === section
                ? 'bg-dr7-gold text-white'
                : 'bg-theme-bg-secondary text-theme-text-secondary hover:bg-theme-bg-hover'
            }`}
          >
            {section === 'overview' ? 'Panoramica' : 'Partecipanti'}
          </button>
        ))}
      </div>

      {/* === PANORAMICA (Referral dal Sito) === */}
      {activeSection === 'overview' && (
        <div className="animate-fadeIn space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-theme-text-primary font-bold">Referral dal Sito</h3>
              <p className="text-theme-text-muted text-sm">Clienti registrati sul sito che hanno usato il codice di un amico</p>
            </div>
            <button
              onClick={loadSiteReferrals}
              className="px-3 py-1.5 text-sm rounded-lg bg-theme-bg-secondary border border-theme-border text-theme-text-secondary hover:bg-theme-bg-hover"
            >
              Aggiorna
            </button>
          </div>

          {siteLoading ? (
            <div className="text-center py-10 text-theme-text-muted">Caricamento...</div>
          ) : siteReferrals.length === 0 ? (
            <div className="text-center py-10 text-theme-text-muted">Nessun referral dal sito</div>
          ) : (
            <div className="bg-theme-bg-secondary border border-theme-border rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-theme-bg-tertiary border-b border-theme-border">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-theme-text-secondary">Referente</th>
                    <th className="text-left px-4 py-3 font-medium text-theme-text-secondary">Codice</th>
                    <th className="text-left px-4 py-3 font-medium text-theme-text-secondary">Amico Invitato</th>
                    <th className="text-left px-4 py-3 font-medium text-theme-text-secondary">Registrato</th>
                    <th className="text-right px-4 py-3 font-medium text-theme-text-secondary">Bonus Pagato</th>
                  </tr>
                </thead>
                <tbody>
                  {siteReferrals.map((r) => {
                    const signedUp = new Date(r.referee_signup_date).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' })
                    return (
                      <tr key={r.referee_user_id} className="border-b border-theme-border last:border-b-0 hover:bg-theme-bg-hover">
                        <td className="px-4 py-3">
                          <div className="text-theme-text-primary font-medium">{r.referrer_name}</div>
                          {r.referrer_email && <div className="text-theme-text-muted text-xs">{r.referrer_email}</div>}
                        </td>
                        <td className="px-4 py-3 font-mono text-theme-text-secondary text-xs">{r.referrer_code || '-'}</td>
                        <td className="px-4 py-3">
                          <div className="text-theme-text-primary">{r.referee_name}</div>
                          {r.referee_email && <div className="text-theme-text-muted text-xs">{r.referee_email}</div>}
                        </td>
                        <td className="px-4 py-3 text-theme-text-secondary">{signedUp}</td>
                        <td className="px-4 py-3 text-right">
                          {r.bonus_amount !== null ? (
                            <span className="text-green-400 font-semibold">+€{r.bonus_amount.toFixed(2)}</span>
                          ) : (
                            <span className="text-theme-text-muted text-xs">In attesa ricarica</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!siteLoading && siteReferrals.length > 0 && (
            <div className="grid grid-cols-3 gap-4">
              <StatCard label="Inviti totali" value={siteReferrals.length} />
              <StatCard label="Bonus erogati" value={siteReferrals.filter(r => r.bonus_amount !== null).length} />
              <StatCard
                label="Totale bonus"
                value={`€${siteReferrals.reduce((s, r) => s + (r.bonus_amount || 0), 0).toFixed(2)}`}
              />
            </div>
          )}
        </div>
      )}

      {/* === PARTECIPANTI (referrers from website) === */}
      {activeSection === 'participants' && (
        <div className="animate-fadeIn space-y-4">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cerca per nome, email, codice..."
            className="w-full px-4 py-3 bg-theme-bg-secondary border border-theme-border rounded-xl text-theme-text-primary placeholder-theme-text-muted focus:border-dr7-gold outline-none"
          />

          {referrersLoading ? (
            <div className="text-center py-10 text-theme-text-muted">Caricamento...</div>
          ) : filteredReferrers.length === 0 ? (
            <div className="text-center py-10 text-theme-text-muted">Nessun partecipante trovato</div>
          ) : (
            <div className="space-y-2 max-h-[70vh] overflow-y-auto">
              {filteredReferrers.map((r) => (
                <div
                  key={r.user_id}
                  className="p-4 rounded-xl border bg-theme-bg-secondary border-theme-border"
                >
                  <div className="flex justify-between items-center gap-4">
                    <div className="min-w-0">
                      <p className="text-theme-text-primary font-semibold truncate">{r.name}</p>
                      {r.email && (
                        <p className="text-theme-text-muted text-sm truncate">{r.email}</p>
                      )}
                    </div>
                    <p className="text-theme-text-muted text-sm font-mono whitespace-nowrap">
                      {r.referral_code || '-'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-theme-bg-secondary border border-theme-border rounded-xl p-4">
      <p className="text-theme-text-muted text-xs mb-1">{label}</p>
      <p className="text-theme-text-primary text-xl font-bold">{value}</p>
    </div>
  )
}
