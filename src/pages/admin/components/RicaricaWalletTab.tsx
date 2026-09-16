import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../../supabaseClient'
import { authFetch } from '../../../utils/authFetch'
import { ScheletroTabella } from '../../../components/Scheletro'
import toast from 'react-hot-toast'

/**
 * RICARICA WALLET — Marketing > Wallet (16/09/2026)
 *
 * Caricare credito a UNA PERSONA si fa dalla scheda del cliente, in
 * Clienti > Credit Wallet. Qui si fa il resto: la stessa cosa a MOLTE
 * persone in una volta, che e' un'azione di marketing — una promozione, un
 * omaggio a chi non prenota da mesi, un buono lavaggio a tutti.
 *
 * Due modi, e la differenza conta:
 *   - senza scadenza e senza servizi -> e' una ricarica normale, finisce nel
 *     SALDO del cliente, spendibile su tutto e per sempre;
 *   - con una scadenza o dei servizi -> e' credito VINCOLATO: vive in un lotto
 *     suo, si consuma PRIMA del saldo (a partire da quello che scade prima) e
 *     su un servizio che non e' il suo non si spende affatto.
 *
 * Le regole di spesa stanno tutte nel database (dr7_wallet_*): qui si decide
 * solo chi riceve cosa.
 */

interface LottoVincolato {
  id: string
  user_id: string
  importo: number
  residuo: number
  scadenza: string | null
  servizi: string[] | null
  descrizione: string | null
  created_at: string
}

interface ClienteWallet {
  user_id: string
  nome: string
  email: string | null
  saldo: number
}

const SERVIZI_WALLET: { id: string; label: string }[] = [
  { id: 'rental', label: 'Noleggio Terra' },
  { id: 'boat_rental', label: 'Noleggio Mare' },
  { id: 'heli_rental', label: 'Noleggio Aria' },
  { id: 'stay_rental', label: 'Soggiorni & Ospitalita' },
  { id: 'car_wash', label: 'Lavaggio & Meccanica' },
]

export default function RicaricaWalletTab() {
  const [clienti, setClienti] = useState<ClienteWallet[]>([])
  const [caricamento, setCaricamento] = useState(true)
  // Quello che e' gia' stato dato: senza questo elenco un credito vincolato
  // non si vedeva da nessuna parte nel gestionale — non entra nel saldo — e
  // sembrava che la ricarica non avesse funzionato.
  const [lotti, setLotti] = useState<LottoVincolato[]>([])

  const [destinatari, setDestinatari] = useState<'selezione' | 'tutti'>('selezione')
  const [selezione, setSelezione] = useState<Set<string>>(new Set())
  const [ricerca, setRicerca] = useState('')
  const [importo, setImporto] = useState('')
  const [scadenza, setScadenza] = useState('')
  const [servizi, setServizi] = useState<Set<string>>(new Set())
  const [descrizione, setDescrizione] = useState('')
  const [natura, setNatura] = useState<'bonus' | 'real'>('bonus')
  const [invio, setInvio] = useState(false)

  useEffect(() => { caricaClienti() }, [])

  async function caricaClienti() {
    setCaricamento(true)
    try {
      // Chi ha un account sito: e' l'unico che puo' avere un wallet. Si parte
      // dalle schede clienti e si aggiunge chi ha gia' un saldo ma non ha una
      // scheda (iscritti al sito senza profilo compilato).
      const [{ data: schede }, { data: saldi }] = await Promise.all([
        supabase.from('customers_extended')
          .select('user_id, nome, cognome, email')
          .not('user_id', 'is', null),
        supabase.from('user_credit_balance').select('user_id, balance'),
      ])

      const perUtente = new Map<string, ClienteWallet>()
      for (const s of schede || []) {
        const uid = String((s as { user_id: string }).user_id)
        if (!uid || perUtente.has(uid)) continue
        const nome = [(s as { nome?: string }).nome, (s as { cognome?: string }).cognome]
          .filter(Boolean).join(' ').trim()
        perUtente.set(uid, {
          user_id: uid,
          nome: nome || (s as { email?: string }).email || 'Senza nome',
          email: (s as { email?: string }).email || null,
          saldo: 0,
        })
      }
      for (const b of saldi || []) {
        const uid = String((b as { user_id: string }).user_id)
        const saldo = Number((b as { balance?: number }).balance) || 0
        const esistente = perUtente.get(uid)
        if (esistente) esistente.saldo = saldo
        else perUtente.set(uid, { user_id: uid, nome: 'Iscritto senza scheda', email: null, saldo })
      }

      setClienti([...perUtente.values()].sort((a, b) => b.saldo - a.saldo || a.nome.localeCompare(b.nome)))

      const { data: righeLotti } = await supabase
        .from('wallet_crediti_vincolati')
        .select('id, user_id, importo, residuo, scadenza, servizi, descrizione, created_at')
        .gt('residuo', 0)
        .order('created_at', { ascending: false })
      setLotti((righeLotti || []).map(l => ({
        ...(l as LottoVincolato),
        importo: Number((l as { importo: number }).importo) || 0,
        residuo: Number((l as { residuo: number }).residuo) || 0,
      })))
    } catch (err) {
      toast.error('Errore caricamento clienti: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setCaricamento(false)
    }
  }

  // Quanto credito vincolato ha ogni cliente: va scritto sulla riga, non solo
  // in fondo alla pagina. Il saldo resta a zero e senza questo sembra che il
  // credito non sia mai arrivato.
  const vincolatoPerUtente = useMemo(() => {
    const m = new Map<string, number>()
    const oggi = new Date().toISOString().slice(0, 10)
    for (const l of lotti) {
      if (l.scadenza && l.scadenza < oggi) continue
      m.set(l.user_id, (m.get(l.user_id) || 0) + l.residuo)
    }
    return m
  }, [lotti])

  const visibili = useMemo(() => {
    const q = ricerca.trim().toLowerCase()
    if (!q) return clienti.slice(0, 300)
    return clienti
      .filter(c => c.nome.toLowerCase().includes(q) || (c.email || '').toLowerCase().includes(q))
      .slice(0, 300)
  }, [clienti, ricerca])

  const senzaVincoli = !scadenza && servizi.size === 0
  const quanti = destinatari === 'tutti' ? clienti.length : selezione.size

  async function assegna() {
    const valore = parseFloat(String(importo).replace(',', '.'))
    if (!Number.isFinite(valore) || valore <= 0) { toast.error('Inserisci un importo'); return }
    if (destinatari === 'selezione' && selezione.size === 0) { toast.error('Scegli almeno un cliente'); return }

    // Scrittura su molte persone: si dice prima quante sono e quanto costa.
    const dove = servizi.size === 0
      ? 'tutti i servizi'
      : SERVIZI_WALLET.filter(s => servizi.has(s.id)).map(s => s.label).join(', ')
    const quando = scadenza ? new Date(scadenza).toLocaleDateString('it-IT') : 'nessuna scadenza'
    const conferma = window.confirm(
      `Caricare EUR ${valore.toFixed(2)} a ${quanti} cliente/i?\n\n`
      + (senzaVincoli
          ? 'Nessun vincolo: finisce nel saldo, spendibile su tutto e senza scadenza.\n'
          : `Vale su: ${dove}\nScadenza: ${quando}\n`)
      + `Totale: EUR ${(valore * quanti).toFixed(2)}`
    )
    if (!conferma) return

    setInvio(true)
    try {
      const res = await authFetch('/.netlify/functions/customer-wallet-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'credito_vincolato',
          amount: valore,
          scadenza: scadenza || null,
          servizi: [...servizi],
          description: descrizione,
          nature: natura === 'bonus' ? 'bonus' : 'real',
          destinatari: {
            tipo: destinatari,
            user_ids: destinatari === 'selezione' ? [...selezione] : [],
          },
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`)
      toast.success(`Credito caricato a ${data.destinatari} clienti (EUR ${Number(data.totale).toFixed(2)} in totale)`)
      setImporto('')
      setDescrizione('')
      setSelezione(new Set())
      caricaClienti()
    } catch (err) {
      toast.error('Errore: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setInvio(false)
    }
  }

  async function eliminaLotto(l: LottoVincolato) {
    // Solo se non e' stato ancora speso niente: un credito gia' usato non si
    // puo' togliere senza riscrivere una prenotazione.
    if (l.residuo !== l.importo) {
      toast.error('Gia\' in parte speso: non si puo\' togliere')
      return
    }
    if (!window.confirm(`Togliere EUR ${l.importo.toFixed(2)} a questo cliente?`)) return
    const { error } = await supabase.from('wallet_crediti_vincolati').delete().eq('id', l.id)
    if (error) { toast.error('Errore: ' + error.message); return }
    toast.success('Credito tolto')
    caricaClienti()
  }

  if (caricamento) return <ScheletroTabella righe={8} colonne={4} />

  const totaleRegalo = (parseFloat(String(importo).replace(',', '.')) || 0) * quanti
  const tuttiMostratiScelti = visibili.length > 0 && visibili.every(c => selezione.has(c.user_id))

  return (
    <div className="space-y-4">
      {/* Intestazione */}
      <div>
        <h2 className="text-lg font-bold text-theme-text-primary">Ricarica Wallet</h2>
        <p className="text-sm text-theme-text-muted mt-1">
          Credito a piu' clienti in una volta. Senza scadenza e senza servizi va nel saldo ed e'
          spendibile su tutto; con una scadenza o dei servizi diventa credito vincolato, che si
          consuma prima del saldo e solo dove vale. Per un cliente solo: Clienti &gt; Credit Wallet.
        </p>
      </div>

      {/* Riepilogo: quanti scelti, quanto costa */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="relative overflow-hidden rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent p-4">
          <div className="text-[10px] text-emerald-300/80 uppercase tracking-wider font-semibold">Destinatari</div>
          <div className="text-2xl lg:text-3xl font-bold text-emerald-400 mt-2.5 tabular-nums">{quanti}</div>
          <div className="text-[11px] text-theme-text-muted mt-1">
            {destinatari === 'tutti' ? 'tutti i clienti con account' : 'clienti scelti a mano'}
          </div>
        </div>
        <div className="relative overflow-hidden rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-transparent p-4">
          <div className="text-[10px] text-amber-300/80 uppercase tracking-wider font-semibold">Totale</div>
          <div className="text-2xl lg:text-3xl font-bold text-amber-400 mt-2.5 tabular-nums">
            €{totaleRegalo.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-theme-text-muted mt-1">importo per cliente × destinatari</div>
        </div>
        <div className="relative overflow-hidden rounded-2xl border border-purple-500/20 bg-gradient-to-br from-purple-500/10 via-purple-500/5 to-transparent p-4">
          <div className="text-[10px] text-purple-300/80 uppercase tracking-wider font-semibold">Tipo</div>
          <div className="text-lg font-bold text-purple-400 mt-3">{senzaVincoli ? 'Nel saldo' : 'Vincolato'}</div>
          <div className="text-[11px] text-theme-text-muted mt-1">
            {senzaVincoli ? 'spendibile su tutto, non scade' : 'solo dove vale, e fino alla scadenza'}
          </div>
        </div>
      </div>

      {/* A chi */}
      <div className="flex flex-wrap gap-2">
        {([
          ['selezione', `Selezione multipla${selezione.size > 0 ? ` (${selezione.size})` : ''}`],
          ['tutti', `Tutti i clienti (${clienti.length})`],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setDestinatari(id)}
            className={`px-4 py-2 rounded-xl text-sm border transition-colors ${
              destinatari === id
                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                : 'bg-theme-bg-secondary border-theme-border text-theme-text-secondary hover:bg-theme-bg-hover'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Ricerca — stesso formato della tab Credit Wallet */}
      {destinatari === 'selezione' && (
        <>
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-theme-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={ricerca}
              onChange={(e) => setRicerca(e.target.value)}
              placeholder="Cerca cliente per nome o email..."
              className="w-full pl-10 pr-4 py-3 bg-theme-bg-secondary border border-theme-border rounded-xl text-theme-text-primary outline-none focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/20 transition-all"
            />
            <button
              onClick={() => setSelezione(new Set())}
              className="absolute right-3 top-1/2 -translate-y-1/2 px-3 py-1 rounded-full bg-theme-bg-tertiary border border-theme-border text-[11px] text-theme-text-secondary hover:bg-theme-bg-hover transition-colors"
            >
              Deseleziona tutti
            </button>
          </div>

          {/* Tabella clienti con le caselle */}
          <div className="bg-theme-bg-secondary border border-theme-border rounded-xl overflow-hidden">
            <div className="hidden lg:grid grid-cols-[auto_2fr_2fr_1fr] gap-4 px-5 py-3 border-b border-theme-border text-xs font-semibold text-theme-text-muted uppercase tracking-wider items-center">
              <input
                type="checkbox"
                checked={tuttiMostratiScelti}
                onChange={() => setSelezione(prev => {
                  const next = new Set(prev)
                  for (const c of visibili) { if (tuttiMostratiScelti) next.delete(c.user_id); else next.add(c.user_id) }
                  return next
                })}
                className="w-4 h-4 rounded border-theme-border bg-theme-bg-tertiary"
              />
              <span>Cliente</span>
              <span>Email</span>
              <span>Wallet</span>
            </div>

            <div className="divide-y divide-theme-border/50 max-h-[520px] overflow-y-auto">
              {visibili.map(c => {
                const scelto = selezione.has(c.user_id)
                const palettes = [
                  'bg-rose-500/20 text-rose-300 border-rose-500/40',
                  'bg-amber-500/20 text-amber-300 border-amber-500/40',
                  'bg-blue-500/20 text-blue-300 border-blue-500/40',
                  'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
                  'bg-purple-500/20 text-purple-300 border-purple-500/40',
                  'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
                ]
                let hash = 0
                for (let i = 0; i < c.user_id.length; i++) hash = (hash * 31 + c.user_id.charCodeAt(i)) | 0
                const colore = palettes[Math.abs(hash) % palettes.length]
                const iniziali = c.nome.split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]?.toUpperCase() || '').join('') || '?'
                return (
                  <label
                    key={c.user_id}
                    className={`grid grid-cols-[auto_1fr] lg:grid-cols-[auto_2fr_2fr_1fr] gap-2 lg:gap-4 px-5 py-3 items-center cursor-pointer transition-colors ${
                      scelto ? 'bg-emerald-500/[0.06]' : 'hover:bg-white/[0.02]'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={scelto}
                      onChange={e => setSelezione(prev => {
                        const next = new Set(prev)
                        if (e.target.checked) next.add(c.user_id); else next.delete(c.user_id)
                        return next
                      })}
                      className="w-4 h-4 rounded border-theme-border bg-theme-bg-tertiary"
                    />
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-10 h-10 rounded-full grid place-items-center text-sm font-bold border flex-shrink-0 ${colore}`}>
                        {iniziali}
                      </div>
                      <p className="text-sm font-semibold text-theme-text-primary truncate">{c.nome}</p>
                    </div>
                    <span className="text-sm text-theme-text-secondary truncate hidden lg:block">{c.email || '—'}</span>
                    <span className="text-sm text-theme-text-primary tabular-nums hidden lg:block">
                      €{c.saldo.toFixed(2)}
                      {(vincolatoPerUtente.get(c.user_id) || 0) > 0 && (
                        <span className="block text-[11px] font-normal text-teal-400">
                          + €{(vincolatoPerUtente.get(c.user_id) || 0).toFixed(2)} vincolato
                        </span>
                      )}
                    </span>
                  </label>
                )
              })}
              {visibili.length === 0 && (
                <div className="text-center py-16 text-theme-text-muted">Nessun cliente trovato</div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Quanto, fino a quando, su cosa */}
      <div className="bg-theme-bg-secondary border border-theme-border rounded-xl p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-theme-text-secondary mb-1 block">Importo per cliente (EUR)</label>
            <input
              type="text"
              inputMode="decimal"
              value={importo}
              onChange={e => setImporto(e.target.value)}
              placeholder="50,00"
              className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary outline-none focus:border-emerald-500/50"
            />
          </div>
          <div>
            <label className="text-xs text-theme-text-secondary mb-1 block">Scadenza (ultimo giorno valido)</label>
            <input
              type="date"
              value={scadenza}
              onChange={e => setScadenza(e.target.value)}
              className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary outline-none focus:border-emerald-500/50"
            />
            <p className="text-[11px] text-theme-text-muted mt-1">Vuoto = non scade mai.</p>
          </div>
        </div>

        <div>
          <div className="text-xs text-theme-text-secondary mb-2">Vale su</div>
          <div className="flex flex-wrap gap-2">
            {SERVIZI_WALLET.map(s => (
              <button
                key={s.id}
                onClick={() => setServizi(prev => {
                  const next = new Set(prev)
                  if (next.has(s.id)) next.delete(s.id); else next.add(s.id)
                  return next
                })}
                className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                  servizi.has(s.id)
                    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                    : 'bg-theme-bg-tertiary border-theme-border text-theme-text-secondary hover:bg-theme-bg-hover'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-theme-text-muted mt-2">
            {servizi.size === 0
              ? 'Nessun servizio scelto = vale su tutto.'
              : 'Su qualsiasi altro servizio questo credito non e spendibile.'}
          </p>
        </div>

        {senzaVincoli && (
          <div>
            <div className="text-xs text-theme-text-secondary mb-2">Natura del credito</div>
            <div className="flex flex-wrap gap-2">
              {([
                ['bonus', 'Omaggio (bonus)'],
                ['real', 'Denaro incassato'],
              ] as const).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setNatura(id)}
                  className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                    natura === id
                      ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                      : 'bg-theme-bg-tertiary border-theme-border text-theme-text-secondary hover:bg-theme-bg-hover'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-theme-text-muted mt-2">
              Una promozione e un omaggio: non e' capitale del cliente e non matura gli interessi
              del DR7 Club. "Denaro incassato" solo se quei soldi sono entrati davvero.
            </p>
          </div>
        )}

        <div>
          <label className="text-xs text-theme-text-secondary mb-1 block">Causale (la vede il cliente)</label>
          <input
            type="text"
            value={descrizione}
            onChange={e => setDescrizione(e.target.value)}
            placeholder="es. Promo lavaggio settembre"
            className="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary outline-none focus:border-emerald-500/50"
          />
        </div>

        <button
          onClick={assegna}
          disabled={invio || quanti === 0}
          className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-sm font-semibold hover:bg-emerald-500/25 disabled:opacity-50"
        >
          {invio
            ? 'Carico...'
            : senzaVincoli
              ? `Ricarica ${quanti} clienti`
              : `Assegna credito vincolato a ${quanti} clienti`}
        </button>
      </div>

      {/* Quello che e' gia' stato dato. Un credito vincolato non entra nel
          saldo del cliente: se non comparisse qui, nel gestionale non si
          vedrebbe da nessuna parte. */}
      {lotti.length > 0 && (
        <div className="bg-theme-bg-secondary border border-theme-border rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-theme-border flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-theme-text-primary">Crediti vincolati attivi</h3>
            <span className="text-xs text-theme-text-muted tabular-nums">
              {lotti.length} · €{lotti.reduce((s2, l) => s2 + l.residuo, 0).toFixed(2)} da spendere
            </span>
          </div>
          <div className="hidden lg:grid grid-cols-[2fr_1fr_1.5fr_1.5fr_auto] gap-4 px-5 py-2 border-b border-theme-border text-xs font-semibold text-theme-text-muted uppercase tracking-wider">
            <span>Cliente</span>
            <span>Residuo</span>
            <span>Vale su</span>
            <span>Scadenza</span>
            <span></span>
          </div>
          <div className="divide-y divide-theme-border/50 max-h-96 overflow-y-auto">
            {lotti.map(l => {
              const cliente = clienti.find(c => c.user_id === l.user_id)
              const dove = !l.servizi || l.servizi.length === 0
                ? 'Tutti i servizi'
                : l.servizi.map(x => SERVIZI_WALLET.find(s2 => s2.id === x)?.label || x).join(', ')
              const scaduto = l.scadenza ? new Date(l.scadenza) < new Date(new Date().toDateString()) : false
              return (
                <div key={l.id} className="grid grid-cols-1 lg:grid-cols-[2fr_1fr_1.5fr_1.5fr_auto] gap-2 lg:gap-4 px-5 py-3 items-center text-sm">
                  <div className="min-w-0">
                    <p className="text-theme-text-primary truncate">{cliente?.nome || 'Cliente'}</p>
                    {l.descrizione && <p className="text-[11px] text-theme-text-muted truncate">{l.descrizione}</p>}
                  </div>
                  <span className="text-theme-text-primary tabular-nums">
                    €{l.residuo.toFixed(2)}
                    {l.residuo !== l.importo && (
                      <span className="text-[11px] text-theme-text-muted"> di €{l.importo.toFixed(2)}</span>
                    )}
                  </span>
                  <span className="text-theme-text-secondary text-xs">{dove}</span>
                  <span className={`text-xs ${scaduto ? 'text-red-400' : 'text-theme-text-secondary'}`}>
                    {l.scadenza ? new Date(l.scadenza).toLocaleDateString('it-IT') : 'Nessuna'}
                    {scaduto ? ' · scaduto' : ''}
                  </span>
                  <button
                    onClick={() => eliminaLotto(l)}
                    disabled={l.residuo !== l.importo}
                    title={l.residuo !== l.importo ? 'Gia\' in parte speso' : 'Togli questo credito'}
                    className="px-2 py-1 rounded-lg text-[11px] border border-theme-border bg-theme-bg-tertiary text-theme-text-secondary hover:bg-theme-bg-hover disabled:opacity-40"
                  >
                    Togli
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
