import { useState } from 'react'

type SectionId = 'fascia-categorie' | 'p2' | 'p3' | 'p4' | 'p5' | 'p6' | 'p7'

const SECTIONS: { id: SectionId; label: string; num: number }[] = [
  { id: 'fascia-categorie', label: 'Categories & Fascia', num: 1 },
  { id: 'p2', label: 'Punto 2', num: 2 },
  { id: 'p3', label: 'Punto 3', num: 3 },
  { id: 'p4', label: 'Punto 4', num: 4 },
  { id: 'p5', label: 'Punto 5', num: 5 },
  { id: 'p6', label: 'Punto 6', num: 6 },
  { id: 'p7', label: 'Punto 7', num: 7 },
]

const CATEGORIES = [
  { key: 'supercars', label: 'Supercars' },
  { key: 'urban', label: 'Urban' },
  { key: 'aziendali', label: 'Aziendali' },
]

const FASCE = [
  { key: 'A', label: 'Fascia A' },
  { key: 'B', label: 'Fascia B' },
]

export default function CentralinaProTab() {
  const [section, setSection] = useState<SectionId>('fascia-categorie')

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-theme-text-primary">Centralina Pro</h2>
          <p className="text-sm text-theme-text-muted mt-1">
            Anteprima design — non ancora collegata ai dati
          </p>
        </div>
        <span className="px-3 py-1 rounded-full text-xs font-semibold bg-yellow-500/10 text-yellow-500 border border-yellow-500/30">
          Preview / Non collegata
        </span>
      </div>

      {/* Section selector */}
      <div className="flex flex-wrap gap-2 border-b border-theme-border pb-3">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => setSection(s.id)}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              section === s.id
                ? 'bg-dr7-gold text-black'
                : 'bg-theme-bg-secondary text-theme-text-muted hover:text-theme-text-primary'
            }`}
          >
            {s.num}. {s.label}
          </button>
        ))}
      </div>

      {section === 'fascia-categorie' && <FasciaCategorieSection />}
      {section !== 'fascia-categorie' && (
        <div className="rounded-xl border border-dashed border-theme-border p-12 text-center text-theme-text-muted">
          Da definire — in arrivo
        </div>
      )}
    </div>
  )
}

function FasciaCategorieSection() {
  return (
    <div className="space-y-6">
      {/* Section A: Categorie Veicoli */}
      <section className="rounded-xl border border-theme-border bg-theme-bg-secondary overflow-hidden">
        <header className="px-5 py-4 border-b border-theme-border flex items-center gap-3">
          <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-dr7-gold/10 text-dr7-gold font-bold text-sm">
            A
          </span>
          <div>
            <h3 className="text-base font-semibold text-theme-text-primary">Categories</h3>
            <p className="text-xs text-theme-text-muted">Categorie veicoli</p>
          </div>
        </header>
        <ul className="divide-y divide-theme-border">
          {CATEGORIES.map((c) => (
            <li key={c.key} className="flex items-center justify-between px-5 py-3">
              <div className="flex items-center gap-3">
                <span className="text-sm text-theme-text-primary font-medium">{c.label}</span>
                <span className="text-xs text-theme-text-muted font-mono">{c.key}</span>
              </div>
              <span className="text-xs text-theme-text-muted">—</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Section B: Fascia */}
      <section className="rounded-xl border border-theme-border bg-theme-bg-secondary overflow-hidden">
        <header className="px-5 py-4 border-b border-theme-border flex items-center gap-3">
          <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-dr7-gold/10 text-dr7-gold font-bold text-sm">
            B
          </span>
          <div>
            <h3 className="text-base font-semibold text-theme-text-primary">Fascia</h3>
            <p className="text-xs text-theme-text-muted">Tipi di fascia conducente</p>
          </div>
        </header>
        <ul className="divide-y divide-theme-border">
          {FASCE.map((f) => (
            <li key={f.key} className="flex items-center justify-between px-5 py-3">
              <div className="flex items-center gap-3">
                <span className="flex items-center justify-center w-7 h-7 rounded-full bg-theme-bg-primary border border-theme-border text-xs font-bold text-theme-text-primary">
                  {f.key}
                </span>
                <span className="text-sm text-theme-text-primary font-medium">{f.label}</span>
              </div>
              <span className="text-xs text-theme-text-muted">—</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
