/**
 * WbFieldControl.tsx — un campo del pannello proprieta'.
 *
 * Il pannello non sa cosa sia una "copertina" o una "griglia": riceve una
 * descrizione di campo da wbRegistry e disegna il comando giusto. E' cio'
 * che permette di aggiungere un blocco nuovo senza toccare l'editor.
 *
 * Le liste di elementi (schede, diapositive, domande…) usano lo stesso
 * meccanismo in modo ricorsivo: un elemento e' un piccolo oggetto con i
 * suoi campi, quindi si riusa questo file invece di scrivere un editor
 * per ogni tipo di lista.
 */

import React from 'react'
import type { WbFieldDef } from './wbRegistry'
import type { WbButton, WbImage, WbItem, WbLocale, WbText, WbVideo, WbThemeTokens } from './shared/wbSchema'
import { wbId } from './shared/wbSchema'
import {
  WbButton as Btn, WbIconButton, WbInput, WbTextarea, WbSelect, WbToggle,
  WbSlider, WbColor, WbField, WB_UI_ICONS, WbIcon, wbIsoAInput, wbInputAIso,
} from './WbUI'
import { WbMediaSlot, WbVideoOptions } from './WbMediaView'
import type { WbMediaRow } from './wbApi'

// ─── Percorsi ───────────────────────────────────────────────────────────────
export function wbGet(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, k) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[k] : undefined), obj)
}

/** Scrittura immutabile: nessun oggetto viene modificato sul posto. */
export function wbSet<T>(obj: T, path: string, value: unknown): T {
  const keys = path.split('.')
  const clone = Array.isArray(obj) ? ([...(obj as unknown[])] as unknown as T) : ({ ...(obj as object) } as T)
  let cur = clone as unknown as Record<string, unknown>
  for (let i = 0; i < keys.length - 1; i += 1) {
    const k = keys[i]
    const next = cur[k]
    cur[k] = next && typeof next === 'object'
      ? (Array.isArray(next) ? [...(next as unknown[])] : { ...(next as object) })
      : {}
    cur = cur[k] as Record<string, unknown>
  }
  const last = keys[keys.length - 1]
  if (value === undefined) delete cur[last]
  else cur[last] = value
  return clone
}

// ─── Contesto per i campi che aprono la libreria ────────────────────────────
export interface WbFieldContext {
  lang: WbLocale
  onLangChange: (l: WbLocale) => void
  openMedia: (kind: 'image' | 'video' | 'icon' | 'document', onPick: (m: WbMediaRow) => void) => void
  /** Slug delle pagine disponibili, per i collegamenti interni. */
  pages: { slug: string; title: string }[]
  tokens: WbThemeTokens | null
  can: (right: string) => boolean
}

// ─── Testo bilingue ─────────────────────────────────────────────────────────
const I18nInput: React.FC<{
  value: WbText | string | undefined
  onChange: (v: WbText) => void
  long?: boolean
  ctx: WbFieldContext
}> = ({ value, onChange, long, ctx }) => {
  const obj: WbText = typeof value === 'string' ? { it: value, en: value } : (value || {})
  const lang = ctx.lang
  const set = (v: string) => onChange({ ...obj, [lang]: v })
  return (
    <div>
      <div className="flex gap-1 mb-1">
        {(['it', 'en'] as WbLocale[]).map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => ctx.onLangChange(l)}
            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase border transition-colors ${
              lang === l ? 'bg-cyan-600/20 border-cyan-600/50 text-cyan-400' : 'border-theme-border text-theme-text-muted hover:text-theme-text-primary'
            }`}
          >
            {l}
          </button>
        ))}
        {!obj[lang === 'it' ? 'en' : 'it'] && (
          <span className="text-[10px] text-theme-text-muted self-center ml-1">
            l'altra lingua e' vuota: si usa questa
          </span>
        )}
      </div>
      {long
        ? <WbTextarea value={obj[lang] || ''} onChange={set} rows={5} />
        : <WbInput value={obj[lang] || ''} onChange={set} />}
    </div>
  )
}

// ─── Collegamento ───────────────────────────────────────────────────────────
const LinkInput: React.FC<{
  value: { href?: string; kind?: string; target?: string } | undefined
  onChange: (v: Record<string, unknown>) => void
  ctx: WbFieldContext
}> = ({ value, onChange, ctx }) => {
  const v = value || {}
  const kind = v.kind || 'page'
  return (
    <div className="space-y-1.5">
      <WbSelect
        value={kind}
        onChange={(k) => onChange({ ...v, kind: k, href: k === 'none' ? '' : v.href })}
        options={[
          { value: 'page', label: 'Una pagina del sito' },
          { value: 'url', label: 'Un indirizzo esterno' },
          { value: 'anchor', label: 'Una sezione di questa pagina' },
          { value: 'none', label: 'Nessun collegamento' },
        ]}
      />
      {kind === 'page' && (
        <>
          <WbSelect
            value={ctx.pages.some((p) => p.slug === v.href) ? String(v.href) : ''}
            onChange={(slug) => onChange({ ...v, href: slug })}
            options={[{ value: '', label: 'Scrivi un indirizzo…' }, ...ctx.pages.map((p) => ({ value: p.slug, label: `${p.title} — ${p.slug}` }))]}
          />
          <WbInput value={String(v.href || '')} onChange={(h) => onChange({ ...v, href: h })} placeholder="/flotta" />
          <p className="text-[10px] text-theme-text-muted">
            Vanno bene anche le pagine gia' esistenti del sito, per esempio /flotta o /contact.
          </p>
        </>
      )}
      {kind === 'url' && (
        <WbInput value={String(v.href || '')} onChange={(h) => onChange({ ...v, href: h })} placeholder="https://…" />
      )}
      {kind === 'anchor' && (
        <WbInput value={String(v.href || '')} onChange={(h) => onChange({ ...v, href: h.startsWith('#') ? h : `#${h}` })} placeholder="#servizi" />
      )}
      {kind !== 'none' && (
        <WbField label="Apri in una nuova scheda" inline>
          <WbToggle checked={v.target === '_blank'} onChange={(b) => onChange({ ...v, target: b ? '_blank' : '_self' })} />
        </WbField>
      )}
    </div>
  )
}

// ─── Pulsanti ───────────────────────────────────────────────────────────────
const ButtonsEditor: React.FC<{
  value: WbButton[] | undefined
  onChange: (v: WbButton[]) => void
  ctx: WbFieldContext
}> = ({ value, onChange, ctx }) => {
  const list = value || []
  const patch = (i: number, p: Partial<WbButton>) => onChange(list.map((b, j) => (j === i ? { ...b, ...p } : b)))
  return (
    <div className="space-y-2">
      {list.map((b, i) => (
        <div key={b.id} className="rounded-lg border border-theme-border bg-theme-bg-tertiary/60 p-2.5 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-theme-text-secondary">Pulsante {i + 1}</span>
            <div className="flex items-center gap-0.5">
              <WbIconButton path={WB_UI_ICONS.up} label="Sposta su" disabled={i === 0}
                onClick={() => { const n = [...list]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; onChange(n) }} />
              <WbIconButton path={WB_UI_ICONS.down} label="Sposta giu" disabled={i === list.length - 1}
                onClick={() => { const n = [...list]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; onChange(n) }} />
              <WbIconButton path={WB_UI_ICONS.copy} label="Duplica"
                onClick={() => onChange([...list.slice(0, i + 1), { ...b, id: wbId('btn') }, ...list.slice(i + 1)])} />
              <WbIconButton path={WB_UI_ICONS.trash} label="Elimina" tone="danger"
                onClick={() => onChange(list.filter((_, j) => j !== i))} />
            </div>
          </div>
          <WbField label="Testo">
            <I18nInput value={b.label} onChange={(v) => patch(i, { label: v })} ctx={ctx} />
          </WbField>
          <WbField label="Dove porta">
            <LinkInput value={b} onChange={(v) => patch(i, v as Partial<WbButton>)} ctx={ctx} />
          </WbField>
          <div className="grid grid-cols-2 gap-2">
            <WbField label="Stile">
              <WbSelect
                value={b.variant || 'primary'}
                onChange={(v) => patch(i, { variant: v as WbButton['variant'] })}
                options={[
                  { value: 'primary', label: 'Principale' },
                  { value: 'secondary', label: 'Secondario' },
                  { value: 'outline', label: 'Contorno' },
                  { value: 'ghost', label: 'Testo' },
                ]}
              />
            </WbField>
            <WbField label="Dimensione">
              <WbSelect
                value={b.size || 'md'}
                onChange={(v) => patch(i, { size: v as WbButton['size'] })}
                options={[{ value: 'sm', label: 'Piccolo' }, { value: 'md', label: 'Normale' }, { value: 'lg', label: 'Grande' }]}
              />
            </WbField>
          </div>
          <WbField label="Occupa tutta la larghezza" inline>
            <WbToggle checked={!!b.fullWidth} onChange={(v) => patch(i, { fullWidth: v })} />
          </WbField>
          <details className="pt-1">
            <summary className="text-[11px] text-theme-text-muted cursor-pointer select-none">Colori solo per questo pulsante</summary>
            <div className="pt-1.5 space-y-1">
              <WbField label="Sfondo">
                <WbColor value={b.override?.bg} onChange={(v) => patch(i, { override: { ...b.override, bg: v } as never })} />
              </WbField>
              <WbField label="Testo">
                <WbColor value={b.override?.text} onChange={(v) => patch(i, { override: { ...b.override, text: v } as never })} />
              </WbField>
              <WbField label="Angoli">
                <WbSlider value={b.override?.radius} min={0} max={40} step={1} unit="px"
                  onChange={(v) => patch(i, { override: { ...b.override, radius: v } as never })} />
              </WbField>
            </div>
          </details>
        </div>
      ))}
      <Btn size="sm" onClick={() => onChange([...list, { id: wbId('btn'), label: { it: 'Pulsante', en: 'Button' }, kind: 'page', href: '/', variant: 'primary', size: 'md' }])}>
        <WbIcon path={WB_UI_ICONS.plus} size={13} /> Aggiungi pulsante
      </Btn>
    </div>
  )
}

// ─── Elementi ripetuti ──────────────────────────────────────────────────────
const ItemsEditor: React.FC<{
  value: WbItem[] | undefined
  onChange: (v: WbItem[]) => void
  itemFields: WbFieldDef[]
  ctx: WbFieldContext
  label: string
}> = ({ value, onChange, itemFields, ctx, label }) => {
  const list = value || []
  const [aperto, setAperto] = React.useState<string | null>(list[0]?.id || null)
  const patch = (i: number, next: WbItem) => onChange(list.map((it, j) => (j === i ? next : it)))
  return (
    <div className="space-y-1.5">
      {list.map((it, i) => {
        const titolo = (typeof it.title === 'object' ? (it.title.it || it.title.en) : it.title)
          || (typeof it.text === 'object' ? (it.text.it || '').slice(0, 30) : '')
          || it.value || `Elemento ${i + 1}`
        const open = aperto === it.id
        return (
          <div key={it.id} className="rounded-lg border border-theme-border bg-theme-bg-tertiary/50 overflow-hidden">
            <div className="flex items-center gap-1 px-2 py-1.5">
              <button
                type="button"
                onClick={() => setAperto(open ? null : it.id)}
                className="flex-1 text-left text-[12px] text-theme-text-primary truncate"
              >
                <span className="text-theme-text-muted mr-1.5">{i + 1}.</span>{titolo}
              </button>
              <WbIconButton path={WB_UI_ICONS.up} label="Su" disabled={i === 0}
                onClick={() => { const n = [...list]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; onChange(n) }} />
              <WbIconButton path={WB_UI_ICONS.down} label="Giu" disabled={i === list.length - 1}
                onClick={() => { const n = [...list]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; onChange(n) }} />
              <WbIconButton path={WB_UI_ICONS.copy} label="Duplica"
                onClick={() => {
                  const copia = JSON.parse(JSON.stringify(it)) as WbItem
                  copia.id = wbId('i')
                  copia.buttons?.forEach((b) => { b.id = wbId('btn') })
                  onChange([...list.slice(0, i + 1), copia, ...list.slice(i + 1)])
                }} />
              <WbIconButton path={WB_UI_ICONS.trash} label="Elimina" tone="danger"
                onClick={() => onChange(list.filter((_, j) => j !== i))} />
            </div>
            {open && (
              <div className="px-2.5 pb-2.5 pt-1 border-t border-theme-border space-y-1">
                {itemFields.map((f) => (
                  <WbFieldControl
                    key={f.path}
                    field={f}
                    target={it}
                    onChange={(next) => patch(i, next as WbItem)}
                    ctx={ctx}
                  />
                ))}
              </div>
            )}
          </div>
        )
      })}
      <Btn size="sm" onClick={() => {
        const nuovo: WbItem = { id: wbId('i') }
        onChange([...list, nuovo])
        setAperto(nuovo.id)
      }}>
        <WbIcon path={WB_UI_ICONS.plus} size={13} /> Aggiungi {label.toLowerCase()}
      </Btn>
    </div>
  )
}

// ─── Campi di un modulo ─────────────────────────────────────────────────────
interface FormFieldRow {
  id: string
  name: string
  label: WbText
  placeholder?: WbText
  type: string
  required?: boolean
  width?: 'full' | 'half'
  options?: { value: string; label: WbText }[]
}

const FormFieldsEditor: React.FC<{
  value: FormFieldRow[] | undefined
  onChange: (v: FormFieldRow[]) => void
  ctx: WbFieldContext
}> = ({ value, onChange, ctx }) => {
  const list = value || []
  const patch = (i: number, p: Partial<FormFieldRow>) => onChange(list.map((f, j) => (j === i ? { ...f, ...p } : f)))
  return (
    <div className="space-y-2">
      {list.map((f, i) => (
        <div key={f.id} className="rounded-lg border border-theme-border bg-theme-bg-tertiary/50 p-2.5 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-theme-text-secondary">Campo {i + 1}</span>
            <div className="flex gap-0.5">
              <WbIconButton path={WB_UI_ICONS.up} label="Su" disabled={i === 0}
                onClick={() => { const n = [...list]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; onChange(n) }} />
              <WbIconButton path={WB_UI_ICONS.down} label="Giu" disabled={i === list.length - 1}
                onClick={() => { const n = [...list]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; onChange(n) }} />
              <WbIconButton path={WB_UI_ICONS.trash} label="Elimina" tone="danger"
                onClick={() => onChange(list.filter((_, j) => j !== i))} />
            </div>
          </div>
          <WbField label="Etichetta">
            <I18nInput value={f.label} onChange={(v) => patch(i, { label: v })} ctx={ctx} />
          </WbField>
          <WbField label="Testo di aiuto dentro il campo">
            <I18nInput value={f.placeholder} onChange={(v) => patch(i, { placeholder: v })} ctx={ctx} />
          </WbField>
          <div className="grid grid-cols-2 gap-2">
            <WbField label="Tipo">
              <WbSelect
                value={f.type}
                onChange={(v) => patch(i, { type: v })}
                options={[
                  { value: 'text', label: 'Testo' }, { value: 'email', label: 'Email' },
                  { value: 'tel', label: 'Telefono' }, { value: 'textarea', label: 'Testo lungo' },
                  { value: 'select', label: 'Elenco a tendina' }, { value: 'date', label: 'Data' },
                ]}
              />
            </WbField>
            <WbField label="Larghezza">
              <WbSelect
                value={f.width || 'full'}
                onChange={(v) => patch(i, { width: v as 'full' | 'half' })}
                options={[{ value: 'full', label: 'Tutta la riga' }, { value: 'half', label: 'Mezza riga' }]}
              />
            </WbField>
          </div>
          <WbField label="Obbligatorio" inline>
            <WbToggle checked={!!f.required} onChange={(v) => patch(i, { required: v })} />
          </WbField>
          <WbField label="Nome tecnico" help="Come arriva nell'email. Senza spazi.">
            <WbInput value={f.name} onChange={(v) => patch(i, { name: v.replace(/[^\w-]/g, '_') })} />
          </WbField>
        </div>
      ))}
      <Btn size="sm" onClick={() => onChange([...list, { id: wbId('f'), name: `campo_${list.length + 1}`, label: { it: 'Nuovo campo', en: 'New field' }, type: 'text', width: 'full' }])}>
        <WbIcon path={WB_UI_ICONS.plus} size={13} /> Aggiungi campo
      </Btn>
    </div>
  )
}

// ─── Il campo ───────────────────────────────────────────────────────────────
export const WbFieldControl: React.FC<{
  field: WbFieldDef
  target: unknown
  onChange: (next: unknown) => void
  ctx: WbFieldContext
}> = ({ field, target, onChange, ctx }) => {
  if (field.requires && !ctx.can(field.requires)) return null

  const value = wbGet(target, field.path)
  const set = (v: unknown) => onChange(wbSet(target as object, field.path, v))

  const tokens = ctx.tokens
    ? Object.entries(ctx.tokens.colors || {}).map(([k, c]) => ({ key: k, label: k, color: c }))
    : []

  switch (field.type) {
    case 'text':
      return (
        <WbField label={field.label} help={field.help}>
          <WbInput value={String(value ?? '')} onChange={(v) => set(v || undefined)} />
        </WbField>
      )
    case 'textarea':
      return (
        <WbField label={field.label} help={field.help}>
          <WbTextarea value={String(value ?? '')} onChange={(v) => set(v || undefined)} />
        </WbField>
      )
    case 'i18n':
      return (
        <WbField label={field.label} help={field.help}>
          <I18nInput value={value as WbText} onChange={set} ctx={ctx} />
        </WbField>
      )
    case 'i18n-long':
      return (
        <WbField label={field.label} help={field.help}>
          <I18nInput value={value as WbText} onChange={set} long ctx={ctx} />
        </WbField>
      )
    case 'number':
      return (
        <WbField label={field.label} help={field.help}>
          <div className="flex items-center gap-2">
            <WbInput
              value={value == null ? '' : String(value)}
              onChange={(v) => {
                if (v.trim() === '') { set(undefined); return }
                const n = Number(v.replace(',', '.'))
                if (!Number.isNaN(n)) set(n)
              }}
            />
            {field.unit && <span className="text-[10px] text-theme-text-muted">{field.unit}</span>}
          </div>
        </WbField>
      )
    case 'slider':
      return (
        <WbField label={field.label} help={field.help}>
          <WbSlider
            value={value as number | undefined}
            onChange={set}
            min={field.min ?? 0} max={field.max ?? 100} step={field.step ?? 1} unit={field.unit}
          />
        </WbField>
      )
    case 'color':
      return (
        <WbField label={field.label} help={field.help}>
          <WbColor value={value as string | undefined} onChange={set} tokens={tokens} />
        </WbField>
      )
    case 'select':
      return (
        <WbField label={field.label} help={field.help}>
          <WbSelect
            value={value == null ? '' : String(value)}
            onChange={(v) => set(v === '' ? undefined : (field.options?.some((o) => o.value === v) && /^\d+(\.\d+)?$/.test(v) ? Number(v) : v))}
            options={field.options || []}
          />
        </WbField>
      )
    case 'toggle':
      return (
        <WbField label={field.label} help={field.help} inline>
          <WbToggle checked={!!value} onChange={set} />
        </WbField>
      )
    case 'datetime':
      return (
        <WbField label={field.label} help={field.help}>
          <input
            type="datetime-local"
            className="w-full px-2.5 py-1.5 text-[13px] bg-theme-bg-tertiary border border-theme-border rounded-lg text-theme-text-primary"
            value={wbIsoAInput(value as string)}
            onChange={(e) => set(wbInputAIso(e.target.value) || undefined)}
          />
        </WbField>
      )
    case 'media': {
      const img = (value as WbImage) || {}
      return (
        <WbField label={field.label} help={field.help}>
          <div className="space-y-1.5">
            <WbMediaSlot
              url={typeof value === 'string' ? value : img.url}
              onOpen={() => ctx.openMedia('image', (m) => {
                if (typeof value === 'string' || field.path.startsWith('style.')) { set(m.url); return }
                set({ ...img, url: m.url, alt: m.alt, width: m.width ?? undefined, height: m.height ?? undefined, focalX: m.focal_x, focalY: m.focal_y })
              })}
              onClear={() => set(typeof value === 'string' || field.path.startsWith('style.') ? undefined : { ...img, url: '' })}
            />
            {typeof value !== 'string' && !field.path.startsWith('style.') && img.url && (
              <details>
                <summary className="text-[11px] text-theme-text-muted cursor-pointer select-none">Testo alternativo e versione per telefono</summary>
                <div className="pt-1.5 space-y-1">
                  <WbField label="Testo alternativo" help="Cosa si vede nella foto.">
                    <I18nInput value={img.alt} onChange={(v) => set({ ...img, alt: v })} ctx={ctx} />
                  </WbField>
                  <WbField label="Immagine diversa su telefono">
                    <WbMediaSlot
                      url={img.urlMobile}
                      onOpen={() => ctx.openMedia('image', (m) => set({ ...img, urlMobile: m.url }))}
                      onClear={() => set({ ...img, urlMobile: undefined })}
                    />
                  </WbField>
                </div>
              </details>
            )}
          </div>
        </WbField>
      )
    }
    case 'video': {
      const vid = (value as WbVideo) || {}
      const isString = typeof value === 'string' || field.path.startsWith('style.')
      return (
        <WbField label={field.label} help={field.help}>
          <div className="space-y-1">
            <WbMediaSlot
              kind="video"
              url={isString ? (value as string) : vid.url}
              poster={vid.poster}
              onOpen={() => ctx.openMedia('video', (m) => set(isString ? m.url : { ...vid, url: m.url }))}
              onClear={() => set(isString ? undefined : { ...vid, url: '' })}
            />
            {!isString && vid.url && (
              <details>
                <summary className="text-[11px] text-theme-text-muted cursor-pointer select-none">Come si riproduce</summary>
                <WbVideoOptions
                  value={vid}
                  onChange={(v) => set(v)}
                  onPickPoster={() => ctx.openMedia('image', (m) => set({ ...vid, poster: m.url }))}
                />
              </details>
            )}
          </div>
        </WbField>
      )
    }
    case 'link':
      return (
        <WbField label={field.label} help={field.help}>
          <LinkInput value={value as never} onChange={set} ctx={ctx} />
        </WbField>
      )
    case 'buttons':
      return (
        <WbField label={field.label} help={field.help}>
          <ButtonsEditor value={value as WbButton[]} onChange={set} ctx={ctx} />
        </WbField>
      )
    case 'items':
      return (
        <WbField label={field.label} help={field.help}>
          <ItemsEditor
            value={value as WbItem[]}
            onChange={set}
            itemFields={field.itemFields || []}
            ctx={ctx}
            label={field.label}
          />
        </WbField>
      )
    case 'form-fields':
      return (
        <WbField label={field.label} help={field.help}>
          <FormFieldsEditor value={value as FormFieldRow[]} onChange={set} ctx={ctx} />
        </WbField>
      )
    case 'gradient': {
      const g = (value as { from?: string; to?: string; angle?: number } | null) || null
      return (
        <WbField label={field.label} help={field.help}>
          {g ? (
            <div className="space-y-1.5">
              <WbColor value={g.from} onChange={(v) => set({ ...g, from: v })} tokens={tokens} />
              <WbColor value={g.to} onChange={(v) => set({ ...g, to: v })} tokens={tokens} />
              <WbSlider value={g.angle ?? 180} min={0} max={360} step={5} unit="°" onChange={(v) => set({ ...g, angle: v })} />
              <Btn size="sm" tone="ghost" onClick={() => set(null)}>Togli la sfumatura</Btn>
            </div>
          ) : (
            <Btn size="sm" onClick={() => set({ from: '#000000', to: '#333333', angle: 180 })}>Aggiungi una sfumatura</Btn>
          )}
        </WbField>
      )
    }
    case 'anchor':
      return (
        <WbField label={field.label} help={field.help}>
          <WbInput
            value={String(value ?? '')}
            onChange={(v) => set(v.replace(/[^\w-]/g, '') || undefined)}
            placeholder="servizi"
          />
        </WbField>
      )
    case 'css':
      return (
        <WbField label={field.label} help={field.help}>
          <WbTextarea mono rows={6} value={String(value ?? '')} onChange={(v) => set(v || undefined)} placeholder="& h2 { letter-spacing: 2px }" />
        </WbField>
      )
    case 'html':
      return (
        <WbField label={field.label} help={field.help}>
          <WbTextarea mono rows={8} value={String(value ?? '')} onChange={(v) => set(v || undefined)} />
        </WbField>
      )
    default:
      return null
  }
}

export default WbFieldControl
