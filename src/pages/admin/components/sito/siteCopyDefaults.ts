/**
 * siteCopyDefaults.ts — GENERATO AUTOMATICAMENTE. NON MODIFICARE A MANO.
 *
 * Sorgente: Sito/utils/siteCopy.ts (repo del sito live dr7.app).
 * Rigenera con:  node scripts/genSiteCopyDefaults.mjs
 * Verifica con:  node scripts/genSiteCopyDefaults.mjs --check
 *
 * Ogni `DEFAULT_X` del sito diventa `INITIAL_X` qui: cosi' l'onglet Sito
 * parte esattamente dai testi che dr7.app mostra quando non c'e' override
 * salvato in centralina_pro_config. Modificare questi valori a mano fa
 * ricomparire il disallineamento che questo file esiste per eliminare.
 *
 * Sezioni generate: 36 — interfacce: 73
 */

// ─── Schemas ────────────────────────────────────────────────────────────────
export interface FaqEntry {
  id: string;
  question: string;
  answer: string;
}

/**
 * Full FAQ page copy. Page title + eyebrow + subtitle live alongside
 * the entries so the operator can re-brand the /faq page from admin.
 */
export interface FaqCopy {
  eyebrow_it: string;
  eyebrow_en: string;
  page_title_it: string;
  page_title_en: string;
  subtitle_it: string;
  subtitle_en: string;
  entries: FaqEntry[];
}

/**
 * Selezione delle categorie veicolo visibili sul sito (admin > Sito > Flotta).
 *
 * `mode` rende esplicita l'intenzione dell'operatore, cosa che la sola lista
 * non poteva fare: un array vuoto significava insieme "mai configurato" e
 * "non mostrare nulla". Campo opzionale e additivo — le righe salvate prima
 * della sua introduzione non ce l'hanno e restano valide.
 *
 *   assente   riga vecchia: lista piena = whitelist, lista vuota = tutte
 *   'all'     mostra tutte le categorie del catalogo
 *   'custom'  mostra esattamente `visible_category_ids`, vuoto compreso
 *
 * La regola completa (e il fail-safe sugli errori) sta in utils/flottaConfig.ts.
 */
export interface FlottaCopy {
  mode?: 'all' | 'custom';
  visible_category_ids: string[];
}

export interface SiteCopySnapshot {
  flotta?: FlottaCopy;
  // Stored as either the new FaqCopy object or — for back-compat with the
  // first migration — a raw FaqEntry[]. The getter normalizes both shapes.
  faq?: FaqCopy | FaqEntry[];
  cancellazione?: CancellazioneCopy;
  membership?: MembershipCopy;
  home?: HomeCopy;
  about?: AboutCopy;
  footer?: FooterCopy;
  legal?: LegalCopy;
  careers?: CareersCopy;
  press?: PressCopy;
  contact?: ContactCopy;
  mechanical?: MechanicalCopy;
  carwash?: CarWashCopy;
  investitori?: InvestitoriCopy;
  franchising?: FranchisingCopy;
  aviationQuote?: AviationQuoteCopy;
  checkEmail?: CheckEmailCopy;
  jetSearchResults?: JetSearchResultsCopy;
  confirmationSuccess?: ConfirmationSuccessCopy;
  header?: HeaderCopy;
  signUp?: SignUpCopy;
  payment?: PaymentCopy;
  paymentSuccess?: PaymentSuccessCopy;
  booking?: BookingCopy;
  creditWallet?: CreditWalletCopy;
  token?: TokenCopy;
  firma?: FirmaCopy;
  registrazioneCliente?: RegistrazioneClienteCopy;
  bookingSearchBox?: BookingSearchBoxCopy;
  paymentCancel?: PaymentCancelCopy;
  locations?: LocationsCopy;
  aviationMarine?: AviationMarineCopy;
  dr7ClubPlan?: Dr7ClubPlanCopy;
  aspetto?: AspettoCopy;
}

// ─── Cancellazione ──────────────────────────────────────────────────────────
//
// Page schema: admin can edit page title, every section heading, every
// paragraph + bullet item, and the footer (contact, address, last-updated
// date). Placeholders (`{thresholdDays}` / `{refundPercent}` /
// `{penaltyPercent}` / `{daysWord}`) are kept as raw text in the DB and
// resolved by `applyCancellazionePlaceholders()` at render time so the
// numbers always match Centralina Pro > Automazioni rules.
export type CancellazioneBlock =
  | { type: 'p'; text_it: string; text_en: string }
  | { type: 'p-bold'; text_it: string; text_en: string }
  | { type: 'p-italic'; text_it: string; text_en: string }
  | { type: 'ul'; items_it: string[]; items_en: string[]; tone?: 'default' | 'green' };

export interface CancellazioneSection {
  id: string;
  variant: 'standard' | 'flex';
  title_it: string;
  title_en: string;
  blocks: CancellazioneBlock[];
}

export interface CancellazioneCopy {
  page_title_it: string;
  page_title_en: string;
  sections: CancellazioneSection[];
  contact_label_it: string;
  contact_label_en: string;
  contact_email: string;
  contact_address: string;
  last_updated_it: string;
  last_updated_en: string;
}

// ─── Membership / DR7 Club ──────────────────────────────────────────────────
//
// Pricing numbers (€39 / €/month / annual savings) come from
// MEMBERSHIP_TIERS at runtime — they're not editable here. What IS editable:
// hero copy, pricing-card surround text, the entire "DR7 Elite Rewards"
// section (header + sub-sections with rich blocks), and the reward-system
// grid items. Use the same `{monthlyPrice}` / `{annualPrice}` /
// `{annualMonthly}` placeholders if you want admin to inline live numbers.
export interface MembershipRewardItem {
  label_it: string;
  label_en: string;
  reward: string;       // "2%", "1%", "3%", ... — free-form badge text
  note_it: string | null;
  note_en: string | null;
}

export interface MembershipCopy {
  // Hero band
  hero_eyebrow_it: string; hero_eyebrow_en: string;
  hero_title: string;
  hero_subtitle_it: string; hero_subtitle_en: string;
  hero_opener_it: string; hero_opener_en: string;     // "...starting from just {monthlyPrice}/mese"
  // Pricing card surround
  pricing_card_title: string;
  pricing_billing_monthly_it: string; pricing_billing_monthly_en: string;
  pricing_billing_annual_it: string; pricing_billing_annual_en: string;
  pricing_billing_save_badge: string;                  // e.g. "-33%"
  pricing_cycle_month_it: string; pricing_cycle_month_en: string;
  pricing_cycle_year_it: string; pricing_cycle_year_en: string;
  pricing_savings_it: string; pricing_savings_en: string;  // template w/ {annualMonthly},{annualSavings}
  pricing_cta_it: string; pricing_cta_en: string;
  pricing_cta_footnote_it: string; pricing_cta_footnote_en: string;
  // DR7 Elite Rewards block
  elite_title: string;
  elite_subtitle_it: string; elite_subtitle_en: string;
  elite_intro_it: string; elite_intro_en: string;
  elite_sections: CancellazioneSection[];              // reuse rich-block schema
  elite_cta_title_it: string; elite_cta_title_en: string;
  elite_cta_text_it: string; elite_cta_text_en: string;
  elite_cta_logged_out_it: string; elite_cta_logged_out_en: string;

  // Scala dei livelli cashback. I livelli veri stanno in Centralina Pro > DR7
  // Club: qui c'e' solo l'intestazione della sezione. Opzionali perche'
  // getMembershipCopy ripiega a blocco e la riga gia' salvata non le contiene:
  // il valore di fabbrica sta nel punto in cui vengono lette.
  tiers_eyebrow_it?: string; tiers_eyebrow_en?: string;
  tiers_title_it?: string; tiers_title_en?: string;
  tiers_note_it?: string; tiers_note_en?: string;
  elite_cta_logged_in_it: string; elite_cta_logged_in_en: string;
  // Reward-system grid
  reward_title_it: string; reward_title_en: string;
  reward_intro_it: string; reward_intro_en: string;
  reward_items: MembershipRewardItem[];
  reward_footnote_it: string; reward_footnote_en: string;
}

export interface MembershipPlaceholderValues {
  monthlyPrice: string;     // formatted e.g. "39,00"
  annualPrice: string;      // formatted e.g. "390"
  annualMonthly: string;    // formatted e.g. "32,50"
  annualSavings: string;    // formatted savings
}

// ─── Home / Hero ────────────────────────────────────────────────────────────
export interface HomeSlide {
  id: string;
  video_src: string;       // path under /public, e.g. "/main.mp4"
  /** Fotogramma mostrato prima che il video parta e se il video non arriva. */
  poster_src?: string;
  /** Sorgente verticale dedicata al telefono, se la scena 16:9 non regge il taglio. */
  mobile_src?: string;
}

/**
 * Override for a single category card on the homepage. Only the categories
 * with a matching `id` get overridden; the others keep the hardcoded
 * DISPLAY_TITLE / CATEGORY_IMAGE values from HomePage.tsx.
 */
export interface HomeCategoryOverride {
  id: string;              // must match a RENTAL_CATEGORIES id
  display_title_it: string;
  display_title_en: string;
  image_src: string;       // path under /public, e.g. "/car.jpeg"
}

/** Un'esperienza in homepage: servizio reale, immagine, testo, destinazione. */
export interface HomeExperience {
  id: string;
  to: string;                 // rotta interna esistente, es. "/noleggio-mare"
  image_src: string;          // path under /public
  video_src?: string;         // opzionale: se c'e', sostituisce l'immagine
  title_it: string; title_en: string;
  copy_it: string; copy_en: string;
  cta_it: string; cta_en: string;
}

/**
 * Numero monumentale in homepage.
 *
 * Vuoto di proposito nei default: un numero va mostrato solo se verificato.
 * Finche' l'array e' vuoto la sezione non viene renderizzata.
 */
export interface HomeMetric {
  id: string;
  value: string;              // es. "2.000+"
  label_it: string; label_en: string;
}

export interface HomeCopy {
  seo_h1_it: string;
  seo_h1_en: string;
  hero_autoplay_seconds: number;     // default 8
  hero_slides: HomeSlide[];
  categories: HomeCategoryOverride[];

  // ── Atto 01 — Arrivo ─────────────────────────────────────────────────────
  hero_kicker_it: string; hero_kicker_en: string;
  hero_headline_it: string; hero_headline_en: string;
  hero_microcopy_it: string; hero_microcopy_en: string;
  hero_cta_label_it: string; hero_cta_label_en: string; hero_cta_to: string;
  hero_cta2_label_it: string; hero_cta2_label_en: string; hero_cta2_to: string;

  // ── Atto 02 — Silenzio ───────────────────────────────────────────────────
  statement_lines_it: string[]; statement_lines_en: string[];
  statement_note_it: string; statement_note_en: string;

  // ── Atto 03 — La Collezione ──────────────────────────────────────────────
  collection_eyebrow_it: string; collection_eyebrow_en: string;
  collection_title_it: string; collection_title_en: string;
  collection_intro_it: string; collection_intro_en: string;
  /** Id veicolo da mettere in evidenza. Vuoto = i primi disponibili. */
  collection_featured_ids: string[];
  collection_featured_count: number;
  collection_cta_label_it: string; collection_cta_label_en: string;
  collection_cta_to: string;
  /** Etichetta della CTA sotto ogni veicolo in evidenza. */
  collection_item_cta_it: string; collection_item_cta_en: string;

  // ── Atto 04 — Esperienze ─────────────────────────────────────────────────
  experiences_eyebrow_it: string; experiences_eyebrow_en: string;
  experiences_title_it: string; experiences_title_en: string;
  experiences: HomeExperience[];

  // ── Atto 05 — Marca ──────────────────────────────────────────────────────
  brand_lines_it: string[]; brand_lines_en: string[];
  brand_paragraphs: BilingualParagraph[];
  metrics: HomeMetric[];

  // ── Atto 06 — Accesso ────────────────────────────────────────────────────
  access_title_it: string; access_title_en: string;
  access_copy_it: string; access_copy_en: string;
  access_cta_label_it: string; access_cta_label_en: string; access_cta_to: string;
  access_media_src: string;
  access_video_src: string;
}

// ─── Chi Siamo (About) ──────────────────────────────────────────────────────
export interface AboutFounder {
  id: string;
  name: string;
  role_it: string; role_en: string;
  photo_src: string;          // path under /public, e.g. "/Valerio.jpg"
  alt_it: string; alt_en: string;
}

export interface BilingualParagraph {
  text_it: string;
  text_en: string;
}

export interface AboutCopy {
  founders: AboutFounder[];
  story_title_it: string; story_title_en: string;
  story_paragraphs: BilingualParagraph[];
  story_outro_main_it: string; story_outro_main_en: string;
  story_outro_sub_it: string; story_outro_sub_en: string;
  story_signature: string;    // "— Valerio & Ilenia"
}

// ─── Mechanical Services ────────────────────────────────────────────────────
//
// IMPORTANT: the actual service catalog (prices, names, categories) lives
// in the `car_wash_services` Supabase table — managed from admin > Catalogo
// Prime Wash with the LAVAGGIO/MECCANICA filter. siteCopy.mechanical only
// holds the page CHROME (hero band, "Come Funziona" steps, opening hours,
// button labels). DO NOT recreate the catalog here.
export interface MechanicalServiceItem {
  id: string;
  name_it: string; name_en: string;
  category: string;
  description_it: string; description_en: string;
  duration: string;
  price: number;
}

export interface MechanicalHowStep {
  title_it: string; title_en: string;
  text_it: string; text_en: string;
}

export interface MechanicalCopy {
  hero_title: string;
  hero_subtitle_it: string; hero_subtitle_en: string;
  hero_intro_it: string; hero_intro_en: string;
  book_now_label_it: string; book_now_label_en: string;
  how_heading_it: string; how_heading_en: string;
  how_steps: MechanicalHowStep[];
  hours_heading_it: string; hours_heading_en: string;
  hours_main_it: string; hours_main_en: string;
  hours_sub_it: string; hours_sub_en: string;
}

// ─── Header (every page) ──────────────────────────────────────────────────
//
// IMPORTANT: brand-vocabulary strings (DR7 Club, Aviation Division, Prime
// Wash, Supercar & Luxury Division, etc.) stay hardcoded in Header.tsx —
// they are brand names, not localized chrome. Only the section headings,
// drawer/header CTAs, and aria labels move to CMS.
// ─── Locations catalog (airports / pickup / marinas / heli points) ──────
// Drop-in replacement for the hardcoded arrays previously in constants.ts.
// Each item is admin-editable: add / remove / reorder / rename. Pages
// continue to use the constants for synchronous default but populate
// their state from this config on mount.
export interface AirportItem {
  iata: string;
  name: string;
  city: string;
}

export interface BilingualLocationItem {
  id: string;
  label_it: string;
  label_en: string;
}

export interface SimpleLocationItem {
  id: string;
  name: string;
}

export interface LocationsCopy {
  airports: AirportItem[];
  pickup_locations: BilingualLocationItem[];
  return_locations: BilingualLocationItem[];
  yacht_marinas: BilingualLocationItem[];
  heli_departure_points: SimpleLocationItem[];
  heli_arrival_points: SimpleLocationItem[];
}

// ─── Yacht / Jet / Heli catalog (admin-editable fleet items) ────────────
// Spec keys map to fixed labels + icons in utils/getAviationFleet.ts. Admin
// only edits the value strings; static labels and icons live in code.
export type AviationMarineSpecKey =
  | 'passengers' | 'year' | 'type'
  | 'range' | 'speed'
  | 'guests' | 'length' | 'cabins';

export interface AviationMarineSpec {
  key: AviationMarineSpecKey;
  value: string;
}

export interface AviationMarineItem {
  id: string;
  name: string;
  image: string;
  images?: string[];
  price_per_day_eur?: number;
  pets_allowed?: boolean;
  smoking_allowed?: boolean;
  specs: AviationMarineSpec[];
}

export interface AviationMarineCopy {
  yachts: AviationMarineItem[];
  jets: AviationMarineItem[];
  helis: AviationMarineItem[];
}

// ─── DR7 Club plan (admin-editable price + features) ─────────────────────
// Marketing-side data for /membership and enrollment. Cashback rules and
// loyalty tier thresholds live in centralina_pro_config.tier_pricing — this
// block is only what the public membership page displays.
export interface Dr7ClubPlanCopy {
  id: string;
  name_it: string;
  name_en: string;
  monthly_eur: number;
  annually_eur: number;
  features_it: string[];
  features_en: string[];
}

// ─── Payment Cancel page (post-Nexi cancel landing) ─────────────────────
export interface PaymentCancelCopy {
  title_it: string; title_en: string;
  body_it: string; body_en: string;
  cta_home_it: string; cta_home_en: string;
  cta_retry_it: string; cta_retry_en: string;
}

// ─── BookingSearchBox component (Header drawer popup + Hero variant) ─────
export interface BookingSearchBoxCopy {
  title_it: string; title_en: string;                                          // "Prenota il tuo veicolo"
  pickup_location_label_it: string; pickup_location_label_en: string;
  pickup_location_placeholder_it: string; pickup_location_placeholder_en: string;
  same_return_note_it: string; same_return_note_en: string;                    // "Riconsegna nella sede principale..."
  return_location_label_it: string; return_location_label_en: string;
  return_location_placeholder_it: string; return_location_placeholder_en: string;
  pickup_section_label_it: string; pickup_section_label_en: string;            // "Ritiro"
  return_section_label_it: string; return_section_label_en: string;            // "Restituzione"
  date_placeholder_it: string; date_placeholder_en: string;                    // "Seleziona data"
  closed_message_it: string; closed_message_en: string;                        // "Chiusi (domenica o festivo)"
  rate_warning_title_it: string; rate_warning_title_en: string;
  rate_warning_body_it: string; rate_warning_body_en: string;
  delivery_calc_loading_it: string; delivery_calc_loading_en: string;
  delivery_label_it: string; delivery_label_en: string;                        // "Consegna a domicilio"
  delivery_breakdown_consegna_it: string; delivery_breakdown_consegna_en: string;
  delivery_breakdown_riconsegna_it: string; delivery_breakdown_riconsegna_en: string;
  search_cta_it: string; search_cta_en: string;
  err_pickup_date_required_it: string; err_pickup_date_required_en: string;
  err_return_date_required_it: string; err_return_date_required_en: string;
  err_blocked_pickup_it: string; err_blocked_pickup_en: string;
  err_blocked_return_it: string; err_blocked_return_en: string;
  err_return_before_pickup_it: string; err_return_before_pickup_en: string;
  err_return_time_before_pickup_it: string; err_return_time_before_pickup_en: string;
}

// ─── Registrazione Cliente page (token-gated customer data form) ─────────
// Distinct from SignUpPage: this flow is for an operator-sent invite link
// where the customer fills anagrafica + uploads ID docs. Phase-1 migration
// covers chrome + gates + section titles + CTAs + status copy + 4 fixed
// validation errors + "Campi mancanti:" prefix. Per-field labels and
// placeholders are deferred (follow-up pass).
export interface RegistrazioneClienteCopy {
  // Page intro
  intro_title_it: string; intro_title_en: string;
  intro_subtitle_it: string; intro_subtitle_en: string;
  // Tipo cliente buttons
  tipo_persona_fisica_it: string; tipo_persona_fisica_en: string;
  tipo_azienda_it: string; tipo_azienda_en: string;
  tipo_pa_it: string; tipo_pa_en: string;
  // Section titles (numbered)
  section_1_tipo_it: string; section_1_tipo_en: string;
  section_2_anagrafica_it: string; section_2_anagrafica_en: string;
  section_2_azienda_it: string; section_2_azienda_en: string;
  section_2_pa_it: string; section_2_pa_en: string;
  section_3_residenza_it: string; section_3_residenza_en: string;
  section_3_sede_it: string; section_3_sede_en: string;
  section_4_contatti_it: string; section_4_contatti_en: string;
  section_docs_it: string; section_docs_en: string;
  // Required hint
  required_hint_it: string; required_hint_en: string;
  // Gates
  verifica_link_it: string; verifica_link_en: string;
  invalid_title_it: string; invalid_title_en: string;
  invalid_reason_expired_it: string; invalid_reason_expired_en: string;
  invalid_reason_used_it: string; invalid_reason_used_en: string;
  invalid_reason_revoked_it: string; invalid_reason_revoked_en: string;
  invalid_reason_fallback_it: string; invalid_reason_fallback_en: string;
  invalid_reason_incomplete_it: string; invalid_reason_incomplete_en: string;
  invalid_reason_validation_it: string; invalid_reason_validation_en: string;
  invalid_help_it: string; invalid_help_en: string;
  done_title_it: string; done_title_en: string;
  done_body_it: string; done_body_en: string;
  // Documents step
  docs_intro_it: string; docs_intro_en: string;
  docs_label_identity_it: string; docs_label_identity_en: string;
  docs_label_license_it: string; docs_label_license_en: string;
  docs_label_codice_fiscale_it: string; docs_label_codice_fiscale_en: string;
  docs_chip_uploaded_it: string; docs_chip_uploaded_en: string;
  docs_chip_uploading_it: string; docs_chip_uploading_en: string;
  docs_chip_remove_it: string; docs_chip_remove_en: string;
  // CTAs
  cta_submit_it: string; cta_submit_en: string;
  cta_submitting_it: string; cta_submitting_en: string;
  cta_skip_docs_it: string; cta_skip_docs_en: string;
  cta_upload_selected_it: string; cta_upload_selected_en: string;
  cta_finish_it: string; cta_finish_en: string;
  // Validation
  err_missing_prefix_it: string; err_missing_prefix_en: string;     // "Campi mancanti: {list}"
  err_phone_invalid_it: string; err_phone_invalid_en: string;
  err_email_invalid_it: string; err_email_invalid_en: string;
  err_cf_length_it: string; err_cf_length_en: string;
  err_piva_length_it: string; err_piva_length_en: string;
  // Persona Fisica fields
  field_nome_it: string; field_nome_en: string;
  field_cognome_it: string; field_cognome_en: string;
  field_cf_label_it: string; field_cf_label_en: string;
  field_cf_placeholder: string;
  field_sesso_label_it: string; field_sesso_label_en: string;
  field_sesso_default_it: string; field_sesso_default_en: string;
  field_sesso_m_it: string; field_sesso_m_en: string;
  field_sesso_f_it: string; field_sesso_f_en: string;
  field_birth_date_it: string; field_birth_date_en: string;
  field_birth_city_it: string; field_birth_city_en: string;
  field_birth_city_placeholder_it: string; field_birth_city_placeholder_en: string;
  field_birth_province_it: string; field_birth_province_en: string;
  field_birth_province_placeholder_it: string; field_birth_province_placeholder_en: string;
  // Azienda fields
  field_ragione_sociale_it: string; field_ragione_sociale_en: string;
  field_piva_it: string; field_piva_en: string;
  field_piva_placeholder_it: string; field_piva_placeholder_en: string;
  field_pec_no_sdi_it: string; field_pec_no_sdi_en: string;
  field_pec_placeholder: string;
  field_sdi_no_pec_it: string; field_sdi_no_pec_en: string;
  field_sdi_placeholder_it: string; field_sdi_placeholder_en: string;
  field_cf_rappresentante_it: string; field_cf_rappresentante_en: string;
  // Pubblica Amministrazione fields
  field_ente_ufficio_it: string; field_ente_ufficio_en: string;
  field_codice_univoco_it: string; field_codice_univoco_en: string;
  field_codice_univoco_placeholder_it: string; field_codice_univoco_placeholder_en: string;
  field_cf_ente_it: string; field_cf_ente_en: string;
  field_pec_simple_it: string; field_pec_simple_en: string;
  // Residenza/Sede fields
  field_indirizzo_it: string; field_indirizzo_en: string;
  field_indirizzo_placeholder_it: string; field_indirizzo_placeholder_en: string;
  field_civico_it: string; field_civico_en: string;
  field_civico_placeholder_it: string; field_civico_placeholder_en: string;
  field_citta_it: string; field_citta_en: string;
  field_citta_placeholder_it: string; field_citta_placeholder_en: string;
  field_provincia_it: string; field_provincia_en: string;
  field_provincia_placeholder_it: string; field_provincia_placeholder_en: string;
  field_cap_it: string; field_cap_en: string;
  field_cap_placeholder_it: string; field_cap_placeholder_en: string;
  field_nazione_it: string; field_nazione_en: string;
  field_nazione_placeholder: string;
  // Contatti fields
  field_telefono_it: string; field_telefono_en: string;
  field_telefono_placeholder: string;
  field_email_it: string; field_email_en: string;
  field_email_placeholder: string;
}

// ─── Firma page (contract e-signature OTP flow) ──────────────────────────
// Token substitution at render time:
//   {email} {name} {num} {contractNumber} {date} {i} {n} {attempts}
// Trustera360 is the e-signing backend (per memory rule); never confuse
// with yousign-*.ts dead code.
export interface FirmaCopy {
  // Chrome
  header_pill_it: string; header_pill_en: string;
  expired_title_it: string; expired_title_en: string;
  expired_body_it: string; expired_body_en: string;
  error_title_it: string; error_title_en: string;
  // PDF viewer
  pdf_section_title_it: string; pdf_section_title_en: string;
  pdf_pages_suffix_it: string; pdf_pages_suffix_en: string;     // "pagine"
  pdf_page_overlay_template_it: string; pdf_page_overlay_template_en: string; // "Pagina {i} di {n}"
  pdf_page_alt_template_it: string; pdf_page_alt_template_en: string;         // "Pagina {i}"
  pdf_iframe_title_it: string; pdf_iframe_title_en: string;
  pdf_loading_it: string; pdf_loading_en: string;
  contract_loading_it: string; contract_loading_en: string;
  // Contract info card
  contract_number_prefix_it: string; contract_number_prefix_en: string;       // "Contratto"
  label_cliente_it: string; label_cliente_en: string;
  label_veicolo_it: string; label_veicolo_en: string;
  label_ritiro_it: string; label_ritiro_en: string;
  label_riconsegna_it: string; label_riconsegna_en: string;
  na_fallback_it: string; na_fallback_en: string;
  // OTP step 1 — send code
  otp_step1_title_it: string; otp_step1_title_en: string;
  otp_step1_body_template_it: string; otp_step1_body_template_en: string;     // "...{email}"
  otp_step1_cta_it: string; otp_step1_cta_en: string;
  otp_sending_it: string; otp_sending_en: string;
  // OTP step 2 — enter code
  otp_step2_title_it: string; otp_step2_title_en: string;
  otp_step2_body_template_it: string; otp_step2_body_template_en: string;     // "...{email}"
  otp_attempts_template_it: string; otp_attempts_template_en: string;          // "...{attempts}"
  otp_verify_cta_it: string; otp_verify_cta_en: string;
  otp_verifying_it: string; otp_verifying_en: string;
  otp_resend_it: string; otp_resend_en: string;
  // Signing step 3 — confirm
  signing_step_title_it: string; signing_step_title_en: string;
  signing_identity_verified_it: string; signing_identity_verified_en: string;
  signing_ack_template_1_it: string; signing_ack_template_1_en: string;        // "{name} {num}"
  signing_ack_template_2_it: string; signing_ack_template_2_en: string;        // "{email}"
  signing_terms_checkbox_it: string; signing_terms_checkbox_en: string;
  signing_submit_cta_it: string; signing_submit_cta_en: string;
  // Signed success
  signed_title_it: string; signed_title_en: string;
  signed_body_template_it: string; signed_body_template_en: string;            // "{date}"
  signed_email_note_it: string; signed_email_note_en: string;
  signed_download_cta_it: string; signed_download_cta_en: string;
  // Errors
  err_load_fallback_it: string; err_load_fallback_en: string;
  err_load_contract_it: string; err_load_contract_en: string;
  err_send_otp_it: string; err_send_otp_en: string;
  err_incomplete_code_it: string; err_incomplete_code_en: string;
  err_verify_otp_it: string; err_verify_otp_en: string;
  err_terms_required_it: string; err_terms_required_en: string;
  err_signing_it: string; err_signing_en: string;
}

// ─── Token page (Coming Soon landing) ────────────────────────────────────
// DR7 Token products are not live yet — the page is a simple "Coming Soon"
// placeholder. When the product roadmap is ready, the schema can be
// expanded back into per-section content.
export interface TokenCopy {
  hero_title_it: string; hero_title_en: string;          // "DR7 TOKEN"
  hero_eyebrow_it: string; hero_eyebrow_en: string;      // "Coming Soon"
  body_message_it: string; body_message_en: string;
  cta_button_it: string; cta_button_en: string;          // "Torna alla Home"
}

// ─── Credit Wallet page (recharge funnel + benefits + checkout modal) ────
// Marketing copy + checkout chrome + i pacchetti di ricarica (importi e
// percentuali di bonus), tutto editabile da admin > Sito > Credit Wallet.
// Brand vocab "DR7", "DR7 Credit Wallet", "Nexi" stays hardcoded in the
// page template. `{amount}` token in modal pay CTA resolved at render.

/**
 * Un pacchetto di ricarica del Credit Wallet. `receivedAmount` e `bonus`
 * sono derivati da `rechargeAmount` + `bonusPercentage` (l'editor admin li
 * ricalcola a ogni modifica) ma restano persistiti perche' la pagina e le
 * righe di `credit_wallet_purchases` li usano cosi' come sono.
 */
export interface CreditPackage {
  id: string;
  series: string;
  name: string;
  rechargeAmount: number;
  receivedAmount: number;
  bonus: number;
  bonusPercentage: number;
  popular?: boolean;
}

export interface CreditWalletCopy {
  // Hero
  hero_title_eyebrow_it: string; hero_title_eyebrow_en: string;
  hero_subtitle_it: string; hero_subtitle_en: string;
  hero_intro_it: string; hero_intro_en: string;
  // Top benefits row (3 cards)
  benefit_extra_title_it: string; benefit_extra_title_en: string;
  benefit_extra_body_it: string; benefit_extra_body_en: string;
  benefit_no_expiry_title_it: string; benefit_no_expiry_title_en: string;
  benefit_no_expiry_body_it: string; benefit_no_expiry_body_en: string;
  benefit_secure_title_it: string; benefit_secure_title_en: string;
  benefit_secure_body_it: string; benefit_secure_body_en: string;
  // Services info
  services_heading_it: string; services_heading_en: string;
  services_body_it: string; services_body_en: string;
  services_no_expiry_it: string; services_no_expiry_en: string;
  // Package selection
  packages_section_label_it: string; packages_section_label_en: string;
  packages_filter_all_it: string; packages_filter_all_en: string;
  // Pacchetti di ricarica (serie, importi, bonus %) — editabili da admin
  packages: CreditPackage[];
  // Promo footer slogans
  promo_line1_it: string; promo_line1_en: string;
  promo_line2_it: string; promo_line2_en: string;
  // Advantages (4 cards — section header + 4× title/body)
  advantages_heading_it: string; advantages_heading_en: string;
  advantage_1_title_it: string; advantage_1_title_en: string;
  advantage_1_body_it: string; advantage_1_body_en: string;
  advantage_2_title_it: string; advantage_2_title_en: string;
  advantage_2_body_it: string; advantage_2_body_en: string;
  advantage_3_title_it: string; advantage_3_title_en: string;
  advantage_3_body_it: string; advantage_3_body_en: string;
  advantage_4_title_it: string; advantage_4_title_en: string;
  advantage_4_body_it: string; advantage_4_body_en: string;
  // Transparency (title + 3 bullets)
  transparency_heading_it: string; transparency_heading_en: string;
  transparency_bullet_1_it: string; transparency_bullet_1_en: string;
  transparency_bullet_2_it: string; transparency_bullet_2_en: string;
  transparency_bullet_3_it: string; transparency_bullet_3_en: string;
  // Bottom CTA block
  cta_title_it: string; cta_title_en: string;
  cta_subtitle_it: string; cta_subtitle_en: string;
  cta_button_it: string; cta_button_en: string;
  // Package card
  card_popular_badge_it: string; card_popular_badge_en: string;
  card_recharge_label_it: string; card_recharge_label_en: string;
  card_receive_label_it: string; card_receive_label_en: string;
  card_bonus_suffix_it: string; card_bonus_suffix_en: string;     // "Bonus"
  card_cta_it: string; card_cta_en: string;
  // Checkout modal
  modal_title_it: string; modal_title_en: string;
  modal_recharge_label_it: string; modal_recharge_label_en: string;
  modal_bonus_label_it: string; modal_bonus_label_en: string;
  modal_receive_label_it: string; modal_receive_label_en: string;
  modal_payment_heading_it: string; modal_payment_heading_en: string;
  modal_payment_info_it: string; modal_payment_info_en: string;
  modal_payment_secure_it: string; modal_payment_secure_en: string;
  modal_cancel_it: string; modal_cancel_en: string;
  modal_pay_template_it: string; modal_pay_template_en: string;   // "Paga €{amount}"
  modal_processing_it: string; modal_processing_en: string;
  // Validation / errors
  err_name_required_it: string; err_name_required_en: string;
  err_email_required_it: string; err_email_required_en: string;
  err_phone_invalid_it: string; err_phone_invalid_en: string;
  err_cf_invalid_it: string; err_cf_invalid_en: string;
  err_payment_not_ready_it: string; err_payment_not_ready_en: string;
  err_payment_failed_it: string; err_payment_failed_en: string;
}

// ─── Booking page (yacht/jet/heli forms — auth gate + errors + chrome) ────
// Most form labels stay in the global i18n dictionary (t() lookups). This
// schema covers only the chrome the i18n keys don't address: the auth gate
// shown to non-logged-in users, post-submit confirmation screens, the
// quote-review summary block, payment-related error literals, and the
// generic "Select" option default. WhatsApp inquiry templates (helicopter
// / jet / yacht) live in system_messages under proposed keys
// `pro_booking_helicopter_inquiry_whatsapp` /
// `pro_booking_jet_inquiry_whatsapp` / `pro_booking_yacht_confirm_whatsapp`.
export interface BookingCopy {
  loading_it: string; loading_en: string;
  // Auth gate
  auth_required_title_it: string; auth_required_title_en: string;
  auth_required_body_it: string; auth_required_body_en: string;
  auth_required_login_cta_it: string; auth_required_login_cta_en: string;
  auth_required_signup_cta_it: string; auth_required_signup_cta_en: string;
  // Confirmation screen (yacht-style, after booking)
  booking_confirmed_title_it: string; booking_confirmed_title_en: string;
  booking_confirmed_body_it: string; booking_confirmed_body_en: string;
  booking_confirmed_cta_bookings_it: string; booking_confirmed_cta_bookings_en: string;
  // Inquiry-sent screen (jet/heli quote)
  inquiry_sent_cta_home_it: string; inquiry_sent_cta_home_en: string;
  // Quote review (pre-submit summary)
  quote_review_title_it: string; quote_review_title_en: string;
  quote_review_body_it: string; quote_review_body_en: string;
  // Generic
  select_option_default_it: string; select_option_default_en: string;
  payment_initializing_it: string; payment_initializing_en: string;
  item_not_found_it: string; item_not_found_en: string;
  // Errors
  err_payment_not_configured_it: string; err_payment_not_configured_en: string;
  err_payment_server_down_it: string; err_payment_server_down_en: string;
  err_payment_not_ready_it: string; err_payment_not_ready_en: string;
  err_category_unsupported_it: string; err_category_unsupported_en: string;
  err_save_failed_it: string; err_save_failed_en: string;
  err_unexpected_it: string; err_unexpected_en: string;
}

// ─── Payment Success page (post-payment landing) ──────────────────────────
//
// Templated bodies use {tierName} / {cycle} / {packageName} / {amount}
// substitutions, resolved at render time. The on-page chrome (this schema)
// is separate from the 3 WhatsApp message blocks the page builds — those
// live in system_messages under keys `pro_payment_success_whatsapp_rental`
// and `pro_payment_success_whatsapp_appointment`.
export interface PaymentSuccessCopy {
  loading_title_it: string; loading_title_en: string;
  loading_subtitle_it: string; loading_subtitle_en: string;
  success_title_it: string; success_title_en: string;
  body_generic_it: string; body_generic_en: string;
  body_dr7_club_it: string; body_dr7_club_en: string;
  // Pre-autorizzazione cauzione (link inviato dal gestionale): l'importo e'
  // bloccato sulla carta, NON addebitato. Titolo e corpo dedicati.
  success_title_cauzione_it: string; success_title_cauzione_en: string;
  body_cauzione_it: string; body_cauzione_en: string;
  body_membership_template_it: string; body_membership_template_en: string;   // {tierName} {cycle}
  body_wallet_template_it: string; body_wallet_template_en: string;           // {packageName} {amount}
  billing_cycle_monthly_it: string; billing_cycle_monthly_en: string;
  billing_cycle_annual_it: string; billing_cycle_annual_en: string;
  transaction_heading_it: string; transaction_heading_en: string;
  transaction_order_id_label_it: string; transaction_order_id_label_en: string;
  transaction_amount_label_it: string; transaction_amount_label_en: string;
  transaction_auth_code_label_it: string; transaction_auth_code_label_en: string;
  cta_home_it: string; cta_home_en: string;
  cta_whatsapp_it: string; cta_whatsapp_en: string;
  cta_membership_it: string; cta_membership_en: string;
  cta_wallet_it: string; cta_wallet_en: string;
  cta_bookings_it: string; cta_bookings_en: string;
  err_booking_create_it: string; err_booking_create_en: string;
  err_auth_it: string; err_auth_en: string;
  err_purchase_update_it: string; err_purchase_update_en: string;
  err_credit_add_it: string; err_credit_add_en: string;
  err_order_not_found_it: string; err_order_not_found_en: string;
  err_payment_not_confirmed_it: string; err_payment_not_confirmed_en: string;
  err_generic_it: string; err_generic_en: string;
}

// ─── Payment page (Nexi XPay iframe wrapper) ──────────────────────────────
// Note: the Nexi XPay SDK itself is locked to `language: 'ita'` — only the
// surrounding DR7 chrome is bilingual.
export interface PaymentCopy {
  subtitle_it: string; subtitle_en: string;
  loading_it: string; loading_en: string;
  ready_title_it: string; ready_title_en: string;
  ready_subtitle_it: string; ready_subtitle_en: string;
  ready_prepaid_warning_it: string; ready_prepaid_warning_en: string;
  checking_title_it: string; checking_title_en: string;
  checking_subtitle_it: string; checking_subtitle_en: string;
  blocked_title_it: string; blocked_title_en: string;
  blocked_default_message_it: string; blocked_default_message_en: string;
  blocked_help_it: string; blocked_help_en: string;
  blocked_retry_cta_it: string; blocked_retry_cta_en: string;
  success_title_it: string; success_title_en: string;
  success_redirect_it: string; success_redirect_en: string;
  cancelled_title_it: string; cancelled_title_en: string;
  cancelled_subtitle_it: string; cancelled_subtitle_en: string;
  cancelled_retry_cta_it: string; cancelled_retry_cta_en: string;
  error_title_it: string; error_title_en: string;
  error_invalid_link_it: string; error_invalid_link_en: string;
  error_sdk_load_it: string; error_sdk_load_en: string;
  error_sdk_unavailable_it: string; error_sdk_unavailable_en: string;
  error_sdk_init_it: string; error_sdk_init_en: string;
  error_check_card_it: string; error_check_card_en: string;
  error_payment_failed_it: string; error_payment_failed_en: string;
  footer_secure_note_it: string; footer_secure_note_en: string;
}

// ─── SignUp page (registrazione cliente) ───────────────────────────────────
// Three client-type branches share a single schema. Section headers + form
// labels + placeholders + validation strings all live here. Global keys
// already covered by useTranslation() (Password, Sign_In, Create_Account,
// etc.) stay in i18n and are NOT duplicated. Validation messages are
// hardcoded IT-only in the legacy page — migrating with bilingual variants
// so future English signup flows work out of the box.
export interface SignUpCopy {
  // Page chrome
  subtitle_it: string; subtitle_en: string;
  // Client type selector
  client_type_label_it: string; client_type_label_en: string;
  client_type_default_it: string; client_type_default_en: string;
  client_type_azienda_it: string; client_type_azienda_en: string;
  client_type_persona_it: string; client_type_persona_en: string;
  client_type_pa_it: string; client_type_pa_en: string;
  // Section headers (Azienda branch)
  section_legal_rep_it: string; section_legal_rep_en: string;
  section_id_doc_it: string; section_id_doc_en: string;
  // Shared password section header
  section_credentials_it: string; section_credentials_en: string;
  // Common labels (Nazione/Paese, Email, Telefono, Codice Fiscale)
  field_country_it: string; field_country_en: string;
  field_email_it: string; field_email_en: string;
  field_phone_it: string; field_phone_en: string;
  field_codice_fiscale_it: string; field_codice_fiscale_en: string;
  // Azienda fields
  field_denominazione_it: string; field_denominazione_en: string;
  field_denominazione_placeholder_it: string; field_denominazione_placeholder_en: string;
  field_piva_it: string; field_piva_en: string;
  field_piva_placeholder: string;                                // "IT12345678901"
  field_cf_placeholder: string;                                  // "00000000000"
  field_sede_legale_it: string; field_sede_legale_en: string;
  field_sede_legale_placeholder_it: string; field_sede_legale_placeholder_en: string;
  field_sede_operativa_it: string; field_sede_operativa_en: string;
  field_sede_operativa_placeholder_it: string; field_sede_operativa_placeholder_en: string;
  field_sdi_it: string; field_sdi_en: string;
  field_sdi_placeholder: string;                                 // "XXXXXXX"
  field_email_aziendale_it: string; field_email_aziendale_en: string;
  field_email_aziendale_placeholder: string;                     // "email@azienda.it"
  field_phone_aziendale_it: string; field_phone_aziendale_en: string;
  field_nome_it: string; field_nome_en: string;
  field_cognome_it: string; field_cognome_en: string;
  field_ruolo_it: string; field_ruolo_en: string;
  field_ruolo_placeholder_it: string; field_ruolo_placeholder_en: string;
  field_doc_type_it: string; field_doc_type_en: string;
  field_doc_type_default_it: string; field_doc_type_default_en: string;
  field_doc_type_carta_it: string; field_doc_type_carta_en: string;
  field_doc_type_passaporto_it: string; field_doc_type_passaporto_en: string;
  field_doc_type_patente_it: string; field_doc_type_patente_en: string;
  field_doc_numero_it: string; field_doc_numero_en: string;
  field_doc_data_it: string; field_doc_data_en: string;
  field_doc_luogo_it: string; field_doc_luogo_en: string;
  // Persona Fisica fields
  field_nome_placeholder_it: string; field_nome_placeholder_en: string;
  field_cognome_placeholder_it: string; field_cognome_placeholder_en: string;
  field_cf_pf_placeholder: string;                               // "RSSMRA80A01H501U"
  field_sesso_it: string; field_sesso_en: string;
  field_sesso_default_it: string; field_sesso_default_en: string;
  field_sesso_m_it: string; field_sesso_m_en: string;
  field_sesso_f_it: string; field_sesso_f_en: string;
  field_birth_date_it: string; field_birth_date_en: string;
  field_birth_city_it: string; field_birth_city_en: string;
  field_birth_province_it: string; field_birth_province_en: string;
  field_birth_province_placeholder_it: string; field_birth_province_placeholder_en: string;
  field_address_it: string; field_address_en: string;
  field_address_placeholder_it: string; field_address_placeholder_en: string;
  field_civico_it: string; field_civico_en: string;
  field_civico_placeholder: string;                              // "123"
  field_city_it: string; field_city_en: string;
  field_city_placeholder_it: string; field_city_placeholder_en: string;
  field_cap_it: string; field_cap_en: string;
  field_cap_placeholder: string;                                 // "20100"
  field_province_it: string; field_province_en: string;
  field_province_placeholder: string;                            // "MI"
  field_email_placeholder: string;                               // "email@esempio.it"
  field_pec_it: string; field_pec_en: string;
  field_pec_placeholder: string;                                 // "pec@pec.it"
  // PA fields
  field_codice_univoco_it: string; field_codice_univoco_en: string;
  field_codice_univoco_placeholder: string;                      // "XXXXXX"
  field_ente_it: string; field_ente_en: string;
  field_ente_placeholder_it: string; field_ente_placeholder_en: string;
  field_pa_city_placeholder_it: string; field_pa_city_placeholder_en: string;
  field_pa_email_placeholder: string;                            // "email@ente.it"
  // Password labels (placeholders use t() keys — handled by i18n)
  field_password_it: string; field_password_en: string;
  field_confirm_password_it: string; field_confirm_password_en: string;
  // Legal consent
  marketing_consent_it: string; marketing_consent_en: string;
  privacy_policy_link_it: string; privacy_policy_link_en: string;
  // Validation errors
  err_select_client_type_it: string; err_select_client_type_en: string;
  err_country_required_it: string; err_country_required_en: string;
  err_email_required_it: string; err_email_required_en: string;
  err_denominazione_required_it: string; err_denominazione_required_en: string;
  err_piva_required_it: string; err_piva_required_en: string;
  err_piva_invalid_it: string; err_piva_invalid_en: string;
  err_address_required_it: string; err_address_required_en: string;
  err_phone_required_it: string; err_phone_required_en: string;
  err_phone_invalid_it: string; err_phone_invalid_en: string;
  err_rep_nome_it: string; err_rep_nome_en: string;
  err_rep_cognome_it: string; err_rep_cognome_en: string;
  err_rep_cf_it: string; err_rep_cf_en: string;
  err_rep_ruolo_it: string; err_rep_ruolo_en: string;
  err_doc_type_it: string; err_doc_type_en: string;
  err_doc_numero_it: string; err_doc_numero_en: string;
  err_doc_data_it: string; err_doc_data_en: string;
  err_doc_luogo_it: string; err_doc_luogo_en: string;
  err_nome_required_it: string; err_nome_required_en: string;
  err_cognome_required_it: string; err_cognome_required_en: string;
  err_cf_invalid_it: string; err_cf_invalid_en: string;
  err_cf_required_it: string; err_cf_required_en: string;
  err_residenza_required_it: string; err_residenza_required_en: string;
  err_civico_required_it: string; err_civico_required_en: string;
  err_cap_required_it: string; err_cap_required_en: string;
  err_province_required_it: string; err_province_required_en: string;
  err_sesso_required_it: string; err_sesso_required_en: string;
  err_birth_city_required_it: string; err_birth_city_required_en: string;
  err_birth_province_required_it: string; err_birth_province_required_en: string;
  err_codice_univoco_required_it: string; err_codice_univoco_required_en: string;
  err_ente_required_it: string; err_ente_required_en: string;
  err_city_required_it: string; err_city_required_en: string;
  err_pa_address_required_it: string; err_pa_address_required_en: string;
}

export interface HeaderCopy {
  // Logo + aria
  logo_alt: string;
  open_menu_aria_it: string; open_menu_aria_en: string;
  close_menu_aria_it: string; close_menu_aria_en: string;
  // Top-bar
  explore_label_it: string; explore_label_en: string;     // "EXPLORE"
  credit_wallet_label_it: string; credit_wallet_label_en: string;
  // Drawer
  drawer_book_cta_it: string; drawer_book_cta_en: string;       // "Prenota Ora"
  flotta_label_it: string; flotta_label_en: string;             // "La Nostra Flotta"
  servizi_heading_it: string; servizi_heading_en: string;
  esperienze_heading_it: string; esperienze_heading_en: string;
  prime_wash_heading_it: string; prime_wash_heading_en: string;
  business_heading_it: string; business_heading_en: string;
  digital_heading_it: string; digital_heading_en: string;
  contact_cta_it: string; contact_cta_en: string;               // "Contattaci"
  // Menu principale (redesign): 9 voci, titolo + sottotitolo IT/EN.
  // Opzionali: se mancanti nel DB il sito usa i default hardcoded.
  menu_mobilita_title_it?: string; menu_mobilita_title_en?: string;
  menu_mobilita_sub_it?: string; menu_mobilita_sub_en?: string;
  menu_mare_title_it?: string; menu_mare_title_en?: string;
  menu_mare_sub_it?: string; menu_mare_sub_en?: string;
  menu_aria_title_it?: string; menu_aria_title_en?: string;
  menu_aria_sub_it?: string; menu_aria_sub_en?: string;
  menu_property_title_it?: string; menu_property_title_en?: string;
  menu_property_sub_it?: string; menu_property_sub_en?: string;
  menu_servizi_title_it?: string; menu_servizi_title_en?: string;
  menu_servizi_sub_it?: string; menu_servizi_sub_en?: string;
  // Credit Wallet: la voce esiste nel menu del sito da tempo ma le sue chiavi
  // non erano mai state dichiarate, quindi il pannello non la mostrava e il
  // titolo restava quello di fabbrica. Ora e' modificabile come le altre.
  menu_wallet_title_it?: string; menu_wallet_title_en?: string;
  menu_wallet_sub_it?: string; menu_wallet_sub_en?: string;
  menu_club_title_it?: string; menu_club_title_en?: string;
  menu_club_sub_it?: string; menu_club_sub_en?: string;
  menu_business_title_it?: string; menu_business_title_en?: string;
  menu_business_sub_it?: string; menu_business_sub_en?: string;
  menu_digital_title_it?: string; menu_digital_title_en?: string;
  menu_digital_sub_it?: string; menu_digital_sub_en?: string;
  menu_contatti_title_it?: string; menu_contatti_title_en?: string;
  menu_contatti_sub_it?: string; menu_contatti_sub_en?: string;
  // Immagine di ogni voce. Nel menu a schermo intero e' il visual che compare
  // accanto alla voce sotto il puntatore: e' contenuto, non decorazione, e
  // deve poterla cambiare l'operatore. Se la chiave manca vale l'immagine di
  // fabbrica dichiarata in Header.tsx.
  menu_mobilita_img?: string;
  menu_mare_img?: string;
  menu_aria_img?: string;
  menu_property_img?: string;
  menu_servizi_img?: string;
  menu_wallet_img?: string;
  menu_club_img?: string;
  menu_business_img?: string;
  menu_digital_img?: string;
  menu_contatti_img?: string;
  // Booking popup chrome (form itself = BookingSearchBox)
  popup_title_it: string; popup_title_en: string;               // "Prenota Ora"
  popup_subtitle_it: string; popup_subtitle_en: string;         // "Seleziona date e orari"
}

// ─── Aspetto & Funzionalita' del sito ──────────────────────────────────────
//
// A differenza delle altre sezioni qui non ci sono testi: ci sono le scelte
// di layout e gli interruttori dei widget che compaiono su OGNI pagina
// (logo, chat AI, popup automatici). Vivevano nel codice, quindi spostare il
// logo o spegnere la chat voleva dire un deploy.
//
// Tutti i campi sono opzionali di proposito: il getter fonde la riga salvata
// sopra INITIAL_ASPETTO, cosi' una riga scritta prima che il campo esistesse
// non spegne un widget ne' azzera un'altezza. Per la stessa ragione i
// booleani NON possono essere usati come sentinella "riga configurata":
// `false` e' una scelta legittima dell'operatore.

/** Dove sta il logo nella barra in alto. */
export type LogoAlignment = 'left' | 'center' | 'right';

export interface AspettoCopy {
  // Logo del sito (barra in alto + footer)
  logo_url?: string;
  logo_alignment?: LogoAlignment;
  /** Altezza del logo in px sulla barra in alto (schermo grande / telefono). */
  logo_height_desktop?: number;
  logo_height_mobile?: number;
  footer_logo_height?: number;
  // Widget presenti su ogni pagina
  /** Bottone e finestra della chat DR7 AI in basso a destra. */
  chatbot_enabled?: boolean;
  /** Immagine del bottone della chat. */
  chatbot_avatar_url?: string;
  /** Popup di prenotazione che si apre da solo dopo qualche secondo. */
  auto_booking_popup_enabled?: boolean;
  /** Popup del tour in elicottero. */
  heli_tour_popup_enabled?: boolean;

  // ── Tema ────────────────────────────────────────────────────────────────
  // I colori e la coppia tipografica del sito. Il sito li applica come
  // VARIABILI CSS, non come classi: una classe Tailwind composta a runtime
  // non verrebbe generata in nessuno dei due progetti (stessa ragione
  // dell'altezza del logo, che infatti e' uno `style` e non una classe).
  //
  // La tipografia si sceglie fra poche coppie preparate invece che campo per
  // campo: e' l'accostamento a fare la differenza, e lasciarlo libero
  // significa poter rompere l'impaginazione con due tendine.
  /** Fondo della pagina. */
  tema_bg?: string;
  /** Superfici sollevate: schede, pannelli. */
  tema_surface?: string;
  /** Testo principale. */
  tema_ink?: string;
  /** Testo secondario. */
  tema_muted?: string;
  /** Accento metallico. Usarlo poco: e' un accento, non un tema. */
  tema_accent?: string;
  /** Coppia tipografica (display + interfaccia). */
  tema_font?: TemaFont;
  /** Durezza degli angoli. */
  tema_raggio?: TemaRaggio;
}

/**
 * Coppie tipografiche disponibili. Tutte da Google Fonts, quindi utilizzabili
 * senza licenza da acquistare. La prima e' quella di progetto.
 */
export type TemaFont = 'bodoni-jost' | 'playfair-jost' | 'cormorant-outfit' | 'italiana-jost';

export type TemaRaggio = 'vivo' | 'morbido' | 'tondo';

// ─── Confirmation Success page (booking + email fallback) ─────────────────
// `{total}` placeholder in rental_agency_footnote is replaced with the
// formatted total price at render time.
export interface ConfirmationSuccessCopy {
  // Booking branch
  booking_title_it: string; booking_title_en: string;
  booking_subtitle_it: string; booking_subtitle_en: string;
  booking_summary_heading_it: string; booking_summary_heading_en: string;
  booking_cta_account_it: string; booking_cta_account_en: string;
  // Car wash variant
  carwash_row_servizio_it: string; carwash_row_servizio_en: string;
  carwash_row_data_it: string; carwash_row_data_en: string;
  carwash_row_orario_it: string; carwash_row_orario_en: string;
  carwash_row_cliente_it: string; carwash_row_cliente_en: string;
  carwash_row_pagamento_it: string; carwash_row_pagamento_en: string;
  carwash_payment_online_it: string; carwash_payment_online_en: string;
  carwash_default_customer_it: string; carwash_default_customer_en: string;
  carwash_totale_pagato_it: string; carwash_totale_pagato_en: string;
  carwash_whatsapp_note_it: string; carwash_whatsapp_note_en: string;
  // Rental variant
  rental_row_veicolo_it: string; rental_row_veicolo_en: string;
  rental_row_ritiro_it: string; rental_row_ritiro_en: string;
  rental_row_riconsegna_it: string; rental_row_riconsegna_en: string;
  rental_row_luogo_it: string; rental_row_luogo_en: string;
  rental_row_pagamento_it: string; rental_row_pagamento_en: string;
  rental_time_connector_it: string; rental_time_connector_en: string;
  rental_payment_in_sede_it: string; rental_payment_in_sede_en: string;
  rental_payment_online_it: string; rental_payment_online_en: string;
  rental_totale_pagato_it: string; rental_totale_pagato_en: string;
  rental_totale_da_pagare_it: string; rental_totale_da_pagare_en: string;
  rental_agency_footnote_it: string; rental_agency_footnote_en: string;     // {total}
  // Email-confirmed fallback
  email_title_it: string; email_title_en: string;
  email_body_logged_in_it: string; email_body_logged_in_en: string;
  email_body_logged_out_it: string; email_body_logged_out_en: string;
  email_cta_logged_in_it: string; email_cta_logged_in_en: string;
  email_cta_logged_out_it: string; email_cta_logged_out_en: string;
}

// ─── Jet Search Results page (chrome only) ────────────────────────────────
export interface JetSearchResultsCopy {
  title_it: string; title_en: string;
  subtitle_connector_it: string; subtitle_connector_en: string;     // "to"
  passengers_suffix_it: string; passengers_suffix_en: string;       // "Passengers"
  modify_search_cta_it: string; modify_search_cta_en: string;
  airport_fallback: string;                                         // "N/A"
  empty_title_it: string; empty_title_en: string;
  empty_body_it: string; empty_body_en: string;
}

// ─── Check Email page (post-signup) ────────────────────────────────────────
export interface CheckEmailCopy {
  title_it: string; title_en: string;
  body_it: string; body_en: string;
  back_link_it: string; back_link_en: string;
}

// ─── Aviation Quote Request page (bilingual chrome only) ──────────────────
//
// IMPORTANT: the WhatsApp message TEMPLATE lives in admin > Messaggi di
// Sistema Pro under key `pro_aviation_quote_request` (NOT here). siteCopy
// holds only the page chrome (form labels, buttons, alerts, gate). The
// template body is loaded by the page via `getMessageTemplateBody()`.
export interface AviationQuoteCopy {
  // Loading + auth gate
  loading_it: string; loading_en: string;
  auth_title_it: string; auth_title_en: string;
  auth_body_it: string; auth_body_en: string;
  auth_login_cta_it: string; auth_login_cta_en: string;
  auth_signup_cta_it: string; auth_signup_cta_en: string;
  // Header (with {service} token)
  service_label_jet: string;          // "Jet Privato"
  service_label_helicopter: string;   // "Elicottero"
  header_title_template_it: string; header_title_template_en: string;
  header_subtitle_it: string; header_subtitle_en: string;
  // Form sections + fields
  section_customer_it: string; section_customer_en: string;
  section_flight_it: string; section_flight_en: string;
  field_name_label_it: string; field_name_label_en: string;
  field_name_placeholder_it: string; field_name_placeholder_en: string;
  field_email_label_it: string; field_email_label_en: string;
  field_email_placeholder_it: string; field_email_placeholder_en: string;
  field_phone_label_it: string; field_phone_label_en: string;
  field_phone_placeholder_it: string; field_phone_placeholder_en: string;
  field_departure_label_it: string; field_departure_label_en: string;
  field_departure_placeholder_it: string; field_departure_placeholder_en: string;
  field_arrival_label_it: string; field_arrival_label_en: string;
  field_arrival_placeholder_it: string; field_arrival_placeholder_en: string;
  field_departure_date_label_it: string; field_departure_date_label_en: string;
  field_return_date_label_it: string; field_return_date_label_en: string;
  field_passengers_label_it: string; field_passengers_label_en: string;
  field_notes_label_it: string; field_notes_label_en: string;
  field_notes_placeholder_it: string; field_notes_placeholder_en: string;
  // Submit + footer
  submit_idle_it: string; submit_idle_en: string;
  submit_submitting_it: string; submit_submitting_en: string;
  disclaimer_it: string; disclaimer_en: string;
  alert_success_it: string; alert_success_en: string;
  alert_error_it: string; alert_error_en: string;
  // WhatsApp recipient phone (template body now in system_messages).
  whatsapp_phone: string;
}

// ─── Franchising (IT-only sales page) ──────────────────────────────────────
//
// `{reviewCount}` placeholder in stats_lines is replaced at render time with
// the live Google reviews count.
export type FranchisingExpansionIcon = 'square' | 'diamond' | 'lines';

export type FranchisingBenefitIcon = 'check' | 'shield' | 'star';

export interface FranchisingExpansionLocation {
  id: string;
  icon: FranchisingExpansionIcon;
  name: string;
  name_it?: string; name_en?: string;
  description: string;
  description_it?: string; description_en?: string;
}

export interface FranchisingBenefit {
  id: string;
  icon: FranchisingBenefitIcon;
  title: string;
  title_it?: string; title_en?: string;
  description: string;
  description_it?: string; description_en?: string;
}

export interface FranchisingCopy {
  hero_h2: string;
  hero_h2_it?: string; hero_h2_en?: string;
  hero_p1: string;
  hero_p1_it?: string; hero_p1_en?: string;
  hero_p2: string;
  hero_p2_it?: string; hero_p2_en?: string;
  stats_heading: string;
  stats_heading_it?: string; stats_heading_en?: string;
  stats_lines: string[];               // supports {reviewCount}
  stats_lines_it?: string[]; stats_lines_en?: string[];
  stats_footer_main: string;
  stats_footer_main_it?: string; stats_footer_main_en?: string;
  stats_footer_sub: string;
  stats_footer_sub_it?: string; stats_footer_sub_en?: string;
  expansion_heading: string;
  expansion_heading_it?: string; expansion_heading_en?: string;
  expansion_locations: FranchisingExpansionLocation[];
  about_heading: string;
  about_heading_it?: string; about_heading_en?: string;
  about_paragraphs: string[];
  about_paragraphs_it?: string[]; about_paragraphs_en?: string[];
  benefits: FranchisingBenefit[];
  cta_heading: string;
  cta_heading_it?: string; cta_heading_en?: string;
  cta_intro: string;
  cta_intro_it?: string; cta_intro_en?: string;
  cta_box_main: string;
  cta_box_main_it?: string; cta_box_main_en?: string;
  cta_box_sub: string;
  cta_box_sub_it?: string; cta_box_sub_en?: string;
  contact_heading: string;
  contact_heading_it?: string; contact_heading_en?: string;
  contact_intro: string;
  contact_intro_it?: string; contact_intro_en?: string;
  contact_email: string;
  footer_statement: string;
  footer_statement_it?: string; footer_statement_en?: string;
}

// ─── Investitori (IT-only sales page) ──────────────────────────────────────
//
// The whole /investitori page is currently IT-only. Schema reflects that —
// single-string fields. Add EN siblings later if/when the page gets a
// language switcher.
export interface InvestitoriStrength {
  id: string;
  title: string;
  title_it?: string; title_en?: string;
  description: string;
  description_it?: string; description_en?: string;
}

export interface InvestitoriInfoItem {
  label: string;
  label_it?: string; label_en?: string;
  value: string;
  value_it?: string; value_en?: string;
}

export interface InvestitoriCopy {
  hero_title: string;
  hero_title_it?: string; hero_title_en?: string;
  hero_subtitle: string;
  hero_subtitle_it?: string; hero_subtitle_en?: string;
  intro_paragraphs: string[];
  intro_paragraphs_it?: string[]; intro_paragraphs_en?: string[];
  opportunity_heading: string;
  opportunity_heading_it?: string; opportunity_heading_en?: string;
  opportunity_paragraphs: string[];
  opportunity_paragraphs_it?: string[]; opportunity_paragraphs_en?: string[];
  strength_heading: string;
  strength_heading_it?: string; strength_heading_en?: string;
  strength_points: InvestitoriStrength[];
  cta_heading: string;
  cta_heading_it?: string; cta_heading_en?: string;
  cta_paragraphs: string[];
  cta_paragraphs_it?: string[]; cta_paragraphs_en?: string[];
  cta_button_label: string;
  cta_button_label_it?: string; cta_button_label_en?: string;
  cta_whatsapp_url: string;
  cta_email: string;
  info_heading: string;
  info_heading_it?: string; info_heading_en?: string;
  info_items: InvestitoriInfoItem[];
  info_footnote: string;
  info_footnote_it?: string; info_footnote_en?: string;
  legal_heading: string;
  legal_heading_it?: string; legal_heading_en?: string;
  legal_paragraphs: string[];
  legal_paragraphs_it?: string[]; legal_paragraphs_en?: string[];
}

// ─── Car Wash chrome (catalog stays in car_wash_services table) ────────────
//
// Same rule as Mechanical: the actual SERVICE catalog lives in
// `car_wash_services` (managed from admin > Catalogo Prime Wash, filter
// LAVAGGIO). siteCopy.carwash holds only the page CHROME — UI labels for
// plate entry, cart drawer, upsell overlay, etc.
export interface CarWashCopy {
  // Plate entry section
  plate_label_it: string; plate_label_en: string;
  plate_helper_it: string; plate_helper_en: string;
  plate_placeholder_it: string; plate_placeholder_en: string;
  plate_search_it: string; plate_search_en: string;
  plate_searching_it: string; plate_searching_en: string;
  plate_manual_prompt_it: string; plate_manual_prompt_en: string;
  plate_change_it: string; plate_change_en: string;
  // Service card
  add_to_cart_it: string; add_to_cart_en: string;
  // Cart drawer
  cart_title_it: string; cart_title_en: string;
  cart_empty_it: string; cart_empty_en: string;
  cart_remove_it: string; cart_remove_en: string;
  cart_total_it: string; cart_total_en: string;
  cart_checkout_it: string; cart_checkout_en: string;
  // Upsell overlay
  upsell_review_cart_it: string; upsell_review_cart_en: string;
  upsell_step1_title_it: string; upsell_step1_title_en: string;
  upsell_step1_text_it: string; upsell_step1_text_en: string;
  upsell_step2_title_it: string; upsell_step2_title_en: string;
  upsell_step2_text_it: string; upsell_step2_text_en: string;
  upsell_added_it: string; upsell_added_en: string;
  upsell_add_it: string; upsell_add_en: string;
}

// ─── Careers ────────────────────────────────────────────────────────────────
export interface CareersJob {
  id: string;
  title_it: string; title_en: string;
  location_it: string; location_en: string;
  type_it: string; type_en: string;
  description_it: string; description_en: string;
}

export interface CareersCopy {
  page_title_it: string; page_title_en: string;
  intro_it: string; intro_en: string;
  jobs_heading_it: string; jobs_heading_en: string;
  jobs: CareersJob[];
  apply_heading_it: string; apply_heading_en: string;
  apply_text_it: string; apply_text_en: string;     // supports inline markdown ([label](url))
  apply_email: string;
}

// ─── Press ──────────────────────────────────────────────────────────────────
export interface PressArticle {
  id: string;
  title: string;            // article titles usually stay in source language
  publication: string;
  date: string;
  summary_it: string; summary_en: string;
  link: string;
}

export interface PressCopy {
  page_title_it: string; page_title_en: string;
  subtitle_it: string; subtitle_en: string;
  inquiries_heading_it: string; inquiries_heading_en: string;
  inquiries_text_it: string; inquiries_text_en: string;
  inquiries_email_label_it: string; inquiries_email_label_en: string;
  inquiries_email: string;
  news_heading_it: string; news_heading_en: string;
  read_more_label_it: string; read_more_label_en: string;
  articles: PressArticle[];
  releases_heading_it: string; releases_heading_en: string;
  releases_text_it: string; releases_text_en: string;
}

// ─── Contact ────────────────────────────────────────────────────────────────
export interface ContactCopy {
  page_title_it: string; page_title_en: string;
  subtitle_it: string; subtitle_en: string;
  phone_label_it: string; phone_label_en: string;
  phone_display: string;
  phone_tel_url: string;
  whatsapp_label_it: string; whatsapp_label_en: string;
  whatsapp_button_it: string; whatsapp_button_en: string;
  whatsapp_url: string;
  email_label_it: string; email_label_en: string;
  email_address: string;
  hours_label_it: string; hours_label_en: string;
  hours_lines_it: string[]; hours_lines_en: string[];
  office_heading_it: string; office_heading_en: string;
  office_company_name: string;
  office_address_it: string; office_address_en: string;
  office_piva: string;
  map_title: string;
  map_title_it?: string; map_title_en?: string;
  map_iframe_url: string;
}

// ─── Legal pages (Privacy, Cookie, Rental Agreement, Terms) ────────────────
//
// Pages share one rich-content schema: an optional intro band + an
// ordered list of headed sections + an optional outro band. Each
// "block" inside a section / band uses the same shape as Cancellazione
// (paragraph variants + bullet lists). Inline emphasis + links are
// supported via a tiny markdown subset:
//   **bold**          →  <strong>bold</strong>
//   [label](url)      →  <a href="url" target="_blank">label</a>  (or mailto:)
// Anything else is rendered as plain text.
export type LegalPageId = 'privacy' | 'cookie' | 'rental_agreement' | 'terms';

export interface LegalSection {
  id: string;
  heading_it: string;
  heading_en: string;
  blocks: CancellazioneBlock[];
}

export interface LegalPageCopy {
  id: LegalPageId;
  enabled: boolean;             // false → page falls back to hardcoded JSX (used for Terms today)
  title_it: string;
  title_en: string;
  /** When true, the rendered "last updated" string prepends today's local date. */
  last_updated_dynamic: boolean;
  last_updated_label_it: string;   // e.g. "Ultimo aggiornamento" — used as prefix
  last_updated_label_en: string;
  intro_blocks: CancellazioneBlock[];
  sections: LegalSection[];
  outro_blocks: CancellazioneBlock[];
}

export interface LegalCopy {
  pages: LegalPageCopy[];
}

// ─── Footer ─────────────────────────────────────────────────────────────────
export type FooterSocialIcon = 'instagram' | 'tiktok' | 'facebook' | 'linkedin' | 'youtube' | 'x';

export interface FooterSocialLink {
  id: string;
  label: string;     // aria-label
  href: string;
  icon: FooterSocialIcon;
}

export interface FooterLink {
  id: string;
  label_it: string;
  label_en: string;
  to: string;        // internal route ("/about") OR full URL
  external?: boolean;
}

export interface FooterCopy {
  // Network band
  network_title: string;
  network_title_it?: string;
  network_title_en?: string;
  network_text_it: string;
  network_text_en: string;
  social_links: FooterSocialLink[];
  // Reviews band header
  reviews_title: string;
  reviews_title_it?: string;
  reviews_title_en?: string;
  reviews_text_it: string;
  reviews_text_en: string;
  // Contact band
  contact_title: string;
  contact_whatsapp_number: string;     // displayed text, e.g. "+39 345 790 5205"
  contact_whatsapp_url: string;        // wa.me URL
  contact_company_name: string;
  contact_legal_address_it: string;
  contact_legal_address_en: string;
  contact_operative_address_it: string;
  contact_operative_address_en: string;
  contact_capitale_sociale_it: string;
  contact_capitale_sociale_en: string;
  contact_piva: string;
  contact_disclaimer_it: string;       // "Società soggetta a..."
  contact_disclaimer_en: string;
  // Link rows (Division + Corporate + Legal)
  division_links: FooterLink[];
  corporate_links: FooterLink[];
  legal_links: FooterLink[];
  // Bottom band
  bottom_brand_line: string;           // "DR7 Cagliari – Global Mobility..."
  bottom_brand_line_it?: string;
  bottom_brand_line_en?: string;
  bottom_copyright: string;            // "© 2024 - 2026 DR7 Cagliari. All Rights Reserved."
  bottom_copyright_it?: string;
  bottom_copyright_en?: string;
}

export interface CancellazionePlaceholderValues {
  thresholdDays: number;
  refundPercent: number;
  penaltyPercent: number;
  /** Pre-formatted day word per language, e.g. "5 (cinque) giorni" or
   *  "5 (five) days". Computed by the page from thresholdDays + lang. */
  daysWord: string;
}

export const INITIAL_TEMA_FONT: Record<TemaFont, { nome: string; display: string; ui: string; google: string | null }> = {
  'bodoni-jost': {
    nome: 'Bodoni Moda + Jost',
    display: "'Bodoni Moda', 'Playfair Display', Georgia, serif",
    ui: "'Jost', system-ui, -apple-system, sans-serif",
    google: null, // gia' caricata in index.html
  },
  'playfair-jost': {
    nome: 'Playfair Display + Jost',
    display: "'Playfair Display', Georgia, serif",
    ui: "'Jost', system-ui, -apple-system, sans-serif",
    google: 'Playfair+Display:ital,wght@0,400..800;1,400..600',
  },
  'cormorant-outfit': {
    nome: 'Cormorant Garamond + Outfit',
    display: "'Cormorant Garamond', Georgia, serif",
    ui: "'Outfit', system-ui, -apple-system, sans-serif",
    google: 'Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=Outfit:wght@200..600',
  },
  'italiana-jost': {
    nome: 'Italiana + Jost',
    display: "'Italiana', Georgia, serif",
    ui: "'Jost', system-ui, -apple-system, sans-serif",
    google: 'Italiana',
  },
};

export const INITIAL_TEMA_RAGGIO: Record<TemaRaggio, { nome: string; xs: string; sm: string; md: string }> = {
  vivo:    { nome: 'Vivo (angoli netti)', xs: '0px', sm: '0px', md: '0px' },
  morbido: { nome: 'Morbido (di progetto)', xs: '2px', sm: '3px', md: '4px' },
  tondo:   { nome: 'Tondo', xs: '6px', sm: '10px', md: '14px' },
};

// ─── Defaults ────────────────────────────────────────────────────────────────
export const INITIAL_FAQ_ENTRIES: FaqEntry[] = [
  {
    id: 'requisiti-noleggio',
    question: 'Quali sono i requisiti per noleggiare un\'auto?',
    answer: 'Il conducente deve avere almeno 25 anni, essere in possesso di una patente di guida valida e fornire prova di copertura assicurativa completa. Per tutti i noleggi e\' richiesta una cauzione.',
  },
  {
    id: 'come-funziona-dr7-club',
    question: 'Come funziona la membership DR7 Club?',
    answer: 'La nostra membership esclusiva offre accesso a tariffe preferenziali, prenotazione prioritaria, servizio concierge 24/7 e inviti a eventi privati. Puoi scegliere fra fatturazione mensile o annuale su tre tier diversi.',
  },
  {
    id: 'politica-cancellazione',
    question: 'Qual e\' la politica di cancellazione?',
    answer: 'Le politiche di cancellazione variano in base al servizio prenotato. Per i dettagli specifici, consulta il Contratto di Noleggio fornito al momento della conferma o contatta il nostro supporto.',
  },
  {
    id: 'metodi-pagamento',
    question: 'Quali metodi di pagamento accettate?',
    answer: 'Accettiamo le principali carte di credito (Visa, MasterCard, American Express) e una selezione di criptovalute. Le opzioni di pagamento vengono presentate in fase di checkout.',
  },
];

export const INITIAL_FAQ: FaqCopy = {
  eyebrow_it: 'DR7 · Supporto',
  eyebrow_en: 'DR7 · Support',
  page_title_it: 'Domande Frequenti',
  page_title_en: 'Frequently Asked Questions',
  subtitle_it: 'Le risposte alle domande piu’ frequenti su noleggio, membership e pagamenti.',
  subtitle_en: 'Answers to the most common questions on rentals, membership, and payments.',
  entries: INITIAL_FAQ_ENTRIES,
};

// ─── Default Header seed ──────────────────────────────────────────────────
export const INITIAL_HEADER: HeaderCopy = {
  logo_alt: 'DR7 Logo',
  open_menu_aria_it: 'Apri menu', open_menu_aria_en: 'Open menu',
  close_menu_aria_it: 'Chiudi menu', close_menu_aria_en: 'Close menu',
  explore_label_it: 'MENU', explore_label_en: 'MENU',
  credit_wallet_label_it: 'Credit Wallet', credit_wallet_label_en: 'Credit Wallet',
  drawer_book_cta_it: 'Prenota Ora', drawer_book_cta_en: 'Book Now',
  flotta_label_it: 'La Nostra Flotta', flotta_label_en: 'Our Fleet',
  servizi_heading_it: 'Servizi & Mobilità di Lusso', servizi_heading_en: 'Services & Luxury Mobility',
  esperienze_heading_it: 'Esperienze & Accesso Esclusivo', esperienze_heading_en: 'Experiences & Exclusive Access',
  prime_wash_heading_it: 'Lavaggio & Meccanica', prime_wash_heading_en: 'Car Wash & Mechanics',
  business_heading_it: 'Business & Corporate', business_heading_en: 'Business & Corporate',
  digital_heading_it: 'Innovazione Digitale', digital_heading_en: 'Digital Innovation',
  contact_cta_it: 'Contattaci', contact_cta_en: 'Contact us',
  popup_title_it: 'Prenota Ora', popup_title_en: 'Book Now',
  popup_subtitle_it: 'Seleziona date e orari', popup_subtitle_en: 'Select dates and times',
};

/**
 * Valori di fabbrica: il logo centrato e tutti i widget accesi, cioe' com'era
 * dr7.app prima che la sezione esistesse. Esportati perche' header e footer li
 * usano come stato iniziale sincrono: la barra si disegna subito, senza un
 * fotogramma senza logo in attesa della config.
 */
export const INITIAL_ASPETTO: Required<AspettoCopy> = {
  logo_url: '/DR7logo1.png',
  logo_alignment: 'center',
  logo_height_desktop: 84,
  logo_height_mobile: 72,
  footer_logo_height: 48,
  chatbot_enabled: true,
  chatbot_avatar_url: '/Valerio.jpg',
  auto_booking_popup_enabled: true,
  heli_tour_popup_enabled: true,
  tema_bg: '#08090A',
  tema_surface: '#131416',
  tema_ink: '#F6F3ED',
  tema_muted: '#A19C92',
  tema_accent: '#C9BEA8',
  tema_font: 'bodoni-jost',
  tema_raggio: 'morbido',
};

// ─── Default Locations seed (mirrors current constants.ts arrays) ──────
export const INITIAL_LOCATIONS: LocationsCopy = {
  airports: [
    { iata: 'CAG', name: 'Cagliari Elmas Airport', city: 'Cagliari' },
    { iata: 'OLB', name: 'Olbia Costa Smeralda Airport', city: 'Olbia' },
    { iata: 'AHO', name: 'Alghero-Fertilia Airport', city: 'Alghero' },
    { iata: 'FCO', name: 'Leonardo da Vinci-Fiumicino Airport', city: 'Rome' },
    { iata: 'LIN', name: 'Linate Airport', city: 'Milan' },
    { iata: 'NCE', name: 'Nice Côte d\'Azur Airport', city: 'Nice' },
    { iata: 'LBG', name: 'Paris-Le Bourget Airport', city: 'Paris' },
    { iata: 'LTN', name: 'London Luton Airport', city: 'London' },
    { iata: 'IBZ', name: 'Ibiza Airport', city: 'Ibiza' },
  ],
  pickup_locations: [
    { id: 'dr7_cagliari', label_it: 'DR7 Cagliari — Viale Marconi 229, 09131', label_en: 'DR7 Cagliari — Viale Marconi 229, 09131' },
    { id: 'home_delivery', label_it: 'Consegna a domicilio', label_en: 'Home Delivery' },
  ],
  return_locations: [
    { id: 'dr7_cagliari', label_it: 'DR7 Cagliari — Viale Marconi 229, 09131', label_en: 'DR7 Cagliari — Viale Marconi 229, 09131' },
    { id: 'home_delivery', label_it: 'Ritiro/riconsegna a domicilio', label_en: 'Home Pickup' },
  ],
  yacht_marinas: [
    { id: 'marina_di_cagliari', label_it: 'Marina di Cagliari', label_en: 'Marina di Cagliari' },
    { id: 'porto_cervo', label_it: 'Marina di Porto Cervo', label_en: 'Marina di Porto Cervo' },
  ],
  heli_departure_points: [
    { id: 'cagliari', name: 'Cagliari Heliport' },
    { id: 'porto_cervo', name: 'Porto Cervo Heliport' },
    { id: 'forte_village', name: 'Forte Village Resort' },
  ],
  heli_arrival_points: [
    { id: 'cagliari', name: 'Cagliari Heliport' },
    { id: 'porto_cervo', name: 'Porto Cervo Heliport' },
    { id: 'forte_village', name: 'Forte Village Resort' },
    { id: 'cala_di_volpe', name: 'Hotel Cala di Volpe' },
    { id: 'villasimius', name: 'Villasimius Private Pad' },
  ],
};

// ─── Default Yacht/Jet/Heli seed (mirrors current constants.ts arrays) ──
export const INITIAL_AVIATION_MARINE: AviationMarineCopy = {
  yachts: [
    {
      id: 'yacht-1',
      name: 'Luxury Yacht',
      image: '/yacht1.jpeg',
      images: ['/yacht1.jpeg'],
      price_per_day_eur: 11000,
      specs: [
        { key: 'guests', value: '12' },
        { key: 'length', value: '70m' },
        { key: 'cabins', value: '6' },
      ],
    },
  ],
  jets: [
    {
      id: 'jet-1',
      name: 'Cessna Citation Mustang',
      image: '/jet1.jpeg',
      images: ['/jet1.jpeg', '/jet2.jpeg'],
      pets_allowed: false,
      smoking_allowed: false,
      specs: [
        { key: 'passengers', value: '4' },
        { key: 'year', value: '2008' },
        { key: 'type', value: 'Entry Level Jet' },
      ],
    },
    {
      id: 'jet-2',
      name: 'Cessna Citation CJ2',
      image: '/jet3.jpeg',
      images: ['/jet3.jpeg', '/jet4.jpeg'],
      pets_allowed: false,
      smoking_allowed: false,
      specs: [
        { key: 'passengers', value: '6' },
        { key: 'year', value: '2004' },
        { key: 'type', value: 'Light Jet' },
      ],
    },
  ],
  helis: [
    {
      id: 'heli-1',
      name: 'Airbus H125',
      image: '/heli1.jpeg',
      specs: [
        { key: 'passengers', value: '5' },
        { key: 'range', value: '300 nm' },
        { key: 'speed', value: '150 kt' },
      ],
    },
    {
      id: 'heli-2',
      name: 'Bell 505 Jet Ranger X',
      image: '/heli2.jpeg',
      specs: [
        { key: 'passengers', value: '5' },
        { key: 'range', value: '300 nm' },
        { key: 'speed', value: '150 kt' },
      ],
    },
  ],
};

// ─── Default DR7 Club plan seed (mirrors current constants.ts MEMBERSHIP_TIERS) ──
export const INITIAL_DR7_CLUB_PLAN: Dr7ClubPlanCopy = {
  id: 'dr7club',
  name_it: 'DR7 Club',
  name_en: 'DR7 Club',
  monthly_eur: 4.90,
  annually_eur: 39,
  features_it: [
    'Sistema wallet reward attivo su ogni prenotazione',
    '2% di cashback su prenotazioni con pagamento anticipato (fino al 4%)',
    '1% di cashback su prenotazioni con acconto (30%)',
    '2% di cashback su servizi extra',
    '3% di cashback su servizi Lavaggio & Meccanica',
    'Accesso prioritario alle prenotazioni',
    'Inviti a eventi esclusivi DR7 e serate partner',
  ],
  features_en: [
    'Wallet reward system activated on every booking',
    '2% cashback on full prepayment bookings (up to 4%)',
    '1% cashback on deposit bookings (30% advance)',
    '2% cashback on extra services',
    '3% cashback on Car Wash & Mechanics services',
    'Priority booking access',
    'Access to "DR7 Members" WhatsApp group for flash offers',
    'Invitations to exclusive DR7 events and partner evenings',
  ],
};

// ─── Default Payment Cancel seed ────────────────────────────────────────
export const INITIAL_PAYMENT_CANCEL: PaymentCancelCopy = {
  title_it: 'Pagamento Annullato', title_en: 'Payment Cancelled',
  body_it: 'Il pagamento è stato annullato. Nessun addebito è stato effettuato.',
  body_en: 'The payment was cancelled. No charge was made.',
  cta_home_it: 'Torna alla pagina iniziale', cta_home_en: 'Back to Home',
  cta_retry_it: 'Riprova il Pagamento', cta_retry_en: 'Retry Payment',
};

// ─── Default BookingSearchBox seed ──────────────────────────────────────
export const INITIAL_BOOKING_SEARCH_BOX: BookingSearchBoxCopy = {
  title_it: 'Prenota il tuo veicolo', title_en: 'Book your vehicle',
  pickup_location_label_it: 'Luogo di ritiro', pickup_location_label_en: 'Pickup location',
  pickup_location_placeholder_it: 'Aeroporto, città, indirizzo...',
  pickup_location_placeholder_en: 'Airport, city, address...',
  same_return_note_it: 'Riconsegna nella sede principale Viale Marconi 229, Cagliari 09131',
  same_return_note_en: 'Return to the main office Viale Marconi 229, Cagliari 09131',
  return_location_label_it: 'Luogo di riconsegna', return_location_label_en: 'Return location',
  return_location_placeholder_it: 'Aeroporto, città, indirizzo...',
  return_location_placeholder_en: 'Airport, city, address...',
  pickup_section_label_it: 'Ritiro', pickup_section_label_en: 'Pickup',
  return_section_label_it: 'Restituzione', return_section_label_en: 'Return',
  date_placeholder_it: 'Seleziona data', date_placeholder_en: 'Select date',
  closed_message_it: 'Chiusi (domenica o festivo)', closed_message_en: 'Closed (Sunday or holiday)',
  rate_warning_title_it: 'La tariffa può subire variazioni',
  rate_warning_title_en: 'The rate may vary',
  rate_warning_body_it: 'La restituzione del veicolo è prevista entro 1 ora e 30 minuti prima dell\'orario di uscita, al fine di evitare eventuali variazioni.',
  rate_warning_body_en: 'Vehicle return is expected within 1 hour and 30 minutes before pickup time to avoid any changes.',
  delivery_calc_loading_it: 'Calcolo costo consegna...', delivery_calc_loading_en: 'Calculating delivery cost...',
  delivery_label_it: 'Consegna a domicilio', delivery_label_en: 'Home delivery',
  delivery_breakdown_consegna_it: 'Consegna', delivery_breakdown_consegna_en: 'Delivery',
  delivery_breakdown_riconsegna_it: 'Riconsegna', delivery_breakdown_riconsegna_en: 'Return',
  search_cta_it: 'Cerca Auto Disponibili', search_cta_en: 'Search Available Cars',
  err_pickup_date_required_it: 'Seleziona la data di ritiro',
  err_pickup_date_required_en: 'Select the pickup date',
  err_return_date_required_it: 'Seleziona la data di restituzione',
  err_return_date_required_en: 'Select the return date',
  err_blocked_pickup_it: 'Data ritiro non disponibile (domenica o festivo)',
  err_blocked_pickup_en: 'Pickup date unavailable (Sunday or holiday)',
  err_blocked_return_it: 'Data restituzione non disponibile (domenica o festivo)',
  err_blocked_return_en: 'Return date unavailable (Sunday or holiday)',
  err_return_before_pickup_it: 'Data restituzione deve essere dopo il ritiro',
  err_return_before_pickup_en: 'Return date must be after pickup',
  err_return_time_before_pickup_it: 'Orario restituzione deve essere dopo il ritiro',
  err_return_time_before_pickup_en: 'Return time must be after pickup',
};

// ─── Default Registrazione Cliente seed ─────────────────────────────────
export const INITIAL_REGISTRAZIONE_CLIENTE: RegistrazioneClienteCopy = {
  intro_title_it: 'Registrazione Cliente',
  intro_title_en: 'Customer Registration',
  intro_subtitle_it: 'Compila i tuoi dati per completare la registrazione DR7',
  intro_subtitle_en: 'Fill in your details to complete your DR7 registration',
  tipo_persona_fisica_it: 'Persona Fisica', tipo_persona_fisica_en: 'Individual',
  tipo_azienda_it: 'Azienda', tipo_azienda_en: 'Company',
  tipo_pa_it: 'Pubblica Amm.', tipo_pa_en: 'Public Admin.',
  section_1_tipo_it: '1. Tipo Cliente', section_1_tipo_en: '1. Client Type',
  section_2_anagrafica_it: '2. Dati Anagrafici', section_2_anagrafica_en: '2. Personal Data',
  section_2_azienda_it: '2. Dati Azienda', section_2_azienda_en: '2. Company Data',
  section_2_pa_it: '2. Pubblica Amministrazione', section_2_pa_en: '2. Public Administration',
  section_3_residenza_it: '3. Residenza', section_3_residenza_en: '3. Residence',
  section_3_sede_it: '3. Sede', section_3_sede_en: '3. Address',
  section_4_contatti_it: '4. Contatti', section_4_contatti_en: '4. Contacts',
  section_docs_it: '✓ Documenti', section_docs_en: '✓ Documents',
  required_hint_it: 'I campi contrassegnati con * sono obbligatori.',
  required_hint_en: 'Fields marked with * are required.',
  verifica_link_it: 'Verifica link…', verifica_link_en: 'Verifying link…',
  invalid_title_it: 'Link non utilizzabile', invalid_title_en: 'Link not usable',
  invalid_reason_expired_it: 'Il link è scaduto.', invalid_reason_expired_en: 'The link has expired.',
  invalid_reason_used_it: 'Questo link è già stato utilizzato.',
  invalid_reason_used_en: 'This link has already been used.',
  invalid_reason_revoked_it: 'Il link è stato revocato.', invalid_reason_revoked_en: 'The link has been revoked.',
  invalid_reason_fallback_it: 'Link non valido.', invalid_reason_fallback_en: 'Invalid link.',
  invalid_reason_incomplete_it: 'Link incompleto', invalid_reason_incomplete_en: 'Incomplete link',
  invalid_reason_validation_it: 'Errore validazione', invalid_reason_validation_en: 'Validation error',
  invalid_help_it: 'Contatta DR7 per un nuovo link di registrazione.',
  invalid_help_en: 'Contact DR7 for a new registration link.',
  done_title_it: 'Registrazione completata', done_title_en: 'Registration complete',
  done_body_it: 'Grazie. Il team DR7 verificherà i documenti caricati al più presto.',
  done_body_en: 'Thank you. The DR7 team will verify the uploaded documents as soon as possible.',
  docs_intro_it: 'Carica i tuoi documenti. Saranno verificati dal team DR7 prima di confermare la registrazione. Formati: JPG, PNG, PDF (max 10 MB ciascuno).',
  docs_intro_en: 'Upload your documents. They will be verified by the DR7 team before confirming the registration. Formats: JPG, PNG, PDF (max 10 MB each).',
  docs_label_identity_it: "Carta d'identità o Passaporto",
  docs_label_identity_en: 'ID Card or Passport',
  docs_label_license_it: 'Patente di guida', docs_label_license_en: 'Driving licence',
  docs_label_codice_fiscale_it: 'Codice Fiscale / Tessera Sanitaria',
  docs_label_codice_fiscale_en: 'Tax Code / Health Card',
  docs_chip_uploaded_it: '✓ caricato', docs_chip_uploaded_en: '✓ uploaded',
  docs_chip_uploading_it: 'caricamento…', docs_chip_uploading_en: 'uploading…',
  docs_chip_remove_it: 'rimuovi', docs_chip_remove_en: 'remove',
  cta_submit_it: 'Continua →', cta_submit_en: 'Continue →',
  cta_submitting_it: 'Invio…', cta_submitting_en: 'Submitting…',
  cta_skip_docs_it: 'Salta i documenti per ora', cta_skip_docs_en: 'Skip documents for now',
  cta_upload_selected_it: 'Carica selezionati', cta_upload_selected_en: 'Upload selected',
  cta_finish_it: 'Concludi', cta_finish_en: 'Finish',
  err_missing_prefix_it: 'Campi mancanti: {list}', err_missing_prefix_en: 'Missing fields: {list}',
  err_phone_invalid_it: 'Numero di telefono non valido', err_phone_invalid_en: 'Invalid phone number',
  err_email_invalid_it: 'Email non valida', err_email_invalid_en: 'Invalid email',
  err_cf_length_it: 'Codice Fiscale deve essere di 16 caratteri',
  err_cf_length_en: 'Tax code must be 16 characters',
  err_piva_length_it: 'P.IVA deve essere di 11 cifre',
  err_piva_length_en: 'VAT number must be 11 digits',
  // Persona Fisica fields
  field_nome_it: 'Nome', field_nome_en: 'First Name',
  field_cognome_it: 'Cognome', field_cognome_en: 'Last Name',
  field_cf_label_it: 'CODICE FISCALE *', field_cf_label_en: 'TAX CODE *',
  field_cf_placeholder: 'ABCDEF12G34H567I',
  field_sesso_label_it: 'Sesso', field_sesso_label_en: 'Gender',
  field_sesso_default_it: 'Seleziona…', field_sesso_default_en: 'Select…',
  field_sesso_m_it: 'Maschio', field_sesso_m_en: 'Male',
  field_sesso_f_it: 'Femmina', field_sesso_f_en: 'Female',
  field_birth_date_it: 'Data di Nascita', field_birth_date_en: 'Date of Birth',
  field_birth_city_it: 'Luogo di Nascita', field_birth_city_en: 'Place of Birth',
  field_birth_city_placeholder_it: 'es. Cagliari, Torino…', field_birth_city_placeholder_en: 'e.g. Cagliari, Turin…',
  field_birth_province_it: 'Provincia di Nascita', field_birth_province_en: 'Province of Birth',
  field_birth_province_placeholder_it: 'CA (EE se nato all\'estero)', field_birth_province_placeholder_en: 'CA (EE if born abroad)',
  // Azienda
  field_ragione_sociale_it: 'Ragione Sociale', field_ragione_sociale_en: 'Company Name',
  field_piva_it: 'P.IVA', field_piva_en: 'VAT Number',
  field_piva_placeholder_it: '11 cifre', field_piva_placeholder_en: '11 digits',
  field_pec_no_sdi_it: 'PEC (se nessun Codice SDI)', field_pec_no_sdi_en: 'PEC (if no SDI code)',
  field_pec_placeholder: 'azienda@pec.it',
  field_sdi_no_pec_it: 'Codice Destinatario SDI (se nessuna PEC)',
  field_sdi_no_pec_en: 'SDI Recipient Code (if no PEC)',
  field_sdi_placeholder_it: '7 caratteri', field_sdi_placeholder_en: '7 characters',
  field_cf_rappresentante_it: 'Codice Fiscale Rappresentante',
  field_cf_rappresentante_en: 'Representative Tax Code',
  // PA
  field_ente_ufficio_it: 'Ente / Ufficio', field_ente_ufficio_en: 'Agency / Office',
  field_codice_univoco_it: 'Codice Univoco IPA', field_codice_univoco_en: 'IPA Unique Code',
  field_codice_univoco_placeholder_it: '6 caratteri', field_codice_univoco_placeholder_en: '6 characters',
  field_cf_ente_it: 'Codice Fiscale Ente', field_cf_ente_en: 'Agency Tax Code',
  field_pec_simple_it: 'PEC', field_pec_simple_en: 'PEC',
  // Residenza/Sede
  field_indirizzo_it: 'Indirizzo', field_indirizzo_en: 'Address',
  field_indirizzo_placeholder_it: 'Via / Viale / Corso…', field_indirizzo_placeholder_en: 'Street / Avenue…',
  field_civico_it: 'Civico', field_civico_en: 'Street Number',
  field_civico_placeholder_it: 'es. 12/A', field_civico_placeholder_en: 'e.g. 12/A',
  field_citta_it: 'Città', field_citta_en: 'City',
  field_citta_placeholder_it: 'es. Cagliari', field_citta_placeholder_en: 'e.g. Cagliari',
  field_provincia_it: 'Provincia', field_provincia_en: 'Province',
  field_provincia_placeholder_it: 'es. CA', field_provincia_placeholder_en: 'e.g. CA',
  field_cap_it: 'CAP', field_cap_en: 'ZIP',
  field_cap_placeholder_it: '5 cifre', field_cap_placeholder_en: '5 digits',
  field_nazione_it: 'Nazione', field_nazione_en: 'Country',
  field_nazione_placeholder: 'IT',
  // Contatti
  field_telefono_it: 'Telefono', field_telefono_en: 'Phone',
  field_telefono_placeholder: '+39 333 1234567',
  field_email_it: 'Email', field_email_en: 'Email',
  field_email_placeholder: 'nome@esempio.com',
};

// ─── Default Firma seed (contract e-signature OTP flow) ─────────────────
export const INITIAL_FIRMA: FirmaCopy = {
  header_pill_it: 'Firma Elettronica', header_pill_en: 'Electronic Signature',
  expired_title_it: 'Link Scaduto', expired_title_en: 'Link Expired',
  expired_body_it: 'Il link di firma è scaduto. Contatta DR7 per ricevere un nuovo link.',
  expired_body_en: 'The signature link has expired. Contact DR7 to receive a new link.',
  error_title_it: 'Errore', error_title_en: 'Error',
  pdf_section_title_it: 'Documento da firmare', pdf_section_title_en: 'Document to sign',
  pdf_pages_suffix_it: 'pagine', pdf_pages_suffix_en: 'pages',
  pdf_page_overlay_template_it: 'Pagina {i} di {n}', pdf_page_overlay_template_en: 'Page {i} of {n}',
  pdf_page_alt_template_it: 'Pagina {i}', pdf_page_alt_template_en: 'Page {i}',
  pdf_iframe_title_it: 'Contratto PDF', pdf_iframe_title_en: 'Contract PDF',
  pdf_loading_it: 'Caricamento documento...', pdf_loading_en: 'Loading document...',
  contract_loading_it: 'Caricamento contratto...', contract_loading_en: 'Loading contract...',
  contract_number_prefix_it: 'Contratto', contract_number_prefix_en: 'Contract',
  label_cliente_it: 'Cliente', label_cliente_en: 'Customer',
  label_veicolo_it: 'Veicolo', label_veicolo_en: 'Vehicle',
  label_ritiro_it: 'Ritiro', label_ritiro_en: 'Pickup',
  label_riconsegna_it: 'Riconsegna', label_riconsegna_en: 'Return',
  na_fallback_it: 'N/A', na_fallback_en: 'N/A',
  otp_step1_title_it: 'Firma il Contratto', otp_step1_title_en: 'Sign the Contract',
  otp_step1_body_template_it: 'Per procedere con la firma, invieremo un codice di verifica a {email}',
  otp_step1_body_template_en: 'To proceed with signing, we will send a verification code to {email}',
  otp_step1_cta_it: 'Invia Codice di Verifica', otp_step1_cta_en: 'Send Verification Code',
  otp_sending_it: 'Invio codice di verifica...', otp_sending_en: 'Sending verification code...',
  otp_step2_title_it: 'Inserisci Codice OTP', otp_step2_title_en: 'Enter OTP Code',
  otp_step2_body_template_it: 'Abbiamo inviato un codice a 6 cifre a {email}',
  otp_step2_body_template_en: 'We sent a 6-digit code to {email}',
  otp_attempts_template_it: 'Tentativi rimanenti: {attempts}',
  otp_attempts_template_en: 'Attempts remaining: {attempts}',
  otp_verify_cta_it: 'Verifica Codice', otp_verify_cta_en: 'Verify Code',
  otp_verifying_it: 'Verifica in corso...', otp_verifying_en: 'Verifying...',
  otp_resend_it: 'Non hai ricevuto il codice? Invia di nuovo',
  otp_resend_en: 'Didn\'t receive the code? Resend',
  signing_step_title_it: 'Conferma Firma', signing_step_title_en: 'Confirm Signature',
  signing_identity_verified_it: 'Identità verificata con successo',
  signing_identity_verified_en: 'Identity successfully verified',
  signing_ack_template_1_it: 'Io, {name}, dichiaro di aver preso visione del contratto n. {num} e di approvarne integralmente il contenuto.',
  signing_ack_template_1_en: 'I, {name}, declare that I have reviewed contract no. {num} and fully approve its content.',
  signing_ack_template_2_it: 'Confermo che la firma viene apposta volontariamente tramite verifica OTP all\'indirizzo email {email}.',
  signing_ack_template_2_en: 'I confirm the signature is applied voluntarily via OTP verification at the email address {email}.',
  signing_terms_checkbox_it: 'Accetto i termini e le condizioni del contratto e confermo la mia volontà di firmare elettronicamente questo documento.',
  signing_terms_checkbox_en: 'I accept the terms and conditions of the contract and confirm my willingness to electronically sign this document.',
  signing_submit_cta_it: 'Firma il Documento', signing_submit_cta_en: 'Sign the Document',
  signed_title_it: 'Documento Firmato', signed_title_en: 'Document Signed',
  signed_body_template_it: 'Il contratto è stato firmato con successo il {date}.',
  signed_body_template_en: 'The contract was successfully signed on {date}.',
  signed_email_note_it: 'Riceverai una copia del contratto firmato via email.',
  signed_email_note_en: 'You will receive a copy of the signed contract via email.',
  signed_download_cta_it: 'Scarica Contratto Firmato', signed_download_cta_en: 'Download Signed Contract',
  err_load_fallback_it: 'Errore nel caricamento', err_load_fallback_en: 'Loading error',
  err_load_contract_it: 'Impossibile caricare i dati del contratto',
  err_load_contract_en: 'Unable to load contract data',
  err_send_otp_it: 'Errore nell\'invio del codice OTP',
  err_send_otp_en: 'Error sending OTP code',
  err_incomplete_code_it: 'Inserisci il codice completo a 6 cifre',
  err_incomplete_code_en: 'Enter the complete 6-digit code',
  err_verify_otp_it: 'Errore nella verifica del codice',
  err_verify_otp_en: 'Error verifying the code',
  err_terms_required_it: 'Devi accettare i termini per procedere',
  err_terms_required_en: 'You must accept the terms to proceed',
  err_signing_it: 'Errore durante la firma del documento',
  err_signing_en: 'Error while signing the document',
};

// ─── Default Token seed (Coming Soon landing) ───────────────────────────
export const INITIAL_TOKEN: TokenCopy = {
  hero_title_it: 'DR7 TOKEN', hero_title_en: 'DR7 TOKEN',
  hero_eyebrow_it: 'Prossimamente', hero_eyebrow_en: 'Coming Soon',
  body_message_it: 'Il sistema DR7 Token è in fase di sviluppo. Tornate presto per scoprire la moneta digitale del lusso reale.',
  body_message_en: 'The DR7 Token system is under development. Come back soon to discover the digital currency of real luxury.',
  cta_button_it: 'Torna alla pagina iniziale', cta_button_en: 'Back to Home',
};

// ─── Default Credit Wallet seed ──────────────────────────────────────────
export const INITIAL_CREDIT_WALLET: CreditWalletCopy = {
  hero_title_eyebrow_it: 'DR7 CREDIT WALLET', hero_title_eyebrow_en: 'DR7 CREDIT WALLET',
  hero_subtitle_it: 'Ricarica. Guadagna. Vivi l\'esperienza DR7.',
  hero_subtitle_en: 'Top up. Earn. Live the DR7 experience.',
  hero_intro_it: 'Il sistema di credito flessibile che premia la tua fiducia. Acquista crediti DR7 e ricevi bonus fino al 100%.',
  hero_intro_en: 'The flexible credit system that rewards your trust. Buy DR7 credits and receive bonuses up to 100%.',
  benefit_extra_title_it: 'Fino al 100% Extra', benefit_extra_title_en: 'Up to 100% Extra',
  benefit_extra_body_it: 'Credito bonus a seconda del pacchetto scelto',
  benefit_extra_body_en: 'Bonus credit depending on the package you choose',
  benefit_no_expiry_title_it: 'Nessuna Scadenza', benefit_no_expiry_title_en: 'No Expiration',
  benefit_no_expiry_body_it: 'Il credito rimane sempre disponibile nel tuo profilo',
  benefit_no_expiry_body_en: 'The credit stays available in your profile, forever',
  benefit_secure_title_it: '100% Sicuro', benefit_secure_title_en: '100% Secure',
  benefit_secure_body_it: 'Pagamenti certificati e controllati',
  benefit_secure_body_en: 'Certified and verified payments',
  services_heading_it: 'Il credito può essere utilizzato per:',
  services_heading_en: 'The credit can be used for:',
  services_body_it: 'Noleggi di auto e veicoli di lusso, lavaggi premium, servizi meccanici, esperienze esclusive — tutta l\'offerta DR7.',
  services_body_en: 'Luxury car and vehicle rentals, premium washes, mechanical services, exclusive experiences — the entire DR7 offering.',
  services_no_expiry_it: 'Il credito non ha scadenza',
  services_no_expiry_en: 'The credit never expires',
  packages_section_label_it: 'SCEGLI IL TUO PACCHETTO:',
  packages_section_label_en: 'CHOOSE YOUR PACKAGE:',
  packages_filter_all_it: 'Tutti i Pacchetti', packages_filter_all_en: 'All Packages',
  promo_line1_it: 'CREDITO IMMEDIATO. NESSUNA SCADENZA.',
  promo_line1_en: 'INSTANT CREDIT. NO EXPIRATION.',
  promo_line2_it: 'SOLO VANTAGGI. SOLO DR7.',
  promo_line2_en: 'ONLY ADVANTAGES. ONLY DR7.',
  advantages_heading_it: 'VANTAGGI DEL DR7 CREDIT WALLET',
  advantages_heading_en: 'DR7 CREDIT WALLET BENEFITS',
  advantage_1_title_it: 'Risparmio Immediato', advantage_1_title_en: 'Instant Savings',
  advantage_1_body_it: 'Bonus credit aggiuntivo applicato istantaneamente al momento della ricarica.',
  advantage_1_body_en: 'Bonus credit applied instantly when you top up.',
  advantage_2_title_it: 'Massima Flessibilità', advantage_2_title_en: 'Total Flexibility',
  advantage_2_body_it: 'Utilizza il credito per qualunque servizio DR7, in qualunque momento.',
  advantage_2_body_en: 'Use the credit on any DR7 service, whenever you want.',
  advantage_3_title_it: 'Pagamento Veloce', advantage_3_title_en: 'Fast Checkout',
  advantage_3_body_it: 'Salda le prenotazioni con un clic usando il tuo wallet DR7.',
  advantage_3_body_en: 'Settle bookings in one click using your DR7 wallet.',
  advantage_4_title_it: 'Storico Completo', advantage_4_title_en: 'Full History',
  advantage_4_body_it: 'Ogni ricarica e ogni utilizzo sono tracciati e consultabili dall\'account.',
  advantage_4_body_en: 'Every top-up and every charge is tracked and visible from your account.',
  transparency_heading_it: 'TRASPARENZA E SICUREZZA',
  transparency_heading_en: 'TRANSPARENCY & SECURITY',
  transparency_bullet_1_it: 'Pagamenti gestiti tramite gateway certificato Nexi.',
  transparency_bullet_1_en: 'Payments handled via the certified Nexi gateway.',
  transparency_bullet_2_it: 'Crediti garantiti, sempre disponibili sul tuo profilo.',
  transparency_bullet_2_en: 'Credits guaranteed, always available on your profile.',
  transparency_bullet_3_it: 'Fatturazione automatica conforme alla normativa fiscale italiana.',
  transparency_bullet_3_en: 'Automated invoicing compliant with Italian tax law.',
  cta_title_it: 'ATTIVA ORA IL TUO WALLET DR7',
  cta_title_en: 'ACTIVATE YOUR DR7 WALLET NOW',
  cta_subtitle_it: 'Scegli il pacchetto più adatto a te e inizia subito a risparmiare sui servizi DR7.',
  cta_subtitle_en: 'Choose the package that fits you best and start saving on DR7 services right away.',
  cta_button_it: 'Scegli il Tuo Pacchetto', cta_button_en: 'Choose Your Package',
  card_popular_badge_it: 'PIÙ SCELTO', card_popular_badge_en: 'MOST POPULAR',
  card_recharge_label_it: 'Ricarichi', card_recharge_label_en: 'You recharge',
  card_receive_label_it: 'Ricevi', card_receive_label_en: 'You receive',
  card_bonus_suffix_it: 'Bonus', card_bonus_suffix_en: 'Bonus',
  card_cta_it: 'Ricarica Ora', card_cta_en: 'Top up now',
  modal_title_it: 'Completa la Ricarica', modal_title_en: 'Complete the Top-up',
  modal_recharge_label_it: 'Ricarichi', modal_recharge_label_en: 'You recharge',
  modal_bonus_label_it: 'Bonus', modal_bonus_label_en: 'Bonus',
  modal_receive_label_it: 'Ricevi', modal_receive_label_en: 'You receive',
  modal_payment_heading_it: 'Informazioni di Pagamento', modal_payment_heading_en: 'Payment Information',
  modal_payment_info_it: 'Verrai reindirizzato alla pagina di pagamento sicura Nexi',
  modal_payment_info_en: 'You\'ll be redirected to the secure Nexi payment page',
  modal_payment_secure_it: 'Pagamento protetto e certificato',
  modal_payment_secure_en: 'Secure and certified payment',
  modal_cancel_it: 'Annulla', modal_cancel_en: 'Cancel',
  modal_pay_template_it: 'Paga €{amount}', modal_pay_template_en: 'Pay €{amount}',
  modal_processing_it: 'Elaborazione...', modal_processing_en: 'Processing...',
  err_name_required_it: 'Il nome è obbligatorio', err_name_required_en: 'Name is required',
  err_email_required_it: 'L\'email è obbligatoria', err_email_required_en: 'Email is required',
  err_phone_invalid_it: 'Formato telefono non valido', err_phone_invalid_en: 'Invalid phone format',
  err_cf_invalid_it: 'Codice Fiscale non valido (16 caratteri)',
  err_cf_invalid_en: 'Invalid Tax Code (16 characters)',
  err_payment_not_ready_it: 'Il sistema di pagamento non è pronto.',
  err_payment_not_ready_en: 'Payment system is not ready.',
  err_payment_failed_it: 'Elaborazione del pagamento fallita.',
  err_payment_failed_en: 'Payment processing failed.',
  // Seed dei pacchetti: identico a quello che il sito mostrava quando gli
  // importi erano hardcoded in CreditWalletPage.tsx (CREDIT_PACKAGES).
  packages: [
    { id: 'starter-50',   series: 'STARTER SERIES', name: 'Starter 50',      rechargeAmount: 50,   receivedAmount: 60,     bonus: 10,     bonusPercentage: 20 },
    { id: 'starter-100',  series: 'STARTER SERIES', name: 'Starter 100',     rechargeAmount: 100,  receivedAmount: 120,    bonus: 20,     bonusPercentage: 20 },
    { id: 'booster-200',  series: 'BOOSTER SERIES', name: 'Booster 200',     rechargeAmount: 200,  receivedAmount: 240,    bonus: 40,     bonusPercentage: 20 },
    { id: 'booster-300',  series: 'BOOSTER SERIES', name: 'Booster 300',     rechargeAmount: 300,  receivedAmount: 369,    bonus: 69,     bonusPercentage: 23, popular: true },
    { id: 'power-500',    series: 'POWER SERIES',   name: 'Power 500',       rechargeAmount: 500,  receivedAmount: 625,    bonus: 125,    bonusPercentage: 25 },
    { id: 'power-750',    series: 'POWER SERIES',   name: 'Power 750',       rechargeAmount: 750,  receivedAmount: 952.50, bonus: 202.50, bonusPercentage: 27 },
    { id: 'premium-1000', series: 'PREMIUM SERIES', name: 'Premium 1.000',   rechargeAmount: 1000, receivedAmount: 1290,   bonus: 290,    bonusPercentage: 29 },
    { id: 'premium-2000', series: 'PREMIUM SERIES', name: 'Premium 2.000',   rechargeAmount: 2000, receivedAmount: 2620,   bonus: 620,    bonusPercentage: 31 },
    { id: 'elite-5000',   series: 'ELITE SERIES',   name: 'Elite 5.000',     rechargeAmount: 5000, receivedAmount: 6650,   bonus: 1650,   bonusPercentage: 33 },
  ],
};

// ─── Default Booking seed (yacht/jet/heli auth gate + chrome + errors) ───
export const INITIAL_BOOKING: BookingCopy = {
  loading_it: 'Caricamento...', loading_en: 'Loading...',
  auth_required_title_it: 'Accesso Richiesto', auth_required_title_en: 'Login Required',
  auth_required_body_it: 'Devi essere registrato e aver effettuato l\'accesso per prenotare questo servizio.',
  auth_required_body_en: 'You must be registered and logged in to book this service.',
  auth_required_login_cta_it: 'Accedi', auth_required_login_cta_en: 'Login',
  auth_required_signup_cta_it: 'Registrati', auth_required_signup_cta_en: 'Sign Up',
  booking_confirmed_title_it: 'Prenotazione Confermata!',
  booking_confirmed_title_en: 'Booking Confirmed!',
  booking_confirmed_body_it: 'La tua prenotazione è stata confermata.',
  booking_confirmed_body_en: 'Your booking has been confirmed.',
  booking_confirmed_cta_bookings_it: 'Vedi le Mie Prenotazioni',
  booking_confirmed_cta_bookings_en: 'View My Bookings',
  inquiry_sent_cta_home_it: 'Torna alla pagina iniziale', inquiry_sent_cta_home_en: 'Go to Home',
  quote_review_title_it: 'Riepilogo Richiesta',
  quote_review_title_en: 'Review Your Inquiry',
  quote_review_body_it: 'Verifica i dettagli prima di inviare la richiesta di preventivo. Il nostro team ti contatterà a breve con prezzi e disponibilità.',
  quote_review_body_en: 'Please review the details below before submitting your quote request. Our team will contact you shortly with pricing and availability.',
  select_option_default_it: 'Seleziona', select_option_default_en: 'Select',
  payment_initializing_it: 'Inizializzazione Pagamento...',
  payment_initializing_en: 'Initializing Payment...',
  item_not_found_it: 'Articolo non trovato.', item_not_found_en: 'Item not found.',
  err_payment_not_configured_it: 'Il servizio di pagamento non è configurato correttamente. Contatta il supporto.',
  err_payment_not_configured_en: 'Payment service is not configured correctly. Please contact support.',
  err_payment_server_down_it: 'Impossibile connettersi al server di pagamento.',
  err_payment_server_down_en: 'Could not connect to payment server.',
  err_payment_not_ready_it: 'Il sistema di pagamento non è pronto.',
  err_payment_not_ready_en: 'Payment system is not ready.',
  err_category_unsupported_it: 'Questa categoria non può essere prenotata.',
  err_category_unsupported_en: 'This category cannot be booked.',
  err_save_failed_it: 'Impossibile salvare la prenotazione. Riprova.',
  err_save_failed_en: 'Could not save your booking. Please try again.',
  err_unexpected_it: 'Si è verificato un errore imprevisto.',
  err_unexpected_en: 'An unexpected error occurred.',
};

// ─── Default Payment Success seed (post-payment landing) ─────────────────
export const INITIAL_PAYMENT_SUCCESS: PaymentSuccessCopy = {
  loading_title_it: 'Completamento Pagamento...', loading_title_en: 'Completing Payment...',
  loading_subtitle_it: 'Stiamo confermando il tuo pagamento',
  loading_subtitle_en: 'We are confirming your payment',
  success_title_it: 'Pagamento Riuscito!', success_title_en: 'Payment Successful!',
  body_generic_it: 'Il tuo pagamento è stato elaborato con successo.',
  body_generic_en: 'Your payment has been processed successfully.',
  body_dr7_club_it: 'La tua iscrizione al DR7 Club è stata attivata con successo! Benvenuto nel club.',
  body_dr7_club_en: 'Your DR7 Club membership has been activated successfully! Welcome to the club.',
  success_title_cauzione_it: 'Cauzione Pre-autorizzata', success_title_cauzione_en: 'Deposit Pre-authorized',
  body_cauzione_it: 'La pre-autorizzazione della cauzione e\' andata a buon fine. L\'importo risulta bloccato sulla tua carta, non addebitato: viene sbloccato al termine del noleggio, salvo addebiti.',
  body_cauzione_en: 'The deposit pre-authorization was successful. The amount is held on your card, not charged: it is released at the end of the rental, unless charges apply.',
  body_membership_template_it: 'La tua membership {tierName} ({cycle}) è stata attivata con successo!',
  body_membership_template_en: 'Your {tierName} membership ({cycle}) has been activated successfully!',
  body_wallet_template_it: 'La tua ricarica {packageName} è stata completata! €{amount} sono stati aggiunti al tuo wallet.',
  body_wallet_template_en: 'Your {packageName} top-up is complete! €{amount} has been added to your wallet.',
  billing_cycle_monthly_it: 'Mensile', billing_cycle_monthly_en: 'Monthly',
  billing_cycle_annual_it: 'Annuale', billing_cycle_annual_en: 'Annual',
  transaction_heading_it: 'Dettagli Transazione', transaction_heading_en: 'Transaction Details',
  transaction_order_id_label_it: 'ID Ordine:', transaction_order_id_label_en: 'Order ID:',
  transaction_amount_label_it: 'Importo:', transaction_amount_label_en: 'Amount:',
  transaction_auth_code_label_it: 'Codice Autorizzazione:', transaction_auth_code_label_en: 'Authorization Code:',
  cta_home_it: 'Torna alla pagina iniziale', cta_home_en: 'Back to Home',
  cta_whatsapp_it: 'Conferma su WhatsApp', cta_whatsapp_en: 'Confirm on WhatsApp',
  cta_membership_it: 'Vai alla Membership', cta_membership_en: 'Go to Membership',
  cta_wallet_it: 'Vai al Wallet', cta_wallet_en: 'Go to Wallet',
  cta_bookings_it: 'Vedi le Mie Prenotazioni', cta_bookings_en: 'See My Bookings',
  err_booking_create_it: 'Errore nella creazione della prenotazione. Contatta il supporto.',
  err_booking_create_en: 'Error creating booking. Please contact support.',
  err_auth_it: 'Errore di autenticazione. Contatta il supporto.',
  err_auth_en: 'Authentication error. Please contact support.',
  err_purchase_update_it: 'Impossibile aggiornare lo stato dell\'acquisto.',
  err_purchase_update_en: 'Could not update purchase status.',
  err_credit_add_it: 'Pagamento ricevuto ma errore nell\'aggiunta dei crediti. Contatta il supporto.',
  err_credit_add_en: 'Payment received but error adding credits. Please contact support.',
  err_order_not_found_it: 'Ordine non trovato.', err_order_not_found_en: 'Order not found.',
  err_payment_not_confirmed_it: 'Non risulta ancora nessun pagamento per questo ordine. Se hai completato il pagamento riceverai la conferma a breve, altrimenti riprova o contattaci.',
  err_payment_not_confirmed_en: 'No payment has been recorded for this order yet. If you completed the payment you will receive confirmation shortly, otherwise please try again or contact us.',
  err_generic_it: 'Si è verificato un errore.', err_generic_en: 'An error occurred.',
};

// ─── Default Payment seed ─────────────────────────────────────────────────
export const INITIAL_PAYMENT: PaymentCopy = {
  subtitle_it: 'Pagamento Sicuro', subtitle_en: 'Secure Payment',
  loading_it: 'Caricamento sistema di pagamento...', loading_en: 'Loading payment system...',
  ready_title_it: 'Completa il Pagamento', ready_title_en: 'Complete the Payment',
  ready_subtitle_it: 'Inserisci i dati della tua carta di credito o debito.',
  ready_subtitle_en: 'Enter your credit or debit card details.',
  ready_prepaid_warning_it: 'Le carte prepagate non sono accettate.',
  ready_prepaid_warning_en: 'Prepaid cards are not accepted.',
  checking_title_it: 'Verifica in corso...', checking_title_en: 'Verifying...',
  checking_subtitle_it: 'Stiamo verificando il metodo di pagamento.',
  checking_subtitle_en: 'We are verifying the payment method.',
  blocked_title_it: 'Metodo non accettato', blocked_title_en: 'Method not accepted',
  blocked_default_message_it: 'Le carte prepagate non sono accettate.',
  blocked_default_message_en: 'Prepaid cards are not accepted.',
  blocked_help_it: 'Utilizza una carta di credito o debito per completare il pagamento.',
  blocked_help_en: 'Use a credit or debit card to complete the payment.',
  blocked_retry_cta_it: 'Riprova con altra carta', blocked_retry_cta_en: 'Retry with another card',
  success_title_it: 'Pagamento Confermato', success_title_en: 'Payment Confirmed',
  success_redirect_it: 'Reindirizzamento in corso...', success_redirect_en: 'Redirecting...',
  cancelled_title_it: 'Pagamento Annullato', cancelled_title_en: 'Payment Cancelled',
  cancelled_subtitle_it: 'Il pagamento è stato annullato.', cancelled_subtitle_en: 'The payment was cancelled.',
  cancelled_retry_cta_it: 'Riprova', cancelled_retry_cta_en: 'Retry',
  error_title_it: 'Errore', error_title_en: 'Error',
  error_invalid_link_it: 'Link di pagamento non valido.', error_invalid_link_en: 'Invalid payment link.',
  error_sdk_load_it: 'Errore caricamento sistema di pagamento. Riprova.',
  error_sdk_load_en: 'Error loading payment system. Please retry.',
  error_sdk_unavailable_it: 'Sistema di pagamento non disponibile.',
  error_sdk_unavailable_en: 'Payment system unavailable.',
  error_sdk_init_it: 'Errore inizializzazione pagamento.',
  error_sdk_init_en: 'Payment initialization error.',
  error_check_card_it: 'Errore verifica pagamento. Contatta il supporto.',
  error_check_card_en: 'Payment verification error. Please contact support.',
  error_payment_failed_it: 'Errore durante il pagamento. Riprova.',
  error_payment_failed_en: 'Payment error. Please retry.',
  footer_secure_note_it: 'Pagamento sicuro tramite Nexi XPay · DR7',
  footer_secure_note_en: 'Secure payment via Nexi XPay · DR7',
};

// ─── Default SignUp seed (registrazione cliente) ──────────────────────────
export const INITIAL_SIGNUP: SignUpCopy = {
  subtitle_it: 'Registrazione Cliente - DR7', subtitle_en: 'Client Registration - DR7',
  client_type_label_it: 'Tipo Cliente', client_type_label_en: 'Client Type',
  client_type_default_it: 'Seleziona...', client_type_default_en: 'Select...',
  client_type_azienda_it: 'Azienda', client_type_azienda_en: 'Company',
  client_type_persona_it: 'Persona Fisica', client_type_persona_en: 'Individual',
  client_type_pa_it: 'Pubblica Amministrazione', client_type_pa_en: 'Public Administration',
  section_legal_rep_it: 'Rappresentante Legale', section_legal_rep_en: 'Legal Representative',
  section_id_doc_it: 'Documento di Identità', section_id_doc_en: 'ID Document',
  section_credentials_it: 'Crea le tue credenziali', section_credentials_en: 'Create your credentials',
  field_country_it: 'Nazione', field_country_en: 'Country',
  field_email_it: 'Email', field_email_en: 'Email',
  field_phone_it: 'Telefono', field_phone_en: 'Phone',
  field_codice_fiscale_it: 'Codice Fiscale', field_codice_fiscale_en: 'Tax Code',
  field_denominazione_it: 'Denominazione', field_denominazione_en: 'Company Name',
  field_denominazione_placeholder_it: 'Nome azienda', field_denominazione_placeholder_en: 'Company name',
  field_piva_it: 'Partita IVA', field_piva_en: 'VAT Number',
  field_piva_placeholder: 'IT12345678901',
  field_cf_placeholder: '00000000000',
  field_sede_legale_it: 'Sede Legale', field_sede_legale_en: 'Registered Office',
  field_sede_legale_placeholder_it: 'Via, Numero Civico, CAP, Città', field_sede_legale_placeholder_en: 'Street, Number, ZIP, City',
  field_sede_operativa_it: 'Sede Operativa (se diversa)', field_sede_operativa_en: 'Operating Office (if different)',
  field_sede_operativa_placeholder_it: 'Via, Numero Civico, CAP, Città', field_sede_operativa_placeholder_en: 'Street, Number, ZIP, City',
  field_sdi_it: 'Codice SDI / Destinatario', field_sdi_en: 'SDI / Recipient Code',
  field_sdi_placeholder: 'XXXXXXX',
  field_email_aziendale_it: 'Email Aziendale', field_email_aziendale_en: 'Business Email',
  field_email_aziendale_placeholder: 'email@azienda.it',
  field_phone_aziendale_it: 'Telefono Aziendale', field_phone_aziendale_en: 'Business Phone',
  field_nome_it: 'Nome', field_nome_en: 'First Name',
  field_cognome_it: 'Cognome', field_cognome_en: 'Last Name',
  field_ruolo_it: 'Ruolo', field_ruolo_en: 'Role',
  field_ruolo_placeholder_it: 'Es. Amministratore', field_ruolo_placeholder_en: 'E.g. Administrator',
  field_doc_type_it: 'Tipo', field_doc_type_en: 'Type',
  field_doc_type_default_it: 'Seleziona...', field_doc_type_default_en: 'Select...',
  field_doc_type_carta_it: "Carta d'Identità", field_doc_type_carta_en: 'ID Card',
  field_doc_type_passaporto_it: 'Passaporto', field_doc_type_passaporto_en: 'Passport',
  field_doc_type_patente_it: 'Patente', field_doc_type_patente_en: 'Driving Licence',
  field_doc_numero_it: 'Numero', field_doc_numero_en: 'Number',
  field_doc_data_it: 'Data Rilascio', field_doc_data_en: 'Issue Date',
  field_doc_luogo_it: 'Luogo Rilascio', field_doc_luogo_en: 'Issue Place',
  field_nome_placeholder_it: 'Mario', field_nome_placeholder_en: 'Mario',
  field_cognome_placeholder_it: 'Rossi', field_cognome_placeholder_en: 'Rossi',
  field_cf_pf_placeholder: 'RSSMRA80A01H501U',
  field_sesso_it: 'Sesso', field_sesso_en: 'Gender',
  field_sesso_default_it: 'Seleziona...', field_sesso_default_en: 'Select...',
  field_sesso_m_it: 'Maschio', field_sesso_m_en: 'Male',
  field_sesso_f_it: 'Femmina', field_sesso_f_en: 'Female',
  field_birth_date_it: 'Data di Nascita', field_birth_date_en: 'Date of Birth',
  field_birth_city_it: 'Città di Nascita', field_birth_city_en: 'Place of Birth',
  field_birth_province_it: 'Provincia di Nascita', field_birth_province_en: 'Province of Birth',
  field_birth_province_placeholder_it: 'CA (EE se nato all\'estero)', field_birth_province_placeholder_en: 'CA (EE if born abroad)',
  field_address_it: 'Indirizzo (Residenza)', field_address_en: 'Address (Residence)',
  field_address_placeholder_it: 'Via Roma', field_address_placeholder_en: 'Via Roma',
  field_civico_it: 'Numero Civico', field_civico_en: 'Street Number',
  field_civico_placeholder: '123',
  field_city_it: 'Città di Residenza', field_city_en: 'City of Residence',
  field_city_placeholder_it: 'Milano', field_city_placeholder_en: 'Milan',
  field_cap_it: 'CAP', field_cap_en: 'ZIP',
  field_cap_placeholder: '20100',
  field_province_it: 'Provincia', field_province_en: 'Province',
  field_province_placeholder: 'MI',
  field_email_placeholder: 'email@esempio.it',
  field_pec_it: 'PEC', field_pec_en: 'Certified Email (PEC)',
  field_pec_placeholder: 'pec@pec.it',
  field_codice_univoco_it: 'Codice Univoco', field_codice_univoco_en: 'Unique Code',
  field_codice_univoco_placeholder: 'XXXXXX',
  field_ente_it: 'Ente o Ufficio', field_ente_en: 'Agency or Office',
  field_ente_placeholder_it: "Nome dell'ente o ufficio", field_ente_placeholder_en: 'Name of agency or office',
  field_pa_city_placeholder_it: 'Cagliari', field_pa_city_placeholder_en: 'Cagliari',
  field_pa_email_placeholder: 'email@ente.it',
  field_password_it: 'Password', field_password_en: 'Password',
  field_confirm_password_it: 'Conferma Password', field_confirm_password_en: 'Confirm Password',
  marketing_consent_it: 'Accetto di ricevere aggiornamenti e novità da DR7 e dai suoi partner.',
  marketing_consent_en: 'I agree to receive updates and news from DR7 and its partners.',
  privacy_policy_link_it: 'Privacy Policy', privacy_policy_link_en: 'Privacy Policy',
  err_select_client_type_it: 'Seleziona un tipo di cliente', err_select_client_type_en: 'Select a client type',
  err_country_required_it: 'Nazione è obbligatorio', err_country_required_en: 'Country is required',
  err_email_required_it: 'Email è obbligatorio', err_email_required_en: 'Email is required',
  err_denominazione_required_it: 'Denominazione è obbligatorio', err_denominazione_required_en: 'Company name is required',
  err_piva_required_it: 'Partita IVA è obbligatorio', err_piva_required_en: 'VAT number is required',
  err_piva_invalid_it: 'Partita IVA non valida (11 cifre)', err_piva_invalid_en: 'Invalid VAT number (11 digits)',
  err_address_required_it: 'Indirizzo è obbligatorio', err_address_required_en: 'Address is required',
  err_phone_required_it: 'Telefono è obbligatorio', err_phone_required_en: 'Phone is required',
  err_phone_invalid_it: 'Formato telefono non valido', err_phone_invalid_en: 'Invalid phone format',
  err_rep_nome_it: 'Nome rappresentante è obbligatorio', err_rep_nome_en: 'Representative first name is required',
  err_rep_cognome_it: 'Cognome rappresentante è obbligatorio', err_rep_cognome_en: 'Representative last name is required',
  err_rep_cf_it: 'CF rappresentante è obbligatorio', err_rep_cf_en: 'Representative tax code is required',
  err_rep_ruolo_it: 'Ruolo rappresentante è obbligatorio', err_rep_ruolo_en: 'Representative role is required',
  err_doc_type_it: 'Tipo documento è obbligatorio', err_doc_type_en: 'Document type is required',
  err_doc_numero_it: 'Numero documento è obbligatorio', err_doc_numero_en: 'Document number is required',
  err_doc_data_it: 'Data rilascio documento è obbligatoria', err_doc_data_en: 'Document issue date is required',
  err_doc_luogo_it: 'Luogo rilascio documento è obbligatorio', err_doc_luogo_en: 'Document issue place is required',
  err_nome_required_it: 'Nome è obbligatorio', err_nome_required_en: 'First name is required',
  err_cognome_required_it: 'Cognome è obbligatorio', err_cognome_required_en: 'Last name is required',
  err_cf_invalid_it: 'Codice Fiscale non valido (16 caratteri alfanumerici)', err_cf_invalid_en: 'Invalid tax code (16 alphanumeric characters)',
  err_cf_required_it: 'Codice Fiscale è obbligatorio', err_cf_required_en: 'Tax code is required',
  err_residenza_required_it: 'Residenza è obbligatoria', err_residenza_required_en: 'Residence is required',
  err_civico_required_it: 'Numero civico è obbligatorio', err_civico_required_en: 'Street number is required',
  err_cap_required_it: 'CAP è obbligatorio', err_cap_required_en: 'Postal code is required',
  err_province_required_it: 'Provincia è obbligatoria', err_province_required_en: 'Province is required',
  err_sesso_required_it: 'Sesso è obbligatorio', err_sesso_required_en: 'Gender is required',
  err_birth_city_required_it: 'Città di Nascita è obbligatoria', err_birth_city_required_en: 'Place of birth is required',
  err_birth_province_required_it: 'Provincia di Nascita è obbligatoria (EE se nato all\'estero)', err_birth_province_required_en: 'Province of birth is required (EE if born abroad)',
  err_codice_univoco_required_it: 'Codice Univoco è obbligatorio', err_codice_univoco_required_en: 'Unique code is required',
  err_ente_required_it: 'Ente o Ufficio è obbligatorio', err_ente_required_en: 'Agency or office is required',
  err_city_required_it: 'Città è obbligatorio', err_city_required_en: 'City is required',
  err_pa_address_required_it: 'Indirizzo è obbligatorio', err_pa_address_required_en: 'Address is required',
};

// ─── Default Confirmation Success seed ────────────────────────────────────
export const INITIAL_CONFIRMATION_SUCCESS: ConfirmationSuccessCopy = {
  booking_title_it: 'Prenotazione Confermata', booking_title_en: 'Booking Confirmed',
  booking_subtitle_it: 'Ti abbiamo inviato una conferma via email.', booking_subtitle_en: 'We\'ve sent you a confirmation email.',
  booking_summary_heading_it: 'Riepilogo Prenotazione', booking_summary_heading_en: 'Booking Summary',
  booking_cta_account_it: 'Vai al Mio Account', booking_cta_account_en: 'Proceed to My Account',
  carwash_row_servizio_it: 'Servizio:', carwash_row_servizio_en: 'Service:',
  carwash_row_data_it: 'Data:', carwash_row_data_en: 'Date:',
  carwash_row_orario_it: 'Orario:', carwash_row_orario_en: 'Time:',
  carwash_row_cliente_it: 'Cliente:', carwash_row_cliente_en: 'Customer:',
  carwash_row_pagamento_it: 'Pagamento:', carwash_row_pagamento_en: 'Payment:',
  carwash_payment_online_it: 'Online', carwash_payment_online_en: 'Online',
  carwash_default_customer_it: 'Cliente', carwash_default_customer_en: 'Customer',
  carwash_totale_pagato_it: 'TOTALE PAGATO:', carwash_totale_pagato_en: 'TOTAL PAID:',
  carwash_whatsapp_note_it: 'Riceverai una conferma via WhatsApp', carwash_whatsapp_note_en: 'You\'ll receive a WhatsApp confirmation',
  rental_row_veicolo_it: 'Veicolo:', rental_row_veicolo_en: 'Vehicle:',
  rental_row_ritiro_it: 'Ritiro:', rental_row_ritiro_en: 'Pickup:',
  rental_row_riconsegna_it: 'Riconsegna:', rental_row_riconsegna_en: 'Return:',
  rental_row_luogo_it: 'Luogo:', rental_row_luogo_en: 'Location:',
  rental_row_pagamento_it: 'Pagamento:', rental_row_pagamento_en: 'Payment:',
  rental_time_connector_it: 'alle', rental_time_connector_en: 'at',
  rental_payment_in_sede_it: 'In Sede', rental_payment_in_sede_en: 'In Office',
  rental_payment_online_it: 'Online', rental_payment_online_en: 'Online',
  rental_totale_pagato_it: 'TOTALE PAGATO:', rental_totale_pagato_en: 'TOTAL PAID:',
  rental_totale_da_pagare_it: 'TOTALE DA PAGARE:', rental_totale_da_pagare_en: 'TOTAL TO PAY:',
  rental_agency_footnote_it: 'L\'importo totale di {total} sarà dovuto al momento del ritiro.',
  rental_agency_footnote_en: 'The total of {total} will be due upon pickup.',
  email_title_it: 'Email Confermata', email_title_en: 'Email Confirmed',
  email_body_logged_in_it: 'Account creato con successo. Ora puoi accedere a tutti i servizi DR7.',
  email_body_logged_in_en: 'Account successfully created. You can now access all DR7 services.',
  email_body_logged_out_it: 'Il tuo indirizzo email è stato verificato con successo. Accedi per entrare nel tuo account.',
  email_body_logged_out_en: 'Your email address has been verified successfully. Sign in to access your account.',
  email_cta_logged_in_it: 'Vai al Mio Account', email_cta_logged_in_en: 'Proceed to My Account',
  email_cta_logged_out_it: 'Accedi', email_cta_logged_out_en: 'Sign In',
};

// ─── Default Jet Search Results seed ──────────────────────────────────────
export const INITIAL_JET_SEARCH: JetSearchResultsCopy = {
  title_it: 'Risultati di Ricerca', title_en: 'Search Results',
  subtitle_connector_it: 'a', subtitle_connector_en: 'to',
  passengers_suffix_it: 'Passeggeri', passengers_suffix_en: 'Passengers',
  modify_search_cta_it: 'Modifica Ricerca', modify_search_cta_en: 'Modify Search',
  airport_fallback: 'N/A',
  empty_title_it: 'Nessun jet trovato', empty_title_en: 'No jets found',
  empty_body_it: 'Prova a modificare i criteri di ricerca o contatta il nostro concierge per assistenza.',
  empty_body_en: 'Try adjusting your search criteria or contact our concierge for assistance.',
};

// ─── Default Check Email seed ──────────────────────────────────────────────
export const INITIAL_CHECK_EMAIL: CheckEmailCopy = {
  title_it: 'Controlla la tua email', title_en: 'Check Your Email',
  body_it: 'Ti abbiamo inviato un link di verifica all\'indirizzo email che hai indicato. Clicca sul link per attivare il tuo account.',
  body_en: 'We\'ve sent a verification link to your email. Click the link to activate your account.',
  back_link_it: 'Torna all\'accesso', back_link_en: 'Back to Sign In',
};

// ─── Default Aviation Quote seed ───────────────────────────────────────────
export const INITIAL_AVIATION_QUOTE: AviationQuoteCopy = {
  loading_it: 'Caricamento...', loading_en: 'Loading...',
  auth_title_it: 'Accesso Richiesto', auth_title_en: 'Login Required',
  auth_body_it: 'Devi essere registrato e aver effettuato l\'accesso per richiedere un preventivo.',
  auth_body_en: 'You must be registered and logged in to request a quote.',
  auth_login_cta_it: 'Accedi', auth_login_cta_en: 'Login',
  auth_signup_cta_it: 'Registrati', auth_signup_cta_en: 'Sign Up',
  service_label_jet: 'Jet Privato', service_label_helicopter: 'Elicottero',
  header_title_template_it: 'Richiedi Preventivo {service}',
  header_title_template_en: 'Request Quote {service}',
  header_subtitle_it: 'Compila il form e ti contatteremo con un preventivo personalizzato',
  header_subtitle_en: 'Fill in the form and we\'ll get back to you with a personalized quote',
  section_customer_it: 'Dati Cliente', section_customer_en: 'Customer Details',
  section_flight_it: 'Dettagli Viaggio', section_flight_en: 'Trip Details',
  field_name_label_it: 'Nome Completo *', field_name_label_en: 'Full Name *',
  field_name_placeholder_it: 'Mario Rossi', field_name_placeholder_en: 'John Smith',
  field_email_label_it: 'Email *', field_email_label_en: 'Email *',
  field_email_placeholder_it: 'mario@email.com', field_email_placeholder_en: 'john@email.com',
  field_phone_label_it: 'Telefono *', field_phone_label_en: 'Phone *',
  field_phone_placeholder_it: '+39 333 123 4567', field_phone_placeholder_en: '+39 333 123 4567',
  field_departure_label_it: 'Partenza da *', field_departure_label_en: 'Departure from *',
  field_departure_placeholder_it: 'Milano, Roma, Cagliari...', field_departure_placeholder_en: 'Milan, Rome, Cagliari...',
  field_arrival_label_it: 'Arrivo a *', field_arrival_label_en: 'Arrival at *',
  field_arrival_placeholder_it: 'Parigi, Londra, Ibiza...', field_arrival_placeholder_en: 'Paris, London, Ibiza...',
  field_departure_date_label_it: 'Data Partenza *', field_departure_date_label_en: 'Departure Date *',
  field_return_date_label_it: 'Data Ritorno (opzionale)', field_return_date_label_en: 'Return Date (optional)',
  field_passengers_label_it: 'Numero Passeggeri *', field_passengers_label_en: 'Number of Passengers *',
  field_notes_label_it: 'Note Aggiuntive', field_notes_label_en: 'Additional Notes',
  field_notes_placeholder_it: 'Richieste speciali, bagagli, preferenze...',
  field_notes_placeholder_en: 'Special requests, luggage, preferences...',
  submit_idle_it: 'Richiedi Preventivo', submit_idle_en: 'Request Quote',
  submit_submitting_it: 'Invio in corso...', submit_submitting_en: 'Submitting...',
  disclaimer_it: 'Verrai reindirizzato su WhatsApp. Ti contatteremo entro 24 ore con un preventivo personalizzato.',
  disclaimer_en: 'You\'ll be redirected to WhatsApp. We\'ll contact you within 24 hours with a personalized quote.',
  alert_success_it: 'Richiesta inviata! Ti contatteremo presto.',
  alert_success_en: 'Request sent! We\'ll be in touch soon.',
  alert_error_it: 'Errore durante l\'invio della richiesta. Riprova.',
  alert_error_en: 'Error submitting your request. Please try again.',
  whatsapp_phone: '393457905205',
};

// ─── Default Franchising seed ──────────────────────────────────────────────
export const INITIAL_FRANCHISING: FranchisingCopy = {
  hero_h2: 'Vuoi aprire la tua sede DR7 nella tua città?',
  hero_h2_it: 'Vuoi aprire la tua sede DR7 nella tua città?',
  hero_h2_en: 'Want to open your own DR7 location in your city?',
  hero_p1: 'Diventa partner del gruppo che sta rivoluzionando il concetto di lusso in Italia.',
  hero_p1_it: 'Diventa partner del gruppo che sta rivoluzionando il concetto di lusso in Italia.',
  hero_p1_en: 'Become a partner of the group that is redefining luxury in Italy.',
  hero_p2: 'Nessun investimento impossibile, supporto totale della casa madre\ne un brand che cresce ogni singolo giorno.',
  hero_p2_it: 'Nessun investimento impossibile, supporto totale della casa madre\ne un brand che cresce ogni singolo giorno.',
  hero_p2_en: 'No impossible investment, full support from head office\nand a brand that grows every single day.',
  stats_heading: 'In soli 18 mesi di attività',
  stats_heading_it: 'In soli 18 mesi di attività',
  stats_heading_en: 'In just 18 months of operation',
  stats_lines: [
    '* oltre 1.800 contratti firmati',
    '* più di €1.500.000 di fatturato netto',
    '* oltre €1.500.000 in parco auto',
    '* più di 900 clienti attivi',
    '* {reviewCount} recensioni a 5 stelle reali',
    '* Valutazione aziendale: €15.000.000',
    '* Valutazione brand: oltre €4.000.000',
    '* Da S.R.L. a S.P.A. in un solo anno.',
  ],
  stats_lines_it: [
    '* oltre 1.800 contratti firmati',
    '* più di €1.500.000 di fatturato netto',
    '* oltre €1.500.000 in parco auto',
    '* più di 900 clienti attivi',
    '* {reviewCount} recensioni a 5 stelle reali',
    '* Valutazione aziendale: €15.000.000',
    '* Valutazione brand: oltre €4.000.000',
    '* Da S.R.L. a S.P.A. in un solo anno.',
  ],
  stats_lines_en: [
    '* over 1,800 signed contracts',
    '* more than €1,500,000 in net revenue',
    '* over €1,500,000 in fleet value',
    '* more than 900 active clients',
    '* {reviewCount} genuine 5-star reviews',
    '* Company valuation: €15,000,000',
    '* Brand valuation: over €4,000,000',
    '* From S.R.L. to S.P.A. in a single year.',
  ],
  stats_footer_main: 'Il brand di lusso più riconosciuto d\'Italia.',
  stats_footer_main_it: 'Il brand di lusso più riconosciuto d\'Italia.',
  stats_footer_main_en: 'The most recognised luxury brand in Italy.',
  stats_footer_sub: 'Italia • Dubai Rent 7.0 S.p.A.',
  stats_footer_sub_it: 'Italia • Dubai Rent 7.0 S.p.A.',
  stats_footer_sub_en: 'Italy • Dubai Rent 7.0 S.p.A.',
  expansion_heading: 'Il Nostro Piano di Espansione',
  expansion_heading_it: 'Il Nostro Piano di Espansione',
  expansion_heading_en: 'Our Expansion Plan',
  expansion_locations: [
    { id: 'cagliari', icon: 'square',  name: 'Cagliari', name_it: 'Cagliari', name_en: 'Cagliari', description: 'Sede Principale', description_it: 'Sede Principale', description_en: 'Headquarters' },
    { id: 'iglesias', icon: 'diamond', name: 'Iglesias', name_it: 'Iglesias', name_en: 'Iglesias', description: 'Franchising Operativo', description_it: 'Franchising Operativo', description_en: 'Operating Franchise' },
    { id: 'target',   icon: 'lines',   name: '300 Sedi',  name_it: '300 Sedi', name_en: '300 Locations', description: 'Obiettivo Italia', description_it: 'Obiettivo Italia', description_en: 'Italy Target' },
  ],
  about_heading: 'L\'Impero DR7',
  about_heading_it: 'L\'Impero DR7',
  about_heading_en: 'The DR7 Empire',
  about_paragraphs: [
    'Nata come Dubai Rent 7.0 S.p.A., oggi DR7 è un impero del lusso e della mobilità. Non un marchio. Non un esperimento. Ma una macchina che funziona, cresce e domina.',
    'Abbiamo costruito un modello che integra mobilità, lusso ed esperienza in un solo ecosistema: auto, supercar, yacht, elicotteri, jet privati e ville di lusso. Un sistema già operativo, già profittevole, già riconosciuto.',
  ],
  about_paragraphs_it: [
    'Nata come Dubai Rent 7.0 S.p.A., oggi DR7 è un impero del lusso e della mobilità. Non un marchio. Non un esperimento. Ma una macchina che funziona, cresce e domina.',
    'Abbiamo costruito un modello che integra mobilità, lusso ed esperienza in un solo ecosistema: auto, supercar, yacht, elicotteri, jet privati e ville di lusso. Un sistema già operativo, già profittevole, già riconosciuto.',
  ],
  about_paragraphs_en: [
    'Born as Dubai Rent 7.0 S.p.A., DR7 is today an empire of luxury and mobility. Not a label. Not an experiment. A machine that works, grows and dominates.',
    'We have built a model that integrates mobility, luxury and experience into a single ecosystem: cars, supercars, yachts, helicopters, private jets and luxury villas. A system already operating, already profitable, already recognised.',
  ],
  benefits: [
    { id: 'brand', icon: 'check', title: 'Più di un Brand', title_it: 'Più di un Brand', title_en: 'More Than a Brand', description: 'Un metodo, una struttura, una reputazione. Un nome sinonimo di dominio.', description_it: 'Un metodo, una struttura, una reputazione. Un nome sinonimo di dominio.', description_en: 'A method, a structure, a reputation. A name synonymous with dominance.' },
  ],
  cta_heading: 'Cerchiamo Dominatori di Mercato',
  cta_heading_it: 'Cerchiamo Dominatori di Mercato',
  cta_heading_en: 'We Are Looking for Market Leaders',
  cta_intro: 'Non affiliati. Imprenditori pronti a portare il nome DR7 Luxury Empire nel proprio territorio.',
  cta_intro_it: 'Non affiliati. Imprenditori pronti a portare il nome DR7 Luxury Empire nel proprio territorio.',
  cta_intro_en: 'Not affiliates. Entrepreneurs ready to bring the DR7 Luxury Empire name to their own territory.',
  cta_box_main: 'Se vuoi entrare in un impero destinato a durare, il momento è ora.',
  cta_box_main_it: 'Se vuoi entrare in un impero destinato a durare, il momento è ora.',
  cta_box_main_en: 'If you want to join an empire built to last, the time is now.',
  cta_box_sub: 'I posti sono limitati. Le sedi non si conquistano due volte.',
  cta_box_sub_it: 'I posti sono limitati. Le sedi non si conquistano due volte.',
  cta_box_sub_en: 'Places are limited. A location is never won twice.',
  contact_heading: 'Invia la tua candidatura',
  contact_heading_it: 'Invia la tua candidatura',
  contact_heading_en: 'Send your application',
  contact_intro: 'e scopri come aprire la tua sede ufficiale DR7.',
  contact_intro_it: 'e scopri come aprire la tua sede ufficiale DR7.',
  contact_intro_en: 'and find out how to open your official DR7 location.',
  contact_email: 'franchising@dr7.app',
  footer_statement: '-\n> "Solo per veri imprenditori. Posti limitati per le nuove aperture 2025."',
  footer_statement_it: '-\n> "Solo per veri imprenditori. Posti limitati per le nuove aperture 2025."',
  footer_statement_en: '-\n> "For genuine entrepreneurs only. Limited places for new 2025 openings."',
};

// ─── Default Investitori seed ──────────────────────────────────────────────
export const INITIAL_INVESTITORI: InvestitoriCopy = {
  hero_title: 'SEZIONE INVESTITORI',
  hero_title_it: 'SEZIONE INVESTITORI',
  hero_title_en: 'INVESTOR RELATIONS',
  hero_subtitle: 'Partecipa alla crescita del gruppo DR7',
  hero_subtitle_it: 'Partecipa alla crescita del gruppo DR7',
  hero_subtitle_en: 'Take part in the growth of the DR7 group',
  intro_paragraphs_it: [
    'Dubai Rent 7.0 S.p.A. rappresenta il cuore del progetto DR7 Luxury Empire, una realtà italiana in espansione internazionale nel settore Luxury Mobility & Lifestyle.',
    'Fondata da Valerio Saia, la società persegue l\'obiettivo di costruire entro il 2030 un gruppo di riferimento nel panorama del lusso globale, integrando noleggio supercar, yacht, elicotteri, ville di pregio e servizi di concierge in un\'unica piattaforma.',
  ],
  intro_paragraphs_en: [
    'Dubai Rent 7.0 S.p.A. is the heart of the DR7 Luxury Empire project, an Italian company expanding internationally in the Luxury Mobility & Lifestyle sector.',
    'Founded by Valerio Saia, the company aims to build by 2030 a benchmark group in the global luxury landscape, integrating supercar rental, yachts, helicopters, prestige villas and concierge services into a single platform.',
  ],
  intro_paragraphs: [
    'Dubai Rent 7.0 S.p.A. rappresenta il cuore del progetto DR7 Luxury Empire, una realtà italiana in espansione internazionale nel settore Luxury Mobility & Lifestyle.',
    'Fondata da Valerio Saia, la società persegue l\'obiettivo di costruire entro il 2030 un gruppo di riferimento nel panorama del lusso globale, integrando noleggio supercar, yacht, elicotteri, ville di pregio e servizi di concierge in un\'unica piattaforma.',
  ],
  opportunity_heading: 'Opportunità di partecipazione al capitale',
  opportunity_heading_it: 'Opportunità di partecipazione al capitale',
  opportunity_heading_en: 'Equity participation opportunity',
  opportunity_paragraphs_it: [
    'Il Consiglio di Amministrazione di Dubai Rent 7.0 S.p.A. ha deliberato l\'apertura selettiva del capitale sociale a investitori privati e partner strategici, con l\'intento di favorire la crescita e l\'espansione del brand a livello internazionale.',
    'L\'ingresso nel capitale è riservato a soggetti qualificati, selezionati direttamente dalla Direzione Generale, nel rispetto delle normative vigenti e delle procedure interne di valutazione.',
    'L\'obiettivo è consolidare la struttura patrimoniale della società e accelerare il piano Vision 2030, che prevede il rafforzamento delle attività operative, lo sviluppo di nuove divisioni e, in prospettiva, la quotazione in mercati regolamentati.',
  ],
  opportunity_paragraphs_en: [
    'The Board of Directors of Dubai Rent 7.0 S.p.A. has resolved to selectively open the share capital to private investors and strategic partners, with the aim of supporting the growth and international expansion of the brand.',
    'Entry into the share capital is reserved for qualified parties, selected directly by General Management, in compliance with applicable regulations and internal assessment procedures.',
    'The objective is to strengthen the company\'s capital structure and accelerate the Vision 2030 plan, which foresees reinforcing operations, developing new divisions and, in due course, listing on regulated markets.',
  ],
  opportunity_paragraphs: [
    'Il Consiglio di Amministrazione di Dubai Rent 7.0 S.p.A. ha deliberato l\'apertura selettiva del capitale sociale a investitori privati e partner strategici, con l\'intento di favorire la crescita e l\'espansione del brand a livello internazionale.',
    'L\'ingresso nel capitale è riservato a soggetti qualificati, selezionati direttamente dalla Direzione Generale, nel rispetto delle normative vigenti e delle procedure interne di valutazione.',
    'L\'obiettivo è consolidare la struttura patrimoniale della società e accelerare il piano Vision 2030, che prevede il rafforzamento delle attività operative, lo sviluppo di nuove divisioni e, in prospettiva, la quotazione in mercati regolamentati.',
  ],
  strength_heading: 'Punti di forza',
  strength_heading_it: 'Punti di forza',
  strength_heading_en: 'Key strengths',
  strength_points: [
    { id: 'crescita',         title: 'Crescita documentata',          title_it: 'Crescita documentata',        title_en: 'Documented growth',           description: 'Fatturato in costante incremento con proiezione di sviluppo superiore al +100% annuo.', description_it: 'Fatturato in costante incremento con proiezione di sviluppo superiore al +100% annuo.', description_en: 'Steadily increasing revenue with projected growth above +100% per year.' },
    { id: 'posizionamento',   title: 'Posizionamento strategico',     title_it: 'Posizionamento strategico',   title_en: 'Strategic positioning',       description: 'Brand di riferimento nel comparto luxury mobility in Italia e in Europa.', description_it: 'Brand di riferimento nel comparto luxury mobility in Italia e in Europa.', description_en: 'A benchmark brand in the luxury mobility sector in Italy and Europe.' },
    { id: 'espansione',       title: 'Espansione internazionale',     title_it: 'Espansione internazionale',   title_en: 'International expansion',     description: 'Apertura verso mercati ad alto potenziale, tra cui Emirati Arabi Uniti e Francia.', description_it: 'Apertura verso mercati ad alto potenziale, tra cui Emirati Arabi Uniti e Francia.', description_en: 'Opening towards high-potential markets, including the United Arab Emirates and France.' },
    { id: 'integrazione',     title: 'Integrazione verticale',        title_it: 'Integrazione verticale',      title_en: 'Vertical integration',        description: 'Un unico ecosistema che combina mobilità di lusso, hospitality e servizi esperienziali.', description_it: 'Un unico ecosistema che combina mobilità di lusso, hospitality e servizi esperienziali.', description_en: 'A single ecosystem combining luxury mobility, hospitality and experiential services.' },
    { id: 'visione',          title: 'Visione a lungo termine',       title_it: 'Visione a lungo termine',     title_en: 'Long-term vision',            description: 'Programma industriale orientato alla creazione di valore e alla sostenibilità economica del gruppo.', description_it: 'Programma industriale orientato alla creazione di valore e alla sostenibilità economica del gruppo.', description_en: 'An industrial programme focused on value creation and the economic sustainability of the group.' },
  ],
  cta_heading: 'Modalità di adesione',
  cta_heading_it: 'Modalità di adesione',
  cta_heading_en: 'How to apply',
  cta_paragraphs_it: [
    'Gli interessati possono inoltrare richiesta di ammissione al Club Azionisti DR7, compilando il modulo dedicato e avviando la fase di verifica da parte dell\'Ufficio Investor Relations.',
    'Ogni proposta di partecipazione viene valutata singolarmente in base ai requisiti dell\'investitore, alla compatibilità strategica e alle disponibilità di quote.',
  ],
  cta_paragraphs_en: [
    'Interested parties may submit an application to join the DR7 Shareholders Club by completing the dedicated form and starting the verification process with the Investor Relations Office.',
    'Each participation proposal is assessed individually based on the investor\'s profile, strategic fit and share availability.',
  ],
  cta_paragraphs: [
    'Gli interessati possono inoltrare richiesta di ammissione al Club Azionisti DR7, compilando il modulo dedicato e avviando la fase di verifica da parte dell\'Ufficio Investor Relations.',
    'Ogni proposta di partecipazione viene valutata singolarmente in base ai requisiti dell\'investitore, alla compatibilità strategica e alle disponibilità di quote.',
  ],
  cta_button_label: 'RICHIEDI ACCESSO INVESTITORI',
  cta_button_label_it: 'RICHIEDI ACCESSO INVESTITORI',
  cta_button_label_en: 'REQUEST INVESTOR ACCESS',
  cta_whatsapp_url: 'https://wa.me/393457905205?text=Buongiorno%2C%20sono%20interessato%20ad%20entrare%20nel%20Club%20Azionisti%20DR7.%20Vorrei%20ricevere%20maggiori%20informazioni%20sulle%20opportunit%C3%A0%20di%20investimento%20e%20partecipazione%20al%20capitale.',
  cta_email: 'investor@dr7.app',
  info_heading: 'Informazioni sintetiche',
  info_heading_it: 'Informazioni sintetiche',
  info_heading_en: 'Summary information',
  info_items: [
    { label: 'Denominazione',                 label_it: 'Denominazione',                 label_en: 'Company name',                value: 'Dubai Rent 7.0 S.p.A.', value_it: 'Dubai Rent 7.0 S.p.A.', value_en: 'Dubai Rent 7.0 S.p.A.' },
    { label: 'Sede legale',                   label_it: 'Sede legale',                   label_en: 'Registered office',           value: 'Cagliari, Italia', value_it: 'Cagliari, Italia', value_en: 'Cagliari, Italy' },
    { label: 'Settore',                       label_it: 'Settore',                       label_en: 'Sector',                      value: 'Luxury Mobility & Lifestyle', value_it: 'Luxury Mobility & Lifestyle', value_en: 'Luxury Mobility & Lifestyle' },
    { label: 'Forma giuridica',               label_it: 'Forma giuridica',               label_en: 'Legal form',                  value: 'Società per Azioni', value_it: 'Società per Azioni', value_en: 'Joint-stock company (S.p.A.)' },
    { label: 'Capitale sociale',              label_it: 'Capitale sociale',              label_en: 'Share capital',               value: 'In aumento progressivo secondo piano Vision 2030', value_it: 'In aumento progressivo secondo piano Vision 2030', value_en: 'Progressively increasing under the Vision 2030 plan' },
    { label: 'Tipologia quote',               label_it: 'Tipologia quote',               label_en: 'Share type',                  value: 'Azioni ordinarie nominative', value_it: 'Azioni ordinarie nominative', value_en: 'Registered ordinary shares' },
    { label: 'Investimento minimo indicativo', label_it: 'Investimento minimo indicativo', label_en: 'Indicative minimum investment', value: 'Da €25.000', value_it: 'Da €25.000', value_en: 'From €25,000' },
    { label: 'Distribuzione utili',           label_it: 'Distribuzione utili',           label_en: 'Profit distribution',         value: 'Secondo deliberazioni dell\'Assemblea e risultati di bilancio', value_it: 'Secondo deliberazioni dell\'Assemblea e risultati di bilancio', value_en: 'As resolved by the Shareholders Meeting and based on financial results' },
  ],
  info_footnote: 'I dettagli economico-finanziari completi, nonché la documentazione ufficiale, sono forniti esclusivamente su richiesta riservata e previa verifica dei requisiti soggettivi dell\'investitore.',
  info_footnote_it: 'I dettagli economico-finanziari completi, nonché la documentazione ufficiale, sono forniti esclusivamente su richiesta riservata e previa verifica dei requisiti soggettivi dell\'investitore.',
  info_footnote_en: 'Full financial details and official documentation are provided exclusively upon confidential request and after verification of the investor\'s eligibility.',
  legal_heading: 'Avvertenza legale',
  legal_heading_it: 'Avvertenza legale',
  legal_heading_en: 'Legal disclaimer',
  legal_paragraphs_it: [
    'Le informazioni contenute in questa sezione hanno finalità esclusivamente informative e non costituiscono, in alcun modo, un\'offerta pubblica di sottoscrizione o una sollecitazione all\'investimento ai sensi dell\'art. 94 del D.Lgs. 58/1998 (TUF) e della normativa europea vigente.',
    'L\'adesione a operazioni di partecipazione al capitale è riservata a soggetti selezionati, previa valutazione da parte di Dubai Rent 7.0 S.p.A. e nel pieno rispetto delle procedure legali e regolamentari applicabili.',
  ],
  legal_paragraphs_en: [
    'The information in this section is provided for information purposes only and does not constitute, in any way, a public offer of subscription or an investment solicitation under art. 94 of Italian Legislative Decree 58/1998 (TUF) or applicable European regulations.',
    'Participation in equity transactions is reserved for selected parties, subject to assessment by Dubai Rent 7.0 S.p.A. and in full compliance with the applicable legal and regulatory procedures.',
  ],
  legal_paragraphs: [
    'Le informazioni contenute in questa sezione hanno finalità esclusivamente informative e non costituiscono, in alcun modo, un\'offerta pubblica di sottoscrizione o una sollecitazione all\'investimento ai sensi dell\'art. 94 del D.Lgs. 58/1998 (TUF) e della normativa europea vigente.',
    'L\'adesione a operazioni di partecipazione al capitale è riservata a soggetti selezionati, previa valutazione da parte di Dubai Rent 7.0 S.p.A. e nel pieno rispetto delle procedure legali e regolamentari applicabili.',
  ],
};

// ─── Default Car Wash chrome ───────────────────────────────────────────────
export const INITIAL_CARWASH: CarWashCopy = {
  plate_label_it: 'Inserisci la targa del tuo veicolo',
  plate_label_en: 'Enter your vehicle plate',
  plate_helper_it: 'Per continuare, inserisci la targa per scoprire i servizi disponibili e il prezzo.',
  plate_helper_en: 'To continue, enter your plate to see available services and pricing.',
  plate_placeholder_it: 'es. EX117YA',
  plate_placeholder_en: 'e.g. EX117YA',
  plate_search_it: 'Cerca', plate_search_en: 'Search',
  plate_searching_it: 'Cercando...', plate_searching_en: 'Searching...',
  plate_manual_prompt_it: 'Seleziona manualmente la categoria del tuo veicolo:',
  plate_manual_prompt_en: 'Manually select your vehicle category:',
  plate_change_it: 'Cambia veicolo', plate_change_en: 'Change vehicle',
  add_to_cart_it: 'AGGIUNGI AL CARRELLO', add_to_cart_en: 'ADD TO CART',
  cart_title_it: 'Il tuo carrello', cart_title_en: 'Your cart',
  cart_empty_it: 'Il carrello è vuoto', cart_empty_en: 'Your cart is empty',
  cart_remove_it: 'Rimuovi', cart_remove_en: 'Remove',
  cart_total_it: 'Totale', cart_total_en: 'Total',
  cart_checkout_it: 'PROCEDI', cart_checkout_en: 'CHECKOUT',
  upsell_review_cart_it: 'Rivedi carrello', upsell_review_cart_en: 'Review Cart',
  upsell_step1_title_it: 'Completa il tuo lavaggio', upsell_step1_title_en: 'Complete your wash',
  upsell_step1_text_it: 'Aggiungi un servizio Extra Care per ottenere il massimo dal tuo lavaggio.',
  upsell_step1_text_en: 'Add an Extra Care service to get the most out of your wash.',
  upsell_step2_title_it: "Vivi l'attesa in grande stile", upsell_step2_title_en: 'Experience the wait in style',
  upsell_step2_text_it: "Guida un'auto di cortesia o una supercar mentre il tuo veicolo viene trattato.",
  upsell_step2_text_en: 'Drive a courtesy car or supercar while your vehicle is being treated.',
  upsell_added_it: 'Aggiunto ✓', upsell_added_en: 'Added ✓',
  upsell_add_it: 'Aggiungi', upsell_add_en: 'Add',
};

// ─── Default Mechanical Services chrome ────────────────────────────────────
// Catalog source of truth: `car_wash_services` Supabase table (managed from
// admin > Catalogo Prime Wash). NO services list lives here.
export const INITIAL_MECHANICAL: MechanicalCopy = {
  hero_title: 'DR7 RAPID SERVICE',
  hero_subtitle_it: 'Meccanica rapida senza appuntamenti lunghi',
  hero_subtitle_en: 'Fast mechanical service without long appointments',
  hero_intro_it: 'Solo lavori rapidi — Prenota online e vieni quando vuoi',
  hero_intro_en: 'Quick jobs only — Book online and come when you want',
  book_now_label_it: 'PRENOTA ORA',
  book_now_label_en: 'BOOK NOW',
  how_heading_it: 'Come Funziona',
  how_heading_en: 'How It Works',
  how_steps: [
    { title_it: '1. Prenota Online', title_en: '1. Book Online', text_it: 'Scegli il servizio e prenota in pochi clic', text_en: 'Choose your service and book in a few clicks' },
    { title_it: '2. Vieni da Noi', title_en: '2. Come to Us', text_it: 'Arrivi all\'orario prenotato, niente attese', text_en: 'Arrive at your booked time, no waiting' },
    { title_it: '3. Lavoro Rapido', title_en: '3. Quick Service', text_it: 'Completiamo il lavoro velocemente e torni in strada', text_en: 'We complete the job quickly and you\'re back on the road' },
  ],
  hours_heading_it: 'Orari di Apertura',
  hours_heading_en: 'Opening Hours',
  hours_main_it: 'Lunedì - Sabato: 9:00 - 19:00',
  hours_main_en: 'Monday - Saturday: 9:00 AM - 7:00 PM',
  hours_sub_it: 'Chiusi la domenica',
  hours_sub_en: 'Closed on Sundays',
};

// ─── Default Careers seed ──────────────────────────────────────────────────
export const INITIAL_CAREERS: CareersCopy = {
  page_title_it: 'Careers',
  page_title_en: 'Careers',
  intro_it: 'Unisciti a un team appassionato di lusso e dedicato a fornire esperienze senza pari. In DR7, siamo sempre alla ricerca di talenti eccezionali per aiutarci a superare i confini dell\'eccellenza.',
  intro_en: 'Join a team passionate about luxury and dedicated to delivering unparalleled experiences. At DR7 we are always looking for exceptional talent to help us push the boundaries of excellence.',
  jobs_heading_it: 'Posizioni Aperte',
  jobs_heading_en: 'Open Positions',
  jobs: [
    {
      id: 'curatore-esperienze',
      title_it: 'Curatore di Esperienze di Lusso', title_en: 'Luxury Experience Curator',
      location_it: 'Sede: Cagliari, Italia', location_en: 'Location: Cagliari, Italy',
      type_it: 'Tempo pieno', type_en: 'Full-time',
      description_it: 'Cerchiamo una persona creativa e attenta ai dettagli per progettare e gestire esperienze di lusso su misura per la nostra clientela d\'élite.',
      description_en: 'We are looking for a creative, detail-oriented person to design and manage tailored luxury experiences for our elite clientele.',
    },
    {
      id: 'specialista-relazioni',
      title_it: 'Specialista Relazioni Clienti', title_en: 'Client Relations Specialist',
      location_it: 'Sede: Remoto', location_en: 'Location: Remote',
      type_it: 'Tempo pieno', type_en: 'Full-time',
      description_it: 'Come Specialista Relazioni Clienti, sarai il punto di contatto principale per i nostri membri, assicurando che le loro esigenze siano soddisfatte con il massimo livello di servizio.',
      description_en: 'As a Client Relations Specialist you will be the main point of contact for our members, ensuring their needs are met with the highest level of service.',
    },
  ],
  apply_heading_it: 'Come Candidarsi',
  apply_heading_en: 'How to Apply',
  apply_text_it: 'Se pensi di avere ciò che serve per far parte di DR7, invia il tuo curriculum vitae e una lettera di presentazione a [candidatura@dr7.app](mailto:candidatura@dr7.app).',
  apply_text_en: 'If you think you have what it takes to join DR7, send your CV and cover letter to [candidatura@dr7.app](mailto:candidatura@dr7.app).',
  apply_email: 'candidatura@dr7.app',
};

// ─── Default Press seed ────────────────────────────────────────────────────
export const INITIAL_PRESS: PressCopy = {
  page_title_it: 'Press',
  page_title_en: 'Press',
  subtitle_it: 'Scopri le ultime notizie, articoli e comunicati stampa su DR7',
  subtitle_en: 'Discover the latest news, features, and press releases about DR7',
  inquiries_heading_it: 'Richieste Stampa',
  inquiries_heading_en: 'Media Inquiries',
  inquiries_text_it: 'Per richieste stampa, interviste o altre questioni relative ai media, contatta il nostro team di relazioni con i media. Saremo lieti di fornire informazioni sulla nostra azienda, i servizi e la nostra visione del futuro del lusso.',
  inquiries_text_en: 'For all media inquiries, interviews, or other press-related matters, please contact our media relations team. We are happy to provide information about our company, services, and vision for the future of luxury.',
  inquiries_email_label_it: 'Email:',
  inquiries_email_label_en: 'Email:',
  inquiries_email: 'info@dr7.app',
  news_heading_it: 'Sui Media',
  news_heading_en: 'In the News',
  read_more_label_it: 'Leggi l\'articolo',
  read_more_label_en: 'Read full article',
  articles: [
    {
      id: 'art-1',
      title: 'Dubai Rent, la prima startup al mondo nel noleggio auto di lusso, a diventare Società per Azioni con €100.000 di capitale sociale',
      publication: 'Casteddu Online',
      date: '28 Maggio 2025',
      summary_it: 'Dubai Rent è diventata la prima startup mondiale nel settore del noleggio auto di lusso a trasformarsi in una Società per Azioni, con un capitale sociale di 100.000 euro, segnando un importante punto di svolta nel proprio sviluppo imprenditoriale.',
      summary_en: 'Dubai Rent became the world\'s first luxury car rental startup to transform into a joint-stock company with €100,000 in share capital, marking a significant turning point in its entrepreneurial development.',
      link: 'https://www.castedduonline.it/dubai-rent-la-prima-startup-al-mondo-nel-noleggio-auto-di-lusso-a-diventare-societa-per-azioni-con-e100-000-di-capitale-sociale/',
    },
    {
      id: 'art-2',
      title: 'DR7: nasce la prima piattaforma al mondo dedicata al lusso integrato',
      publication: 'Casteddu Online',
      date: '18 Settembre 2025',
      summary_it: 'DR7 è la prima piattaforma globale che riunisce in un unico ecosistema integrato supercar, yacht, jet, elicotteri, ville, B&B, SPA ed esperienze esclusive. Il progetto rappresenta un punto di svolta innovativo nel settore del lusso.',
      summary_en: 'DR7 is the first global platform bringing together supercars, yachts, jets, helicopters, villas, B&Bs, spas and exclusive experiences in a single integrated ecosystem — a turning point in the luxury sector.',
      link: 'https://www.castedduonline.it/dr7-nasce-la-prima-piattaforma-al-mondo-dedicata-al-lusso-integrato/',
    },
    {
      id: 'art-3',
      title: 'DR7: Saia Valerio, l\'uomo che sta costruendo il nuovo impero del lusso globale entro il 2030',
      publication: 'Casteddu Online',
      date: '31 Luglio 2025',
      summary_it: 'Valerio Saia ha un obiettivo chiaro: raggiungere un traguardo miliardario entro il 2030 attraverso la costruzione di un nuovo impero nel settore del lusso globale con una strategia di espansione ambiziosa.',
      summary_en: 'Valerio Saia has a clear goal: reaching a billion-euro milestone by 2030 by building a new global luxury empire with an ambitious expansion strategy.',
      link: 'https://www.castedduonline.it/dr7-saia-valerio-luomo-che-sta-costruendo-il-nuovo-impero-del-lusso-globale-entro-il-2030/',
    },
    {
      id: 'art-4',
      title: 'DR7 Exotic Cars e Luxury - Servizi di lusso a Cagliari',
      publication: 'Estate in Sardegna',
      date: '2025',
      summary_it: 'Fondata da Valerio Saia, DR7 è cresciuta rapidamente a oltre 1.500 clienti certificati. Offre noleggio auto di lusso, yacht, elicotteri e servizi premium, con l\'obiettivo di raggiungere €1 miliardo di fatturato entro il 2030.',
      summary_en: 'Founded by Valerio Saia, DR7 has rapidly grown to over 1,500 certified clients. It offers luxury car rentals, yachts, helicopters and premium services, aiming for €1 billion in revenue by 2030.',
      link: 'https://www.estateinsardegna.it/fr/servizi-turistici/cagliari/dr7-exotic-cars-e-luxury/',
    },
    {
      id: 'art-5',
      title: 'DR7, la nuova struttura del lusso operativo',
      publication: 'Casteddu Online',
      date: '24 Luglio 2025',
      summary_it: 'DR7 (ex Dubai Rent 7.0 S.p.A.) si è trasformata da startup locale a società per azioni operativa e scalabile in poco più di un anno, sviluppando margini attivi e asset reali.',
      summary_en: 'DR7 (formerly Dubai Rent 7.0 S.p.A.) transformed from a local startup into an operational, scalable joint-stock company in just over a year, developing real margins and assets.',
      link: 'https://www.castedduonline.it/dr7-la-nuova-struttura-del-lusso-operativo/',
    },
    {
      id: 'art-6',
      title: 'DR7 (Dubai Rent 7.0) – La piattaforma mondiale del lusso',
      publication: 'Casteddu Online',
      date: '2 Settembre 2025',
      summary_it: 'Il futuro del lusso non può più essere frammentato: va reso accessibile in un\'unica infrastruttura globale. DR7 si presenta come piattaforma mondiale per rendere il lusso più accessibile.',
      summary_en: 'The future of luxury can no longer be fragmented: it must be accessible through a single global infrastructure. DR7 positions itself as a world platform to make luxury more accessible.',
      link: 'https://www.castedduonline.it/dr7-dubai-rent-7-0-la-piattaforma-mondiale-del-lusso/',
    },
  ],
  releases_heading_it: 'Comunicati Stampa',
  releases_heading_en: 'Press Releases',
  releases_text_it: 'Per maggiori informazioni sui nostri ultimi annunci e traguardi, contatta il nostro team di relazioni con i media.',
  releases_text_en: 'For more information about our latest announcements and achievements, please contact our media relations team.',
};

// ─── Default Contact seed ──────────────────────────────────────────────────
export const INITIAL_CONTACT: ContactCopy = {
  page_title_it: 'Contattaci',
  page_title_en: 'Contact Us',
  subtitle_it: 'Il nostro team è a disposizione per prenotazioni, informazioni e assistenza personalizzata.',
  subtitle_en: 'Our team is available for bookings, information, and personalized support.',
  phone_label_it: 'Telefono', phone_label_en: 'Phone',
  phone_display: '+39 345 790 5205',
  phone_tel_url: 'tel:+393457905205',
  whatsapp_label_it: 'WhatsApp', whatsapp_label_en: 'WhatsApp',
  whatsapp_button_it: 'Scrivici su WhatsApp', whatsapp_button_en: 'Message us on WhatsApp',
  whatsapp_url: 'https://wa.me/393457905205',
  email_label_it: 'Email', email_label_en: 'Email',
  email_address: 'info@dr7.app',
  hours_label_it: 'Orari', hours_label_en: 'Hours',
  hours_lines_it: ['Lun–Ven: 9:00–13:00 / 15:00–19:00', 'Sabato: 9:00–17:00', 'Domenica: Chiuso'],
  hours_lines_en: ['Mon–Fri: 9:00–13:00 / 15:00–19:00', 'Saturday: 9:00–17:00', 'Sunday: Closed'],
  office_heading_it: 'Sede Operativa', office_heading_en: 'Operating Office',
  office_company_name: 'Dubai Rent 7.0 S.p.A.',
  office_address_it: 'Viale Marconi, 229 – 09131 Cagliari (CA), Italia',
  office_address_en: 'Viale Marconi, 229 – 09131 Cagliari (CA), Italy',
  office_piva: 'P.IVA / C.F.: 04104640927',
  map_title: 'DR7 – Sede Operativa Cagliari',
  map_title_it: 'DR7 – Sede Operativa Cagliari',
  map_title_en: 'DR7 – Cagliari Operating Office',
  map_iframe_url: 'https://www.openstreetmap.org/export/embed.html?bbox=9.1000%2C39.2200%2C9.1300%2C39.2300&layer=mapnik&marker=39.2253%2C9.1150',
};

// ─── Default Footer seed ────────────────────────────────────────────────────
export const INITIAL_FOOTER: FooterCopy = {
  network_title: 'Join the DR7 Network',
  network_title_it: 'Entra nel Network DR7',
  network_title_en: 'Join the DR7 Network',
  network_text_it: 'Entra nel nostro ecosistema globale e segui i nostri canali social per contenuti esclusivi e aggiornamenti dal mondo DR7 Cagliari.',
  network_text_en: 'Join our global ecosystem and follow our social channels for exclusive content and updates from the DR7 Cagliari world.',
  social_links: [
    { id: 'ig', label: 'Instagram', href: 'https://www.instagram.com/dubai_rent_7.0_s_p_a_', icon: 'instagram' },
    { id: 'tt', label: 'Tiktok',    href: 'https://www.tiktok.com/@dr7luxuryempire',           icon: 'tiktok' },
  ],
  reviews_title: 'A Global Standard of Excellence',
  reviews_title_it: 'Uno Standard Globale di Eccellenza',
  reviews_title_en: 'A Global Standard of Excellence',
  reviews_text_it: 'DR7 Cagliari mantiene un rating impeccabile di 5.0/5.0 su quasi 300 recensioni verificate, confermandosi un punto di riferimento nel settore della luxury mobility.',
  reviews_text_en: 'DR7 Cagliari maintains a flawless 5.0/5.0 rating across nearly 300 verified reviews, confirming itself as a benchmark in the luxury mobility sector.',
  contact_title: 'Contact',
  contact_whatsapp_number: '+39 345 790 5205',
  contact_whatsapp_url: 'https://wa.me/393457905205',
  contact_company_name: 'DR7 S.p.A.',
  contact_legal_address_it: 'Sede Legale: Via del Fangario 25, 09122 Cagliari (CA) – Italia',
  contact_legal_address_en: 'Registered Office: Via del Fangario 25, 09122 Cagliari (CA) – Italy',
  contact_operative_address_it: 'Sede Operativa: Viale Marconi 229, 09131 Cagliari (CA) – Italia',
  contact_operative_address_en: 'Operating Office: Viale Marconi 229, 09131 Cagliari (CA) – Italy',
  contact_capitale_sociale_it: 'Capitale Sociale: € 1.000.000 i.v.',
  contact_capitale_sociale_en: 'Share Capital: € 1,000,000 fully paid',
  contact_piva: 'P.IVA / C.F.: 04104640927',
  contact_disclaimer_it: 'Società appartenente al progetto di sviluppo\nDR7 HOLDING S.p.A.',
  contact_disclaimer_en: 'Company belonging to the development project of\nDR7 HOLDING S.p.A.',
  division_links: [
    { id: 'div-1', label_it: 'Divisione Supercar & Luxury', label_en: 'Supercar & Luxury Division', to: '/supercar-luxury' },
    { id: 'div-2', label_it: 'Lavaggio & Meccanica',        label_en: 'Car Wash & Mechanics',        to: '/prime-wash' },
    { id: 'div-3', label_it: 'Contattaci',                  label_en: 'Contact us',                  to: '/contact' },
  ],
  corporate_links: [
    { id: 'corp-1', label_it: 'Panoramica Aziendale',       label_en: 'Corporate Overview',         to: '/about' },
    { id: 'corp-2', label_it: 'Stampa & Media',             label_en: 'Press & Media',              to: '/press' },
    { id: 'corp-3', label_it: 'Lavora con Noi',             label_en: 'Careers & Opportunities',    to: '/careers' },
  ],
  legal_links: [
    { id: 'leg-1', label_it: 'Termini di Servizio',         label_en: 'Terms of Service',           to: '/terms' },
    { id: 'leg-2', label_it: 'Informativa Cookie',          label_en: 'Cookie Policy',              to: '/cookie-policy' },
    { id: 'leg-3', label_it: 'Informativa Privacy',         label_en: 'Privacy Policy',             to: '/privacy' },
    { id: 'leg-4', label_it: 'Politica di Cancellazione',   label_en: 'Cancellation Policy',        to: '/cancellation-policy' },
  ],
  bottom_brand_line: 'DR7 Cagliari – Global Mobility & Luxury Lifestyle Group',
  bottom_brand_line_it: 'DR7 Cagliari – Gruppo di Mobilità Globale e Luxury Lifestyle',
  bottom_brand_line_en: 'DR7 Cagliari – Global Mobility & Luxury Lifestyle Group',
  bottom_copyright: '© 2024 - 2026 DR7 Cagliari. All Rights Reserved.',
  bottom_copyright_it: '© 2024 - 2026 DR7 Cagliari. Tutti i diritti riservati.',
  bottom_copyright_en: '© 2024 - 2026 DR7 Cagliari. All Rights Reserved.',
};

// ─── Default About seed ─────────────────────────────────────────────────────
export const INITIAL_ABOUT: AboutCopy = {
  founders: [
    {
      id: 'valerio',
      name: 'Valerio',
      role_it: 'Co-fondatore',
      role_en: 'Co-founder',
      photo_src: '/Valerio.jpg',
      alt_it: 'Valerio - Co-fondatore DR7',
      alt_en: 'Valerio - Co-founder DR7',
    },
    {
      id: 'ilenia',
      name: 'Ilenia',
      role_it: 'Co-fondatrice',
      role_en: 'Co-founder',
      photo_src: '/Ilenia.jpg',
      alt_it: 'Ilenia - Co-fondatrice DR7',
      alt_en: 'Ilenia - Co-founder DR7',
    },
  ],
  story_title_it: 'DR7 non è un nome. È una misura.',
  story_title_en: 'DR7 is not a name. It’s a standard.',
  story_paragraphs: [
    {
      text_it: 'Nasce da un’idea semplice: il lusso va organizzato, non esibito. Per questo l’abbiamo costruito come un impero del lusso: supercar pronte quando arrivate, ville che respirano ordine, yacht che aspettano la rotta giusta, elicotteri e jet privati che accorciano le distanze, una membership che apre porte con discrezione.',
      text_en: 'Born from a simple idea: luxury must be organized, not flaunted. That’s why we built it as an empire of luxury: supercars ready when you arrive, villas that breathe order, yachts waiting for the right course, helicopters and private jets that shorten distances, a membership that opens doors with discretion.',
    },
    {
      text_it: 'Siamo Valerio e Ilenia, co-leader e creatori del brand. Camminiamo allo stesso passo: uniamo la calma delle cose fatte bene alla precisione dei tempi rispettati. La Sardegna ci ha insegnato l’essenziale: il mare all’alba, il vento che cambia, il valore del silenzio. DR7 prende da qui la sua regola: meno rumore, più certezza.',
      text_en: 'We are Valerio and Ilenia, co-leaders and creators of the brand. We walk in step: combining the calm of things done well with the precision of times respected. Sardinia taught us the essentials: the sea at dawn, the changing wind, the value of silence. DR7 takes its rule from here: less noise, more certainty.',
    },
    {
      text_it: 'Non promettiamo scintille; promettiamo cura. Una chiave consegnata a mano, un itinerario che scorre senza attriti, un arrivo dove è già tutto pronto. Ogni esperienza porta la nostra firma: supercar, ville, yacht, elicotteri, jet, membership — diverse forme, lo stesso standard.',
      text_en: 'We don’t promise sparks; we promise care. A key handed over personally, an itinerary that flows without friction, an arrival where everything is already prepared. Every experience carries our signature: supercars, villas, yachts, helicopters, jets, membership — different forms, the same standard.',
    },
    {
      text_it: 'La nostra promessa è semplice: tempo guadagnato, bellezza preservata, serenità garantita. Se cercate un effetto speciale, troverete invece una costanza rara: quella delle cose organizzate con intelligenza e rispetto.',
      text_en: 'Our promise is simple: time gained, beauty preserved, serenity guaranteed. If you’re looking for a special effect, you’ll find instead a rare consistency: that of things organized with intelligence and respect.',
    },
  ],
  story_outro_main_it: 'Benvenuti in DR7',
  story_outro_main_en: 'Welcome to DR7',
  story_outro_sub_it: 'L’impero del lusso che vi accompagna, con discrezione, ovunque scegliate di andare.',
  story_outro_sub_en: 'The empire of luxury that accompanies you, with discretion, wherever you choose to go.',
  story_signature: '— Valerio & Ilenia',
};

// ─── Default Home seed ──────────────────────────────────────────────────────
// Mirrors the legacy hardcoded HomePage values (HERO_SLIDES + DISPLAY_TITLE
// + CATEGORY_IMAGE) so swapping to admin-managed copy is a no-op until edited.
export const INITIAL_HOME: HomeCopy = {
  seo_h1_it: 'DR7 — Noleggio Auto di Lusso, Supercar e Servizi Premium in Sardegna',
  seo_h1_en: 'DR7 — Luxury Car Rental, Supercars & Premium Services in Sardinia',
  hero_autoplay_seconds: 8,
  // UNA sola scena d'apertura: `/main.mp4`, quella con cui il sito si e'
  // sempre aperto ed era la prima delle sei in configurazione.
  //
  // Non e' una svista che sia una sola: la direzione ha chiesto una scena
  // sola, non un carosello. Aggiungerne altre dal pannello le fa ruotare di
  // nuovo, con il tempo impostato in "Autoplay".
  //
  // Nota tecnica, per chi passera' di qui: il file e' 576x1024, cioe' verticale
  // e largo 576 pixel. Sul telefono e' nel suo formato ed e' perfetto; su uno
  // schermo orizzontale grande viene ingrandito e tagliato a fascia, ed e' il
  // meglio che quel file possa dare. Per averlo nitido servirebbe una versione
  // orizzontale ad alta risoluzione della stessa scena, da caricare qui.
  hero_slides: [
    { id: 'slide-1', video_src: '/main.mp4', poster_src: '/poster/main.jpg' },
  ],
  categories: [
    { id: 'cars',                 display_title_it: 'DR7 Supercar & Luxury Division',         display_title_en: 'DR7 Supercar & Luxury Division',         image_src: '/car.jpeg' },
    { id: 'urban-cars',           display_title_it: 'DR7 Urban Mobility Division',            display_title_en: 'DR7 Urban Mobility Division',            image_src: '/urbanc.jpeg' },
    { id: 'corporate-fleet',      display_title_it: 'DR7 Corporate & Utility Fleet Division', display_title_en: 'DR7 Corporate & Utility Fleet Division', image_src: '/utili.jpeg' },
    { id: 'yachts',               display_title_it: 'DR7 Yachting Division',                  display_title_en: 'DR7 Yachting Division',                  image_src: '/yacht.jpeg' },
    { id: 'jets',                 display_title_it: 'DR7 Aviation Division',                  display_title_en: 'DR7 Aviation Division',                  image_src: '/privatejet.jpeg' },
    { id: 'car-wash-services',    display_title_it: 'Lavaggio & Meccanica',                   display_title_en: 'Car Wash & Mechanics',                   image_src: '/servizi-lavaggio.jpeg' },
    { id: 'mechanical-services',  display_title_it: 'Meccanica',                              display_title_en: 'Mechanics',                              image_src: '/rapids.jpeg' },
    { id: 'membership',           display_title_it: 'DR7 Exclusive Members Club',             display_title_en: 'DR7 Exclusive Members Club',             image_src: '/exclusivemc.jpeg' },
    { id: 'credit-wallet',        display_title_it: 'DR7 Credit Wallet',                      display_title_en: 'DR7 Credit Wallet',                      image_src: '/cwallet.jpeg' },
  ],

  // ── Atto 01 — Arrivo ───────────────────────────────────────────────────
  hero_kicker_it: 'Cagliari · Sardegna',
  hero_kicker_en: 'Cagliari · Sardinia',
  hero_headline_it: 'Sardegna,\na un\u2019altra velocit\u00e0.',
  hero_headline_en: 'Sardinia,\nat another speed.',
  hero_microcopy_it: 'Terra, mare, aria. Una sola collezione, un solo accesso.',
  hero_microcopy_en: 'Land, sea, air. One collection, one access.',
  hero_cta_label_it: 'La Collezione',
  hero_cta_label_en: 'The Collection',
  hero_cta_to: '/flotta',
  hero_cta2_label_it: 'Esperienze',
  hero_cta2_label_en: 'Experiences',
  hero_cta2_to: '#esperienze',

  // ── Atto 02 — Silenzio ─────────────────────────────────────────────────
  statement_lines_it: ['Scegliere un mezzo', '\u00e8 scegliere', 'come arrivare.'],
  statement_lines_en: ['Choosing how you move', 'is choosing', 'how you arrive.'],
  statement_note_it: 'Terra · Mare · Aria',
  statement_note_en: 'Land · Sea · Air',

  // ── Atto 03 — La Collezione ────────────────────────────────────────────
  collection_eyebrow_it: '01 \u2014 La Collezione',
  collection_eyebrow_en: '01 \u2014 The Collection',
  collection_title_it: 'La Collezione',
  collection_title_en: 'The Collection',
  collection_intro_it: 'Una selezione ristretta. Il catalogo completo \u00e8 a un passo.',
  collection_intro_en: 'A short selection. The full catalogue is one step away.',
  collection_featured_ids: [],
  collection_featured_count: 3,
  collection_cta_label_it: 'Esplora la collezione',
  collection_cta_label_en: 'Explore the collection',
  collection_cta_to: '/flotta',
  collection_item_cta_it: 'Scopri',
  collection_item_cta_en: 'Discover',

  // ── Atto 04 — Esperienze ───────────────────────────────────────────────
  // Solo servizi realmente attivi sul sito, con le stesse destinazioni del menu.
  experiences_eyebrow_it: '02 \u2014 Esperienze',
  experiences_eyebrow_en: '02 \u2014 Experiences',
  experiences_title_it: 'Ci\u00f2 che rendono possibile',
  experiences_title_en: 'What they make possible',
  experiences: [
    { id: 'mare', to: '/noleggio-mare', image_src: '/menu-mare.jpeg',
      title_it: 'Mare', title_en: 'Sea',
      copy_it: 'Yacht, barche ed esperienze esclusive lungo la costa.',
      copy_en: 'Yachts, boats and exclusive experiences along the coast.',
      cta_it: 'Scopri', cta_en: 'Discover' },
    { id: 'aria', to: '/noleggio-aria', image_src: '/menu-aria.jpeg',
      title_it: 'Aria', title_en: 'Air',
      copy_it: 'Voli privati ed elicotteri per viaggiare senza confini.',
      copy_en: 'Private flights and helicopters to travel without limits.',
      cta_it: 'Scopri', cta_en: 'Discover' },
    { id: 'soggiorni', to: '/soggiorni', image_src: '/menu-property.jpeg',
      title_it: 'Soggiorni & Ospitalità', title_en: 'Stays & Hospitality',
      copy_it: 'Ville, appartamenti e residenze selezionate.',
      copy_en: 'Villas, apartments and selected residences.',
      cta_it: 'Scopri', cta_en: 'Discover' },
    // Il nome del servizio e' quello che usa il menu: "Lavaggio & Meccanica".
    // L'immagine e' quella del lavaggio, non la mano guantata sulla portiera
    // (menu-servizi.jpeg), che racconta tutt'altro servizio.
    { id: 'lavaggio-meccanica', to: '/prime-wash', image_src: '/servizi-lavaggio.jpeg',
      title_it: 'Lavaggio & Meccanica', title_en: 'Car Wash & Mechanics',
      copy_it: 'Lavaggio premium, detailing e officina meccanica.',
      copy_en: 'Premium wash, detailing and mechanical workshop.',
      cta_it: 'Scopri', cta_en: 'Discover' },
  ],

  // ── Atto 05 — Marca ────────────────────────────────────────────────────
  brand_lines_it: ['Una flotta', 'non \u00e8 un parcheggio.', '\u00c8 una collezione.'],
  brand_lines_en: ['A fleet', 'is not a car park.', 'It is a collection.'],
  brand_paragraphs: [
    { text_it: 'Selezione, servizio, tecnologia. Ogni veicolo viene preparato, consegnato e riconsegnato secondo lo stesso standard, a Cagliari e in tutta la Sardegna.',
      text_en: 'Selection, service, technology. Every vehicle is prepared, delivered and returned to the same standard, in Cagliari and across Sardinia.' },
    { text_it: 'Una sola piattaforma per prenotare, firmare, pagare e gestire il noleggio, con il credito DR7 Wallet e i vantaggi DR7 Club.',
      text_en: 'One platform to book, sign, pay and manage your rental, with DR7 Wallet credit and DR7 Club benefits.' },
  ],
  // Vuoto di proposito: un numero si pubblica solo se verificato nei dati.
  metrics: [],

  // ── Atto 06 — Accesso ──────────────────────────────────────────────────
  access_title_it: 'Il prossimo arrivo \u00e8 il tuo.',
  access_title_en: 'The next arrival is yours.',
  access_copy_it: 'Scegli il mezzo, la data, il luogo.',
  access_copy_en: 'Choose the vehicle, the date, the place.',
  access_cta_label_it: 'Prenota',
  access_cta_label_en: 'Book now',
  access_cta_to: '/flotta',
  access_media_src: '/poster/video5.jpg',
  access_video_src: '/video5.mp4',
};

// ─── Default Membership seed ────────────────────────────────────────────────
export const INITIAL_MEMBERSHIP: MembershipCopy = {
  hero_eyebrow_it: 'Esclusivo',
  hero_eyebrow_en: 'Exclusive',
  hero_title: 'DR7 CLUB',
  hero_subtitle_it: 'Ogni prenotazione ti premia. Ogni servizio ti ripaga.',
  hero_subtitle_en: 'Every booking rewards you. Every service pays you back.',
  hero_opener_it: 'Attiva i premi del tuo wallet a partire da soli €{monthlyPrice}/mese',
  hero_opener_en: 'Activate your reward wallet starting from just €{monthlyPrice}/month',

  pricing_card_title: 'DR7 CLUB',
  pricing_billing_monthly_it: 'Mensile',
  pricing_billing_monthly_en: 'Monthly',
  pricing_billing_annual_it: 'Annuale',
  pricing_billing_annual_en: 'Annual',
  pricing_billing_save_badge: '-33%',
  pricing_cycle_month_it: 'mese',
  pricing_cycle_month_en: 'month',
  pricing_cycle_year_it: 'anno',
  pricing_cycle_year_en: 'year',
  pricing_savings_it: 'Solo €{annualMonthly} al mese — risparmi €{annualSavings} all’anno',
  pricing_savings_en: 'Just €{annualMonthly}/month — save €{annualSavings}/year',
  pricing_cta_it: 'Iscriviti ora',
  pricing_cta_en: 'Subscribe now',
  pricing_cta_footnote_it: 'Puoi annullare in qualsiasi momento dal tuo account.',
  pricing_cta_footnote_en: 'Cancel anytime from your account.',

  elite_title: 'DR7 Elite Rewards',
  elite_subtitle_it: 'Accumula credito e utilizzalo sui servizi DR7',
  elite_subtitle_en: 'Earn credit and spend it on DR7 services',
  elite_intro_it: 'Con DR7 puoi ottenere vantaggi concreti fin da subito e aumentare il tuo credito semplicemente utilizzando la piattaforma e invitando i tuoi contatti.',
  elite_intro_en: 'With DR7 you get concrete benefits from day one and grow your credit simply by using the platform and inviting your contacts.',

  elite_sections: [
    {
      id: 'vantaggi-immediati',
      variant: 'standard',
      title_it: 'Vantaggi immediati',
      title_en: 'Immediate benefits',
      blocks: [
        { type: 'p', text_it: 'Alla registrazione ricevi:', text_en: 'On registration you receive:' },
        { type: 'ul',
          items_it: ['10€ nel tuo Wallet DR7', '50€ di vantaggio utilizzabile su prenotazioni da almeno 250€'],
          items_en: ['€10 in your DR7 Wallet', '€50 benefit usable on bookings of at least €250'] },
        { type: 'p-italic',
          text_it: 'Il credito è utilizzabile direttamente sui servizi DR7 disponibili in piattaforma.',
          text_en: 'The credit can be used directly on DR7 services available on the platform.' },
      ],
    },
    {
      id: 'invita-e-guadagna',
      variant: 'standard',
      title_it: 'Invita e guadagna',
      title_en: 'Invite and earn',
      blocks: [
        { type: 'p',
          text_it: 'Condividi DR7 con i tuoi contatti e accumula credito in modo illimitato.',
          text_en: 'Share DR7 with your contacts and accumulate credit without limits.' },
        { type: 'p', text_it: 'Per ogni amico che:', text_en: 'For each friend who:' },
        { type: 'ul',
          items_it: ['si registra tramite il tuo invito', 'effettua una ricarica minima di 100€'],
          items_en: ['signs up via your invitation', 'tops up at least €100'] },
        { type: 'p', text_it: 'riceverai:', text_en: 'you receive:' },
        { type: 'ul',
          items_it: ['50€ di credito nel tuo Wallet DR7'],
          items_en: ['€50 credit in your DR7 Wallet'] },
        { type: 'p-italic',
          text_it: 'Non sono previsti limiti al numero di inviti.',
          text_en: 'There is no limit to the number of invitations.' },
      ],
    },
    {
      id: 'come-funziona',
      variant: 'standard',
      title_it: 'Come funziona',
      title_en: 'How it works',
      blocks: [
        { type: 'ul',
          items_it: ['Registrati su DR7', 'Accedi al tuo Wallet personale', 'Condividi il tuo invito', 'Ricevi credito per ogni ricarica valida effettuata dai tuoi amici', 'Utilizza il credito sui servizi disponibili'],
          items_en: ['Sign up on DR7', 'Access your personal Wallet', 'Share your invitation', 'Receive credit for every valid top-up made by your friends', 'Use the credit on available services'] },
      ],
    },
    {
      id: 'condizioni-utilizzo',
      variant: 'standard',
      title_it: 'Condizioni di utilizzo',
      title_en: 'Terms of use',
      blocks: [
        { type: 'ul',
          items_it: [
            'Il credito è utilizzabile esclusivamente all’interno della piattaforma DR7',
            'I bonus vengono accreditati solo a seguito di ricariche effettivamente completate',
            'DR7 si riserva il diritto di verificare e validare ogni operazione',
            'Eventuali abusi o utilizzi non conformi comportano la sospensione dei benefici',
          ],
          items_en: [
            'Credit can only be used within the DR7 platform',
            'Bonuses are credited only after top-ups are actually completed',
            'DR7 reserves the right to verify and validate every transaction',
            'Abuse or non-compliant use results in benefits being suspended',
          ] },
      ],
    },
  ],
  elite_cta_title_it: 'Inizia ora',
  elite_cta_title_en: 'Start now',
  elite_cta_text_it: 'Registrati, attiva il tuo Wallet e inizia ad accumulare credito con DR7.',
  elite_cta_text_en: 'Sign up, activate your Wallet and start earning credit with DR7.',
  elite_cta_logged_out_it: 'Registrati ora',
  elite_cta_logged_out_en: 'Sign up now',
  elite_cta_logged_in_it: 'Vai al tuo Wallet',
  elite_cta_logged_in_en: 'Go to your Wallet',

  reward_title_it: 'Come funzionano i premi',
  reward_title_en: 'How Rewards Work',
  reward_intro_it: 'Accumula credito nel tuo wallet ad ogni prenotazione e servizio. Il premio dipende dal tuo comportamento, non dal metodo di pagamento.',
  reward_intro_en: 'Earn wallet credit on every booking and service. Rewards are based on your behavior, not your payment method.',
  reward_items: [
    { label_it: 'Pagamento anticipato (100%)', label_en: 'Full prepayment (100%)', reward: '2%', note_it: 'fino al 4% per livelli più alti', note_en: 'up to 4% at higher levels' },
    { label_it: 'Pagamento con acconto (30%)', label_en: 'Deposit payment (30%)', reward: '1%', note_it: null, note_en: null },
    { label_it: 'Servizi extra', label_en: 'Extra services', reward: '2%', note_it: null, note_en: null },
    { label_it: 'Lavaggio & Meccanica', label_en: 'Car Wash & Mechanics', reward: '3%', note_it: null, note_en: null },
  ],
  reward_footnote_it: 'Senza DR7 Club il sistema premi non è attivo.',
  reward_footnote_en: 'Without DR7 Club the reward system is not active.',
};

// ─── Default Cancellazione seed ─────────────────────────────────────────────
// Mirrors the legacy hardcoded /cancellation page word-for-word so swapping
// to admin-managed copy is a no-op until someone edits.
export const INITIAL_CANCELLAZIONE: CancellazioneCopy = {
  page_title_it: 'Policy di Cancellazione e Modifica Prenotazioni',
  page_title_en: 'Cancellation and Booking Modification Policy',
  contact_label_it: 'Per assistenza o informazioni:',
  contact_label_en: 'For assistance or information:',
  contact_email: 'info@dr7.app',
  contact_address: 'Dubai Rent 7.0 S.p.A. - Viale Marconi, 229, 09131 Cagliari CA',
  last_updated_it: 'Ultimo aggiornamento: 10 aprile 2026',
  last_updated_en: 'Last updated: April 10, 2026',
  sections: [
    {
      id: 'ambito',
      variant: 'standard',
      title_it: '1. Ambito di applicazione',
      title_en: '1. Scope of application',
      blocks: [
        { type: 'p',
          text_it: 'La presente policy disciplina le condizioni di cancellazione e gestione delle prenotazioni relative a tutti i servizi erogati da Dubai Rent 7.0 S.p.A. (DR7), inclusi – a titolo esemplificativo e non esaustivo – noleggio veicoli, servizi accessori, esperienze e qualsiasi altra prestazione disponibile.',
          text_en: 'This policy governs the cancellation and management conditions for bookings related to all services provided by Dubai Rent 7.0 S.p.A. (DR7), including – but not limited to – vehicle rental, ancillary services, experiences, and any other available service.' },
        { type: 'p',
          text_it: 'La policy si applica a tutte le prenotazioni effettuate tramite:',
          text_en: 'The policy applies to all bookings made via:' },
        { type: 'ul',
          items_it: ['sito web ufficiale DR7', 'sedi operative DR7', 'canali digitali (WhatsApp, e-mail, piattaforme online)', 'contatto telefonico'],
          items_en: ['official DR7 website', 'DR7 operational offices', 'digital channels (WhatsApp, email, online platforms)', 'telephone contact'] },
        { type: 'p',
          text_it: 'Le presenti condizioni sono valide indipendentemente dalla modalità di prenotazione e dal metodo di pagamento utilizzato, inclusi carta di credito/debito, bonifico bancario, wallet DR7 o altri sistemi accettati.',
          text_en: 'These conditions are valid regardless of the booking method and payment method used, including credit/debit card, bank transfer, DR7 wallet, or other accepted systems.' },
      ],
    },
    {
      id: 'entro-soglia',
      variant: 'standard',
      title_it: '2. Cancellazione entro {thresholdDays} giorni dalla data del servizio',
      title_en: '2. Cancellation up to {thresholdDays} days before service date',
      blocks: [
        { type: 'p',
          text_it: 'Il Cliente può cancellare la prenotazione fino a {daysWord} prima della data e ora previste per l’erogazione del servizio.',
          text_en: 'The Customer may cancel the booking up to {daysWord} before the scheduled service date and time.' },
        { type: 'p', text_it: 'In tal caso:', text_en: 'In such case:' },
        { type: 'ul',
          items_it: [
            'DR7 tratterrà una quota pari al {penaltyPercent}% dell’importo complessivo, a copertura dei costi organizzativi e gestionali',
            'il restante {refundPercent}% sarà riconosciuto esclusivamente sotto forma di credit wallet DR7',
          ],
          items_en: [
            'DR7 will retain {penaltyPercent}% of the total amount to cover organizational and management costs',
            'the remaining {refundPercent}% will be credited exclusively as DR7 credit wallet',
          ] },
        { type: 'p-bold', text_it: 'Caratteristiche del credit wallet:', text_en: 'Credit wallet features:' },
        { type: 'ul',
          items_it: ['nessuna scadenza', 'utilizzabile per qualsiasi servizio DR7', 'non cedibile a terzi', 'non convertibile in denaro'],
          items_en: ['no expiry', 'usable for any DR7 service', 'not transferable to third parties', 'not convertible into cash'] },
      ],
    },
    {
      id: 'oltre-soglia',
      variant: 'standard',
      title_it: '3. Cancellazione oltre i {thresholdDays} giorni dalla data del servizio',
      title_en: '3. Cancellation within {thresholdDays} days of service date',
      blocks: [
        { type: 'p',
          text_it: 'In caso di cancellazione comunicata oltre il termine di {daysWord} dalla data prevista per il servizio:',
          text_en: 'In case of cancellation communicated within {daysWord} of the scheduled service date:' },
        { type: 'ul',
          items_it: ['non è previsto alcun rimborso', 'non è prevista emissione di credit wallet'],
          items_en: ['no refund will be granted', 'no credit wallet will be issued'] },
        { type: 'p',
          text_it: 'La prenotazione si intende definitivamente confermata e non rimborsabile, ai sensi degli artt. 1453 e seguenti del Codice Civile, anche in considerazione dell’organizzazione e allocazione delle risorse operative.',
          text_en: 'The booking is considered definitively confirmed and non-refundable, pursuant to Articles 1453 et seq. of the Italian Civil Code, also considering the organization and allocation of operational resources.' },
      ],
    },
    {
      id: 'no-show',
      variant: 'standard',
      title_it: '4. Mancata presentazione (No Show)',
      title_en: '4. No Show',
      blocks: [
        { type: 'p',
          text_it: 'In caso di mancata presentazione del Cliente nel giorno e all’orario concordati, senza preventiva comunicazione nei termini indicati:',
          text_en: 'In case of the Customer’s failure to appear on the agreed day and time, without prior notice within the specified deadlines:' },
        { type: 'ul',
          items_it: ['l’intero importo versato sarà trattenuto a titolo di penale, ai sensi dell’art. 1382 c.c.'],
          items_en: ['the entire amount paid will be retained as a penalty, pursuant to Article 1382 of the Italian Civil Code'] },
        { type: 'p', text_it: 'Rientrano nella fattispecie di No Show anche:', text_en: 'No Show also includes:' },
        { type: 'ul',
          items_it: ['ritardi significativi tali da compromettere l’erogazione del servizio', 'impossibilità di fruire del servizio per cause non comunicate nei termini previsti'],
          items_en: ['significant delays that compromise service delivery', 'inability to use the service due to reasons not communicated within the specified deadlines'] },
        { type: 'p', text_it: 'In tali casi:', text_en: 'In such cases:' },
        { type: 'ul',
          items_it: ['non è previsto alcun rimborso', 'non è prevista emissione di voucher o credito'],
          items_en: ['no refund will be granted', 'no voucher or credit will be issued'] },
      ],
    },
    {
      id: 'modalita',
      variant: 'standard',
      title_it: '5. Modalità di comunicazione delle cancellazioni',
      title_en: '5. Cancellation communication methods',
      blocks: [
        { type: 'p',
          text_it: 'Le richieste di cancellazione devono essere effettuate esclusivamente attraverso i canali ufficiali DR7:',
          text_en: 'Cancellation requests must be made exclusively through official DR7 channels:' },
        { type: 'ul',
          items_it: ['e-mail all’indirizzo: info@dr7.app', 'messaggistica WhatsApp ai numeri ufficiali pubblicati da DR7', 'area riservata del sito web DR7, ove il Cliente può procedere in autonomia alla cancellazione'],
          items_en: ['email to: info@dr7.app', 'WhatsApp messaging to official DR7 numbers', 'DR7 website reserved area, where the Customer can independently proceed with cancellation'] },
        { type: 'p', text_it: 'Ai fini della validità della richiesta:', text_en: 'For the validity of the request:' },
        { type: 'ul',
          items_it: ['farà fede la data e ora di invio della comunicazione tramite i canali sopra indicati', 'per le cancellazioni effettuate tramite sito, farà fede il timestamp registrato dai sistemi DR7'],
          items_en: ['the date and time of sending the communication through the above channels will be authoritative', 'for cancellations made via the website, the timestamp recorded by DR7 systems will be authoritative'] },
        { type: 'p',
          text_it: 'Non saranno ritenute valide richieste di cancellazione effettuate tramite canali non ufficiali o diversi da quelli sopra indicati.',
          text_en: 'Cancellation requests made through unofficial or different channels than those indicated above will not be considered valid.' },
      ],
    },
    {
      id: 'trasparenza',
      variant: 'standard',
      title_it: '6. Trasparenza e accettazione della policy',
      title_en: '6. Transparency and policy acceptance',
      blocks: [
        { type: 'p', text_it: 'La presente policy è:', text_en: 'This policy is:' },
        { type: 'ul',
          items_it: ['pubblicata sul sito ufficiale DR7', 'consultabile durante il processo di prenotazione', 'accessibile tramite link diretto anche nei sistemi di prenotazione via WhatsApp e altri canali digitali'],
          items_en: ['published on the official DR7 website', 'accessible during the booking process', 'accessible via direct link also in WhatsApp booking systems and other digital channels'] },
        { type: 'p-bold',
          text_it: 'La conferma della prenotazione comporta la piena accettazione delle presenti condizioni.',
          text_en: 'Confirmation of the booking implies full acceptance of these conditions.' },
      ],
    },
    {
      id: 'dr7-flex',
      variant: 'flex',
      title_it: '7. Servizio opzionale "DR7 FLEX" (solo noleggio)',
      title_en: '7. Optional "DR7 FLEX" service (rentals only)',
      blocks: [
        { type: 'p',
          text_it: 'DR7 FLEX è un servizio opzionale acquistabile in fase di prenotazione del noleggio. Non è applicabile ad altri servizi.',
          text_en: 'DR7 FLEX is an optional service purchasable when booking a rental. It does not apply to other services.' },
        { type: 'p', text_it: 'Condizioni:', text_en: 'Terms:' },
        { type: 'ul', tone: 'green',
          items_it: ['Cancellazione consentita fino al giorno stesso del noleggio.', 'Rimborso del 90% in credito DR7 Wallet per utilizzi futuri.', 'È possibile 1 solo spostamento gratuito, salvo eventuale differenza di prezzo.', 'Nessuna perdita totale dell’importo, salvo promozioni non rimborsabili o mancata presentazione.'],
          items_en: ['Cancellation allowed up to the same day of the rental.', '90% refund as DR7 Wallet credit for future use.', 'One free reschedule allowed, subject to any price difference.', 'No total loss of the amount, except for non-refundable promotions or no-show.'] },
        { type: 'p-italic',
          text_it: 'In assenza dell’acquisto del servizio DR7 FLEX, si applica integralmente la presente policy standard per il noleggio.',
          text_en: 'In the absence of purchasing the DR7 FLEX service, this standard policy applies in full for the rental.' },
      ],
    },
    {
      id: 'prime-flex',
      variant: 'flex',
      title_it: '8. Servizio opzionale "PRIME FLEX" (solo lavaggio)',
      title_en: '8. Optional "PRIME FLEX" service (car wash only)',
      blocks: [
        { type: 'p',
          text_it: 'PRIME FLEX è un servizio opzionale acquistabile in fase di prenotazione del lavaggio. Non è applicabile ad altri servizi.',
          text_en: 'PRIME FLEX is an optional service purchasable when booking a car wash. It does not apply to other services.' },
        { type: 'p', text_it: 'Condizioni:', text_en: 'Terms:' },
        { type: 'ul', tone: 'green',
          items_it: ['Cancellazione consentita fino al giorno stesso del lavaggio.', 'Rimborso del 90% in credito DR7 Wallet per utilizzi futuri.', 'È possibile 1 solo spostamento gratuito, salvo eventuale differenza di prezzo.', 'Nessuna perdita totale dell’importo, salvo promozioni non rimborsabili o mancata presentazione.'],
          items_en: ['Cancellation allowed up to the same day of the car wash.', '90% refund as DR7 Wallet credit for future use.', 'One free reschedule allowed, subject to any price difference.', 'No total loss of the amount, except for non-refundable promotions or no-show.'] },
        { type: 'p-italic',
          text_it: 'In assenza dell’acquisto del servizio PRIME FLEX, si applica integralmente la presente policy standard per il lavaggio.',
          text_en: 'In the absence of purchasing the PRIME FLEX service, this standard policy applies in full for the car wash.' },
      ],
    },
  ],
};

// ─── Default Legal seed (Privacy + Cookie + Rental Agreement) ──────────────
// Terms ships with `enabled: false` for now — the legacy hardcoded page
// keeps rendering. Admin can enable it later and paste the content.
export const INITIAL_LEGAL: LegalCopy = {
  pages: [
    {
      id: 'privacy',
      enabled: true,
      title_it: 'Informativa sulla Privacy',
      title_en: 'Privacy Policy',
      last_updated_dynamic: true,
      last_updated_label_it: 'Ultimo aggiornamento',
      last_updated_label_en: 'Last updated',
      intro_blocks: [],
      sections: [
        { id: 'introduzione', heading_it: '1. Introduzione e Titolare del Trattamento', heading_en: '1. Introduction and Data Controller',
          blocks: [
            { type: 'p',
              text_it: 'Dubai Rent 7.0 S.p.A. – DR7 ("noi", "nostro" o "ci") si impegna a proteggere la tua privacy. Questa Informativa sulla Privacy spiega come raccogliamo, utilizziamo, divulghiamo e proteggiamo i tuoi dati personali quando utilizzi i nostri servizi. Questa informativa è fornita in conformità con il Regolamento Generale sulla Protezione dei Dati (GDPR) dell\'UE.',
              text_en: 'Dubai Rent 7.0 S.p.A. – DR7 ("we", "our" or "us") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your personal data when you use our services. This notice is provided in compliance with the EU General Data Protection Regulation (GDPR).' },
            { type: 'p',
              text_it: 'DR7 è il Titolare del Trattamento dei dati personali raccolti attraverso la nostra piattaforma ed è responsabile dei tuoi dati personali.',
              text_en: 'DR7 is the Data Controller for personal data collected via our platform and is responsible for your personal data.' },
          ] },
        { id: 'dati-raccolti', heading_it: '2. Dati Personali che Raccogliamo', heading_en: '2. Personal Data We Collect',
          blocks: [
            { type: 'p',
              text_it: 'Possiamo raccogliere, utilizzare, archiviare e trasferire diversi tipi di dati personali su di te, che abbiamo raggruppato come segue:',
              text_en: 'We may collect, use, store and transfer different kinds of personal data about you, which we have grouped as follows:' },
            { type: 'ul',
              items_it: [
                '**Dati di Identità:** Include nome, cognome, nome utente, data di nascita e copie di documenti d\'identità rilasciati dal governo (es. patente di guida, passaporto) per la verifica.',
                '**Dati di Contatto:** Include indirizzo di fatturazione, indirizzo email e numeri di telefono.',
                '**Dati Finanziari:** Include dettagli della carta di pagamento o informazioni sul portafoglio di criptovalute.',
                '**Dati Transazionali:** Include dettagli sui pagamenti da e verso di te e altri dettagli dei servizi che hai acquistato tramite noi.',
                '**Dati Tecnici:** Include indirizzo IP (Internet Protocol), i tuoi dati di accesso, tipo e versione del browser e altre tecnologie sui dispositivi che utilizzi per accedere alla nostra piattaforma.',
              ],
              items_en: [
                '**Identity Data:** Includes first name, last name, username, date of birth, and copies of government-issued ID (e.g. driver\'s license, passport) for verification.',
                '**Contact Data:** Includes billing address, email address, and phone numbers.',
                '**Financial Data:** Includes payment card details or cryptocurrency wallet information.',
                '**Transaction Data:** Includes details about payments to and from you and other details of services you have purchased through us.',
                '**Technical Data:** Includes IP address, your login data, browser type and version, and other technologies on the devices you use to access our platform.',
              ] },
          ] },
        { id: 'come-utilizzo', heading_it: '3. Come Utilizziamo i Tuoi Dati Personali', heading_en: '3. How We Use Your Personal Data',
          blocks: [
            { type: 'p',
              text_it: 'Utilizzeremo i tuoi dati personali solo quando la legge ce lo consente. Più comunemente, utilizzeremo i tuoi dati personali nelle seguenti circostanze:',
              text_en: 'We will only use your personal data when the law allows us to. Most commonly, we will use your personal data in the following circumstances:' },
            { type: 'ul',
              items_it: [
                'Per eseguire il contratto di intermediazione che stiamo per stipulare o abbiamo stipulato con te.',
                'Per facilitare la prenotazione e il contratto di noleggio tra te e il proprietario dell\'asset di terze parti.',
                'Per rispettare un obbligo legale o normativo (come la verifica dell\'identità).',
                'Dove è necessario per i nostri legittimi interessi (o quelli di terzi) e i tuoi interessi e diritti fondamentali non prevalgono su tali interessi.',
              ],
              items_en: [
                'To perform the brokerage contract we are about to enter into or have entered into with you.',
                'To facilitate the booking and rental contract between you and the third-party asset owner.',
                'To comply with a legal or regulatory obligation (such as identity verification).',
                'Where it is necessary for our legitimate interests (or those of third parties) and your interests and fundamental rights do not override those interests.',
              ] },
          ] },
        { id: 'divulgazione', heading_it: '4. Divulgazione dei Tuoi Dati Personali', heading_en: '4. Disclosure of Your Personal Data',
          blocks: [
            { type: 'p',
              text_it: 'Potremmo dover condividere i tuoi dati personali con le parti indicate di seguito per gli scopi indicati nella Sezione 3:',
              text_en: 'We may have to share your personal data with the parties set out below for the purposes set out in Section 3:' },
            { type: 'ul',
              items_it: [
                '**Proprietari di Asset di Terze Parti:** Condivideremo i dati di Identità, Contatto e Transazione necessari con i proprietari degli asset che desideri prenotare per facilitare il Contratto di Noleggio tra te e loro.',
                '**Fornitori di Servizi:** Impieghiamo società di terze parti per l\'elaborazione dei pagamenti e la verifica dell\'identità.',
                '**Consulenti Professionali:** Inclusi avvocati, banchieri, revisori e assicuratori che forniscono servizi di consulenza, bancari, legali, assicurativi e contabili.',
                '**Autorità di Regolamentazione:** Potremmo essere tenuti a condividere i tuoi dati personali con le forze dell\'ordine o altre autorità in Italia se richiesto dalla legge.',
              ],
              items_en: [
                '**Third-Party Asset Owners:** We will share necessary Identity, Contact and Transaction data with the asset owners you wish to book in order to facilitate the Rental Agreement between you and them.',
                '**Service Providers:** We employ third-party companies for payment processing and identity verification.',
                '**Professional Advisers:** Including lawyers, bankers, auditors and insurers who provide consultancy, banking, legal, insurance and accounting services.',
                '**Regulatory Authorities:** We may be required to share your personal data with law enforcement or other authorities in Italy if required by law.',
              ] },
            { type: 'p',
              text_it: 'Richiediamo a tutte le terze parti di rispettare la sicurezza dei tuoi dati personali e di trattarli in conformità con la legge. Non consentiamo ai nostri fornitori di servizi di terze parti di utilizzare i tuoi dati personali per i propri scopi.',
              text_en: 'We require all third parties to respect the security of your personal data and to treat it in accordance with the law. We do not allow our third-party service providers to use your personal data for their own purposes.' },
          ] },
        { id: 'sicurezza', heading_it: '5. Sicurezza dei Dati', heading_en: '5. Data Security',
          blocks: [
            { type: 'p',
              text_it: 'Abbiamo messo in atto misure di sicurezza tecniche e organizzative appropriate per prevenire che i tuoi dati personali vengano accidentalmente persi, utilizzati o accessibili in modo non autorizzato. Limitiamo l\'accesso ai tuoi dati personali a quei dipendenti e terze parti che hanno una necessità aziendale di conoscerli.',
              text_en: 'We have put in place appropriate technical and organizational security measures to prevent your personal data from being accidentally lost, used or accessed in an unauthorized way. We limit access to your personal data to those employees and third parties who have a business need to know.' },
          ] },
        { id: 'diritti-gdpr', heading_it: '6. I Tuoi Diritti Legali ai sensi del GDPR', heading_en: '6. Your Legal Rights under GDPR',
          blocks: [
            { type: 'p',
              text_it: 'In determinate circostanze, hai diritti ai sensi delle leggi sulla protezione dei dati in relazione ai tuoi dati personali. Questi includono:',
              text_en: 'Under certain circumstances, you have rights under data protection laws in relation to your personal data. These include:' },
            { type: 'ul',
              items_it: [
                '**Richiedere l\'accesso** ai tuoi dati personali.',
                '**Richiedere la correzione** dei dati personali che deteniamo su di te.',
                '**Richiedere la cancellazione** dei tuoi dati personali.',
                '**Opporsi al trattamento** dei tuoi dati personali.',
                '**Richiedere la limitazione del trattamento** dei tuoi dati personali.',
                '**Richiedere il trasferimento** dei tuoi dati personali a te o a terzi.',
                '**Revocare il consenso in qualsiasi momento** quando ci affidiamo al consenso per trattare i tuoi dati personali.',
              ],
              items_en: [
                '**Request access** to your personal data.',
                '**Request correction** of the personal data we hold about you.',
                '**Request erasure** of your personal data.',
                '**Object to processing** of your personal data.',
                '**Request restriction of processing** of your personal data.',
                '**Request transfer** of your personal data to you or to a third party.',
                '**Withdraw consent at any time** where we are relying on consent to process your personal data.',
              ] },
            { type: 'p',
              text_it: 'Se desideri esercitare uno di questi diritti, ti preghiamo di contattarci. Hai anche il diritto di presentare un reclamo in qualsiasi momento presso l\'autorità italiana per la protezione dei dati, il Garante per la protezione dei dati personali.',
              text_en: 'If you wish to exercise any of these rights, please contact us. You also have the right to lodge a complaint at any time with the Italian data protection authority, the Garante per la protezione dei dati personali.' },
          ] },
        { id: 'contatti', heading_it: '7. Contattaci', heading_en: '7. Contact Us',
          blocks: [
            { type: 'p',
              text_it: 'Se hai domande su questa Informativa sulla Privacy o sulle nostre pratiche di privacy, contatta il nostro Responsabile della Privacy dei Dati all\'indirizzo: [info@dr7.app](mailto:info@dr7.app).',
              text_en: 'If you have questions about this Privacy Policy or our privacy practices, please contact our Data Privacy Officer at: [info@dr7.app](mailto:info@dr7.app).' },
          ] },
      ],
      outro_blocks: [
        { type: 'p-italic',
          text_it: 'Dubai Rent 7.0 S.p.A.\nViale Marconi, 229, 09131 Cagliari CA\nEmail: info@dr7.app',
          text_en: 'Dubai Rent 7.0 S.p.A.\nViale Marconi, 229, 09131 Cagliari CA\nEmail: info@dr7.app' },
      ],
    },
    {
      id: 'cookie',
      enabled: true,
      title_it: 'Cookie Policy',
      title_en: 'Cookie Policy',
      last_updated_dynamic: true,
      last_updated_label_it: 'Ultimo Aggiornamento',
      last_updated_label_en: 'Last Updated',
      intro_blocks: [],
      sections: [
        { id: 'cosa-sono', heading_it: '1. Cosa Sono i Cookie?', heading_en: '1. What Are Cookies?',
          blocks: [
            { type: 'p',
              text_it: 'I cookie sono piccoli file di testo che vengono memorizzati sul tuo computer, smartphone o altro dispositivo quando visiti un sito web. Sono ampiamente utilizzati per far funzionare i siti web, o farli funzionare in modo più efficiente, nonché per fornire informazioni ai proprietari del sito. I cookie ci aiutano a ricordare le tue preferenze e a capire come utilizzi il nostro sito, il che ci permette di migliorare la tua esperienza.',
              text_en: 'Cookies are small text files stored on your computer, smartphone or other device when you visit a website. They are widely used to make websites work, or to work more efficiently, as well as to provide information to site owners. Cookies help us remember your preferences and understand how you use our site, which allows us to improve your experience.' },
          ] },
        { id: 'come-utilizziamo', heading_it: '2. Come Utilizziamo i Cookie', heading_en: '2. How We Use Cookies',
          blocks: [
            { type: 'p',
              text_it: 'Utilizziamo i cookie per diversi scopi importanti. Possono essere classificati come segue:',
              text_en: 'We use cookies for several important purposes. They can be classified as follows:' },
            { type: 'ul',
              items_it: [
                '**Cookie Strettamente Necessari:** Questi cookie sono essenziali per navigare nel sito web e utilizzare le sue funzionalità, come l\'accesso ad aree protette del sito. Senza questi cookie, servizi come il login utente e il processo di prenotazione non possono essere forniti.',
                '**Cookie di Prestazioni e Analisi:** Questi cookie raccolgono informazioni su come utilizzi il nostro sito web, ad esempio quali pagine visiti più spesso. Questi dati ci aiutano a ottimizzare il nostro sito web e renderlo più facile da navigare. Tutte le informazioni raccolte da questi cookie sono aggregate e quindi anonime.',
                '**Cookie Funzionali:** Questi cookie permettono al nostro sito web di ricordare le scelte che fai durante la navigazione. Ad esempio, possiamo memorizzare la tua posizione geografica in un cookie per assicurarci di mostrarti il sito web localizzato per la tua area, oppure possiamo ricordare preferenze come lingua e valuta. Questo ci consente di fornirti un\'esperienza più personalizzata e conveniente.',
                '**Cookie di Targeting o Pubblicitari:** Questi cookie vengono utilizzati per fornire pubblicità più pertinenti a te e ai tuoi interessi. Vengono utilizzati anche per limitare il numero di volte in cui vedi una pubblicità e per misurare l\'efficacia delle campagne pubblicitarie. Di solito vengono inseriti da reti pubblicitarie con il permesso del gestore del sito web.',
              ],
              items_en: [
                '**Strictly Necessary Cookies:** These cookies are essential for browsing the website and using its features, such as accessing secure areas of the site. Without these cookies, services such as user login and the booking process cannot be provided.',
                '**Performance and Analytics Cookies:** These cookies collect information about how you use our website, for example which pages you visit most often. This data helps us optimize our website and make it easier to navigate. All information these cookies collect is aggregated and therefore anonymous.',
                '**Functional Cookies:** These cookies allow our website to remember choices you make while browsing. For example, we may store your geographical location in a cookie to make sure we show you the website localized for your area, or we may remember preferences such as language and currency. This enables us to provide a more personalized and convenient experience.',
                '**Targeting or Advertising Cookies:** These cookies are used to deliver advertising more relevant to you and your interests. They are also used to limit the number of times you see an advertisement and to measure the effectiveness of advertising campaigns. They are usually placed by advertising networks with the website operator\'s permission.',
              ] },
          ] },
        { id: 'terze-parti', heading_it: '3. Cookie di Terze Parti', heading_en: '3. Third-Party Cookies',
          blocks: [
            { type: 'p',
              text_it: 'Oltre ai nostri cookie, possiamo anche utilizzare vari cookie di terze parti per segnalare statistiche di utilizzo del Servizio, fornire pubblicità sul e attraverso il Servizio, e così via. Ad esempio, utilizziamo Google Analytics per aiutarci a comprendere il traffico del nostro sito web.',
              text_en: 'In addition to our own cookies, we may also use various third-party cookies to report usage statistics of the Service, deliver advertisements on and through the Service, and so on. For example, we use Google Analytics to help us understand the traffic on our website.' },
          ] },
        { id: 'scelte', heading_it: '4. Le Tue Scelte e Gestione dei Cookie', heading_en: '4. Your Choices and Cookie Management',
          blocks: [
            { type: 'p',
              text_it: 'Hai il diritto di decidere se accettare o rifiutare i cookie. Puoi esercitare le tue preferenze sui cookie utilizzando le impostazioni del tuo browser web. La maggior parte dei browser ti consente di controllare i cookie attraverso le loro impostazioni di preferenza. Tuttavia, se limiti la capacità dei siti web di impostare cookie, potresti peggiorare la tua esperienza utente complessiva, poiché non sarà più personalizzata per te. Potrebbe anche impedirti di salvare impostazioni personalizzate come le informazioni di accesso.',
              text_en: 'You have the right to decide whether to accept or refuse cookies. You can exercise your cookie preferences using your web browser settings. Most browsers allow you to control cookies through their preference settings. However, if you limit the ability of websites to set cookies, you may worsen your overall user experience, since it will no longer be personalized for you. It may also prevent you from saving customized settings such as login information.' },
            { type: 'p',
              text_it: 'Per saperne di più sui cookie, incluso come vedere quali cookie sono stati impostati e come gestirli ed eliminarli, visita [www.allaboutcookies.org](https://www.allaboutcookies.org).',
              text_en: 'To learn more about cookies, including how to see which cookies have been set and how to manage and delete them, visit [www.allaboutcookies.org](https://www.allaboutcookies.org).' },
          ] },
        { id: 'modifiche', heading_it: '5. Modifiche a Questa Politica sui Cookie', heading_en: '5. Changes to This Cookie Policy',
          blocks: [
            { type: 'p',
              text_it: 'Possiamo aggiornare questa Politica sui Cookie di tanto in tanto per riflettere, ad esempio, modifiche ai cookie che utilizziamo o per altri motivi operativi, legali o normativi. Ti invitiamo quindi a rivisitare regolarmente questa Politica sui Cookie per rimanere informato sul nostro utilizzo dei cookie e delle tecnologie correlate.',
              text_en: 'We may update this Cookie Policy from time to time to reflect, for example, changes to the cookies we use or for other operational, legal or regulatory reasons. We therefore encourage you to revisit this Cookie Policy regularly to stay informed about our use of cookies and related technologies.' },
          ] },
      ],
      outro_blocks: [],
    },
    {
      id: 'rental_agreement',
      enabled: true,
      title_it: 'Contratto di Noleggio (Riassunto)',
      title_en: 'Rental Agreement (Overview)',
      last_updated_dynamic: false,
      last_updated_label_it: '',
      last_updated_label_en: '',
      intro_blocks: [
        { type: 'p-bold',
          text_it: 'Avviso Importante: Questo documento fornisce una panoramica generale dei termini e delle condizioni tipici che disciplinano il noleggio di asset di lusso attraverso la piattaforma DR7. DR7 agisce come intermediario e non è parte del contratto di noleggio finale. L\'accordo legalmente vincolante ("Contratto di Noleggio") sarà tra te ("il Noleggiatore") e il proprietario di terze parti ("il Proprietario"), e i suoi termini specifici possono variare.',
          text_en: '**Important Notice:** This document provides a general overview of the typical terms and conditions governing the rental of luxury assets through the DR7 platform. DR7 acts as a broker and is not a party to the final rental contract. The legally binding agreement ("Rental Agreement") will be between you ("the Renter") and the third-party asset owner ("the Owner"), and its specific terms may vary.' },
      ],
      sections: [
        { id: 'brokerage', heading_it: '1. Il Ruolo di Intermediazione di DR7', heading_en: '1. The Brokerage Role of DR7',
          blocks: [
            { type: 'p',
              text_it: 'DR7 facilita la connessione tra il Noleggiatore e il Proprietario. Non siamo proprietari né operatori degli asset elencati. Questo documento ha lo scopo di fornire un riassunto dei termini comuni che ci si può aspettare nel Contratto di Noleggio finale del Proprietario.',
              text_en: 'DR7 facilitates the connection between the Renter and the Owner. We are not the owner or operator of the assets listed. This document is intended to provide a summary of common terms to expect in the Owner\'s final Rental Agreement.' },
          ] },
        { id: 'parties', heading_it: '2. Parti Principali', heading_en: '2. Key Parties',
          blocks: [
            { type: 'ul',
              items_it: [
                '**Il Noleggiatore ("tu"):** Il cliente che prenota l\'asset.',
                '**Il Proprietario:** La società o persona di terze parti che possiede e fornisce l\'asset in noleggio.',
                '**DR7 ("l\'Intermediario"):** L\'intermediario che facilita la transazione.',
              ],
              items_en: [
                '**The Renter ("you"):** The client booking the asset.',
                '**The Owner:** The third-party company or individual who owns and provides the asset for rent.',
                '**DR7 ("the Broker"):** The intermediary facilitating the transaction.',
              ] },
          ] },
        { id: 'obligations', heading_it: '3. Obblighi Generali del Noleggiatore', heading_en: '3. General Renter Obligations',
          blocks: [
            { type: 'p',
              text_it: 'Il Contratto di Noleggio finale con il Proprietario richiederà tipicamente al Noleggiatore di:',
              text_en: 'The final Rental Agreement with the Owner will typically require the Renter to:' },
            { type: 'ul',
              items_it: [
                'Soddisfare i requisiti minimi di età e di patente (es. 25+ con patente di guida valida per le auto).',
                'Fornire una cauzione contro potenziali danni, multe o altre spese accessorie.',
                'Operare l\'asset in sicurezza e conformemente a tutte le leggi applicabili e alle regole specifiche del Proprietario.',
                'Restituire l\'asset all\'orario e nel luogo concordati, nelle stesse condizioni in cui è stato ricevuto, salvo normale usura.',
              ],
              items_en: [
                'Meet minimum age and licensing requirements (e.g. 25+ with a valid driver\'s license for cars).',
                'Provide a security deposit against potential damages, fines, or other incidental charges.',
                'Operate the asset safely and in accordance with all applicable laws and the Owner\'s specific rules.',
                'Return the asset at the agreed time and location, in the same condition it was received, allowing for normal wear and tear.',
              ] },
          ] },
        { id: 'insurance', heading_it: '4. Assicurazione e Responsabilità', heading_en: '4. Insurance and Liability',
          blocks: [
            { type: 'p',
              text_it: 'L\'assicurazione per l\'asset è fornita dal Proprietario, non da DR7. Le specifiche della copertura, inclusa la franchigia di cui sei responsabile in caso di danno, saranno dettagliate nel Contratto di Noleggio del Proprietario. Il Noleggiatore è tipicamente responsabile per tutti i danni, le perdite e le violazioni di legge non coperte dalla polizza assicurativa del Proprietario. DR7 non è responsabile per alcun incidente relativo all\'asset.',
              text_en: 'Insurance for the asset is provided by the Owner, not by DR7. The specifics of the coverage, including the deductible (excess) amount for which you are responsible in case of damage, will be detailed in the Owner\'s Rental Agreement. The Renter is typically liable for all damages, losses, and legal violations that are not covered by the Owner\'s insurance policy. DR7 is not liable for any incidents related to the asset.' },
          ] },
        { id: 'prohibited', heading_it: '5. Usi Vietati', heading_en: '5. Prohibited Uses',
          blocks: [
            { type: 'p',
              text_it: 'Ogni Contratto di Noleggio conterrà una lista di usi vietati. Questi includono quasi universalmente, ma non sono limitati a:',
              text_en: 'Every Rental Agreement will contain a list of prohibited uses. These almost universally include, but are not limited to:' },
            { type: 'ul',
              items_it: [
                'Uso per qualsiasi scopo illegale.',
                'Partecipazione a gare, competizioni o test di prestazione.',
                'Operazione da parte di qualsiasi persona non esplicitamente autorizzata nel Contratto di Noleggio.',
                'Uso sotto l\'effetto di alcol, narcotici o altre sostanze che alterano le facoltà.',
                'Uso al di fuori dell\'area geografica contrattualmente consentita.',
              ],
              items_en: [
                'Use for any illegal purpose.',
                'Participation in races, competitions, or performance tests.',
                'Operation by any person not explicitly authorized in the Rental Agreement.',
                'Use while under the influence of alcohol, narcotics, or other impairing substances.',
                'Use outside of the contractually permitted geographical area.',
              ] },
          ] },
        { id: 'final', heading_it: '6. Accordo Finale', heading_en: '6. Final Agreement',
          blocks: [
            { type: 'p',
              text_it: 'Alla conferma della tua richiesta di prenotazione, ti verrà presentato il Contratto di Noleggio finale del Proprietario. Devi leggerlo, comprenderlo e accettarne i termini prima che il noleggio possa iniziare. Procedendo con la prenotazione, riconosci che DR7 è esclusivamente un intermediario e che il tuo rapporto legale per il noleggio è con il Proprietario dell\'asset.',
              text_en: 'Upon confirmation of your booking request, you will be presented with the Owner\'s final Rental Agreement. You must read, understand, and agree to its terms before the rental can commence. By proceeding with the booking, you acknowledge that DR7 is solely a broker and that your legal relationship for the rental is with the Owner of the asset.' },
          ] },
      ],
      outro_blocks: [],
    },
    {
      id: 'terms',
      enabled: true,
      title_it: 'Termini di Servizio',
      title_en: 'Terms of Service',
      last_updated_dynamic: true,
      last_updated_label_it: 'Ultimo aggiornamento',
      last_updated_label_en: 'Last updated',
      intro_blocks: [],
      sections: [
        { id: 'accettazione', heading_it: 'Accettazione dei Termini', heading_en: 'Acceptance of Terms', blocks: [
          { type: 'p',
            text_it: 'Benvenuto su DR7 ("DR7", "noi", "nostro"). Le presenti Condizioni Generali del Servizio di Intermediazione ("Termini") disciplinano l\'utilizzo della nostra piattaforma e dei nostri servizi (collettivamente, i "Servizi").',
            text_en: 'Welcome to DR7 ("DR7", "we", "our"). These General Terms of the Brokerage Service ("Terms") govern the use of our platform and services (collectively, the "Services").' },
          { type: 'p',
            text_it: 'Accedendo o utilizzando i nostri Servizi, l\'utente accetta di essere vincolato dai presenti Termini e dalla nostra Informativa sulla Privacy. In caso di disaccordo, è vietato utilizzare i Servizi.',
            text_en: 'By accessing or using our Services, you agree to be bound by these Terms and by our Privacy Policy. If you do not agree, you must not use the Services.' },
          { type: 'p',
            text_it: 'I presenti Termini costituiscono un accordo legalmente vincolante tra l\'utente ("Cliente", "tu") e DR7, relativo all\'accesso e all\'utilizzo della piattaforma DR7.',
            text_en: 'These Terms constitute a legally binding agreement between you ("Customer", "you") and DR7 regarding access to and use of the DR7 platform.' },
        ]},
        { id: 'intermediario', heading_it: 'Il Nostro Ruolo di Intermediario', heading_en: 'Our Role as Broker', blocks: [
          { type: 'p',
            text_it: 'DR7 fornisce un servizio esclusivo di intermediazione, agendo come tramite per mettere in contatto l\'utente con una rete selezionata di proprietari e operatori terzi ("Proprietari") di beni di lusso, inclusi ma non limitati a automobili, yacht, ville e jet privati ("Beni").',
            text_en: 'DR7 provides an exclusive brokerage service, acting as the intermediary that connects you with a selected network of third-party owners and operators ("Owners") of luxury goods, including but not limited to cars, yachts, villas and private jets ("Goods").' },
          { type: 'p-bold', text_it: 'Importante', text_en: 'Important' },
          { type: 'p',
            text_it: 'DR7 non è il proprietario, l\'operatore o l\'assicuratore dei Beni. Il nostro ruolo è strettamente limitato a facilitare il processo di prenotazione tra l\'utente e il Proprietario. La fornitura del Bene è di esclusiva responsabilità del Proprietario.',
            text_en: 'DR7 is not the owner, operator or insurer of the Goods. Our role is strictly limited to facilitating the booking process between you and the Owner. Provision of the Good is the sole responsibility of the Owner.' },
          { type: 'p',
            text_it: 'Il noleggio o il charter di un Bene sarà soggetto a un accordo separato e legalmente vincolante tra l\'utente e il rispettivo Proprietario ("Contratto di Noleggio").',
            text_en: 'The rental or charter of a Good will be subject to a separate, legally binding agreement between you and the respective Owner ("Rental Agreement").' },
        ]},
        { id: 'account', heading_it: 'Account Utente e Verifica del Cliente', heading_en: 'User Account and Customer Verification', blocks: [
          { type: 'p',
            text_it: 'Per accedere ai nostri Servizi, è necessario avere almeno 25 anni e la capacità giuridica di stipulare contratti vincolanti.',
            text_en: 'To access our Services you must be at least 25 years old and have the legal capacity to enter into binding contracts.' },
          { type: 'p',
            text_it: 'È richiesta la registrazione di un account con informazioni accurate e complete. Per conformità alle normative italiane e internazionali, incluse le leggi antiriciclaggio (AML), potremmo richiedere la verifica dell\'identità, incluso un documento di identità rilasciato dal governo, prima di confermare prenotazioni di alto valore.',
            text_en: 'Registration of an account with accurate and complete information is required. For compliance with Italian and international regulations, including anti-money laundering (AML) laws, we may require identity verification, including a government-issued ID, before confirming high-value bookings.' },
        ]},
        { id: 'pagamenti', heading_it: 'Prenotazioni, Pagamenti e Condizioni Finanziarie', heading_en: 'Bookings, Payments and Financial Terms', blocks: [
          { type: 'p-bold', text_it: 'Prenotazione', text_en: 'Booking' },
          { type: 'p',
            text_it: 'Una richiesta di prenotazione inoltrata tramite la nostra piattaforma costituisce un\'offerta di noleggio di un Bene. La prenotazione è confermata solo al ricevimento di una conferma formale da parte nostra e all\'accettazione del Contratto di Noleggio del Proprietario.',
            text_en: 'A booking request submitted via our platform constitutes an offer to rent a Good. The booking is confirmed only upon receipt of a formal confirmation from us and acceptance of the Owner\'s Rental Agreement.' },
          { type: 'p-bold', text_it: 'Pagamenti', text_en: 'Payments' },
          { type: 'p',
            text_it: 'In qualità di intermediario, DR7 facilita i pagamenti dall\'utente al Proprietario. L\'utente ci autorizza ad addebitare il metodo di pagamento prescelto per l\'importo totale della prenotazione, inclusi canone di noleggio, tasse e deposito cauzionale.',
            text_en: 'As broker, DR7 facilitates payments from you to the Owner. You authorize us to charge your chosen payment method for the total booking amount, including rental fee, taxes and security deposit.' },
        ]},
        { id: 'assegnazione-veicolo', heading_it: 'Assegnazione e Sostituzione Veicolo', heading_en: 'Vehicle Assignment and Substitution', blocks: [
          { type: 'p',
            text_it: 'Il veicolo prenotato dal Cliente corrisponde al modello selezionato in fase di prenotazione. Tuttavia, per cause operative non imputabili a DR7 (quali, a titolo esemplificativo, sinistri, guasti, ritardi nella riconsegna o esigenze tecniche), il veicolo potrebbe non essere disponibile al momento del ritiro. In tali circostanze, DR7 si riserva il diritto di fornire un veicolo sostitutivo appartenente alla stessa categoria o a categoria superiore.',
            text_en: 'The vehicle booked by the Customer corresponds to the model selected at booking. However, for operational reasons not attributable to DR7 (such as, by way of example, accidents, breakdowns, late returns or technical requirements), the vehicle may not be available at pickup. In such circumstances, DR7 reserves the right to provide a substitute vehicle of the same or higher category.' },
          { type: 'p',
            text_it: 'Il Cliente accetta che tale sostituzione costituisce regolare esecuzione del contratto, senza diritto a rimborso o riduzione del corrispettivo.',
            text_en: 'The Customer accepts that such substitution constitutes proper execution of the contract, without entitlement to refund or fee reduction.' },
        ]},
        { id: 'proprietari', heading_it: 'Ruolo dei Proprietari Terzi', heading_en: 'Role of Third-Party Owners', blocks: [
          { type: 'p',
            text_it: 'I Proprietari sono entità indipendenti e non sono dipendenti o agenti di DR7. I Proprietari sono gli unici responsabili di:',
            text_en: 'Owners are independent entities and are not employees or agents of DR7. Owners are solely responsible for:' },
          { type: 'ul',
            items_it: [
              'Garantire che il Bene sia in condizioni sicure, legali e operative.',
              'Fornire un\'assicurazione completa per il Bene.',
              'Eseguire il Contratto di Noleggio finale con l\'utente.',
              'La consegna, la gestione e il ritiro del Bene.',
            ],
            items_en: [
              'Ensuring the Good is in safe, legal and operational condition.',
              'Providing full insurance for the Good.',
              'Executing the final Rental Agreement with you.',
              'Delivery, handling and pickup of the Good.',
            ] },
          { type: 'p',
            text_it: 'Sebbene DR7 selezioni attentamente tutti i Proprietari della propria rete, non garantiamo le prestazioni o la qualità di alcun Bene o Proprietario.',
            text_en: 'Although DR7 carefully selects all Owners in its network, we do not guarantee the performance or quality of any Good or Owner.' },
        ]},
        { id: 'responsabilita', heading_it: 'Limitazione di Responsabilità', heading_en: 'Limitation of Liability', blocks: [
          { type: 'p',
            text_it: 'Nella misura massima consentita dalla legge italiana, la responsabilità di DR7 è limitata al suo ruolo di servizio di intermediazione. Non saremo responsabili per danni diretti, indiretti, incidentali, speciali o consequenziali, derivanti da:',
            text_en: 'To the maximum extent permitted by Italian law, DR7\'s liability is limited to its role as a brokerage service. We will not be liable for direct, indirect, incidental, special or consequential damages arising from:' },
          { type: 'ul',
            items_it: [
              'Le condizioni, le prestazioni o la legalità di qualsiasi Bene.',
              'Qualsiasi atto o omissione da parte di un Proprietario o del suo personale.',
              'I termini del, o la violazione da parte dell\'utente del, Contratto di Noleggio.',
              'Qualsiasi controversia tra l\'utente e un Proprietario.',
            ],
            items_en: [
              'The condition, performance or legality of any Good.',
              'Any act or omission by an Owner or its staff.',
              'The terms of, or your breach of, the Rental Agreement.',
              'Any dispute between you and an Owner.',
            ] },
          { type: 'p',
            text_it: 'La nostra responsabilità totale per qualsiasi questione derivante dai presenti Termini non supererà la commissione di intermediazione da noi ricevuta per la specifica prenotazione in questione.',
            text_en: 'Our total liability for any matter arising from these Terms shall not exceed the brokerage fee we received for the specific booking in question.' },
        ]},
        { id: 'assistente-ai', heading_it: 'Assistente Virtuale (AI)', heading_en: 'AI Virtual Assistant', blocks: [
          { type: 'p',
            text_it: 'Il sito web di DR7 mette a disposizione un assistente virtuale basato su intelligenza artificiale (di seguito "Assistente AI") a scopo puramente informativo e orientativo.',
            text_en: 'The DR7 website provides an AI-based virtual assistant ("AI Assistant") for purely informational and orientation purposes.' },
          { type: 'p-bold', text_it: 'L\'utente prende atto e accetta che:', text_en: 'You acknowledge and accept that:' },
          { type: 'ul',
            items_it: [
              'L\'Assistente AI è un sistema automatizzato che può generare risposte imprecise, incomplete o errate, inclusi prezzi, disponibilità e specifiche tecniche dei veicoli.',
              '**Le informazioni fornite dall\'Assistente AI, inclusi prezzi e preventivi, non sono in alcun modo vincolanti** e non costituiscono un\'offerta contrattuale ai sensi degli artt. 1326 e seguenti del Codice Civile italiano.',
              '**L\'unico prezzo vincolante è quello visualizzato e confermato nella pagina di prenotazione** al momento della finalizzazione dell\'ordine.',
              'DR7 declina ogni responsabilità per decisioni prese dall\'utente sulla base delle informazioni fornite dall\'Assistente AI.',
              'L\'utente è invitato a verificare sempre le informazioni attraverso la pagina di prenotazione ufficiale o contattando direttamente il servizio clienti.',
            ],
            items_en: [
              'The AI Assistant is an automated system that may generate imprecise, incomplete or incorrect answers, including prices, availability and vehicle specs.',
              '**Information provided by the AI Assistant, including prices and quotes, is in no way binding** and does not constitute a contractual offer under Articles 1326 et seq. of the Italian Civil Code.',
              '**The only binding price is the one displayed and confirmed on the booking page** at order finalization.',
              'DR7 disclaims all liability for decisions made based on information provided by the AI Assistant.',
              'You are invited to always verify information through the official booking page or by contacting customer service directly.',
            ] },
        ]},
        { id: 'legge', heading_it: 'Legge Applicabile e Foro Competente', heading_en: 'Governing Law and Jurisdiction', blocks: [
          { type: 'p',
            text_it: 'I presenti Termini e l\'utilizzo dei Servizi sono regolati e interpretati in conformità con le leggi italiane. L\'utente accetta irrevocabilmente che il Tribunale di Cagliari, Italia, avrà giurisdizione esclusiva per risolvere qualsiasi controversia o reclamo derivante da o in connessione con il presente accordo o il suo oggetto.',
            text_en: 'These Terms and use of the Services are governed by and interpreted in accordance with Italian law. You irrevocably agree that the Court of Cagliari, Italy, shall have exclusive jurisdiction to resolve any dispute or claim arising out of or in connection with this agreement or its subject matter.' },
        ]},
        { id: 'modifiche', heading_it: 'Modifiche ai Termini e ai Servizi', heading_en: 'Changes to the Terms and Services', blocks: [
          { type: 'p',
            text_it: 'Ci riserviamo il diritto di modificare i presenti Termini in qualsiasi momento. Forniremo avviso di eventuali modifiche sostanziali pubblicando i nuovi Termini sulla nostra piattaforma. L\'uso continuato dei Servizi dopo tali modifiche costituisce accettazione dei nuovi Termini.',
            text_en: 'We reserve the right to modify these Terms at any time. We will provide notice of any material changes by publishing the new Terms on our platform. Continued use of the Services after such changes constitutes acceptance of the new Terms.' },
        ]},
        { id: 'policy-operativa', heading_it: 'Policy Operativa – Tempi di Servizio e Consegna', heading_en: 'Operational Policy – Service Times and Delivery', blocks: [
          { type: 'p',
            text_it: 'I tempi indicati per i servizi (lavaggio, trattamenti, check-in, check-out e consegne veicoli) sono da intendersi come tempi stimati e indicativi, calcolati su condizioni operative standard.',
            text_en: 'Times indicated for services (washing, treatments, check-in, check-out and vehicle deliveries) are estimated and indicative, calculated on standard operational conditions.' },
          { type: 'p', text_it: 'La durata effettiva del servizio può variare in base a:', text_en: 'Actual service duration may vary based on:' },
          { type: 'ul',
            items_it: ['Stato del veicolo', 'Livello di sporco o complessità dell\'intervento', 'Verifiche tecniche e controlli qualitativi', 'Flussi operativi interni', 'Eventuali ritardi logistici non prevedibili'],
            items_en: ['Vehicle condition', 'Dirt level or intervention complexity', 'Technical checks and quality controls', 'Internal operational flows', 'Any unforeseeable logistical delays'] },
          { type: 'p-bold',
            text_it: 'L\'orario di prenotazione o consegna rappresenta una fascia operativa programmata e non un orario tassativo di inizio o rilascio immediato del veicolo. Eventuali variazioni contenute entro una normale tolleranza tecnica e organizzativa non costituiscono inadempimento contrattuale né danno diritto a riduzioni o rimborsi.',
            text_en: 'The booking or delivery time represents a scheduled operational window and not a strict start or immediate release time for the vehicle. Variations within normal technical and organizational tolerance do not constitute a contractual breach and do not entitle the customer to reductions or refunds.' },
          { type: 'p',
            text_it: 'L\'azienda si impegna comunque a garantire la massima puntualità compatibilmente con gli standard qualitativi e di sicurezza previsti.',
            text_en: 'The company nonetheless undertakes to ensure maximum punctuality compatible with the quality and safety standards required.' },
        ]},
        { id: 'contatto', heading_it: 'Informazioni di Contatto', heading_en: 'Contact Information', blocks: [
          { type: 'p',
            text_it: 'Per qualsiasi domanda o comunicazione legale riguardante i presenti Termini, si prega di contattare il nostro ufficio legale all\'indirizzo: [info@dr7.app](mailto:info@dr7.app).',
            text_en: 'For any questions or legal communications regarding these Terms, please contact our legal office at: [info@dr7.app](mailto:info@dr7.app).' },
        ]},
      ],
      outro_blocks: [],
    },
  ],
};
