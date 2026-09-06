/**
 * WbThemeView.tsx — Design System, caratteri, pulsanti e temi.
 *
 * Un tema e' un insieme di token. I blocchi salvano il TOKEN
 * (`var(--wb-color-primary)`), non il colore: e' per questo che cambiare
 * il colore principale qui aggiorna tutto il sito, e che un'eccezione
 * locale su un singolo elemento continua a valere.
 *
 * Cambiare tema NON tocca pagine, sezioni, testi, foto o dati: sposta
 * soltanto il sistema visivo.
 */

import React from 'react'
import toast from 'react-hot-toast'
import type { WbTheme, WbThemeTokens, WbTypeScaleKey } from './shared/wbSchema'
import {
  wbCreateTheme, wbUpdateTheme, wbDeleteTheme, wbSetActiveTheme,
  type WbSiteRow,
} from './wbApi'
import {
  WbCard, WbButton, WbIconButton, WbIcon, WbModal, WbConfirm, WbField,
  WbInput, WbSelect, WbSlider, WbColor, WbBadge, WB_UI_ICONS,
} from './WbUI'
import { WbPreview } from './WbPreview'
import { wbCreateBlock } from './wbRegistry'

const COLORI: { key: string; label: string; help?: string }[] = [
  { key: 'primary', label: 'Colore principale', help: 'Pulsanti, accenti, numeri in evidenza.' },
  { key: 'secondary', label: 'Colore secondario' },
  { key: 'accent', label: 'Colore di richiamo' },
  { key: 'bg', label: 'Sfondo della pagina' },
  { key: 'surface', label: 'Sfondo dei riquadri' },
  { key: 'surfaceAlt', label: 'Sfondo alternativo' },
  { key: 'text', label: 'Testo principale' },
  { key: 'textMuted', label: 'Testo secondario' },
  { key: 'border', label: 'Bordi' },
  { key: 'success', label: 'Conferma' },
  { key: 'warning', label: 'Avviso' },
  { key: 'error', label: 'Errore' },
  { key: 'info', label: 'Informazione' },
]

const SCALE: { key: WbTypeScaleKey; label: string }[] = [
  { key: 'h1', label: 'Titolo H1' },
  { key: 'h2', label: 'Titolo H2' },
  { key: 'h3', label: 'Titolo H3' },
  { key: 'h4', label: 'Titolo H4' },
  { key: 'h5', label: 'Titolo H5' },
  { key: 'h6', label: 'Titolo H6' },
  { key: 'body', label: 'Corpo del testo' },
  { key: 'small', label: 'Testo piccolo' },
  { key: 'label', label: 'Etichetta' },
  { key: 'button', label: 'Pulsante' },
  { key: 'menu', label: 'Voce di menu' },
  { key: 'caption', label: 'Didascalia' },
]

/**
 * Caratteri disponibili. I primi tre sono gia' caricati dal sito: sceglierli
 * non aggiunge nemmeno una richiesta. Gli altri vengono caricati solo se
 * usati, con `display=swap` (il testo si legge subito, senza pagina bianca).
 */
export const WB_FONTS = [
  { value: "'Exo 2', sans-serif", label: 'Exo 2 (gia\' sul sito)', google: null },
  { value: "'Playfair Display', serif", label: 'Playfair Display (gia\' sul sito)', google: null },
  { value: "'Rajdhani', sans-serif", label: 'Rajdhani (gia\' sul sito)', google: null },
  { value: "'Inter', sans-serif", label: 'Inter', google: 'Inter:wght@300;400;500;600;700;800' },
  { value: "'Montserrat', sans-serif", label: 'Montserrat', google: 'Montserrat:wght@300;400;500;600;700;800' },
  { value: "'Poppins', sans-serif", label: 'Poppins', google: 'Poppins:wght@300;400;500;600;700' },
  { value: "'Cormorant Garamond', serif", label: 'Cormorant Garamond', google: 'Cormorant+Garamond:wght@300;400;500;600;700' },
  { value: "'DM Serif Display', serif", label: 'DM Serif Display', google: 'DM+Serif+Display' },
  { value: "'Space Grotesk', sans-serif", label: 'Space Grotesk', google: 'Space+Grotesk:wght@300;400;500;600;700' },
  { value: 'system-ui, sans-serif', label: 'Carattere di sistema (il piu\' veloce)', google: null },
]

/** I Google Fonts da caricare per un tema: solo quelli davvero usati. */
export function wbGoogleFontsFor(tokens: WbThemeTokens | null | undefined): string[] {
  if (!tokens) return []
  const usati = new Set([tokens.typography?.fontPrimary, tokens.typography?.fontSecondary, tokens.typography?.fontAccent])
  const fam: string[] = []
  for (const f of WB_FONTS) {
    if (f.google && usati.has(f.value)) fam.push(f.google)
  }
  return fam
}

export const WbThemeView: React.FC<{
  site: WbSiteRow
  themes: WbTheme[]
  activeThemeId: string | null
  onReload: () => void
  can: (r: string) => boolean
}> = ({ site, themes, activeThemeId, onReload, can }) => {
  const canTheme = can('website.theme')
  const [selId, setSelId] = React.useState<string | null>(activeThemeId || themes[0]?.id || null)
  const [bozza, setBozza] = React.useState<WbThemeTokens | null>(null)
  const [nome, setNome] = React.useState('')
  const [dirty, setDirty] = React.useState(false)
  const [sezione, setSezione] = React.useState<'colori' | 'testi' | 'pulsanti' | 'forme' | 'avanzate'>('colori')
  const [nuovo, setNuovo] = React.useState(false)
  const [nomeNuovo, setNomeNuovo] = React.useState('')
  const [daEliminare, setDaEliminare] = React.useState<WbTheme | null>(null)

  const tema = themes.find((t) => t.id === selId) || null

  React.useEffect(() => {
    if (!tema) { setBozza(null); return }
    setBozza(JSON.parse(JSON.stringify(tema.tokens)))
    setNome(tema.name)
    setDirty(false)
  }, [tema?.id])  // eslint-disable-line react-hooks/exhaustive-deps

  const set = (path: string[], value: unknown) => {
    if (!bozza) return
    const next = JSON.parse(JSON.stringify(bozza)) as Record<string, unknown>
    let cur = next
    for (let i = 0; i < path.length - 1; i += 1) {
      if (typeof cur[path[i]] !== 'object' || cur[path[i]] === null) cur[path[i]] = {}
      cur = cur[path[i]] as Record<string, unknown>
    }
    cur[path[path.length - 1]] = value
    setBozza(next as unknown as WbThemeTokens)
    setDirty(true)
  }

  const salva = async () => {
    if (!tema || !bozza) return
    const ok = await wbUpdateTheme(tema.id, { name: nome, tokens: bozza })
    if (ok) { toast.success('Tema salvato. Va online alla prossima pubblicazione.'); setDirty(false); onReload() }
    else toast.error('Salvataggio non riuscito')
  }

  // Anteprima: sezioni finte ma vere, disegnate dallo stesso renderer del sito.
  const blocchiAnteprima = React.useMemo(() => {
    const hero = wbCreateBlock('hero')
    const cards = wbCreateBlock('cards')
    const cta = wbCreateBlock('cta')
    return [hero, cards, cta].filter(Boolean) as NonNullable<ReturnType<typeof wbCreateBlock>>[]
  }, [])

  const temaAnteprima: WbTheme | null = bozza && tema ? { id: tema.id, name: nome, tokens: bozza } : null

  return (
    <div className="space-y-4">
      <WbCard
        title="Temi"
        subtitle="Un tema cambia solo l'aspetto: pagine, testi, foto e dati restano dove sono."
        actions={
          <>
            <WbButton size="sm" disabled={!canTheme || !tema} onClick={() => { setNomeNuovo(`${nome} (copia)`); setNuovo(true) }}>
              <WbIcon path={WB_UI_ICONS.copy} size={14} /> Duplica
            </WbButton>
            <WbButton size="sm" tone="primary" disabled={!canTheme} onClick={() => { setNomeNuovo('Nuovo tema'); setNuovo(true) }}>
              <WbIcon path={WB_UI_ICONS.plus} size={14} /> Nuovo tema
            </WbButton>
          </>
        }
      >
        <div className="flex flex-wrap gap-2">
          {themes.map((t) => {
            const attivo = t.id === activeThemeId
            return (
              <div
                key={t.id}
                className={`rounded-xl border p-3 min-w-[190px] cursor-pointer transition-colors ${
                  selId === t.id ? 'border-cyan-500/60 bg-cyan-500/5' : 'border-theme-border hover:bg-theme-bg-hover'
                }`}
                onClick={() => setSelId(t.id)}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-medium text-theme-text-primary">{t.name}</span>
                  {attivo && <WbBadge tone="success">attivo</WbBadge>}
                </div>
                <div className="flex gap-1 mt-2">
                  {['primary', 'bg', 'surface', 'text', 'accent'].map((k) => (
                    <span key={k} className="w-6 h-6 rounded border border-theme-border" style={{ background: t.tokens?.colors?.[k] }} />
                  ))}
                </div>
                <div className="flex gap-1 mt-2">
                  {!attivo && (
                    <WbButton size="sm" disabled={!canTheme} onClick={async (): Promise<void> => {
                      if (await wbSetActiveTheme(site.id, t.id, t.name)) { toast.success(`Tema "${t.name}" attivato`); onReload() }
                      else toast.error('Attivazione non riuscita')
                    }}>Attiva</WbButton>
                  )}
                  {!attivo && (
                    <WbIconButton path={WB_UI_ICONS.trash} label="Elimina" tone="danger" disabled={!canTheme} onClick={() => setDaEliminare(t)} />
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </WbCard>

      {bozza && tema && (
        <div className="grid lg:grid-cols-[minmax(0,420px)_1fr] gap-4">
          <WbCard
            title={`Design System — ${nome}`}
            subtitle="I valori qui valgono per tutto il sito."
            actions={
              <WbButton size="sm" tone="primary" disabled={!canTheme || !dirty} onClick={() => void salva()}>
                <WbIcon path={WB_UI_ICONS.save} size={14} /> Salva
              </WbButton>
            }
          >
            <div className="flex border-b border-theme-border mb-3 -mt-1 overflow-x-auto">
              {([
                ['colori', 'Colori'], ['testi', 'Caratteri'], ['pulsanti', 'Pulsanti'],
                ['forme', 'Forme e spazi'], ['avanzate', 'Avanzate'],
              ] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSezione(id)}
                  className={`px-3 py-2 text-[12px] whitespace-nowrap border-b-2 transition-colors ${
                    sezione === id ? 'border-cyan-500 text-cyan-400' : 'border-transparent text-theme-text-muted hover:text-theme-text-primary'
                  }`}
                >{label}</button>
              ))}
            </div>

            <div className="max-h-[62vh] overflow-y-auto pr-1 space-y-0.5">
              <WbField label="Nome del tema">
                <WbInput value={nome} onChange={(v) => { setNome(v); setDirty(true) }} />
              </WbField>

              {sezione === 'colori' && COLORI.map((c) => (
                <WbField key={c.key} label={c.label} help={c.help}>
                  <WbColor
                    value={bozza.colors?.[c.key]}
                    onChange={(v) => set(['colors', c.key], v || '#000000')}
                  />
                </WbField>
              ))}

              {sezione === 'testi' && (
                <>
                  <WbField label="Carattere principale" help="Testi, menu, pulsanti.">
                    <WbSelect
                      value={bozza.typography?.fontPrimary || ''}
                      onChange={(v) => set(['typography', 'fontPrimary'], v)}
                      options={WB_FONTS.map((f) => ({ value: f.value, label: f.label }))}
                    />
                  </WbField>
                  <WbField label="Carattere dei titoli">
                    <WbSelect
                      value={bozza.typography?.fontSecondary || ''}
                      onChange={(v) => set(['typography', 'fontSecondary'], v)}
                      options={WB_FONTS.map((f) => ({ value: f.value, label: f.label }))}
                    />
                  </WbField>
                  <WbField label="Carattere di richiamo" help="Etichette e occhielli.">
                    <WbSelect
                      value={bozza.typography?.fontAccent || ''}
                      onChange={(v) => set(['typography', 'fontAccent'], v)}
                      options={WB_FONTS.map((f) => ({ value: f.value, label: f.label }))}
                    />
                  </WbField>
                  <div className="pt-2 space-y-2">
                    {SCALE.map((s) => {
                      const sc = bozza.typography?.scales?.[s.key]
                      if (!sc) return null
                      return (
                        <details key={s.key} className="rounded-lg border border-theme-border bg-theme-bg-tertiary/40 px-2.5 py-2">
                          <summary className="text-[12px] text-theme-text-primary cursor-pointer select-none flex items-center justify-between">
                            <span>{s.label}</span>
                            <span className="text-[10px] text-theme-text-muted">{sc.size}px · {sc.weight}</span>
                          </summary>
                          <div className="pt-2 space-y-0.5">
                            <WbField label="Carattere">
                              <WbSelect
                                value={sc.family}
                                onChange={(v) => set(['typography', 'scales', s.key, 'family'], v)}
                                options={[
                                  { value: 'fontPrimary', label: 'Principale' },
                                  { value: 'fontSecondary', label: 'Titoli' },
                                  { value: 'fontAccent', label: 'Richiamo' },
                                ]}
                              />
                            </WbField>
                            <WbField label="Dimensione (schermo grande)">
                              <WbSlider value={sc.size} min={10} max={120} step={1} unit="px" onChange={(v) => set(['typography', 'scales', s.key, 'size'], v ?? 16)} />
                            </WbField>
                            <WbField label="Dimensione su tablet">
                              <WbSlider value={sc.sizeTablet ?? sc.size} min={10} max={110} step={1} unit="px" onChange={(v) => set(['typography', 'scales', s.key, 'sizeTablet'], v)} />
                            </WbField>
                            <WbField label="Dimensione su telefono">
                              <WbSlider value={sc.sizeMobile ?? sc.size} min={10} max={90} step={1} unit="px" onChange={(v) => set(['typography', 'scales', s.key, 'sizeMobile'], v)} />
                            </WbField>
                            <WbField label="Spessore">
                              <WbSelect
                                value={String(sc.weight)}
                                onChange={(v) => set(['typography', 'scales', s.key, 'weight'], Number(v))}
                                options={[300, 400, 500, 600, 700, 800, 900].map((w) => ({ value: String(w), label: String(w) }))}
                              />
                            </WbField>
                            <WbField label="Interlinea">
                              <WbSlider value={sc.lineHeight} min={0.9} max={2.2} step={0.05} onChange={(v) => set(['typography', 'scales', s.key, 'lineHeight'], v ?? 1.4)} />
                            </WbField>
                            <WbField label="Spaziatura lettere">
                              <WbSlider value={sc.letterSpacing} min={-2} max={8} step={0.1} unit="px" onChange={(v) => set(['typography', 'scales', s.key, 'letterSpacing'], v ?? 0)} />
                            </WbField>
                            <WbField label="Maiuscole/minuscole">
                              <WbSelect
                                value={sc.transform}
                                onChange={(v) => set(['typography', 'scales', s.key, 'transform'], v)}
                                options={[
                                  { value: 'none', label: 'Come scritto' },
                                  { value: 'uppercase', label: 'TUTTO MAIUSCOLO' },
                                  { value: 'lowercase', label: 'tutto minuscolo' },
                                  { value: 'capitalize', label: 'Iniziali Maiuscole' },
                                ]}
                              />
                            </WbField>
                          </div>
                        </details>
                      )
                    })}
                  </div>
                </>
              )}

              {sezione === 'pulsanti' && (['primary', 'secondary', 'outline', 'ghost'] as const).map((v) => {
                const b = bozza.buttons?.[v]
                if (!b) return null
                const etichetta = { primary: 'Principale', secondary: 'Secondario', outline: 'Contorno', ghost: 'Testo' }[v]
                return (
                  <details key={v} className="rounded-lg border border-theme-border bg-theme-bg-tertiary/40 px-2.5 py-2 mb-2">
                    <summary className="text-[12px] text-theme-text-primary cursor-pointer select-none flex items-center justify-between">
                      <span>{etichetta}</span>
                      <span className="inline-flex items-center px-2.5 py-1 rounded text-[10px] border"
                        style={{ background: b.bg, color: b.text, borderColor: b.border === 'transparent' ? 'transparent' : b.border, borderRadius: b.radius }}>
                        Esempio
                      </span>
                    </summary>
                    <div className="pt-2 space-y-0.5">
                      <WbField label="Sfondo"><WbColor value={b.bg} onChange={(x) => set(['buttons', v, 'bg'], x || 'transparent')} /></WbField>
                      <WbField label="Testo"><WbColor value={b.text} onChange={(x) => set(['buttons', v, 'text'], x || '#000')} /></WbField>
                      <WbField label="Bordo"><WbColor value={b.border} onChange={(x) => set(['buttons', v, 'border'], x || 'transparent')} /></WbField>
                      <WbField label="Sfondo al passaggio del mouse"><WbColor value={b.hoverBg} onChange={(x) => set(['buttons', v, 'hoverBg'], x || 'transparent')} /></WbField>
                      <WbField label="Testo al passaggio del mouse"><WbColor value={b.hoverText} onChange={(x) => set(['buttons', v, 'hoverText'], x || '#000')} /></WbField>
                      <WbField label="Angoli arrotondati"><WbSlider value={b.radius} min={0} max={40} step={1} unit="px" onChange={(x) => set(['buttons', v, 'radius'], x ?? 8)} /></WbField>
                      <WbField label="Spazio orizzontale"><WbSlider value={b.padX} min={8} max={60} step={1} unit="px" onChange={(x) => set(['buttons', v, 'padX'], x ?? 24)} /></WbField>
                      <WbField label="Spazio verticale"><WbSlider value={b.padY} min={4} max={32} step={1} unit="px" onChange={(x) => set(['buttons', v, 'padY'], x ?? 12)} /></WbField>
                    </div>
                  </details>
                )
              })}

              {sezione === 'forme' && (
                <>
                  {Object.entries(bozza.radius || {}).map(([k, v]) => (
                    <WbField key={k} label={`Angoli — ${k}`}>
                      <WbSlider value={v as number} min={0} max={48} step={1} unit="px" onChange={(x) => set(['radius', k], x ?? 0)} />
                    </WbField>
                  ))}
                  <WbField label="Spazio verticale delle sezioni">
                    <WbSlider value={bozza.spacing?.sectionY} min={0} max={240} step={4} unit="px" onChange={(x) => set(['spacing', 'sectionY'], x ?? 96)} />
                  </WbField>
                  <WbField label="Spazio verticale su telefono">
                    <WbSlider value={bozza.spacing?.sectionYMobile} min={0} max={200} step={4} unit="px" onChange={(x) => set(['spacing', 'sectionYMobile'], x ?? 56)} />
                  </WbField>
                  <WbField label="Larghezza massima del contenuto">
                    <WbSlider value={bozza.spacing?.containerMax} min={720} max={1920} step={20} unit="px" onChange={(x) => set(['spacing', 'containerMax'], x ?? 1280)} />
                  </WbField>
                  <div className="pt-2">
                    <p className="text-[11px] font-semibold text-theme-text-secondary mb-1">Riquadri (card)</p>
                    <WbField label="Sfondo"><WbColor value={bozza.card?.bg} onChange={(x) => set(['card', 'bg'], x || 'transparent')} /></WbField>
                    <WbField label="Bordo"><WbColor value={bozza.card?.border} onChange={(x) => set(['card', 'border'], x || 'transparent')} /></WbField>
                    <WbField label="Angoli"><WbSlider value={bozza.card?.radius} min={0} max={40} step={1} unit="px" onChange={(x) => set(['card', 'radius'], x ?? 10)} /></WbField>
                    <WbField label="Spazio interno"><WbSlider value={bozza.card?.pad} min={8} max={64} step={2} unit="px" onChange={(x) => set(['card', 'pad'], x ?? 24)} /></WbField>
                  </div>
                </>
              )}

              {sezione === 'avanzate' && (
                <>
                  {Object.entries(bozza.effects || {}).map(([k, v]) => (
                    <WbField key={k} label={`Ombra — ${k}`}>
                      <WbInput value={String(v)} onChange={(x) => set(['effects', k], x)} />
                    </WbField>
                  ))}
                  {can('website.code') && (
                    <WbField label="CSS globale del sito" help="Vale su tutte le pagine. Si puo' svuotare in qualsiasi momento per tornare indietro.">
                      <textarea
                        rows={8}
                        className="w-full px-2.5 py-1.5 text-[12px] font-mono bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary"
                        value={bozza.customCss || ''}
                        onChange={(e) => set(['customCss'], e.target.value)}
                      />
                    </WbField>
                  )}
                </>
              )}
            </div>
          </WbCard>

          <WbCard title="Anteprima del tema" subtitle="Sezioni di esempio disegnate dallo stesso codice del sito.">
            <div className="h-[62vh] -m-4">
              <WbPreview blocks={blocchiAnteprima} theme={temaAnteprima} device="desktop" lang="it" />
            </div>
          </WbCard>
        </div>
      )}

      <WbModal
        open={nuovo}
        onClose={() => setNuovo(false)}
        title="Nuovo tema"
        size="sm"
        footer={
          <>
            <WbButton onClick={() => setNuovo(false)}>Annulla</WbButton>
            <WbButton tone="primary" onClick={async () => {
              const base = tema?.tokens || themes[0]?.tokens
              if (!base) { toast.error('Nessun tema da cui partire'); return }
              const t = await wbCreateTheme(site.id, nomeNuovo || 'Nuovo tema', JSON.parse(JSON.stringify(base)))
              if (t) { toast.success('Tema creato'); setNuovo(false); setSelId(t.id); onReload() }
              else toast.error('Creazione non riuscita')
            }}>Crea</WbButton>
          </>
        }
      >
        <WbField label="Nome" help="Parte dai valori del tema selezionato: nessun contenuto viene toccato.">
          <WbInput value={nomeNuovo} onChange={setNomeNuovo} />
        </WbField>
      </WbModal>

      <WbConfirm
        open={!!daEliminare}
        title="Eliminare questo tema?"
        message={`"${daEliminare?.name}" viene cancellato. Le pagine e i contenuti restano intatti.`}
        confirmLabel="Elimina"
        onCancel={() => setDaEliminare(null)}
        onConfirm={async () => {
          if (!daEliminare) return
          const ok = await wbDeleteTheme(site.id, daEliminare.id, daEliminare.name)
          if (ok) { toast.success('Tema eliminato'); setDaEliminare(null); onReload() }
          else toast.error('Eliminazione non riuscita')
        }}
      />
    </div>
  )
}

export default WbThemeView
