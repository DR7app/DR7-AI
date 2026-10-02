/**
 * Copia di cortesia del contratto nella lingua del cliente.
 *
 * 02/10/2026 (direzione): i clienti stranieri firmano un contratto in
 * italiano che non capiscono. Si firma SEMPRE il contratto italiano (e' quello
 * che fa fede: multe, assicurazione, contenzioso); accanto al link di firma il
 * cliente riceve una traduzione con valore puramente informativo.
 *
 * Claude legge il PDF compilato (anche i titoli con font codificati male, che
 * un'estrazione di testo restituisce come "'$7, LOCATORE") e lo traduce; qui
 * si impagina il testo in un PDF nuovo con un font Unicode (polacco, cirillico,
 * greco: Helvetica di pdf-lib non li ha).
 */
import fs from 'fs'
import path from 'path'
import Anthropic from '@anthropic-ai/sdk'
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'

export const AVVISO_IT = 'La presente traduzione ha valore puramente informativo; in caso di discrepanza fa fede esclusivamente il testo in lingua italiana.'

const NOMI_LINGUA: Record<string, string> = {
    en: 'English', fr: 'French', es: 'Spanish', pt: 'Portuguese', de: 'German',
    nl: 'Dutch', ru: 'Russian', uk: 'Ukrainian', pl: 'Polish', ro: 'Romanian', el: 'Greek',
}

export function nomeLingua(lang: string): string {
    return NOMI_LINGUA[lang] || lang
}

const MODELLI = ['claude-sonnet-5-5', 'claude-sonnet-4-6', 'claude-sonnet-4-5']

const SISTEMA = `You translate Italian car-rental contracts into another language for the customer's information.
Output ONLY the translation as plain text, with this light markup:
- a line starting with "# " is a section heading;
- a line starting with "- " is a bullet;
- an empty line separates paragraphs;
- "Label: value" lines for the filled-in data.
Rules:
- Translate the WHOLE document, every clause, in order. Never summarise, never skip, never add comments or notes of your own.
- Keep every filled-in value exactly as written (names, plates, dates, times, amounts, contract number, IBAN, addresses, article numbers like "art. 1456 c.c.").
- Leave out form fields that are empty and sections that are entirely empty (e.g. an unused second driver or guarantor block).
- Some headings come from badly encoded fonts and look like "'$7, LOCATORE" or "FRANC+I*IE E ASSIC8RA=IONI": read them from the page as rendered and translate what they really say.
- The very first line of your output must be: DISCLAIMER: followed by the translation of this sentence: "${AVVISO_IT}"
- The second line must be: TITLE: followed by the translation of "Copia di cortesia del contratto".`

export type TraduzioneContratto = { avviso: string; titolo: string; corpo: string; modello: string }

export async function traduciContratto(pdf: Uint8Array, lang: string): Promise<TraduzioneContratto> {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    let ultimoErrore: unknown = null
    for (const modello of MODELLI) {
        try {
            const risposta = await client.messages.stream({
                model: modello,
                max_tokens: 32000,
                system: SISTEMA,
                messages: [{
                    role: 'user',
                    content: [
                        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: Buffer.from(pdf).toString('base64') } },
                        { type: 'text', text: `Translate this contract into ${nomeLingua(lang)}.` },
                    ],
                }],
            }).finalMessage()
            if (risposta.stop_reason === 'max_tokens') throw new Error('Traduzione troncata')
            const testo = risposta.content.map(b => (b.type === 'text' ? b.text : '')).join('').trim()
            const righe = testo.split('\n')
            let avviso = ''
            let titolo = ''
            while (righe.length && /^(DISCLAIMER|TITLE):/.test(righe[0].trim())) {
                const r = righe.shift()!.trim()
                if (r.startsWith('DISCLAIMER:')) avviso = r.slice('DISCLAIMER:'.length).trim()
                else titolo = r.slice('TITLE:'.length).trim()
            }
            const corpo = righe.join('\n').trim()
            if (corpo.length < 500) throw new Error('Traduzione vuota o troppo corta')
            return { avviso, titolo, corpo, modello }
        } catch (err) {
            ultimoErrore = err
            // Si passa al modello successivo solo se il problema e' il modello;
            // rete, chiave, rate limit sono fatali (stessa regola di EMTN).
            const e = err as { status?: number; message?: string }
            const msg = String(e?.message || '')
            const problemaModello = e?.status === 404 || e?.status === 403 || (e?.status === 400 && /model/i.test(msg)) || /not.?found/i.test(msg)
            if (!problemaModello) throw err
            console.warn(`[contratto-cortesia] modello ${modello} non disponibile: ${msg}`)
        }
    }
    throw ultimoErrore || new Error('Nessun modello Anthropic disponibile')
}

// ─── Font ─────────────────────────────────────────────────────────────────
// Nel repo (netlify.toml included_files); se la function non li trova li
// scarica dal CDN, cosi' un problema di bundle non ferma la copia.
const FONT_CDN = 'https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io/fonts/NotoSans/hinted/ttf/'

async function caricaFont(nome: string): Promise<Uint8Array> {
    const rel = path.join('netlify', 'functions', 'assets', 'fonts', nome)
    const basi = [process.env.LAMBDA_TASK_ROOT, process.cwd(), typeof __dirname !== 'undefined' ? path.join(__dirname, '..', '..', '..') : undefined]
    for (const base of basi) {
        if (!base) continue
        try { return new Uint8Array(fs.readFileSync(path.join(base, rel))) } catch { /* prossimo */ }
    }
    const r = await fetch(FONT_CDN + nome)
    if (!r.ok) throw new Error(`Font ${nome} non disponibile (${r.status})`)
    return new Uint8Array(await r.arrayBuffer())
}

// ─── Impaginazione ────────────────────────────────────────────────────────
const A4: [number, number] = [595.28, 841.89]
const MARGINE = 50
const NERO = rgb(0, 0, 0)
const GRIGIO = rgb(0.35, 0.35, 0.35)

/** Caratteri che il font non ha (emoji, simboli rari) diventano spazio invece di far fallire il PDF. */
function pulisci(testo: string, font: PDFFont): string {
    const ok = new Set(font.getCharacterSet())
    return Array.from(testo.replace(/\t/g, ' ')).map(c => (ok.has(c.codePointAt(0)!) ? c : ' ')).join('')
}

function aCapo(testo: string, font: PDFFont, size: number, larghezza: number): string[] {
    const righe: string[] = []
    let riga = ''
    for (const parola of testo.split(/\s+/).filter(Boolean)) {
        const prova = riga ? `${riga} ${parola}` : parola
        if (font.widthOfTextAtSize(prova, size) <= larghezza) { riga = prova; continue }
        if (riga) righe.push(riga)
        // Parola piu' lunga della riga (IBAN, URL): si spezza a caratteri.
        let pezzo = ''
        for (const c of parola) {
            if (font.widthOfTextAtSize(pezzo + c, size) > larghezza) { righe.push(pezzo); pezzo = '' }
            pezzo += c
        }
        riga = pezzo
    }
    if (riga) righe.push(riga)
    return righe
}

export async function impaginaCopiaCortesia(t: TraduzioneContratto, numeroContratto: string): Promise<Uint8Array> {
    const doc = await PDFDocument.create()
    doc.registerFontkit(fontkit)
    const normale = await doc.embedFont(await caricaFont('NotoSans-Regular.ttf'), { subset: true })
    const grassetto = await doc.embedFont(await caricaFont('NotoSans-Bold.ttf'), { subset: true })
    const larghezza = A4[0] - MARGINE * 2

    let pagina: PDFPage = doc.addPage(A4)
    let y = A4[1] - MARGINE
    const nuovaPagina = () => { pagina = doc.addPage(A4); y = A4[1] - MARGINE }
    const scrivi = (testo: string, font: PDFFont, size: number, colore = NERO, rientro = 0, dopo = 0) => {
        const interlinea = size * 1.35
        for (const r of aCapo(pulisci(testo, font), font, size, larghezza - rientro)) {
            if (y - interlinea < MARGINE) nuovaPagina()
            y -= interlinea
            pagina.drawText(r, { x: MARGINE + rientro, y, size, font, color: colore })
        }
        y -= dopo
    }

    scrivi(t.titolo || 'Copia di cortesia del contratto', grassetto, 15, NERO, 0, 2)
    if (numeroContratto) scrivi(numeroContratto, normale, 10, GRIGIO, 0, 8)
    // Avviso in italiano E nella lingua del cliente, in testa: e' la frase che
    // rende questa copia innocua in caso di contestazione.
    scrivi(AVVISO_IT, grassetto, 9, NERO, 0, 2)
    if (t.avviso) scrivi(t.avviso, grassetto, 9, NERO, 0, 14)

    for (const raw of t.corpo.split('\n')) {
        const riga = raw.trim()
        if (!riga) { y -= 5; continue }
        if (riga.startsWith('# ')) { y -= 6; scrivi(riga.slice(2), grassetto, 11, NERO, 0, 3); continue }
        if (riga.startsWith('- ')) { scrivi('•  ' + riga.slice(2), normale, 9, NERO, 10); continue }
        scrivi(riga, normale, 9)
    }

    const pagine = doc.getPages()
    pagine.forEach((p, i) => {
        p.drawText(pulisci(`${i + 1}/${pagine.length}  ·  Copia di cortesia: fa fede esclusivamente il testo in lingua italiana`, normale), { x: MARGINE, y: 25, size: 6.5, font: normale, color: GRIGIO })
    })
    return doc.save()
}
