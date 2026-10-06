/**
 * Nome dell'investitore sul sito (pagina /investitori, blocco "I nostri azionisti").
 *
 * 06/10/2026 (direzione): l'investitore risponde AUTORIZZO o RISERVATO al
 * WhatsApp pro_investitore_autorizzazione_nome; l'admin preme il pulsante
 * corrispondente in Amministrazione > Investitori. "Autorizza" mette la sua
 * scheda in centralina_pro_config.site_copy.investitori.ir_azionisti (la stessa
 * lista che si modifica a mano in Sito > Investitori), "Riservato" o
 * l'eliminazione la tolgono. La scheda ha id `inv-<uuid>`: le schede scritte a
 * mano nel CMS non vengono mai toccate.
 * Sul sito va solo il nome: nessun importo, telefono o codice fiscale.
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
const stessoNome = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** Legge la config, cambia solo ir_azionisti, riscrive (stesso schema di SitoTab.savePersisted). */
async function aggiornaAzionisti(cambia: (lista: SchedaAzionista[]) => SchedaAzionista[]): Promise<void> {
    const { data, error: e1 } = await supabase.from('centralina_pro_config').select('config').eq('id', 'main').maybeSingle()
    if (e1) throw e1
    const config = (data?.config ?? {}) as Record<string, unknown>
    const siteCopy = (config.site_copy ?? {}) as Record<string, unknown>
    const pagina = (siteCopy.investitori ?? {}) as Record<string, unknown>
    const lista = Array.isArray(pagina.ir_azionisti) ? (pagina.ir_azionisti as SchedaAzionista[]) : []
    const cambiata = cambia(lista)
    // Niente da cambiare = niente scrittura sulla config condivisa.
    if (JSON.stringify(cambiata) === JSON.stringify(lista)) return
    const nuova = { ...config, site_copy: { ...siteCopy, investitori: { ...pagina, ir_azionisti: cambiata } } }
    const { error: e2 } = await supabase.from('centralina_pro_config').upsert({ id: 'main', config: nuova })
    if (e2) throw e2
}

export async function pubblicaInvestitoreSulSito(inv: { id: string; nome: string; tipo: 'persona' | 'societa'; anno: number }): Promise<void> {
    const scheda: SchedaAzionista = {
        id: idScheda(inv.id),
        nome: inv.nome.trim(),
        ruolo_it: inv.tipo === 'societa' ? 'Società' : 'Investitore privato',
        ruolo_en: inv.tipo === 'societa' ? 'Company' : 'Private investor',
        da_it: `Azionista dal ${inv.anno}`,
        da_en: `Shareholder since ${inv.anno}`,
        foto: '',
    }
    await aggiornaAzionisti(lista => {
        // Scheda gia' scritta a mano nel CMS con lo stesso nome: e' lui, niente doppione.
        if (lista.some(s => s.id !== scheda.id && !s.riservato && stessoNome(s.nome, scheda.nome))) return lista
        const i = lista.findIndex(s => s.id === scheda.id)
        if (i < 0) return [...lista, scheda]
        // Gia' presente: si aggiorna il nome, foto e testi ritoccati nel CMS restano.
        return lista.map(s => (s.id === scheda.id ? { ...s, nome: scheda.nome } : s))
    })
}

/** Toglie la sua scheda e anche quella scritta a mano con lo stesso nome: riservato vuol dire non comparire. */
export async function togliInvestitoreDalSito(inv: { id: string; nome: string }): Promise<void> {
    await aggiornaAzionisti(lista => lista.filter(s => s.id !== idScheda(inv.id) && !(!s.riservato && stessoNome(s.nome, inv.nome))))
}
