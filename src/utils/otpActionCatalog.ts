/**
 * OTP action catalog — single source of truth for every action that CAN be
 * gated by an OTP rule. The GestioneOtpTab "Nuova regola" form picks from
 * this list (no more free text). Each entry is wired in code: when direzione
 * enables a rule for that action_id in system_otp_overrides, the OTP modal
 * fires the next time the button is clicked.
 *
 * Adding a new gate requires:
 *   1. Append to this catalog with a unique stable id
 *   2. Call `requestOverride('action.id', reason)` from the button's handler
 *
 * `wired: true` = the requestOverride call exists in code today; direzione
 * can enable the rule and it will fire immediately. `wired: false` = the
 * row exists in DB but no button calls requestOverride for it (the warning
 * banner in the form covers this case).
 */

export interface OtpAction {
  /** Stable id stored in system_otp_overrides.id and passed to requestOverride() */
  id: string
  /** Human label shown in the dropdown + OTP popup */
  label: string
  /** Description of where the gate triggers — pre-fills used_in */
  used_in: string
  /** Default motivazione shown in the OTP popup — pre-fills reason */
  reason: string
  /** Catalog group for organizing the dropdown */
  group: 'Noleggio' | 'Lavaggio' | 'Fattura' | 'Cliente' | 'Sistema' | 'Patente / Documenti'
  /** True if a requestOverride('id') call exists in code today */
  wired: boolean
}

export const OTP_ACTION_CATALOG: OtpAction[] = [
  // ─── Already wired (work end-to-end as soon as direzione enables) ────
  {
    id: 'prenotazione_noleggio_conferma',
    label: 'Conferma prenotazione noleggio',
    used_in: 'Prenotazioni > Salva con "Conferma" tickato',
    reason: 'Confermare un noleggio richiede autorizzazione direzionale.',
    group: 'Noleggio',
    wired: true,
  },
  {
    id: 'prenotazione_lavaggio_conferma',
    label: 'Conferma prenotazione lavaggio',
    used_in: 'Prime Wash > Conferma prenotazione',
    reason: 'Confermare un lavaggio richiede autorizzazione direzionale.',
    group: 'Lavaggio',
    wired: true,
  },
  {
    id: 'paid_wash_modify',
    label: 'Modifica lavaggio gia pagato',
    used_in: 'Prime Wash > Modifica su prenotazione pagata/confermata',
    reason: 'Modificare un lavaggio gia pagato richiede approvazione direzionale.',
    group: 'Lavaggio',
    wired: true,
  },
  {
    id: 'slot_unavailable',
    label: 'Forza prenotazione su slot occupato',
    used_in: 'Salva prenotazione su slot non disponibile',
    reason: 'Lo slot scelto e occupato: serve autorizzazione per forzare comunque.',
    group: 'Noleggio',
    wired: true,
  },
  {
    id: 'pickup_in_past',
    label: 'Data ritiro nel passato',
    used_in: 'Salva prenotazione con pickup_date < oggi',
    reason: 'La data di ritiro e nel passato: serve autorizzazione direzionale.',
    group: 'Noleggio',
    wired: true,
  },
  {
    id: 'vehicle_year_too_old',
    label: 'Veicolo pre-2020 per cauzione',
    used_in: 'Selezione veicolo con anno < 2020 in modalita cauzione',
    reason: 'Veicolo immatricolato prima del 2020: cauzione richiede approvazione.',
    group: 'Noleggio',
    wired: true,
  },
  {
    id: 'license_expired',
    label: 'Patente scaduta',
    used_in: 'Validazione patente cliente: data scadenza < oggi',
    reason: 'La patente del cliente e scaduta: il noleggio richiede approvazione.',
    group: 'Patente / Documenti',
    wired: true,
  },
  {
    id: 'license_too_recent',
    label: 'Patente meno di 3 anni',
    used_in: 'Validazione patente cliente: rilascio < 3 anni',
    reason: 'Patente con meno di 3 anni: noleggio richiede approvazione.',
    group: 'Patente / Documenti',
    wired: true,
  },
  {
    id: 'manual_category_carwash',
    label: 'Selezione manuale categoria veicolo',
    used_in: 'Prime Wash > Targa non trovata > Seleziona categoria manuale',
    reason: 'Targa non riconosciuta: serve autorizzazione per inserirla manualmente.',
    group: 'Lavaggio',
    wired: true,
  },
  {
    id: 'foreign_plate_carwash',
    label: 'Targa estera al lavaggio',
    used_in: 'Prime Wash > Targa estera selezionata',
    reason: 'Lavaggio con targa estera: richiede autorizzazione direzionale.',
    group: 'Lavaggio',
    wired: true,
  },
  {
    id: 'tier1_no_cauzione',
    label: 'No cauzione per Fascia B',
    used_in: 'Prenotazione Fascia B (TIER_1) con flag No Cauzione',
    reason: 'Fascia B senza cauzione: serve approvazione direzionale.',
    group: 'Noleggio',
    wired: true,
  },
  {
    id: 'no_cauzione_rca_only',
    label: 'No cauzione con sola RCA',
    used_in: 'Prenotazione con assicurazione RCA-only e flag No Cauzione',
    reason: 'Assicurazione RCA-only senza cauzione: approvazione direzionale.',
    group: 'Noleggio',
    wired: true,
  },
  {
    id: 'driver_blocked',
    label: 'Cliente nella lista bloccati',
    used_in: 'Selezione cliente con flag blocked = true',
    reason: 'Cliente bloccato: noleggio richiede approvazione direzionale.',
    group: 'Cliente',
    wired: true,
  },

  // ─── Da cablare (UI dropdown ce le mostra, codice da fare in successivo passo) ───
  {
    id: 'booking.delete',
    label: 'Elimina prenotazione noleggio',
    used_in: 'Prenotazioni > tasto Cancella sulla riga',
    reason: 'Eliminare una prenotazione richiede autorizzazione direzionale.',
    group: 'Noleggio',
    wired: true,
  },
  {
    id: 'booking.mark_paid',
    label: 'Segna prenotazione pagata',
    used_in: 'Prenotazioni / In attesa di pagamento > tasto Segna pagato',
    reason: 'Segnare manualmente una prenotazione come pagata richiede approvazione.',
    group: 'Noleggio',
    wired: false,
  },
  {
    id: 'wash.delete',
    label: 'Elimina prenotazione lavaggio',
    used_in: 'Prime Wash > tasto Elimina sulla riga',
    reason: 'Eliminare un lavaggio richiede autorizzazione direzionale.',
    group: 'Lavaggio',
    wired: false,
  },
  {
    id: 'wash.mark_paid',
    label: 'Segna lavaggio pagato',
    used_in: 'Prime Wash > tasto Segna pagato sulla riga',
    reason: 'Segnare manualmente un lavaggio come pagato richiede approvazione.',
    group: 'Lavaggio',
    wired: false,
  },
  {
    id: 'fattura.delete',
    label: 'Elimina fattura',
    used_in: 'Fattura > tasto Elimina sulla riga',
    reason: 'Eliminare una fattura richiede autorizzazione direzionale.',
    group: 'Fattura',
    wired: false,
  },
  {
    id: 'fattura.send_sdi',
    label: 'Invia fattura a SDI',
    used_in: 'Fattura > tasto Invia SDI',
    reason: "L'invio al SDI e definitivo: richiede approvazione direzionale.",
    group: 'Fattura',
    wired: false,
  },
  {
    id: 'customer.delete',
    label: 'Elimina cliente',
    used_in: 'Clienti > tasto Elimina sulla riga',
    reason: 'Eliminare un cliente richiede approvazione direzionale.',
    group: 'Cliente',
    wired: false,
  },
  {
    id: 'wallet.adjust',
    label: 'Modifica saldo wallet cliente',
    used_in: 'Credit Wallet > Modifica saldo manuale',
    reason: 'Modifica manuale del wallet: richiede approvazione direzionale.',
    group: 'Cliente',
    wired: false,
  },
  {
    id: 'centralina.save',
    label: 'Salvataggio Centralina Pro',
    used_in: 'Centralina Pro > tasto Salva',
    reason: 'Modifica configurazione globale: richiede approvazione direzionale.',
    group: 'Sistema',
    wired: false,
  },
  {
    id: 'vehicle.delete',
    label: 'Elimina veicolo',
    used_in: 'Veicoli > tasto Elimina',
    reason: 'Eliminare un veicolo richiede approvazione direzionale.',
    group: 'Sistema',
    wired: false,
  },
]

export function getOtpAction(id: string): OtpAction | undefined {
  return OTP_ACTION_CATALOG.find(a => a.id === id)
}

export function groupedOtpCatalog(): Record<OtpAction['group'], OtpAction[]> {
  const out: Record<string, OtpAction[]> = {}
  for (const a of OTP_ACTION_CATALOG) {
    if (!out[a.group]) out[a.group] = []
    out[a.group].push(a)
  }
  return out as Record<OtpAction['group'], OtpAction[]>
}
