/**
 * Nome dell'investitore sul sito (pagina /investitori, blocco "I nostri azionisti").
 *
 * 06/10/2026 (direzione): l'investitore risponde AUTORIZZO o RISERVATO al
 * WhatsApp pro_investitore_autorizzazione_nome; l'admin preme il pulsante
 * corrispondente in Amministrazione > Investitori. La pagina vive in
 * centralina_pro_config.site_copy.investitori (la stessa che si modifica in
 * Sito > Investitori): qui si riscrivono solo la lista azionisti e i numeri
 * del blocco investitori, il resto del CMS non si tocca.
 * Sul sito va al massimo il nome: nessun importo personale, telefono o CF.
 */
import { supabase } from '../supabaseClient'

interface SchedaAzionista {
    id: string
    nome: string
    ruolo_it: string; ruolo_en: string
    da_it: string; da_en: string
    foto: string
    riservato?: boolean
}

const idScheda = (investitoreId: string) => `inv-${investitoreId}`

/** Legge la config, cambia solo la pagina investitori, riscrive (stesso schema di SitoTab.savePersisted). */
async function aggiornaPagina(cambia: (pagina: Record<string, unknown>) => Record<string, unknown>): Promise<boolean> {
    const { data, error: e1 } = await supabase.from('centralina_pro_config').select('config').eq('id', 'main').maybeSingle()
    if (e1) throw e1
    const config = (data?.config ?? {}) as Record<string, unknown>
    const siteCopy = (config.site_copy ?? {}) as Record<string, unknown>
    const pagina = (siteCopy.investitori ?? {}) as Record<string, unknown>
    // La pagina non e' mai stata salvata dal CMS: il sito usa i suoi testi di
    // default e una pagina parziale qui li cancellerebbe. Non si tocca.
    if (!pagina.hero_title) return false
    const cambiata = cambia(pagina)
    // Niente da cambiare = niente scrittura sulla config condivisa.
    if (JSON.stringify(cambiata) === JSON.stringify(pagina)) return false
    const nuova = { ...config, site_copy: { ...siteCopy, investitori: cambiata } }
    const { error: e2 } = await supabase.from('centralina_pro_config').upsert({ id: 'main', config: nuova })
    if (e2) throw e2
    return true
}

// 06/10/2026 (direzione): la lista "I nostri azionisti" si ricostruisce dal
// gestionale. Ogni investitore con almeno un versamento ha la sua scheda
// (id inv-<uuid>): col nome SOLO se ha risposto AUTORIZZO, altrimenti scheda
// col lucchetto senza nome ne' cognome ("Investitore privato" / "Societa'
// privata"). Le schede scritte a mano nel CMS (Andrea Onano, Societa' privata)
// erano gli stessi investitori: la lista del gestionale le sostituisce.
export interface InvestitorePerSito {
    id: string
    nome: string
    tipo: 'persona' | 'societa'
    pubblicazione_nome: 'autorizzato' | 'riservato' | null
    totale: number
    /** Anno del primo versamento. */
    anno: number
}

function schedeAzionisti(investitori: InvestitorePerSito[], prima: SchedaAzionista[]): SchedaAzionista[] {
    const precedenti = new Map(prima.map(s => [s.id, s]))
    return investitori
        .filter(i => i.totale > 0)
        .sort((a, b) => b.totale - a.totale)
        .map(i => {
            const societa = i.tipo === 'societa'
            const pubblico = i.pubblicazione_nome === 'autorizzato'
            const id = idScheda(i.id)
            const scheda: SchedaAzionista = pubblico
                ? {
                    id,
                    nome: i.nome.trim(),
                    ruolo_it: societa ? 'Società' : 'Investitore privato',
                    ruolo_en: societa ? 'Company' : 'Private investor',
                    da_it: `Azionista dal ${i.anno}`,
                    da_en: `Shareholder since ${i.anno}`,
                    // La foto caricata nel CMS resta.
                    foto: precedenti.get(id)?.foto || '',
                }
                : {
                    id,
                    // Vuoto = il sito scrive "Investitore privato" col lucchetto.
                    nome: societa ? 'Società privata' : '',
                    ruolo_it: '', ruolo_en: '',
                    da_it: `Azionista dal ${i.anno}`,
                    da_en: `Shareholder since ${i.anno}`,
                    foto: '',
                    riservato: true,
                }
            return scheda
        })
}

// ─── Numeri della pagina (blocco "Investitori privati") ─────────────────────
// 06/10/2026 (direzione): "capitale raccolto" e "investitori" si ricalcolano
// dal gestionale (somma dei versamenti, investitori con almeno un versamento)
// ogni volta che la tab Investitori carica i dati. Si toccano SOLO le schede
// con id `capitale` e `investitori` di ir_privati_stat, il titolo
// "N investitori" e il conteggio nella frase "Al momento, ... hanno scelto".
// Le altre schede (es. "Primo round") restano come scritte nel CMS.

interface SchedaNumero { id: string; valore: string; label_it?: string; label_en?: string; nota_it?: string; nota_en?: string; icona?: string }

const NUMERI_IT = ['nessun', 'un', 'due', 'tre', 'quattro', 'cinque', 'sei', 'sette', 'otto', 'nove', 'dieci']
const NUMERI_EN = ['no', 'a', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
const parolaIt = (n: number, femminile = false) => (n === 1 ? (femminile ? 'una' : 'un') : NUMERI_IT[n] || String(n))
const parolaEn = (n: number) => NUMERI_EN[n] || String(n)

function chiIt(societa: number, privati: number): string {
    const p: string[] = []
    if (societa) p.push(`${parolaIt(societa, true)} ${societa === 1 ? 'società' : 'società'}`)
    if (privati) p.push(`${parolaIt(privati)} ${privati === 1 ? 'investitore privato' : 'investitori privati'}`)
    return p.join(' e ')
}
function chiEn(societa: number, privati: number): string {
    const p: string[] = []
    if (societa) p.push(`${parolaEn(societa)} ${societa === 1 ? 'company' : 'companies'}`)
    if (privati) p.push(`${parolaEn(privati)} ${privati === 1 ? 'private investor' : 'private investors'}`)
    return p.join(' and ')
}

/**
 * Allinea la pagina /investitori al gestionale: numeri, titolo, frase e lista
 * azionisti. Chiamata dalla tab Investitori a ogni caricamento (quindi dopo
 * ogni salvataggio, versamento, eliminazione o pulsante Autorizza/Riservato).
 * Scrive solo se qualcosa e' cambiato. true = sito aggiornato.
 */
export async function allineaSitoInvestitori(investitori: InvestitorePerSito[]): Promise<boolean> {
    const attivi = investitori.filter(i => i.totale > 0)
    const capitale = attivi.reduce((s, i) => s + i.totale, 0)
    const societa = attivi.filter(i => i.tipo === 'societa').length
    const privati = attivi.length - societa
    const totale = societa + privati
    const euroIt = `${Math.round(capitale).toLocaleString('it-IT')} €`
    const euroEn = `€${Math.round(capitale).toLocaleString('en-US')}`
    const notaIt = [societa ? `${societa} ${societa === 1 ? 'società' : 'società'}` : '', privati ? `${privati} ${privati === 1 ? 'privato' : 'privati'}` : ''].filter(Boolean).join(' · ')
    const notaEn = [societa ? `${societa} ${societa === 1 ? 'company' : 'companies'}` : '', privati ? `${privati} private` : ''].filter(Boolean).join(' · ')
    const verbo = (it: boolean) => (it ? (totale === 1 ? 'ha scelto' : 'hanno scelto') : (totale === 1 ? 'has chosen' : 'have chosen'))

    return aggiornaPagina(pagina => {
        const out = { ...pagina }
        const prima = Array.isArray(pagina.ir_azionisti) ? (pagina.ir_azionisti as SchedaAzionista[]) : []
        out.ir_azionisti = schedeAzionisti(investitori, prima)
        if (Array.isArray(pagina.ir_privati_stat)) {
            out.ir_privati_stat = (pagina.ir_privati_stat as SchedaNumero[]).map(sch => {
                if (sch.id === 'capitale') {
                    // La nota ripeteva l'importo: resta allineata, vuota resta vuota.
                    return { ...sch, valore: euroIt, nota_it: sch.nota_it?.trim() ? euroIt : sch.nota_it, nota_en: sch.nota_en?.trim() ? euroEn : sch.nota_en }
                }
                if (sch.id === 'investitori') return { ...sch, valore: String(totale), nota_it: notaIt, nota_en: notaEn }
                return sch
            })
        }
        if (typeof pagina.ir_privati_titolo_it === 'string' && /^\d+\s+investitor[ei]$/i.test(pagina.ir_privati_titolo_it.trim())) {
            out.ir_privati_titolo_it = `${totale} ${totale === 1 ? 'investitore' : 'investitori'}`
        }
        if (typeof pagina.ir_privati_titolo_en === 'string' && /^\d+\s+investors?$/i.test(pagina.ir_privati_titolo_en.trim())) {
            out.ir_privati_titolo_en = `${totale} ${totale === 1 ? 'investor' : 'investors'}`
        }
        // Solo la parte "chi" della frase: il resto del testo scritto nel CMS resta.
        if (totale > 0 && typeof pagina.ir_privati_testo_it === 'string') {
            out.ir_privati_testo_it = pagina.ir_privati_testo_it.replace(/(Al momento,\s*)(.+?)\s+(?:ha|hanno) scelto/, (_m, a: string) => `${a}${chiIt(societa, privati)} ${verbo(true)}`)
        }
        if (totale > 0 && typeof pagina.ir_privati_testo_en === 'string') {
            out.ir_privati_testo_en = pagina.ir_privati_testo_en.replace(/(At present,\s*)(.+?)\s+(?:has|have) chosen/, (_m, a: string) => `${a}${chiEn(societa, privati)} ${verbo(false)}`)
        }
        return out
    })
}
