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
    } catch (err) {
      toast.error('Errore caricamento clienti: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setCaricamento(false)
    }
  }

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

  if (caricamento) return <ScheletroTabella righe={8} colonne={3} />

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold text-theme-text-primary">Ricarica Wallet</h2>
        <p className="text-sm text-theme-text-muted mt-1">
          Credito a piu' clienti in una volta. Senza scadenza e senza servizi va nel saldo ed e'
          spendibile su tutto; mettendo una scadenza o dei servizi diventa credito vincolato, che
          si consuma prima del saldo e solo dove vale. Per un cliente solo: Clienti &gt; Credit Wallet.
        </p>
      </div>

      {/* A chi */}
      <div>
        <div className="text-xs text-theme-text-secondary mb-2">A chi</div>
        <div className="flex flex-wrap gap-2">
          {([
            ['selezione', `Clienti scelti${selezione.size > 0 ? ` (${selezione.size})` : ''}`],
            ['tutti', `Tutti i clienti (${clienti.length})`],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setDestinatari(id)}
              className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                destinatari === id
                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                  : 'bg-theme-bg-tertiary border-theme-border text-theme-text-secondary hover:bg-theme-bg-hover'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {destinatari === 'selezione' && (
        <div>
          <div className="flex items-center justify-between gap-3 mb-2">
            <input
              type="text"
              value={ricerca}
              onChange={e => setRicerca(e.target.value)}
              placeholder="Cerca per nome o email..."
              className="flex-1 bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary outline-none focus:border-emerald-500/50"
            />
            <button
              onClick={() => setSelezione(prev => {
                const tutti = new Set(prev)
                const tuttiVisibili = visibili.every(c => tutti.has(c.user_id))
                for (const c of visibili) { if (tuttiVisibili) tutti.delete(c.user_id); else tutti.add(c.user_id) }
                return tutti
              })}
              className="px-3 py-2 rounded-lg text-xs border border-theme-border bg-theme-bg-tertiary text-theme-text-secondary hover:bg-theme-bg-hover whitespace-nowrap"
            >
              Tutti quelli mostrati
            </button>
          </div>
          <div className="max-h-72 overflow-y-auto border border-theme-border rounded-lg divide-y divide-theme-border/60">
            {visibili.map(c => (
              <label key={c.user_id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-theme-bg-hover">
                <input
                  type="checkbox"
                  checked={selezione.has(c.user_id)}
                  onChange={e => setSelezione(prev => {
                    const next = new Set(prev)
                    if (e.target.checked) next.add(c.user_id); else next.delete(c.user_id)
                    return next
                  })}
                  className="w-4 h-4 rounded border-theme-border bg-theme-bg-tertiary"
                />
                <span className="text-sm text-theme-text-primary flex-1 truncate">{c.nome}</span>
                <span className="text-[11px] text-theme-text-muted truncate max-w-[200px]">{c.email}</span>
                <span className="text-xs text-theme-text-secondary tabular-nums">€{c.saldo.toFixed(2)}</span>
              </label>
            ))}
            {visibili.length === 0 && (
              <div className="px-3 py-4 text-sm text-theme-text-muted">Nessun cliente trovato.</div>
            )}
          </div>
        </div>
      )}

      {/* Quanto e a quali condizioni */}
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
        disabled={invio}
        className="px-4 py-2 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-sm hover:bg-emerald-500/25 disabled:opacity-50"
      >
        {invio ? 'Carico...' : senzaVincoli ? `Ricarica ${quanti || ''} clienti` : `Assegna credito vincolato a ${quanti || ''} clienti`}
      </button>
    </div>
  )
}
