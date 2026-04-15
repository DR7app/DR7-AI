import { useState } from 'react'

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
  { id: 'p3', title: 'Punto 3' },
  { id: 'p4', title: 'Punto 4' },
  { id: 'p5', title: 'Punto 5' },
  { id: 'p6', title: 'Punto 6' },
  { id: 'p7', title: 'Punto 7' },
]

const INITIAL_CATEGORIES: Category[] = [
  { id: 'supercars', label: 'Supercars' },
  { id: 'urban', label: 'Urban' },
  { id: 'aziendali', label: 'Aziendali' },
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

  return (
    <div className="min-h-screen bg-[#f5f5f7] dark:bg-[#0b0b0d]">
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
            {section === 'categorie-fascia' && <CategorieFasciaSection />}
            {section === 'p2' && <AssicurazioniSection />}
            {section !== 'categorie-fascia' && section !== 'p2' && (
              <div className="bg-white dark:bg-[#1c1c1e] rounded-2xl border border-black/5 dark:border-white/10 shadow-sm p-12 text-center">
                <p className="text-[15px] text-[#6e6e73] dark:text-white/60">
                  Sezione in arrivo — da definire
                </p>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  )
}

function CategorieFasciaSection() {
  const [categories, setCategories] = useState<Category[]>(INITIAL_CATEGORIES)
  const [fasce, setFasce] = useState<Fascia[]>(INITIAL_FASCE)

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

function AssicurazioniSection() {
  const [config, setConfig] = useState<InsuranceCategoryConfig[]>(INITIAL_INSURANCE)

  function updateCategory(id: string, patch: Partial<InsuranceCategoryConfig>) {
    setConfig((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))
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
        <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-black/5 dark:divide-white/[0.08] border-t border-black/5 dark:border-white/[0.08]">
          <InsuranceList
            heading="Fascia B (giovane)"
            items={category.fasciaB}
            onChange={(next) => onChange({ fasciaB: next })}
          />
          <InsuranceList
            heading="Fascia A (esperto)"
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
      <p className="text-[13px] font-medium text-[#6e6e73] dark:text-white/60 mb-3">{heading}</p>

      <div className="space-y-2">
        {items.map((opt) => (
          <div
            key={opt.id}
            className="grid grid-cols-[1fr_auto] gap-2 items-center group"
          >
            <input
              value={opt.name}
              onChange={(e) => patch(opt.id, { name: e.target.value })}
              className="bg-[#f5f5f7] dark:bg-white/5 rounded-lg px-3 py-2 text-[14px] text-[#1d1d1f] dark:text-white outline-none focus:ring-2 focus:ring-[#007aff]/40"
            />
            <div className="flex items-center gap-2 flex-wrap">
              <InlineNum label="€/g" value={opt.daily_price} onChange={(v) => patch(opt.id, { daily_price: v })} />
              <InlineNum label="dep" value={opt.mandatory_deposit} onChange={(v) => patch(opt.id, { mandatory_deposit: v })} />
              <InlineNum label="fran" value={opt.deductible_fixed} onChange={(v) => patch(opt.id, { deductible_fixed: v })} />
              <InlineNum label="%" value={opt.deductible_percent} onChange={(v) => patch(opt.id, { deductible_percent: v })} />
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
        className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-[#007aff] hover:text-[#0066d6] transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
        </svg>
        Aggiungi opzione
      </button>
    </div>
  )
}

function InlineNum({
  label,
  value,
  onChange,
}: {
  label: string
  value: number | ''
  onChange: (v: number | '') => void
}) {
  return (
    <label className="inline-flex items-center gap-1">
      <span className="text-[11px] uppercase tracking-wide text-[#a1a1a6] font-medium">{label}</span>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => {
          const v = e.target.value
          onChange(v === '' ? '' : Number(v))
        }}
        className="w-16 bg-white dark:bg-[#2c2c2e] border border-black/10 dark:border-white/10 rounded-md px-2 py-1 text-[13px] text-right text-[#1d1d1f] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#007aff]/40"
      />
    </label>
  )
}
