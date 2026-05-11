/**
 * triggerSystemMessageEvent — invia in tempo reale i template Messaggi di
 * Sistema Pro che hanno trigger_event = <event> e offset compatibile con "ora".
 *
 * Usato dai code-path che sanno *quando* avviene un evento (creazione
 * prenotazione, pagamento ricevuto, firma contratto, ecc.) per non aspettare
 * il prossimo giro del cron process-scheduled-system-messages-cron.
 *
 * Dedup: usa la stessa tabella system_message_send_log del cron, quindi
 * niente doppi invii.
 *
 * Esempio:
 *   await triggerSystemMessageEvent({ bookingId, event: 'on_booking' })
 */
import { createClient } from '@supabase/supabase-js'

type TriggerEvent =
    | 'on_booking' | 'on_payment' | 'on_signature' | 'on_extension'
    | 'on_cauzione_created' | 'on_cauzione_collected' | 'on_cauzione_refunded'
    | 'on_cauzione_partial_capture'
    | 'on_first_booking' | 'before_birthday'
    | 'on_doc_uploaded' | 'on_doc_verified'
    | 'on_payment_failed' | 'on_payment_link_expired'
    | 'before_signature' | 'after_signature_review' | 'on_late_return'
    | 'on_review_received' | 'on_promo_gap'

interface TriggerArgs {
    /** ID dell'entità da collegare nel send_log. Se l'evento e' booking-based,
     *  e' il booking_id reale. Per cauzione e' cauzione_id, ecc. */
    bookingId: string
    event: TriggerEvent
    /** Massimo offset_hours da considerare "immediato" (default: 1) */
    maxOffsetHours?: number
    /** Synthetic entity passato direttamente al sender quando l'evento NON
     *  e' booking-based. Se omesso, il sender carica la riga 'bookings'.
     *  Usalo per gli eventi cauzione/documenti/customer-lifecycle. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    syntheticBooking?: Record<string, any>
}

/**
 * Applica i filtri avanzati alla coppia (template, booking).
 * Ritorna true se il template DEVE partire per questa booking, false
 * se va saltato perche' il booking non rispetta uno dei filtri.
 *
 * Filtri (tutti opzionali, default = nessuna restrizione):
 *  - target_service_type: rental | car_wash | mechanical | all
 *  - target_with_deposit: yes | no | all (booking ha cauzione?)
 *  - target_plate: targa esatta del veicolo
 *  - target_payment_method: card | wallet | cash | bonifico | all
 *  - target_amount_min/max: range importo booking in euro
 */
/**
 * Restituisce il giorno della settimana corrente in fuso Europe/Rome
 * (0=Dom, 1=Lun, ..., 6=Sab — convenzione JS).
 */
function romeDayOfWeek(): number {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Rome', weekday: 'short' })
    const wd = fmt.format(new Date())
    return ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<string, number>)[wd] ?? new Date().getDay()
}

/**
 * Ora corrente (0..23) in fuso Europe/Rome.
 */
function romeHour(): number {
    const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Europe/Rome',
        hour: '2-digit',
        hour12: false,
    })
    const h = parseInt(fmt.format(new Date()), 10)
    return isNaN(h) ? new Date().getHours() : h % 24
}

/**
 * True se l'ora corrente Roma e' dentro la fascia silenziosa [start, end).
 * Se start>end la fascia attraversa la mezzanotte (es. 22-7 = 22:00-06:59).
 */
function isInQuietHours(start: number | null | undefined, end: number | null | undefined): boolean {
    if (start == null || end == null) return false
    if (start === end) return false // fascia di 0 ore = mai silenziosa
    const h = romeHour()
    if (start < end) return h >= start && h < end
    // Wrap-around mezzanotte
    return h >= start || h < end
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function matchesAdvancedFilters(tpl: any, booking: any): boolean {
    // Day-of-week: se l'admin ha disabilitato il giorno corrente (Roma),
    // skippa l'invio. Default '0,1,2,3,4,5,6' = sempre attivo.
    const dowCsv = String(tpl.target_days_of_week ?? '0,1,2,3,4,5,6')
    if (dowCsv) {
        const allowed = new Set(dowCsv.split(',').map((s: string) => parseInt(s.trim(), 10)).filter((n: number) => !isNaN(n)))
        if (allowed.size > 0 && !allowed.has(romeDayOfWeek())) return false
    }

    // Quiet hours: se siamo in fascia silenziosa configurata dall'admin, skip.
    // Es. start=22, end=7 → niente invii dalle 22:00 alle 06:59 Roma.
    if (isInQuietHours(tpl.quiet_hours_start, tpl.quiet_hours_end)) return false

    // Service type — solo 2 categorie reali nel sistema:
    //   rental     = car rental (service_type vuoto / 'rental' / 'car_rental')
    //   prime_wash = lavaggio + meccanica (service_type 'car_wash' /
    //                'mechanical' / 'mechanical_service')
    const tplSvc = String(tpl.target_service_type || 'all').toLowerCase()
    if (tplSvc !== 'all') {
        const bSvc = String(booking.service_type || 'rental').toLowerCase()
        const bookingIsRental = !booking.service_type || bSvc === 'rental' || bSvc === 'car_rental'
        const bookingIsPrimeWash = bSvc === 'car_wash' || bSvc === 'mechanical' || bSvc === 'mechanical_service'
        if (tplSvc === 'rental' && !bookingIsRental) return false
        if (tplSvc === 'prime_wash' && !bookingIsPrimeWash) return false
        // Retrocompatibilita': accetta anche le vecchie etichette se gia' configurate
        if (tplSvc === 'car_wash' && bSvc !== 'car_wash') return false
        if (tplSvc === 'mechanical' && bSvc !== 'mechanical' && bSvc !== 'mechanical_service') return false
    }

    // Cauzione — 4 opzioni:
    //   all     → tutte le prenotazioni (no filtro)
    //   yes     → con qualsiasi tipo di cauzione (standard o veicolo)
    //   no      → solo senza cauzione di nessun tipo
    //   vehicle → solo con la cauzione veicolo extra
    //             (extras.cauzione_veicoli_total > 0)
    const tplDep = String(tpl.target_with_deposit || 'all').toLowerCase()
    if (tplDep !== 'all') {
        const depAmount = Number(booking.deposit_amount ?? booking.booking_details?.deposit ?? 0)
        const depOption = booking.booking_details?.depositOption
        const standardDeposit = depAmount > 0 && depOption !== 'no_deposit'
        const cauzioneVeicoli = Number(
            booking.booking_details?.extras?.cauzione_veicoli_total
            ?? booking.booking_details?.cauzione_veicoli_total
            ?? booking.extras?.cauzione_veicoli_total
            ?? 0
        )
        const hasAnyDeposit = standardDeposit || cauzioneVeicoli > 0
        const hasVehicleDeposit = cauzioneVeicoli > 0
        if (tplDep === 'yes' && !hasAnyDeposit) return false
        if (tplDep === 'no' && hasAnyDeposit) return false
        if (tplDep === 'vehicle' && !hasVehicleDeposit) return false
        // Retrocompatibilita': vecchi valori 'standard' o altri non gestiti
        if (tplDep === 'standard' && !standardDeposit) return false
    }

    // Plate
    if (tpl.target_plate && typeof tpl.target_plate === 'string') {
        const want = tpl.target_plate.toUpperCase().replace(/\s/g, '')
        const have = String(booking.vehicle_plate || booking.plate || '').toUpperCase().replace(/\s/g, '')
        if (want && have !== want) return false
    }

    // Payment method
    const tplPM = String(tpl.target_payment_method || 'all').toLowerCase()
    if (tplPM !== 'all') {
        const m = String(booking.payment_method || '').toLowerCase()
        const isCard = m.includes('card') || m.includes('carta') || m.includes('nexi') || m.includes('stripe') || m.includes('bancomat') || m.includes('pos') || m.includes('debit')
        const isWallet = m === 'credit' || m.includes('wallet') || m.includes('credit_wallet')
        const isCash = m.includes('contanti') || m.includes('cash')
        const isBonifico = m.includes('bonifico') || m.includes('wire') || m.includes('bank')
        if (tplPM === 'card' && !isCard) return false
        if (tplPM === 'wallet' && !isWallet) return false
        if (tplPM === 'cash' && !isCash) return false
        if (tplPM === 'bonifico' && !isBonifico) return false
    }

    // Amount range (booking.price_total e' in cents in alcuni schemi,
    // booking.total_amount in euro in altri — proviamo entrambi).
    const min = tpl.target_amount_min == null ? null : Number(tpl.target_amount_min)
    const max = tpl.target_amount_max == null ? null : Number(tpl.target_amount_max)
    if (min != null || max != null) {
        let amountEur = 0
        if (typeof booking.total_amount === 'number') amountEur = booking.total_amount
        else if (typeof booking.price_total === 'number') amountEur = booking.price_total / 100
        if (min != null && amountEur < min) return false
        if (max != null && amountEur > max) return false
    }

    // Vehicle fuel (booking-side, sync)
    const fuel = String(tpl.target_vehicle_fuel || 'all').toLowerCase().trim()
    if (fuel && fuel !== 'all') {
        const v = booking.booking_details?.vehicle ?? {}
        const vehFuel = String(
            booking.vehicle_fuel
            ?? booking.fuel
            ?? v.fuel
            ?? v.carburante
            ?? booking.booking_details?.vehicle_fuel
            ?? ''
        ).toLowerCase().trim()
        if (!vehFuel) return false
        // Aliases per essere robusto
        const aliases: Record<string, string[]> = {
            petrol: ['petrol', 'benzina', 'gasoline', 'gas'],
            diesel: ['diesel', 'gasolio'],
            electric: ['electric', 'elettrico', 'ev', 'bev'],
            hybrid: ['hybrid', 'ibrido', 'hev', 'phev', 'plugin'],
        }
        const wanted = aliases[fuel] ?? [fuel]
        if (!wanted.some((w: string) => vehFuel.includes(w))) return false
    }

    // Vehicle transmission (booking-side, sync)
    const trans = String(tpl.target_vehicle_transmission || 'all').toLowerCase().trim()
    if (trans && trans !== 'all') {
        const v = booking.booking_details?.vehicle ?? {}
        const vehTrans = String(
            booking.vehicle_transmission
            ?? booking.transmission
            ?? v.transmission
            ?? v.cambio
            ?? ''
        ).toLowerCase().trim()
        if (!vehTrans) return false
        const isManual = vehTrans.includes('manual') || vehTrans.includes('manuale') || vehTrans.includes('mt')
        const isAuto = vehTrans.includes('auto') || vehTrans.includes('cvt') || vehTrans.includes('dsg') || vehTrans.includes('at') || vehTrans.includes('dct')
        if (trans === 'manual' && !isManual) return false
        if (trans === 'automatic' && !isAuto) return false
    }

    // Fascia oraria pickup (Europe/Rome). Si basa su pickup_date.
    // Per car wash / mechanical: si basa su appointment_date.
    const phMin = tpl.target_pickup_hour_min == null ? null : Number(tpl.target_pickup_hour_min)
    const phMax = tpl.target_pickup_hour_max == null ? null : Number(tpl.target_pickup_hour_max)
    if (phMin != null || phMax != null) {
        const isRental = !booking.service_type || booking.service_type === 'rental' || booking.service_type === 'car_rental'
        const tStr = isRental ? booking.pickup_date : booking.appointment_date
        if (tStr) {
            const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Rome', hour: '2-digit', hour12: false })
            const h = parseInt(fmt.format(new Date(tStr)), 10) % 24
            if (!isNaN(h)) {
                if (phMin != null && h < phMin) return false
                if (phMax != null && h > phMax) return false
            }
        }
    }

    // Rental duration in giorni (sync — calcolata da pickup/dropoff).
    // Vale solo per noleggi; per car wash / mechanical i campi pickup/dropoff
    // possono essere vuoti, in tal caso il filtro NON viene applicato.
    const durMin = tpl.target_rental_duration_min == null ? null : Number(tpl.target_rental_duration_min)
    const durMax = tpl.target_rental_duration_max == null ? null : Number(tpl.target_rental_duration_max)
    if (durMin != null || durMax != null) {
        const pickup = booking.pickup_date ? new Date(booking.pickup_date).getTime() : null
        const dropoff = booking.dropoff_date ? new Date(booking.dropoff_date).getTime() : null
        if (pickup && dropoff && dropoff > pickup) {
            const days = Math.ceil((dropoff - pickup) / (24 * 3600 * 1000))
            if (durMin != null && days < durMin) return false
            if (durMax != null && days > durMax) return false
        }
        // se non e' un noleggio, il filtro durata non si applica (ignorato)
    }

    return true
}

/**
 * Filtri che richiedono una query async sul cliente. Eseguito dopo il sync
 * matchesAdvancedFilters nel cron e nel trigger inline. Ritorna true se il
 * template DEVE partire per questo (booking, customer), false se va saltato.
 *
 * Filtri:
 *  - target_membership_tier — confronta case-insensitive con
 *    customer.membership_tier oppure active_membership.package_name.
 *  - target_min_prev_bookings — conta le prenotazioni precedenti del cliente
 *    (escludendo quella corrente) e confronta col valore minimo.
 *  - target_customer_tags — CSV; match se ALMENO un tag e' presente nei
 *    tag del cliente (customers_extended.tags array o CSV).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function passesCustomerFilters(tpl: any, booking: any, supabase: any): Promise<boolean> {
    const tier = tpl.target_membership_tier ? String(tpl.target_membership_tier).toLowerCase().trim() : null
    const minPrev = tpl.target_min_prev_bookings == null ? null : Number(tpl.target_min_prev_bookings)
    const maxPrev = tpl.target_max_prev_bookings == null ? null : Number(tpl.target_max_prev_bookings)
    const tagsCsv = tpl.target_customer_tags ? String(tpl.target_customer_tags) : null
    const residency = tpl.target_residency ? String(tpl.target_residency).toLowerCase().trim() : null
    const ageMin = tpl.target_age_min == null ? null : Number(tpl.target_age_min)
    const ageMax = tpl.target_age_max == null ? null : Number(tpl.target_age_max)
    const sourceCh = tpl.target_source_channel ? String(tpl.target_source_channel).toLowerCase().trim() : null
    const provinceCsv = tpl.target_province ? String(tpl.target_province) : null
    const minLtv = tpl.target_min_lifetime_value == null ? null : Number(tpl.target_min_lifetime_value)
    const hasUnpaid: boolean | null = tpl.target_has_unpaid_invoices == null ? null : !!tpl.target_has_unpaid_invoices
    const usedPromo: boolean | null = tpl.target_used_promo_before == null ? null : !!tpl.target_used_promo_before
    const extMin = tpl.target_extension_count_min == null ? null : Number(tpl.target_extension_count_min)
    const extMax = tpl.target_extension_count_max == null ? null : Number(tpl.target_extension_count_max)

    // Se NESSUN filtro customer-dependent e' attivo, esci subito.
    const allDisabled = (!tier || tier === 'all')
        && (minPrev == null || isNaN(minPrev))
        && (maxPrev == null || isNaN(maxPrev))
        && (!tagsCsv || !tagsCsv.trim())
        && (!residency || residency === 'all')
        && (ageMin == null || isNaN(ageMin))
        && (ageMax == null || isNaN(ageMax))
        && (!sourceCh || sourceCh === 'all')
        && (!provinceCsv || !provinceCsv.trim())
        && (minLtv == null || isNaN(minLtv))
        && hasUnpaid == null
        && usedPromo == null
        && (extMin == null || isNaN(extMin))
        && (extMax == null || isNaN(extMax))
    if (allDisabled) return true

    // Carica il cliente. Match per id, email, phone (in quest'ordine).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let customer: any = null
    const cid = booking.customer_id || booking.user_id
    if (cid) {
        const { data } = await supabase.from('customers_extended').select('*').eq('id', cid).maybeSingle()
        customer = data
    }
    if (!customer && booking.customer_email) {
        const { data } = await supabase.from('customers_extended').select('*').eq('email', booking.customer_email).maybeSingle()
        customer = data
    }
    if (!customer && booking.customer_phone) {
        const { data } = await supabase.from('customers_extended').select('*').eq('telefono', booking.customer_phone).maybeSingle()
        customer = data
    }

    // Tier — confronta con i tier definiti in centralina_pro_config.config.dr7_club.tiers.
    // L'admin seleziona dal dropdown il tier.id (es. "signature") oppure "free".
    // Il cliente puo' avere il tier salvato come id o label (case-insensitive).
    if (tier && tier !== 'all') {
        const cTier = String(
            customer?.membership_tier
            ?? customer?.tier
            ?? customer?.dr7_club_tier
            ?? customer?.active_membership?.tier_id
            ?? customer?.active_membership?.package_name
            ?? booking?.active_membership?.tier_id
            ?? booking?.active_membership?.package_name
            ?? ''
        ).toLowerCase().trim()
        if (tier === 'free') {
            // "Senza membership" = nessun tier o stringa vuota
            if (cTier && cTier !== 'free' && cTier !== 'none') return false
        } else {
            if (!cTier || cTier !== tier) return false
        }
    }

    // Tag — match se almeno UNO dei tag richiesti e' nei tag del cliente
    if (tagsCsv && tagsCsv.trim()) {
        const wanted = tagsCsv.split(',').map((s: string) => s.trim().toLowerCase()).filter(Boolean)
        if (wanted.length > 0) {
            // tags puo' essere array Postgres, CSV string, o JSONB array
            const raw = customer?.tags ?? customer?.customer_tags ?? []
            let actual: string[] = []
            if (Array.isArray(raw)) actual = raw.map((t: unknown) => String(t).toLowerCase().trim())
            else if (typeof raw === 'string') actual = raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
            const intersect = wanted.some((w: string) => actual.includes(w))
            if (!intersect) return false
        }
    }

    // Residenza secondo la definizione canonica DR7:
    //   resident = provincia di residenza in {CA (Cagliari), SU (Sud Sardegna)}.
    // Mirror esatto di src/data/sardegnaProvince.ts RESIDENT_PROVINCE_CODES
    // e di Centralina Pro (tariffe / depositi residente vs non_residente).
    // Province sarde NON residenti per DR7: SS (Sassari), NU (Nuoro), OR (Oristano).
    if (residency && residency !== 'all') {
        const RESIDENT_PROVINCE_CODES = new Set(['CA', 'SU'])
        const cProv = String(customer?.provincia_residenza ?? customer?.provincia ?? customer?.province ?? '').toUpperCase().trim()
        const isDr7Resident = RESIDENT_PROVINCE_CODES.has(cProv)
        if (residency === 'resident' && !isDr7Resident) return false
        if (residency === 'non_resident' && isDr7Resident) return false
    }

    // Eta' cliente — calcolata da data_nascita (Date di nascita)
    if ((ageMin != null && !isNaN(ageMin)) || (ageMax != null && !isNaN(ageMax))) {
        const dob = customer?.data_nascita ?? customer?.birth_date ?? customer?.dob
        if (!dob) return false
        const dobMs = new Date(dob).getTime()
        if (isNaN(dobMs)) return false
        const ageYears = Math.floor((Date.now() - dobMs) / (365.25 * 24 * 3600 * 1000))
        if (ageMin != null && !isNaN(ageMin) && ageYears < ageMin) return false
        if (ageMax != null && !isNaN(ageMax) && ageYears > ageMax) return false
    }

    // Source channel
    if (sourceCh && sourceCh !== 'all') {
        const cSrc = String(customer?.source ?? customer?.source_channel ?? customer?.channel ?? '').toLowerCase().trim()
        if (!cSrc || cSrc !== sourceCh) return false
    }

    // Provincia (CSV — match se almeno UNA provincia in lista)
    if (provinceCsv && provinceCsv.trim()) {
        const wanted = provinceCsv.split(',').map((s: string) => s.trim().toUpperCase()).filter(Boolean)
        if (wanted.length > 0) {
            const cProv = String(customer?.provincia_residenza ?? customer?.provincia ?? customer?.province ?? '').toUpperCase().trim()
            if (!cProv || !wanted.includes(cProv)) return false
        }
    }

    // Min/Max previous bookings — count escluse cancelled e quella corrente
    if ((minPrev != null && !isNaN(minPrev) && minPrev > 0) || (maxPrev != null && !isNaN(maxPrev))) {
        const email = booking.customer_email || customer?.email
        if (!email) return false
        const { count } = await supabase
            .from('bookings')
            .select('id', { count: 'exact', head: true })
            .eq('customer_email', email)
            .neq('id', booking.id)
            .not('status', 'in', '(cancelled,annullata)')
        const c = count ?? 0
        if (minPrev != null && !isNaN(minPrev) && c < minPrev) return false
        if (maxPrev != null && !isNaN(maxPrev) && c > maxPrev) return false
    }

    // LTV: somma del totale storicamente speso dal cliente (escluse cancelled).
    if (minLtv != null && !isNaN(minLtv) && minLtv > 0) {
        const email = booking.customer_email || customer?.email
        if (!email) return false
        const { data: paid } = await supabase
            .from('bookings')
            .select('total_amount, price_total')
            .eq('customer_email', email)
            .not('status', 'in', '(cancelled,annullata)')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ltv = (paid || []).reduce((sum: number, b: any) => {
            const a = typeof b.total_amount === 'number' ? b.total_amount : (typeof b.price_total === 'number' ? b.price_total / 100 : 0)
            return sum + a
        }, 0)
        if (ltv < minLtv) return false
    }

    // Fatture insolute (booking con payment_status pending/unpaid e dropoff passato)
    if (hasUnpaid != null) {
        const email = booking.customer_email || customer?.email
        if (!email) return false
        const { count } = await supabase
            .from('bookings')
            .select('id', { count: 'exact', head: true })
            .eq('customer_email', email)
            .in('payment_status', ['pending', 'unpaid', 'failed'])
            .lt('dropoff_date', new Date().toISOString())
        const has = (count ?? 0) > 0
        if (hasUnpaid === true && !has) return false
        if (hasUnpaid === false && has) return false
    }

    // Ha gia' usato un codice promo
    if (usedPromo != null) {
        const email = booking.customer_email || customer?.email
        if (!email) return false
        const { count } = await supabase
            .from('bookings')
            .select('id', { count: 'exact', head: true })
            .eq('customer_email', email)
            .neq('id', booking.id)
            .not('promo_code', 'is', null)
        const used = (count ?? 0) > 0
        if (usedPromo === true && !used) return false
        if (usedPromo === false && used) return false
    }

    // Numero di estensioni storiche del cliente (somma di extension_history.length)
    if ((extMin != null && !isNaN(extMin)) || (extMax != null && !isNaN(extMax))) {
        const email = booking.customer_email || customer?.email
        if (!email) return false
        const { data: bks } = await supabase
            .from('bookings')
            .select('booking_details')
            .eq('customer_email', email)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const totExt = (bks || []).reduce((sum: number, b: any) => {
            const arr = b.booking_details?.extension_history
            return sum + (Array.isArray(arr) ? arr.length : 0)
        }, 0)
        if (extMin != null && !isNaN(extMin) && totExt < extMin) return false
        if (extMax != null && !isNaN(extMax) && totExt > extMax) return false
    }

    return true
}

export async function triggerSystemMessageEvent({ bookingId, event, maxOffsetHours = 1, syntheticBooking }: TriggerArgs): Promise<{ sent: number; skipped: number; errors: number }> {
    const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const baseUrl = process.env.URL || 'https://admin.dr7empire.com'

    // 1. Carica la booking — oppure usa il syntheticBooking passato dal caller
    //    (per eventi cauzione/documenti/customer dove non c'e' una vera booking).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let booking: any = null
    if (syntheticBooking) {
        booking = syntheticBooking
    } else {
        const { data } = await supabase
            .from('bookings')
            .select('*')
            .eq('id', bookingId)
            .maybeSingle()
        booking = data
    }
    if (!booking) return { sent: 0, skipped: 0, errors: 0 }

    // 2. Carica i template attivi per questo evento, con offset basso (<= 1h
    //    di default). Templates con offset alto (es. 24h prima del pickup)
    //    saranno gestiti dal cron, non qui.
    const { data: templates } = await supabase
        .from('system_messages')
        .select('id, message_key, label, trigger_offset_hours, target_status, target_category, target_service_type, target_with_deposit, target_plate, target_payment_method, target_amount_min, target_amount_max, target_days_of_week, quiet_hours_start, quiet_hours_end, target_membership_tier, target_min_prev_bookings, target_max_prev_bookings, target_rental_duration_min, target_rental_duration_max, target_customer_tags, target_residency, target_age_min, target_age_max, target_vehicle_fuel, target_vehicle_transmission, target_pickup_hour_min, target_pickup_hour_max, target_source_channel, target_province, target_min_lifetime_value, target_has_unpaid_invoices, target_used_promo_before, target_extension_count_min, target_extension_count_max')
        .eq('is_automatic', true)
        .eq('is_enabled', true)
        .eq('trigger_event', event)
        .lte('trigger_offset_hours', maxOffsetHours)
    if (!templates?.length) return { sent: 0, skipped: 0, errors: 0 }

    let sent = 0, skipped = 0, errors = 0

    for (const tpl of templates) {
        if (!matchesAdvancedFilters(tpl, booking)) continue
        if (!await passesCustomerFilters(tpl, booking, supabase)) continue

        // 3. Filtri: status + categoria
        const statuses = (tpl.target_status || 'confirmed,active').split(',').map((s: string) => s.trim()).filter(Boolean)
        if (statuses.length > 0 && !statuses.includes(booking.status)) continue

        if (tpl.target_category && tpl.target_category !== 'all') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const cat = (booking as any).vehicle_category
                || booking.booking_details?.vehicle?.category
                || booking.booking_details?.vehicleCategory
                || ''
            if (String(cat).toLowerCase() !== String(tpl.target_category).toLowerCase()) continue
        }

        // 4. Dedup: gia' inviato?
        const { data: existing } = await supabase
            .from('system_message_send_log')
            .select('id')
            .eq('system_message_id', tpl.id)
            .eq('booking_id', booking.id)
            .maybeSingle()
        if (existing?.id) { skipped++; continue }

        // 5. Invia via send-whatsapp-notification
        try {
            const res = await fetch(`${baseUrl}/.netlify/functions/send-whatsapp-notification`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ booking, messageKey: tpl.message_key }),
            })
            const ok = res.ok
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let resp: any = null
            try { resp = await res.json() } catch { /* ignore */ }

            await supabase.from('system_message_send_log').insert({
                system_message_id: tpl.id,
                booking_id: booking.id,
                customer_phone: booking.customer_phone,
                status: ok ? (resp?.skipped ? 'skipped' : 'sent') : 'error',
                error: ok ? null : `HTTP ${res.status}`,
            })

            if (ok) {
                if (resp?.skipped) skipped++
                else sent++
            } else {
                errors++
            }
        } catch (e: unknown) {
            errors++
            const msg = e instanceof Error ? e.message : String(e)
            try {
                await supabase.from('system_message_send_log').insert({
                    system_message_id: tpl.id,
                    booking_id: booking.id,
                    customer_phone: booking.customer_phone,
                    status: 'error',
                    error: msg.slice(0, 500),
                })
            } catch { /* dedup race ok */ }
        }
    }

    return { sent, skipped, errors }
}
