import type { ReactNode } from 'react'
import toast from 'react-hot-toast'
import { useRef, useState } from 'react'
import { supabase } from '../../../../supabaseClient'
import MoneyInput from '../../../../components/MoneyInput'
import { parseMoney } from '../../../../utils/money'
import { CaricaMedia } from './CaricaMedia'
import type {
    InvestitoriCopy,
    InvestitoriInfoItem,
    IrNumero,
    IrBarra,
    IrAzionista,
    IrLogo,
    IrDocumento,
    IrFile,
    IrTappa,
    IrPilastro,
} from './siteCopyDefaults'

/**
 * Editor della pagina Investor Relations (/investitori), 22/09/2026.
 *
 * Un riquadro per ogni blocco della pagina, nello stesso ordine. I blocchi con
 * un elenco (numeri, grafico, azionisti, investitori privati, loghi) sul sito
 * spariscono quando l'elenco e' vuoto.
 */

const ICONE: Array<[string, string]> = [
    ['ricavi', 'Ricavi (moneta)'],
    ['utile', 'Utile (grafico)'],
    ['clienti', 'Clienti (persone)'],
    ['auto', 'Auto'],
    ['patrimonio', 'Patrimonio (edificio)'],
    ['sedi', 'Sedi (luogo)'],
    ['capitale', 'Capitale (carta)'],
    ['quota', 'Quota (torta)'],
    ['round', 'Round (stella)'],
    ['documento', 'Documento'],
    ['presentazione', 'Presentazione'],
    ['governance', 'Governance'],
    ['comunicati', 'Comunicati'],
    ['aereo', 'Aereo'],
    ['chip', 'Tecnologia (chip)'],
    ['moneta', 'Moneta digitale'],
    ['globo', 'Mondo'],
]

const inputCls = 'w-full bg-theme-bg-primary border border-theme-border rounded-md px-2 py-1.5 text-[13px] text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-blue-500/40'
const nuovoId = (p: string) => `${p}-${Date.now().toString(36)}`

function Campo({ label, value, onChange, area }: { label: string; value: string; onChange: (v: string) => void; area?: boolean }) {
    return (
        <label className="block">
            <span className="text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6]">{label}</span>
            {area
                ? <textarea value={value} onChange={e => onChange(e.target.value)} rows={3} className={`mt-1 resize-y ${inputCls}`} />
                : <input type="text" value={value} onChange={e => onChange(e.target.value)} className={`mt-1 ${inputCls}`} />}
        </label>
    )
}

function Riquadro({ titolo, nota, children }: { titolo: string; nota?: string; children: ReactNode }) {
    return (
        <section className="border border-theme-border rounded-2xl p-5 bg-theme-bg-primary shadow-sm space-y-4">
            <div>
                <h3 className="text-[14px] font-semibold text-theme-text-primary">{titolo}</h3>
                {nota && <p className="text-[12px] text-theme-text-secondary mt-1">{nota}</p>}
            </div>
            {children}
        </section>
    )
}

/** Elenco con sposta su/giu', elimina e aggiungi. */
function Elenco<T extends { id?: string }>({ voci, onChange, nuova, etichetta, aggiungi, children }: {
    voci: T[]
    onChange: (next: T[]) => void
    nuova: () => T
    etichetta: (v: T) => string
    aggiungi: string
    children: (v: T, set: (patch: Partial<T>) => void) => ReactNode
}) {
    const set = (i: number, patch: Partial<T>) => onChange(voci.map((v, j) => (j === i ? { ...v, ...patch } : v)))
    const sposta = (i: number, d: -1 | 1) => {
        const j = i + d
        if (j < 0 || j >= voci.length) return
        const next = [...voci]
        ;[next[i], next[j]] = [next[j], next[i]]
        onChange(next)
    }
    const btn = 'w-6 h-6 rounded-md text-theme-text-secondary hover:bg-theme-bg-secondary disabled:opacity-30 flex items-center justify-center'
    return (
        <div className="space-y-3">
            {voci.map((v, i) => (
                <div key={v.id || i} className="border border-theme-border rounded-xl p-3 bg-theme-bg-secondary/40 space-y-2">
                    <div className="flex items-center gap-2">
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-theme-text-secondary flex-1 truncate">{etichetta(v) || '(vuoto)'}</span>
                        <button type="button" onClick={() => sposta(i, -1)} disabled={i === 0} className={btn} title="Sposta su">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15" /></svg>
                        </button>
                        <button type="button" onClick={() => sposta(i, 1)} disabled={i === voci.length - 1} className={btn} title="Sposta giu'">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
                        </button>
                        <button type="button" onClick={() => { if (confirm('Eliminare questa voce?')) onChange(voci.filter((_, j) => j !== i)) }} className="w-6 h-6 rounded-md text-[#ff3b30] hover:bg-[#ff3b30]/10 flex items-center justify-center" title="Elimina">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                        </button>
                    </div>
                    {children(v, p => set(i, p))}
                </div>
            ))}
            <button type="button" onClick={() => onChange([...voci, nuova()])} className="w-full py-2.5 rounded-xl border-2 border-dashed border-theme-border text-[12px] font-medium text-theme-text-primary hover:bg-theme-bg-secondary transition-colors">
                + {aggiungi}
            </button>
        </div>
    )
}

function SceltaIcona({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    return (
        <label className="block">
            <span className="text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6]">Icona</span>
            <select value={value} onChange={e => onChange(e.target.value)} className={`mt-1 ${inputCls}`}>
                {ICONE.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
        </label>
    )
}

/**
 * Carica un PDF (bilanci, presentazione, statuto) e restituisce l'indirizzo.
 * Stesso bucket pubblico delle immagini del sito, cartella sito/documenti/.
 */
function CaricaDocumento({ onChange }: { onChange: (v: string) => void }) {
    const input = useRef<HTMLInputElement>(null)
    const [inCorso, setInCorso] = useState(false)
    const scegli = async (file: File | undefined) => {
        if (!file) return
        if (file.size > 20 * 1024 * 1024) { toast.error('File troppo pesante: massimo 20 MB'); return }
        setInCorso(true)
        try {
            const nome = file.name.replace(/[^\w.-]+/g, '_').slice(-80) || 'documento.pdf'
            const path = `sito/documenti/${Date.now()}_${nome}`
            const { error } = await supabase.storage.from('catalog-images').upload(path, file, {
                cacheControl: '3600', upsert: false, contentType: file.type || 'application/pdf',
            })
            if (error) throw error
            const { data } = supabase.storage.from('catalog-images').getPublicUrl(path)
            onChange(data.publicUrl)
            toast.success('Documento caricato. Ricorda di salvare.')
        } catch (e) {
            toast.error('Caricamento non riuscito: ' + (e instanceof Error ? e.message : String(e)) + '. Puoi incollare un indirizzo.')
        } finally {
            setInCorso(false)
            if (input.current) input.current.value = ''
        }
    }
    return (
        <>
            <input ref={input} type="file" accept="application/pdf,.pdf" className="hidden" onChange={e => scegli(e.target.files?.[0])} />
            <button type="button" onClick={() => input.current?.click()} disabled={inCorso} className="mt-1 px-3 py-1.5 rounded-md border border-theme-border text-[12px] text-theme-text-primary hover:bg-theme-bg-secondary disabled:opacity-50">
                {inCorso ? 'Caricamento...' : 'Carica PDF'}
            </button>
        </>
    )
}

function CampiNumero({ v, set }: { v: IrNumero; set: (p: Partial<IrNumero>) => void }) {
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <SceltaIcona value={v.icona} onChange={icona => set({ icona })} />
            <Campo label="Valore (es. € 1,5 M)" value={v.valore} onChange={valore => set({ valore })} />
            <Campo label="Etichetta (IT)" value={v.label_it} onChange={label_it => set({ label_it })} />
            <Campo label="Etichetta (EN)" value={v.label_en} onChange={label_en => set({ label_en })} />
            <Campo label="Nota sotto (IT)" value={v.nota_it || ''} onChange={nota_it => set({ nota_it })} />
            <Campo label="Nota sotto (EN)" value={v.nota_en || ''} onChange={nota_en => set({ nota_en })} />
        </div>
    )
}

export default function InvestitoriEditor({ copy, setCopy }: { copy: InvestitoriCopy; setCopy: (next: InvestitoriCopy) => void }) {
    const rec = copy as unknown as Record<string, unknown>
    const g = (k: string): string => (typeof rec[k] === 'string' ? (rec[k] as string) : '')
    const set = (k: string, v: unknown) => setCopy({ ...copy, [k]: v } as InvestitoriCopy)
    const lista = <T,>(k: string): T[] => (Array.isArray(rec[k]) ? (rec[k] as T[]) : [])

    /** Coppia IT / EN per un campo `<base>_it` / `<base>_en`. */
    // Funzioni e non componenti: un componente dichiarato qui dentro verrebbe
    // ricreato a ogni tasto e il campo perderebbe il cursore.
    const bi = (label: string, base: string, area?: boolean) => (
        <div key={base} className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Campo label={`${label} (IT)`} value={g(`${base}_it`)} onChange={v => set(`${base}_it`, v)} area={area} />
            <Campo label={`${label} (EN)`} value={g(`${base}_en`)} onChange={v => set(`${base}_en`, v)} area={area} />
        </div>
    )
    const immagine = (label: string, k: string) => (
        <div key={k}>
            <Campo label={label} value={g(k)} onChange={v => set(k, v)} />
            <CaricaMedia value={g(k)} onChange={v => set(k, v)} />
        </div>
    )
    const paragrafi = (k: string, lang: 'it' | 'en') => lista<string>(`${k}_${lang}`).join('\n\n')
    const setParagrafi = (k: string, lang: 'it' | 'en', v: string) => set(`${k}_${lang}`, v.split('\n\n').filter(s => s.trim().length > 0))

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-[20px] font-semibold tracking-tight text-theme-text-primary">Investitori</h2>
                <p className="text-[13px] text-theme-text-secondary mt-1">
                    Pagina <code className="text-[12px] bg-theme-bg-secondary px-1.5 py-0.5 rounded">/investitori</code> (anche /investor-relations).
                    Un blocco con elenco vuoto non compare sul sito. Nei testi lunghi una riga vuota separa i paragrafi.
                </p>
            </div>

            <Riquadro titolo="Apertura">
                {bi("Scritta piccola in alto", "ir_hero_eyebrow")}
                {bi("Titolo, prima riga", "ir_hero_riga1")}
                {bi("Titolo, seconda riga", "ir_hero_riga2")}
                {bi("Titolo, parola in oro corsivo", "ir_hero_accento")}
                {bi("Testo", "ir_hero_testo", true)}
                {bi("Bottone", "ir_hero_bottone")}
                {immagine("Foto di apertura (vuoto = quella di Aspetto)", "ir_hero_img")}
            </Riquadro>

            <Riquadro titolo="I nostri numeri" nota="Le cifre sono quelle della Home (Sito > Home > Numeri): si cambiano li' e valgono per tutto il sito. Qui solo i testi.">
                {bi('Scritta piccola', 'ir_numeri_eyebrow')}
                {bi('Titolo', 'ir_numeri_titolo')}
                {bi('Testo a destra', 'ir_numeri_testo', true)}
            </Riquadro>

            <Riquadro titolo={`La nostra crescita (${lista<IrBarra>('ir_crescita').length} anni)`} nota="Importi in euro interi. Utile a zero su tutti gli anni = nel grafico si vedono solo i ricavi.">
                {bi("Titolo", "ir_crescita_titolo")}
                {bi("Legenda ricavi", "ir_crescita_ricavi")}
                {bi("Legenda utile", "ir_crescita_utile")}
                {bi("Nota sotto il grafico", "ir_crescita_nota")}
                <Elenco<IrBarra>
                    voci={lista<IrBarra>('ir_crescita')}
                    onChange={v => set('ir_crescita', v)}
                    nuova={() => ({ id: nuovoId('a'), anno: String(new Date().getFullYear()), ricavi: 0, utile: 0 })}
                    etichetta={v => v.anno}
                    aggiungi="Aggiungi anno"
                >
                    {(v, s) => (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                            <Campo label="Anno (es. 2026*)" value={v.anno} onChange={anno => s({ anno })} />
                            <label className="block">
                                <span className="text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6]">Ricavi (€)</span>
                                <MoneyInput value={v.ricavi} onChange={x => s({ ricavi: parseMoney(x) || 0 })} className={`mt-1 ${inputCls}`} />
                            </label>
                            <label className="block">
                                <span className="text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6]">Utile netto (€)</span>
                                <MoneyInput value={v.utile} onChange={x => s({ utile: parseMoney(x) || 0 })} className={`mt-1 ${inputCls}`} />
                            </label>
                        </div>
                    )}
                </Elenco>
            </Riquadro>

            <Riquadro titolo="Visione">
                {bi("Scritta piccola", "ir_visione_eyebrow")}
                {bi("Titolo", "ir_visione_titolo")}
                {bi("Testo", "ir_visione_testo", true)}
                {bi("Bottone", "ir_visione_bottone")}
                <Campo label="Link del bottone (es. /about)" value={g('ir_visione_link')} onChange={v => set('ir_visione_link', v)} />
                {immagine("Foto di sfondo", "ir_visione_img")}
            </Riquadro>

            <Riquadro titolo={`Visione 2030 (${lista<IrTappa>('ir_v2030_tappe').length} tappe)`} nota="Frise degli obiettivi sotto la Visione. Senza tappe il blocco non compare. Usare foto senza loghi.">
                {bi("Scritta piccola", "ir_v2030_eyebrow")}
                {bi("Titolo, prima riga", "ir_v2030_riga1")}
                {bi("Titolo, riga in oro", "ir_v2030_accento")}
                {bi("Motto sotto il titolo", "ir_v2030_motto")}
                {bi("Citazione", "ir_v2030_citazione")}
                {immagine("Foto grande", "ir_v2030_img_1")}
                {immagine("Foto in alto a destra", "ir_v2030_img_2")}
                {immagine("Foto in basso a destra", "ir_v2030_img_3")}
                <Elenco<IrTappa>
                    voci={lista<IrTappa>('ir_v2030_tappe')}
                    onChange={v => set('ir_v2030_tappe', v)}
                    nuova={() => ({ id: nuovoId('t'), anno: '', valore_it: '', valore_en: '', titolo_it: '', titolo_en: '', testo_it: '', testo_en: '', img: '' })}
                    etichetta={v => [v.anno, v.valore_it].filter(Boolean).join(' - ')}
                    aggiungi="Aggiungi tappa"
                >
                    {(v, s) => (
                        <div className="space-y-2">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                <Campo label="Anno" value={v.anno} onChange={anno => s({ anno })} />
                                <div />
                                <Campo label="Obiettivo (IT, es. € 3 milioni)" value={v.valore_it} onChange={valore_it => s({ valore_it })} />
                                <Campo label="Obiettivo (EN)" value={v.valore_en} onChange={valore_en => s({ valore_en })} />
                                <Campo label="Titolo (IT)" value={v.titolo_it} onChange={titolo_it => s({ titolo_it })} />
                                <Campo label="Titolo (EN)" value={v.titolo_en} onChange={titolo_en => s({ titolo_en })} />
                                <Campo label="Testo (IT)" value={v.testo_it} onChange={testo_it => s({ testo_it })} />
                                <Campo label="Testo (EN)" value={v.testo_en} onChange={testo_en => s({ testo_en })} />
                            </div>
                            <div>
                                <Campo label="Foto" value={v.img} onChange={img => s({ img })} />
                                <CaricaMedia compatto value={v.img} onChange={img => s({ img })} />
                            </div>
                        </div>
                    )}
                </Elenco>
                {bi("Nota sotto la frise", "ir_v2030_nota")}
                {bi("Frase grande in oro", "ir_v2030_claim")}
                {bi("Sottotitolo della frase", "ir_v2030_sottoclaim")}
                <Elenco<IrPilastro>
                    voci={lista<IrPilastro>('ir_v2030_pilastri')}
                    onChange={v => set('ir_v2030_pilastri', v)}
                    nuova={() => ({ id: nuovoId('p'), icona: 'globo', titolo_it: '', titolo_en: '', testo_it: '', testo_en: '' })}
                    etichetta={v => v.titolo_it}
                    aggiungi="Aggiungi settore"
                >
                    {(v, s) => (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            <SceltaIcona value={v.icona} onChange={icona => s({ icona })} />
                            <div />
                            <Campo label="Settore (IT)" value={v.titolo_it} onChange={titolo_it => s({ titolo_it })} />
                            <Campo label="Settore (EN)" value={v.titolo_en} onChange={titolo_en => s({ titolo_en })} />
                            <Campo label="Sotto (IT)" value={v.testo_it} onChange={testo_it => s({ testo_it })} />
                            <Campo label="Sotto (EN)" value={v.testo_en} onChange={testo_en => s({ testo_en })} />
                        </div>
                    )}
                </Elenco>
                {bi("Frase di chiusura", "ir_v2030_chiusura")}
            </Riquadro>

            <Riquadro titolo={`I nostri azionisti (${lista<IrAzionista>('ir_azionisti').length})`} nota="Riservato = scheda col lucchetto, senza foto. Senza foto si vedono le iniziali.">
                {bi("Scritta piccola", "ir_azionisti_eyebrow")}
                {bi("Titolo", "ir_azionisti_titolo")}
                {bi("Testo a destra", "ir_azionisti_testo", true)}
                <Elenco<IrAzionista>
                    voci={lista<IrAzionista>('ir_azionisti')}
                    onChange={v => set('ir_azionisti', v)}
                    nuova={() => ({ id: nuovoId('az'), nome: '', ruolo_it: '', ruolo_en: '', da_it: '', da_en: '', foto: '' })}
                    etichetta={v => v.nome}
                    aggiungi="Aggiungi azionista"
                >
                    {(v, s) => (
                        <div className="space-y-2">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                <Campo label="Nome" value={v.nome} onChange={nome => s({ nome })} />
                                <label className="flex items-center gap-2 mt-5 text-[13px] text-theme-text-primary">
                                    <input type="checkbox" checked={!!v.riservato} onChange={e => s({ riservato: e.target.checked })} className="w-4 h-4" />
                                    Riservato (lucchetto)
                                </label>
                                <Campo label="Ruolo (IT)" value={v.ruolo_it} onChange={ruolo_it => s({ ruolo_it })} />
                                <Campo label="Ruolo (EN)" value={v.ruolo_en} onChange={ruolo_en => s({ ruolo_en })} />
                                <Campo label="Da quando (IT)" value={v.da_it} onChange={da_it => s({ da_it })} />
                                <Campo label="Da quando (EN)" value={v.da_en} onChange={da_en => s({ da_en })} />
                            </div>
                            {!v.riservato && (
                                <div>
                                    <Campo label="Foto" value={v.foto} onChange={foto => s({ foto })} />
                                    <CaricaMedia compatto value={v.foto} onChange={foto => s({ foto })} />
                                </div>
                            )}
                        </div>
                    )}
                </Elenco>
            </Riquadro>

            <Riquadro titolo={`Investitori privati (${lista<IrNumero>('ir_privati_stat').length} dati)`} nota="Senza dati il blocco non compare.">
                {bi("Scritta piccola", "ir_privati_eyebrow")}
                {bi("Titolo", "ir_privati_titolo")}
                {bi("Testo", "ir_privati_testo", true)}
                {immagine("Foto a sinistra (facoltativa)", "ir_privati_img")}
                <Elenco<IrNumero>
                    voci={lista<IrNumero>('ir_privati_stat')}
                    onChange={v => set('ir_privati_stat', v)}
                    nuova={() => ({ id: nuovoId('p'), icona: 'capitale', valore: '', label_it: '', label_en: '' })}
                    etichetta={v => `${v.valore} ${v.label_it}`}
                    aggiungi="Aggiungi dato"
                >
                    {(v, s) => <CampiNumero v={v} set={s} />}
                </Elenco>
                {bi("Riservati: scritta piccola", "ir_riservati_eyebrow")}
                {bi("Riservati: testo", "ir_riservati_testo", true)}
                {bi("Riservati: etichetta sotto il lucchetto (vuota = riquadro nascosto)", "ir_riservati_label")}
                {bi("Riservati: nota", "ir_riservati_nota")}
            </Riquadro>

            <Riquadro titolo={`Stampa e partner (${lista<IrLogo>('ir_partner_loghi').length} loghi)`} nota="Senza logo si vede il nome scritto. Senza loghi il blocco non compare.">
                {bi("Scritta piccola", "ir_partner_eyebrow")}
                {bi("Titolo", "ir_partner_titolo")}
                {bi("Testo", "ir_partner_testo", true)}
                {bi("Bottone", "ir_partner_bottone")}
                <Campo label="Link del bottone (vuoto = bottone nascosto)" value={g('ir_partner_link')} onChange={v => set('ir_partner_link', v)} />
                {immagine("Foto di sfondo", "ir_partner_img")}
                <Elenco<IrLogo>
                    voci={lista<IrLogo>('ir_partner_loghi')}
                    onChange={v => set('ir_partner_loghi', v)}
                    nuova={() => ({ id: nuovoId('l'), nome: '', logo: '' })}
                    etichetta={v => v.nome}
                    aggiungi="Aggiungi logo"
                >
                    {(v, s) => (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            <Campo label="Nome" value={v.nome} onChange={nome => s({ nome })} />
                            <Campo label="Link (facoltativo)" value={v.link || ''} onChange={link => s({ link })} />
                            <div className="md:col-span-2">
                                <Campo label="Logo (immagine)" value={v.logo} onChange={logo => s({ logo })} />
                                <CaricaMedia compatto value={v.logo} onChange={logo => s({ logo })} />
                            </div>
                        </div>
                    )}
                </Elenco>
            </Riquadro>

            <Riquadro titolo={`Governance e documenti (${lista<IrDocumento>('ir_gov_documenti').length})`} nota="Documento senza file = il cliente lo chiede via email all'indirizzo investitori. File video (.mp4) = si apre una pagina con il video.">
                {bi("Scritta piccola", "ir_gov_eyebrow")}
                {bi("Titolo", "ir_gov_titolo")}
                {bi("Testo a destra", "ir_gov_testo", true)}
                <Elenco<IrDocumento>
                    voci={lista<IrDocumento>('ir_gov_documenti')}
                    onChange={v => set('ir_gov_documenti', v)}
                    nuova={() => ({ id: nuovoId('d'), icona: 'documento', titolo_it: '', titolo_en: '', azione_it: 'Scarica', azione_en: 'Download', url: '' })}
                    etichetta={v => v.titolo_it}
                    aggiungi="Aggiungi documento"
                >
                    {(v, s) => (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            <SceltaIcona value={v.icona} onChange={icona => s({ icona })} />
                            <div />
                            <Campo label="Titolo (IT)" value={v.titolo_it} onChange={titolo_it => s({ titolo_it })} />
                            <Campo label="Titolo (EN)" value={v.titolo_en} onChange={titolo_en => s({ titolo_en })} />
                            <Campo label="Scritta del link (IT)" value={v.azione_it} onChange={azione_it => s({ azione_it })} />
                            <Campo label="Scritta del link (EN)" value={v.azione_en} onChange={azione_en => s({ azione_en })} />
                            <div className="md:col-span-2">
                                <Campo label="File o pagina (PDF, indirizzo o /press)" value={v.url} onChange={url => s({ url })} />
                                <CaricaDocumento onChange={url => s({ url })} />
                            </div>
                            {/* Piu' file sotto la stessa scheda (es. un bilancio
                                per anno): se ce n'e' almeno uno, sul sito la
                                scheda li elenca tutti e il campo sopra non serve. */}
                            <div className="md:col-span-2 border-t border-theme-border pt-3">
                                <p className="text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6] mb-2">File della scheda ({(v.file || []).length}) - uno per anno, il piu' recente in alto</p>
                                <Elenco<IrFile>
                                    voci={v.file || []}
                                    onChange={file => s({ file })}
                                    nuova={() => ({ id: nuovoId('f'), nome_it: '', nome_en: '', url: '' })}
                                    etichetta={f => f.nome_it || 'Nuovo file'}
                                    aggiungi="Aggiungi file"
                                >
                                    {(f, sf) => (
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                            <Campo label="Nome (IT) es. Bilancio 2026" value={f.nome_it} onChange={nome_it => sf({ nome_it })} />
                                            <Campo label="Nome (EN)" value={f.nome_en} onChange={nome_en => sf({ nome_en })} />
                                            <div className="md:col-span-2">
                                                <Campo label="File (PDF)" value={f.url} onChange={url => sf({ url })} />
                                                <CaricaDocumento onChange={url => sf({ url })} />
                                            </div>
                                        </div>
                                    )}
                                </Elenco>
                            </div>
                        </div>
                    )}
                </Elenco>
                {bi("Titolo informazioni societarie", "info_heading")}
                <Elenco<InvestitoriInfoItem & { id?: string }>
                    voci={copy.info_items || []}
                    onChange={v => set('info_items', v)}
                    nuova={() => ({ label: '', value: '', label_it: '', label_en: '', value_it: '', value_en: '' })}
                    etichetta={v => v.label_it || v.label}
                    aggiungi="Aggiungi riga"
                >
                    {(v, s) => (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            <Campo label="Voce (IT)" value={v.label_it ?? v.label} onChange={label_it => s({ label_it, label: label_it })} />
                            <Campo label="Voce (EN)" value={v.label_en ?? ''} onChange={label_en => s({ label_en })} />
                            <Campo label="Valore (IT)" value={v.value_it ?? v.value} onChange={value_it => s({ value_it, value: value_it })} />
                            <Campo label="Valore (EN)" value={v.value_en ?? ''} onChange={value_en => s({ value_en })} />
                        </div>
                    )}
                </Elenco>
                {bi("Nota sotto le informazioni", "info_footnote", true)}
            </Riquadro>

            <Riquadro titolo="Chiusura e contatti" nota="Il bottone 'Manifesta il tuo interesse' apre WhatsApp; senza WhatsApp apre l'email.">
                {bi("Scritta piccola", "ir_cta_eyebrow")}
                {bi("Titolo", "ir_cta_titolo")}
                {bi("Testo", "ir_cta_testo", true)}
                {bi("Bottone", "ir_cta_bottone")}
                {bi("Testo sotto il bottone", "ir_cta_nota", true)}
                <Campo label="WhatsApp (indirizzo wa.me con testo)" value={g('cta_whatsapp_url')} onChange={v => set('cta_whatsapp_url', v)} />
                <Campo label="Email investitori" value={g('cta_email')} onChange={v => set('cta_email', v)} />
            </Riquadro>

            <Riquadro titolo="Avvertenza legale (in fondo, piccola)">
                {bi("Titolo", "legal_heading")}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <Campo label="Paragrafi (IT)" value={paragrafi('legal_paragraphs', 'it')} onChange={v => setParagrafi('legal_paragraphs', 'it', v)} area />
                    <Campo label="Paragrafi (EN)" value={paragrafi('legal_paragraphs', 'en')} onChange={v => setParagrafi('legal_paragraphs', 'en', v)} area />
                </div>
            </Riquadro>
        </div>
    )
}
