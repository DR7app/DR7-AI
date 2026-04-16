import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../supabaseClient'

type FleetVehicle = {
  id: string
  display_name: string
  daily_rate: number | null
  category: string | null
}

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
  { id: 'p6', title: 'Prezzo Dinamico' },
  { id: 'p7', title: 'Preventivi' },
]

const INITIAL_CATEGORIES: Category[] = [
  { id: 'supercars', label: 'Supercars' },
  { id: 'urban', label: 'Urban' },
  { id: 'aziendali', label: 'Aziendali' },
]

type ServiceUnit = 'per_day' | 'per_hour' | 'per_item' | 'flat'

const UNIT_LABELS: Record<ServiceUnit, string> = {
  per_day: 'al giorno',
  per_hour: 'all\u2019ora',
  per_item: 'cad.',
  flat: 'una tantum',
}

type ExperienceService = {
  id: string
  name: string
  price: number | ''
  unit: ServiceUnit
  is_active: boolean
  tier_only: string // '' = all fasce, otherwise fascia.id
}

type ServiziConfig = {
  experience: ExperienceService[]
  dr7_flex: {
    daily_price: number | ''
    refund_percent: number | ''
    tier_restriction: string // '' = all fasce, otherwise fascia.id
    description: string
  }
  lavaggio: { fee: number | ''; mandatory: boolean }
  delivery: { price_per_km: number | '' }
  second_driver: Record<string, number | ''> // keyed by fascia.id
}

const INITIAL_SERVIZI: ServiziConfig = {
  experience: [
    { id: 'bouquet', name: 'Bouquet di rose', price: 7.9, unit: 'per_item', is_active: true, tier_only: '' },
    { id: 'wedding', name: 'Allestimento matrimonio interno/esterno', price: 150, unit: 'flat', is_active: true, tier_only: '' },
    { id: 'personal_driver', name: 'Autista personale', price: 150, unit: 'per_hour', is_active: true, tier_only: '' },
    { id: 'restaurant', name: 'Prenotazione ristorante', price: 10, unit: 'flat', is_active: true, tier_only: '' },
    { id: 'video_drone', name: 'Video Maker + Drone shooting', price: 200, unit: 'per_hour', is_active: true, tier_only: '' },
    { id: 'premium_24h', name: 'Assistenza premium 24h dedicata', price: 19.9, unit: 'per_day', is_active: true, tier_only: '' },
    { id: 'vehicle_replacement', name: 'Sostituzione immediata veicolo', price: 19.9, unit: 'per_day', is_active: true, tier_only: 'A' },
    { id: 'chauffeur_vip', name: 'Noleggio con autista + itinerario VIP', price: 189, unit: 'per_hour', is_active: true, tier_only: '' },
  ],
  dr7_flex: {
    daily_price: 19.9,
    refund_percent: 90,
    tier_restriction: 'A',
    description: 'Cancella fino al giorno del noleggio',
  },
  lavaggio: { fee: 9.9, mandatory: true },
  delivery: { price_per_km: 3 },
  second_driver: { A: 10, B: 20 },
}

// ========== PREZZO DINAMICO (Punto 6) types ==========

type TariffaMode = 'unica' | 'per_residenza'

type TariffaGiornaliera = {
  id: string
  label: string
  mode: TariffaMode
  days: string[]
  unica: Record<string, number | ''>
  residente: Record<string, number | ''>
  non_residente: Record<string, number | ''>
  extraPerDay: number | ''
}

type CoefficientRow = {
  id: string
  min: number | ''
  max: number | ''
  coeff: number | ''
  label: string
}

type DynamicMode = 'disabled' | 'suggestion' | 'auto_apply'

type DynamicPricingConfig = {
  enabled: boolean
  mode: DynamicMode
  base_prices: Record<string, number | ''>
  min_prices: Record<string, number | ''>
  max_prices: Record<string, number | ''>
  occupation_coefficients: CoefficientRow[]
  advance_coefficients: CoefficientRow[]
  duration_coefficients: CoefficientRow[]
}

type PrezzoDinamicoConfig = {
  tariffe: TariffaGiornaliera[]
  dynamic: DynamicPricingConfig
}

const INITIAL_TARIFFE: TariffaGiornaliera[] = [
  {
    id: 'supercars',
    label: 'Supercars',
    mode: 'per_residenza',
    days: ['1', '2', '3', '4', '5', '6', '7'],
    unica: {},
    residente: { '1': 349, '2': 698, '3': 980, '4': 1290, '5': 1590, '6': 1890, '7': 2290 },
    non_residente: { '1': 449, '2': 898, '3': 1280, '4': 1690, '5': 2100, '6': 2590, '7': 2890 },
    extraPerDay: 289,
  },
  {
    id: 'urban',
    label: 'Urban',
    mode: 'unica',
    days: ['1', '2', '3', '4', '5', '6', '7'],
    unica: { '1': 39, '2': 78, '3': 109, '4': 129, '5': 149, '6': 179, '7': 199 },
    residente: {},
    non_residente: {},
    extraPerDay: 29,
  },
  {
    id: 'aziendali',
    label: 'Aziendali',
    mode: 'unica',
    days: ['1', '2', '3', '4', '5', '6', '7'],
    unica: { '1': 139, '2': 278, '3': 389, '4': 490, '5': 590, '6': 649, '7': 689 },
    residente: {},
    non_residente: {},
    extraPerDay: 99,
  },
]

const INITIAL_PREZZO_DINAMICO: PrezzoDinamicoConfig = {
  tariffe: INITIAL_TARIFFE,
  dynamic: {
    enabled: true,
    mode: 'suggestion',
    base_prices: { supercars: '', urban: '', aziendali: '' },
    min_prices: { supercars: 289, urban: 29, aziendali: 99 },
    max_prices: { supercars: 699, urban: 249, aziendali: 799 },
    occupation_coefficients: [
      { id: uid(), min: 0, max: 50, coeff: 0.95, label: 'Bassa occupazione' },
      { id: uid(), min: 50, max: 80, coeff: 1.0, label: 'Normale' },
      { id: uid(), min: 80, max: 101, coeff: 1.15, label: 'Alta occupazione' },
    ],
    advance_coefficients: [
      { id: uid(), min: 0, max: 2, coeff: 1.15, label: 'Last minute' },
      { id: uid(), min: 2, max: 14, coeff: 1.0, label: 'Normale' },
      { id: uid(), min: 14, max: 999, coeff: 0.9, label: 'Early bird' },
    ],
    duration_coefficients: [
      { id: uid(), min: 1, max: 3, coeff: 1.0, label: 'Breve (1-2g)' },
      { id: uid(), min: 3, max: 7, coeff: 0.95, label: 'Media (3-6g)' },
      { id: uid(), min: 7, max: 999, coeff: 0.85, label: 'Lunga (7+g)' },
    ],
  },
}

type PreventivoMessage = {
  key: string
  label: string
  description: string
  body: string
  is_enabled: boolean
}

type PreventiviConfig = {
  maggiorazione_pct: number | ''
  scadenza_default_ore: number | ''
  messaggi: PreventivoMessage[]
}

const INITIAL_PREVENTIVI: PreventiviConfig = {
  maggiorazione_pct: 10,
  scadenza_default_ore: 24,
  messaggi: [
    {
      key: 'preventivo_whatsapp',
      label: 'Invio preventivo (WhatsApp cliente)',
      description: 'Messaggio inviato al cliente con il preventivo',
      body: 'Ciao {{nome}}, ecco il tuo preventivo per {{veicolo}}:\n\nPeriodo: {{pickup}} → {{dropoff}}\nTotale: €{{totale}}\n\nValido {{scadenza_ore}} ore. Link: {{link}}',
      is_enabled: true,
    },
    {
      key: 'admin_new_website_quote',
      label: 'Nuovo preventivo dal sito (admin)',
      description: 'Notifica admin quando arriva un preventivo dal sito',
      body: 'Nuovo preventivo da {{cliente}}\nVeicolo: {{veicolo}}\nPeriodo: {{pickup}} → {{dropoff}}\nTotale: €{{totale}}',
      is_enabled: true,
    },
    {
      key: 'admin_no_cauzione_request',
      label: 'Richiesta No Cauzione (admin)',
      description: 'Notifica admin per richiesta "nessuna cauzione"',
      body: 'Richiesta No Cauzione da {{cliente}}\nTelefono: {{telefono}}\nVeicolo: {{veicolo}}',
      is_enabled: true,
    },
  ],
}

type DepositOption = {
  id: string
  label: string
  amount: number | ''
  surcharge_per_day: number | ''
}

type DepositFasciaConfig = {
  residente: DepositOption[]
  non_residente: DepositOption[]
}

type DepositsConfig = Record<string, DepositFasciaConfig> // keyed by fascia.id

const INITIAL_DEPOSITS: DepositsConfig = {
  B: {
    residente: [
      { id: 'vehicle_deposit', label: 'Cauzione con veicolo', amount: 0, surcharge_per_day: 20 },
      { id: 'credit_card', label: 'Carta di credito', amount: 2000, surcharge_per_day: 0 },
      { id: 'cash_prepaid', label: 'Contanti o prepagata', amount: 4999, surcharge_per_day: 0 },
    ],
    non_residente: [
      { id: 'credit_card', label: 'Carta di credito', amount: 5000, surcharge_per_day: 0 },
      { id: 'vehicle_deposit', label: 'Cauzione con veicolo', amount: 0, surcharge_per_day: 20 },
    ],
  },
  A: {
    residente: [
      { id: 'no_deposit', label: 'Nessuna cauzione', amount: 0, surcharge_per_day: 49 },
      { id: 'vehicle_deposit', label: 'Cauzione con veicolo', amount: 0, surcharge_per_day: 20 },
      { id: 'credit_card', label: 'Carta di credito', amount: 1000, surcharge_per_day: 0 },
      { id: 'cash_prepaid', label: 'Contanti o prepagata', amount: 4999, surcharge_per_day: 0 },
    ],
    non_residente: [
      { id: 'credit_card', label: 'Carta di credito', amount: 3500, surcharge_per_day: 0 },
      { id: 'vehicle_deposit', label: 'Cauzione con veicolo', amount: 0, surcharge_per_day: 20 },
    ],
  },
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

// ─── DYNAMIC SYNC HELPERS ───
// Keep an array of {id,label,...} aligned with a master list of categories
function syncByCategory<T extends { id: string; label?: string }>(
  arr: T[],
  master: { id: string; label: string }[],
  makeBlank: (cat: { id: string; label: string }) => T
): T[] {
  const byId = new Map(arr.map((x) => [x.id, x]))
  return master.map((m) => {
    const existing = byId.get(m.id)
    if (existing) {
      // Update label if it changed
      return existing.label !== undefined ? ({ ...existing, label: m.label } as T) : existing
    }
    return makeBlank(m)
  })
}

// Keep a Record's keys aligned with a master list of ids
function syncRecord<V>(rec: Record<string, V>, ids: string[], blank: V): Record<string, V> {
  const next: Record<string, V> = {}
  ids.forEach((id) => {
    next[id] = rec[id] !== undefined ? rec[id] : blank
  })
  return next
}

const blankInsurance = (cat: { id: string; label: string }): InsuranceCategoryConfig => ({
  id: cat.id,
  label: cat.label,
  mode: 'all_tiers',
  byFascia: {},
  all: [],
})

const blankKm = (cat: { id: string; label: string }): KmConfig => ({
  id: cat.id,
  label: cat.label,
  table: { '1': '', '2': '', '3': '', '4': '', '5': '' },
  extraPerDay: 0,
  sforo: 0,
  unlimitedPerDay: 0,
})

const blankTariffa = (cat: { id: string; label: string }): TariffaGiornaliera => ({
  id: cat.id,
  label: cat.label,
  mode: 'unica',
  days: ['1', '2', '3', '4', '5', '6', '7'],
  unica: {},
  residente: {},
  non_residente: {},
  extraPerDay: 0,
})

const STORAGE_KEY = 'centralina_pro_v2'

type PersistedSnapshot = {
  categories: Category[]
  fasce: Fascia[]
  insurance: InsuranceCategoryConfig[]
  km: KmConfig[]
  deposits: DepositsConfig
  servizi: ServiziConfig
  prezzoDinamico: PrezzoDinamicoConfig
  preventivi: PreventiviConfig
}

function loadPersisted(): PersistedSnapshot | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as PersistedSnapshot
  } catch {
    return null
  }
}

function savePersisted(snap: PersistedSnapshot) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snap))
  } catch {
    // ignore quota / private mode errors
  }
}

function pick<T>(persisted: PersistedSnapshot | null, key: keyof PersistedSnapshot, fallback: T): T {
  if (persisted && persisted[key] !== undefined && persisted[key] !== null) {
    return persisted[key] as unknown as T
  }
  return fallback
}

export default function CentralinaProTab() {
  const [section, setSection] = useState<SectionId>('categorie-fascia')

  // Hydrate from localStorage (sync, before first render of children)
  const persisted = useMemo(() => loadPersisted(), [])

  const initialCategories = pick(persisted, 'categories', INITIAL_CATEGORIES)
  const initialFasce = pick(persisted, 'fasce', INITIAL_FASCE)
  const initialInsurance = pick(persisted, 'insurance', INITIAL_INSURANCE)
  const initialKm = pick(persisted, 'km', INITIAL_KM)
  const initialDeposits = pick(persisted, 'deposits', INITIAL_DEPOSITS)
  const initialServizi = pick(persisted, 'servizi', INITIAL_SERVIZI)
  const initialPrezzoDinamico = pick(persisted, 'prezzoDinamico', INITIAL_PREZZO_DINAMICO)
  const initialPreventivi = pick(persisted, 'preventivi', INITIAL_PREVENTIVI)

  // Current (working) state
  const [categories, setCategories] = useState<Category[]>(initialCategories)
  const [fasce, setFasce] = useState<Fascia[]>(initialFasce)
  const [insurance, setInsurance] = useState<InsuranceCategoryConfig[]>(initialInsurance)
  const [km, setKm] = useState<KmConfig[]>(initialKm)
  const [deposits, setDeposits] = useState<DepositsConfig>(initialDeposits)
  const [servizi, setServizi] = useState<ServiziConfig>(initialServizi)
  const [prezzoDinamico, setPrezzoDinamico] = useState<PrezzoDinamicoConfig>(initialPrezzoDinamico)
  const [preventivi, setPreventivi] = useState<PreventiviConfig>(initialPreventivi)

  // Saved (committed) snapshot — what was last persisted
  const [savedCategories, setSavedCategories] = useState<Category[]>(initialCategories)
  const [savedFasce, setSavedFasce] = useState<Fascia[]>(initialFasce)
  const [savedInsurance, setSavedInsurance] = useState<InsuranceCategoryConfig[]>(initialInsurance)
  const [savedKm, setSavedKm] = useState<KmConfig[]>(initialKm)
  const [savedDeposits, setSavedDeposits] = useState<DepositsConfig>(initialDeposits)
  const [savedServizi, setSavedServizi] = useState<ServiziConfig>(initialServizi)
  const [savedPrezzoDinamico, setSavedPrezzoDinamico] = useState<PrezzoDinamicoConfig>(initialPrezzoDinamico)
  const [savedPreventivi, setSavedPreventivi] = useState<PreventiviConfig>(initialPreventivi)

  const [justSaved, setJustSaved] = useState(false)

  // ─── SYNC EFFECTS ───
  // When categories change, ensure dependent configs (insurance, km, tariffe, base/min/max) have entries
  useEffect(() => {
    setInsurance((prev) => syncByCategory(prev, categories, blankInsurance))
    setKm((prev) => syncByCategory(prev, categories, blankKm))
    setPrezzoDinamico((pd) => ({
      ...pd,
      tariffe: syncByCategory(pd.tariffe, categories, blankTariffa),
      dynamic: {
        ...pd.dynamic,
        base_prices: syncRecord(pd.dynamic.base_prices, categories.map((c) => c.id), ''),
        min_prices: syncRecord(pd.dynamic.min_prices, categories.map((c) => c.id), 0),
        max_prices: syncRecord(pd.dynamic.max_prices, categories.map((c) => c.id), 0),
      },
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories])

  // When fasce change, ensure insurance.byFascia, deposits, second_driver have entries
  useEffect(() => {
    const fasciaIds = fasce.map((f) => f.id)
    setInsurance((prev) =>
      prev.map((cat) => ({
        ...cat,
        byFascia: syncRecord(cat.byFascia, fasciaIds, [] as InsuranceOption[]),
      }))
    )
    setDeposits((prev) => syncRecord(prev, fasciaIds, { residente: [], non_residente: [] } as DepositFasciaConfig))
    setServizi((prev) => ({
      ...prev,
      second_driver: syncRecord(prev.second_driver, fasciaIds, '' as number | ''),
      // clear orphan tier_only / tier_restriction references
      experience: prev.experience.map((s) =>
        s.tier_only && !fasciaIds.includes(s.tier_only) ? { ...s, tier_only: '' } : s
      ),
      dr7_flex: {
        ...prev.dr7_flex,
        tier_restriction:
          prev.dr7_flex.tier_restriction && !fasciaIds.includes(prev.dr7_flex.tier_restriction)
            ? ''
            : prev.dr7_flex.tier_restriction,
      },
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fasce])

  const changes = useMemo(
    () =>
      computeChanges(
        { categories, fasce, insurance, km, deposits, servizi, prezzoDinamico, preventivi },
        {
          categories: savedCategories,
          fasce: savedFasce,
          insurance: savedInsurance,
          km: savedKm,
          deposits: savedDeposits,
          servizi: savedServizi,
          prezzoDinamico: savedPrezzoDinamico,
          preventivi: savedPreventivi,
        }
      ),
    [
      categories, fasce, insurance, km, deposits, servizi, prezzoDinamico, preventivi,
      savedCategories, savedFasce, savedInsurance, savedKm, savedDeposits, savedServizi, savedPrezzoDinamico, savedPreventivi,
    ]
  )

  function handleSave() {
    setSavedCategories(categories)
    setSavedFasce(fasce)
    setSavedInsurance(insurance)
    setSavedKm(km)
    setSavedDeposits(deposits)
    setSavedServizi(servizi)
    setSavedPrezzoDinamico(prezzoDinamico)
    setSavedPreventivi(preventivi)
    savePersisted({ categories, fasce, insurance, km, deposits, servizi, prezzoDinamico, preventivi })
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
    setPrezzoDinamico(savedPrezzoDinamico)
    setPreventivi(savedPreventivi)
  }

  const hasChanges = changes.length > 0

  return (
    <div className="min-h-screen bg-[#f5f5f7] pb-32">
      <div className="max-w-6xl mx-auto px-4 md:px-8 py-8">
        <div className="flex items-start justify-between flex-wrap gap-4 mb-8">
          <div>
            <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-[#1d1d1f]">
              Centralina Pro
            </h1>
            <p className="mt-2 text-[15px] text-[#6e6e73]">
              Anteprima design · non ancora collegata ai dati
            </p>
          </div>
          <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[13px] font-medium bg-[#fff7e6] text-[#b25e09] border border-[#f5d08a]">
            <span className="w-1.5 h-1.5 rounded-full bg-current" />
            Preview
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-6">
          <aside className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden h-fit">
            <nav className="py-2">
              {SECTIONS.map((s, idx) => {
                const active = section === s.id
                return (
                  <button
                    key={s.id}
                    onClick={() => setSection(s.id)}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                      active
                        ? 'bg-[#007aff]/10'
                        : 'hover:bg-black/[0.03]:bg-white/[0.04]'
                    }`}
                  >
                    <span
                      className={`flex items-center justify-center w-7 h-7 rounded-full text-[13px] font-semibold ${
                        active
                          ? 'bg-[#007aff] text-white'
                          : 'bg-[#e5e5ea] text-[#1d1d1f]'
                      }`}
                    >
                      {idx + 1}
                    </span>
                    <span
                      className={`flex-1 min-w-0 text-[14px] font-medium truncate ${
                        active ? 'text-[#007aff]' : 'text-[#1d1d1f]'
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
              <AssicurazioniSection insurance={insurance} setInsurance={setInsurance} fasce={fasce} />
            )}
            {section === 'p3' && <KmSforoSection km={km} setKm={setKm} />}
            {section === 'p4' && <CauzioniSection deposits={deposits} setDeposits={setDeposits} fasce={fasce} />}
            {section === 'p5' && <ServiziSection servizi={servizi} setServizi={setServizi} fasce={fasce} />}
            {section === 'p6' && (
              <PrezzoDinamicoSection config={prezzoDinamico} setConfig={setPrezzoDinamico} />
            )}
            {section === 'p7' && (
              <PreventiviSection preventivi={preventivi} setPreventivi={setPreventivi} />
            )}
            {section !== 'categorie-fascia' && section !== 'p2' && section !== 'p3' && section !== 'p4' && section !== 'p5' && section !== 'p6' && section !== 'p7' && (
              <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-12 text-center">
                <p className="text-[15px] text-[#6e6e73]">
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
              : 'bg-white/95 border-black/10'
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
                <p className="text-[13px] font-semibold text-[#1d1d1f] mb-1">
                  {changes.length} modifica{changes.length > 1 ? 'e' : ''} da salvare
                </p>
                <ul className="text-[12px] text-[#6e6e73] space-y-0.5 max-h-24 overflow-y-auto">
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
                  className="px-4 py-2 rounded-lg text-[14px] font-medium text-[#1d1d1f] hover:bg-black/5:bg-white/10 transition-colors"
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
  prezzoDinamico: PrezzoDinamicoConfig
  preventivi: PreventiviConfig
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
      if (p.tier_only !== s.tier_only) out.push(`Servizi / ${s.name}: restrizione fascia modificata`)
      if (p.is_active !== s.is_active) out.push(`Servizi / ${s.name}: ${s.is_active ? 'attivato' : 'disattivato'}`)
    })

    const cf = current.servizi.dr7_flex
    const pf = saved.servizi.dr7_flex
    if (pf.daily_price !== cf.daily_price) out.push(`DR7 Flex: prezzo €${pf.daily_price} → €${cf.daily_price}/g`)
    if (pf.refund_percent !== cf.refund_percent) out.push(`DR7 Flex: rimborso ${pf.refund_percent}% → ${cf.refund_percent}%`)
    if (pf.tier_restriction !== cf.tier_restriction) out.push(`DR7 Flex: restrizione fascia modificata`)
    if (pf.description !== cf.description) out.push(`DR7 Flex: descrizione modificata`)

    if (saved.servizi.lavaggio.fee !== current.servizi.lavaggio.fee) out.push(`Pulizia Finale: €${saved.servizi.lavaggio.fee} → €${current.servizi.lavaggio.fee}`)
    if (saved.servizi.lavaggio.mandatory !== current.servizi.lavaggio.mandatory) out.push(`Pulizia Finale: ${current.servizi.lavaggio.mandatory ? 'obbligatoria' : 'facoltativa'}`)
    if (saved.servizi.delivery.price_per_km !== current.servizi.delivery.price_per_km) out.push(`Consegna a domicilio: €${saved.servizi.delivery.price_per_km} → €${current.servizi.delivery.price_per_km}/km`)
    {
      const sdKeys = new Set([...Object.keys(saved.servizi.second_driver), ...Object.keys(current.servizi.second_driver)])
      sdKeys.forEach((k) => {
        if (saved.servizi.second_driver[k] !== current.servizi.second_driver[k]) {
          out.push(`Secondo Guidatore (${k}): €${saved.servizi.second_driver[k] ?? 0} → €${current.servizi.second_driver[k] ?? 0}/g`)
        }
      })
    }
  }

  // Prezzo Dinamico — Tariffe
  current.prezzoDinamico.tariffe.forEach((t) => {
    const p = saved.prezzoDinamico.tariffe.find((x) => x.id === t.id)
    if (!p) return
    if (p.mode !== t.mode) out.push(`Tariffe / ${t.label}: modalita ${p.mode} → ${t.mode}`)
    if (p.extraPerDay !== t.extraPerDay) out.push(`Tariffe / ${t.label}: extra/giorno ${p.extraPerDay} → ${t.extraPerDay}`)
    const days = new Set([...t.days, ...p.days])
    days.forEach((d) => {
      if (p.unica[d] !== t.unica[d]) out.push(`Tariffe / ${t.label} (unica) ${d}g: ${p.unica[d] || 0} → ${t.unica[d] || 0}`)
      if (p.residente[d] !== t.residente[d]) out.push(`Tariffe / ${t.label} (residente) ${d}g: ${p.residente[d] || 0} → ${t.residente[d] || 0}`)
      if (p.non_residente[d] !== t.non_residente[d]) out.push(`Tariffe / ${t.label} (non residente) ${d}g: ${p.non_residente[d] || 0} → ${t.non_residente[d] || 0}`)
    })
  })

  // Prezzo Dinamico — Engine
  {
    const cd = current.prezzoDinamico.dynamic
    const pd = saved.prezzoDinamico.dynamic
    if (pd.enabled !== cd.enabled) out.push(`Revenue Engine: ${cd.enabled ? 'attivato' : 'disattivato'}`)
    if (pd.mode !== cd.mode) out.push(`Revenue Engine: modalita ${pd.mode} → ${cd.mode}`)
    const priceKeys = new Set([...Object.keys(cd.base_prices), ...Object.keys(pd.base_prices)])
    priceKeys.forEach((k) => {
      if (pd.base_prices[k] !== cd.base_prices[k]) out.push(`Prezzo base / ${k}: ${pd.base_prices[k] || 0} → ${cd.base_prices[k] || 0}`)
      if (pd.min_prices[k] !== cd.min_prices[k]) out.push(`Prezzo min / ${k}: ${pd.min_prices[k] || 0} → ${cd.min_prices[k] || 0}`)
      if (pd.max_prices[k] !== cd.max_prices[k]) out.push(`Prezzo max / ${k}: ${pd.max_prices[k] || 0} → ${cd.max_prices[k] || 0}`)
    })
    diffCoeffRows('Occupazione', cd.occupation_coefficients, pd.occupation_coefficients, out)
    diffCoeffRows('Anticipo', cd.advance_coefficients, pd.advance_coefficients, out)
    diffCoeffRows('Durata', cd.duration_coefficients, pd.duration_coefficients, out)
  }

  // Preventivi
  {
    const cp = current.preventivi
    const pp = saved.preventivi
    if (pp.maggiorazione_pct !== cp.maggiorazione_pct) out.push(`Preventivi: maggiorazione ${pp.maggiorazione_pct}% → ${cp.maggiorazione_pct}%`)
    if (pp.scadenza_default_ore !== cp.scadenza_default_ore) out.push(`Preventivi: scadenza ${pp.scadenza_default_ore}h → ${cp.scadenza_default_ore}h`)
    cp.messaggi.forEach((m) => {
      const prev = pp.messaggi.find((x) => x.key === m.key)
      if (!prev) return
      if (prev.body !== m.body) out.push(`Preventivi / ${m.label}: testo modificato`)
      if (prev.is_enabled !== m.is_enabled) out.push(`Preventivi / ${m.label}: ${m.is_enabled ? 'attivato' : 'disattivato'}`)
    })
  }

  // Cauzioni
  const allFasciaIds = new Set([...Object.keys(current.deposits), ...Object.keys(saved.deposits)])
  allFasciaIds.forEach((fid) => {
    ;(['residente', 'non_residente'] as const).forEach((scope) => {
      const cur = current.deposits[fid]?.[scope] ?? []
      const prev = saved.deposits[fid]?.[scope] ?? []
      const prefix = `Cauzioni / Fascia ${fid} ${scope === 'residente' ? 'Residente' : 'Non Residente'}`
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
  })

  // Insurance
  current.insurance.forEach((cat) => {
    const prevCat = saved.insurance.find((c) => c.id === cat.id)
    if (!prevCat) return
    if (prevCat.mode !== cat.mode) {
      out.push(`${cat.label}: modalita cambiata (${prevCat.mode === 'per_fascia' ? 'per fascia' : 'tutte le fasce'} → ${cat.mode === 'per_fascia' ? 'per fascia' : 'tutte le fasce'})`)
    }
    const fasciaIds = new Set([...Object.keys(cat.byFascia), ...Object.keys(prevCat.byFascia)])
    fasciaIds.forEach((fid) => {
      diffInsuranceList(cat.label, `Fascia ${fid}`, cat.byFascia[fid] ?? [], prevCat.byFascia[fid] ?? [], out)
    })
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
    <section className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
      <header className="px-5 pt-5 pb-3">
        <h2 className="text-[17px] font-semibold text-[#1d1d1f] tracking-tight">
          {title}
        </h2>
        <p className="text-[13px] text-[#6e6e73] mt-0.5">{subtitle}</p>
      </header>

      <ul className="divide-y divide-black/5">
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-3 px-5 py-3 group">
            <input
              value={item.label}
              onChange={(e) => update(item.id, e.target.value)}
              className="flex-1 bg-transparent outline-none text-[15px] text-[#1d1d1f] placeholder:text-[#a1a1a6] focus:bg-[#f5f5f7]:bg-white/5 rounded-lg px-2 py-1.5 -mx-2 transition-colors"
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
          <li className="px-5 py-6 text-center text-[13px] text-[#6e6e73]">
            Nessun elemento — aggiungine uno qui sotto
          </li>
        )}
      </ul>

      <footer className="px-5 py-3 border-t border-black/5 bg-[#fafafa] flex items-center gap-2">
        <input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add()
          }}
          placeholder={placeholderNew}
          className="flex-1 bg-white border border-black/10 rounded-lg px-3 py-2 text-[14px] text-[#1d1d1f] placeholder:text-[#a1a1a6] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
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
    <section className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
      <header className="px-5 pt-5 pb-3">
        <h2 className="text-[17px] font-semibold text-[#1d1d1f] tracking-tight">
          Fascia
        </h2>
        <p className="text-[13px] text-[#6e6e73] mt-0.5">
          Fasce conducente — eta e anni di patente
        </p>
      </header>

      <ul className="divide-y divide-black/5">
        {items.map((f) => (
          <li key={f.id} className="p-5 group">
            <div className="flex items-start gap-3 mb-4">
              <input
                value={f.label}
                onChange={(e) => patch(f.id, { label: e.target.value })}
                className="flex-1 bg-transparent outline-none text-[17px] font-semibold text-[#1d1d1f] placeholder:text-[#a1a1a6] focus:bg-[#f5f5f7]:bg-white/5 rounded-lg px-2 py-1 -mx-2 transition-colors"
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
              className="w-full bg-transparent outline-none text-[14px] text-[#6e6e73] placeholder:text-[#a1a1a6] focus:bg-[#f5f5f7]:bg-white/5 rounded-lg px-2 py-1.5 -mx-2 mb-4 transition-colors"
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
          <li className="px-5 py-6 text-center text-[13px] text-[#6e6e73]">
            Nessuna fascia configurata
          </li>
        )}
      </ul>

      <footer className="px-5 py-3 border-t border-black/5 bg-[#fafafa]">
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
      <span className="block text-[12px] font-medium text-[#6e6e73] mb-1">
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
          className="w-full bg-white border border-black/10 rounded-lg px-3 py-2 pr-14 text-[14px] text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
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
  byFascia: Record<string, InsuranceOption[]> // keyed by fascia.id
  all: InsuranceOption[]
}

const INITIAL_INSURANCE: InsuranceCategoryConfig[] = [
  {
    id: 'supercars',
    label: 'Supercars / Exotic',
    mode: 'per_fascia',
    byFascia: {
      A: [
        { id: uid(), name: 'RCA Compresa (no Kasko)', daily_price: 0, mandatory_deposit: 10000, deductible_fixed: 0, deductible_percent: 0 },
        { id: uid(), name: 'Kasko Base', daily_price: 89, mandatory_deposit: 0, deductible_fixed: 5000, deductible_percent: 30 },
        { id: uid(), name: 'Kasko Black', daily_price: 149, mandatory_deposit: 0, deductible_fixed: 5000, deductible_percent: 10 },
        { id: uid(), name: 'Kasko Signature', daily_price: 189, mandatory_deposit: 0, deductible_fixed: 5000, deductible_percent: 0 },
        { id: uid(), name: 'Kasko DR7', daily_price: 289, mandatory_deposit: 0, deductible_fixed: 0, deductible_percent: 0 },
      ],
      B: [
        { id: uid(), name: 'RCA Compresa (no Kasko)', daily_price: 0, mandatory_deposit: 15000, deductible_fixed: 0, deductible_percent: 0 },
        { id: uid(), name: 'Kasko Base', daily_price: 119, mandatory_deposit: 0, deductible_fixed: 5000, deductible_percent: 30 },
      ],
    },
    all: [],
  },
  {
    id: 'urban',
    label: 'Urban',
    mode: 'all_tiers',
    byFascia: {},
    all: [
      { id: uid(), name: 'Kasko Base', daily_price: 15, mandatory_deposit: 0, deductible_fixed: 0, deductible_percent: 0 },
      { id: uid(), name: 'Kasko DR7', daily_price: 45, mandatory_deposit: 0, deductible_fixed: 0, deductible_percent: 0 },
    ],
  },
  {
    id: 'aziendali',
    label: 'Aziendali',
    mode: 'all_tiers',
    byFascia: {},
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
  fasce,
}: {
  insurance: InsuranceCategoryConfig[]
  fasce: Fascia[]
  setInsurance: (next: InsuranceCategoryConfig[]) => void
}) {
  const config = insurance

  function updateCategory(id: string, patch: Partial<InsuranceCategoryConfig>) {
    setInsurance(config.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[22px] font-semibold tracking-tight text-[#1d1d1f]">
          Prezzi Assicurazioni
        </h2>
        <p className="text-[14px] text-[#6e6e73] mt-1">
          Per categoria e fascia conducente
        </p>
      </div>

      {config.map((cat) => (
        <InsuranceCategoryCard
          key={cat.id}
          category={cat}
          fasce={fasce}
          onChange={(patch) => updateCategory(cat.id, patch)}
        />
      ))}
    </div>
  )
}

function InsuranceCategoryCard({
  category,
  fasce,
  onChange,
}: {
  category: InsuranceCategoryConfig
  fasce: Fascia[]
  onChange: (patch: Partial<InsuranceCategoryConfig>) => void
}) {
  return (
    <section className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
      <header className="px-5 pt-5 pb-4 flex items-center justify-between gap-4 flex-wrap">
        <h3 className="text-[17px] font-semibold text-[#1d1d1f] tracking-tight">
          {category.label}
        </h3>
        <label className="flex items-center gap-2 text-[13px] text-[#6e6e73]">
          <span>Modalita</span>
          <select
            value={category.mode}
            onChange={(e) => onChange({ mode: e.target.value as Mode })}
            className="bg-white border border-black/10 rounded-lg px-3 py-1.5 text-[13px] text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
          >
            <option value="per_fascia">Per fascia (separata)</option>
            <option value="all_tiers">Uguale per tutte le fasce</option>
          </select>
        </label>
      </header>

      {category.mode === 'per_fascia' ? (
        <div className="divide-y divide-black/5 border-t border-black/5">
          {fasce.map((f) => (
            <InsuranceList
              key={f.id}
              heading={`${f.label}${f.description ? ` — ${f.description}` : ''}`}
              items={category.byFascia[f.id] ?? []}
              onChange={(next) =>
                onChange({ byFascia: { ...category.byFascia, [f.id]: next } })
              }
            />
          ))}
          {fasce.length === 0 && (
            <p className="px-5 py-6 text-center text-[13px] text-[#6e6e73]">
              Nessuna fascia configurata. Aggiungine una in "Categorie & Fascia".
            </p>
          )}
        </div>
      ) : (
        <div className="border-t border-black/5">
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
      <p className="text-[13px] font-medium text-[#6e6e73] mb-4">{heading}</p>

      <div className="space-y-3">
        {items.map((opt) => (
          <div
            key={opt.id}
            className="rounded-xl border border-black/[0.06] bg-[#fafafa] p-4 group"
          >
            <div className="flex items-center gap-3 mb-3">
              <input
                value={opt.name}
                onChange={(e) => patch(opt.id, { name: e.target.value })}
                placeholder="Nome opzione"
                className="flex-1 bg-transparent outline-none text-[15px] font-semibold text-[#1d1d1f] placeholder:text-[#a1a1a6] focus:bg-white:bg-white/5 rounded-lg px-2 py-1 -mx-2 transition-colors"
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
          <p className="text-center text-[13px] text-[#6e6e73] py-4">
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
        className="w-full bg-white border border-black/10 rounded-lg px-3 py-2 text-[14px] text-right tabular-nums text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
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
        <h2 className="text-[22px] font-semibold tracking-tight text-[#1d1d1f]">
          Km & Sforo
        </h2>
        <p className="text-[14px] text-[#6e6e73] mt-1">
          Km inclusi per giorno, sforo e prezzo km illimitati per categoria
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {km.map((cat) => (
          <section
            key={cat.id}
            className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden flex flex-col"
          >
            <header className="px-5 pt-5 pb-3">
              <h3 className="text-[17px] font-semibold text-[#1d1d1f] tracking-tight">
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
                    <span className="w-14 text-[13px] text-[#6e6e73]">
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
                        className="w-full bg-[#f5f5f7] border border-black/5 rounded-lg px-3 py-2 pr-10 text-[14px] text-right tabular-nums text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-[#a1a1a6] pointer-events-none">
                        km
                      </span>
                    </div>
                  </div>
                ))}
                <div className="flex items-center gap-3 pt-2 border-t border-black/[0.06] mt-2">
                  <span className="w-14 text-[13px] text-[#6e6e73]">
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
                      className="w-full bg-[#f5f5f7] border border-black/5 rounded-lg px-3 py-2 pr-10 text-[14px] text-right tabular-nums text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-[#a1a1a6] pointer-events-none">
                      km
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-black/[0.06] bg-[#fafafa]">
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
                    className="w-full bg-white border border-black/10 rounded-lg pl-7 pr-14 py-2 text-[14px] text-right tabular-nums text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-[#a1a1a6] pointer-events-none">
                    /km
                  </span>
                </div>
              </label>
            </div>

            <div className="px-5 py-4 border-t border-black/[0.06] mt-auto">
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
                    className="w-full bg-white border border-black/10 rounded-lg pl-7 pr-16 py-2 text-[14px] text-right tabular-nums text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
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
  fasce,
}: {
  deposits: DepositsConfig
  setDeposits: (next: DepositsConfig) => void
  fasce: Fascia[]
}) {
  type Scope = 'residente' | 'non_residente'
  function patchOption(fid: string, scope: Scope, optId: string, p: Partial<DepositOption>) {
    const cur = deposits[fid] ?? { residente: [], non_residente: [] }
    setDeposits({
      ...deposits,
      [fid]: { ...cur, [scope]: cur[scope].map((o) => (o.id === optId ? { ...o, ...p } : o)) },
    })
  }
  function removeOption(fid: string, scope: Scope, optId: string) {
    const cur = deposits[fid] ?? { residente: [], non_residente: [] }
    setDeposits({
      ...deposits,
      [fid]: { ...cur, [scope]: cur[scope].filter((o) => o.id !== optId) },
    })
  }
  function addOption(fid: string, scope: Scope) {
    const cur = deposits[fid] ?? { residente: [], non_residente: [] }
    setDeposits({
      ...deposits,
      [fid]: {
        ...cur,
        [scope]: [...cur[scope], { id: uid(), label: 'Nuova opzione', amount: 0, surcharge_per_day: 0 }],
      },
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[22px] font-semibold tracking-tight text-[#1d1d1f]">
          Opzioni Cauzione per Fascia
        </h2>
        <p className="text-[14px] text-[#6e6e73] mt-1">
          Opzioni cauzione per fascia conducente e residenza
        </p>
      </div>

      {fasce.length === 0 && (
        <p className="text-center text-[13px] text-[#6e6e73] py-8">
          Nessuna fascia configurata. Aggiungine una in "Categorie & Fascia".
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {fasce.flatMap((f) =>
          (['residente', 'non_residente'] as Scope[]).map((scope) => {
            const groupLabel = `${f.label} — ${scope === 'residente' ? 'Residente' : 'Non Residente'}`
            const items = deposits[f.id]?.[scope] ?? []
            return (
              <section
                key={`${f.id}_${scope}`}
                className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden"
              >
                <header className="px-5 pt-5 pb-3">
                  <h3 className="text-[15px] font-semibold text-[#1d1d1f] tracking-tight">
                    {groupLabel}
                  </h3>
                </header>

                <ul className="divide-y divide-black/5">
                  {items.map((opt) => (
                    <li key={opt.id} className="px-5 py-3 group">
                      <div className="flex items-center gap-3 mb-2">
                        <input
                          value={opt.label}
                          onChange={(e) => patchOption(f.id, scope, opt.id, { label: e.target.value })}
                          placeholder="Nome opzione"
                          className="flex-1 bg-transparent outline-none text-[14px] font-medium text-[#1d1d1f] placeholder:text-[#a1a1a6] focus:bg-[#f5f5f7] rounded-lg px-2 py-1 -mx-2 transition-colors"
                        />
                        <button
                          onClick={() => removeOption(f.id, scope, opt.id)}
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
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-[#a1a1a6] pointer-events-none">€</span>
                            <input
                              type="number"
                              min={0}
                              value={opt.amount}
                              onChange={(e) => {
                                const v = e.target.value
                                patchOption(f.id, scope, opt.id, { amount: v === '' ? '' : Number(v) })
                              }}
                              className="w-full bg-white border border-black/10 rounded-lg pl-7 pr-3 py-2 text-[14px] text-right tabular-nums text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
                            />
                          </div>
                        </label>
                        <label className="block">
                          <span className="block text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6] mb-1">
                            Sovrapprezzo / giorno
                          </span>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-[#a1a1a6] pointer-events-none">€</span>
                            <input
                              type="number"
                              min={0}
                              value={opt.surcharge_per_day}
                              onChange={(e) => {
                                const v = e.target.value
                                patchOption(f.id, scope, opt.id, { surcharge_per_day: v === '' ? '' : Number(v) })
                              }}
                              className="w-full bg-white border border-black/10 rounded-lg pl-7 pr-10 py-2 text-[14px] text-right tabular-nums text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-[#a1a1a6] pointer-events-none">/g</span>
                          </div>
                        </label>
                      </div>
                    </li>
                  ))}
                  {items.length === 0 && (
                    <li className="px-5 py-6 text-center text-[13px] text-[#6e6e73]">
                      Nessuna opzione
                    </li>
                  )}
                </ul>

                <footer className="px-5 py-3 border-t border-black/5 bg-[#fafafa]">
                  <button
                    onClick={() => addOption(f.id, scope)}
                    className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#007aff] hover:text-[#0066d6] transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                    </svg>
                    Aggiungi opzione
                  </button>
                </footer>
              </section>
            )
          })
        )}
      </div>
    </div>
  )
}

// ========== SERVIZI (Punto 5) ==========

function ServiziSection({
  servizi,
  setServizi,
  fasce,
}: {
  servizi: ServiziConfig
  setServizi: (next: ServiziConfig) => void
  fasce: Fascia[]
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
      <section className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
        <header className="px-5 pt-5 pb-3 flex items-center justify-between">
          <div>
            <h2 className="text-[17px] font-semibold text-[#1d1d1f] tracking-tight">
              Servizi Experience
            </h2>
            <p className="text-[13px] text-[#6e6e73] mt-0.5">
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

        <ul className="divide-y divide-black/5">
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
                  className="flex-1 min-w-[200px] bg-transparent outline-none text-[14px] font-medium text-[#1d1d1f] placeholder:text-[#a1a1a6] focus:bg-[#f5f5f7]:bg-white/5 rounded-lg px-2 py-1.5 -mx-2 transition-colors"
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
                    className="w-24 bg-white border border-black/10 rounded-lg pl-7 pr-2 py-1.5 text-[14px] text-right tabular-nums text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
                  />
                </div>
                <select
                  value={s.unit}
                  onChange={(e) => patchExp(s.id, { unit: e.target.value as ServiceUnit })}
                  className="bg-white border border-black/10 rounded-lg px-3 py-1.5 text-[13px] text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
                >
                  {(Object.keys(UNIT_LABELS) as ServiceUnit[]).map((u) => (
                    <option key={u} value={u}>
                      {UNIT_LABELS[u]}
                    </option>
                  ))}
                </select>
                <select
                  value={s.tier_only}
                  onChange={(e) => patchExp(s.id, { tier_only: e.target.value })}
                  className="bg-white border border-black/10 rounded-lg px-3 py-1.5 text-[13px] text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
                >
                  <option value="">Tutte le fasce</option>
                  {fasce.map((f) => (
                    <option key={f.id} value={f.id}>Solo {f.label}</option>
                  ))}
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
            <li className="px-5 py-6 text-center text-[13px] text-[#6e6e73]">
              Nessun servizio
            </li>
          )}
        </ul>
      </section>

      {/* DR7 Flex */}
      <section className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
        <header className="px-5 pt-5 pb-3">
          <h2 className="text-[17px] font-semibold text-[#1d1d1f] tracking-tight">
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
                  className="w-full bg-white border border-black/10 rounded-lg pl-7 pr-3 py-2 text-[14px] text-right tabular-nums text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
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
                  className="w-full bg-white border border-black/10 rounded-lg pl-3 pr-8 py-2 text-[14px] text-right tabular-nums text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
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
                  setServizi({ ...servizi, dr7_flex: { ...servizi.dr7_flex, tier_restriction: e.target.value } })
                }
                className="w-full bg-white border border-black/10 rounded-lg px-3 py-2 text-[14px] text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
              >
                <option value="">Tutte le fasce</option>
                {fasce.map((f) => (
                  <option key={f.id} value={f.id}>Solo {f.label}</option>
                ))}
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
              className="w-full bg-white border border-black/10 rounded-lg px-3 py-2 text-[14px] text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
            />
          </label>
        </div>
      </section>

      {/* Simple services: 3-column grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Pulizia Finale */}
        <section className="bg-white rounded-2xl border border-black/5 shadow-sm p-5">
          <h3 className="text-[15px] font-semibold text-[#1d1d1f] mb-3">
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
                className="w-full bg-white border border-black/10 rounded-lg pl-7 pr-3 py-2 text-[14px] text-right tabular-nums text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
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
            <span className="text-[13px] text-[#1d1d1f]">Obbligatoria</span>
          </label>
        </section>

        {/* Consegna a Domicilio */}
        <section className="bg-white rounded-2xl border border-black/5 shadow-sm p-5">
          <h3 className="text-[15px] font-semibold text-[#1d1d1f] mb-3">
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
                className="w-full bg-white border border-black/10 rounded-lg pl-7 pr-12 py-2 text-[14px] text-right tabular-nums text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-[#a1a1a6] pointer-events-none">
                /km
              </span>
            </div>
          </label>
        </section>

        {/* Secondo Guidatore */}
        <section className="bg-white rounded-2xl border border-black/5 shadow-sm p-5">
          <h3 className="text-[15px] font-semibold text-[#1d1d1f] mb-3">
            Secondo Guidatore
          </h3>
          <div className="space-y-2">
            {fasce.map((f) => (
              <div key={f.id} className="flex items-center gap-3">
                <span className="w-20 text-[13px] text-[#6e6e73] truncate">{f.label}</span>
                <div className="flex-1 relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-[#a1a1a6] pointer-events-none">€</span>
                  <input
                    type="number"
                    min={0}
                    value={servizi.second_driver[f.id] ?? ''}
                    onChange={(e) => {
                      const v = e.target.value
                      setServizi({
                        ...servizi,
                        second_driver: { ...servizi.second_driver, [f.id]: v === '' ? '' : Number(v) },
                      })
                    }}
                    className="w-full bg-white border border-black/10 rounded-lg pl-7 pr-10 py-2 text-[14px] text-right tabular-nums text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-[#a1a1a6] pointer-events-none">/g</span>
                </div>
              </div>
            ))}
            {fasce.length === 0 && (
              <p className="text-center text-[13px] text-[#6e6e73] py-2">
                Nessuna fascia configurata
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

function diffCoeffRows(label: string, cur: CoefficientRow[], prev: CoefficientRow[], out: string[]) {
  const prevIds = new Set(prev.map((r) => r.id))
  const curIds = new Set(cur.map((r) => r.id))
  cur.forEach((r) => {
    if (!prevIds.has(r.id)) out.push(`Coefficienti ${label}: aggiunta "${r.label || 'Nuova riga'}"`)
  })
  prev.forEach((r) => {
    if (!curIds.has(r.id)) out.push(`Coefficienti ${label}: rimossa "${r.label}"`)
  })
  cur.forEach((r) => {
    const p = prev.find((x) => x.id === r.id)
    if (!p) return
    if (p.min !== r.min || p.max !== r.max) out.push(`Coefficienti ${label} / ${r.label}: range ${p.min}-${p.max} → ${r.min}-${r.max}`)
    if (p.coeff !== r.coeff) out.push(`Coefficienti ${label} / ${r.label}: coefficiente ${p.coeff} → ${r.coeff}`)
    if (p.label !== r.label) out.push(`Coefficienti ${label}: "${p.label}" rinominata in "${r.label}"`)
  })
}

// ========== PREZZO DINAMICO (Punto 6) ==========

function PrezzoDinamicoSection({
  config,
  setConfig,
}: {
  config: PrezzoDinamicoConfig
  setConfig: (next: PrezzoDinamicoConfig) => void
}) {
  const [vehicles, setVehicles] = useState<FleetVehicle[]>([])
  const [vehiclesLoading, setVehiclesLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('vehicles')
        .select('id, display_name, daily_rate, category')
        .neq('status', 'retired')
        .order('display_name')
      if (!cancelled) {
        setVehicles((data as FleetVehicle[]) || [])
        setVehiclesLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  function patchDyn(p: Partial<DynamicPricingConfig>) {
    setConfig({ ...config, dynamic: { ...config.dynamic, ...p } })
  }
  function patchPrice(scope: 'base_prices' | 'min_prices' | 'max_prices', key: string, value: number | '') {
    patchDyn({ [scope]: { ...config.dynamic[scope], [key]: value } } as Partial<DynamicPricingConfig>)
  }

  return (
    <div className="space-y-8">
      {/* ─── REVENUE ENGINE ─── */}
      <div>
        <h2 className="text-[22px] font-semibold tracking-tight text-[#1d1d1f]">
          Revenue Engine — Pricing Dinamico
        </h2>
        <p className="text-[14px] text-[#6e6e73] mt-1 mb-5">
          Prezzi dinamici, coefficienti e limiti min/max
        </p>

        {/* Enabled + Mode */}
        <section className="bg-white rounded-2xl border border-black/5 shadow-sm p-5 mb-4">
          <div className="flex items-center gap-4 flex-wrap">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={config.dynamic.enabled}
                onChange={(e) => patchDyn({ enabled: e.target.checked })}
                className="w-5 h-5 accent-[#007aff]"
              />
              <span className="text-[15px] font-semibold text-[#1d1d1f]">
                Revenue Management attivo
              </span>
            </label>
            <div className="flex-1" />
            <label className="flex items-center gap-2 text-[13px] text-[#6e6e73]">
              <span>Modalita</span>
              <select
                value={config.dynamic.mode}
                onChange={(e) => patchDyn({ mode: e.target.value as DynamicMode })}
                className="bg-white border border-black/10 rounded-lg px-3 py-1.5 text-[13px] text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
              >
                <option value="disabled">Disabilitato</option>
                <option value="suggestion">Suggerimento</option>
                <option value="auto_apply">Applicazione automatica</option>
              </select>
            </label>
          </div>
        </section>

        {/* Prezzi Base + Limiti Min/Max — per veicolo */}
        <section className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden mb-4">
          <header className="px-5 pt-5 pb-3">
            <h3 className="text-[15px] font-semibold text-[#1d1d1f] tracking-tight">
              Prezzi Base + Limiti per Veicolo
            </h3>
            <p className="text-[13px] text-[#6e6e73] mt-0.5">
              Override del prezzo base e vincoli min/max applicati dopo i coefficienti — per ogni veicolo della flotta
            </p>
          </header>
          <div className="px-5 pb-5 space-y-3">
            <div className="grid grid-cols-[2fr_repeat(3,minmax(0,1fr))] gap-2 items-center text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6] px-1">
              <span>Veicolo</span>
              <span className="text-right">Prezzo Base €/g</span>
              <span className="text-right">Min €/g</span>
              <span className="text-right">Max €/g</span>
            </div>
            {vehiclesLoading && (
              <p className="text-center text-[13px] text-[#6e6e73] py-4">
                Caricamento flotta…
              </p>
            )}
            {!vehiclesLoading && vehicles.length === 0 && (
              <p className="text-center text-[13px] text-[#6e6e73] py-4">
                Nessun veicolo nella flotta
              </p>
            )}
            <div className="max-h-[600px] overflow-y-auto -mx-1 px-1 space-y-6">
              {(
                [
                  { key: 'exotic', label: 'Exotic Supercars' },
                  { key: 'urban', label: 'Urban' },
                  { key: 'aziendali', label: 'Aziendali' },
                ] as const
              ).map((group) => {
                const vs = vehicles.filter((v) => (v.category ?? 'exotic') === group.key)
                if (vs.length === 0) return null
                return (
                  <div key={group.key}>
                    <h4 className="text-[12px] font-semibold uppercase tracking-wider text-[#6e6e73] mb-2 px-1 sticky top-0 bg-white py-1 z-10">
                      {group.label} <span className="text-[#a1a1a6] font-normal">· {vs.length}</span>
                    </h4>
                    <div className="space-y-2">
                      {vs.map((v) => (
                        <div key={v.id} className="grid grid-cols-[2fr_repeat(3,minmax(0,1fr))] gap-2 items-center">
                          <div className="min-w-0">
                            <div className="text-[14px] text-[#1d1d1f] font-medium truncate">{v.display_name}</div>
                            {v.daily_rate != null && (
                              <div className="text-[11px] text-[#a1a1a6]">listino €{v.daily_rate}/g</div>
                            )}
                          </div>
                          <PriceBox
                            value={config.dynamic.base_prices[v.id] ?? ''}
                            onChange={(val) => patchPrice('base_prices', v.id, val)}
                            placeholder="—"
                          />
                          <PriceBox
                            value={config.dynamic.min_prices[v.id] ?? ''}
                            onChange={(val) => patchPrice('min_prices', v.id, val)}
                          />
                          <PriceBox
                            value={config.dynamic.max_prices[v.id] ?? ''}
                            onChange={(val) => patchPrice('max_prices', v.id, val)}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
              {(() => {
                const known = new Set(['exotic', 'urban', 'aziendali'])
                const others = vehicles.filter((v) => !known.has(v.category ?? 'exotic'))
                if (others.length === 0) return null
                return (
                  <div>
                    <h4 className="text-[12px] font-semibold uppercase tracking-wider text-[#6e6e73] mb-2 px-1 sticky top-0 bg-white py-1 z-10">
                      Altre categorie <span className="text-[#a1a1a6] font-normal">· {others.length}</span>
                    </h4>
                    <div className="space-y-2">
                      {others.map((v) => (
                        <div key={v.id} className="grid grid-cols-[2fr_repeat(3,minmax(0,1fr))] gap-2 items-center">
                          <div className="min-w-0">
                            <div className="text-[14px] text-[#1d1d1f] font-medium truncate">{v.display_name}</div>
                            <div className="text-[11px] text-[#a1a1a6]">
                              {v.category ?? '—'}
                              {v.daily_rate != null && <> · listino €{v.daily_rate}/g</>}
                            </div>
                          </div>
                          <PriceBox
                            value={config.dynamic.base_prices[v.id] ?? ''}
                            onChange={(val) => patchPrice('base_prices', v.id, val)}
                            placeholder="—"
                          />
                          <PriceBox
                            value={config.dynamic.min_prices[v.id] ?? ''}
                            onChange={(val) => patchPrice('min_prices', v.id, val)}
                          />
                          <PriceBox
                            value={config.dynamic.max_prices[v.id] ?? ''}
                            onChange={(val) => patchPrice('max_prices', v.id, val)}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })()}
            </div>
          </div>
        </section>

        {/* Coefficienti */}
        <div className="space-y-4">
          <CoefficientTable
            title="Coefficienti Occupazione"
            subtitle="Moltiplicatore basato sulla % di occupazione della flotta"
            unit="%"
            rows={config.dynamic.occupation_coefficients}
            onChange={(rows) => patchDyn({ occupation_coefficients: rows })}
          />
          <CoefficientTable
            title="Coefficienti Anticipo"
            subtitle="Moltiplicatore basato sui giorni di anticipo della prenotazione"
            unit="giorni"
            rows={config.dynamic.advance_coefficients}
            onChange={(rows) => patchDyn({ advance_coefficients: rows })}
          />
          <CoefficientTable
            title="Coefficienti Durata"
            subtitle="Moltiplicatore basato sulla durata del noleggio"
            unit="giorni"
            rows={config.dynamic.duration_coefficients}
            onChange={(rows) => patchDyn({ duration_coefficients: rows })}
          />
        </div>
      </div>
    </div>
  )
}

function PriceBox({
  value,
  onChange,
  placeholder,
}: {
  value: number | ''
  onChange: (v: number | '') => void
  placeholder?: string
}) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-[#a1a1a6] pointer-events-none">€</span>
      <input
        type="number"
        min={0}
        step={0.01}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          const v = e.target.value
          onChange(v === '' ? '' : Number(v))
        }}
        className="w-full bg-white border border-black/10 rounded-lg pl-7 pr-3 py-2 text-[14px] text-right tabular-nums text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
      />
    </div>
  )
}

function CoefficientTable({
  title,
  subtitle,
  unit,
  rows,
  onChange,
}: {
  title: string
  subtitle: string
  unit: string
  rows: CoefficientRow[]
  onChange: (next: CoefficientRow[]) => void
}) {
  function patch(id: string, p: Partial<CoefficientRow>) {
    onChange(rows.map((r) => (r.id === id ? { ...r, ...p } : r)))
  }
  function remove(id: string) {
    onChange(rows.filter((r) => r.id !== id))
  }
  function add() {
    onChange([...rows, { id: uid(), min: 0, max: 0, coeff: 1, label: '' }])
  }

  return (
    <section className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
      <header className="px-5 pt-5 pb-3">
        <h3 className="text-[15px] font-semibold text-[#1d1d1f] tracking-tight">
          {title}
        </h3>
        <p className="text-[13px] text-[#6e6e73] mt-0.5">{subtitle}</p>
      </header>

      <div className="px-5 pb-4">
        <div className="grid grid-cols-[80px_80px_80px_1fr_32px] gap-2 items-center px-1 mb-2">
          <span className="text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6]">Min {unit}</span>
          <span className="text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6]">Max {unit}</span>
          <span className="text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6]">Coeff.</span>
          <span className="text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6]">Etichetta</span>
          <span />
        </div>

        <div className="space-y-1.5">
          {rows.map((r) => (
            <div key={r.id} className="grid grid-cols-[80px_80px_80px_1fr_32px] gap-2 items-center group">
              <input
                type="number"
                value={r.min}
                onChange={(e) => {
                  const v = e.target.value
                  patch(r.id, { min: v === '' ? '' : Number(v) })
                }}
                className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px] text-right tabular-nums text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
              />
              <input
                type="number"
                value={r.max}
                onChange={(e) => {
                  const v = e.target.value
                  patch(r.id, { max: v === '' ? '' : Number(v) })
                }}
                className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px] text-right tabular-nums text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
              />
              <input
                type="number"
                step={0.01}
                value={r.coeff}
                onChange={(e) => {
                  const v = e.target.value
                  patch(r.id, { coeff: v === '' ? '' : Number(v) })
                }}
                className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px] text-right tabular-nums text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
              />
              <input
                type="text"
                value={r.label}
                onChange={(e) => patch(r.id, { label: e.target.value })}
                placeholder="Descrizione"
                className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px] text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
              />
              <button
                onClick={() => remove(r.id)}
                className="opacity-0 group-hover:opacity-100 focus:opacity-100 flex items-center justify-center w-8 h-8 rounded-full text-[#ff3b30] hover:bg-[#ff3b30]/10 transition-all"
                aria-label="Rimuovi"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a2 2 0 012-2h2a2 2 0 012 2v3" />
                </svg>
              </button>
            </div>
          ))}
          {rows.length === 0 && (
            <p className="text-center text-[13px] text-[#6e6e73] py-4">
              Nessuna riga
            </p>
          )}
        </div>

        <button
          onClick={add}
          className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-[#007aff] hover:text-[#0066d6] transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
          Aggiungi riga
        </button>
      </div>
    </section>
  )
}

// ========== PREVENTIVI (Punto 7) ==========

function PreventiviSection({
  preventivi,
  setPreventivi,
}: {
  preventivi: PreventiviConfig
  setPreventivi: (next: PreventiviConfig) => void
}) {
  function patchMsg(key: string, p: Partial<PreventivoMessage>) {
    setPreventivi({
      ...preventivi,
      messaggi: preventivi.messaggi.map((m) => (m.key === key ? { ...m, ...p } : m)),
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[22px] font-semibold tracking-tight text-[#1d1d1f]">
          Impostazioni Preventivi
        </h2>
        <p className="text-[14px] text-[#6e6e73] mt-1">
          Maggiorazione, scadenza e messaggi di sistema
        </p>
      </div>

      {/* Maggiorazione + Scadenza */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <section className="bg-white rounded-2xl border border-black/5 shadow-sm p-5">
          <h3 className="text-[15px] font-semibold text-[#1d1d1f] mb-1">
            Maggiorazione
          </h3>
          <p className="text-[12px] text-[#6e6e73] mb-3">
            Applicata sul totale del preventivo
          </p>
          <div className="relative w-28">
            <input
              type="number"
              min={0}
              max={100}
              value={preventivi.maggiorazione_pct}
              onChange={(e) => {
                const v = e.target.value
                setPreventivi({ ...preventivi, maggiorazione_pct: v === '' ? '' : Number(v) })
              }}
              className="w-full bg-white border border-black/10 rounded-lg pl-3 pr-8 py-2 text-[14px] text-right tabular-nums text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-[#a1a1a6] pointer-events-none">%</span>
          </div>
        </section>

        <section className="bg-white rounded-2xl border border-black/5 shadow-sm p-5">
          <h3 className="text-[15px] font-semibold text-[#1d1d1f] mb-1">
            Scadenza Default
          </h3>
          <p className="text-[12px] text-[#6e6e73] mb-3">
            Validita del preventivo dopo l'invio
          </p>
          <div className="relative w-28">
            <input
              type="number"
              min={0}
              value={preventivi.scadenza_default_ore}
              onChange={(e) => {
                const v = e.target.value
                setPreventivi({ ...preventivi, scadenza_default_ore: v === '' ? '' : Number(v) })
              }}
              className="w-full bg-white border border-black/10 rounded-lg pl-3 pr-12 py-2 text-[14px] text-right tabular-nums text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-[#a1a1a6] pointer-events-none">ore</span>
          </div>
        </section>
      </div>

      {/* Messaggi di Sistema Preventivo */}
      <section className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
        <header className="px-5 pt-5 pb-3">
          <h3 className="text-[17px] font-semibold text-[#1d1d1f] tracking-tight">
            Messaggi di Sistema — Preventivi
          </h3>
          <p className="text-[13px] text-[#6e6e73] mt-0.5">
            Template usati dal sistema per i preventivi
          </p>
        </header>

        <ul className="divide-y divide-black/5">
          {preventivi.messaggi.map((m) => (
            <li key={m.key} className="p-5">
              <div className="flex items-start gap-3 mb-3">
                <label className="inline-flex items-center cursor-pointer pt-0.5">
                  <input
                    type="checkbox"
                    checked={m.is_enabled}
                    onChange={(e) => patchMsg(m.key, { is_enabled: e.target.checked })}
                    className="w-4 h-4 accent-[#007aff]"
                  />
                </label>
                <div className="flex-1 min-w-0">
                  <h4 className="text-[14px] font-semibold text-[#1d1d1f]">
                    {m.label}
                  </h4>
                  <p className="text-[12px] text-[#6e6e73] mt-0.5">
                    {m.description}
                  </p>
                  <p className="text-[11px] text-[#a1a1a6] mt-0.5 font-mono">{m.key}</p>
                </div>
              </div>
              <textarea
                value={m.body}
                onChange={(e) => patchMsg(m.key, { body: e.target.value })}
                rows={5}
                className="w-full bg-[#f5f5f7] border border-black/5 rounded-lg px-3 py-2 text-[13px] text-[#1d1d1f] placeholder:text-[#a1a1a6] focus:outline-none focus:ring-2 focus:ring-[#007aff]/40 resize-y font-mono leading-relaxed"
              />
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
