import { useMemo, useState } from 'react'

type SectionId = 'categorie-fascia' | 'p2' | 'p3' | 'p4' | 'p5' | 'p6' | 'p7'

type Category = { id: string; label: string }
type Fascia = {
  id: string
  label: string
  description: string
  min_age: number | ''
  max_age: number | ''
  min_license_years: number | ''
}

const SECTIONS: { id: SectionId; title: string }[] = [
  { id: 'categorie-fascia', title: 'Categorie & Fascia' },
  { id: 'p2', title: 'Assicurazioni' },
  { id: 'p3', title: 'Km & Sforo' },
  { id: 'p4', title: 'Cauzioni' },
  { id: 'p5', title: 'Servizi' },
  { id: 'p6', title: 'Punto 6' },
  { id: 'p7', title: 'Punto 7' },
]

const INITIAL_CATEGORIES: Category[] = [
  { id: 'supercars', label: 'Supercars' },
  { id: 'urban', label: 'Urban' },
  { id: 'aziendali', label: 'Aziendali' },
]

type ServiceUnit = 'per_day' | 'per_hour' | 'per_item' | 'flat'
type TierRestriction = '' | 'TIER_1' | 'TIER_2'

type ExperienceService = {
  id: string
  name: string
  price: number | ''
  unit: ServiceUnit
  is_active: boolean
  tier_only: TierRestriction
}

type ServiziConfig = {
  experience: ExperienceService[]
  dr7_flex: {
    daily_price: number | ''
    refund_percent: number | ''
    tier_restriction: TierRestriction
    description: string
  }
  lavaggio: { fee: number | ''; mandatory: boolean }
  delivery: { price_per_km: number | '' }
  second_driver: { fasciaA: number | ''; fasciaB: number | '' }
  no_cauzione: {
    per_day: number | ''
    tier_restriction: TierRestriction
    requires_kasko: boolean
  }
}

const UNIT_LABELS: Record<ServiceUnit, string> = {
  per_day: 'al giorno',
  per_hour: 'all\u2019ora',
  per_item: 'cad.',
  flat: 'una tantum',
}

const INITIAL_SERVIZI: ServiziConfig = {
  experience: [
    { id: 'bouquet', name: 'Bouquet di rose', price: 7.9, unit: 'per_item', is_active: true, tier_only: '' },
    { id: 'wedding', name: 'Allestimento matrimonio interno/esterno', price: 150, unit: 'flat', is_active: true, tier_only: '' },
    { id: 'personal_driver', name: 'Autista personale', price: 150, unit: 'per_hour', is_active: true, tier_only: '' },
    { id: 'restaurant', name: 'Prenotazione ristorante', price: 10, unit: 'flat', is_active: true, tier_only: '' },
    { id: 'video_drone', name: 'Video Maker + Drone shooting', price: 200, unit: 'per_hour', is_active: true, tier_only: '' },
    { id: 'premium_24h', name: 'Assistenza premium 24h dedicata', price: 19.9, unit: 'per_day', is_active: true, tier_only: '' },
    { id: 'vehicle_replacement', name: 'Sostituzione immediata veicolo', price: 19.9, unit: 'per_day', is_active: true, tier_only: 'TIER_2' },
    { id: 'chauffeur_vip', name: 'Noleggio con autista + itinerario VIP', price: 189, unit: 'per_hour', is_active: true, tier_only: '' },
  ],
  dr7_flex: {
    daily_price: 19.9,
    refund_percent: 90,
    tier_restriction: '',
    description: 'Cancellazione gratuita fino a 24h prima, rimborso fino al 90%.',
  },
  lavaggio: { fee: 9.9, mandatory: true },
  delivery: { price_per_km: 3 },
  second_driver: { fasciaA: 10, fasciaB: 20 },
  no_cauzione: { per_day: 49, tier_restriction: 'TIER_2', requires_kasko: true },
}

type ServiceUnit = 'per_day' | 'per_hour' | 'per_item' | 'flat'
type TierRestriction = '' | 'TIER_1' | 'TIER_2'

const UNIT_LABELS: Record<ServiceUnit, string> = {
  per_day: 'al giorno',
  per_hour: 'all\u2019ora',
  per_item: 'cad.',
  flat: 'una tantum',
}

const TIER_LABELS: Record<TierRestriction, string> = {
  '': 'Tutte le fasce',
  TIER_2: 'Solo Fascia A',
  TIER_1: 'Solo Fascia B',
}

type ExperienceService = {
  id: string
  name: string
  price: number | ''
  unit: ServiceUnit
  is_active: boolean
  tier_only: TierRestriction
}

type ServiziConfig = {
  experience: ExperienceService[]
  dr7_flex: {
    daily_price: number | ''
    refund_percent: number | ''
    tier_restriction: TierRestriction
    description: string
  }
  lavaggio: { fee: number | ''; mandatory: boolean }
  delivery: { price_per_km: number | '' }
  second_driver: { fasciaA: number | ''; fasciaB: number | '' }
}

const INITIAL_SERVIZI: ServiziConfig = {
  experience: [
    { id: 'bouquet', name: 'Bouquet di rose', price: 7.9, unit: 'per_item', is_active: true, tier_only: '' },
    { id: 'wedding', name: 'Allestimento matrimonio interno/esterno', price: 150, unit: 'flat', is_active: true, tier_only: '' },
    { id: 'personal_driver', name: 'Autista personale', price: 150, unit: 'per_hour', is_active: true, tier_only: '' },
    { id: 'restaurant', name: 'Prenotazione ristorante', price: 10, unit: 'flat', is_active: true, tier_only: '' },
    { id: 'video_drone', name: 'Video Maker + Drone shooting', price: 200, unit: 'per_hour', is_active: true, tier_only: '' },
    { id: 'premium_24h', name: 'Assistenza premium 24h dedicata', price: 19.9, unit: 'per_day', is_active: true, tier_only: '' },
    { id: 'vehicle_replacement', name: 'Sostituzione immediata veicolo', price: 19.9, unit: 'per_day', is_active: true, tier_only: 'TIER_2' },
    { id: 'chauffeur_vip', name: 'Noleggio con autista + itinerario VIP', price: 189, unit: 'per_hour', is_active: true, tier_only: '' },
  ],
  dr7_flex: {
    daily_price: 19.9,
    refund_percent: 90,
    tier_restriction: 'TIER_2',
    description: 'Cancella fino al giorno del noleggio',
  },
  lavaggio: { fee: 9.9, mandatory: true },
  delivery: { price_per_km: 3 },
  second_driver: { fasciaA: 10, fasciaB: 20 },
}

type DepositOption = {
  id: string
  label: string
  amount: number | ''
  surcharge_per_day: number | ''
}

type DepositGroupId = 'fasciaB_residente' | 'fasciaA_residente' | 'fasciaB_non_residente' | 'fasciaA_non_residente'

type DepositsConfig = Record<DepositGroupId, DepositOption[]>

const DEPOSIT_GROUP_LABELS: Record<DepositGroupId, string> = {
  fasciaB_residente: 'Fascia B — Residente',
  fasciaA_residente: 'Fascia A — Residente',
  fasciaB_non_residente: 'Fascia B — Non Residente',
  fasciaA_non_residente: 'Fascia A — Non Residente',
}

const INITIAL_DEPOSITS: DepositsConfig = {
  fasciaB_residente: [
    { id: 'vehicle_deposit', label: 'Cauzione con veicolo', amount: 0, surcharge_per_day: 20 },
    { id: 'credit_card', label: 'Carta di credito', amount: 2000, surcharge_per_day: 0 },
    { id: 'cash_prepaid', label: 'Contanti o prepagata', amount: 4999, surcharge_per_day: 0 },
  ],
  fasciaA_residente: [
    { id: 'no_deposit', label: 'Nessuna cauzione', amount: 0, surcharge_per_day: 49 },
    { id: 'vehicle_deposit', label: 'Cauzione con veicolo', amount: 0, surcharge_per_day: 20 },
    { id: 'credit_card', label: 'Carta di credito', amount: 1000, surcharge_per_day: 0 },
    { id: 'cash_prepaid', label: 'Contanti o prepagata', amount: 4999, surcharge_per_day: 0 },
  ],
  fasciaB_non_residente: [
    { id: 'credit_card', label: 'Carta di credito', amount: 5000, surcharge_per_day: 0 },
    { id: 'vehicle_deposit', label: 'Cauzione con veicolo', amount: 0, surcharge_per_day: 20 },
  ],
  fasciaA_non_residente: [
    { id: 'credit_card', label: 'Carta di credito', amount: 3500, surcharge_per_day: 0 },
    { id: 'vehicle_deposit', label: 'Cauzione con veicolo', amount: 0, surcharge_per_day: 20 },
  ],
}

type KmConfig = {
  id: string
  label: string
  table: Record<string, number | ''>
  extraPerDay: number | ''
  sforo: number | ''
  unlimitedPerDay: number | ''
}

const INITIAL_KM: KmConfig[] = [
  {
    id: 'supercars',
    label: 'Supercars',
    table: { '1': 100, '2': 180, '3': 240, '4': 280, '5': 300 },
    extraPerDay: 60,
    sforo: 0.89,
    unlimitedPerDay: 189,
  },
  {
    id: 'urban',
    label: 'Urban',
    table: { '1': '', '2': '', '3': '', '4': '', '5': '' },
    extraPerDay: 0,
    sforo: 0.30,
    unlimitedPerDay: 0,
  },
  {
    id: 'aziendali',
    label: 'Aziendali',
    table: { '1': 200, '2': 350, '3': 500, '4': 600, '5': 700 },
    extraPerDay: 100,
    sforo: 0.49,
    unlimitedPerDay: 0,
  },
]

const INITIAL_FASCE: Fascia[] = [
  {
    id: 'A',
    label: 'Fascia A',
    description: 'Conducente esperto',
    min_age: 26,
    max_age: 69,
    min_license_years: 5,
  },
  {
    id: 'B',
    label: 'Fascia B',
    description: 'Conducente giovane o patente recente',
    min_age: 21,
    max_age: 25,
    min_license_years: 3,
  },
]

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

export default function CentralinaProTab() {
  const [section, setSection] = useState<SectionId>('categorie-fascia')

  // Current (working) state
  const [categories, setCategories] = useState<Category[]>(INITIAL_CATEGORIES)
  const [fasce, setFasce] = useState<Fascia[]>(INITIAL_FASCE)
  const [insurance, setInsurance] = useState<InsuranceCategoryConfig[]>(INITIAL_INSURANCE)
  const [km, setKm] = useState<KmConfig[]>(INITIAL_KM)
  const [deposits, setDeposits] = useState<DepositsConfig>(INITIAL_DEPOSITS)
  const [servizi, setServizi] = useState<ServiziConfig>(INITIAL_SERVIZI)

  // Saved (committed) snapshot — what the server has
  const [savedCategories, setSavedCategories] = useState<Category[]>(INITIAL_CATEGORIES)
  const [savedFasce, setSavedFasce] = useState<Fascia[]>(INITIAL_FASCE)
  const [savedInsurance, setSavedInsurance] = useState<InsuranceCategoryConfig[]>(INITIAL_INSURANCE)
  const [savedKm, setSavedKm] = useState<KmConfig[]>(INITIAL_KM)
  const [savedDeposits, setSavedDeposits] = useState<DepositsConfig>(INITIAL_DEPOSITS)
  const [savedServizi, setSavedServizi] = useState<ServiziConfig>(INITIAL_SERVIZI)

  const [justSaved, setJustSaved] = useState(false)

  const changes = useMemo(
    () =>
      computeChanges(
        { categories, fasce, insurance, km, deposits, servizi },
        { categories: savedCategories, fasce: savedFasce, insurance: savedInsurance, km: savedKm, deposits: savedDeposits, servizi: savedServizi }
      ),
    [categories, fasce, insurance, km, deposits, servizi, savedCategories, savedFasce, savedInsurance, savedKm, savedDeposits, savedServizi]
  )

  function handleSave() {
    setSavedCategories(categories)
    setSavedFasce(fasce)
    setSavedInsurance(insurance)
    setSavedKm(km)
    setSavedDeposits(deposits)
    setSavedServizi(servizi)
    setJustSaved(true)
    setTimeout(() => setJustSaved(false), 2000)
  }

  function handleDiscard() {
    setCategories(savedCategories)
    setFasce(savedFasce)
    setInsurance(savedInsurance)
    setKm(savedKm)
    setDeposits(savedDeposits)
    setServizi(savedServizi)
  }

  const hasChanges = changes.length > 0

  return (
    <div className="min-h-screen bg-[#f5f5f7] dark:bg-[#0b0b0d] pb-32">
      <div className="max-w-6xl mx-auto px-4 md:px-8 py-8">
        <div className="flex items-start justify-between flex-wrap gap-4 mb-8">
          <div>
            <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-[#1d1d1f] dark:text-white">
              Centralina Pro
            </h1>
            <p className="mt-2 text-[15px] text-[#6e6e73] dark:text-white/60">
              Anteprima design · non ancora collegata ai dati
            </p>
          </div>
          <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[13px] font-medium bg-[#fff7e6] text-[#b25e09] border border-[#f5d08a] dark:bg-yellow-500/10 dark:text-yellow-400 dark:border-yellow-500/30">
            <span className="w-1.5 h-1.5 rounded-full bg-current" />
            Preview
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-6">
          <aside className="bg-white dark:bg-[#1c1c1e] rounded-2xl border border-black/5 dark:border-white/10 shadow-sm overflow-hidden h-fit">
            <nav className="py-2">
              {SECTIONS.map((s, idx) => {
                const active = section === s.id
                return (
                  <button
                    key={s.id}
                    onClick={() => setSection(s.id)}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                      active
                        ? 'bg-[#007aff]/10 dark:bg-[#0a84ff]/15'
                        : 'hover:bg-black/[0.03] dark:hover:bg-white/[0.04]'
                    }`}
                  >
                    <span
                      className={`flex items-center justify-center w-7 h-7 rounded-full text-[13px] font-semibold ${
                        active
                          ? 'bg-[#007aff] text-white dark:bg-[#0a84ff]'
                          : 'bg-[#e5e5ea] text-[#1d1d1f] dark:bg-white/10 dark:text-white/80'
                      }`}
                    >
                      {idx + 1}
                    </span>
                    <span
                      className={`flex-1 min-w-0 text-[14px] font-medium truncate ${
                        active ? 'text-[#007aff] dark:text-[#0a84ff]' : 'text-[#1d1d1f] dark:text-white'
                      }`}
                    >
                      {s.title}
                    </span>
                  </button>
                )
              })}
            </nav>
          </aside>

          <main className="min-w-0">
            {section === 'categorie-fascia' && (
              <CategorieFasciaSection
                categories={categories}
                setCategories={setCategories}
                fasce={fasce}
                setFasce={setFasce}
              />
            )}
            {section === 'p2' && (
              <AssicurazioniSection insurance={insurance} setInsurance={setInsurance} />
            )}
            {section === 'p3' && <KmSforoSection km={km} setKm={setKm} />}
            {section === 'p4' && <CauzioniSection deposits={deposits} setDeposits={setDeposits} />}
            {section === 'p5' && <ServiziSection servizi={servizi} setServizi={setServizi} />}
            {section !== 'categorie-fascia' && section !== 'p2' && section !== 'p3' && section !== 'p4' && section !== 'p5' && (
              <div className="bg-white dark:bg-[#1c1c1e] rounded-2xl border border-black/5 dark:border-white/10 shadow-sm p-12 text-center">
                <p className="text-[15px] text-[#6e6e73] dark:text-white/60">
                  Sezione in arrivo — da definire
                </p>
              </div>
            )}
          </main>
        </div>
      </div>

      {(hasChanges || justSaved) && (
        <SaveBar
          changes={changes}
          justSaved={justSaved}
          onSave={handleSave}
          onDiscard={handleDiscard}
        />
      )}
    </div>
  )
}

function CategorieFasciaSection({
  categories,
  setCategories,
  fasce,
  setFasce,
}: {
  categories: Category[]
  setCategories: (next: Category[]) => void
  fasce: Fascia[]
  setFasce: (next: Fascia[]) => void
}) {
  return (
    <div className="space-y-6">
      <EditableList
        title="Categorie"
        subtitle="Tipologie di veicoli disponibili"
        items={categories}
        onChange={setCategories}
        addLabel="Aggiungi categoria"
        placeholderNew="Nuova categoria"
      />
      <FasciaList items={fasce} onChange={setFasce} />
    </div>
  )
}

// ========== SAVE BAR & CHANGE DETECTION ==========

function SaveBar({
  changes,
  justSaved,
  onSave,
  onDiscard,
}: {
  changes: string[]
  justSaved: boolean
  onSave: () => void
  onDiscard: () => void
}) {
  return (
    <div className="fixed bottom-0 inset-x-0 z-50 px-4 pb-4 pointer-events-none">
      <div className="max-w-6xl mx-auto pointer-events-auto">
        <div
          className={`rounded-2xl shadow-2xl border backdrop-blur-xl px-5 py-4 flex items-center gap-4 flex-wrap transition-all ${
            justSaved
              ? 'bg-[#34c759]/95 border-[#34c759] text-white'
              : 'bg-white/95 dark:bg-[#1c1c1e]/95 border-black/10 dark:border-white/10'
          }`}
        >
          {justSaved ? (
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-[14px] font-medium">Modifiche salvate</span>
            </div>
          ) : (
            <>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-[#1d1d1f] dark:text-white mb-1">
                  {changes.length} modifica{changes.length > 1 ? 'e' : ''} da salvare
                </p>
                <ul className="text-[12px] text-[#6e6e73] dark:text-white/60 space-y-0.5 max-h-24 overflow-y-auto">
                  {changes.map((c, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <span className="text-[#007aff] mt-0.5">·</span>
                      <span className="truncate">{c}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={onDiscard}
                  className="px-4 py-2 rounded-lg text-[14px] font-medium text-[#1d1d1f] dark:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                >
                  Annulla
                </button>
                <button
                  onClick={onSave}
                  className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg text-[14px] font-semibold bg-[#007aff] text-white hover:bg-[#0066d6] transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                  </svg>
                  Salva
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

type Snapshot = {
  categories: Category[]
  fasce: Fascia[]
  insurance: InsuranceCategoryConfig[]
  km: KmConfig[]
  deposits: DepositsConfig
  servizi: ServiziConfig
}

function computeChanges(current: Snapshot, saved: Snapshot): string[] {
  const out: string[] = []

  // Categories
  const catSavedIds = new Set(saved.categories.map((c) => c.id))
  const catCurIds = new Set(current.categories.map((c) => c.id))
  current.categories.forEach((c) => {
    if (!catSavedIds.has(c.id)) out.push(`Categoria aggiunta: "${c.label || '(senza nome)'}"`)
  })
  saved.categories.forEach((c) => {
    if (!catCurIds.has(c.id)) out.push(`Categoria rimossa: "${c.label}"`)
  })
  current.categories.forEach((c) => {
    const prev = saved.categories.find((x) => x.id === c.id)
    if (prev && prev.label !== c.label) out.push(`Categoria rinominata: "${prev.label}" → "${c.label}"`)
  })

  // Fascia
  const fSavedIds = new Set(saved.fasce.map((f) => f.id))
  const fCurIds = new Set(current.fasce.map((f) => f.id))
  current.fasce.forEach((f) => {
    if (!fSavedIds.has(f.id)) out.push(`Fascia aggiunta: "${f.label || '(senza nome)'}"`)
  })
  saved.fasce.forEach((f) => {
    if (!fCurIds.has(f.id)) out.push(`Fascia rimossa: "${f.label}"`)
  })
  current.fasce.forEach((f) => {
    const prev = saved.fasce.find((x) => x.id === f.id)
    if (!prev) return
    if (prev.label !== f.label) out.push(`Fascia rinominata: "${prev.label}" → "${f.label}"`)
    if (prev.description !== f.description) out.push(`${f.label}: descrizione modificata`)
    if (prev.min_age !== f.min_age) out.push(`${f.label}: eta minima ${prev.min_age} → ${f.min_age}`)
    if (prev.max_age !== f.max_age) out.push(`${f.label}: eta massima ${prev.max_age} → ${f.max_age}`)
    if (prev.min_license_years !== f.min_license_years) out.push(`${f.label}: patente min ${prev.min_license_years} → ${f.min_license_years} anni`)
  })

  // Km & Sforo
  current.km.forEach((k) => {
    const prev = saved.km.find((x) => x.id === k.id)
    if (!prev) return
    const days = new Set([...Object.keys(k.table), ...Object.keys(prev.table)])
    days.forEach((d) => {
      if (prev.table[d] !== k.table[d]) {
        out.push(`Km & Sforo / ${k.label}: ${d}g ${prev.table[d] || 0} → ${k.table[d] || 0} km`)
      }
    })
    if (prev.extraPerDay !== k.extraPerDay) out.push(`Km & Sforo / ${k.label}: extra/giorno ${prev.extraPerDay} → ${k.extraPerDay} km`)
    if (prev.sforo !== k.sforo) out.push(`Km & Sforo / ${k.label}: sforo €${prev.sforo} → €${k.sforo}/km`)
    if (prev.unlimitedPerDay !== k.unlimitedPerDay) out.push(`Km & Sforo / ${k.label}: km illimitati €${prev.unlimitedPerDay} → €${k.unlimitedPerDay}/giorno`)
  })

  // Servizi
  {
    const ce = current.servizi.experience
    const pe = saved.servizi.experience
    const ceIds = new Set(ce.map((s) => s.id))
    const peIds = new Set(pe.map((s) => s.id))
    ce.forEach((s) => {
      if (!peIds.has(s.id)) out.push(`Servizi: aggiunto "${s.name || 'Nuovo servizio'}"`)
    })
    pe.forEach((s) => {
      if (!ceIds.has(s.id)) out.push(`Servizi: rimosso "${s.name}"`)
    })
    ce.forEach((s) => {
      const p = pe.find((x) => x.id === s.id)
      if (!p) return
      if (p.name !== s.name) out.push(`Servizi: "${p.name}" rinominato in "${s.name}"`)
      if (p.price !== s.price) out.push(`Servizi / ${s.name}: prezzo €${p.price} → €${s.price}`)
      if (p.unit !== s.unit) out.push(`Servizi / ${s.name}: unita ${UNIT_LABELS[p.unit]} → ${UNIT_LABELS[s.unit]}`)
      if (p.tier_only !== s.tier_only) out.push(`Servizi / ${s.name}: fascia ${TIER_LABELS[p.tier_only]} → ${TIER_LABELS[s.tier_only]}`)
      if (p.is_active !== s.is_active) out.push(`Servizi / ${s.name}: ${s.is_active ? 'attivato' : 'disattivato'}`)
    })

    const cf = current.servizi.dr7_flex
    const pf = saved.servizi.dr7_flex
    if (pf.daily_price !== cf.daily_price) out.push(`DR7 Flex: prezzo €${pf.daily_price} → €${cf.daily_price}/g`)
    if (pf.refund_percent !== cf.refund_percent) out.push(`DR7 Flex: rimborso ${pf.refund_percent}% → ${cf.refund_percent}%`)
    if (pf.tier_restriction !== cf.tier_restriction) out.push(`DR7 Flex: disponibile per ${TIER_LABELS[pf.tier_restriction]} → ${TIER_LABELS[cf.tier_restriction]}`)
    if (pf.description !== cf.description) out.push(`DR7 Flex: descrizione modificata`)

    if (saved.servizi.lavaggio.fee !== current.servizi.lavaggio.fee) out.push(`Pulizia Finale: €${saved.servizi.lavaggio.fee} → €${current.servizi.lavaggio.fee}`)
    if (saved.servizi.lavaggio.mandatory !== current.servizi.lavaggio.mandatory) out.push(`Pulizia Finale: ${current.servizi.lavaggio.mandatory ? 'obbligatoria' : 'facoltativa'}`)
    if (saved.servizi.delivery.price_per_km !== current.servizi.delivery.price_per_km) out.push(`Consegna a domicilio: €${saved.servizi.delivery.price_per_km} → €${current.servizi.delivery.price_per_km}/km`)
    if (saved.servizi.second_driver.fasciaA !== current.servizi.second_driver.fasciaA) out.push(`Secondo Guidatore Fascia A: €${saved.servizi.second_driver.fasciaA} → €${current.servizi.second_driver.fasciaA}/g`)
    if (saved.servizi.second_driver.fasciaB !== current.servizi.second_driver.fasciaB) out.push(`Secondo Guidatore Fascia B: €${saved.servizi.second_driver.fasciaB} → €${current.servizi.second_driver.fasciaB}/g`)
  }

  // Cauzioni
  ;(Object.keys(current.deposits) as DepositGroupId[]).forEach((gid) => {
    const cur = current.deposits[gid]
    const prev = saved.deposits[gid]
    const prefix = `Cauzioni / ${DEPOSIT_GROUP_LABELS[gid]}`
    const savedIds = new Set(prev.map((o) => o.id))
    const curIds = new Set(cur.map((o) => o.id))
    cur.forEach((o) => {
      if (!savedIds.has(o.id)) out.push(`${prefix}: aggiunta "${o.label || 'Nuova opzione'}"`)
    })
    prev.forEach((o) => {
      if (!curIds.has(o.id)) out.push(`${prefix}: rimossa "${o.label}"`)
    })
    cur.forEach((o) => {
      const p = prev.find((x) => x.id === o.id)
      if (!p) return
      if (p.label !== o.label) out.push(`${prefix}: "${p.label}" rinominata in "${o.label}"`)
      if (p.amount !== o.amount) out.push(`${prefix} / ${o.label}: importo €${p.amount} → €${o.amount}`)
      if (p.surcharge_per_day !== o.surcharge_per_day) out.push(`${prefix} / ${o.label}: sovrapprezzo €${p.surcharge_per_day}/g → €${o.surcharge_per_day}/g`)
    })
  })

  // Insurance
  current.insurance.forEach((cat) => {
    const prevCat = saved.insurance.find((c) => c.id === cat.id)
    if (!prevCat) return
    if (prevCat.mode !== cat.mode) {
      out.push(`${cat.label}: modalita cambiata (${prevCat.mode === 'per_fascia' ? 'per fascia' : 'tutte le fasce'} → ${cat.mode === 'per_fascia' ? 'per fascia' : 'tutte le fasce'})`)
    }
    diffInsuranceList(cat.label, 'Fascia A', cat.fasciaA, prevCat.fasciaA, out)
    diffInsuranceList(cat.label, 'Fascia B', cat.fasciaB, prevCat.fasciaB, out)
    diffInsuranceList(cat.label, '', cat.all, prevCat.all, out)
  })

  return out
}

function diffInsuranceList(
  categoryLabel: string,
  scope: string,
  current: InsuranceOption[],
  saved: InsuranceOption[],
  out: string[]
) {
  const prefix = scope ? `${categoryLabel} / ${scope}` : categoryLabel
  const savedIds = new Set(saved.map((o) => o.id))
  const curIds = new Set(current.map((o) => o.id))
  current.forEach((o) => {
    if (!savedIds.has(o.id)) out.push(`${prefix}: aggiunta "${o.name || 'Nuova opzione'}"`)
  })
  saved.forEach((o) => {
    if (!curIds.has(o.id)) out.push(`${prefix}: rimossa "${o.name}"`)
  })
  current.forEach((o) => {
    const prev = saved.find((x) => x.id === o.id)
    if (!prev) return
    if (prev.name !== o.name) out.push(`${prefix}: "${prev.name}" rinominata in "${o.name}"`)
    if (prev.daily_price !== o.daily_price) out.push(`${prefix} / ${o.name}: €/giorno ${prev.daily_price} → ${o.daily_price}`)
    if (prev.mandatory_deposit !== o.mandatory_deposit) out.push(`${prefix} / ${o.name}: deposito ${prev.mandatory_deposit} → ${o.mandatory_deposit}`)
    if (prev.deductible_fixed !== o.deductible_fixed) out.push(`${prefix} / ${o.name}: franchigia ${prev.deductible_fixed} → ${o.deductible_fixed}`)
    if (prev.deductible_percent !== o.deductible_percent) out.push(`${prefix} / ${o.name}: franchigia % ${prev.deductible_percent} → ${o.deductible_percent}`)
  })
}

type ListItem = { id: string; label: string }

function EditableList<T extends ListItem>({
  title,
  subtitle,
  items,
  onChange,
  addLabel,
  placeholderNew,
}: {
  title: string
  subtitle: string
  items: T[]
  onChange: (next: T[]) => void
  addLabel: string
  placeholderNew: string
}) {
  const [newLabel, setNewLabel] = useState('')

  function update(id: string, label: string) {
    onChange(items.map((i) => (i.id === id ? { ...i, label } : i)))
  }
  function remove(id: string) {
    onChange(items.filter((i) => i.id !== id))
  }
  function add() {
    const label = newLabel.trim()
    if (!label) return
    onChange([...items, { id: uid(), label } as T])
    setNewLabel('')
  }

  return (
    <section className="bg-white dark:bg-[#1c1c1e] rounded-2xl border border-black/5 dark:border-white/10 shadow-sm overflow-hidden">
      <header className="px-5 pt-5 pb-3">
        <h2 className="text-[17px] font-semibold text-[#1d1d1f] dark:text-white tracking-tight">
          {title}
        </h2>
        <p className="text-[13px] text-[#6e6e73] dark:text-white/60 mt-0.5">{subtitle}</p>
      </header>

      <ul className="divide-y divide-black/5 dark:divide-white/[0.08]">
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-3 px-5 py-3 group">
            <input
              value={item.label}
              onChange={(e) => update(item.id, e.target.value)}
              className="flex-1 bg-transparent outline-none text-[15px] text-[#1d1d1f] dark:text-white placeholder:text-[#a1a1a6] focus:bg-[#f5f5f7] dark:focus:bg-white/5 rounded-lg px-2 py-1.5 -mx-2 transition-colors"
            />
            <button
              onClick={() => remove(item.id)}
              className="opacity-0 group-hover:opacity-100 focus:opacity-100 flex items-center justify-center w-8 h-8 rounded-full text-[#ff3b30] hover:bg-[#ff3b30]/10 transition-all"
              aria-label="Rimuovi"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a2 2 0 012-2h2a2 2 0 012 2v3" />
              </svg>
            </button>
          </li>
        ))}
        {items.length === 0 && (
          <li className="px-5 py-6 text-center text-[13px] text-[#6e6e73] dark:text-white/50">
            Nessun elemento — aggiungine uno qui sotto
          </li>
        )}
      </ul>

      <footer className="px-5 py-3 border-t border-black/5 dark:border-white/[0.08] bg-[#fafafa] dark:bg-white/[0.02] flex items-center gap-2">
        <input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add()
          }}
          placeholder={placeholderNew}
          className="flex-1 bg-white dark:bg-[#2c2c2e] border border-black/10 dark:border-white/10 rounded-lg px-3 py-2 text-[14px] text-[#1d1d1f] dark:text-white placeholder:text-[#a1a1a6] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
        />
        <button
          onClick={add}
          disabled={!newLabel.trim()}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[14px] font-medium bg-[#007aff] text-white hover:bg-[#0066d6] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
          {addLabel}
        </button>
      </footer>
    </section>
  )
}

function FasciaList({ items, onChange }: { items: Fascia[]; onChange: (next: Fascia[]) => void }) {
  function patch(id: string, patch: Partial<Fascia>) {
    onChange(items.map((f) => (f.id === id ? { ...f, ...patch } : f)))
  }
  function remove(id: string) {
    onChange(items.filter((f) => f.id !== id))
  }
  function add() {
    onChange([
      ...items,
      {
        id: uid(),
        label: `Fascia ${String.fromCharCode(65 + items.length)}`,
        description: '',
        min_age: '',
        max_age: '',
        min_license_years: '',
      },
    ])
  }

  return (
    <section className="bg-white dark:bg-[#1c1c1e] rounded-2xl border border-black/5 dark:border-white/10 shadow-sm overflow-hidden">
      <header className="px-5 pt-5 pb-3">
        <h2 className="text-[17px] font-semibold text-[#1d1d1f] dark:text-white tracking-tight">
          Fascia
        </h2>
        <p className="text-[13px] text-[#6e6e73] dark:text-white/60 mt-0.5">
          Fasce conducente — eta e anni di patente
        </p>
      </header>

      <ul className="divide-y divide-black/5 dark:divide-white/[0.08]">
        {items.map((f) => (
          <li key={f.id} className="p-5 group">
            <div className="flex items-start gap-3 mb-4">
              <input
                value={f.label}
                onChange={(e) => patch(f.id, { label: e.target.value })}
                className="flex-1 bg-transparent outline-none text-[17px] font-semibold text-[#1d1d1f] dark:text-white placeholder:text-[#a1a1a6] focus:bg-[#f5f5f7] dark:focus:bg-white/5 rounded-lg px-2 py-1 -mx-2 transition-colors"
                placeholder="Nome fascia"
              />
              <button
                onClick={() => remove(f.id)}
                className="opacity-0 group-hover:opacity-100 focus:opacity-100 flex items-center justify-center w-8 h-8 rounded-full text-[#ff3b30] hover:bg-[#ff3b30]/10 transition-all"
                aria-label="Rimuovi"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a2 2 0 012-2h2a2 2 0 012 2v3" />
                </svg>
              </button>
            </div>

            <input
              value={f.description}
              onChange={(e) => patch(f.id, { description: e.target.value })}
              placeholder="Descrizione (es. Conducente esperto)"
              className="w-full bg-transparent outline-none text-[14px] text-[#6e6e73] dark:text-white/60 placeholder:text-[#a1a1a6] focus:bg-[#f5f5f7] dark:focus:bg-white/5 rounded-lg px-2 py-1.5 -mx-2 mb-4 transition-colors"
            />

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <NumberField
                label="Eta minima"
                value={f.min_age}
                onChange={(v) => patch(f.id, { min_age: v })}
                suffix="anni"
              />
              <NumberField
                label="Eta massima"
                value={f.max_age}
                onChange={(v) => patch(f.id, { max_age: v })}
                suffix="anni"
              />
              <NumberField
                label="Patente da almeno"
                value={f.min_license_years}
                onChange={(v) => patch(f.id, { min_license_years: v })}
                suffix="anni"
              />
            </div>
          </li>
        ))}
        {items.length === 0 && (
          <li className="px-5 py-6 text-center text-[13px] text-[#6e6e73] dark:text-white/50">
            Nessuna fascia configurata
          </li>
        )}
      </ul>

      <footer className="px-5 py-3 border-t border-black/5 dark:border-white/[0.08] bg-[#fafafa] dark:bg-white/[0.02]">
        <button
          onClick={add}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[14px] font-medium bg-[#007aff] text-white hover:bg-[#0066d6] transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
          Aggiungi fascia
        </button>
      </footer>
    </section>
  )
}

function NumberField({
  label,
  value,
  onChange,
  suffix,
}: {
  label: string
  value: number | ''
  onChange: (v: number | '') => void
  suffix?: string
}) {
  return (
    <label className="block">
      <span className="block text-[12px] font-medium text-[#6e6e73] dark:text-white/50 mb-1">
        {label}
      </span>
      <div className="relative">
        <input
          type="number"
          min={0}
          value={value}
          onChange={(e) => {
            const v = e.target.value
            onChange(v === '' ? '' : Number(v))
          }}
          className="w-full bg-white dark:bg-[#2c2c2e] border border-black/10 dark:border-white/10 rounded-lg px-3 py-2 pr-14 text-[14px] text-[#1d1d1f] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
        />
        {suffix && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-[#a1a1a6] pointer-events-none">
            {suffix}
          </span>
        )}
      </div>
    </label>
  )
}

// ========== ASSICURAZIONI (Punto 2) ==========

type InsuranceOption = {
  id: string
  name: string
  daily_price: number | ''
  mandatory_deposit: number | ''
  deductible_fixed: number | ''
  deductible_percent: number | ''
}

type Mode = 'per_fascia' | 'all_tiers'

type InsuranceCategoryConfig = {
  id: string
  label: string
  mode: Mode
  fasciaA: InsuranceOption[]
  fasciaB: InsuranceOption[]
  all: InsuranceOption[]
}

const INITIAL_INSURANCE: InsuranceCategoryConfig[] = [
  {
    id: 'supercars',
    label: 'Supercars / Exotic',
    mode: 'per_fascia',
    fasciaA: [
      { id: uid(), name: 'RCA Compresa (no Kasko)', daily_price: 0, mandatory_deposit: 10000, deductible_fixed: 0, deductible_percent: 0 },
      { id: uid(), name: 'Kasko Base', daily_price: 89, mandatory_deposit: 0, deductible_fixed: 5000, deductible_percent: 30 },
      { id: uid(), name: 'Kasko Black', daily_price: 149, mandatory_deposit: 0, deductible_fixed: 5000, deductible_percent: 10 },
      { id: uid(), name: 'Kasko Signature', daily_price: 189, mandatory_deposit: 0, deductible_fixed: 5000, deductible_percent: 0 },
      { id: uid(), name: 'Kasko DR7', daily_price: 289, mandatory_deposit: 0, deductible_fixed: 0, deductible_percent: 0 },
    ],
    fasciaB: [
      { id: uid(), name: 'RCA Compresa (no Kasko)', daily_price: 0, mandatory_deposit: 15000, deductible_fixed: 0, deductible_percent: 0 },
      { id: uid(), name: 'Kasko Base', daily_price: 119, mandatory_deposit: 0, deductible_fixed: 5000, deductible_percent: 30 },
    ],
    all: [],
  },
  {
    id: 'urban',
    label: 'Urban',
    mode: 'all_tiers',
    fasciaA: [],
    fasciaB: [],
    all: [
      { id: uid(), name: 'Kasko Base', daily_price: 15, mandatory_deposit: 0, deductible_fixed: 0, deductible_percent: 0 },
      { id: uid(), name: 'Kasko DR7', daily_price: 45, mandatory_deposit: 0, deductible_fixed: 0, deductible_percent: 0 },
    ],
  },
  {
    id: 'aziendali',
    label: 'Aziendali',
    mode: 'all_tiers',
    fasciaA: [],
    fasciaB: [],
    all: [
      { id: uid(), name: 'RCA Compresa (no Kasko)', daily_price: 0, mandatory_deposit: 0, deductible_fixed: 0, deductible_percent: 0 },
      { id: uid(), name: 'Kasko Base', daily_price: 45, mandatory_deposit: 0, deductible_fixed: 0, deductible_percent: 0 },
      { id: uid(), name: 'Kasko Black', daily_price: 65, mandatory_deposit: 0, deductible_fixed: 0, deductible_percent: 0 },
      { id: uid(), name: 'Kasko Signature', daily_price: 80, mandatory_deposit: 0, deductible_fixed: 0, deductible_percent: 0 },
      { id: uid(), name: 'Kasko DR7', daily_price: 90, mandatory_deposit: 0, deductible_fixed: 0, deductible_percent: 0 },
    ],
  },
]

function AssicurazioniSection({
  insurance,
  setInsurance,
}: {
  insurance: InsuranceCategoryConfig[]
  setInsurance: (next: InsuranceCategoryConfig[]) => void
}) {
  const config = insurance

  function updateCategory(id: string, patch: Partial<InsuranceCategoryConfig>) {
    setInsurance(config.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[22px] font-semibold tracking-tight text-[#1d1d1f] dark:text-white">
          Prezzi Assicurazioni
        </h2>
        <p className="text-[14px] text-[#6e6e73] dark:text-white/60 mt-1">
          Per categoria e fascia conducente
        </p>
      </div>

      {config.map((cat) => (
        <InsuranceCategoryCard
          key={cat.id}
          category={cat}
          onChange={(patch) => updateCategory(cat.id, patch)}
        />
      ))}
    </div>
  )
}

function InsuranceCategoryCard({
  category,
  onChange,
}: {
  category: InsuranceCategoryConfig
  onChange: (patch: Partial<InsuranceCategoryConfig>) => void
}) {
  return (
    <section className="bg-white dark:bg-[#1c1c1e] rounded-2xl border border-black/5 dark:border-white/10 shadow-sm overflow-hidden">
      <header className="px-5 pt-5 pb-4 flex items-center justify-between gap-4 flex-wrap">
        <h3 className="text-[17px] font-semibold text-[#1d1d1f] dark:text-white tracking-tight">
          {category.label}
        </h3>
        <label className="flex items-center gap-2 text-[13px] text-[#6e6e73] dark:text-white/60">
          <span>Modalita</span>
          <select
            value={category.mode}
            onChange={(e) => onChange({ mode: e.target.value as Mode })}
            className="bg-white dark:bg-[#2c2c2e] border border-black/10 dark:border-white/10 rounded-lg px-3 py-1.5 text-[13px] text-[#1d1d1f] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
          >
            <option value="per_fascia">Per fascia (A/B separate)</option>
            <option value="all_tiers">Uguale per tutte le fasce</option>
          </select>
        </label>
      </header>

      {category.mode === 'per_fascia' ? (
        <div className="divide-y divide-black/5 dark:divide-white/[0.08] border-t border-black/5 dark:border-white/[0.08]">
          <InsuranceList
            heading="Fascia B — giovane"
            items={category.fasciaB}
            onChange={(next) => onChange({ fasciaB: next })}
          />
          <InsuranceList
            heading="Fascia A — esperto"
            items={category.fasciaA}
            onChange={(next) => onChange({ fasciaA: next })}
          />
        </div>
      ) : (
        <div className="border-t border-black/5 dark:border-white/[0.08]">
          <InsuranceList
            heading="Stesse opzioni per tutte le fasce"
            items={category.all}
            onChange={(next) => onChange({ all: next })}
          />
        </div>
      )}
    </section>
  )
}

function InsuranceList({
  heading,
  items,
  onChange,
}: {
  heading: string
  items: InsuranceOption[]
  onChange: (next: InsuranceOption[]) => void
}) {
  function patch(id: string, p: Partial<InsuranceOption>) {
    onChange(items.map((i) => (i.id === id ? { ...i, ...p } : i)))
  }
  function remove(id: string) {
    onChange(items.filter((i) => i.id !== id))
  }
  function add() {
    onChange([
      ...items,
      { id: uid(), name: 'Nuova opzione', daily_price: 0, mandatory_deposit: 0, deductible_fixed: 0, deductible_percent: 0 },
    ])
  }

  return (
    <div className="p-5">
      <p className="text-[13px] font-medium text-[#6e6e73] dark:text-white/60 mb-4">{heading}</p>

      <div className="space-y-3">
        {items.map((opt) => (
          <div
            key={opt.id}
            className="rounded-xl border border-black/[0.06] dark:border-white/[0.06] bg-[#fafafa] dark:bg-white/[0.02] p-4 group"
          >
            <div className="flex items-center gap-3 mb-3">
              <input
                value={opt.name}
                onChange={(e) => patch(opt.id, { name: e.target.value })}
                placeholder="Nome opzione"
                className="flex-1 bg-transparent outline-none text-[15px] font-semibold text-[#1d1d1f] dark:text-white placeholder:text-[#a1a1a6] focus:bg-white dark:focus:bg-white/5 rounded-lg px-2 py-1 -mx-2 transition-colors"
              />
              <button
                onClick={() => remove(opt.id)}
                className="opacity-0 group-hover:opacity-100 focus:opacity-100 flex items-center justify-center w-8 h-8 rounded-full text-[#ff3b30] hover:bg-[#ff3b30]/10 transition-all"
                aria-label="Rimuovi"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a2 2 0 012-2h2a2 2 0 012 2v3" />
                </svg>
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <FieldBox label="€ / giorno" value={opt.daily_price} onChange={(v) => patch(opt.id, { daily_price: v })} />
              <FieldBox label="Deposito €" value={opt.mandatory_deposit} onChange={(v) => patch(opt.id, { mandatory_deposit: v })} />
              <FieldBox label="Franchigia €" value={opt.deductible_fixed} onChange={(v) => patch(opt.id, { deductible_fixed: v })} />
              <FieldBox label="Franchigia %" value={opt.deductible_percent} onChange={(v) => patch(opt.id, { deductible_percent: v })} />
            </div>
          </div>
        ))}
        {items.length === 0 && (
          <p className="text-center text-[13px] text-[#6e6e73] dark:text-white/50 py-4">
            Nessuna opzione
          </p>
        )}
      </div>

      <button
        onClick={add}
        className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-[#007aff] hover:text-[#0066d6] transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
        </svg>
        Aggiungi opzione
      </button>
    </div>
  )
}

function FieldBox({
  label,
  value,
  onChange,
}: {
  label: string
  value: number | ''
  onChange: (v: number | '') => void
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6] mb-1">
        {label}
      </span>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => {
          const v = e.target.value
          onChange(v === '' ? '' : Number(v))
        }}
        className="w-full bg-white dark:bg-[#2c2c2e] border border-black/10 dark:border-white/10 rounded-lg px-3 py-2 text-[14px] text-right tabular-nums text-[#1d1d1f] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
      />
    </label>
  )
}

// ========== KM & SFORO (Punto 3) ==========

function KmSforoSection({
  km,
  setKm,
}: {
  km: KmConfig[]
  setKm: (next: KmConfig[]) => void
}) {
  function patch(id: string, p: Partial<KmConfig>) {
    setKm(km.map((k) => (k.id === id ? { ...k, ...p } : k)))
  }
  function patchDay(id: string, day: string, value: number | '') {
    const target = km.find((k) => k.id === id)
    if (!target) return
    setKm(km.map((k) => (k.id === id ? { ...k, table: { ...k.table, [day]: value } } : k)))
  }

  const dayKeys = ['1', '2', '3', '4', '5']

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[22px] font-semibold tracking-tight text-[#1d1d1f] dark:text-white">
          Km & Sforo
        </h2>
        <p className="text-[14px] text-[#6e6e73] dark:text-white/60 mt-1">
          Km inclusi per giorno, sforo e prezzo km illimitati per categoria
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {km.map((cat) => (
          <section
            key={cat.id}
            className="bg-white dark:bg-[#1c1c1e] rounded-2xl border border-black/5 dark:border-white/10 shadow-sm overflow-hidden flex flex-col"
          >
            <header className="px-5 pt-5 pb-3">
              <h3 className="text-[17px] font-semibold text-[#1d1d1f] dark:text-white tracking-tight">
                {cat.label}
              </h3>
            </header>

            <div className="px-5 pb-4">
              <p className="text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6] mb-2">
                Km inclusi per giorno
              </p>
              <div className="space-y-2">
                {dayKeys.map((d) => (
                  <div key={d} className="flex items-center gap-3">
                    <span className="w-14 text-[13px] text-[#6e6e73] dark:text-white/60">
                      {d} {d === '1' ? 'giorno' : 'giorni'}
                    </span>
                    <div className="flex-1 relative">
                      <input
                        type="number"
                        min={0}
                        value={cat.table[d] ?? ''}
                        onChange={(e) => {
                          const v = e.target.value
                          patchDay(cat.id, d, v === '' ? '' : Number(v))
                        }}
                        className="w-full bg-[#f5f5f7] dark:bg-white/5 border border-black/5 dark:border-white/10 rounded-lg px-3 py-2 pr-10 text-[14px] text-right tabular-nums text-[#1d1d1f] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-[#a1a1a6] pointer-events-none">
                        km
                      </span>
                    </div>
                  </div>
                ))}
                <div className="flex items-center gap-3 pt-2 border-t border-black/[0.06] dark:border-white/[0.06] mt-2">
                  <span className="w-14 text-[13px] text-[#6e6e73] dark:text-white/60">
                    + giorno
                  </span>
                  <div className="flex-1 relative">
                    <input
                      type="number"
                      min={0}
                      value={cat.extraPerDay}
                      onChange={(e) => {
                        const v = e.target.value
                        patch(cat.id, { extraPerDay: v === '' ? '' : Number(v) })
                      }}
                      className="w-full bg-[#f5f5f7] dark:bg-white/5 border border-black/5 dark:border-white/10 rounded-lg px-3 py-2 pr-10 text-[14px] text-right tabular-nums text-[#1d1d1f] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-[#a1a1a6] pointer-events-none">
                      km
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-black/[0.06] dark:border-white/[0.06] bg-[#fafafa] dark:bg-white/[0.02]">
              <label className="block">
                <span className="block text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6] mb-2">
                  Sforo (€ per km oltre il limite)
                </span>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-[#a1a1a6] pointer-events-none">
                    €
                  </span>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={cat.sforo}
                    onChange={(e) => {
                      const v = e.target.value
                      patch(cat.id, { sforo: v === '' ? '' : Number(v) })
                    }}
                    className="w-full bg-white dark:bg-[#2c2c2e] border border-black/10 dark:border-white/10 rounded-lg pl-7 pr-14 py-2 text-[14px] text-right tabular-nums text-[#1d1d1f] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-[#a1a1a6] pointer-events-none">
                    /km
                  </span>
                </div>
              </label>
            </div>

            <div className="px-5 py-4 border-t border-black/[0.06] dark:border-white/[0.06] mt-auto">
              <label className="block">
                <span className="block text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6] mb-2">
                  Km illimitati — prezzo al giorno
                </span>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-[#a1a1a6] pointer-events-none">
                    €
                  </span>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={cat.unlimitedPerDay}
                    onChange={(e) => {
                      const v = e.target.value
                      patch(cat.id, { unlimitedPerDay: v === '' ? '' : Number(v) })
                    }}
                    className="w-full bg-white dark:bg-[#2c2c2e] border border-black/10 dark:border-white/10 rounded-lg pl-7 pr-16 py-2 text-[14px] text-right tabular-nums text-[#1d1d1f] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-[#a1a1a6] pointer-events-none">
                    /giorno
                  </span>
                </div>
              </label>
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

// ========== CAUZIONI (Punto 4) ==========

function CauzioniSection({
  deposits,
  setDeposits,
}: {
  deposits: DepositsConfig
  setDeposits: (next: DepositsConfig) => void
}) {
  function patchOption(gid: DepositGroupId, optId: string, p: Partial<DepositOption>) {
    setDeposits({
      ...deposits,
      [gid]: deposits[gid].map((o) => (o.id === optId ? { ...o, ...p } : o)),
    })
  }
  function removeOption(gid: DepositGroupId, optId: string) {
    setDeposits({ ...deposits, [gid]: deposits[gid].filter((o) => o.id !== optId) })
  }
  function addOption(gid: DepositGroupId) {
    setDeposits({
      ...deposits,
      [gid]: [
        ...deposits[gid],
        { id: uid(), label: 'Nuova opzione', amount: 0, surcharge_per_day: 0 },
      ],
    })
  }

  const groupOrder: DepositGroupId[] = [
    'fasciaB_residente',
    'fasciaA_residente',
    'fasciaB_non_residente',
    'fasciaA_non_residente',
  ]

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[22px] font-semibold tracking-tight text-[#1d1d1f] dark:text-white">
          Opzioni Cauzione per Fascia
        </h2>
        <p className="text-[14px] text-[#6e6e73] dark:text-white/60 mt-1">
          Opzioni cauzione per fascia conducente e residenza
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {groupOrder.map((gid) => (
          <section
            key={gid}
            className="bg-white dark:bg-[#1c1c1e] rounded-2xl border border-black/5 dark:border-white/10 shadow-sm overflow-hidden"
          >
            <header className="px-5 pt-5 pb-3">
              <h3 className="text-[15px] font-semibold text-[#1d1d1f] dark:text-white tracking-tight">
                {DEPOSIT_GROUP_LABELS[gid]}
              </h3>
            </header>

            <ul className="divide-y divide-black/5 dark:divide-white/[0.08]">
              {deposits[gid].map((opt) => (
                <li key={opt.id} className="px-5 py-3 group">
                  <div className="flex items-center gap-3 mb-2">
                    <input
                      value={opt.label}
                      onChange={(e) => patchOption(gid, opt.id, { label: e.target.value })}
                      placeholder="Nome opzione"
                      className="flex-1 bg-transparent outline-none text-[14px] font-medium text-[#1d1d1f] dark:text-white placeholder:text-[#a1a1a6] focus:bg-[#f5f5f7] dark:focus:bg-white/5 rounded-lg px-2 py-1 -mx-2 transition-colors"
                    />
                    <button
                      onClick={() => removeOption(gid, opt.id)}
                      className="opacity-0 group-hover:opacity-100 focus:opacity-100 flex items-center justify-center w-7 h-7 rounded-full text-[#ff3b30] hover:bg-[#ff3b30]/10 transition-all"
                      aria-label="Rimuovi"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a2 2 0 012-2h2a2 2 0 012 2v3" />
                      </svg>
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                      <span className="block text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6] mb-1">
                        Importo
                      </span>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-[#a1a1a6] pointer-events-none">
                          €
                        </span>
                        <input
                          type="number"
                          min={0}
                          value={opt.amount}
                          onChange={(e) => {
                            const v = e.target.value
                            patchOption(gid, opt.id, { amount: v === '' ? '' : Number(v) })
                          }}
                          className="w-full bg-white dark:bg-[#2c2c2e] border border-black/10 dark:border-white/10 rounded-lg pl-7 pr-3 py-2 text-[14px] text-right tabular-nums text-[#1d1d1f] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
                        />
                      </div>
                    </label>
                    <label className="block">
                      <span className="block text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6] mb-1">
                        Sovrapprezzo / giorno
                      </span>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-[#a1a1a6] pointer-events-none">
                          €
                        </span>
                        <input
                          type="number"
                          min={0}
                          value={opt.surcharge_per_day}
                          onChange={(e) => {
                            const v = e.target.value
                            patchOption(gid, opt.id, { surcharge_per_day: v === '' ? '' : Number(v) })
                          }}
                          className="w-full bg-white dark:bg-[#2c2c2e] border border-black/10 dark:border-white/10 rounded-lg pl-7 pr-10 py-2 text-[14px] text-right tabular-nums text-[#1d1d1f] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-[#a1a1a6] pointer-events-none">
                          /g
                        </span>
                      </div>
                    </label>
                  </div>
                </li>
              ))}
              {deposits[gid].length === 0 && (
                <li className="px-5 py-6 text-center text-[13px] text-[#6e6e73] dark:text-white/50">
                  Nessuna opzione
                </li>
              )}
            </ul>

            <footer className="px-5 py-3 border-t border-black/5 dark:border-white/[0.08] bg-[#fafafa] dark:bg-white/[0.02]">
              <button
                onClick={() => addOption(gid)}
                className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#007aff] hover:text-[#0066d6] transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                </svg>
                Aggiungi opzione
              </button>
            </footer>
          </section>
        ))}
      </div>
    </div>
  )
}

// ========== SERVIZI (Punto 5) ==========

function ServiziSection({
  servizi,
  setServizi,
}: {
  servizi: ServiziConfig
  setServizi: (next: ServiziConfig) => void
}) {
  function patchExp(id: string, p: Partial<ExperienceService>) {
    setServizi({ ...servizi, experience: servizi.experience.map((s) => (s.id === id ? { ...s, ...p } : s)) })
  }
  function removeExp(id: string) {
    setServizi({ ...servizi, experience: servizi.experience.filter((s) => s.id !== id) })
  }
  function addExp() {
    setServizi({
      ...servizi,
      experience: [
        ...servizi.experience,
        { id: uid(), name: 'Nuovo servizio', price: 0, unit: 'per_day', is_active: true, tier_only: '' },
      ],
    })
  }

  return (
    <div className="space-y-6">
      {/* Servizi Experience */}
      <section className="bg-white dark:bg-[#1c1c1e] rounded-2xl border border-black/5 dark:border-white/10 shadow-sm overflow-hidden">
        <header className="px-5 pt-5 pb-3 flex items-center justify-between">
          <div>
            <h2 className="text-[17px] font-semibold text-[#1d1d1f] dark:text-white tracking-tight">
              Servizi Experience
            </h2>
            <p className="text-[13px] text-[#6e6e73] dark:text-white/60 mt-0.5">
              Servizi extra opzionali
            </p>
          </div>
          <button
            onClick={addExp}
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#007aff] hover:text-[#0066d6] transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
            </svg>
            Aggiungi servizio
          </button>
        </header>

        <ul className="divide-y divide-black/5 dark:divide-white/[0.08]">
          {servizi.experience.map((s) => (
            <li key={s.id} className="px-5 py-3 group">
              <div className="flex items-center gap-3 flex-wrap">
                <label className="inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={s.is_active}
                    onChange={(e) => patchExp(s.id, { is_active: e.target.checked })}
                    className="w-4 h-4 accent-[#007aff]"
                  />
                </label>
                <input
                  value={s.name}
                  onChange={(e) => patchExp(s.id, { name: e.target.value })}
                  placeholder="Nome servizio"
                  className="flex-1 min-w-[200px] bg-transparent outline-none text-[14px] font-medium text-[#1d1d1f] dark:text-white placeholder:text-[#a1a1a6] focus:bg-[#f5f5f7] dark:focus:bg-white/5 rounded-lg px-2 py-1.5 -mx-2 transition-colors"
                />
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-[#a1a1a6] pointer-events-none">
                    €
                  </span>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={s.price}
                    onChange={(e) => {
                      const v = e.target.value
                      patchExp(s.id, { price: v === '' ? '' : Number(v) })
                    }}
                    className="w-24 bg-white dark:bg-[#2c2c2e] border border-black/10 dark:border-white/10 rounded-lg pl-7 pr-2 py-1.5 text-[14px] text-right tabular-nums text-[#1d1d1f] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
                  />
                </div>
                <select
                  value={s.unit}
                  onChange={(e) => patchExp(s.id, { unit: e.target.value as ServiceUnit })}
                  className="bg-white dark:bg-[#2c2c2e] border border-black/10 dark:border-white/10 rounded-lg px-3 py-1.5 text-[13px] text-[#1d1d1f] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
                >
                  {(Object.keys(UNIT_LABELS) as ServiceUnit[]).map((u) => (
                    <option key={u} value={u}>
                      {UNIT_LABELS[u]}
                    </option>
                  ))}
                </select>
                <select
                  value={s.tier_only}
                  onChange={(e) => patchExp(s.id, { tier_only: e.target.value as TierRestriction })}
                  className="bg-white dark:bg-[#2c2c2e] border border-black/10 dark:border-white/10 rounded-lg px-3 py-1.5 text-[13px] text-[#1d1d1f] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
                >
                  <option value="">Tutte le fasce</option>
                  <option value="TIER_2">Solo Fascia A</option>
                  <option value="TIER_1">Solo Fascia B</option>
                </select>
                <button
                  onClick={() => removeExp(s.id)}
                  className="opacity-0 group-hover:opacity-100 focus:opacity-100 flex items-center justify-center w-8 h-8 rounded-full text-[#ff3b30] hover:bg-[#ff3b30]/10 transition-all"
                  aria-label="Rimuovi"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a2 2 0 012-2h2a2 2 0 012 2v3" />
                  </svg>
                </button>
              </div>
            </li>
          ))}
          {servizi.experience.length === 0 && (
            <li className="px-5 py-6 text-center text-[13px] text-[#6e6e73] dark:text-white/50">
              Nessun servizio
            </li>
          )}
        </ul>
      </section>

      {/* DR7 Flex */}
      <section className="bg-white dark:bg-[#1c1c1e] rounded-2xl border border-black/5 dark:border-white/10 shadow-sm overflow-hidden">
        <header className="px-5 pt-5 pb-3">
          <h2 className="text-[17px] font-semibold text-[#1d1d1f] dark:text-white tracking-tight">
            DR7 Flex — Cancellazione Premium
          </h2>
        </header>

        <div className="px-5 pb-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="block">
              <span className="block text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6] mb-1">
                Prezzo / giorno
              </span>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-[#a1a1a6] pointer-events-none">
                  €
                </span>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={servizi.dr7_flex.daily_price}
                  onChange={(e) => {
                    const v = e.target.value
                    setServizi({ ...servizi, dr7_flex: { ...servizi.dr7_flex, daily_price: v === '' ? '' : Number(v) } })
                  }}
                  className="w-full bg-white dark:bg-[#2c2c2e] border border-black/10 dark:border-white/10 rounded-lg pl-7 pr-3 py-2 text-[14px] text-right tabular-nums text-[#1d1d1f] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
                />
              </div>
            </label>
            <label className="block">
              <span className="block text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6] mb-1">
                Rimborso
              </span>
              <div className="relative">
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={servizi.dr7_flex.refund_percent}
                  onChange={(e) => {
                    const v = e.target.value
                    setServizi({ ...servizi, dr7_flex: { ...servizi.dr7_flex, refund_percent: v === '' ? '' : Number(v) } })
                  }}
                  className="w-full bg-white dark:bg-[#2c2c2e] border border-black/10 dark:border-white/10 rounded-lg pl-3 pr-8 py-2 text-[14px] text-right tabular-nums text-[#1d1d1f] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-[#a1a1a6] pointer-events-none">
                  %
                </span>
              </div>
            </label>
            <label className="block">
              <span className="block text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6] mb-1">
                Disponibile per
              </span>
              <select
                value={servizi.dr7_flex.tier_restriction}
                onChange={(e) =>
                  setServizi({ ...servizi, dr7_flex: { ...servizi.dr7_flex, tier_restriction: e.target.value as TierRestriction } })
                }
                className="w-full bg-white dark:bg-[#2c2c2e] border border-black/10 dark:border-white/10 rounded-lg px-3 py-2 text-[14px] text-[#1d1d1f] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
              >
                <option value="">Tutte le fasce</option>
                <option value="TIER_2">Solo Fascia A</option>
                <option value="TIER_1">Solo Fascia B</option>
              </select>
            </label>
          </div>
          <label className="block">
            <span className="block text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6] mb-1">
              Descrizione
            </span>
            <input
              value={servizi.dr7_flex.description}
              onChange={(e) => setServizi({ ...servizi, dr7_flex: { ...servizi.dr7_flex, description: e.target.value } })}
              className="w-full bg-white dark:bg-[#2c2c2e] border border-black/10 dark:border-white/10 rounded-lg px-3 py-2 text-[14px] text-[#1d1d1f] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
            />
          </label>
        </div>
      </section>

      {/* Simple services: 3-column grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Pulizia Finale */}
        <section className="bg-white dark:bg-[#1c1c1e] rounded-2xl border border-black/5 dark:border-white/10 shadow-sm p-5">
          <h3 className="text-[15px] font-semibold text-[#1d1d1f] dark:text-white mb-3">
            Pulizia Finale
          </h3>
          <label className="block mb-3">
            <span className="block text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6] mb-1">
              Tariffa
            </span>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-[#a1a1a6] pointer-events-none">
                €
              </span>
              <input
                type="number"
                min={0}
                step={0.01}
                value={servizi.lavaggio.fee}
                onChange={(e) => {
                  const v = e.target.value
                  setServizi({ ...servizi, lavaggio: { ...servizi.lavaggio, fee: v === '' ? '' : Number(v) } })
                }}
                className="w-full bg-white dark:bg-[#2c2c2e] border border-black/10 dark:border-white/10 rounded-lg pl-7 pr-3 py-2 text-[14px] text-right tabular-nums text-[#1d1d1f] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
              />
            </div>
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={servizi.lavaggio.mandatory}
              onChange={(e) => setServizi({ ...servizi, lavaggio: { ...servizi.lavaggio, mandatory: e.target.checked } })}
              className="w-4 h-4 accent-[#007aff]"
            />
            <span className="text-[13px] text-[#1d1d1f] dark:text-white">Obbligatoria</span>
          </label>
        </section>

        {/* Consegna a Domicilio */}
        <section className="bg-white dark:bg-[#1c1c1e] rounded-2xl border border-black/5 dark:border-white/10 shadow-sm p-5">
          <h3 className="text-[15px] font-semibold text-[#1d1d1f] dark:text-white mb-3">
            Consegna a Domicilio
          </h3>
          <label className="block">
            <span className="block text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6] mb-1">
              Prezzo per km
            </span>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-[#a1a1a6] pointer-events-none">
                €
              </span>
              <input
                type="number"
                min={0}
                step={0.01}
                value={servizi.delivery.price_per_km}
                onChange={(e) => {
                  const v = e.target.value
                  setServizi({ ...servizi, delivery: { price_per_km: v === '' ? '' : Number(v) } })
                }}
                className="w-full bg-white dark:bg-[#2c2c2e] border border-black/10 dark:border-white/10 rounded-lg pl-7 pr-12 py-2 text-[14px] text-right tabular-nums text-[#1d1d1f] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-[#a1a1a6] pointer-events-none">
                /km
              </span>
            </div>
          </label>
        </section>

        {/* Secondo Guidatore */}
        <section className="bg-white dark:bg-[#1c1c1e] rounded-2xl border border-black/5 dark:border-white/10 shadow-sm p-5">
          <h3 className="text-[15px] font-semibold text-[#1d1d1f] dark:text-white mb-3">
            Secondo Guidatore
          </h3>
          <div className="space-y-2">
            {(['fasciaA', 'fasciaB'] as const).map((k) => (
              <div key={k} className="flex items-center gap-3">
                <span className="w-16 text-[13px] text-[#6e6e73] dark:text-white/60">
                  {k === 'fasciaA' ? 'Fascia A' : 'Fascia B'}
                </span>
                <div className="flex-1 relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-[#a1a1a6] pointer-events-none">
                    €
                  </span>
                  <input
                    type="number"
                    min={0}
                    value={servizi.second_driver[k]}
                    onChange={(e) => {
                      const v = e.target.value
                      setServizi({
                        ...servizi,
                        second_driver: { ...servizi.second_driver, [k]: v === '' ? '' : Number(v) },
                      })
                    }}
                    className="w-full bg-white dark:bg-[#2c2c2e] border border-black/10 dark:border-white/10 rounded-lg pl-7 pr-10 py-2 text-[14px] text-right tabular-nums text-[#1d1d1f] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-[#a1a1a6] pointer-events-none">
                    /g
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
