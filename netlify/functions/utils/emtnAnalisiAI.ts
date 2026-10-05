/**
 * EMTN — analisi documentale con Claude.
 *
 * 28/09/2026: stesso modello e stessi ripieghi di extract-document-data
 * (richiesta direzione: "comme extract data"). La risposta e' forzata su un
 * unico strumento con schema fisso, cosi' torna sempre JSON; il risultato
 * passa poi da normalizzaRisultato (src/utils/emtnMobilityRisk.ts), che
 * scarta cio' che non e' ammesso e ricalcola residui e ritardi.
 */
import Anthropic from '@anthropic-ai/sdk'
import {
    AREE_EMTN, CATEGORIE_EMTN, CAMPI_EVENTO, STATI_EMTN, STATI_CONTESTAZIONE, NON_RISULTA, AVVISO_LEGALE,
    CAMPI_PRATICA, TIPI_DOCUMENTO, ESITI_VERIFICA,
} from '../../../src/utils/emtnMobilityRisk'
import { categorieScorePerPrompt } from '../../../src/utils/emtnScore/regole'

/** Ordine di preferenza, identico a extract-document-data.ts. */
export const MODELLI_EMTN = [
    'claude-sonnet-4-6',
    'claude-sonnet-4-5',
    'claude-3-5-sonnet-latest',
    'claude-3-5-sonnet-20241022',
]

/** Formati che Claude legge: PDF come documento, immagini come immagine. */
export const MIME_LEGGIBILI: Record<string, 'pdf' | 'image/jpeg' | 'image/png' | 'image/webp'> = {
    pdf: 'pdf',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
}

export interface DocumentoAnalisi {
    nome: string
    estensione: string
    dati: Buffer
}

const catalogo = Object.entries(AREE_EMTN).map(([area, nome]) => {
    const voci = CATEGORIE_EMTN.filter(c => String(c.area) === area)
        .map(c => `  ${c.codice}. ${c.label.toUpperCase()} — ${c.descrizione}`)
        .join('\n')
    return `AREA ${area} – ${nome.toUpperCase()}\n${voci}`
}).join('\n\n')

const campi = CAMPI_EVENTO.map(c => `- ${c.chiave}: ${c.label}${c.tipo === 'importo' ? ' (numero in euro, senza simbolo)' : c.tipo === 'data' ? ' (AAAA-MM-GG)' : c.tipo === 'dataora' ? ' (AAAA-MM-GGTHH:MM, ora italiana)' : ''}`).join('\n')

export const SYSTEM_EMTN = `Sei il modulo di analisi documentale di EMTN (European Mobility Trust Network) per un operatore di noleggio veicoli. Analizzi i documenti caricati dall'operatore su UN cliente e prepari il Mobility Risk Report, che un operatore umano rivedra' e confermera' prima di qualsiasi pubblicazione.

PRINCIPIO GENERALE
EMTN registra FATTI CONTRATTUALI OGGETTIVI, DOCUMENTATI E VERIFICABILI. Non formuli giudizi sulla persona. Sono vietate espressioni come "cliente cattivo", "problematico", "pericoloso", "inaffidabile", "disonesto", "aggressivo", "da evitare", "truffatore", "moroso abituale" e qualunque equivalente. Distingui sempre il FATTO DOCUMENTATO da valutazioni, opinioni, ipotesi o accuse: queste ultime non diventano eventi.

CLASSIFICAZIONE (usa SOLO questi codici)
${catalogo}

REGOLE DI CLASSIFICAZIONE
- Un documento puo' contenere piu' eventi: NON scegliere una sola categoria. Esempio: riconsegna con 26 ore di ritardo, penale di €400, pagamento di €250, residuo €150, contestazione del cliente = eventi 37, 11 (o 16 se contestata), 2, 3, 14, tutti collegati alla stessa pratica.
- Un chargeback (19) non e' automaticamente una frode. Indica, se risulta, lo stato: ${STATI_CONTESTAZIONE.join(', ')}.
- Accordo transattivo: se un credito di €2.000 e' definito con accordo a €1.500 e i €1.500 risultano pagati, NON e' un insoluto di €500. Indica importo_richiesto 2000, importo_dovuto 1500, importo_pagato 1500, importo_residuo 0 e stato REGOLARIZZATO.
- Danni: non scrivere "danno causato dal cliente" se il documento dimostra solo l'esistenza del danno e non ne documenta l'attribuzione.
- Per le violazioni contrattuali indica, se risulta, la clausola del contratto.
- La categoria 66 e' residuale: sempre con descrizione del fatto e, se applicabile, clausola.

EVENTI DI NATURA LEGALE/PENALE
Furto, truffa, appropriazione indebita, falsificazione, cliente denunciato, procedimento penale, condanna, indagato, querelato o qualificazioni equivalenti NON sono eventi condivisibili. Se i documenti li contengono, NON classificarli e NON citarli nel titolo o nel report: riportali soltanto in "informazioni_legali", una frase neutra per ciascuna, citando il documento. Verranno trattati come "${AVVISO_LEGALE}".

DATI DA ESTRARRE PER OGNI EVENTO (in "dati")
${campi}
comunicazione_cliente: SPONTANEA solo se un documento mostra che il cliente ha comunicato l'evento di sua iniziativa (es. messaggio o verbale prima del controllo dell'operatore); SU_RICHIESTA se lo ha confermato solo dopo la contestazione dell'operatore; OMESSA solo se un documento dimostra che lo ha taciuto o negato a fronte di prove. Altrimenti null.
responsabilita: ACCERTATA solo se i documenti attribuiscono l'evento al cliente (es. ammissione firmata, constatazione amichevole, perizia, sentenza); CONTESTATA se il cliente la contesta e non e' decisa; NON_ATTRIBUIBILE se risulta un responsabile diverso dal cliente (es. terzo identificato, guasto). Altrimenti null.
Solo se presenti o ricavabili con certezza dai documenti. Se un dato non risulta, usa null (a schermo diventera' "${NON_RISULTA}"). Non inventare, non presumere, non completare dati mancanti con supposizioni. Il ritardo di riconsegna lo calcola il sistema dalle due date/ore: riportale esattamente.
categoria_score: per ogni evento proponi UNA categoria del punteggio EMTN tra quelle qui sotto (scrivi solo l'identificativo). Scegli quella che descrive il fatto documentato; se nessuna corrisponde con certezza usa non_previsto. NON indicare punti: li calcola il sistema con regole fisse. Per un incidente distingui: incidente_terzi solo se risulta la responsabilita' esclusiva di un terzo; con responsabilita' del cliente usa danno; danno preesistente, usura o guasto = non_imputabile. Furto e frode NON vanno mai proposti (sono informazioni legali).
${categorieScorePerPrompt()}
In "fonti" metti i nomi dei documenti da cui risulta l'evento.

DATI DELLA PRATICA (in "pratica"): ${CAMPI_PRATICA.map(c => c.chiave).join(', ')}. Stesse regole: null se non risulta.

TIPO DI OGNI DOCUMENTO (in "documenti", uno per ogni documento caricato, con il suo nome esatto): ${Object.keys(TIPI_DOCUMENTO).join(', ')}.

CONTROLLO INCROCIATO TRA DOCUMENTI
Confronta tra loro TUTTI i documenti (contratto, contestazione, check-in/check-out, foto, preventivo/perizia, fattura, pagamenti, comunicazioni, accordi). Ogni differenza rilevante di importi, date, veicolo, targa, cliente o codice fiscale va in "incongruenze", citando i documenti. Per gli importi scrivi "INCONGRUENZA ECONOMICA RILEVATA – VERIFICA RICHIESTA" con i valori trovati (es. contratto €1.500, contestazione €2.000, fattura €1.500). NON decidere quale importo sia corretto.
Una fattura dimostra l'esistenza del documento contabile, NON la fondatezza del credito, del danno o della penale.
In "non_supportate" riporta le affermazioni presenti nei documenti (soprattutto nel testo libero dell'operatore) che non risultano supportate da prova.

ESITO DELLA VERIFICA (in "esito_verifica", uno solo): ${ESITI_VERIFICA.join(', ')}.
Usa REVISIONE_MANUALE_OBBLIGATORIA quando manca il contratto, cliente/codice fiscale/veicolo non corrispondono, le date sono incompatibili, gli importi sono incongruenti, la contestazione contraddice il contratto, la documentazione minima manca, la posizione risulta gia' regolarizzata ma e' presentata come insoluta, ci sono affermazioni non supportate, i documenti non sono interpretabili con affidabilita' o contengono dati su reati o procedimenti.

STATI (solo questi): ${STATI_EMTN.join(', ')}.
Stato di un evento e stato complessivo della posizione in base alla documentazione: DA_VERIFICARE se i documenti non bastano a stabilirlo.

REPORT
"titolo": le categorie principali in maiuscolo separate da " – " (es. "RITARDO NELLA RICONSEGNA – PAGAMENTO PARZIALE").
"report": descrizione sintetica, neutra, professionale, fattuale, non accusatoria, non emotiva, basata solo sui documenti. Preferisci "Dal documento risulta...", "Risulta documentato...", "Non risulta dalla documentazione...". Date in formato GG/MM/AAAA, orari 24h, importi in euro con virgola decimale. Chiudi con "STATO ATTUALE: <stato> – RESIDUO €<importo>" quando c'e' un residuo.
Esempio di tono: "Dal documento caricato risulta riconsegna contrattualmente prevista per il 12/09/2026 alle ore 10:00 e riconsegna effettiva avvenuta il 13/09/2026 alle ore 16:30. Ritardo documentato: 30 ore e 30 minuti. In relazione all'evento risulta richiesto un importo complessivo di €750. Dalla documentazione disponibile risultano corrisposti €500. Residuo documentato: €250. La posizione risulta contestata dal cliente. STATO ATTUALE: CONTESTATO – RESIDUO €250."

Registra il risultato chiamando lo strumento registra_analisi.`

const proprietaDati = Object.fromEntries(CAMPI_EVENTO.map(c => [
    c.chiave,
    c.tipo === 'importo'
        ? { type: ['number', 'null'], description: c.label }
        : { type: ['string', 'null'], description: c.label },
]))

export const STRUMENTO_EMTN: Anthropic.Tool = {
    name: 'registra_analisi',
    description: 'Registra gli eventi EMTN individuati nei documenti e il Mobility Risk Report proposto.',
    input_schema: {
        type: 'object',
        properties: {
            eventi: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        codice: { type: 'integer', minimum: 1, maximum: 66, description: 'Codice categoria EMTN (1-66)' },
                        stato: { type: 'string', enum: [...STATI_EMTN] },
                        dati: { type: 'object', properties: proprietaDati, additionalProperties: false },
                        fonti: { type: 'array', items: { type: 'string' } },
                    },
                    required: ['codice', 'stato', 'dati', 'fonti'],
                },
            },
            stato_posizione: { type: 'string', enum: [...STATI_EMTN] },
            titolo: { type: 'string' },
            report: { type: 'string' },
            informazioni_legali: { type: 'array', items: { type: 'string' } },
            pratica: {
                type: 'object',
                properties: Object.fromEntries(CAMPI_PRATICA.map(c => [c.chiave, { type: ['string', 'null'], description: c.label }])),
                additionalProperties: false,
            },
            documenti: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        nome: { type: 'string' },
                        tipo: { type: 'string', enum: Object.keys(TIPI_DOCUMENTO) },
                    },
                    required: ['nome', 'tipo'],
                },
            },
            incongruenze: { type: 'array', items: { type: 'string' } },
            non_supportate: { type: 'array', items: { type: 'string' } },
            esito_verifica: { type: 'string', enum: [...ESITI_VERIFICA] },
        },
        required: ['eventi', 'stato_posizione', 'titolo', 'report', 'informazioni_legali', 'pratica', 'documenti', 'incongruenze', 'non_supportate', 'esito_verifica'],
    },
}

/**
 * Chiama Claude con i documenti. `posizioneAttuale` (se c'e') e' lo stato gia'
 * registrato della pratica: i nuovi documenti la aggiornano invece di creare
 * una segnalazione nuova.
 */
export async function analizzaDocumentiEMTN(
    documenti: DocumentoAnalisi[],
    posizioneAttuale: unknown | null,
): Promise<{ input: unknown; modello: string }> {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    const contenuto: Anthropic.ContentBlockParam[] = []
    documenti.forEach((d, i) => {
        const tipo = MIME_LEGGIBILI[d.estensione]
        contenuto.push({ type: 'text', text: `Documento ${i + 1}: ${d.nome}` })
        if (tipo === 'pdf') {
            contenuto.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: d.dati.toString('base64') } })
        } else if (tipo) {
            contenuto.push({ type: 'image', source: { type: 'base64', media_type: tipo, data: d.dati.toString('base64') } })
        }
    })
    contenuto.push({
        type: 'text',
        text: posizioneAttuale
            ? `Questi documenti riguardano una posizione GIA' REGISTRATA per questo cliente. Stato attuale:\n${JSON.stringify(posizioneAttuale)}\n\nVerifica se i nuovi documenti modificano lo stato degli eventi gia' registrati (es. un pagamento che riduce o azzera il residuo) e restituisci la posizione COMPLETA aggiornata: eventi gia' presenti aggiornati + eventuali nuovi eventi. Non creare eventi negativi duplicati per l'evoluzione della stessa posizione.`
            : 'Analizza i documenti e registra gli eventi EMTN con il report.',
    })

    let ultimoErrore: unknown = null
    for (const modello of MODELLI_EMTN) {
        try {
            const risposta = await client.messages.create({
                model: modello,
                max_tokens: 16000,
                system: SYSTEM_EMTN,
                tools: [STRUMENTO_EMTN],
                tool_choice: { type: 'tool', name: STRUMENTO_EMTN.name },
                messages: [{ role: 'user', content: contenuto }],
            })
            if (risposta.stop_reason === 'max_tokens') throw new Error('Risposta troncata: troppi eventi o documenti troppo lunghi')
            const blocco = risposta.content.find(b => b.type === 'tool_use')
            if (!blocco || blocco.type !== 'tool_use') throw new Error('Nessun risultato strutturato nella risposta')
            return { input: blocco.input, modello }
        } catch (err) {
            ultimoErrore = err
            // Stessa regola di extract-document-data: si passa al modello
            // successivo solo se il problema e' il modello (inesistente o
            // senza accesso); rate limit, rete, chiave sono fatali.
            const e = err as { status?: number; message?: string }
            const msg = String(e?.message || '')
            const problemaModello = e?.status === 404 || e?.status === 403 || (e?.status === 400 && /model/i.test(msg)) || /not.?found/i.test(msg)
            if (!problemaModello) throw err
            console.warn(`[emtn-analisi] modello ${modello} non disponibile: ${msg}`)
        }
    }
    throw ultimoErrore || new Error('Nessun modello Anthropic disponibile')
}
