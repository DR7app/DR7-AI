/**
 * indirizzoCliente — composizione UNICA dell'indirizzo cliente per la fattura.
 *
 * Perche' esiste (28/08/2026): ogni punto che crea una fattura si costruiva
 * l'indirizzo per conto suo. Il percorso delle ricariche wallet faceva
 * `[via, cap, citta, provincia].filter(Boolean).join(' ')`: su un cliente che
 * ha compilato SOLO la provincia il risultato era la stringa "CA", che sembra
 * un indirizzo ma non lo e'. La fattura restava bloccata con
 * "il CAP non ricavabile da CA".
 *
 * Regole:
 *  - senza via non si scrive NIENTE: meglio "indirizzo mancante" (che dice
 *    all'admin cosa fare) di un frammento che finge di essere un indirizzo;
 *  - formato unico "Via Roma 12, 09100 Cagliari (CA)", quello che il
 *    generatore XML sa leggere;
 *  - AZIENDA: sempre la sede legale, mai i campi della persona fisica
 *    (regola del 20/06/2026). Se manca la sede legale si ripiega
 *    sull'anagrafica, altrimenti quel cliente non avrebbe fattura.
 */

type Riga = Record<string, any> | null | undefined

const s = (v: any) => String(v ?? '').trim()

export function componiIndirizzo(parti: {
    via?: string
    civico?: string
    cap?: string
    citta?: string
    provincia?: string
}): string {
    const via = s(parti.via)
    if (!via) return '' // senza via non e' un indirizzo: non inventarne uno

    const civico = s(parti.civico)
    const cap = s(parti.cap)
    const citta = s(parti.citta)
    const provincia = s(parti.provincia).toUpperCase()

    const pezzi: string[] = [civico ? `${via} ${civico}` : via]

    let riga2 = ''
    if (cap) riga2 += cap
    if (citta) riga2 += (riga2 ? ' ' : '') + citta
    if (provincia && /^[A-Z]{2}$/.test(provincia)) riga2 += (riga2 ? ' ' : '') + `(${provincia})`
    if (riga2) pezzi.push(riga2)

    return pezzi.join(', ')
}

/**
 * Indirizzo di fatturazione a partire dal record `customers_extended`
 * (con eventuale fallback su una riga secondaria: booking_details.customer,
 * purchase della ricarica, ...).
 */
export function indirizzoFatturaCliente(cliente: Riga, fallback: Riga = null): string {
    const c = cliente || {}
    const f = fallback || {}

    const isAzienda = s(c.tipo_cliente) === 'azienda'
    const sedeAzienda = isAzienda ? (s(c.sede_legale) || s(c.sede_operativa)) : ''
    // Con la sede legale presente vince lei e NON si mescolano i campi
    // personali: sono del rappresentante, non dell'azienda.
    const usaAnagrafica = !isAzienda || !sedeAzienda

    const via = isAzienda
        ? (sedeAzienda || s(c.indirizzo) || s(c.indirizzo_azienda) || s(f.indirizzo) || s(f.address))
        : (s(c.indirizzo) || s(c.sede_legale) || s(c.address) || s(f.indirizzo) || s(f.address) || s(f.street))

    if (!usaAnagrafica) return componiIndirizzo({ via })

    return componiIndirizzo({
        via,
        civico: s(c.numero_civico) || s(f.numeroCivico) || s(f.numero_civico) || s(f.streetNumber),
        cap: s(c.codice_postale) || s(c.cap) || s(f.codicePostale) || s(f.cap) || s(f.zip),
        citta: s(c.citta_residenza) || s(c.citta) || s(f.cittaResidenza) || s(f.citta) || s(f.city),
        provincia: s(c.provincia_residenza) || s(c.provincia) || s(f.provinciaResidenza) || s(f.provincia),
    })
}

/**
 * Un indirizzo e' utilizzabile per la fattura elettronica solo se il
 * generatore XML sa ricavarne via + CAP + comune (stessa regola di
 * parseAddress in xml-utils.ts).
 */
export function indirizzoUtilizzabile(indirizzo: string): boolean {
    const raw = s(indirizzo).replace(/\s+/g, ' ')
    if (!raw) return false
    const cap = raw.match(/\b(\d{5})\b/)
    if (!cap || cap.index === undefined) return false
    const via = raw.slice(0, cap.index).replace(/[,;\s]+$/, '').trim()
    if (!via) return false
    let resto = raw.slice(cap.index + 5).replace(/^[,;\s]+/, '').trim()
    resto = resto.replace(/\(\s*[A-Za-z]{2}\s*\)/, ' ').replace(/[\s,]([A-Za-z]{2})\s*$/, ' ')
    return !!resto.replace(/[,;]/g, ' ').trim()
}

/**
 * Ricerca "intelligente" dell'indirizzo quando quello sul cliente non basta.
 *
 * Perche' (28/08/2026): un indirizzo incompleto blocca la fattura, ma quasi
 * sempre il dato buono esiste gia' da qualche parte — su una fattura dello
 * stesso cliente gia' ACCETTATA dal SDI, su un doppione dell'anagrafica, o
 * nei dati raccolti al momento della prenotazione. Prima di fermare tutto,
 * si guarda li'. Nessuna invenzione: si riusa solo un indirizzo reale, gia'
 * scritto per quello stesso cliente (stesso CF/P.IVA, o stessa email).
 *
 * Ritorna null se non c'e' niente di utilizzabile: in quel caso la fattura
 * resta bloccata col motivo, che e' l'unica risposta onesta.
 */
export async function cercaIndirizzoAltrove(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: any,
    chiavi: { invoiceId?: string; codiceFiscale?: string; partitaIva?: string; email?: string },
    bookingCustomer: Riga = null,
): Promise<{ indirizzo: string; fonte: string } | null> {
    const cf = s(chiavi.codiceFiscale).toUpperCase()
    const piva = s(chiavi.partitaIva).toUpperCase()
    const email = s(chiavi.email).toLowerCase()

    // 1) Altre fatture dello stesso cliente, le gia' trasmesse per prime:
    //    quell'indirizzo il SDI l'ha gia' digerito.
    const filtri: string[] = []
    if (cf) filtri.push(`customer_tax_code.eq.${cf}`)
    if (piva) filtri.push(`customer_vat.eq.${piva}`)
    if (email) filtri.push(`customer_email.eq.${email}`)
    if (filtri.length > 0) {
        const { data: altre } = await supabase
            .from('fatture')
            .select('id, customer_address, sdi_status, data_emissione')
            .or(filtri.join(','))
            .not('customer_address', 'is', null)
            .order('data_emissione', { ascending: false })
            .limit(50)
        const righe = (altre || []).filter((r: any) => r.id !== chiavi.invoiceId && indirizzoUtilizzabile(r.customer_address))
        const trasmesse = righe.filter((r: any) => ['accepted', 'sent', 'sending'].includes(String(r.sdi_status || '')))
        const scelta = trasmesse[0] || righe[0]
        if (scelta) {
            return {
                indirizzo: s(scelta.customer_address),
                fonte: trasmesse[0] ? 'fattura precedente accettata dal SDI' : 'fattura precedente dello stesso cliente',
            }
        }
    }

    // 2) Doppioni in anagrafica: spesso il record con l'indirizzo completo
    //    non e' quello agganciato alla prenotazione.
    if (cf || piva || email) {
        const filtriCli: string[] = []
        if (cf) filtriCli.push(`codice_fiscale.eq.${cf}`)
        if (piva) filtriCli.push(`partita_iva.eq.${piva}`)
        if (email) filtriCli.push(`email.eq.${email}`)
        const { data: clienti } = await supabase
            .from('customers_extended')
            .select('tipo_cliente, sede_legale, sede_operativa, indirizzo, indirizzo_azienda, numero_civico, codice_postale, cap, citta, citta_residenza, provincia, provincia_residenza')
            .or(filtriCli.join(','))
            .limit(20)
        for (const c of clienti || []) {
            const candidato = indirizzoFatturaCliente(c)
            if (indirizzoUtilizzabile(candidato)) {
                return { indirizzo: candidato, fonte: 'altra scheda cliente con gli stessi dati fiscali' }
            }
        }
    }

    // 3) Dati raccolti al momento della prenotazione.
    if (bookingCustomer) {
        const candidato = indirizzoFatturaCliente(null, bookingCustomer)
        if (indirizzoUtilizzabile(candidato)) {
            return { indirizzo: candidato, fonte: 'dati della prenotazione' }
        }
    }

    return null
}
