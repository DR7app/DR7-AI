/**
 * SitoTab — Admin "Sito" tab
 *
 * Lets the operator edit website-visible copy (FAQ, Cancellation,
 * Membership, Hero, etc.) without a developer or redeploy. Each
 * section persists to `centralina_pro_config.config.site_copy.*`
 * and the website reads it via `utils/siteCopy.ts` with a hardcoded
 * fallback for the legacy strings.
 *
 * Access control:
 *   - Whitelist (no OTP):  valerio@dr7.app, ilenia@dr7.app
 *   - Everyone else:       OTP gate via LimitationOverrideModal
 *                          codes: `gestione_sito_access` (open tab),
 *                                 `gestione_sito_write`  (save changes)
 *
 * Implemented sub-sections:
 *   - faq          (editable list of question/answer pairs)
 *   - cancellazione, membership, hero, chi-siamo, footer, legali
 *                   (placeholder shells — will be filled iteratively)
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../../supabaseClient'
import { useAdminRole } from '../../../hooks/useAdminRole'
import { useLimitationOverride } from '../../../hooks/useLimitationOverride'
import LimitationOverrideModal from '../../../components/LimitationOverrideModal'

// ─── Whitelist ───────────────────────────────────────────────────────────────
// Strict: only direzione (Valerio + Ilenia) can open the tab without OTP.
const SITO_DIREZIONE_EMAILS = ['valerio@dr7.app', 'ilenia@dr7.app']

// ─── Sections ────────────────────────────────────────────────────────────────
type SectionId =
    | 'faq'
    | 'cancellazione'
    | 'membership'
    | 'hero'
    | 'chi-siamo'
    | 'footer'
    | 'legali'
    | 'careers'
    | 'press'
    | 'contatti'
    | 'meccanica'
    | 'lavaggio'
    | 'investitori'
    | 'franchising'
    | 'aviation'
    | 'check-email'
    | 'jet-search'
    | 'confirmation'
    | 'header'

const SECTIONS: { id: SectionId; title: string; ready: boolean }[] = [
    { id: 'faq', title: 'FAQ', ready: true },
    { id: 'cancellazione', title: 'Cancellazione', ready: true },
    { id: 'membership', title: 'Membership / DR7 Club', ready: true },
    { id: 'hero', title: 'Home / Hero', ready: true },
    { id: 'chi-siamo', title: 'Chi Siamo', ready: true },
    { id: 'footer', title: 'Footer', ready: true },
    { id: 'legali', title: 'Privacy & Termini', ready: true },
    { id: 'careers', title: 'Careers', ready: true },
    { id: 'press', title: 'Press', ready: true },
    { id: 'contatti', title: 'Contatti', ready: true },
    { id: 'meccanica', title: 'Servizi Meccanica', ready: true },
    { id: 'lavaggio', title: 'Servizi Lavaggio', ready: true },
    { id: 'investitori', title: 'Investitori', ready: true },
    { id: 'franchising', title: 'Franchising', ready: true },
    { id: 'aviation', title: 'Aviation Quote', ready: true },
    { id: 'check-email', title: 'Check Email', ready: true },
    { id: 'jet-search', title: 'Jet Search Results', ready: true },
    { id: 'confirmation', title: 'Conferma Prenotazione', ready: true },
    { id: 'header', title: 'Header / Navigazione', ready: true },
]

// ─── FAQ schema ──────────────────────────────────────────────────────────────
interface FaqEntry {
    id: string
    question: string
    answer: string
}

interface FaqCopy {
    eyebrow_it: string
    eyebrow_en: string
    page_title_it: string
    page_title_en: string
    subtitle_it: string
    subtitle_en: string
    entries: FaqEntry[]
}

// ─── Cancellazione schema (mirror of website utils/siteCopy.ts) ─────────────
type CancellazioneBlock =
    | { type: 'p'; text_it: string; text_en: string }
    | { type: 'p-bold'; text_it: string; text_en: string }
    | { type: 'p-italic'; text_it: string; text_en: string }
    | { type: 'ul'; items_it: string[]; items_en: string[]; tone?: 'default' | 'green' }

interface CancellazioneSection {
    id: string
    variant: 'standard' | 'flex'
    title_it: string
    title_en: string
    blocks: CancellazioneBlock[]
}

interface CancellazioneCopy {
    page_title_it: string
    page_title_en: string
    sections: CancellazioneSection[]
    contact_label_it: string
    contact_label_en: string
    contact_email: string
    contact_address: string
    last_updated_it: string
    last_updated_en: string
}

// ─── Membership schema (mirror of website utils/siteCopy.ts) ───────────────
interface MembershipRewardItem {
    label_it: string
    label_en: string
    reward: string
    note_it: string | null
    note_en: string | null
}

interface MembershipCopy {
    hero_eyebrow_it: string; hero_eyebrow_en: string
    hero_title: string
    hero_subtitle_it: string; hero_subtitle_en: string
    hero_opener_it: string; hero_opener_en: string
    pricing_card_title: string
    pricing_billing_monthly_it: string; pricing_billing_monthly_en: string
    pricing_billing_annual_it: string; pricing_billing_annual_en: string
    pricing_billing_save_badge: string
    pricing_cycle_month_it: string; pricing_cycle_month_en: string
    pricing_cycle_year_it: string; pricing_cycle_year_en: string
    pricing_savings_it: string; pricing_savings_en: string
    pricing_cta_it: string; pricing_cta_en: string
    pricing_cta_footnote_it: string; pricing_cta_footnote_en: string
    elite_title: string
    elite_subtitle_it: string; elite_subtitle_en: string
    elite_intro_it: string; elite_intro_en: string
    elite_sections: CancellazioneSection[]
    elite_cta_title_it: string; elite_cta_title_en: string
    elite_cta_text_it: string; elite_cta_text_en: string
    elite_cta_logged_out_it: string; elite_cta_logged_out_en: string
    elite_cta_logged_in_it: string; elite_cta_logged_in_en: string
    reward_title_it: string; reward_title_en: string
    reward_intro_it: string; reward_intro_en: string
    reward_items: MembershipRewardItem[]
    reward_footnote_it: string; reward_footnote_en: string
}

// ─── Home / Hero schema (mirror of website utils/siteCopy.ts) ──────────────
interface HomeSlide {
    id: string
    video_src: string
}

interface HomeCategoryOverride {
    id: string
    display_title_it: string
    display_title_en: string
    image_src: string
}

interface HomeCopy {
    seo_h1_it: string
    seo_h1_en: string
    hero_autoplay_seconds: number
    hero_slides: HomeSlide[]
    categories: HomeCategoryOverride[]
}

const INITIAL_HOME: HomeCopy = {
    seo_h1_it: '',
    seo_h1_en: '',
    hero_autoplay_seconds: 8,
    hero_slides: [],
    categories: [],
}

// ─── Chi Siamo schema (mirror of website utils/siteCopy.ts) ────────────────
interface AboutFounder {
    id: string
    name: string
    role_it: string; role_en: string
    photo_src: string
    alt_it: string; alt_en: string
}

interface BilingualParagraph {
    text_it: string
    text_en: string
}

interface AboutCopy {
    founders: AboutFounder[]
    story_title_it: string; story_title_en: string
    story_paragraphs: BilingualParagraph[]
    story_outro_main_it: string; story_outro_main_en: string
    story_outro_sub_it: string; story_outro_sub_en: string
    story_signature: string
}

const INITIAL_ABOUT: AboutCopy = {
    founders: [],
    story_title_it: '', story_title_en: '',
    story_paragraphs: [],
    story_outro_main_it: '', story_outro_main_en: '',
    story_outro_sub_it: '', story_outro_sub_en: '',
    story_signature: '',
}

// ─── Footer schema (mirror of website utils/siteCopy.ts) ───────────────────
type FooterSocialIcon = 'instagram' | 'tiktok' | 'facebook' | 'linkedin' | 'youtube' | 'x'

interface FooterSocialLink {
    id: string
    label: string
    href: string
    icon: FooterSocialIcon
}

interface FooterLink {
    id: string
    label_it: string
    label_en: string
    to: string
    external?: boolean
}

interface FooterCopy {
    network_title: string
    network_text_it: string; network_text_en: string
    social_links: FooterSocialLink[]
    reviews_title: string
    reviews_text_it: string; reviews_text_en: string
    contact_title: string
    contact_whatsapp_number: string
    contact_whatsapp_url: string
    contact_company_name: string
    contact_legal_address_it: string; contact_legal_address_en: string
    contact_capitale_sociale_it: string; contact_capitale_sociale_en: string
    contact_piva: string
    contact_disclaimer_it: string; contact_disclaimer_en: string
    division_links: FooterLink[]
    corporate_links: FooterLink[]
    legal_links: FooterLink[]
    bottom_brand_line: string
    bottom_copyright: string
}

// ─── Legal pages schema (mirror of website utils/siteCopy.ts) ──────────────
type LegalPageId = 'privacy' | 'cookie' | 'rental_agreement' | 'terms'

interface LegalSection {
    id: string
    heading_it: string
    heading_en: string
    blocks: CancellazioneBlock[]
}

interface LegalPageCopy {
    id: LegalPageId
    enabled: boolean
    title_it: string
    title_en: string
    last_updated_dynamic: boolean
    last_updated_label_it: string
    last_updated_label_en: string
    intro_blocks: CancellazioneBlock[]
    sections: LegalSection[]
    outro_blocks: CancellazioneBlock[]
}

interface LegalCopy {
    pages: LegalPageCopy[]
}

const LEGAL_PAGE_DEFAULTS: Record<LegalPageId, { title_it: string; title_en: string }> = {
    privacy:          { title_it: 'Informativa sulla Privacy',     title_en: 'Privacy Policy' },
    cookie:           { title_it: 'Cookie Policy',                 title_en: 'Cookie Policy' },
    rental_agreement: { title_it: 'Contratto di Noleggio (Riassunto)', title_en: 'Rental Agreement (Overview)' },
    terms:            { title_it: 'Termini di Servizio',           title_en: 'Terms of Service' },
}

function emptyLegalPage(id: LegalPageId): LegalPageCopy {
    return {
        id,
        enabled: false,
        title_it: LEGAL_PAGE_DEFAULTS[id].title_it,
        title_en: LEGAL_PAGE_DEFAULTS[id].title_en,
        last_updated_dynamic: id === 'privacy' || id === 'cookie',
        last_updated_label_it: id === 'privacy' ? 'Ultimo aggiornamento' : id === 'cookie' ? 'Ultimo Aggiornamento' : '',
        last_updated_label_en: id === 'privacy' || id === 'cookie' ? 'Last updated' : '',
        intro_blocks: [],
        sections: [],
        outro_blocks: [],
    }
}

const INITIAL_LEGAL: LegalCopy = {
    pages: (['privacy', 'cookie', 'rental_agreement', 'terms'] as LegalPageId[]).map(emptyLegalPage),
}

// ─── Confirmation Success (booking + email fallback) ──────────────────────
interface ConfirmationSuccessCopy {
    booking_title_it: string; booking_title_en: string
    booking_subtitle_it: string; booking_subtitle_en: string
    booking_summary_heading_it: string; booking_summary_heading_en: string
    booking_cta_account_it: string; booking_cta_account_en: string
    carwash_row_servizio_it: string; carwash_row_servizio_en: string
    carwash_row_data_it: string; carwash_row_data_en: string
    carwash_row_orario_it: string; carwash_row_orario_en: string
    carwash_row_cliente_it: string; carwash_row_cliente_en: string
    carwash_row_pagamento_it: string; carwash_row_pagamento_en: string
    carwash_payment_online_it: string; carwash_payment_online_en: string
    carwash_default_customer_it: string; carwash_default_customer_en: string
    carwash_totale_pagato_it: string; carwash_totale_pagato_en: string
    carwash_whatsapp_note_it: string; carwash_whatsapp_note_en: string
    rental_row_veicolo_it: string; rental_row_veicolo_en: string
    rental_row_ritiro_it: string; rental_row_ritiro_en: string
    rental_row_riconsegna_it: string; rental_row_riconsegna_en: string
    rental_row_luogo_it: string; rental_row_luogo_en: string
    rental_row_pagamento_it: string; rental_row_pagamento_en: string
    rental_time_connector_it: string; rental_time_connector_en: string
    rental_payment_in_sede_it: string; rental_payment_in_sede_en: string
    rental_payment_online_it: string; rental_payment_online_en: string
    rental_totale_pagato_it: string; rental_totale_pagato_en: string
    rental_totale_da_pagare_it: string; rental_totale_da_pagare_en: string
    rental_agency_footnote_it: string; rental_agency_footnote_en: string
    email_title_it: string; email_title_en: string
    email_body_logged_in_it: string; email_body_logged_in_en: string
    email_body_logged_out_it: string; email_body_logged_out_en: string
    email_cta_logged_in_it: string; email_cta_logged_in_en: string
    email_cta_logged_out_it: string; email_cta_logged_out_en: string
}
const INITIAL_CONFIRMATION_SUCCESS: ConfirmationSuccessCopy = {
    booking_title_it: '', booking_title_en: '',
    booking_subtitle_it: '', booking_subtitle_en: '',
    booking_summary_heading_it: 'Riepilogo Prenotazione', booking_summary_heading_en: 'Booking Summary',
    booking_cta_account_it: '', booking_cta_account_en: '',
    carwash_row_servizio_it: '', carwash_row_servizio_en: '',
    carwash_row_data_it: '', carwash_row_data_en: '',
    carwash_row_orario_it: '', carwash_row_orario_en: '',
    carwash_row_cliente_it: '', carwash_row_cliente_en: '',
    carwash_row_pagamento_it: '', carwash_row_pagamento_en: '',
    carwash_payment_online_it: '', carwash_payment_online_en: '',
    carwash_default_customer_it: '', carwash_default_customer_en: '',
    carwash_totale_pagato_it: '', carwash_totale_pagato_en: '',
    carwash_whatsapp_note_it: '', carwash_whatsapp_note_en: '',
    rental_row_veicolo_it: '', rental_row_veicolo_en: '',
    rental_row_ritiro_it: '', rental_row_ritiro_en: '',
    rental_row_riconsegna_it: '', rental_row_riconsegna_en: '',
    rental_row_luogo_it: '', rental_row_luogo_en: '',
    rental_row_pagamento_it: '', rental_row_pagamento_en: '',
    rental_time_connector_it: 'alle', rental_time_connector_en: 'at',
    rental_payment_in_sede_it: '', rental_payment_in_sede_en: '',
    rental_payment_online_it: '', rental_payment_online_en: '',
    rental_totale_pagato_it: '', rental_totale_pagato_en: '',
    rental_totale_da_pagare_it: '', rental_totale_da_pagare_en: '',
    rental_agency_footnote_it: '', rental_agency_footnote_en: '',
    email_title_it: '', email_title_en: '',
    email_body_logged_in_it: '', email_body_logged_in_en: '',
    email_body_logged_out_it: '', email_body_logged_out_en: '',
    email_cta_logged_in_it: '', email_cta_logged_in_en: '',
    email_cta_logged_out_it: '', email_cta_logged_out_en: '',
}

// ─── Header (site chrome — top bar + slide-out drawer) ───────────────────
// Brand vocabulary like "DR7 Club", "Aviation Division" stays hardcoded;
// only localized chrome (CTAs, section headings, popup labels, aria) is
// editable here.
interface HeaderCopy {
    logo_alt: string
    open_menu_aria_it: string; open_menu_aria_en: string
    close_menu_aria_it: string; close_menu_aria_en: string
    explore_label_it: string; explore_label_en: string
    credit_wallet_label_it: string; credit_wallet_label_en: string
    drawer_book_cta_it: string; drawer_book_cta_en: string
    flotta_label_it: string; flotta_label_en: string
    servizi_heading_it: string; servizi_heading_en: string
    esperienze_heading_it: string; esperienze_heading_en: string
    prime_wash_heading_it: string; prime_wash_heading_en: string
    business_heading_it: string; business_heading_en: string
    digital_heading_it: string; digital_heading_en: string
    contact_cta_it: string; contact_cta_en: string
    popup_title_it: string; popup_title_en: string
    popup_subtitle_it: string; popup_subtitle_en: string
}
const INITIAL_HEADER: HeaderCopy = {
    logo_alt: '',
    open_menu_aria_it: '', open_menu_aria_en: '',
    close_menu_aria_it: '', close_menu_aria_en: '',
    explore_label_it: '', explore_label_en: '',
    credit_wallet_label_it: '', credit_wallet_label_en: '',
    drawer_book_cta_it: '', drawer_book_cta_en: '',
    flotta_label_it: '', flotta_label_en: '',
    servizi_heading_it: '', servizi_heading_en: '',
    esperienze_heading_it: '', esperienze_heading_en: '',
    prime_wash_heading_it: '', prime_wash_heading_en: '',
    business_heading_it: '', business_heading_en: '',
    digital_heading_it: '', digital_heading_en: '',
    contact_cta_it: '', contact_cta_en: '',
    popup_title_it: '', popup_title_en: '',
    popup_subtitle_it: '', popup_subtitle_en: '',
}

// ─── Check Email + Jet Search Results (small bilingual pages) ─────────────
interface CheckEmailCopy {
    title_it: string; title_en: string
    body_it: string; body_en: string
    back_link_it: string; back_link_en: string
}
const INITIAL_CHECK_EMAIL: CheckEmailCopy = {
    title_it: '', title_en: '',
    body_it: '', body_en: '',
    back_link_it: '', back_link_en: '',
}

interface JetSearchResultsCopy {
    title_it: string; title_en: string
    subtitle_connector_it: string; subtitle_connector_en: string
    passengers_suffix_it: string; passengers_suffix_en: string
    modify_search_cta_it: string; modify_search_cta_en: string
    airport_fallback: string
    empty_title_it: string; empty_title_en: string
    empty_body_it: string; empty_body_en: string
}
const INITIAL_JET_SEARCH: JetSearchResultsCopy = {
    title_it: '', title_en: '',
    subtitle_connector_it: '', subtitle_connector_en: '',
    passengers_suffix_it: '', passengers_suffix_en: '',
    modify_search_cta_it: '', modify_search_cta_en: '',
    airport_fallback: 'N/A',
    empty_title_it: '', empty_title_en: '',
    empty_body_it: '', empty_body_en: '',
}

// ─── Aviation Quote Request (bilingual) ───────────────────────────────────
interface AviationQuoteCopy {
    loading_it: string; loading_en: string
    auth_title_it: string; auth_title_en: string
    auth_body_it: string; auth_body_en: string
    auth_login_cta_it: string; auth_login_cta_en: string
    auth_signup_cta_it: string; auth_signup_cta_en: string
    service_label_jet: string
    service_label_helicopter: string
    header_title_template_it: string; header_title_template_en: string
    header_subtitle_it: string; header_subtitle_en: string
    section_customer_it: string; section_customer_en: string
    section_flight_it: string; section_flight_en: string
    field_name_label_it: string; field_name_label_en: string
    field_name_placeholder_it: string; field_name_placeholder_en: string
    field_email_label_it: string; field_email_label_en: string
    field_email_placeholder_it: string; field_email_placeholder_en: string
    field_phone_label_it: string; field_phone_label_en: string
    field_phone_placeholder_it: string; field_phone_placeholder_en: string
    field_departure_label_it: string; field_departure_label_en: string
    field_departure_placeholder_it: string; field_departure_placeholder_en: string
    field_arrival_label_it: string; field_arrival_label_en: string
    field_arrival_placeholder_it: string; field_arrival_placeholder_en: string
    field_departure_date_label_it: string; field_departure_date_label_en: string
    field_return_date_label_it: string; field_return_date_label_en: string
    field_passengers_label_it: string; field_passengers_label_en: string
    field_notes_label_it: string; field_notes_label_en: string
    field_notes_placeholder_it: string; field_notes_placeholder_en: string
    submit_idle_it: string; submit_idle_en: string
    submit_submitting_it: string; submit_submitting_en: string
    disclaimer_it: string; disclaimer_en: string
    alert_success_it: string; alert_success_en: string
    alert_error_it: string; alert_error_en: string
    whatsapp_phone: string
}

function emptyStrPair(): { it: string; en: string } { return { it: '', en: '' } }
const INITIAL_AVIATION_QUOTE: AviationQuoteCopy = {
    loading_it: 'Caricamento...', loading_en: 'Loading...',
    auth_title_it: '', auth_title_en: '',
    auth_body_it: '', auth_body_en: '',
    auth_login_cta_it: 'Accedi', auth_login_cta_en: 'Login',
    auth_signup_cta_it: 'Registrati', auth_signup_cta_en: 'Sign Up',
    service_label_jet: 'Jet Privato', service_label_helicopter: 'Elicottero',
    header_title_template_it: 'Richiedi Preventivo {service}', header_title_template_en: 'Request Quote {service}',
    header_subtitle_it: '', header_subtitle_en: '',
    section_customer_it: 'Dati Cliente', section_customer_en: 'Customer Details',
    section_flight_it: 'Dettagli Viaggio', section_flight_en: 'Trip Details',
    field_name_label_it: '', field_name_label_en: '',
    field_name_placeholder_it: '', field_name_placeholder_en: '',
    field_email_label_it: '', field_email_label_en: '',
    field_email_placeholder_it: '', field_email_placeholder_en: '',
    field_phone_label_it: '', field_phone_label_en: '',
    field_phone_placeholder_it: '', field_phone_placeholder_en: '',
    field_departure_label_it: '', field_departure_label_en: '',
    field_departure_placeholder_it: '', field_departure_placeholder_en: '',
    field_arrival_label_it: '', field_arrival_label_en: '',
    field_arrival_placeholder_it: '', field_arrival_placeholder_en: '',
    field_departure_date_label_it: '', field_departure_date_label_en: '',
    field_return_date_label_it: '', field_return_date_label_en: '',
    field_passengers_label_it: '', field_passengers_label_en: '',
    field_notes_label_it: '', field_notes_label_en: '',
    field_notes_placeholder_it: '', field_notes_placeholder_en: '',
    submit_idle_it: '', submit_idle_en: '',
    submit_submitting_it: '', submit_submitting_en: '',
    disclaimer_it: '', disclaimer_en: '',
    alert_success_it: '', alert_success_en: '',
    alert_error_it: '', alert_error_en: '',
    whatsapp_phone: '393457905205',
}
void emptyStrPair  // helper kept for future use

// ─── Franchising (IT-only sales page) ──────────────────────────────────────
type FranchisingExpansionIcon = 'square' | 'diamond' | 'lines'
type FranchisingBenefitIcon = 'check' | 'shield' | 'star'
interface FranchisingExpansionLocation { id: string; icon: FranchisingExpansionIcon; name: string; description: string }
interface FranchisingBenefit { id: string; icon: FranchisingBenefitIcon; title: string; description: string }
interface FranchisingCopy {
    hero_h2: string
    hero_p1: string
    hero_p2: string
    stats_heading: string
    stats_lines: string[]
    stats_footer_main: string
    stats_footer_sub: string
    expansion_heading: string
    expansion_locations: FranchisingExpansionLocation[]
    about_heading: string
    about_paragraphs: string[]
    benefits: FranchisingBenefit[]
    cta_heading: string
    cta_intro: string
    cta_box_main: string
    cta_box_sub: string
    contact_heading: string
    contact_intro: string
    contact_email: string
    footer_statement: string
}
const INITIAL_FRANCHISING: FranchisingCopy = {
    hero_h2: '', hero_p1: '', hero_p2: '',
    stats_heading: 'In soli 18 mesi di attività', stats_lines: [],
    stats_footer_main: '', stats_footer_sub: '',
    expansion_heading: 'Il Nostro Piano di Espansione', expansion_locations: [],
    about_heading: '', about_paragraphs: [],
    benefits: [],
    cta_heading: '', cta_intro: '', cta_box_main: '', cta_box_sub: '',
    contact_heading: '', contact_intro: '', contact_email: '',
    footer_statement: '',
}

// ─── Investitori (IT-only sales page) ──────────────────────────────────────
interface InvestitoriStrength { id: string; title: string; description: string }
interface InvestitoriInfoItem { label: string; value: string }
interface InvestitoriCopy {
    hero_title: string
    hero_subtitle: string
    intro_paragraphs: string[]
    opportunity_heading: string
    opportunity_paragraphs: string[]
    strength_heading: string
    strength_points: InvestitoriStrength[]
    cta_heading: string
    cta_paragraphs: string[]
    cta_button_label: string
    cta_whatsapp_url: string
    cta_email: string
    info_heading: string
    info_items: InvestitoriInfoItem[]
    info_footnote: string
    legal_heading: string
    legal_paragraphs: string[]
}
const INITIAL_INVESTITORI: InvestitoriCopy = {
    hero_title: 'SEZIONE INVESTITORI', hero_subtitle: 'Partecipa alla crescita del gruppo DR7',
    intro_paragraphs: [],
    opportunity_heading: 'Opportunità di partecipazione al capitale', opportunity_paragraphs: [],
    strength_heading: 'Punti di forza', strength_points: [],
    cta_heading: 'Modalità di adesione', cta_paragraphs: [],
    cta_button_label: 'RICHIEDI ACCESSO INVESTITORI',
    cta_whatsapp_url: '', cta_email: '',
    info_heading: 'Informazioni sintetiche', info_items: [],
    info_footnote: '',
    legal_heading: 'Avvertenza legale', legal_paragraphs: [],
}

// ─── Car Wash chrome (mirror website utils/siteCopy.ts) ────────────────────
interface CarWashCopy {
    plate_label_it: string; plate_label_en: string
    plate_helper_it: string; plate_helper_en: string
    plate_placeholder_it: string; plate_placeholder_en: string
    plate_search_it: string; plate_search_en: string
    plate_searching_it: string; plate_searching_en: string
    plate_manual_prompt_it: string; plate_manual_prompt_en: string
    plate_change_it: string; plate_change_en: string
    add_to_cart_it: string; add_to_cart_en: string
    cart_title_it: string; cart_title_en: string
    cart_empty_it: string; cart_empty_en: string
    cart_remove_it: string; cart_remove_en: string
    cart_total_it: string; cart_total_en: string
    cart_checkout_it: string; cart_checkout_en: string
    upsell_review_cart_it: string; upsell_review_cart_en: string
    upsell_step1_title_it: string; upsell_step1_title_en: string
    upsell_step1_text_it: string; upsell_step1_text_en: string
    upsell_step2_title_it: string; upsell_step2_title_en: string
    upsell_step2_text_it: string; upsell_step2_text_en: string
    upsell_added_it: string; upsell_added_en: string
    upsell_add_it: string; upsell_add_en: string
}
const INITIAL_CARWASH: CarWashCopy = {
    plate_label_it: '', plate_label_en: '',
    plate_helper_it: '', plate_helper_en: '',
    plate_placeholder_it: '', plate_placeholder_en: '',
    plate_search_it: '', plate_search_en: '',
    plate_searching_it: '', plate_searching_en: '',
    plate_manual_prompt_it: '', plate_manual_prompt_en: '',
    plate_change_it: '', plate_change_en: '',
    add_to_cart_it: '', add_to_cart_en: '',
    cart_title_it: '', cart_title_en: '',
    cart_empty_it: '', cart_empty_en: '',
    cart_remove_it: '', cart_remove_en: '',
    cart_total_it: '', cart_total_en: '',
    cart_checkout_it: '', cart_checkout_en: '',
    upsell_review_cart_it: '', upsell_review_cart_en: '',
    upsell_step1_title_it: '', upsell_step1_title_en: '',
    upsell_step1_text_it: '', upsell_step1_text_en: '',
    upsell_step2_title_it: '', upsell_step2_title_en: '',
    upsell_step2_text_it: '', upsell_step2_text_en: '',
    upsell_added_it: '', upsell_added_en: '',
    upsell_add_it: '', upsell_add_en: '',
}

// ─── Mechanical Services chrome (mirror website utils/siteCopy.ts) ────────
//
// IMPORTANT: il CATALOGO meccanica vive in tab dedicato "Catalogo Prime Wash"
// (filtro MECCANICA). Qui editiamo SOLO il chrome della pagina:
// hero, "Come Funziona", orari, label bottoni.
interface MechanicalHowStep {
    title_it: string; title_en: string
    text_it: string; text_en: string
}
interface MechanicalCopy {
    hero_title: string
    hero_subtitle_it: string; hero_subtitle_en: string
    hero_intro_it: string; hero_intro_en: string
    book_now_label_it: string; book_now_label_en: string
    how_heading_it: string; how_heading_en: string
    how_steps: MechanicalHowStep[]
    hours_heading_it: string; hours_heading_en: string
    hours_main_it: string; hours_main_en: string
    hours_sub_it: string; hours_sub_en: string
}
const INITIAL_MECHANICAL: MechanicalCopy = {
    hero_title: 'DR7 RAPID SERVICE',
    hero_subtitle_it: '', hero_subtitle_en: '',
    hero_intro_it: '', hero_intro_en: '',
    book_now_label_it: 'PRENOTA ORA', book_now_label_en: 'BOOK NOW',
    how_heading_it: 'Come Funziona', how_heading_en: 'How It Works',
    how_steps: [],
    hours_heading_it: 'Orari di Apertura', hours_heading_en: 'Opening Hours',
    hours_main_it: '', hours_main_en: '',
    hours_sub_it: '', hours_sub_en: '',
}

// ─── Careers / Press / Contact schemas (mirror website utils/siteCopy.ts) ──
interface CareersJob {
    id: string
    title_it: string; title_en: string
    location_it: string; location_en: string
    type_it: string; type_en: string
    description_it: string; description_en: string
}
interface CareersCopy {
    page_title_it: string; page_title_en: string
    intro_it: string; intro_en: string
    jobs_heading_it: string; jobs_heading_en: string
    jobs: CareersJob[]
    apply_heading_it: string; apply_heading_en: string
    apply_text_it: string; apply_text_en: string
    apply_email: string
}
const INITIAL_CAREERS: CareersCopy = {
    page_title_it: 'Careers', page_title_en: 'Careers',
    intro_it: '', intro_en: '',
    jobs_heading_it: 'Posizioni Aperte', jobs_heading_en: 'Open Positions',
    jobs: [],
    apply_heading_it: 'Come Candidarsi', apply_heading_en: 'How to Apply',
    apply_text_it: '', apply_text_en: '',
    apply_email: '',
}

interface PressArticle {
    id: string
    title: string
    publication: string
    date: string
    summary_it: string; summary_en: string
    link: string
}
interface PressCopy {
    page_title_it: string; page_title_en: string
    subtitle_it: string; subtitle_en: string
    inquiries_heading_it: string; inquiries_heading_en: string
    inquiries_text_it: string; inquiries_text_en: string
    inquiries_email_label_it: string; inquiries_email_label_en: string
    inquiries_email: string
    news_heading_it: string; news_heading_en: string
    read_more_label_it: string; read_more_label_en: string
    articles: PressArticle[]
    releases_heading_it: string; releases_heading_en: string
    releases_text_it: string; releases_text_en: string
}
const INITIAL_PRESS: PressCopy = {
    page_title_it: 'Press', page_title_en: 'Press',
    subtitle_it: '', subtitle_en: '',
    inquiries_heading_it: 'Richieste Stampa', inquiries_heading_en: 'Media Inquiries',
    inquiries_text_it: '', inquiries_text_en: '',
    inquiries_email_label_it: 'Email:', inquiries_email_label_en: 'Email:',
    inquiries_email: '',
    news_heading_it: 'Sui Media', news_heading_en: 'In the News',
    read_more_label_it: "Leggi l'articolo", read_more_label_en: 'Read full article',
    articles: [],
    releases_heading_it: 'Comunicati Stampa', releases_heading_en: 'Press Releases',
    releases_text_it: '', releases_text_en: '',
}

interface ContactCopy {
    page_title_it: string; page_title_en: string
    subtitle_it: string; subtitle_en: string
    phone_label_it: string; phone_label_en: string
    phone_display: string
    phone_tel_url: string
    whatsapp_label_it: string; whatsapp_label_en: string
    whatsapp_button_it: string; whatsapp_button_en: string
    whatsapp_url: string
    email_label_it: string; email_label_en: string
    email_address: string
    hours_label_it: string; hours_label_en: string
    hours_lines_it: string[]; hours_lines_en: string[]
    office_heading_it: string; office_heading_en: string
    office_company_name: string
    office_address_it: string; office_address_en: string
    office_piva: string
    map_title: string
    map_iframe_url: string
}
const INITIAL_CONTACT: ContactCopy = {
    page_title_it: 'Contattaci', page_title_en: 'Contact Us',
    subtitle_it: '', subtitle_en: '',
    phone_label_it: 'Telefono', phone_label_en: 'Phone',
    phone_display: '', phone_tel_url: '',
    whatsapp_label_it: 'WhatsApp', whatsapp_label_en: 'WhatsApp',
    whatsapp_button_it: '', whatsapp_button_en: '',
    whatsapp_url: '',
    email_label_it: 'Email', email_label_en: 'Email',
    email_address: '',
    hours_label_it: 'Orari', hours_label_en: 'Hours',
    hours_lines_it: [], hours_lines_en: [],
    office_heading_it: 'Sede Operativa', office_heading_en: 'Operating Office',
    office_company_name: '',
    office_address_it: '', office_address_en: '',
    office_piva: '',
    map_title: '', map_iframe_url: '',
}

const INITIAL_FOOTER: FooterCopy = {
    network_title: '',
    network_text_it: '', network_text_en: '',
    social_links: [],
    reviews_title: '',
    reviews_text_it: '', reviews_text_en: '',
    contact_title: '',
    contact_whatsapp_number: '', contact_whatsapp_url: '',
    contact_company_name: '',
    contact_legal_address_it: '', contact_legal_address_en: '',
    contact_capitale_sociale_it: '', contact_capitale_sociale_en: '',
    contact_piva: '',
    contact_disclaimer_it: '', contact_disclaimer_en: '',
    division_links: [],
    corporate_links: [],
    legal_links: [],
    bottom_brand_line: '',
    bottom_copyright: '',
}

const INITIAL_MEMBERSHIP: MembershipCopy = {
    hero_eyebrow_it: '', hero_eyebrow_en: '',
    hero_title: 'DR7 CLUB',
    hero_subtitle_it: '', hero_subtitle_en: '',
    hero_opener_it: '', hero_opener_en: '',
    pricing_card_title: 'DR7 CLUB',
    pricing_billing_monthly_it: '', pricing_billing_monthly_en: '',
    pricing_billing_annual_it: '', pricing_billing_annual_en: '',
    pricing_billing_save_badge: '',
    pricing_cycle_month_it: '', pricing_cycle_month_en: '',
    pricing_cycle_year_it: '', pricing_cycle_year_en: '',
    pricing_savings_it: '', pricing_savings_en: '',
    pricing_cta_it: '', pricing_cta_en: '',
    pricing_cta_footnote_it: '', pricing_cta_footnote_en: '',
    elite_title: '',
    elite_subtitle_it: '', elite_subtitle_en: '',
    elite_intro_it: '', elite_intro_en: '',
    elite_sections: [],
    elite_cta_title_it: '', elite_cta_title_en: '',
    elite_cta_text_it: '', elite_cta_text_en: '',
    elite_cta_logged_out_it: '', elite_cta_logged_out_en: '',
    elite_cta_logged_in_it: '', elite_cta_logged_in_en: '',
    reward_title_it: '', reward_title_en: '',
    reward_intro_it: '', reward_intro_en: '',
    reward_items: [],
    reward_footnote_it: '', reward_footnote_en: '',
}

const INITIAL_CANCELLAZIONE: CancellazioneCopy = {
    page_title_it: 'Policy di Cancellazione e Modifica Prenotazioni',
    page_title_en: 'Cancellation and Booking Modification Policy',
    contact_label_it: 'Per assistenza o informazioni:',
    contact_label_en: 'For assistance or information:',
    contact_email: 'info@dr7.app',
    contact_address: 'Dubai Rent 7.0 S.p.A. - Viale Marconi, 229, 09131 Cagliari CA',
    last_updated_it: 'Ultimo aggiornamento: 10 aprile 2026',
    last_updated_en: 'Last updated: April 10, 2026',
    sections: [],  // Hydrated from DB; full default lives on website side.
}

// Italian translations of the legacy English FAQ on /faq.
const INITIAL_FAQ_ENTRIES: FaqEntry[] = [
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
]

const INITIAL_FAQ: FaqCopy = {
    eyebrow_it: 'DR7 · Supporto',
    eyebrow_en: 'DR7 · Support',
    page_title_it: 'Domande Frequenti',
    page_title_en: 'Frequently Asked Questions',
    subtitle_it: 'Le risposte alle domande piu’ frequenti su noleggio, membership e pagamenti.',
    subtitle_en: 'Answers to the most common questions on rentals, membership, and payments.',
    entries: INITIAL_FAQ_ENTRIES,
}

// ─── Persistence helpers ─────────────────────────────────────────────────────
interface SiteCopySnapshot {
    faq?: FaqCopy | FaqEntry[]   // accept legacy raw-array shape too
    cancellazione?: CancellazioneCopy
    membership?: MembershipCopy
    home?: HomeCopy
    about?: AboutCopy
    footer?: FooterCopy
    legal?: LegalCopy
    careers?: CareersCopy
    press?: PressCopy
    contact?: ContactCopy
    mechanical?: MechanicalCopy
    carwash?: CarWashCopy
    investitori?: InvestitoriCopy
    franchising?: FranchisingCopy
    aviationQuote?: AviationQuoteCopy
    checkEmail?: CheckEmailCopy
    jetSearchResults?: JetSearchResultsCopy
    confirmationSuccess?: ConfirmationSuccessCopy
    header?: HeaderCopy
}

interface CurrentState {
    faq: FaqCopy
    cancellazione: CancellazioneCopy
    membership: MembershipCopy
    home: HomeCopy
    about: AboutCopy
    footer: FooterCopy
    legal: LegalCopy
    careers: CareersCopy
    press: PressCopy
    contact: ContactCopy
    mechanical: MechanicalCopy
    carwash: CarWashCopy
    investitori: InvestitoriCopy
    franchising: FranchisingCopy
    aviationQuote: AviationQuoteCopy
    checkEmail: CheckEmailCopy
    jetSearchResults: JetSearchResultsCopy
    confirmationSuccess: ConfirmationSuccessCopy
    header: HeaderCopy
}

async function loadPersisted(): Promise<SiteCopySnapshot | null> {
    const { data } = await supabase
        .from('centralina_pro_config')
        .select('config')
        .eq('id', 'main')
        .maybeSingle()
    const cfg = (data?.config ?? null) as Record<string, unknown> | null
    const sc = cfg?.site_copy as SiteCopySnapshot | undefined
    return sc ?? null
}

async function savePersisted(snap: SiteCopySnapshot): Promise<void> {
    // Read the full current config, merge site_copy, write back. JSONB merge
    // preserves all sibling keys (categories, fasce, automations, etc.).
    const { data: existing } = await supabase
        .from('centralina_pro_config')
        .select('config')
        .eq('id', 'main')
        .maybeSingle()
    const baseConfig = (existing?.config ?? {}) as Record<string, unknown>
    const newConfig = { ...baseConfig, site_copy: { ...((baseConfig.site_copy as object | undefined) || {}), ...snap } }
    const { error } = await supabase
        .from('centralina_pro_config')
        .upsert({ id: 'main', config: newConfig })
    if (error) throw error
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function SitoTab() {
    const { adminEmail, loading: roleLoading } = useAdminRole()
    const isDirezione = !!adminEmail && SITO_DIREZIONE_EMAILS.includes(adminEmail.toLowerCase())
    const override = useLimitationOverride()

    // ─── Access gate ─────────────────────────────────────────────────────────
    const [tabUnlocked, setTabUnlocked] = useState(false)
    useEffect(() => {
        if (roleLoading) return
        if (isDirezione) {
            setTabUnlocked(true)
            return
        }
        if (!override.hasOverride('gestione_sito_access')) {
            override.requestOverride('gestione_sito_access', 'Accesso alla sezione Sito richiede autorizzazione direzionale')
        }
    }, [roleLoading, isDirezione]) // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (override.hasOverride('gestione_sito_access')) {
            setTabUnlocked(true)
        }
    }, [override])

    // ─── Section navigation ──────────────────────────────────────────────────
    const [section, setSection] = useState<SectionId>('faq')

    // ─── State (current + saved snapshots per section) ───────────────────────
    const [faq, setFaq] = useState<FaqCopy>(INITIAL_FAQ)
    const [savedFaq, setSavedFaq] = useState<FaqCopy>(INITIAL_FAQ)
    const [cancellazione, setCancellazione] = useState<CancellazioneCopy>(INITIAL_CANCELLAZIONE)
    const [savedCancellazione, setSavedCancellazione] = useState<CancellazioneCopy>(INITIAL_CANCELLAZIONE)
    const [membership, setMembership] = useState<MembershipCopy>(INITIAL_MEMBERSHIP)
    const [savedMembership, setSavedMembership] = useState<MembershipCopy>(INITIAL_MEMBERSHIP)
    const [home, setHome] = useState<HomeCopy>(INITIAL_HOME)
    const [savedHome, setSavedHome] = useState<HomeCopy>(INITIAL_HOME)
    const [about, setAbout] = useState<AboutCopy>(INITIAL_ABOUT)
    const [savedAbout, setSavedAbout] = useState<AboutCopy>(INITIAL_ABOUT)
    const [footer, setFooter] = useState<FooterCopy>(INITIAL_FOOTER)
    const [savedFooter, setSavedFooter] = useState<FooterCopy>(INITIAL_FOOTER)
    const [legal, setLegal] = useState<LegalCopy>(INITIAL_LEGAL)
    const [savedLegal, setSavedLegal] = useState<LegalCopy>(INITIAL_LEGAL)
    const [careers, setCareers] = useState<CareersCopy>(INITIAL_CAREERS)
    const [savedCareers, setSavedCareers] = useState<CareersCopy>(INITIAL_CAREERS)
    const [press, setPress] = useState<PressCopy>(INITIAL_PRESS)
    const [savedPress, setSavedPress] = useState<PressCopy>(INITIAL_PRESS)
    const [contact, setContact] = useState<ContactCopy>(INITIAL_CONTACT)
    const [savedContact, setSavedContact] = useState<ContactCopy>(INITIAL_CONTACT)
    const [mechanical, setMechanical] = useState<MechanicalCopy>(INITIAL_MECHANICAL)
    const [savedMechanical, setSavedMechanical] = useState<MechanicalCopy>(INITIAL_MECHANICAL)
    const [carwash, setCarwash] = useState<CarWashCopy>(INITIAL_CARWASH)
    const [savedCarwash, setSavedCarwash] = useState<CarWashCopy>(INITIAL_CARWASH)
    const [investitori, setInvestitori] = useState<InvestitoriCopy>(INITIAL_INVESTITORI)
    const [savedInvestitori, setSavedInvestitori] = useState<InvestitoriCopy>(INITIAL_INVESTITORI)
    const [franchising, setFranchising] = useState<FranchisingCopy>(INITIAL_FRANCHISING)
    const [savedFranchising, setSavedFranchising] = useState<FranchisingCopy>(INITIAL_FRANCHISING)
    const [aviationQuote, setAviationQuote] = useState<AviationQuoteCopy>(INITIAL_AVIATION_QUOTE)
    const [savedAviationQuote, setSavedAviationQuote] = useState<AviationQuoteCopy>(INITIAL_AVIATION_QUOTE)
    const [checkEmail, setCheckEmail] = useState<CheckEmailCopy>(INITIAL_CHECK_EMAIL)
    const [savedCheckEmail, setSavedCheckEmail] = useState<CheckEmailCopy>(INITIAL_CHECK_EMAIL)
    const [jetSearchResults, setJetSearchResults] = useState<JetSearchResultsCopy>(INITIAL_JET_SEARCH)
    const [savedJetSearchResults, setSavedJetSearchResults] = useState<JetSearchResultsCopy>(INITIAL_JET_SEARCH)
    const [confirmationSuccess, setConfirmationSuccess] = useState<ConfirmationSuccessCopy>(INITIAL_CONFIRMATION_SUCCESS)
    const [savedConfirmationSuccess, setSavedConfirmationSuccess] = useState<ConfirmationSuccessCopy>(INITIAL_CONFIRMATION_SUCCESS)
    const [header, setHeader] = useState<HeaderCopy>(INITIAL_HEADER)
    const [savedHeader, setSavedHeader] = useState<HeaderCopy>(INITIAL_HEADER)
    const [hydrated, setHydrated] = useState(false)

    useEffect(() => {
        if (!tabUnlocked) return
        let cancelled = false
        ;(async () => {
            try {
                const remote = await loadPersisted()
                if (cancelled) return
                if (remote?.faq) {
                    // Accept legacy raw-array shape as well as the new FaqCopy object.
                    const next: FaqCopy = Array.isArray(remote.faq)
                        ? { ...INITIAL_FAQ, entries: remote.faq }
                        : {
                            eyebrow_it: remote.faq.eyebrow_it || INITIAL_FAQ.eyebrow_it,
                            eyebrow_en: remote.faq.eyebrow_en || INITIAL_FAQ.eyebrow_en,
                            page_title_it: remote.faq.page_title_it || INITIAL_FAQ.page_title_it,
                            page_title_en: remote.faq.page_title_en || INITIAL_FAQ.page_title_en,
                            subtitle_it: remote.faq.subtitle_it || INITIAL_FAQ.subtitle_it,
                            subtitle_en: remote.faq.subtitle_en || INITIAL_FAQ.subtitle_en,
                            entries: Array.isArray(remote.faq.entries) ? remote.faq.entries : INITIAL_FAQ.entries,
                        }
                    setFaq(next)
                    setSavedFaq(next)
                }
                if (remote?.cancellazione && Array.isArray(remote.cancellazione.sections)) {
                    setCancellazione(remote.cancellazione)
                    setSavedCancellazione(remote.cancellazione)
                }
                if (remote?.membership && Array.isArray(remote.membership.elite_sections)) {
                    setMembership(remote.membership)
                    setSavedMembership(remote.membership)
                }
                if (remote?.home && Array.isArray(remote.home.hero_slides)) {
                    setHome(remote.home)
                    setSavedHome(remote.home)
                }
                if (remote?.about && Array.isArray(remote.about.founders)) {
                    setAbout(remote.about)
                    setSavedAbout(remote.about)
                }
                if (remote?.footer && Array.isArray(remote.footer.social_links)) {
                    setFooter(remote.footer)
                    setSavedFooter(remote.footer)
                }
                if (remote?.legal && Array.isArray(remote.legal.pages)) {
                    // Ensure all 4 page slots exist (in case the seed missed one).
                    const byId = new Map(remote.legal.pages.map(p => [p.id, p]))
                    const merged: LegalCopy = {
                        pages: (['privacy', 'cookie', 'rental_agreement', 'terms'] as LegalPageId[])
                            .map(id => byId.get(id) || emptyLegalPage(id)),
                    }
                    setLegal(merged)
                    setSavedLegal(merged)
                }
                if (remote?.careers && Array.isArray(remote.careers.jobs)) {
                    setCareers(remote.careers)
                    setSavedCareers(remote.careers)
                }
                if (remote?.press && Array.isArray(remote.press.articles)) {
                    setPress(remote.press)
                    setSavedPress(remote.press)
                }
                if (remote?.contact && remote.contact.email_address) {
                    setContact(remote.contact)
                    setSavedContact(remote.contact)
                }
                if (remote?.mechanical && remote.mechanical.hero_title) {
                    setMechanical(remote.mechanical)
                    setSavedMechanical(remote.mechanical)
                }
                if (remote?.carwash && remote.carwash.cart_title_it) {
                    setCarwash(remote.carwash)
                    setSavedCarwash(remote.carwash)
                }
                if (remote?.investitori && remote.investitori.hero_title) {
                    setInvestitori(remote.investitori)
                    setSavedInvestitori(remote.investitori)
                }
                if (remote?.franchising && remote.franchising.hero_h2) {
                    setFranchising(remote.franchising)
                    setSavedFranchising(remote.franchising)
                }
                if (remote?.aviationQuote && remote.aviationQuote.header_title_template_it) {
                    setAviationQuote(remote.aviationQuote)
                    setSavedAviationQuote(remote.aviationQuote)
                }
                if (remote?.checkEmail && remote.checkEmail.title_it) {
                    setCheckEmail(remote.checkEmail)
                    setSavedCheckEmail(remote.checkEmail)
                }
                if (remote?.jetSearchResults && remote.jetSearchResults.title_it) {
                    setJetSearchResults(remote.jetSearchResults)
                    setSavedJetSearchResults(remote.jetSearchResults)
                }
                if (remote?.confirmationSuccess && remote.confirmationSuccess.booking_title_it) {
                    setConfirmationSuccess(remote.confirmationSuccess)
                    setSavedConfirmationSuccess(remote.confirmationSuccess)
                }
                if (remote?.header && remote.header.explore_label_it) {
                    setHeader(remote.header)
                    setSavedHeader(remote.header)
                }
            } catch (e) {
                console.error('SitoTab hydration failed:', e)
            } finally {
                if (!cancelled) setHydrated(true)
            }
        })()
        return () => { cancelled = true }
    }, [tabUnlocked])

    // ─── Changes detection ───────────────────────────────────────────────────
    const changes = useMemo(
        () => computeChanges(
            { faq, cancellazione, membership, home, about, footer, legal, careers, press, contact, mechanical, carwash, investitori, franchising, aviationQuote, checkEmail, jetSearchResults, confirmationSuccess, header },
            { faq: savedFaq, cancellazione: savedCancellazione, membership: savedMembership, home: savedHome, about: savedAbout, footer: savedFooter, legal: savedLegal, careers: savedCareers, press: savedPress, contact: savedContact, mechanical: savedMechanical, carwash: savedCarwash, investitori: savedInvestitori, franchising: savedFranchising, aviationQuote: savedAviationQuote, checkEmail: savedCheckEmail, jetSearchResults: savedJetSearchResults, confirmationSuccess: savedConfirmationSuccess, header: savedHeader }
        ),
        [faq, savedFaq, cancellazione, savedCancellazione, membership, savedMembership, home, savedHome, about, savedAbout, footer, savedFooter, legal, savedLegal, careers, savedCareers, press, savedPress, contact, savedContact, mechanical, savedMechanical, carwash, savedCarwash, investitori, savedInvestitori, franchising, savedFranchising, aviationQuote, savedAviationQuote, checkEmail, savedCheckEmail, jetSearchResults, savedJetSearchResults, confirmationSuccess, savedConfirmationSuccess, header, savedHeader]
    )
    const dirty = changes.length > 0

    // ─── Save / Discard (gated by OTP for non-direzione) ─────────────────────
    const [saving, setSaving] = useState(false)
    const pendingSaveRef = useRef<null | (() => Promise<void>)>(null)

    const doSave = async () => {
        setSaving(true)
        try {
            await savePersisted({ faq, cancellazione, membership, home, about, footer, legal, careers, press, contact, mechanical, carwash, investitori, franchising, aviationQuote, checkEmail, jetSearchResults, confirmationSuccess, header })
            setSavedFaq(faq)
            setSavedCancellazione(cancellazione)
            setSavedMembership(membership)
            setSavedHome(home)
            setSavedAbout(about)
            setSavedFooter(footer)
            setSavedLegal(legal)
            setSavedCareers(careers)
            setSavedPress(press)
            setSavedContact(contact)
            setSavedMechanical(mechanical)
            setSavedCarwash(carwash)
            setSavedInvestitori(investitori)
            setSavedFranchising(franchising)
            setSavedAviationQuote(aviationQuote)
            setSavedCheckEmail(checkEmail)
            setSavedJetSearchResults(jetSearchResults)
            setSavedConfirmationSuccess(confirmationSuccess)
            setSavedHeader(header)
            toast.success('Modifiche salvate')
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'Errore sconosciuto'
            toast.error(`Errore salvataggio: ${msg}`)
        } finally {
            setSaving(false)
        }
    }

    const handleSave = () => {
        if (!dirty || saving) return
        if (isDirezione) {
            void doSave()
            return
        }
        // Non-direzione: gate the save behind OTP.
        pendingSaveRef.current = doSave
        override.requestOverride('gestione_sito_write', 'Modifica testi del sito richiede autorizzazione direzionale')
    }

    useEffect(() => {
        if (override.hasOverride('gestione_sito_write') && pendingSaveRef.current) {
            const run = pendingSaveRef.current
            pendingSaveRef.current = null
            ;(async () => {
                try { await run() } finally {
                    await override.consumeOverride('gestione_sito_write')
                }
            })()
        }
    }, [override])

    const handleDiscard = () => {
        if (!dirty) return
        setFaq(savedFaq)
        setCancellazione(savedCancellazione)
        setMembership(savedMembership)
        setHome(savedHome)
        setAbout(savedAbout)
        setFooter(savedFooter)
        setLegal(savedLegal)
        setCareers(savedCareers)
        setPress(savedPress)
        setContact(savedContact)
        setMechanical(savedMechanical)
        setCarwash(savedCarwash)
        setInvestitori(savedInvestitori)
        setFranchising(savedFranchising)
        setAviationQuote(savedAviationQuote)
        setCheckEmail(savedCheckEmail)
        setJetSearchResults(savedJetSearchResults)
        setConfirmationSuccess(savedConfirmationSuccess)
        setHeader(savedHeader)
    }

    // ─── Render ──────────────────────────────────────────────────────────────
    if (roleLoading) {
        return <p className="text-sm text-theme-text-muted p-6">Caricamento…</p>
    }

    if (!tabUnlocked) {
        return (
            <>
                <div className="bg-theme-bg-secondary border border-theme-border rounded-3xl p-12 text-center shadow-sm">
                    <div className="w-12 h-12 mx-auto mb-3 rounded-2xl bg-amber-500/15 text-amber-500 flex items-center justify-center">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                    </div>
                    <h2 className="text-xl font-semibold text-theme-text-primary mb-1">Sezione protetta</h2>
                    <p className="text-sm text-theme-text-muted max-w-md mx-auto">
                        L'accesso alla sezione <b>Sito</b> richiede autorizzazione direzionale. Verifica il codice ricevuto via email per continuare.
                    </p>
                    <button
                        onClick={() => override.requestOverride('gestione_sito_access', 'Accesso alla sezione Sito richiede autorizzazione direzionale')}
                        className="mt-4 px-4 py-2 rounded-2xl bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold shadow-sm"
                    >
                        Richiedi accesso
                    </button>
                </div>
                <LimitationOverrideModal
                    isOpen={override.limitationState.isOpen}
                    limitationCode={override.limitationState.limitationCode}
                    limitationMessage={override.limitationState.limitationMessage}
                    actionContext={override.limitationState.actionContext}
                    draftSessionId={override.draftSessionId}
                    flowType={override.flowType}
                    onCancel={override.cancelLimitation}
                    onOverrideApproved={override.handleOverrideApproved}
                />
            </>
        )
    }

    return (
        <div className="bg-[#fafafa] min-h-screen pb-32">
            <LimitationOverrideModal
                isOpen={override.limitationState.isOpen}
                limitationCode={override.limitationState.limitationCode}
                limitationMessage={override.limitationState.limitationMessage}
                actionContext={override.limitationState.actionContext}
                draftSessionId={override.draftSessionId}
                flowType={override.flowType}
                onCancel={override.cancelLimitation}
                onOverrideApproved={override.handleOverrideApproved}
            />

            {/* Header */}
            <div className="px-6 pt-6 pb-4 bg-white border-b border-black/5">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-[28px] font-semibold tracking-tight text-[#1d1d1f]">Sito</h1>
                        <p className="text-[14px] text-[#6e6e73] mt-1">Modifica testi visibili sul sito senza intervento sviluppatore.</p>
                    </div>
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-700 border border-emerald-500/20">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        Attivo
                    </span>
                </div>
            </div>

            {/* Body: side nav + content */}
            <div className="px-6 pt-6">
                <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] gap-6">
                    {/* Side nav */}
                    <aside>
                        <ul className="space-y-1 bg-white rounded-2xl p-2 border border-black/5 shadow-sm">
                            {SECTIONS.map((s, idx) => {
                                const active = section === s.id
                                return (
                                    <li key={s.id}>
                                        <button
                                            onClick={() => setSection(s.id)}
                                            className={`w-full text-left px-3 py-2.5 rounded-xl text-[13px] font-medium transition-colors flex items-center gap-2 ${
                                                active
                                                    ? 'bg-blue-500 text-white shadow-sm'
                                                    : 'text-[#1d1d1f] hover:bg-black/5'
                                            }`}
                                        >
                                            <span className={`inline-flex items-center justify-center w-5 h-5 rounded-md text-[11px] font-semibold ${
                                                active ? 'bg-white/20 text-white' : 'bg-black/5 text-[#6e6e73]'
                                            }`}>{idx + 1}</span>
                                            <span className="flex-1">{s.title}</span>
                                            {!s.ready && (
                                                <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${
                                                    active ? 'bg-white/20 text-white' : 'bg-amber-500/15 text-amber-700'
                                                }`}>Soon</span>
                                            )}
                                        </button>
                                    </li>
                                )
                            })}
                        </ul>
                    </aside>

                    {/* Main content */}
                    <main className="bg-white rounded-2xl p-6 border border-black/5 shadow-sm min-h-[400px]">
                        {!hydrated && (
                            <p className="text-sm text-[#6e6e73]">Caricamento dati…</p>
                        )}
                        {hydrated && section === 'faq' && (
                            <FaqEditor copy={faq} setCopy={setFaq} />
                        )}
                        {hydrated && section === 'cancellazione' && (
                            <CancellazioneEditor copy={cancellazione} setCopy={setCancellazione} />
                        )}
                        {hydrated && section === 'membership' && (
                            <MembershipEditor copy={membership} setCopy={setMembership} />
                        )}
                        {hydrated && section === 'hero' && (
                            <HomeEditor copy={home} setCopy={setHome} />
                        )}
                        {hydrated && section === 'chi-siamo' && (
                            <AboutEditor copy={about} setCopy={setAbout} />
                        )}
                        {hydrated && section === 'footer' && (
                            <FooterEditor copy={footer} setCopy={setFooter} />
                        )}
                        {hydrated && section === 'legali' && (
                            <LegalEditor copy={legal} setCopy={setLegal} />
                        )}
                        {hydrated && section === 'careers' && (
                            <CareersEditor copy={careers} setCopy={setCareers} />
                        )}
                        {hydrated && section === 'press' && (
                            <PressEditor copy={press} setCopy={setPress} />
                        )}
                        {hydrated && section === 'contatti' && (
                            <ContactEditor copy={contact} setCopy={setContact} />
                        )}
                        {hydrated && section === 'meccanica' && (
                            <MechanicalEditor copy={mechanical} setCopy={setMechanical} />
                        )}
                        {hydrated && section === 'lavaggio' && (
                            <CarWashEditor copy={carwash} setCopy={setCarwash} />
                        )}
                        {hydrated && section === 'investitori' && (
                            <InvestitoriEditor copy={investitori} setCopy={setInvestitori} />
                        )}
                        {hydrated && section === 'franchising' && (
                            <FranchisingEditor copy={franchising} setCopy={setFranchising} />
                        )}
                        {hydrated && section === 'aviation' && (
                            <AviationQuoteEditor copy={aviationQuote} setCopy={setAviationQuote} />
                        )}
                        {hydrated && section === 'check-email' && (
                            <CheckEmailEditor copy={checkEmail} setCopy={setCheckEmail} />
                        )}
                        {hydrated && section === 'jet-search' && (
                            <JetSearchResultsEditor copy={jetSearchResults} setCopy={setJetSearchResults} />
                        )}
                        {hydrated && section === 'confirmation' && (
                            <ConfirmationSuccessEditor copy={confirmationSuccess} setCopy={setConfirmationSuccess} />
                        )}
                        {hydrated && section === 'header' && (
                            <HeaderEditor copy={header} setCopy={setHeader} />
                        )}
                    </main>
                </div>
            </div>

            {/* SaveBar */}
            {dirty && (
                <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-black/10 shadow-lg z-40">
                    <div className="px-6 py-3 flex items-center justify-between gap-4">
                        <div className="text-[13px] text-[#1d1d1f]">
                            <b>{changes.length}</b> modific{changes.length === 1 ? 'a' : 'he'} non salvat{changes.length === 1 ? 'a' : 'e'}.
                            {' '}<span className="text-[#6e6e73]">{changes[0]}{changes.length > 1 ? `, +${changes.length - 1} altre` : ''}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={handleDiscard}
                                disabled={saving}
                                className="px-4 py-2 rounded-xl text-[13px] font-medium text-[#1d1d1f] bg-black/5 hover:bg-black/10 disabled:opacity-50"
                            >Annulla</button>
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className="px-5 py-2 rounded-xl text-[13px] font-semibold text-white bg-blue-500 hover:bg-blue-600 disabled:opacity-50"
                            >{saving ? 'Salvataggio…' : 'Salva modifiche'}</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

// ─── Changes detection ───────────────────────────────────────────────────────
function computeChanges(current: CurrentState, saved: CurrentState): string[] {
    const out: string[] = []
    // FAQ — chrome (title/eyebrow/subtitle) + entries
    {
        const ce = current.faq.entries
        const se = saved.faq.entries
        const curIds = new Set(ce.map(e => e.id))
        const savIds = new Set(se.map(e => e.id))
        const added = ce.filter(e => !savIds.has(e.id))
        const removed = se.filter(e => !curIds.has(e.id))
        added.forEach(e => out.push(`FAQ: nuova "${e.question.slice(0, 40) || '(senza titolo)'}"`))
        removed.forEach(e => out.push(`FAQ: rimossa "${e.question.slice(0, 40) || e.id}"`))
        ce.forEach(c => {
            const s = se.find(x => x.id === c.id)
            if (!s) return
            if (c.question !== s.question || c.answer !== s.answer) {
                out.push(`FAQ: modificata "${(s.question || c.question).slice(0, 40)}"`)
            }
        })
        if (ce.length === se.length && added.length === 0 && removed.length === 0) {
            const reordered = ce.some((e, i) => se[i]?.id !== e.id)
            if (reordered) out.push('FAQ: ordine modificato')
        }
        // Chrome diff (title/eyebrow/subtitle)
        const chromeKeys: (keyof FaqCopy)[] = ['eyebrow_it', 'eyebrow_en', 'page_title_it', 'page_title_en', 'subtitle_it', 'subtitle_en']
        if (chromeKeys.some(k => current.faq[k] !== saved.faq[k])) {
            out.push('FAQ: titolo/eyebrow/sottotitolo modificati')
        }
    }
    // Cancellazione (compare as JSON — covers titles, blocks, sections, footer)
    if (JSON.stringify(current.cancellazione) !== JSON.stringify(saved.cancellazione)) {
        out.push('Cancellazione: testi modificati')
    }
    // Membership (same approach)
    if (JSON.stringify(current.membership) !== JSON.stringify(saved.membership)) {
        out.push('Membership: testi modificati')
    }
    // Home (same approach)
    if (JSON.stringify(current.home) !== JSON.stringify(saved.home)) {
        out.push('Home: contenuti modificati')
    }
    // About (same approach)
    if (JSON.stringify(current.about) !== JSON.stringify(saved.about)) {
        out.push('Chi Siamo: contenuti modificati')
    }
    // Footer (same approach)
    if (JSON.stringify(current.footer) !== JSON.stringify(saved.footer)) {
        out.push('Footer: contenuti modificati')
    }
    // Legal pages (per-page diff)
    const curById = new Map(current.legal.pages.map(p => [p.id, p]))
    const savById = new Map(saved.legal.pages.map(p => [p.id, p]))
    for (const id of ['privacy', 'cookie', 'rental_agreement', 'terms'] as LegalPageId[]) {
        if (JSON.stringify(curById.get(id)) !== JSON.stringify(savById.get(id))) {
            out.push(`Legali / ${id}: contenuti modificati`)
        }
    }
    if (JSON.stringify(current.careers) !== JSON.stringify(saved.careers)) {
        out.push('Careers: contenuti modificati')
    }
    if (JSON.stringify(current.press) !== JSON.stringify(saved.press)) {
        out.push('Press: contenuti modificati')
    }
    if (JSON.stringify(current.contact) !== JSON.stringify(saved.contact)) {
        out.push('Contatti: contenuti modificati')
    }
    if (JSON.stringify(current.mechanical) !== JSON.stringify(saved.mechanical)) {
        out.push('Meccanica: contenuti modificati')
    }
    if (JSON.stringify(current.carwash) !== JSON.stringify(saved.carwash)) {
        out.push('Lavaggio: contenuti modificati')
    }
    if (JSON.stringify(current.investitori) !== JSON.stringify(saved.investitori)) {
        out.push('Investitori: contenuti modificati')
    }
    if (JSON.stringify(current.franchising) !== JSON.stringify(saved.franchising)) {
        out.push('Franchising: contenuti modificati')
    }
    if (JSON.stringify(current.aviationQuote) !== JSON.stringify(saved.aviationQuote)) {
        out.push('Aviation Quote: contenuti modificati')
    }
    if (JSON.stringify(current.checkEmail) !== JSON.stringify(saved.checkEmail)) {
        out.push('Check Email: contenuti modificati')
    }
    if (JSON.stringify(current.jetSearchResults) !== JSON.stringify(saved.jetSearchResults)) {
        out.push('Jet Search Results: contenuti modificati')
    }
    if (JSON.stringify(current.confirmationSuccess) !== JSON.stringify(saved.confirmationSuccess)) {
        out.push('Conferma Prenotazione: contenuti modificati')
    }
    if (JSON.stringify(current.header) !== JSON.stringify(saved.header)) {
        out.push('Header: contenuti modificati')
    }
    return out
}

// ─── FAQ editor ──────────────────────────────────────────────────────────────
function FaqEditor({
    copy,
    setCopy,
}: {
    copy: FaqCopy
    setCopy: (next: FaqCopy) => void
}) {
    const entries = copy.entries
    const updateField = <K extends keyof FaqCopy>(key: K, value: FaqCopy[K]) => {
        setCopy({ ...copy, [key]: value })
    }
    const setEntries = (next: FaqEntry[]) => setCopy({ ...copy, entries: next })
    const update = (id: string, patch: Partial<FaqEntry>) => {
        setEntries(entries.map(e => e.id === id ? { ...e, ...patch } : e))
    }
    const remove = (id: string) => {
        if (!confirm('Rimuovere questa voce dalla FAQ?')) return
        setEntries(entries.filter(e => e.id !== id))
    }
    const move = (id: string, dir: -1 | 1) => {
        const idx = entries.findIndex(e => e.id === id)
        const newIdx = idx + dir
        if (idx < 0 || newIdx < 0 || newIdx >= entries.length) return
        const next = [...entries]
        ;[next[idx], next[newIdx]] = [next[newIdx], next[idx]]
        setEntries(next)
    }
    const add = () => {
        const id = `faq-${Date.now().toString(36)}`
        setEntries([...entries, { id, question: '', answer: '' }])
    }

    return (
        <div className="space-y-5">
            <div>
                <h2 className="text-[20px] font-semibold tracking-tight text-[#1d1d1f]">FAQ</h2>
                <p className="text-[13px] text-[#6e6e73] mt-1">
                    Pagina <code className="text-[12px] bg-black/5 px-1.5 py-0.5 rounded">/faq</code>. Modifica titolo pagina, eyebrow, sottotitolo e voci.
                </p>
            </div>

            {/* Page chrome (title + eyebrow + subtitle) */}
            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Hero pagina</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label='Eyebrow (IT) — es. "DR7 · Supporto"' value={copy.eyebrow_it} onChange={v => updateField('eyebrow_it', v)} />
                    <FieldText label="Eyebrow (EN)" value={copy.eyebrow_en} onChange={v => updateField('eyebrow_en', v)} />
                    <FieldText label='Titolo pagina (IT) — es. "Domande Frequenti"' value={copy.page_title_it} onChange={v => updateField('page_title_it', v)} />
                    <FieldText label="Titolo pagina (EN)" value={copy.page_title_en} onChange={v => updateField('page_title_en', v)} />
                    <FieldTextArea label="Sottotitolo (IT)" value={copy.subtitle_it} onChange={v => updateField('subtitle_it', v)} />
                    <FieldTextArea label="Sottotitolo (EN)" value={copy.subtitle_en} onChange={v => updateField('subtitle_en', v)} />
                </div>
            </section>

            <ul className="space-y-3">
                {entries.map((e, i) => (
                    <li key={e.id} className="border border-black/10 rounded-2xl p-4 bg-white shadow-sm">
                        <div className="flex items-start gap-3">
                            {/* Reorder controls */}
                            <div className="flex flex-col gap-1 pt-1">
                                <button
                                    onClick={() => move(e.id, -1)}
                                    disabled={i === 0}
                                    className="w-7 h-7 rounded-md text-[#6e6e73] hover:bg-black/5 disabled:opacity-30 disabled:hover:bg-transparent flex items-center justify-center"
                                    title="Sposta su"
                                ><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg></button>
                                <button
                                    onClick={() => move(e.id, 1)}
                                    disabled={i === entries.length - 1}
                                    className="w-7 h-7 rounded-md text-[#6e6e73] hover:bg-black/5 disabled:opacity-30 disabled:hover:bg-transparent flex items-center justify-center"
                                    title="Sposta giù"
                                ><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
                            </div>
                            {/* Content */}
                            <div className="flex-1 space-y-2">
                                <label className="block">
                                    <span className="text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6]">Domanda</span>
                                    <input
                                        type="text"
                                        value={e.question}
                                        onChange={(ev) => update(e.id, { question: ev.target.value })}
                                        placeholder="Es. Quali sono i requisiti per noleggiare un'auto?"
                                        className="mt-1 w-full bg-white border border-black/10 rounded-lg px-3 py-2 text-[14px] text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                                    />
                                </label>
                                <label className="block">
                                    <span className="text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6]">Risposta</span>
                                    <textarea
                                        value={e.answer}
                                        onChange={(ev) => update(e.id, { answer: ev.target.value })}
                                        placeholder="Es. Il conducente deve avere almeno 25 anni…"
                                        rows={3}
                                        className="mt-1 w-full bg-white border border-black/10 rounded-lg px-3 py-2 text-[14px] text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-blue-500/40 resize-y"
                                    />
                                </label>
                            </div>
                            {/* Delete */}
                            <button
                                onClick={() => remove(e.id)}
                                className="w-8 h-8 rounded-lg text-[#ff3b30] hover:bg-[#ff3b30]/10 flex items-center justify-center"
                                title="Elimina"
                            ><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg></button>
                        </div>
                    </li>
                ))}
            </ul>

            <button
                onClick={add}
                className="w-full py-3 rounded-2xl border-2 border-dashed border-black/15 text-[13px] font-medium text-[#1d1d1f] hover:bg-black/5 hover:border-blue-500/40 transition-colors flex items-center justify-center gap-2"
            >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Aggiungi domanda
            </button>
        </div>
    )
}

// ─── Cancellazione editor ───────────────────────────────────────────────────
function CancellazioneEditor({
    copy,
    setCopy,
}: {
    copy: CancellazioneCopy
    setCopy: (next: CancellazioneCopy) => void
}) {
    const updateField = <K extends keyof CancellazioneCopy>(key: K, value: CancellazioneCopy[K]) => {
        setCopy({ ...copy, [key]: value })
    }
    const updateSection = (idx: number, patch: Partial<CancellazioneSection>) => {
        const next = [...copy.sections]
        next[idx] = { ...next[idx], ...patch }
        setCopy({ ...copy, sections: next })
    }
    const moveSection = (idx: number, dir: -1 | 1) => {
        const j = idx + dir
        if (idx < 0 || j < 0 || j >= copy.sections.length) return
        const next = [...copy.sections]
        ;[next[idx], next[j]] = [next[j], next[idx]]
        setCopy({ ...copy, sections: next })
    }
    const removeSection = (idx: number) => {
        if (!confirm('Rimuovere questa sezione dalla pagina Cancellazione?')) return
        setCopy({ ...copy, sections: copy.sections.filter((_, i) => i !== idx) })
    }
    const addSection = () => {
        const id = `sec-${Date.now().toString(36)}`
        setCopy({
            ...copy,
            sections: [...copy.sections, {
                id, variant: 'standard',
                title_it: 'Nuova sezione', title_en: 'New section',
                blocks: [{ type: 'p', text_it: '', text_en: '' }],
            }],
        })
    }

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-[20px] font-semibold tracking-tight text-[#1d1d1f]">Cancellazione</h2>
                <p className="text-[13px] text-[#6e6e73] mt-1">
                    Pagina <code className="text-[12px] bg-black/5 px-1.5 py-0.5 rounded">/cancellation</code>. Modifica titoli e paragrafi in italiano e inglese. I numeri (giorni soglia, % rimborso/penale) vengono dalle regole in Centralina Pro &gt; Automazioni e si inseriscono coi placeholder <code>{'{thresholdDays}'}</code>, <code>{'{refundPercent}'}</code>, <code>{'{penaltyPercent}'}</code>, <code>{'{daysWord}'}</code>.
                </p>
            </div>

            {/* Page header + footer fields */}
            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Header & Footer pagina</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Titolo (IT)" value={copy.page_title_it} onChange={v => updateField('page_title_it', v)} />
                    <FieldText label="Titolo (EN)" value={copy.page_title_en} onChange={v => updateField('page_title_en', v)} />
                    <FieldText label="Etichetta contatto (IT)" value={copy.contact_label_it} onChange={v => updateField('contact_label_it', v)} />
                    <FieldText label="Etichetta contatto (EN)" value={copy.contact_label_en} onChange={v => updateField('contact_label_en', v)} />
                    <FieldText label="Email contatto" value={copy.contact_email} onChange={v => updateField('contact_email', v)} />
                    <FieldText label="Indirizzo (footer)" value={copy.contact_address} onChange={v => updateField('contact_address', v)} />
                    <FieldText label="Ultimo aggiornamento (IT)" value={copy.last_updated_it} onChange={v => updateField('last_updated_it', v)} />
                    <FieldText label="Ultimo aggiornamento (EN)" value={copy.last_updated_en} onChange={v => updateField('last_updated_en', v)} />
                </div>
            </section>

            {/* Sections */}
            <div className="space-y-3">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Sezioni ({copy.sections.length})</h3>
                {copy.sections.map((sec, i) => (
                    <SectionCard
                        key={sec.id}
                        section={sec}
                        first={i === 0}
                        last={i === copy.sections.length - 1}
                        onChange={(patch) => updateSection(i, patch)}
                        onMoveUp={() => moveSection(i, -1)}
                        onMoveDown={() => moveSection(i, 1)}
                        onRemove={() => removeSection(i)}
                    />
                ))}
                <button
                    onClick={addSection}
                    className="w-full py-3 rounded-2xl border-2 border-dashed border-black/15 text-[13px] font-medium text-[#1d1d1f] hover:bg-black/5 hover:border-blue-500/40 transition-colors flex items-center justify-center gap-2"
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Aggiungi sezione
                </button>
            </div>
        </div>
    )
}

function FieldText({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
    return (
        <label className="block">
            <span className="text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6]">{label}</span>
            <input
                type="text"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="mt-1 w-full bg-white border border-black/10 rounded-lg px-3 py-2 text-[13px] text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            />
        </label>
    )
}

function SectionCard({
    section, first, last, onChange, onMoveUp, onMoveDown, onRemove,
}: {
    section: CancellazioneSection
    first: boolean
    last: boolean
    onChange: (patch: Partial<CancellazioneSection>) => void
    onMoveUp: () => void
    onMoveDown: () => void
    onRemove: () => void
}) {
    const [open, setOpen] = useState(false)

    const updateBlock = (idx: number, next: CancellazioneBlock) => {
        const blocks = [...section.blocks]
        blocks[idx] = next
        onChange({ blocks })
    }
    const moveBlock = (idx: number, dir: -1 | 1) => {
        const j = idx + dir
        if (j < 0 || j >= section.blocks.length) return
        const blocks = [...section.blocks]
        ;[blocks[idx], blocks[j]] = [blocks[j], blocks[idx]]
        onChange({ blocks })
    }
    const removeBlock = (idx: number) => {
        if (!confirm('Rimuovere questo blocco?')) return
        onChange({ blocks: section.blocks.filter((_, i) => i !== idx) })
    }
    const addBlock = (type: CancellazioneBlock['type']) => {
        let block: CancellazioneBlock
        if (type === 'ul') block = { type: 'ul', items_it: [''], items_en: [''], tone: 'default' }
        else block = { type, text_it: '', text_en: '' }
        onChange({ blocks: [...section.blocks, block] })
    }

    const variantBadge = section.variant === 'flex'
        ? <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700">Flex</span>
        : <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-black/5 text-[#6e6e73]">Standard</span>

    return (
        <div className="border border-black/10 rounded-2xl bg-white shadow-sm">
            <header className="px-4 py-3 flex items-center gap-3">
                <button
                    onClick={() => setOpen(o => !o)}
                    className="flex-1 text-left flex items-center gap-3"
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`text-[#6e6e73] transition-transform ${open ? 'rotate-90' : ''}`}><polyline points="9 18 15 12 9 6"/></svg>
                    <span className="text-[13px] font-semibold text-[#1d1d1f] flex-1 truncate">{section.title_it || '(senza titolo)'}</span>
                    {variantBadge}
                </button>
                <div className="flex items-center gap-1">
                    <button onClick={onMoveUp} disabled={first} className="w-7 h-7 rounded-md text-[#6e6e73] hover:bg-black/5 disabled:opacity-30 flex items-center justify-center" title="Sposta su"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg></button>
                    <button onClick={onMoveDown} disabled={last} className="w-7 h-7 rounded-md text-[#6e6e73] hover:bg-black/5 disabled:opacity-30 flex items-center justify-center" title="Sposta giù"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
                    <button onClick={onRemove} className="w-7 h-7 rounded-md text-[#ff3b30] hover:bg-[#ff3b30]/10 flex items-center justify-center" title="Elimina sezione"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg></button>
                </div>
            </header>

            {open && (
                <div className="px-4 pb-4 space-y-4 border-t border-black/5 pt-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <FieldText label="Titolo sezione (IT)" value={section.title_it} onChange={v => onChange({ title_it: v })} />
                        <FieldText label="Titolo sezione (EN)" value={section.title_en} onChange={v => onChange({ title_en: v })} />
                    </div>
                    <label className="block">
                        <span className="text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6]">Variante stile</span>
                        <select
                            value={section.variant}
                            onChange={(e) => onChange({ variant: e.target.value as 'standard' | 'flex' })}
                            className="mt-1 w-full md:w-48 bg-white border border-black/10 rounded-lg px-3 py-2 text-[13px] text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                        >
                            <option value="standard">Standard (border grigio)</option>
                            <option value="flex">Flex (border verde)</option>
                        </select>
                    </label>

                    {/* Blocks */}
                    <div className="space-y-2">
                        <h4 className="text-[12px] font-semibold uppercase tracking-wide text-[#a1a1a6]">Blocchi ({section.blocks.length})</h4>
                        {section.blocks.map((block, i) => (
                            <BlockCard
                                key={i}
                                block={block}
                                first={i === 0}
                                last={i === section.blocks.length - 1}
                                onChange={(b) => updateBlock(i, b)}
                                onMoveUp={() => moveBlock(i, -1)}
                                onMoveDown={() => moveBlock(i, 1)}
                                onRemove={() => removeBlock(i)}
                            />
                        ))}
                        <div className="flex flex-wrap gap-2 pt-1">
                            <AddBlockButton label="+ Paragrafo" onClick={() => addBlock('p')} />
                            <AddBlockButton label="+ Paragrafo grassetto" onClick={() => addBlock('p-bold')} />
                            <AddBlockButton label="+ Paragrafo corsivo" onClick={() => addBlock('p-italic')} />
                            <AddBlockButton label="+ Lista puntata" onClick={() => addBlock('ul')} />
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

function AddBlockButton({ label, onClick }: { label: string; onClick: () => void }) {
    return (
        <button
            onClick={onClick}
            className="px-3 py-1.5 rounded-lg text-[12px] font-medium text-[#1d1d1f] bg-black/5 hover:bg-black/10"
        >{label}</button>
    )
}

function BlockCard({
    block, first, last, onChange, onMoveUp, onMoveDown, onRemove,
}: {
    block: CancellazioneBlock
    first: boolean
    last: boolean
    onChange: (next: CancellazioneBlock) => void
    onMoveUp: () => void
    onMoveDown: () => void
    onRemove: () => void
}) {
    const typeLabel = {
        'p': 'Paragrafo',
        'p-bold': 'Grassetto',
        'p-italic': 'Corsivo',
        'ul': 'Lista',
    }[block.type]

    return (
        <div className="border border-black/10 rounded-xl p-3 bg-[#fafafa]">
            <div className="flex items-center gap-2 mb-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-[#6e6e73] flex-1">{typeLabel}</span>
                <button onClick={onMoveUp} disabled={first} className="w-6 h-6 rounded-md text-[#6e6e73] hover:bg-black/5 disabled:opacity-30 flex items-center justify-center" title="Sposta su"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg></button>
                <button onClick={onMoveDown} disabled={last} className="w-6 h-6 rounded-md text-[#6e6e73] hover:bg-black/5 disabled:opacity-30 flex items-center justify-center" title="Sposta giù"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
                <button onClick={onRemove} className="w-6 h-6 rounded-md text-[#ff3b30] hover:bg-[#ff3b30]/10 flex items-center justify-center" title="Elimina"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
            </div>

            {block.type === 'ul' ? (
                <UlEditor
                    items_it={block.items_it}
                    items_en={block.items_en}
                    tone={block.tone || 'default'}
                    onChange={(patch) => onChange({ ...block, ...patch })}
                />
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <label className="block">
                        <span className="text-[10px] font-medium uppercase tracking-wide text-[#a1a1a6]">Italiano</span>
                        <textarea
                            value={block.text_it}
                            onChange={(e) => onChange({ ...block, text_it: e.target.value })}
                            rows={3}
                            className="mt-0.5 w-full bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px] text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-blue-500/40 resize-y"
                        />
                    </label>
                    <label className="block">
                        <span className="text-[10px] font-medium uppercase tracking-wide text-[#a1a1a6]">English</span>
                        <textarea
                            value={block.text_en}
                            onChange={(e) => onChange({ ...block, text_en: e.target.value })}
                            rows={3}
                            className="mt-0.5 w-full bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px] text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-blue-500/40 resize-y"
                        />
                    </label>
                </div>
            )}
        </div>
    )
}

function UlEditor({
    items_it, items_en, tone, onChange,
}: {
    items_it: string[]
    items_en: string[]
    tone: 'default' | 'green'
    onChange: (patch: { items_it?: string[]; items_en?: string[]; tone?: 'default' | 'green' }) => void
}) {
    // Items are aligned by index. Track the LONGER of the two so the editor
    // doesn't drop trailing untranslated items.
    const len = Math.max(items_it.length, items_en.length)
    const updateIt = (i: number, v: string) => {
        const next = [...items_it]
        while (next.length <= i) next.push('')
        next[i] = v
        onChange({ items_it: next })
    }
    const updateEn = (i: number, v: string) => {
        const next = [...items_en]
        while (next.length <= i) next.push('')
        next[i] = v
        onChange({ items_en: next })
    }
    const removeRow = (i: number) => {
        onChange({
            items_it: items_it.filter((_, j) => j !== i),
            items_en: items_en.filter((_, j) => j !== i),
        })
    }
    const addRow = () => {
        onChange({ items_it: [...items_it, ''], items_en: [...items_en, ''] })
    }
    const moveRow = (i: number, dir: -1 | 1) => {
        const j = i + dir
        if (j < 0 || j >= len) return
        const it = [...items_it]; const en = [...items_en]
        ;[it[i], it[j]] = [it[j] || '', it[i] || '']
        ;[en[i], en[j]] = [en[j] || '', en[i] || '']
        onChange({ items_it: it, items_en: en })
    }

    return (
        <div className="space-y-2">
            <label className="flex items-center gap-2 text-[11px] text-[#6e6e73]">
                <span>Tono:</span>
                <select
                    value={tone}
                    onChange={(e) => onChange({ tone: e.target.value as 'default' | 'green' })}
                    className="bg-white border border-black/10 rounded-md px-2 py-0.5 text-[12px]"
                >
                    <option value="default">Default (grigio)</option>
                    <option value="green">Verde (Flex)</option>
                </select>
            </label>
            <ul className="space-y-1.5">
                {Array.from({ length: len }).map((_, i) => (
                    <li key={i} className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 items-start">
                        <input
                            type="text"
                            value={items_it[i] || ''}
                            onChange={(e) => updateIt(i, e.target.value)}
                            placeholder="punto IT"
                            className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px]"
                        />
                        <input
                            type="text"
                            value={items_en[i] || ''}
                            onChange={(e) => updateEn(i, e.target.value)}
                            placeholder="bullet EN"
                            className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px]"
                        />
                        <div className="flex items-center gap-1">
                            <button onClick={() => moveRow(i, -1)} disabled={i === 0} className="w-6 h-6 rounded-md text-[#6e6e73] hover:bg-black/5 disabled:opacity-30 flex items-center justify-center" title="Sposta su"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg></button>
                            <button onClick={() => moveRow(i, 1)} disabled={i === len - 1} className="w-6 h-6 rounded-md text-[#6e6e73] hover:bg-black/5 disabled:opacity-30 flex items-center justify-center" title="Sposta giù"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
                            <button onClick={() => removeRow(i)} className="w-6 h-6 rounded-md text-[#ff3b30] hover:bg-[#ff3b30]/10 flex items-center justify-center" title="Elimina"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                        </div>
                    </li>
                ))}
            </ul>
            <button onClick={addRow} className="text-[12px] font-medium text-blue-500 hover:text-blue-600">+ Aggiungi voce</button>
        </div>
    )
}

// ─── Membership editor ──────────────────────────────────────────────────────
function MembershipEditor({
    copy,
    setCopy,
}: {
    copy: MembershipCopy
    setCopy: (next: MembershipCopy) => void
}) {
    const updateField = <K extends keyof MembershipCopy>(key: K, value: MembershipCopy[K]) => {
        setCopy({ ...copy, [key]: value })
    }
    // Elite sections (reuse Cancellazione SectionCard pattern)
    const updateEliteSection = (idx: number, patch: Partial<CancellazioneSection>) => {
        const next = [...copy.elite_sections]
        next[idx] = { ...next[idx], ...patch }
        setCopy({ ...copy, elite_sections: next })
    }
    const moveEliteSection = (idx: number, dir: -1 | 1) => {
        const j = idx + dir
        if (j < 0 || j >= copy.elite_sections.length) return
        const next = [...copy.elite_sections]
        ;[next[idx], next[j]] = [next[j], next[idx]]
        setCopy({ ...copy, elite_sections: next })
    }
    const removeEliteSection = (idx: number) => {
        if (!confirm('Rimuovere questa sotto-sezione?')) return
        setCopy({ ...copy, elite_sections: copy.elite_sections.filter((_, i) => i !== idx) })
    }
    const addEliteSection = () => {
        const id = `elite-${Date.now().toString(36)}`
        setCopy({
            ...copy,
            elite_sections: [...copy.elite_sections, {
                id, variant: 'standard',
                title_it: 'Nuova sotto-sezione', title_en: 'New sub-section',
                blocks: [{ type: 'p', text_it: '', text_en: '' }],
            }],
        })
    }

    // Reward grid items
    const updateRewardItem = (idx: number, patch: Partial<MembershipRewardItem>) => {
        const next = [...copy.reward_items]
        next[idx] = { ...next[idx], ...patch }
        setCopy({ ...copy, reward_items: next })
    }
    const moveRewardItem = (idx: number, dir: -1 | 1) => {
        const j = idx + dir
        if (j < 0 || j >= copy.reward_items.length) return
        const next = [...copy.reward_items]
        ;[next[idx], next[j]] = [next[j], next[idx]]
        setCopy({ ...copy, reward_items: next })
    }
    const removeRewardItem = (idx: number) => {
        if (!confirm('Rimuovere questa voce reward?')) return
        setCopy({ ...copy, reward_items: copy.reward_items.filter((_, i) => i !== idx) })
    }
    const addRewardItem = () => {
        setCopy({
            ...copy,
            reward_items: [...copy.reward_items, { label_it: 'Nuova voce', label_en: 'New item', reward: '0%', note_it: null, note_en: null }],
        })
    }

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-[20px] font-semibold tracking-tight text-[#1d1d1f]">Membership / DR7 Club</h2>
                <p className="text-[13px] text-[#6e6e73] mt-1">
                    Pagina <code className="text-[12px] bg-black/5 px-1.5 py-0.5 rounded">/membership</code>. I prezzi €/mese €/anno restano calcolati dai tier reali (constants/MEMBERSHIP_TIERS) — qui modifichi solo i testi. Placeholder utilizzabili: <code>{'{monthlyPrice}'}</code>, <code>{'{annualPrice}'}</code>, <code>{'{annualMonthly}'}</code>, <code>{'{annualSavings}'}</code>.
                </p>
            </div>

            {/* HERO */}
            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Hero</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label='Eyebrow (IT) — es. "Exclusive"' value={copy.hero_eyebrow_it} onChange={v => updateField('hero_eyebrow_it', v)} />
                    <FieldText label="Eyebrow (EN)" value={copy.hero_eyebrow_en} onChange={v => updateField('hero_eyebrow_en', v)} />
                </div>
                <FieldText label='Titolo (es. "DR7 CLUB")' value={copy.hero_title} onChange={v => updateField('hero_title', v)} />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldTextArea label="Sottotitolo (IT)" value={copy.hero_subtitle_it} onChange={v => updateField('hero_subtitle_it', v)} />
                    <FieldTextArea label="Sottotitolo (EN)" value={copy.hero_subtitle_en} onChange={v => updateField('hero_subtitle_en', v)} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldTextArea label="Riga apertura (IT)" value={copy.hero_opener_it} onChange={v => updateField('hero_opener_it', v)} placeholder="es. Attiva il tuo wallet... €{monthlyPrice}/mese" />
                    <FieldTextArea label="Riga apertura (EN)" value={copy.hero_opener_en} onChange={v => updateField('hero_opener_en', v)} />
                </div>
            </section>

            {/* PRICING */}
            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Pricing card</h3>
                <FieldText label="Titolo card" value={copy.pricing_card_title} onChange={v => updateField('pricing_card_title', v)} />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Toggle Mensile (IT)" value={copy.pricing_billing_monthly_it} onChange={v => updateField('pricing_billing_monthly_it', v)} />
                    <FieldText label="Toggle Mensile (EN)" value={copy.pricing_billing_monthly_en} onChange={v => updateField('pricing_billing_monthly_en', v)} />
                    <FieldText label="Toggle Annuale (IT)" value={copy.pricing_billing_annual_it} onChange={v => updateField('pricing_billing_annual_it', v)} />
                    <FieldText label="Toggle Annuale (EN)" value={copy.pricing_billing_annual_en} onChange={v => updateField('pricing_billing_annual_en', v)} />
                </div>
                <FieldText label='Badge sconto annuo (es. "-33%")' value={copy.pricing_billing_save_badge} onChange={v => updateField('pricing_billing_save_badge', v)} />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label='Suffisso ciclo "/mese" (IT)' value={copy.pricing_cycle_month_it} onChange={v => updateField('pricing_cycle_month_it', v)} />
                    <FieldText label='Suffisso ciclo "/month" (EN)' value={copy.pricing_cycle_month_en} onChange={v => updateField('pricing_cycle_month_en', v)} />
                    <FieldText label='Suffisso ciclo "/anno" (IT)' value={copy.pricing_cycle_year_it} onChange={v => updateField('pricing_cycle_year_it', v)} />
                    <FieldText label='Suffisso ciclo "/year" (EN)' value={copy.pricing_cycle_year_en} onChange={v => updateField('pricing_cycle_year_en', v)} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldTextArea label="Risparmio annuo (IT)" value={copy.pricing_savings_it} onChange={v => updateField('pricing_savings_it', v)} placeholder="es. Solo €{annualMonthly}/mese — risparmi €{annualSavings}/anno" />
                    <FieldTextArea label="Risparmio annuo (EN)" value={copy.pricing_savings_en} onChange={v => updateField('pricing_savings_en', v)} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="CTA bottone (IT)" value={copy.pricing_cta_it} onChange={v => updateField('pricing_cta_it', v)} />
                    <FieldText label="CTA bottone (EN)" value={copy.pricing_cta_en} onChange={v => updateField('pricing_cta_en', v)} />
                    <FieldText label="Footnote sotto CTA (IT)" value={copy.pricing_cta_footnote_it} onChange={v => updateField('pricing_cta_footnote_it', v)} />
                    <FieldText label="Footnote sotto CTA (EN)" value={copy.pricing_cta_footnote_en} onChange={v => updateField('pricing_cta_footnote_en', v)} />
                </div>
            </section>

            {/* DR7 ELITE REWARDS */}
            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">DR7 Elite Rewards</h3>
                <FieldText label='Titolo (es. "DR7 Elite Rewards")' value={copy.elite_title} onChange={v => updateField('elite_title', v)} />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Sottotitolo (IT)" value={copy.elite_subtitle_it} onChange={v => updateField('elite_subtitle_it', v)} />
                    <FieldText label="Sottotitolo (EN)" value={copy.elite_subtitle_en} onChange={v => updateField('elite_subtitle_en', v)} />
                    <FieldTextArea label="Intro (IT)" value={copy.elite_intro_it} onChange={v => updateField('elite_intro_it', v)} />
                    <FieldTextArea label="Intro (EN)" value={copy.elite_intro_en} onChange={v => updateField('elite_intro_en', v)} />
                </div>

                <div className="space-y-2">
                    <h4 className="text-[12px] font-semibold uppercase tracking-wide text-[#a1a1a6]">Sotto-sezioni ({copy.elite_sections.length})</h4>
                    {copy.elite_sections.map((sec, i) => (
                        <SectionCard
                            key={sec.id}
                            section={sec}
                            first={i === 0}
                            last={i === copy.elite_sections.length - 1}
                            onChange={(patch) => updateEliteSection(i, patch)}
                            onMoveUp={() => moveEliteSection(i, -1)}
                            onMoveDown={() => moveEliteSection(i, 1)}
                            onRemove={() => removeEliteSection(i)}
                        />
                    ))}
                    <button
                        onClick={addEliteSection}
                        className="w-full py-2.5 rounded-xl border-2 border-dashed border-black/15 text-[12px] font-medium text-[#1d1d1f] hover:bg-black/5 hover:border-blue-500/40 transition-colors flex items-center justify-center gap-2"
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                        Aggiungi sotto-sezione
                    </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-black/5">
                    <FieldText label="CTA finale — Titolo (IT)" value={copy.elite_cta_title_it} onChange={v => updateField('elite_cta_title_it', v)} />
                    <FieldText label="CTA finale — Titolo (EN)" value={copy.elite_cta_title_en} onChange={v => updateField('elite_cta_title_en', v)} />
                    <FieldTextArea label="CTA finale — Testo (IT)" value={copy.elite_cta_text_it} onChange={v => updateField('elite_cta_text_it', v)} />
                    <FieldTextArea label="CTA finale — Testo (EN)" value={copy.elite_cta_text_en} onChange={v => updateField('elite_cta_text_en', v)} />
                    <FieldText label="Bottone se non loggato (IT)" value={copy.elite_cta_logged_out_it} onChange={v => updateField('elite_cta_logged_out_it', v)} />
                    <FieldText label="Bottone se non loggato (EN)" value={copy.elite_cta_logged_out_en} onChange={v => updateField('elite_cta_logged_out_en', v)} />
                    <FieldText label="Bottone se loggato (IT)" value={copy.elite_cta_logged_in_it} onChange={v => updateField('elite_cta_logged_in_it', v)} />
                    <FieldText label="Bottone se loggato (EN)" value={copy.elite_cta_logged_in_en} onChange={v => updateField('elite_cta_logged_in_en', v)} />
                </div>
            </section>

            {/* REWARD SYSTEM */}
            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Sezione "Come funziona il Reward"</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Titolo (IT)" value={copy.reward_title_it} onChange={v => updateField('reward_title_it', v)} />
                    <FieldText label="Titolo (EN)" value={copy.reward_title_en} onChange={v => updateField('reward_title_en', v)} />
                    <FieldTextArea label="Intro (IT)" value={copy.reward_intro_it} onChange={v => updateField('reward_intro_it', v)} />
                    <FieldTextArea label="Intro (EN)" value={copy.reward_intro_en} onChange={v => updateField('reward_intro_en', v)} />
                </div>

                <div className="space-y-2">
                    <h4 className="text-[12px] font-semibold uppercase tracking-wide text-[#a1a1a6]">Voci reward ({copy.reward_items.length})</h4>
                    {copy.reward_items.map((item, i) => (
                        <RewardItemCard
                            key={i}
                            item={item}
                            first={i === 0}
                            last={i === copy.reward_items.length - 1}
                            onChange={(patch) => updateRewardItem(i, patch)}
                            onMoveUp={() => moveRewardItem(i, -1)}
                            onMoveDown={() => moveRewardItem(i, 1)}
                            onRemove={() => removeRewardItem(i)}
                        />
                    ))}
                    <button
                        onClick={addRewardItem}
                        className="w-full py-2.5 rounded-xl border-2 border-dashed border-black/15 text-[12px] font-medium text-[#1d1d1f] hover:bg-black/5 hover:border-blue-500/40 transition-colors flex items-center justify-center gap-2"
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                        Aggiungi voce reward
                    </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-black/5">
                    <FieldText label="Footnote (IT)" value={copy.reward_footnote_it} onChange={v => updateField('reward_footnote_it', v)} />
                    <FieldText label="Footnote (EN)" value={copy.reward_footnote_en} onChange={v => updateField('reward_footnote_en', v)} />
                </div>
            </section>
        </div>
    )
}

function FieldTextArea({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
    return (
        <label className="block">
            <span className="text-[11px] font-medium uppercase tracking-wide text-[#a1a1a6]">{label}</span>
            <textarea
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                rows={2}
                className="mt-1 w-full bg-white border border-black/10 rounded-lg px-3 py-2 text-[13px] text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-blue-500/40 resize-y"
            />
        </label>
    )
}

function RewardItemCard({
    item, first, last, onChange, onMoveUp, onMoveDown, onRemove,
}: {
    item: MembershipRewardItem
    first: boolean
    last: boolean
    onChange: (patch: Partial<MembershipRewardItem>) => void
    onMoveUp: () => void
    onMoveDown: () => void
    onRemove: () => void
}) {
    return (
        <div className="border border-black/10 rounded-xl p-3 bg-[#fafafa] space-y-2">
            <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-[#6e6e73] flex-1 truncate">{item.label_it || '(senza titolo)'}</span>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-700">{item.reward}</span>
                <button onClick={onMoveUp} disabled={first} className="w-6 h-6 rounded-md text-[#6e6e73] hover:bg-black/5 disabled:opacity-30 flex items-center justify-center" title="Sposta su"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg></button>
                <button onClick={onMoveDown} disabled={last} className="w-6 h-6 rounded-md text-[#6e6e73] hover:bg-black/5 disabled:opacity-30 flex items-center justify-center" title="Sposta giù"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
                <button onClick={onRemove} className="w-6 h-6 rounded-md text-[#ff3b30] hover:bg-[#ff3b30]/10 flex items-center justify-center" title="Elimina"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px] gap-2">
                <input type="text" value={item.label_it} onChange={e => onChange({ label_it: e.target.value })} placeholder="Etichetta IT" className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px]" />
                <input type="text" value={item.label_en} onChange={e => onChange({ label_en: e.target.value })} placeholder="Label EN" className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px]" />
                <input type="text" value={item.reward} onChange={e => onChange({ reward: e.target.value })} placeholder='Reward (es. "2%")' className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px] text-center font-semibold" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <input type="text" value={item.note_it ?? ''} onChange={e => onChange({ note_it: e.target.value || null })} placeholder="Nota IT (opzionale)" className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[12px]" />
                <input type="text" value={item.note_en ?? ''} onChange={e => onChange({ note_en: e.target.value || null })} placeholder="Note EN (optional)" className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[12px]" />
            </div>
        </div>
    )
}

// ─── Home / Hero editor ─────────────────────────────────────────────────────
const KNOWN_CATEGORY_IDS = [
    'cars', 'urban-cars', 'corporate-fleet', 'yachts', 'jets',
    'car-wash-services', 'mechanical-services', 'membership', 'credit-wallet',
]

function HomeEditor({
    copy,
    setCopy,
}: {
    copy: HomeCopy
    setCopy: (next: HomeCopy) => void
}) {
    const updateField = <K extends keyof HomeCopy>(key: K, value: HomeCopy[K]) => {
        setCopy({ ...copy, [key]: value })
    }
    // Slides
    const updateSlide = (idx: number, patch: Partial<HomeSlide>) => {
        const next = [...copy.hero_slides]
        next[idx] = { ...next[idx], ...patch }
        setCopy({ ...copy, hero_slides: next })
    }
    const moveSlide = (idx: number, dir: -1 | 1) => {
        const j = idx + dir
        if (j < 0 || j >= copy.hero_slides.length) return
        const next = [...copy.hero_slides]
        ;[next[idx], next[j]] = [next[j], next[idx]]
        setCopy({ ...copy, hero_slides: next })
    }
    const removeSlide = (idx: number) => {
        if (!confirm('Rimuovere questo video dal carosello hero?')) return
        setCopy({ ...copy, hero_slides: copy.hero_slides.filter((_, i) => i !== idx) })
    }
    const addSlide = () => {
        setCopy({
            ...copy,
            hero_slides: [...copy.hero_slides, { id: `slide-${Date.now().toString(36)}`, video_src: '/' }],
        })
    }
    // Categories
    const updateCategory = (idx: number, patch: Partial<HomeCategoryOverride>) => {
        const next = [...copy.categories]
        next[idx] = { ...next[idx], ...patch }
        setCopy({ ...copy, categories: next })
    }
    const moveCategory = (idx: number, dir: -1 | 1) => {
        const j = idx + dir
        if (j < 0 || j >= copy.categories.length) return
        const next = [...copy.categories]
        ;[next[idx], next[j]] = [next[j], next[idx]]
        setCopy({ ...copy, categories: next })
    }
    const removeCategory = (idx: number) => {
        if (!confirm('Rimuovere questo override? La card mostrera\' i valori di default hardcoded.')) return
        setCopy({ ...copy, categories: copy.categories.filter((_, i) => i !== idx) })
    }
    const addCategory = () => {
        setCopy({
            ...copy,
            categories: [...copy.categories, { id: '', display_title_it: '', display_title_en: '', image_src: '/' }],
        })
    }

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-[20px] font-semibold tracking-tight text-[#1d1d1f]">Home / Hero</h2>
                <p className="text-[13px] text-[#6e6e73] mt-1">
                    Pagina <code className="text-[12px] bg-black/5 px-1.5 py-0.5 rounded">/</code>. Modifica il titolo SEO, i video del carosello hero (path sotto <code>/public</code>) e le card categorie (titolo IT/EN + immagine). Le voci categoria sono override: se non c'e' override per un id, la card mostra il default hardcoded.
                </p>
            </div>

            {/* SEO */}
            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">SEO</h3>
                <p className="text-[12px] text-[#6e6e73]">
                    Titolo H1 nascosto nella pagina, indicizzato dai motori di ricerca. Non visibile nella UI.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="H1 SEO (IT)" value={copy.seo_h1_it} onChange={v => updateField('seo_h1_it', v)} />
                    <FieldText label="H1 SEO (EN)" value={copy.seo_h1_en} onChange={v => updateField('seo_h1_en', v)} />
                </div>
            </section>

            {/* Hero slides */}
            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Carosello Hero (video)</h3>
                        <p className="text-[12px] text-[#6e6e73] mt-1">Lista dei video che ruotano in homepage. Ogni path e' relativo alla cartella <code>/public</code> (es. <code>/main.mp4</code>).</p>
                    </div>
                    <label className="block shrink-0">
                        <span className="block text-[10px] font-medium uppercase tracking-wide text-[#a1a1a6] text-right">Autoplay</span>
                        <div className="relative">
                            <input
                                type="number"
                                min={2}
                                max={120}
                                value={copy.hero_autoplay_seconds}
                                onChange={(e) => updateField('hero_autoplay_seconds', Number(e.target.value) || 8)}
                                className="mt-0.5 w-24 bg-white border border-black/10 rounded-lg pl-3 pr-10 py-1.5 text-[13px] text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                            />
                            <span className="absolute right-2 top-1/2 -translate-y-[3px] text-[11px] text-[#a1a1a6] pointer-events-none">sec</span>
                        </div>
                    </label>
                </div>

                <ul className="space-y-2">
                    {copy.hero_slides.map((s, i) => (
                        <li key={s.id} className="grid grid-cols-1 md:grid-cols-[24px_1fr_auto] gap-2 items-center bg-[#fafafa] border border-black/10 rounded-xl p-3">
                            <span className="text-[11px] font-mono text-[#6e6e73] text-center">{i + 1}</span>
                            <input
                                type="text"
                                value={s.video_src}
                                onChange={(e) => updateSlide(i, { video_src: e.target.value })}
                                placeholder="/main.mp4"
                                className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px] font-mono"
                            />
                            <div className="flex items-center gap-1">
                                <button onClick={() => moveSlide(i, -1)} disabled={i === 0} className="w-7 h-7 rounded-md text-[#6e6e73] hover:bg-black/5 disabled:opacity-30 flex items-center justify-center" title="Sposta su"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg></button>
                                <button onClick={() => moveSlide(i, 1)} disabled={i === copy.hero_slides.length - 1} className="w-7 h-7 rounded-md text-[#6e6e73] hover:bg-black/5 disabled:opacity-30 flex items-center justify-center" title="Sposta giù"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
                                <button onClick={() => removeSlide(i)} className="w-7 h-7 rounded-md text-[#ff3b30] hover:bg-[#ff3b30]/10 flex items-center justify-center" title="Elimina"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                            </div>
                        </li>
                    ))}
                </ul>
                <button
                    onClick={addSlide}
                    className="w-full py-2.5 rounded-xl border-2 border-dashed border-black/15 text-[12px] font-medium text-[#1d1d1f] hover:bg-black/5 hover:border-blue-500/40 transition-colors flex items-center justify-center gap-2"
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Aggiungi video
                </button>
            </section>

            {/* Categories */}
            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Card categorie ({copy.categories.length})</h3>
                <p className="text-[12px] text-[#6e6e73]">
                    Override per le card della sezione "Categorie" della home. ID validi: <code className="text-[11px]">{KNOWN_CATEGORY_IDS.join(', ')}</code>. Se l'override per un id manca, la card mostra titolo + immagine di default hardcoded.
                </p>
                {copy.categories.map((c, i) => (
                    <CategoryCard
                        key={`${c.id}-${i}`}
                        cat={c}
                        first={i === 0}
                        last={i === copy.categories.length - 1}
                        onChange={(patch) => updateCategory(i, patch)}
                        onMoveUp={() => moveCategory(i, -1)}
                        onMoveDown={() => moveCategory(i, 1)}
                        onRemove={() => removeCategory(i)}
                    />
                ))}
                <button
                    onClick={addCategory}
                    className="w-full py-2.5 rounded-xl border-2 border-dashed border-black/15 text-[12px] font-medium text-[#1d1d1f] hover:bg-black/5 hover:border-blue-500/40 transition-colors flex items-center justify-center gap-2"
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Aggiungi override categoria
                </button>
            </section>
        </div>
    )
}

function CategoryCard({
    cat, first, last, onChange, onMoveUp, onMoveDown, onRemove,
}: {
    cat: HomeCategoryOverride
    first: boolean
    last: boolean
    onChange: (patch: Partial<HomeCategoryOverride>) => void
    onMoveUp: () => void
    onMoveDown: () => void
    onRemove: () => void
}) {
    const knownId = KNOWN_CATEGORY_IDS.includes(cat.id)
    return (
        <div className="border border-black/10 rounded-xl p-3 bg-[#fafafa] space-y-2">
            <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-[#6e6e73] flex-1 truncate">
                    {cat.id || '(id mancante)'}
                </span>
                {!knownId && cat.id && (
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700" title="Id non corrisponde a una categoria nota">id sconosciuto</span>
                )}
                <button onClick={onMoveUp} disabled={first} className="w-6 h-6 rounded-md text-[#6e6e73] hover:bg-black/5 disabled:opacity-30 flex items-center justify-center" title="Sposta su"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg></button>
                <button onClick={onMoveDown} disabled={last} className="w-6 h-6 rounded-md text-[#6e6e73] hover:bg-black/5 disabled:opacity-30 flex items-center justify-center" title="Sposta giù"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
                <button onClick={onRemove} className="w-6 h-6 rounded-md text-[#ff3b30] hover:bg-[#ff3b30]/10 flex items-center justify-center" title="Elimina"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <input type="text" value={cat.id} onChange={e => onChange({ id: e.target.value.trim() })} placeholder="cars" className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px] font-mono" />
                <input type="text" value={cat.display_title_it} onChange={e => onChange({ display_title_it: e.target.value })} placeholder="Titolo IT" className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px]" />
                <input type="text" value={cat.display_title_en} onChange={e => onChange({ display_title_en: e.target.value })} placeholder="Title EN" className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px]" />
            </div>
            <div className="flex items-center gap-3">
                <input type="text" value={cat.image_src} onChange={e => onChange({ image_src: e.target.value })} placeholder="/car.jpeg" className="flex-1 bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px] font-mono" />
                {cat.image_src && (
                    <img src={cat.image_src} alt="" className="w-12 h-8 object-cover rounded border border-black/10" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                )}
            </div>
        </div>
    )
}

// ─── Chi Siamo (About) editor ───────────────────────────────────────────────
function AboutEditor({
    copy,
    setCopy,
}: {
    copy: AboutCopy
    setCopy: (next: AboutCopy) => void
}) {
    const updateField = <K extends keyof AboutCopy>(key: K, value: AboutCopy[K]) => {
        setCopy({ ...copy, [key]: value })
    }
    // Founders
    const updateFounder = (idx: number, patch: Partial<AboutFounder>) => {
        const next = [...copy.founders]
        next[idx] = { ...next[idx], ...patch }
        setCopy({ ...copy, founders: next })
    }
    const moveFounder = (idx: number, dir: -1 | 1) => {
        const j = idx + dir
        if (j < 0 || j >= copy.founders.length) return
        const next = [...copy.founders]
        ;[next[idx], next[j]] = [next[j], next[idx]]
        setCopy({ ...copy, founders: next })
    }
    const removeFounder = (idx: number) => {
        if (!confirm('Rimuovere questo fondatore?')) return
        setCopy({ ...copy, founders: copy.founders.filter((_, i) => i !== idx) })
    }
    const addFounder = () => {
        setCopy({
            ...copy,
            founders: [...copy.founders, {
                id: `founder-${Date.now().toString(36)}`,
                name: '', role_it: 'Co-fondatore', role_en: 'Co-founder',
                photo_src: '/', alt_it: '', alt_en: '',
            }],
        })
    }

    // Paragraphs
    const updateParagraph = (idx: number, patch: Partial<BilingualParagraph>) => {
        const next = [...copy.story_paragraphs]
        next[idx] = { ...next[idx], ...patch }
        setCopy({ ...copy, story_paragraphs: next })
    }
    const moveParagraph = (idx: number, dir: -1 | 1) => {
        const j = idx + dir
        if (j < 0 || j >= copy.story_paragraphs.length) return
        const next = [...copy.story_paragraphs]
        ;[next[idx], next[j]] = [next[j], next[idx]]
        setCopy({ ...copy, story_paragraphs: next })
    }
    const removeParagraph = (idx: number) => {
        if (!confirm('Rimuovere questo paragrafo?')) return
        setCopy({ ...copy, story_paragraphs: copy.story_paragraphs.filter((_, i) => i !== idx) })
    }
    const addParagraph = () => {
        setCopy({ ...copy, story_paragraphs: [...copy.story_paragraphs, { text_it: '', text_en: '' }] })
    }

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-[20px] font-semibold tracking-tight text-[#1d1d1f]">Chi Siamo</h2>
                <p className="text-[13px] text-[#6e6e73] mt-1">
                    Pagina <code className="text-[12px] bg-black/5 px-1.5 py-0.5 rounded">/about</code>. Modifica i fondatori, la story e l'outro firmato. Il blocco "Careers" in fondo (Join_Our_Team) usa ancora le traduzioni globali, non e' editabile da qui.
                </p>
            </div>

            {/* Founders */}
            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Fondatori ({copy.founders.length})</h3>
                <p className="text-[12px] text-[#6e6e73]">
                    Massimo 4 ritratti per riga su desktop. Foto in <code>/public</code> (es. <code>/Valerio.jpg</code>). Add/remove/reorder liberamente.
                </p>
                {copy.founders.map((f, i) => (
                    <FounderCard
                        key={f.id}
                        founder={f}
                        first={i === 0}
                        last={i === copy.founders.length - 1}
                        onChange={(patch) => updateFounder(i, patch)}
                        onMoveUp={() => moveFounder(i, -1)}
                        onMoveDown={() => moveFounder(i, 1)}
                        onRemove={() => removeFounder(i)}
                    />
                ))}
                <button
                    onClick={addFounder}
                    className="w-full py-2.5 rounded-xl border-2 border-dashed border-black/15 text-[12px] font-medium text-[#1d1d1f] hover:bg-black/5 hover:border-blue-500/40 transition-colors flex items-center justify-center gap-2"
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Aggiungi fondatore
                </button>
            </section>

            {/* Story */}
            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Story</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Titolo (IT)" value={copy.story_title_it} onChange={v => updateField('story_title_it', v)} />
                    <FieldText label="Titolo (EN)" value={copy.story_title_en} onChange={v => updateField('story_title_en', v)} />
                </div>

                <div className="space-y-2">
                    <h4 className="text-[12px] font-semibold uppercase tracking-wide text-[#a1a1a6]">Paragrafi ({copy.story_paragraphs.length})</h4>
                    {copy.story_paragraphs.map((p, i) => (
                        <ParagraphCard
                            key={i}
                            paragraph={p}
                            index={i}
                            first={i === 0}
                            last={i === copy.story_paragraphs.length - 1}
                            onChange={(patch) => updateParagraph(i, patch)}
                            onMoveUp={() => moveParagraph(i, -1)}
                            onMoveDown={() => moveParagraph(i, 1)}
                            onRemove={() => removeParagraph(i)}
                        />
                    ))}
                    <button
                        onClick={addParagraph}
                        className="w-full py-2.5 rounded-xl border-2 border-dashed border-black/15 text-[12px] font-medium text-[#1d1d1f] hover:bg-black/5 hover:border-blue-500/40 transition-colors flex items-center justify-center gap-2"
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                        Aggiungi paragrafo
                    </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-black/5">
                    <FieldText label='Outro principale (IT) — es. "Benvenuti in DR7 Empire"' value={copy.story_outro_main_it} onChange={v => updateField('story_outro_main_it', v)} />
                    <FieldText label="Outro principale (EN)" value={copy.story_outro_main_en} onChange={v => updateField('story_outro_main_en', v)} />
                    <FieldTextArea label="Outro sub (IT)" value={copy.story_outro_sub_it} onChange={v => updateField('story_outro_sub_it', v)} />
                    <FieldTextArea label="Outro sub (EN)" value={copy.story_outro_sub_en} onChange={v => updateField('story_outro_sub_en', v)} />
                </div>

                <FieldText label='Firma (es. "— Valerio & Ilenia")' value={copy.story_signature} onChange={v => updateField('story_signature', v)} />
            </section>
        </div>
    )
}

function FounderCard({
    founder, first, last, onChange, onMoveUp, onMoveDown, onRemove,
}: {
    founder: AboutFounder
    first: boolean
    last: boolean
    onChange: (patch: Partial<AboutFounder>) => void
    onMoveUp: () => void
    onMoveDown: () => void
    onRemove: () => void
}) {
    return (
        <div className="border border-black/10 rounded-xl p-3 bg-[#fafafa] space-y-2">
            <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-[#6e6e73] flex-1 truncate">{founder.name || '(senza nome)'}</span>
                <button onClick={onMoveUp} disabled={first} className="w-6 h-6 rounded-md text-[#6e6e73] hover:bg-black/5 disabled:opacity-30 flex items-center justify-center" title="Sposta su"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg></button>
                <button onClick={onMoveDown} disabled={last} className="w-6 h-6 rounded-md text-[#6e6e73] hover:bg-black/5 disabled:opacity-30 flex items-center justify-center" title="Sposta giù"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
                <button onClick={onRemove} className="w-6 h-6 rounded-md text-[#ff3b30] hover:bg-[#ff3b30]/10 flex items-center justify-center" title="Elimina"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <input type="text" value={founder.name} onChange={e => onChange({ name: e.target.value })} placeholder="Nome" className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px]" />
                <input type="text" value={founder.role_it} onChange={e => onChange({ role_it: e.target.value })} placeholder="Ruolo IT (es. Co-fondatore)" className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px]" />
                <input type="text" value={founder.role_en} onChange={e => onChange({ role_en: e.target.value })} placeholder="Role EN" className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px]" />
            </div>
            <div className="flex items-center gap-3">
                <input type="text" value={founder.photo_src} onChange={e => onChange({ photo_src: e.target.value })} placeholder="/Valerio.jpg" className="flex-1 bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px] font-mono" />
                {founder.photo_src && (
                    <img src={founder.photo_src} alt="" className="w-12 h-12 object-cover rounded border border-black/10" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <input type="text" value={founder.alt_it} onChange={e => onChange({ alt_it: e.target.value })} placeholder='Alt foto IT (es. "Valerio - Co-fondatore...")' className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[12px]" />
                <input type="text" value={founder.alt_en} onChange={e => onChange({ alt_en: e.target.value })} placeholder="Alt photo EN" className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[12px]" />
            </div>
        </div>
    )
}

function ParagraphCard({
    paragraph, index, first, last, onChange, onMoveUp, onMoveDown, onRemove,
}: {
    paragraph: BilingualParagraph
    index: number
    first: boolean
    last: boolean
    onChange: (patch: Partial<BilingualParagraph>) => void
    onMoveUp: () => void
    onMoveDown: () => void
    onRemove: () => void
}) {
    return (
        <div className="border border-black/10 rounded-xl p-3 bg-[#fafafa] space-y-2">
            <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono text-[#6e6e73]">P{index + 1}</span>
                <span className="text-[11px] text-[#6e6e73] flex-1 truncate">{paragraph.text_it.slice(0, 60) || '(vuoto)'}</span>
                <button onClick={onMoveUp} disabled={first} className="w-6 h-6 rounded-md text-[#6e6e73] hover:bg-black/5 disabled:opacity-30 flex items-center justify-center" title="Sposta su"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg></button>
                <button onClick={onMoveDown} disabled={last} className="w-6 h-6 rounded-md text-[#6e6e73] hover:bg-black/5 disabled:opacity-30 flex items-center justify-center" title="Sposta giù"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
                <button onClick={onRemove} className="w-6 h-6 rounded-md text-[#ff3b30] hover:bg-[#ff3b30]/10 flex items-center justify-center" title="Elimina"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <textarea value={paragraph.text_it} onChange={e => onChange({ text_it: e.target.value })} placeholder="Testo IT" rows={4} className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px] resize-y" />
                <textarea value={paragraph.text_en} onChange={e => onChange({ text_en: e.target.value })} placeholder="Text EN" rows={4} className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px] resize-y" />
            </div>
        </div>
    )
}

// ─── Footer editor ──────────────────────────────────────────────────────────
const SOCIAL_ICON_OPTIONS: FooterSocialIcon[] = ['instagram', 'tiktok', 'facebook', 'linkedin', 'youtube', 'x']

function FooterEditor({
    copy,
    setCopy,
}: {
    copy: FooterCopy
    setCopy: (next: FooterCopy) => void
}) {
    const updateField = <K extends keyof FooterCopy>(key: K, value: FooterCopy[K]) => {
        setCopy({ ...copy, [key]: value })
    }
    // Social links
    const updateSocial = (idx: number, patch: Partial<FooterSocialLink>) => {
        const next = [...copy.social_links]
        next[idx] = { ...next[idx], ...patch }
        setCopy({ ...copy, social_links: next })
    }
    const moveSocial = (idx: number, dir: -1 | 1) => {
        const j = idx + dir
        if (j < 0 || j >= copy.social_links.length) return
        const next = [...copy.social_links]
        ;[next[idx], next[j]] = [next[j], next[idx]]
        setCopy({ ...copy, social_links: next })
    }
    const removeSocial = (idx: number) => {
        if (!confirm('Rimuovere questo social link?')) return
        setCopy({ ...copy, social_links: copy.social_links.filter((_, i) => i !== idx) })
    }
    const addSocial = () => {
        setCopy({
            ...copy,
            social_links: [...copy.social_links, { id: `s-${Date.now().toString(36)}`, label: 'Social', href: 'https://', icon: 'instagram' }],
        })
    }
    // Generic link list helpers
    type LinkField = 'division_links' | 'corporate_links' | 'legal_links'
    const updateLink = (field: LinkField, idx: number, patch: Partial<FooterLink>) => {
        const list = copy[field]
        const next = [...list]
        next[idx] = { ...next[idx], ...patch }
        setCopy({ ...copy, [field]: next })
    }
    const moveLink = (field: LinkField, idx: number, dir: -1 | 1) => {
        const list = copy[field]
        const j = idx + dir
        if (j < 0 || j >= list.length) return
        const next = [...list]
        ;[next[idx], next[j]] = [next[j], next[idx]]
        setCopy({ ...copy, [field]: next })
    }
    const removeLink = (field: LinkField, idx: number) => {
        if (!confirm('Rimuovere questo link?')) return
        setCopy({ ...copy, [field]: copy[field].filter((_, i) => i !== idx) })
    }
    const addLink = (field: LinkField) => {
        const list = copy[field]
        setCopy({
            ...copy,
            [field]: [...list, { id: `l-${Date.now().toString(36)}`, label_it: '', label_en: '', to: '/' }],
        })
    }

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-[20px] font-semibold tracking-tight text-[#1d1d1f]">Footer</h2>
                <p className="text-[13px] text-[#6e6e73] mt-1">
                    Footer del sito (visibile su ogni pagina). I social link qui sono indipendenti dalla tab <b>Marketing &gt; Social Links</b> (quella alimenta i template messaggi).
                </p>
            </div>

            {/* Network band */}
            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Network (banda social)</h3>
                <FieldText label="Titolo" value={copy.network_title} onChange={v => updateField('network_title', v)} />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldTextArea label="Testo (IT)" value={copy.network_text_it} onChange={v => updateField('network_text_it', v)} />
                    <FieldTextArea label="Testo (EN)" value={copy.network_text_en} onChange={v => updateField('network_text_en', v)} />
                </div>
                <div className="space-y-2">
                    <h4 className="text-[12px] font-semibold uppercase tracking-wide text-[#a1a1a6]">Social ({copy.social_links.length})</h4>
                    {copy.social_links.map((s, i) => (
                        <div key={s.id} className="border border-black/10 rounded-xl p-3 bg-[#fafafa] grid grid-cols-1 md:grid-cols-[120px_1fr_minmax(0,1fr)_auto] gap-2 items-center">
                            <select
                                value={s.icon}
                                onChange={(e) => updateSocial(i, { icon: e.target.value as FooterSocialIcon })}
                                className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px] text-[#1d1d1f]"
                            >
                                {SOCIAL_ICON_OPTIONS.map(o => <option key={o} value={o} className="text-[#1d1d1f]">{o}</option>)}
                            </select>
                            <input type="text" value={s.label} onChange={e => updateSocial(i, { label: e.target.value })} placeholder="aria-label (es. Instagram)" className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px] text-[#1d1d1f]" />
                            <input type="text" value={s.href} onChange={e => updateSocial(i, { href: e.target.value })} placeholder="https://www.instagram.com/..." className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px] text-[#1d1d1f] font-mono" />
                            <div className="flex items-center gap-1">
                                <button onClick={() => moveSocial(i, -1)} disabled={i === 0} className="w-6 h-6 rounded-md text-[#6e6e73] hover:bg-black/5 disabled:opacity-30 flex items-center justify-center" title="Sposta su"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg></button>
                                <button onClick={() => moveSocial(i, 1)} disabled={i === copy.social_links.length - 1} className="w-6 h-6 rounded-md text-[#6e6e73] hover:bg-black/5 disabled:opacity-30 flex items-center justify-center" title="Sposta giù"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
                                <button onClick={() => removeSocial(i)} className="w-6 h-6 rounded-md text-[#ff3b30] hover:bg-[#ff3b30]/10 flex items-center justify-center" title="Elimina"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                            </div>
                        </div>
                    ))}
                    <button onClick={addSocial} className="w-full py-2.5 rounded-xl border-2 border-dashed border-black/15 text-[12px] font-medium text-[#1d1d1f] hover:bg-black/5 hover:border-blue-500/40 transition-colors flex items-center justify-center gap-2">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                        Aggiungi social
                    </button>
                </div>
            </section>

            {/* Reviews band */}
            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Recensioni (banda)</h3>
                <FieldText label="Titolo" value={copy.reviews_title} onChange={v => updateField('reviews_title', v)} />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldTextArea label="Testo (IT)" value={copy.reviews_text_it} onChange={v => updateField('reviews_text_it', v)} />
                    <FieldTextArea label="Testo (EN)" value={copy.reviews_text_en} onChange={v => updateField('reviews_text_en', v)} />
                </div>
                <p className="text-[11px] text-[#6e6e73]">La lista recensioni sotto e' renderizzata da ReviewsSection (dinamico, non editabile da qui).</p>
            </section>

            {/* Contact band */}
            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Contatti & Legale</h3>
                <FieldText label="Titolo (es. Contact)" value={copy.contact_title} onChange={v => updateField('contact_title', v)} />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Numero WhatsApp visualizzato" value={copy.contact_whatsapp_number} onChange={v => updateField('contact_whatsapp_number', v)} />
                    <FieldText label="URL WhatsApp (wa.me)" value={copy.contact_whatsapp_url} onChange={v => updateField('contact_whatsapp_url', v)} />
                </div>
                <FieldText label="Ragione sociale" value={copy.contact_company_name} onChange={v => updateField('contact_company_name', v)} />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Sede legale (IT)" value={copy.contact_legal_address_it} onChange={v => updateField('contact_legal_address_it', v)} />
                    <FieldText label="Registered office (EN)" value={copy.contact_legal_address_en} onChange={v => updateField('contact_legal_address_en', v)} />
                    <FieldText label="Capitale sociale (IT)" value={copy.contact_capitale_sociale_it} onChange={v => updateField('contact_capitale_sociale_it', v)} />
                    <FieldText label="Share capital (EN)" value={copy.contact_capitale_sociale_en} onChange={v => updateField('contact_capitale_sociale_en', v)} />
                </div>
                <FieldText label="P.IVA / C.F." value={copy.contact_piva} onChange={v => updateField('contact_piva', v)} />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldTextArea label='Disclaimer (IT) — usa newline per a-capo' value={copy.contact_disclaimer_it} onChange={v => updateField('contact_disclaimer_it', v)} />
                    <FieldTextArea label="Disclaimer (EN)" value={copy.contact_disclaimer_en} onChange={v => updateField('contact_disclaimer_en', v)} />
                </div>
            </section>

            {/* Link rows */}
            <FooterLinkSection
                title="Division links (riga 1, bold)"
                hint="Es. Supercar & Luxury Division, Prime Wash, Contattaci"
                links={copy.division_links}
                onChange={(idx, patch) => updateLink('division_links', idx, patch)}
                onMoveUp={(idx) => moveLink('division_links', idx, -1)}
                onMoveDown={(idx) => moveLink('division_links', idx, 1)}
                onRemove={(idx) => removeLink('division_links', idx)}
                onAdd={() => addLink('division_links')}
            />
            <FooterLinkSection
                title="Corporate links (riga 2)"
                hint="Es. Corporate Overview, Press & Media, Careers"
                links={copy.corporate_links}
                onChange={(idx, patch) => updateLink('corporate_links', idx, patch)}
                onMoveUp={(idx) => moveLink('corporate_links', idx, -1)}
                onMoveDown={(idx) => moveLink('corporate_links', idx, 1)}
                onRemove={(idx) => removeLink('corporate_links', idx)}
                onAdd={() => addLink('corporate_links')}
            />
            <FooterLinkSection
                title="Legal links (riga 3)"
                hint="Es. Terms of Service, Cookie, Privacy, Cancellation"
                links={copy.legal_links}
                onChange={(idx, patch) => updateLink('legal_links', idx, patch)}
                onMoveUp={(idx) => moveLink('legal_links', idx, -1)}
                onMoveDown={(idx) => moveLink('legal_links', idx, 1)}
                onRemove={(idx) => removeLink('legal_links', idx)}
                onAdd={() => addLink('legal_links')}
            />

            {/* Bottom band */}
            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Banda inferiore</h3>
                <FieldText label="Riga brand (es. DR7 Cagliari – Global Mobility...)" value={copy.bottom_brand_line} onChange={v => updateField('bottom_brand_line', v)} />
                <FieldText label="Copyright (es. © 2024 - 2026 DR7...)" value={copy.bottom_copyright} onChange={v => updateField('bottom_copyright', v)} />
            </section>
        </div>
    )
}

function FooterLinkSection({
    title, hint, links, onChange, onMoveUp, onMoveDown, onRemove, onAdd,
}: {
    title: string
    hint: string
    links: FooterLink[]
    onChange: (idx: number, patch: Partial<FooterLink>) => void
    onMoveUp: (idx: number) => void
    onMoveDown: (idx: number) => void
    onRemove: (idx: number) => void
    onAdd: () => void
}) {
    return (
        <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
            <div>
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">{title} ({links.length})</h3>
                <p className="text-[12px] text-[#6e6e73] mt-1">{hint}</p>
            </div>
            {links.map((l, i) => (
                <div key={l.id} className="border border-black/10 rounded-xl p-3 bg-[#fafafa] space-y-2">
                    <div className="flex items-center gap-2">
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-[#6e6e73] flex-1 truncate">{l.label_it || '(senza titolo)'}</span>
                        {l.external && <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700">esterno</span>}
                        <button onClick={() => onMoveUp(i)} disabled={i === 0} className="w-6 h-6 rounded-md text-[#6e6e73] hover:bg-black/5 disabled:opacity-30 flex items-center justify-center" title="Sposta su"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg></button>
                        <button onClick={() => onMoveDown(i)} disabled={i === links.length - 1} className="w-6 h-6 rounded-md text-[#6e6e73] hover:bg-black/5 disabled:opacity-30 flex items-center justify-center" title="Sposta giù"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
                        <button onClick={() => onRemove(i)} className="w-6 h-6 rounded-md text-[#ff3b30] hover:bg-[#ff3b30]/10 flex items-center justify-center" title="Elimina"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <input type="text" value={l.label_it} onChange={e => onChange(i, { label_it: e.target.value })} placeholder="Etichetta IT" className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px]" />
                        <input type="text" value={l.label_en} onChange={e => onChange(i, { label_en: e.target.value })} placeholder="Label EN" className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px]" />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2 items-center">
                        <input type="text" value={l.to} onChange={e => onChange(i, { to: e.target.value })} placeholder="/about oppure https://..." className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px] font-mono" />
                        <label className="flex items-center gap-2 text-[12px] text-[#6e6e73] whitespace-nowrap">
                            <input type="checkbox" checked={!!l.external} onChange={e => onChange(i, { external: e.target.checked || undefined })} />
                            forza link esterno
                        </label>
                    </div>
                </div>
            ))}
            <button onClick={onAdd} className="w-full py-2.5 rounded-xl border-2 border-dashed border-black/15 text-[12px] font-medium text-[#1d1d1f] hover:bg-black/5 hover:border-blue-500/40 transition-colors flex items-center justify-center gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Aggiungi link
            </button>
        </section>
    )
}

// ─── Privacy & Termini (Legal) editor ───────────────────────────────────────
const LEGAL_PAGE_LABELS: Record<LegalPageId, string> = {
    privacy: 'Privacy Policy',
    cookie: 'Cookie Policy',
    rental_agreement: 'Rental Agreement',
    terms: 'Terms of Service',
}

function LegalEditor({
    copy,
    setCopy,
}: {
    copy: LegalCopy
    setCopy: (next: LegalCopy) => void
}) {
    const [activeId, setActiveId] = useState<LegalPageId>('privacy')
    const active = copy.pages.find(p => p.id === activeId) || emptyLegalPage(activeId)

    const updatePage = (patch: Partial<LegalPageCopy>) => {
        setCopy({
            ...copy,
            pages: copy.pages.map(p => p.id === activeId ? { ...p, ...patch } : p),
        })
    }
    // Sections
    const updateSection = (idx: number, patch: Partial<LegalSection>) => {
        const next = [...active.sections]
        next[idx] = { ...next[idx], ...patch }
        updatePage({ sections: next })
    }
    const moveSection = (idx: number, dir: -1 | 1) => {
        const j = idx + dir
        if (j < 0 || j >= active.sections.length) return
        const next = [...active.sections]
        ;[next[idx], next[j]] = [next[j], next[idx]]
        updatePage({ sections: next })
    }
    const removeSection = (idx: number) => {
        if (!confirm('Rimuovere questa sezione?')) return
        updatePage({ sections: active.sections.filter((_, i) => i !== idx) })
    }
    const addSection = () => {
        const id = `sec-${Date.now().toString(36)}`
        updatePage({
            sections: [...active.sections, {
                id,
                heading_it: 'Nuova sezione', heading_en: 'New section',
                blocks: [{ type: 'p', text_it: '', text_en: '' }],
            }],
        })
    }

    // Intro/Outro blocks (raw block lists)
    const updateBandBlock = (band: 'intro_blocks' | 'outro_blocks', idx: number, next: CancellazioneBlock) => {
        const list = [...active[band]]
        list[idx] = next
        updatePage({ [band]: list } as Partial<LegalPageCopy>)
    }
    const moveBandBlock = (band: 'intro_blocks' | 'outro_blocks', idx: number, dir: -1 | 1) => {
        const list = [...active[band]]
        const j = idx + dir
        if (j < 0 || j >= list.length) return
        ;[list[idx], list[j]] = [list[j], list[idx]]
        updatePage({ [band]: list } as Partial<LegalPageCopy>)
    }
    const removeBandBlock = (band: 'intro_blocks' | 'outro_blocks', idx: number) => {
        if (!confirm('Rimuovere questo blocco?')) return
        updatePage({ [band]: active[band].filter((_, i) => i !== idx) } as Partial<LegalPageCopy>)
    }
    const addBandBlock = (band: 'intro_blocks' | 'outro_blocks', type: CancellazioneBlock['type']) => {
        const block: CancellazioneBlock = type === 'ul'
            ? { type: 'ul', items_it: [''], items_en: [''], tone: 'default' }
            : { type, text_it: '', text_en: '' }
        updatePage({ [band]: [...active[band], block] } as Partial<LegalPageCopy>)
    }

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-[20px] font-semibold tracking-tight text-[#1d1d1f]">Privacy & Termini</h2>
                <p className="text-[13px] text-[#6e6e73] mt-1">
                    Modifica le pagine legali. Inline supportato: <code>**grassetto**</code> e <code>[testo](https://link)</code> (anche <code>mailto:</code>). Newline nei testi diventano a-capo a video.
                </p>
            </div>

            {/* Page picker */}
            <div className="flex flex-wrap gap-2">
                {(['privacy', 'cookie', 'rental_agreement', 'terms'] as LegalPageId[]).map(id => {
                    const page = copy.pages.find(p => p.id === id)
                    const isActive = activeId === id
                    return (
                        <button
                            key={id}
                            onClick={() => setActiveId(id)}
                            className={`px-3 py-1.5 rounded-lg text-[12px] font-medium border ${
                                isActive
                                    ? 'bg-blue-500 border-blue-500 text-white shadow-sm'
                                    : 'bg-white border-black/10 text-[#1d1d1f] hover:bg-black/5'
                            }`}
                        >
                            {LEGAL_PAGE_LABELS[id]}
                            {!page?.enabled && (
                                <span className={`ml-2 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${isActive ? 'bg-white/20 text-white' : 'bg-amber-500/15 text-amber-700'}`}>off</span>
                            )}
                        </button>
                    )
                })}
            </div>

            {/* Page meta */}
            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <div className="flex items-center justify-between gap-4">
                    <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Impostazioni pagina</h3>
                    <label className="inline-flex items-center gap-2 cursor-pointer">
                        <span className="text-[12px] text-[#6e6e73]">Pagina attiva</span>
                        <input
                            type="checkbox"
                            checked={active.enabled}
                            onChange={(e) => updatePage({ enabled: e.target.checked })}
                            className="sr-only peer"
                        />
                        <span className="relative inline-block w-9 h-5 rounded-full bg-[#e5e5ea] peer-checked:bg-[#34c759] transition-colors">
                            <span className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
                        </span>
                    </label>
                </div>
                <p className="text-[11px] text-[#6e6e73] -mt-2">Disattivata = il sito mostra il testo legacy hardcoded della pagina.</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Titolo pagina (IT)" value={active.title_it} onChange={v => updatePage({ title_it: v })} />
                    <FieldText label="Titolo pagina (EN)" value={active.title_en} onChange={v => updatePage({ title_en: v })} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-[auto_1fr_1fr] gap-4 items-end">
                    <label className="inline-flex items-center gap-2 cursor-pointer pb-2">
                        <input
                            type="checkbox"
                            checked={active.last_updated_dynamic}
                            onChange={(e) => updatePage({ last_updated_dynamic: e.target.checked })}
                        />
                        <span className="text-[12px] text-[#1d1d1f]">Mostra "ultimo aggiornamento" con data odierna</span>
                    </label>
                    <FieldText label='Etichetta (IT)' value={active.last_updated_label_it} onChange={v => updatePage({ last_updated_label_it: v })} />
                    <FieldText label='Etichetta (EN)' value={active.last_updated_label_en} onChange={v => updatePage({ last_updated_label_en: v })} />
                </div>
            </section>

            {/* Intro band */}
            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Intro (sopra le sezioni) — {active.intro_blocks.length} blocchi</h3>
                {active.intro_blocks.map((block, i) => (
                    <BlockCard
                        key={`intro-${i}`}
                        block={block}
                        first={i === 0}
                        last={i === active.intro_blocks.length - 1}
                        onChange={(b) => updateBandBlock('intro_blocks', i, b)}
                        onMoveUp={() => moveBandBlock('intro_blocks', i, -1)}
                        onMoveDown={() => moveBandBlock('intro_blocks', i, 1)}
                        onRemove={() => removeBandBlock('intro_blocks', i)}
                    />
                ))}
                <div className="flex flex-wrap gap-2">
                    <AddBlockButton label="+ Paragrafo" onClick={() => addBandBlock('intro_blocks', 'p')} />
                    <AddBlockButton label="+ Grassetto" onClick={() => addBandBlock('intro_blocks', 'p-bold')} />
                    <AddBlockButton label="+ Corsivo" onClick={() => addBandBlock('intro_blocks', 'p-italic')} />
                    <AddBlockButton label="+ Lista puntata" onClick={() => addBandBlock('intro_blocks', 'ul')} />
                </div>
            </section>

            {/* Sections */}
            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Sezioni numerate ({active.sections.length})</h3>
                {active.sections.map((sec, i) => (
                    <LegalSectionCard
                        key={sec.id}
                        section={sec}
                        first={i === 0}
                        last={i === active.sections.length - 1}
                        onChange={(patch) => updateSection(i, patch)}
                        onMoveUp={() => moveSection(i, -1)}
                        onMoveDown={() => moveSection(i, 1)}
                        onRemove={() => removeSection(i)}
                    />
                ))}
                <button
                    onClick={addSection}
                    className="w-full py-2.5 rounded-xl border-2 border-dashed border-black/15 text-[12px] font-medium text-[#1d1d1f] hover:bg-black/5 hover:border-blue-500/40 transition-colors flex items-center justify-center gap-2"
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Aggiungi sezione
                </button>
            </section>

            {/* Outro band */}
            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Outro (sotto le sezioni) — {active.outro_blocks.length} blocchi</h3>
                {active.outro_blocks.map((block, i) => (
                    <BlockCard
                        key={`outro-${i}`}
                        block={block}
                        first={i === 0}
                        last={i === active.outro_blocks.length - 1}
                        onChange={(b) => updateBandBlock('outro_blocks', i, b)}
                        onMoveUp={() => moveBandBlock('outro_blocks', i, -1)}
                        onMoveDown={() => moveBandBlock('outro_blocks', i, 1)}
                        onRemove={() => removeBandBlock('outro_blocks', i)}
                    />
                ))}
                <div className="flex flex-wrap gap-2">
                    <AddBlockButton label="+ Paragrafo" onClick={() => addBandBlock('outro_blocks', 'p')} />
                    <AddBlockButton label="+ Grassetto" onClick={() => addBandBlock('outro_blocks', 'p-bold')} />
                    <AddBlockButton label="+ Corsivo" onClick={() => addBandBlock('outro_blocks', 'p-italic')} />
                    <AddBlockButton label="+ Lista puntata" onClick={() => addBandBlock('outro_blocks', 'ul')} />
                </div>
            </section>
        </div>
    )
}

function LegalSectionCard({
    section, first, last, onChange, onMoveUp, onMoveDown, onRemove,
}: {
    section: LegalSection
    first: boolean
    last: boolean
    onChange: (patch: Partial<LegalSection>) => void
    onMoveUp: () => void
    onMoveDown: () => void
    onRemove: () => void
}) {
    const [open, setOpen] = useState(false)
    const updateBlock = (idx: number, next: CancellazioneBlock) => {
        const blocks = [...section.blocks]
        blocks[idx] = next
        onChange({ blocks })
    }
    const moveBlock = (idx: number, dir: -1 | 1) => {
        const j = idx + dir
        if (j < 0 || j >= section.blocks.length) return
        const blocks = [...section.blocks]
        ;[blocks[idx], blocks[j]] = [blocks[j], blocks[idx]]
        onChange({ blocks })
    }
    const removeBlock = (idx: number) => {
        if (!confirm('Rimuovere questo blocco?')) return
        onChange({ blocks: section.blocks.filter((_, i) => i !== idx) })
    }
    const addBlock = (type: CancellazioneBlock['type']) => {
        const block: CancellazioneBlock = type === 'ul'
            ? { type: 'ul', items_it: [''], items_en: [''], tone: 'default' }
            : { type, text_it: '', text_en: '' }
        onChange({ blocks: [...section.blocks, block] })
    }

    return (
        <div className="border border-black/10 rounded-2xl bg-white shadow-sm">
            <header className="px-4 py-3 flex items-center gap-3">
                <button onClick={() => setOpen(o => !o)} className="flex-1 text-left flex items-center gap-3">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`text-[#6e6e73] transition-transform ${open ? 'rotate-90' : ''}`}><polyline points="9 18 15 12 9 6"/></svg>
                    <span className="text-[13px] font-semibold text-[#1d1d1f] flex-1 truncate">{section.heading_it || '(senza titolo)'}</span>
                </button>
                <div className="flex items-center gap-1">
                    <button onClick={onMoveUp} disabled={first} className="w-7 h-7 rounded-md text-[#6e6e73] hover:bg-black/5 disabled:opacity-30 flex items-center justify-center" title="Sposta su"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg></button>
                    <button onClick={onMoveDown} disabled={last} className="w-7 h-7 rounded-md text-[#6e6e73] hover:bg-black/5 disabled:opacity-30 flex items-center justify-center" title="Sposta giù"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
                    <button onClick={onRemove} className="w-7 h-7 rounded-md text-[#ff3b30] hover:bg-[#ff3b30]/10 flex items-center justify-center" title="Elimina"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg></button>
                </div>
            </header>
            {open && (
                <div className="px-4 pb-4 space-y-4 border-t border-black/5 pt-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <FieldText label="Heading (IT)" value={section.heading_it} onChange={v => onChange({ heading_it: v })} />
                        <FieldText label="Heading (EN)" value={section.heading_en} onChange={v => onChange({ heading_en: v })} />
                    </div>
                    <div className="space-y-2">
                        <h4 className="text-[12px] font-semibold uppercase tracking-wide text-[#a1a1a6]">Blocchi ({section.blocks.length})</h4>
                        {section.blocks.map((block, i) => (
                            <BlockCard
                                key={i}
                                block={block}
                                first={i === 0}
                                last={i === section.blocks.length - 1}
                                onChange={(b) => updateBlock(i, b)}
                                onMoveUp={() => moveBlock(i, -1)}
                                onMoveDown={() => moveBlock(i, 1)}
                                onRemove={() => removeBlock(i)}
                            />
                        ))}
                        <div className="flex flex-wrap gap-2 pt-1">
                            <AddBlockButton label="+ Paragrafo" onClick={() => addBlock('p')} />
                            <AddBlockButton label="+ Grassetto" onClick={() => addBlock('p-bold')} />
                            <AddBlockButton label="+ Corsivo" onClick={() => addBlock('p-italic')} />
                            <AddBlockButton label="+ Lista puntata" onClick={() => addBlock('ul')} />
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

// All current sections are migrated, so PlaceholderSection isn't rendered.
// Keeping the spot reserved for the next sub-tab — define + remove together
// when the next migration lands.

// ─── Careers editor ─────────────────────────────────────────────────────────
function CareersEditor({ copy, setCopy }: { copy: CareersCopy; setCopy: (next: CareersCopy) => void }) {
    const update = <K extends keyof CareersCopy>(key: K, value: CareersCopy[K]) => setCopy({ ...copy, [key]: value })
    const updateJob = (idx: number, patch: Partial<CareersJob>) => {
        const next = [...copy.jobs]
        next[idx] = { ...next[idx], ...patch }
        setCopy({ ...copy, jobs: next })
    }
    const moveJob = (idx: number, dir: -1 | 1) => {
        const j = idx + dir
        if (j < 0 || j >= copy.jobs.length) return
        const next = [...copy.jobs]
        ;[next[idx], next[j]] = [next[j], next[idx]]
        setCopy({ ...copy, jobs: next })
    }
    const removeJob = (idx: number) => {
        if (!confirm('Rimuovere questa posizione?')) return
        setCopy({ ...copy, jobs: copy.jobs.filter((_, i) => i !== idx) })
    }
    const addJob = () => {
        setCopy({
            ...copy,
            jobs: [...copy.jobs, {
                id: `job-${Date.now().toString(36)}`,
                title_it: '', title_en: '',
                location_it: '', location_en: '',
                type_it: 'Tempo pieno', type_en: 'Full-time',
                description_it: '', description_en: '',
            }],
        })
    }

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-[20px] font-semibold tracking-tight text-[#1d1d1f]">Careers</h2>
                <p className="text-[13px] text-[#6e6e73] mt-1">
                    Pagina <code className="text-[12px] bg-black/5 px-1.5 py-0.5 rounded">/careers</code>. Inline supportato nel testo "Come Candidarsi": <code>**grassetto**</code> e <code>[testo](mailto:...)</code>.
                </p>
            </div>

            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Hero pagina</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Titolo pagina (IT)" value={copy.page_title_it} onChange={v => update('page_title_it', v)} />
                    <FieldText label="Titolo pagina (EN)" value={copy.page_title_en} onChange={v => update('page_title_en', v)} />
                    <FieldTextArea label="Intro (IT)" value={copy.intro_it} onChange={v => update('intro_it', v)} />
                    <FieldTextArea label="Intro (EN)" value={copy.intro_en} onChange={v => update('intro_en', v)} />
                </div>
            </section>

            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Posizioni Aperte ({copy.jobs.length})</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Heading sezione (IT)" value={copy.jobs_heading_it} onChange={v => update('jobs_heading_it', v)} />
                    <FieldText label="Heading sezione (EN)" value={copy.jobs_heading_en} onChange={v => update('jobs_heading_en', v)} />
                </div>
                {copy.jobs.map((job, i) => (
                    <div key={job.id} className="border border-black/10 rounded-xl p-3 bg-[#fafafa] space-y-2">
                        <div className="flex items-center gap-2">
                            <span className="text-[11px] font-semibold uppercase tracking-wide text-[#6e6e73] flex-1 truncate">{job.title_it || '(senza titolo)'}</span>
                            <button onClick={() => moveJob(i, -1)} disabled={i === 0} className="w-6 h-6 rounded-md text-[#6e6e73] hover:bg-black/5 disabled:opacity-30 flex items-center justify-center" title="Sposta su"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg></button>
                            <button onClick={() => moveJob(i, 1)} disabled={i === copy.jobs.length - 1} className="w-6 h-6 rounded-md text-[#6e6e73] hover:bg-black/5 disabled:opacity-30 flex items-center justify-center" title="Sposta giù"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
                            <button onClick={() => removeJob(i)} className="w-6 h-6 rounded-md text-[#ff3b30] hover:bg-[#ff3b30]/10 flex items-center justify-center" title="Elimina"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            <input type="text" value={job.title_it} onChange={e => updateJob(i, { title_it: e.target.value })} placeholder="Titolo IT" className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px]" />
                            <input type="text" value={job.title_en} onChange={e => updateJob(i, { title_en: e.target.value })} placeholder="Title EN" className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px]" />
                            <input type="text" value={job.location_it} onChange={e => updateJob(i, { location_it: e.target.value })} placeholder="Sede IT (es. Sede: Cagliari, Italia)" className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px]" />
                            <input type="text" value={job.location_en} onChange={e => updateJob(i, { location_en: e.target.value })} placeholder="Location EN" className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px]" />
                            <input type="text" value={job.type_it} onChange={e => updateJob(i, { type_it: e.target.value })} placeholder="Tempo (IT) — es. Tempo pieno" className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px]" />
                            <input type="text" value={job.type_en} onChange={e => updateJob(i, { type_en: e.target.value })} placeholder="Type EN — e.g. Full-time" className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px]" />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            <textarea value={job.description_it} onChange={e => updateJob(i, { description_it: e.target.value })} placeholder="Descrizione IT" rows={3} className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px] resize-y" />
                            <textarea value={job.description_en} onChange={e => updateJob(i, { description_en: e.target.value })} placeholder="Description EN" rows={3} className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px] resize-y" />
                        </div>
                    </div>
                ))}
                <button onClick={addJob} className="w-full py-2.5 rounded-xl border-2 border-dashed border-black/15 text-[12px] font-medium text-[#1d1d1f] hover:bg-black/5 hover:border-blue-500/40 transition-colors flex items-center justify-center gap-2">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Aggiungi posizione
                </button>
            </section>

            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Come Candidarsi</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Heading (IT)" value={copy.apply_heading_it} onChange={v => update('apply_heading_it', v)} />
                    <FieldText label="Heading (EN)" value={copy.apply_heading_en} onChange={v => update('apply_heading_en', v)} />
                    <FieldTextArea label="Testo (IT) — supporta inline markdown" value={copy.apply_text_it} onChange={v => update('apply_text_it', v)} />
                    <FieldTextArea label="Text (EN)" value={copy.apply_text_en} onChange={v => update('apply_text_en', v)} />
                </div>
                <FieldText label="Email candidature" value={copy.apply_email} onChange={v => update('apply_email', v)} />
            </section>
        </div>
    )
}

// ─── Press editor ───────────────────────────────────────────────────────────
function PressEditor({ copy, setCopy }: { copy: PressCopy; setCopy: (next: PressCopy) => void }) {
    const update = <K extends keyof PressCopy>(key: K, value: PressCopy[K]) => setCopy({ ...copy, [key]: value })
    const updateArt = (idx: number, patch: Partial<PressArticle>) => {
        const next = [...copy.articles]
        next[idx] = { ...next[idx], ...patch }
        setCopy({ ...copy, articles: next })
    }
    const moveArt = (idx: number, dir: -1 | 1) => {
        const j = idx + dir
        if (j < 0 || j >= copy.articles.length) return
        const next = [...copy.articles]
        ;[next[idx], next[j]] = [next[j], next[idx]]
        setCopy({ ...copy, articles: next })
    }
    const removeArt = (idx: number) => {
        if (!confirm('Rimuovere questo articolo?')) return
        setCopy({ ...copy, articles: copy.articles.filter((_, i) => i !== idx) })
    }
    const addArt = () => {
        setCopy({
            ...copy,
            articles: [...copy.articles, {
                id: `art-${Date.now().toString(36)}`,
                title: '', publication: '', date: '',
                summary_it: '', summary_en: '',
                link: 'https://',
            }],
        })
    }

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-[20px] font-semibold tracking-tight text-[#1d1d1f]">Press</h2>
                <p className="text-[13px] text-[#6e6e73] mt-1">
                    Pagina <code className="text-[12px] bg-black/5 px-1.5 py-0.5 rounded">/press</code>. Hero, sezione "Richieste Stampa", lista articoli, sezione "Comunicati Stampa".
                </p>
            </div>

            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Hero</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Titolo pagina (IT)" value={copy.page_title_it} onChange={v => update('page_title_it', v)} />
                    <FieldText label="Titolo pagina (EN)" value={copy.page_title_en} onChange={v => update('page_title_en', v)} />
                    <FieldTextArea label="Sottotitolo (IT)" value={copy.subtitle_it} onChange={v => update('subtitle_it', v)} />
                    <FieldTextArea label="Sottotitolo (EN)" value={copy.subtitle_en} onChange={v => update('subtitle_en', v)} />
                </div>
            </section>

            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Richieste Stampa (banda)</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Heading (IT)" value={copy.inquiries_heading_it} onChange={v => update('inquiries_heading_it', v)} />
                    <FieldText label="Heading (EN)" value={copy.inquiries_heading_en} onChange={v => update('inquiries_heading_en', v)} />
                    <FieldTextArea label="Testo (IT)" value={copy.inquiries_text_it} onChange={v => update('inquiries_text_it', v)} />
                    <FieldTextArea label="Testo (EN)" value={copy.inquiries_text_en} onChange={v => update('inquiries_text_en', v)} />
                    <FieldText label="Etichetta email (IT)" value={copy.inquiries_email_label_it} onChange={v => update('inquiries_email_label_it', v)} />
                    <FieldText label="Etichetta email (EN)" value={copy.inquiries_email_label_en} onChange={v => update('inquiries_email_label_en', v)} />
                </div>
                <FieldText label="Email contatto" value={copy.inquiries_email} onChange={v => update('inquiries_email', v)} />
            </section>

            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Sui Media — Articoli ({copy.articles.length})</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label='Heading sezione (IT) — es. "Sui Media"' value={copy.news_heading_it} onChange={v => update('news_heading_it', v)} />
                    <FieldText label="Heading sezione (EN)" value={copy.news_heading_en} onChange={v => update('news_heading_en', v)} />
                    <FieldText label='Etichetta "Leggi articolo" (IT)' value={copy.read_more_label_it} onChange={v => update('read_more_label_it', v)} />
                    <FieldText label="Etichetta (EN)" value={copy.read_more_label_en} onChange={v => update('read_more_label_en', v)} />
                </div>
                {copy.articles.map((a, i) => (
                    <div key={a.id} className="border border-black/10 rounded-xl p-3 bg-[#fafafa] space-y-2">
                        <div className="flex items-center gap-2">
                            <span className="text-[11px] font-semibold uppercase tracking-wide text-[#6e6e73] flex-1 truncate">{a.title || '(senza titolo)'}</span>
                            <button onClick={() => moveArt(i, -1)} disabled={i === 0} className="w-6 h-6 rounded-md text-[#6e6e73] hover:bg-black/5 disabled:opacity-30 flex items-center justify-center" title="Sposta su"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg></button>
                            <button onClick={() => moveArt(i, 1)} disabled={i === copy.articles.length - 1} className="w-6 h-6 rounded-md text-[#6e6e73] hover:bg-black/5 disabled:opacity-30 flex items-center justify-center" title="Sposta giù"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
                            <button onClick={() => removeArt(i)} className="w-6 h-6 rounded-md text-[#ff3b30] hover:bg-[#ff3b30]/10 flex items-center justify-center" title="Elimina"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                        </div>
                        <input type="text" value={a.title} onChange={e => updateArt(i, { title: e.target.value })} placeholder="Titolo articolo (lingua originale)" className="w-full bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px]" />
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            <input type="text" value={a.publication} onChange={e => updateArt(i, { publication: e.target.value })} placeholder="Testata (es. Casteddu Online)" className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px]" />
                            <input type="text" value={a.date} onChange={e => updateArt(i, { date: e.target.value })} placeholder="Data (es. 28 Maggio 2025)" className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px]" />
                        </div>
                        <input type="text" value={a.link} onChange={e => updateArt(i, { link: e.target.value })} placeholder="https://..." className="w-full bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px] font-mono" />
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            <textarea value={a.summary_it} onChange={e => updateArt(i, { summary_it: e.target.value })} placeholder="Sommario IT" rows={3} className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px] resize-y" />
                            <textarea value={a.summary_en} onChange={e => updateArt(i, { summary_en: e.target.value })} placeholder="Summary EN" rows={3} className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px] resize-y" />
                        </div>
                    </div>
                ))}
                <button onClick={addArt} className="w-full py-2.5 rounded-xl border-2 border-dashed border-black/15 text-[12px] font-medium text-[#1d1d1f] hover:bg-black/5 hover:border-blue-500/40 transition-colors flex items-center justify-center gap-2">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Aggiungi articolo
                </button>
            </section>

            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Comunicati Stampa (banda)</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Heading (IT)" value={copy.releases_heading_it} onChange={v => update('releases_heading_it', v)} />
                    <FieldText label="Heading (EN)" value={copy.releases_heading_en} onChange={v => update('releases_heading_en', v)} />
                    <FieldTextArea label="Testo (IT)" value={copy.releases_text_it} onChange={v => update('releases_text_it', v)} />
                    <FieldTextArea label="Testo (EN)" value={copy.releases_text_en} onChange={v => update('releases_text_en', v)} />
                </div>
            </section>
        </div>
    )
}

// ─── Contact editor ─────────────────────────────────────────────────────────
function ContactEditor({ copy, setCopy }: { copy: ContactCopy; setCopy: (next: ContactCopy) => void }) {
    const update = <K extends keyof ContactCopy>(key: K, value: ContactCopy[K]) => setCopy({ ...copy, [key]: value })
    const setHoursIt = (lines: string[]) => setCopy({ ...copy, hours_lines_it: lines })
    const setHoursEn = (lines: string[]) => setCopy({ ...copy, hours_lines_en: lines })

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-[20px] font-semibold tracking-tight text-[#1d1d1f]">Contatti</h2>
                <p className="text-[13px] text-[#6e6e73] mt-1">
                    Pagina <code className="text-[12px] bg-black/5 px-1.5 py-0.5 rounded">/contact</code>. Hero, 4 card (Telefono / WhatsApp / Email / Orari), info azienda, mappa.
                </p>
            </div>

            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Hero</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Titolo pagina (IT)" value={copy.page_title_it} onChange={v => update('page_title_it', v)} />
                    <FieldText label="Titolo pagina (EN)" value={copy.page_title_en} onChange={v => update('page_title_en', v)} />
                    <FieldTextArea label="Sottotitolo (IT)" value={copy.subtitle_it} onChange={v => update('subtitle_it', v)} />
                    <FieldTextArea label="Sottotitolo (EN)" value={copy.subtitle_en} onChange={v => update('subtitle_en', v)} />
                </div>
            </section>

            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Card: Telefono</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Etichetta (IT)" value={copy.phone_label_it} onChange={v => update('phone_label_it', v)} />
                    <FieldText label="Etichetta (EN)" value={copy.phone_label_en} onChange={v => update('phone_label_en', v)} />
                    <FieldText label="Numero visualizzato" value={copy.phone_display} onChange={v => update('phone_display', v)} />
                    <FieldText label='URL "tel:" (es. tel:+393457905205)' value={copy.phone_tel_url} onChange={v => update('phone_tel_url', v)} />
                </div>
            </section>

            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Card: WhatsApp</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Etichetta card (IT)" value={copy.whatsapp_label_it} onChange={v => update('whatsapp_label_it', v)} />
                    <FieldText label="Etichetta card (EN)" value={copy.whatsapp_label_en} onChange={v => update('whatsapp_label_en', v)} />
                    <FieldText label="Bottone (IT)" value={copy.whatsapp_button_it} onChange={v => update('whatsapp_button_it', v)} />
                    <FieldText label="Bottone (EN)" value={copy.whatsapp_button_en} onChange={v => update('whatsapp_button_en', v)} />
                </div>
                <FieldText label="URL WhatsApp" value={copy.whatsapp_url} onChange={v => update('whatsapp_url', v)} />
            </section>

            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Card: Email</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Etichetta (IT)" value={copy.email_label_it} onChange={v => update('email_label_it', v)} />
                    <FieldText label="Etichetta (EN)" value={copy.email_label_en} onChange={v => update('email_label_en', v)} />
                </div>
                <FieldText label="Indirizzo email" value={copy.email_address} onChange={v => update('email_address', v)} />
            </section>

            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Card: Orari</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Etichetta (IT)" value={copy.hours_label_it} onChange={v => update('hours_label_it', v)} />
                    <FieldText label="Etichetta (EN)" value={copy.hours_label_en} onChange={v => update('hours_label_en', v)} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldTextArea label="Righe IT (una per linea)" value={copy.hours_lines_it.join('\n')} onChange={v => setHoursIt(v.split('\n').filter(s => s.length > 0))} />
                    <FieldTextArea label="Lines EN (one per line)" value={copy.hours_lines_en.join('\n')} onChange={v => setHoursEn(v.split('\n').filter(s => s.length > 0))} />
                </div>
            </section>

            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Sede Operativa</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Heading (IT)" value={copy.office_heading_it} onChange={v => update('office_heading_it', v)} />
                    <FieldText label="Heading (EN)" value={copy.office_heading_en} onChange={v => update('office_heading_en', v)} />
                </div>
                <FieldText label="Ragione sociale" value={copy.office_company_name} onChange={v => update('office_company_name', v)} />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Indirizzo (IT)" value={copy.office_address_it} onChange={v => update('office_address_it', v)} />
                    <FieldText label="Address (EN)" value={copy.office_address_en} onChange={v => update('office_address_en', v)} />
                </div>
                <FieldText label="P.IVA / C.F." value={copy.office_piva} onChange={v => update('office_piva', v)} />
            </section>

            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Mappa</h3>
                <FieldText label="Title (accessibilità)" value={copy.map_title} onChange={v => update('map_title', v)} />
                <FieldText label="URL iframe (OpenStreetMap embed)" value={copy.map_iframe_url} onChange={v => update('map_iframe_url', v)} />
                {copy.map_iframe_url && (
                    <div className="rounded-xl overflow-hidden border border-black/10">
                        <iframe title={copy.map_title || 'preview'} src={copy.map_iframe_url} width="100%" height="200" style={{ border: 0 }} loading="lazy" />
                    </div>
                )}
            </section>
        </div>
    )
}

// ─── Mechanical Services editor (chrome only — catalog lives elsewhere) ───
function MechanicalEditor({ copy, setCopy }: { copy: MechanicalCopy; setCopy: (next: MechanicalCopy) => void }) {
    const update = <K extends keyof MechanicalCopy>(key: K, value: MechanicalCopy[K]) => setCopy({ ...copy, [key]: value })

    // How steps
    const updateStep = (idx: number, patch: Partial<MechanicalHowStep>) => {
        const next = [...copy.how_steps]
        next[idx] = { ...next[idx], ...patch }
        setCopy({ ...copy, how_steps: next })
    }
    const moveStep = (idx: number, dir: -1 | 1) => {
        const j = idx + dir
        if (j < 0 || j >= copy.how_steps.length) return
        const next = [...copy.how_steps]
        ;[next[idx], next[j]] = [next[j], next[idx]]
        setCopy({ ...copy, how_steps: next })
    }
    const removeStep = (idx: number) => {
        if (!confirm('Rimuovere questo step?')) return
        setCopy({ ...copy, how_steps: copy.how_steps.filter((_, i) => i !== idx) })
    }
    const addStep = () => {
        setCopy({
            ...copy,
            how_steps: [...copy.how_steps, { title_it: '', title_en: '', text_it: '', text_en: '' }],
        })
    }

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-[20px] font-semibold tracking-tight text-[#1d1d1f]">Servizi Meccanica</h2>
                <p className="text-[13px] text-[#6e6e73] mt-1">
                    Pagina <code className="text-[12px] bg-black/5 px-1.5 py-0.5 rounded">/mechanical-services</code> — chrome editabile (hero, "Come Funziona", orari, label bottoni).
                </p>
                <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-[12px] text-blue-700">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                    Il <b>catalogo servizi</b> (prezzi, nomi, categorie) si gestisce dal tab <b>Catalogo Prime Wash</b> con il filtro <b>MECCANICA</b>.
                </div>
            </div>

            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Hero</h3>
                <FieldText label='Titolo (es. "DR7 RAPID SERVICE")' value={copy.hero_title} onChange={v => update('hero_title', v)} />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Sottotitolo (IT)" value={copy.hero_subtitle_it} onChange={v => update('hero_subtitle_it', v)} />
                    <FieldText label="Sottotitolo (EN)" value={copy.hero_subtitle_en} onChange={v => update('hero_subtitle_en', v)} />
                    <FieldTextArea label="Riga intro (IT)" value={copy.hero_intro_it} onChange={v => update('hero_intro_it', v)} />
                    <FieldTextArea label="Riga intro (EN)" value={copy.hero_intro_en} onChange={v => update('hero_intro_en', v)} />
                </div>
            </section>

            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Etichette card servizi</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label='Bottone (IT) — es. "PRENOTA ORA"' value={copy.book_now_label_it} onChange={v => update('book_now_label_it', v)} />
                    <FieldText label="Bottone (EN)" value={copy.book_now_label_en} onChange={v => update('book_now_label_en', v)} />
                </div>
            </section>

            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">"Come Funziona" ({copy.how_steps.length} step)</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Heading (IT)" value={copy.how_heading_it} onChange={v => update('how_heading_it', v)} />
                    <FieldText label="Heading (EN)" value={copy.how_heading_en} onChange={v => update('how_heading_en', v)} />
                </div>
                {copy.how_steps.map((step, i) => (
                    <div key={i} className="border border-black/10 rounded-xl p-3 bg-[#fafafa] space-y-2">
                        <div className="flex items-center gap-2">
                            <span className="text-[11px] font-mono text-[#6e6e73]">Step {i + 1}</span>
                            <span className="text-[11px] text-[#6e6e73] flex-1 truncate">{step.title_it || '(senza titolo)'}</span>
                            <button onClick={() => moveStep(i, -1)} disabled={i === 0} className="w-6 h-6 rounded-md text-[#6e6e73] hover:bg-black/5 disabled:opacity-30 flex items-center justify-center" title="Sposta su"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg></button>
                            <button onClick={() => moveStep(i, 1)} disabled={i === copy.how_steps.length - 1} className="w-6 h-6 rounded-md text-[#6e6e73] hover:bg-black/5 disabled:opacity-30 flex items-center justify-center" title="Sposta giù"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
                            <button onClick={() => removeStep(i)} className="w-6 h-6 rounded-md text-[#ff3b30] hover:bg-[#ff3b30]/10 flex items-center justify-center" title="Elimina"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            <input type="text" value={step.title_it} onChange={e => updateStep(i, { title_it: e.target.value })} placeholder='Titolo IT (es. "1. Prenota Online")' className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px]" />
                            <input type="text" value={step.title_en} onChange={e => updateStep(i, { title_en: e.target.value })} placeholder="Title EN" className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px]" />
                            <textarea value={step.text_it} onChange={e => updateStep(i, { text_it: e.target.value })} placeholder="Testo IT" rows={2} className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px] resize-y" />
                            <textarea value={step.text_en} onChange={e => updateStep(i, { text_en: e.target.value })} placeholder="Text EN" rows={2} className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px] resize-y" />
                        </div>
                    </div>
                ))}
                <button onClick={addStep} className="w-full py-2.5 rounded-xl border-2 border-dashed border-black/15 text-[12px] font-medium text-[#1d1d1f] hover:bg-black/5 hover:border-blue-500/40 transition-colors flex items-center justify-center gap-2">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Aggiungi step
                </button>
            </section>

            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Orari di Apertura</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Heading (IT)" value={copy.hours_heading_it} onChange={v => update('hours_heading_it', v)} />
                    <FieldText label="Heading (EN)" value={copy.hours_heading_en} onChange={v => update('hours_heading_en', v)} />
                    <FieldText label="Riga principale (IT)" value={copy.hours_main_it} onChange={v => update('hours_main_it', v)} />
                    <FieldText label="Riga principale (EN)" value={copy.hours_main_en} onChange={v => update('hours_main_en', v)} />
                    <FieldText label="Sotto-riga (IT)" value={copy.hours_sub_it} onChange={v => update('hours_sub_it', v)} />
                    <FieldText label="Sotto-riga (EN)" value={copy.hours_sub_en} onChange={v => update('hours_sub_en', v)} />
                </div>
            </section>
        </div>
    )
}

// MechanicalServiceCard removed: catalogo meccanica vive in tab "Catalogo
// Prime Wash" (filtro MECCANICA), non in Sito CMS.

// ─── Car Wash editor (chrome only — catalog lives in Catalogo Prime Wash) ──
function CarWashEditor({ copy, setCopy }: { copy: CarWashCopy; setCopy: (next: CarWashCopy) => void }) {
    const update = <K extends keyof CarWashCopy>(key: K, value: CarWashCopy[K]) => setCopy({ ...copy, [key]: value })
    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-[20px] font-semibold tracking-tight text-[#1d1d1f]">Servizi Lavaggio</h2>
                <p className="text-[13px] text-[#6e6e73] mt-1">
                    Pagina <code className="text-[12px] bg-black/5 px-1.5 py-0.5 rounded">/car-wash-services</code> — etichette UI editabili.
                </p>
                <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-[12px] text-blue-700">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                    Il <b>catalogo lavaggi</b> (servizi, prezzi, immagini) si gestisce dal tab <b>Catalogo Prime Wash</b> con il filtro <b>LAVAGGIO</b>.
                </div>
            </div>

            {/* Plate entry */}
            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Inserimento targa (sezione iniziale)</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Etichetta input (IT)" value={copy.plate_label_it} onChange={v => update('plate_label_it', v)} />
                    <FieldText label="Etichetta input (EN)" value={copy.plate_label_en} onChange={v => update('plate_label_en', v)} />
                    <FieldTextArea label="Testo helper (IT)" value={copy.plate_helper_it} onChange={v => update('plate_helper_it', v)} />
                    <FieldTextArea label="Testo helper (EN)" value={copy.plate_helper_en} onChange={v => update('plate_helper_en', v)} />
                    <FieldText label="Placeholder (IT)" value={copy.plate_placeholder_it} onChange={v => update('plate_placeholder_it', v)} />
                    <FieldText label="Placeholder (EN)" value={copy.plate_placeholder_en} onChange={v => update('plate_placeholder_en', v)} />
                    <FieldText label='Bottone Cerca (IT)' value={copy.plate_search_it} onChange={v => update('plate_search_it', v)} />
                    <FieldText label="Search button (EN)" value={copy.plate_search_en} onChange={v => update('plate_search_en', v)} />
                    <FieldText label='Stato "Cercando..." (IT)' value={copy.plate_searching_it} onChange={v => update('plate_searching_it', v)} />
                    <FieldText label='State "Searching..." (EN)' value={copy.plate_searching_en} onChange={v => update('plate_searching_en', v)} />
                    <FieldTextArea label="Prompt categoria manuale (IT)" value={copy.plate_manual_prompt_it} onChange={v => update('plate_manual_prompt_it', v)} />
                    <FieldTextArea label="Manual category prompt (EN)" value={copy.plate_manual_prompt_en} onChange={v => update('plate_manual_prompt_en', v)} />
                    <FieldText label='"Cambia veicolo" (IT)' value={copy.plate_change_it} onChange={v => update('plate_change_it', v)} />
                    <FieldText label='"Change vehicle" (EN)' value={copy.plate_change_en} onChange={v => update('plate_change_en', v)} />
                </div>
            </section>

            {/* Card servizio */}
            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Card servizio</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label='Bottone "AGGIUNGI AL CARRELLO" (IT)' value={copy.add_to_cart_it} onChange={v => update('add_to_cart_it', v)} />
                    <FieldText label='Button "ADD TO CART" (EN)' value={copy.add_to_cart_en} onChange={v => update('add_to_cart_en', v)} />
                </div>
            </section>

            {/* Cart drawer */}
            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Drawer carrello</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Titolo carrello (IT)" value={copy.cart_title_it} onChange={v => update('cart_title_it', v)} />
                    <FieldText label="Cart title (EN)" value={copy.cart_title_en} onChange={v => update('cart_title_en', v)} />
                    <FieldText label='Stato vuoto (IT)' value={copy.cart_empty_it} onChange={v => update('cart_empty_it', v)} />
                    <FieldText label='Empty state (EN)' value={copy.cart_empty_en} onChange={v => update('cart_empty_en', v)} />
                    <FieldText label='"Rimuovi" link (IT)' value={copy.cart_remove_it} onChange={v => update('cart_remove_it', v)} />
                    <FieldText label='"Remove" link (EN)' value={copy.cart_remove_en} onChange={v => update('cart_remove_en', v)} />
                    <FieldText label='Etichetta "Totale" (IT)' value={copy.cart_total_it} onChange={v => update('cart_total_it', v)} />
                    <FieldText label='Label "Total" (EN)' value={copy.cart_total_en} onChange={v => update('cart_total_en', v)} />
                    <FieldText label='Bottone "PROCEDI" (IT)' value={copy.cart_checkout_it} onChange={v => update('cart_checkout_it', v)} />
                    <FieldText label='Button "CHECKOUT" (EN)' value={copy.cart_checkout_en} onChange={v => update('cart_checkout_en', v)} />
                </div>
            </section>

            {/* Upsell overlay */}
            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Overlay Extra Care (upsell)</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label='Bottone "Rivedi carrello" (IT)' value={copy.upsell_review_cart_it} onChange={v => update('upsell_review_cart_it', v)} />
                    <FieldText label='Button "Review Cart" (EN)' value={copy.upsell_review_cart_en} onChange={v => update('upsell_review_cart_en', v)} />
                    <FieldText label="Step 1 — Titolo (IT)" value={copy.upsell_step1_title_it} onChange={v => update('upsell_step1_title_it', v)} />
                    <FieldText label="Step 1 — Title (EN)" value={copy.upsell_step1_title_en} onChange={v => update('upsell_step1_title_en', v)} />
                    <FieldTextArea label="Step 1 — Testo (IT)" value={copy.upsell_step1_text_it} onChange={v => update('upsell_step1_text_it', v)} />
                    <FieldTextArea label="Step 1 — Text (EN)" value={copy.upsell_step1_text_en} onChange={v => update('upsell_step1_text_en', v)} />
                    <FieldText label="Step 2 — Titolo (IT)" value={copy.upsell_step2_title_it} onChange={v => update('upsell_step2_title_it', v)} />
                    <FieldText label="Step 2 — Title (EN)" value={copy.upsell_step2_title_en} onChange={v => update('upsell_step2_title_en', v)} />
                    <FieldTextArea label="Step 2 — Testo (IT)" value={copy.upsell_step2_text_it} onChange={v => update('upsell_step2_text_it', v)} />
                    <FieldTextArea label="Step 2 — Text (EN)" value={copy.upsell_step2_text_en} onChange={v => update('upsell_step2_text_en', v)} />
                    <FieldText label='Stato "Aggiunto ✓" (IT)' value={copy.upsell_added_it} onChange={v => update('upsell_added_it', v)} />
                    <FieldText label='State "Added ✓" (EN)' value={copy.upsell_added_en} onChange={v => update('upsell_added_en', v)} />
                    <FieldText label='Bottone "Aggiungi" (IT)' value={copy.upsell_add_it} onChange={v => update('upsell_add_it', v)} />
                    <FieldText label='Button "Add" (EN)' value={copy.upsell_add_en} onChange={v => update('upsell_add_en', v)} />
                </div>
            </section>
        </div>
    )
}

// ─── Investitori editor (IT-only sales page) ───────────────────────────────
function InvestitoriEditor({ copy, setCopy }: { copy: InvestitoriCopy; setCopy: (next: InvestitoriCopy) => void }) {
    const update = <K extends keyof InvestitoriCopy>(key: K, value: InvestitoriCopy[K]) => setCopy({ ...copy, [key]: value })
    const updateParagraphList = (key: 'intro_paragraphs' | 'opportunity_paragraphs' | 'cta_paragraphs' | 'legal_paragraphs', value: string) => {
        setCopy({ ...copy, [key]: value.split('\n\n').filter(s => s.trim().length > 0) })
    }
    // strength_points
    const updateStrength = (idx: number, patch: Partial<InvestitoriStrength>) => {
        const next = [...copy.strength_points]
        next[idx] = { ...next[idx], ...patch }
        setCopy({ ...copy, strength_points: next })
    }
    const moveStrength = (idx: number, dir: -1 | 1) => {
        const j = idx + dir
        if (j < 0 || j >= copy.strength_points.length) return
        const next = [...copy.strength_points]
        ;[next[idx], next[j]] = [next[j], next[idx]]
        setCopy({ ...copy, strength_points: next })
    }
    const removeStrength = (idx: number) => {
        if (!confirm('Rimuovere questo punto di forza?')) return
        setCopy({ ...copy, strength_points: copy.strength_points.filter((_, i) => i !== idx) })
    }
    const addStrength = () => {
        setCopy({ ...copy, strength_points: [...copy.strength_points, { id: `s-${Date.now().toString(36)}`, title: '', description: '' }] })
    }
    // info_items
    const updateInfo = (idx: number, patch: Partial<InvestitoriInfoItem>) => {
        const next = [...copy.info_items]
        next[idx] = { ...next[idx], ...patch }
        setCopy({ ...copy, info_items: next })
    }
    const moveInfo = (idx: number, dir: -1 | 1) => {
        const j = idx + dir
        if (j < 0 || j >= copy.info_items.length) return
        const next = [...copy.info_items]
        ;[next[idx], next[j]] = [next[j], next[idx]]
        setCopy({ ...copy, info_items: next })
    }
    const removeInfo = (idx: number) => {
        if (!confirm('Rimuovere questa riga informativa?')) return
        setCopy({ ...copy, info_items: copy.info_items.filter((_, i) => i !== idx) })
    }
    const addInfo = () => {
        setCopy({ ...copy, info_items: [...copy.info_items, { label: '', value: '' }] })
    }

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-[20px] font-semibold tracking-tight text-[#1d1d1f]">Investitori</h2>
                <p className="text-[13px] text-[#6e6e73] mt-1">
                    Pagina <code className="text-[12px] bg-black/5 px-1.5 py-0.5 rounded">/investitori</code> — pagina IT-only (no traduzioni EN). I paragrafi multipli si separano con <b>riga vuota</b> (doppio invio).
                </p>
            </div>

            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Hero</h3>
                <FieldText label="Titolo" value={copy.hero_title} onChange={v => update('hero_title', v)} />
                <FieldText label="Sottotitolo" value={copy.hero_subtitle} onChange={v => update('hero_subtitle', v)} />
            </section>

            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Introduzione</h3>
                <FieldTextArea label="Paragrafi (separati da riga vuota)" value={copy.intro_paragraphs.join('\n\n')} onChange={v => updateParagraphList('intro_paragraphs', v)} />
            </section>

            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Opportunità di partecipazione</h3>
                <FieldText label="Heading" value={copy.opportunity_heading} onChange={v => update('opportunity_heading', v)} />
                <FieldTextArea label="Paragrafi (separati da riga vuota)" value={copy.opportunity_paragraphs.join('\n\n')} onChange={v => updateParagraphList('opportunity_paragraphs', v)} />
            </section>

            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Punti di forza ({copy.strength_points.length})</h3>
                <FieldText label="Heading" value={copy.strength_heading} onChange={v => update('strength_heading', v)} />
                {copy.strength_points.map((s, i) => (
                    <div key={s.id} className="border border-black/10 rounded-xl p-3 bg-[#fafafa] space-y-2">
                        <div className="flex items-center gap-2">
                            <span className="text-[11px] font-semibold uppercase tracking-wide text-[#6e6e73] flex-1 truncate">{s.title || '(senza titolo)'}</span>
                            <button onClick={() => moveStrength(i, -1)} disabled={i === 0} className="w-6 h-6 rounded-md text-[#6e6e73] hover:bg-black/5 disabled:opacity-30 flex items-center justify-center" title="Sposta su"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg></button>
                            <button onClick={() => moveStrength(i, 1)} disabled={i === copy.strength_points.length - 1} className="w-6 h-6 rounded-md text-[#6e6e73] hover:bg-black/5 disabled:opacity-30 flex items-center justify-center" title="Sposta giù"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
                            <button onClick={() => removeStrength(i)} className="w-6 h-6 rounded-md text-[#ff3b30] hover:bg-[#ff3b30]/10 flex items-center justify-center" title="Elimina"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                        </div>
                        <input type="text" value={s.title} onChange={e => updateStrength(i, { title: e.target.value })} placeholder="Titolo punto di forza" className="w-full bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px] font-semibold" />
                        <textarea value={s.description} onChange={e => updateStrength(i, { description: e.target.value })} placeholder="Descrizione" rows={2} className="w-full bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px] resize-y" />
                    </div>
                ))}
                <button onClick={addStrength} className="w-full py-2.5 rounded-xl border-2 border-dashed border-black/15 text-[12px] font-medium text-[#1d1d1f] hover:bg-black/5 hover:border-blue-500/40 transition-colors flex items-center justify-center gap-2">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Aggiungi punto di forza
                </button>
            </section>

            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">CTA — Modalità di adesione</h3>
                <FieldText label="Heading" value={copy.cta_heading} onChange={v => update('cta_heading', v)} />
                <FieldTextArea label="Paragrafi (separati da riga vuota)" value={copy.cta_paragraphs.join('\n\n')} onChange={v => updateParagraphList('cta_paragraphs', v)} />
                <FieldText label="Etichetta bottone primario" value={copy.cta_button_label} onChange={v => update('cta_button_label', v)} />
                <FieldText label="URL WhatsApp (con testo precompilato)" value={copy.cta_whatsapp_url} onChange={v => update('cta_whatsapp_url', v)} />
                <FieldText label="Email investitori (bottone secondario)" value={copy.cta_email} onChange={v => update('cta_email', v)} />
            </section>

            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Informazioni sintetiche ({copy.info_items.length})</h3>
                <FieldText label="Heading" value={copy.info_heading} onChange={v => update('info_heading', v)} />
                {copy.info_items.map((it, i) => (
                    <div key={i} className="border border-black/10 rounded-xl p-3 bg-[#fafafa] grid grid-cols-1 md:grid-cols-[200px_1fr_auto] gap-2 items-center">
                        <input type="text" value={it.label} onChange={e => updateInfo(i, { label: e.target.value })} placeholder="Etichetta (es. Denominazione)" className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px]" />
                        <input type="text" value={it.value} onChange={e => updateInfo(i, { value: e.target.value })} placeholder="Valore" className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px]" />
                        <div className="flex items-center gap-1">
                            <button onClick={() => moveInfo(i, -1)} disabled={i === 0} className="w-6 h-6 rounded-md text-[#6e6e73] hover:bg-black/5 disabled:opacity-30 flex items-center justify-center" title="Sposta su"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg></button>
                            <button onClick={() => moveInfo(i, 1)} disabled={i === copy.info_items.length - 1} className="w-6 h-6 rounded-md text-[#6e6e73] hover:bg-black/5 disabled:opacity-30 flex items-center justify-center" title="Sposta giù"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
                            <button onClick={() => removeInfo(i)} className="w-6 h-6 rounded-md text-[#ff3b30] hover:bg-[#ff3b30]/10 flex items-center justify-center" title="Elimina"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                        </div>
                    </div>
                ))}
                <button onClick={addInfo} className="w-full py-2.5 rounded-xl border-2 border-dashed border-black/15 text-[12px] font-medium text-[#1d1d1f] hover:bg-black/5 hover:border-blue-500/40 transition-colors flex items-center justify-center gap-2">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Aggiungi riga
                </button>
                <FieldTextArea label="Footnote sotto la tabella (corsivo)" value={copy.info_footnote} onChange={v => update('info_footnote', v)} />
            </section>

            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Avvertenza legale (banda rossa)</h3>
                <FieldText label="Heading" value={copy.legal_heading} onChange={v => update('legal_heading', v)} />
                <FieldTextArea label="Paragrafi (separati da riga vuota)" value={copy.legal_paragraphs.join('\n\n')} onChange={v => updateParagraphList('legal_paragraphs', v)} />
            </section>
        </div>
    )
}

// ─── Franchising editor (IT-only sales page) ───────────────────────────────
const FRANCHISING_EXPANSION_ICONS: FranchisingExpansionIcon[] = ['square', 'diamond', 'lines']
const FRANCHISING_BENEFIT_ICONS: FranchisingBenefitIcon[] = ['check', 'shield', 'star']

function FranchisingEditor({ copy, setCopy }: { copy: FranchisingCopy; setCopy: (next: FranchisingCopy) => void }) {
    const update = <K extends keyof FranchisingCopy>(key: K, value: FranchisingCopy[K]) => setCopy({ ...copy, [key]: value })
    // List helpers
    const setStringList = (key: 'stats_lines' | 'about_paragraphs', v: string) => {
        const lines = key === 'stats_lines' ? v.split('\n').filter(s => s.length > 0) : v.split('\n\n').filter(s => s.trim().length > 0)
        setCopy({ ...copy, [key]: lines })
    }
    // Expansion locations
    const updateLoc = (idx: number, patch: Partial<FranchisingExpansionLocation>) => {
        const next = [...copy.expansion_locations]
        next[idx] = { ...next[idx], ...patch }
        setCopy({ ...copy, expansion_locations: next })
    }
    const moveLoc = (idx: number, dir: -1 | 1) => {
        const j = idx + dir
        if (j < 0 || j >= copy.expansion_locations.length) return
        const next = [...copy.expansion_locations]
        ;[next[idx], next[j]] = [next[j], next[idx]]
        setCopy({ ...copy, expansion_locations: next })
    }
    const removeLoc = (idx: number) => {
        if (!confirm('Rimuovere questa sede?')) return
        setCopy({ ...copy, expansion_locations: copy.expansion_locations.filter((_, i) => i !== idx) })
    }
    const addLoc = () => {
        setCopy({ ...copy, expansion_locations: [...copy.expansion_locations, { id: `loc-${Date.now().toString(36)}`, icon: 'square', name: '', description: '' }] })
    }
    // Benefits
    const updateBenefit = (idx: number, patch: Partial<FranchisingBenefit>) => {
        const next = [...copy.benefits]
        next[idx] = { ...next[idx], ...patch }
        setCopy({ ...copy, benefits: next })
    }
    const moveBenefit = (idx: number, dir: -1 | 1) => {
        const j = idx + dir
        if (j < 0 || j >= copy.benefits.length) return
        const next = [...copy.benefits]
        ;[next[idx], next[j]] = [next[j], next[idx]]
        setCopy({ ...copy, benefits: next })
    }
    const removeBenefit = (idx: number) => {
        if (!confirm('Rimuovere questo benefit?')) return
        setCopy({ ...copy, benefits: copy.benefits.filter((_, i) => i !== idx) })
    }
    const addBenefit = () => {
        setCopy({ ...copy, benefits: [...copy.benefits, { id: `b-${Date.now().toString(36)}`, icon: 'check', title: '', description: '' }] })
    }

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-[20px] font-semibold tracking-tight text-[#1d1d1f]">Franchising</h2>
                <p className="text-[13px] text-[#6e6e73] mt-1">
                    Pagina <code className="text-[12px] bg-black/5 px-1.5 py-0.5 rounded">/franchising</code> — pagina IT-only. Placeholder <code>{'{reviewCount}'}</code> nelle stats viene risolto a runtime con il conteggio Google Reviews live.
                </p>
            </div>

            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Hero</h3>
                <FieldText label="Titolo (h2)" value={copy.hero_h2} onChange={v => update('hero_h2', v)} />
                <FieldText label="Sottotitolo principale" value={copy.hero_p1} onChange={v => update('hero_p1', v)} />
                <FieldTextArea label="Sottotitolo secondario (newline = a-capo)" value={copy.hero_p2} onChange={v => update('hero_p2', v)} />
            </section>

            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Stats — In soli X mesi</h3>
                <FieldText label="Heading" value={copy.stats_heading} onChange={v => update('stats_heading', v)} />
                <FieldTextArea label='Righe stats (una per linea — usa "* xxx" per il pallino. Placeholder {reviewCount})' value={copy.stats_lines.join('\n')} onChange={v => setStringList('stats_lines', v)} />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Footer principale" value={copy.stats_footer_main} onChange={v => update('stats_footer_main', v)} />
                    <FieldText label="Footer sotto-riga" value={copy.stats_footer_sub} onChange={v => update('stats_footer_sub', v)} />
                </div>
            </section>

            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Piano di Espansione ({copy.expansion_locations.length})</h3>
                <FieldText label="Heading" value={copy.expansion_heading} onChange={v => update('expansion_heading', v)} />
                {copy.expansion_locations.map((loc, i) => (
                    <div key={loc.id} className="border border-black/10 rounded-xl p-3 bg-[#fafafa] grid grid-cols-1 md:grid-cols-[120px_1fr_1fr_auto] gap-2 items-center">
                        <select value={loc.icon} onChange={e => updateLoc(i, { icon: e.target.value as FranchisingExpansionIcon })} className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px]">
                            {FRANCHISING_EXPANSION_ICONS.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                        <input type="text" value={loc.name} onChange={e => updateLoc(i, { name: e.target.value })} placeholder="Nome (es. Cagliari)" className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px]" />
                        <input type="text" value={loc.description} onChange={e => updateLoc(i, { description: e.target.value })} placeholder='Descrizione (es. "Sede Principale")' className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px]" />
                        <div className="flex items-center gap-1">
                            <button onClick={() => moveLoc(i, -1)} disabled={i === 0} className="w-6 h-6 rounded-md text-[#6e6e73] hover:bg-black/5 disabled:opacity-30 flex items-center justify-center" title="Sposta su"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg></button>
                            <button onClick={() => moveLoc(i, 1)} disabled={i === copy.expansion_locations.length - 1} className="w-6 h-6 rounded-md text-[#6e6e73] hover:bg-black/5 disabled:opacity-30 flex items-center justify-center" title="Sposta giù"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
                            <button onClick={() => removeLoc(i)} className="w-6 h-6 rounded-md text-[#ff3b30] hover:bg-[#ff3b30]/10 flex items-center justify-center" title="Elimina"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                        </div>
                    </div>
                ))}
                <button onClick={addLoc} className="w-full py-2.5 rounded-xl border-2 border-dashed border-black/15 text-[12px] font-medium text-[#1d1d1f] hover:bg-black/5 hover:border-blue-500/40 transition-colors flex items-center justify-center gap-2">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Aggiungi sede
                </button>
            </section>

            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">L'Impero DR7 (about)</h3>
                <FieldText label="Heading" value={copy.about_heading} onChange={v => update('about_heading', v)} />
                <FieldTextArea label="Paragrafi (separati da riga vuota)" value={copy.about_paragraphs.join('\n\n')} onChange={v => setStringList('about_paragraphs', v)} />
            </section>

            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Benefits ({copy.benefits.length})</h3>
                {copy.benefits.map((b, i) => (
                    <div key={b.id} className="border border-black/10 rounded-xl p-3 bg-[#fafafa] space-y-2">
                        <div className="flex items-center gap-2">
                            <select value={b.icon} onChange={e => updateBenefit(i, { icon: e.target.value as FranchisingBenefitIcon })} className="bg-white border border-black/10 rounded-md px-2 py-1.5 text-[12px]">
                                {FRANCHISING_BENEFIT_ICONS.map(o => <option key={o} value={o}>{o}</option>)}
                            </select>
                            <span className="text-[11px] font-semibold uppercase tracking-wide text-[#6e6e73] flex-1 truncate">{b.title || '(senza titolo)'}</span>
                            <button onClick={() => moveBenefit(i, -1)} disabled={i === 0} className="w-6 h-6 rounded-md text-[#6e6e73] hover:bg-black/5 disabled:opacity-30 flex items-center justify-center" title="Sposta su"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg></button>
                            <button onClick={() => moveBenefit(i, 1)} disabled={i === copy.benefits.length - 1} className="w-6 h-6 rounded-md text-[#6e6e73] hover:bg-black/5 disabled:opacity-30 flex items-center justify-center" title="Sposta giù"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
                            <button onClick={() => removeBenefit(i)} className="w-6 h-6 rounded-md text-[#ff3b30] hover:bg-[#ff3b30]/10 flex items-center justify-center" title="Elimina"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                        </div>
                        <input type="text" value={b.title} onChange={e => updateBenefit(i, { title: e.target.value })} placeholder="Titolo benefit" className="w-full bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px] font-semibold" />
                        <textarea value={b.description} onChange={e => updateBenefit(i, { description: e.target.value })} placeholder="Descrizione" rows={2} className="w-full bg-white border border-black/10 rounded-md px-2 py-1.5 text-[13px] resize-y" />
                    </div>
                ))}
                <button onClick={addBenefit} className="w-full py-2.5 rounded-xl border-2 border-dashed border-black/15 text-[12px] font-medium text-[#1d1d1f] hover:bg-black/5 hover:border-blue-500/40 transition-colors flex items-center justify-center gap-2">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Aggiungi benefit
                </button>
            </section>

            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Call to Action</h3>
                <FieldText label="Heading" value={copy.cta_heading} onChange={v => update('cta_heading', v)} />
                <FieldText label="Intro" value={copy.cta_intro} onChange={v => update('cta_intro', v)} />
                <FieldText label="Box riga principale" value={copy.cta_box_main} onChange={v => update('cta_box_main', v)} />
                <FieldText label="Box riga secondaria" value={copy.cta_box_sub} onChange={v => update('cta_box_sub', v)} />
            </section>

            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Contatti</h3>
                <FieldText label="Heading" value={copy.contact_heading} onChange={v => update('contact_heading', v)} />
                <FieldText label="Intro" value={copy.contact_intro} onChange={v => update('contact_intro', v)} />
                <FieldText label="Email candidature" value={copy.contact_email} onChange={v => update('contact_email', v)} />
            </section>

            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Footer statement</h3>
                <FieldTextArea label="Statement (newline = a-capo)" value={copy.footer_statement} onChange={v => update('footer_statement', v)} />
            </section>
        </div>
    )
}

// ─── Aviation Quote editor (bilingual) ─────────────────────────────────────
function AviationQuoteEditor({ copy, setCopy }: { copy: AviationQuoteCopy; setCopy: (next: AviationQuoteCopy) => void }) {
    const update = <K extends keyof AviationQuoteCopy>(key: K, value: AviationQuoteCopy[K]) => setCopy({ ...copy, [key]: value })
    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-[20px] font-semibold tracking-tight text-[#1d1d1f]">Aviation Quote</h2>
                <p className="text-[13px] text-[#6e6e73] mt-1">
                    Pagine <code className="text-[12px] bg-black/5 px-1.5 py-0.5 rounded">/aviation-quote-request</code> + <code className="text-[12px] bg-black/5 px-1.5 py-0.5 rounded">/helicopter-quote-request</code>. Token <code>{'{service}'}</code> nel titolo si risolve a "Jet Privato" o "Elicottero" in base alla pagina. Il template WhatsApp supporta i placeholder: <code>{'{service}'}</code>, <code>{'{nome}'}</code>, <code>{'{email}'}</code>, <code>{'{telefono}'}</code>, <code>{'{partenza}'}</code>, <code>{'{arrivo}'}</code>, <code>{'{data_partenza}'}</code>, <code>{'{data_ritorno}'}</code>, <code>{'{passeggeri}'}</code>, <code>{'{note}'}</code>.
                </p>
            </div>

            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Etichette servizio (per token {'{service}'})</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Label Jet Privato" value={copy.service_label_jet} onChange={v => update('service_label_jet', v)} />
                    <FieldText label="Label Elicottero" value={copy.service_label_helicopter} onChange={v => update('service_label_helicopter', v)} />
                </div>
            </section>

            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Loading + Auth gate</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Loading (IT)" value={copy.loading_it} onChange={v => update('loading_it', v)} />
                    <FieldText label="Loading (EN)" value={copy.loading_en} onChange={v => update('loading_en', v)} />
                    <FieldText label="Auth title (IT)" value={copy.auth_title_it} onChange={v => update('auth_title_it', v)} />
                    <FieldText label="Auth title (EN)" value={copy.auth_title_en} onChange={v => update('auth_title_en', v)} />
                    <FieldTextArea label="Auth body (IT)" value={copy.auth_body_it} onChange={v => update('auth_body_it', v)} />
                    <FieldTextArea label="Auth body (EN)" value={copy.auth_body_en} onChange={v => update('auth_body_en', v)} />
                    <FieldText label="Login button (IT)" value={copy.auth_login_cta_it} onChange={v => update('auth_login_cta_it', v)} />
                    <FieldText label="Login button (EN)" value={copy.auth_login_cta_en} onChange={v => update('auth_login_cta_en', v)} />
                    <FieldText label="Sign Up button (IT)" value={copy.auth_signup_cta_it} onChange={v => update('auth_signup_cta_it', v)} />
                    <FieldText label="Sign Up button (EN)" value={copy.auth_signup_cta_en} onChange={v => update('auth_signup_cta_en', v)} />
                </div>
            </section>

            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Header pagina</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Titolo template (IT) — usa {service}" value={copy.header_title_template_it} onChange={v => update('header_title_template_it', v)} />
                    <FieldText label="Title template (EN) — uses {service}" value={copy.header_title_template_en} onChange={v => update('header_title_template_en', v)} />
                    <FieldTextArea label="Sottotitolo (IT)" value={copy.header_subtitle_it} onChange={v => update('header_subtitle_it', v)} />
                    <FieldTextArea label="Subtitle (EN)" value={copy.header_subtitle_en} onChange={v => update('header_subtitle_en', v)} />
                </div>
            </section>

            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Sezioni form</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Heading Customer (IT)" value={copy.section_customer_it} onChange={v => update('section_customer_it', v)} />
                    <FieldText label="Heading Customer (EN)" value={copy.section_customer_en} onChange={v => update('section_customer_en', v)} />
                    <FieldText label="Heading Flight (IT)" value={copy.section_flight_it} onChange={v => update('section_flight_it', v)} />
                    <FieldText label="Heading Flight (EN)" value={copy.section_flight_en} onChange={v => update('section_flight_en', v)} />
                </div>
            </section>

            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Campi form (label + placeholder)</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Nome label (IT)" value={copy.field_name_label_it} onChange={v => update('field_name_label_it', v)} />
                    <FieldText label="Name label (EN)" value={copy.field_name_label_en} onChange={v => update('field_name_label_en', v)} />
                    <FieldText label="Nome placeholder (IT)" value={copy.field_name_placeholder_it} onChange={v => update('field_name_placeholder_it', v)} />
                    <FieldText label="Name placeholder (EN)" value={copy.field_name_placeholder_en} onChange={v => update('field_name_placeholder_en', v)} />
                    <FieldText label="Email label (IT)" value={copy.field_email_label_it} onChange={v => update('field_email_label_it', v)} />
                    <FieldText label="Email label (EN)" value={copy.field_email_label_en} onChange={v => update('field_email_label_en', v)} />
                    <FieldText label="Email placeholder (IT)" value={copy.field_email_placeholder_it} onChange={v => update('field_email_placeholder_it', v)} />
                    <FieldText label="Email placeholder (EN)" value={copy.field_email_placeholder_en} onChange={v => update('field_email_placeholder_en', v)} />
                    <FieldText label="Telefono label (IT)" value={copy.field_phone_label_it} onChange={v => update('field_phone_label_it', v)} />
                    <FieldText label="Phone label (EN)" value={copy.field_phone_label_en} onChange={v => update('field_phone_label_en', v)} />
                    <FieldText label="Telefono placeholder (IT)" value={copy.field_phone_placeholder_it} onChange={v => update('field_phone_placeholder_it', v)} />
                    <FieldText label="Phone placeholder (EN)" value={copy.field_phone_placeholder_en} onChange={v => update('field_phone_placeholder_en', v)} />
                    <FieldText label="Partenza label (IT)" value={copy.field_departure_label_it} onChange={v => update('field_departure_label_it', v)} />
                    <FieldText label="Departure label (EN)" value={copy.field_departure_label_en} onChange={v => update('field_departure_label_en', v)} />
                    <FieldText label="Partenza placeholder (IT)" value={copy.field_departure_placeholder_it} onChange={v => update('field_departure_placeholder_it', v)} />
                    <FieldText label="Departure placeholder (EN)" value={copy.field_departure_placeholder_en} onChange={v => update('field_departure_placeholder_en', v)} />
                    <FieldText label="Arrivo label (IT)" value={copy.field_arrival_label_it} onChange={v => update('field_arrival_label_it', v)} />
                    <FieldText label="Arrival label (EN)" value={copy.field_arrival_label_en} onChange={v => update('field_arrival_label_en', v)} />
                    <FieldText label="Arrivo placeholder (IT)" value={copy.field_arrival_placeholder_it} onChange={v => update('field_arrival_placeholder_it', v)} />
                    <FieldText label="Arrival placeholder (EN)" value={copy.field_arrival_placeholder_en} onChange={v => update('field_arrival_placeholder_en', v)} />
                    <FieldText label="Data Partenza label (IT)" value={copy.field_departure_date_label_it} onChange={v => update('field_departure_date_label_it', v)} />
                    <FieldText label="Departure date (EN)" value={copy.field_departure_date_label_en} onChange={v => update('field_departure_date_label_en', v)} />
                    <FieldText label="Data Ritorno label (IT)" value={copy.field_return_date_label_it} onChange={v => update('field_return_date_label_it', v)} />
                    <FieldText label="Return date (EN)" value={copy.field_return_date_label_en} onChange={v => update('field_return_date_label_en', v)} />
                    <FieldText label="Passeggeri label (IT)" value={copy.field_passengers_label_it} onChange={v => update('field_passengers_label_it', v)} />
                    <FieldText label="Passengers label (EN)" value={copy.field_passengers_label_en} onChange={v => update('field_passengers_label_en', v)} />
                    <FieldText label="Note label (IT)" value={copy.field_notes_label_it} onChange={v => update('field_notes_label_it', v)} />
                    <FieldText label="Notes label (EN)" value={copy.field_notes_label_en} onChange={v => update('field_notes_label_en', v)} />
                    <FieldText label="Note placeholder (IT)" value={copy.field_notes_placeholder_it} onChange={v => update('field_notes_placeholder_it', v)} />
                    <FieldText label="Notes placeholder (EN)" value={copy.field_notes_placeholder_en} onChange={v => update('field_notes_placeholder_en', v)} />
                </div>
            </section>

            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Submit + alerts</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Bottone submit (IT)" value={copy.submit_idle_it} onChange={v => update('submit_idle_it', v)} />
                    <FieldText label="Submit button (EN)" value={copy.submit_idle_en} onChange={v => update('submit_idle_en', v)} />
                    <FieldText label='Stato "Invio in corso..." (IT)' value={copy.submit_submitting_it} onChange={v => update('submit_submitting_it', v)} />
                    <FieldText label='State "Submitting..." (EN)' value={copy.submit_submitting_en} onChange={v => update('submit_submitting_en', v)} />
                    <FieldTextArea label="Disclaimer sotto bottone (IT)" value={copy.disclaimer_it} onChange={v => update('disclaimer_it', v)} />
                    <FieldTextArea label="Disclaimer (EN)" value={copy.disclaimer_en} onChange={v => update('disclaimer_en', v)} />
                    <FieldText label="Alert successo (IT)" value={copy.alert_success_it} onChange={v => update('alert_success_it', v)} />
                    <FieldText label="Success alert (EN)" value={copy.alert_success_en} onChange={v => update('alert_success_en', v)} />
                    <FieldText label="Alert errore (IT)" value={copy.alert_error_it} onChange={v => update('alert_error_it', v)} />
                    <FieldText label="Error alert (EN)" value={copy.alert_error_en} onChange={v => update('alert_error_en', v)} />
                </div>
            </section>

            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Numero WhatsApp destinazione</h3>
                <FieldText label='Numero WhatsApp (formato wa.me — es. "393457905205")' value={copy.whatsapp_phone} onChange={v => update('whatsapp_phone', v)} />
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-[12px] text-blue-700">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                    Il <b>template del messaggio WhatsApp</b> si modifica in <b>Messaggi di Sistema Pro</b> → "Richiesta Preventivo Aviation" (key <code>pro_aviation_quote_request</code>). Placeholder disponibili: <code>{'{service}'}</code>, <code>{'{nome}'}</code>, <code>{'{email}'}</code>, <code>{'{telefono}'}</code>, <code>{'{partenza}'}</code>, <code>{'{arrivo}'}</code>, <code>{'{data_partenza}'}</code>, <code>{'{data_ritorno}'}</code>, <code>{'{passeggeri}'}</code>, <code>{'{note}'}</code>, <code>{'{return_line}'}</code> (riga ritorno se compilata), <code>{'{notes_line}'}</code> (riga note se compilate).
                </div>
            </section>
        </div>
    )
}

// ─── Check Email editor ────────────────────────────────────────────────────
function CheckEmailEditor({ copy, setCopy }: { copy: CheckEmailCopy; setCopy: (next: CheckEmailCopy) => void }) {
    const update = <K extends keyof CheckEmailCopy>(key: K, value: CheckEmailCopy[K]) => setCopy({ ...copy, [key]: value })
    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-[20px] font-semibold tracking-tight text-[#1d1d1f]">Check Email</h2>
                <p className="text-[13px] text-[#6e6e73] mt-1">
                    Pagina <code className="text-[12px] bg-black/5 px-1.5 py-0.5 rounded">/check-email</code> mostrata dopo signup. Solo 3 stringhe IT/EN.
                </p>
            </div>
            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Titolo (IT)" value={copy.title_it} onChange={v => update('title_it', v)} />
                    <FieldText label="Title (EN)" value={copy.title_en} onChange={v => update('title_en', v)} />
                    <FieldTextArea label="Corpo (IT)" value={copy.body_it} onChange={v => update('body_it', v)} />
                    <FieldTextArea label="Body (EN)" value={copy.body_en} onChange={v => update('body_en', v)} />
                    <FieldText label='Link "Torna al Login" (IT)' value={copy.back_link_it} onChange={v => update('back_link_it', v)} />
                    <FieldText label='Link "Back to Sign In" (EN)' value={copy.back_link_en} onChange={v => update('back_link_en', v)} />
                </div>
            </section>
        </div>
    )
}

// ─── Jet Search Results editor (chrome only) ───────────────────────────────
function JetSearchResultsEditor({ copy, setCopy }: { copy: JetSearchResultsCopy; setCopy: (next: JetSearchResultsCopy) => void }) {
    const update = <K extends keyof JetSearchResultsCopy>(key: K, value: JetSearchResultsCopy[K]) => setCopy({ ...copy, [key]: value })
    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-[20px] font-semibold tracking-tight text-[#1d1d1f]">Jet Search Results</h2>
                <p className="text-[13px] text-[#6e6e73] mt-1">
                    Pagina <code className="text-[12px] bg-black/5 px-1.5 py-0.5 rounded">/jet-search-results</code> — chrome editabile (titolo, connettori, empty state). Il catalogo jet vive in RENTAL_CATEGORIES (constants).
                </p>
            </div>
            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Header risultati</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Titolo (IT)" value={copy.title_it} onChange={v => update('title_it', v)} />
                    <FieldText label="Title (EN)" value={copy.title_en} onChange={v => update('title_en', v)} />
                    <FieldText label='Connettore "a" / "to" (IT)' value={copy.subtitle_connector_it} onChange={v => update('subtitle_connector_it', v)} />
                    <FieldText label='Connector "to" (EN)' value={copy.subtitle_connector_en} onChange={v => update('subtitle_connector_en', v)} />
                    <FieldText label='Suffisso "Passeggeri" (IT)' value={copy.passengers_suffix_it} onChange={v => update('passengers_suffix_it', v)} />
                    <FieldText label='Suffix "Passengers" (EN)' value={copy.passengers_suffix_en} onChange={v => update('passengers_suffix_en', v)} />
                    <FieldText label='Bottone "Modifica Ricerca" (IT)' value={copy.modify_search_cta_it} onChange={v => update('modify_search_cta_it', v)} />
                    <FieldText label='Button "Modify Search" (EN)' value={copy.modify_search_cta_en} onChange={v => update('modify_search_cta_en', v)} />
                </div>
                <FieldText label='Fallback aeroporto sconosciuto (es. "N/A")' value={copy.airport_fallback} onChange={v => update('airport_fallback', v)} />
            </section>
            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Stato vuoto (nessun jet trovato)</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Titolo (IT)" value={copy.empty_title_it} onChange={v => update('empty_title_it', v)} />
                    <FieldText label="Title (EN)" value={copy.empty_title_en} onChange={v => update('empty_title_en', v)} />
                    <FieldTextArea label="Corpo (IT)" value={copy.empty_body_it} onChange={v => update('empty_body_it', v)} />
                    <FieldTextArea label="Body (EN)" value={copy.empty_body_en} onChange={v => update('empty_body_en', v)} />
                </div>
            </section>
        </div>
    )
}

// ─── Confirmation Success editor ──────────────────────────────────────────
function ConfirmationSuccessEditor({ copy, setCopy }: { copy: ConfirmationSuccessCopy; setCopy: (next: ConfirmationSuccessCopy) => void }) {
    const update = <K extends keyof ConfirmationSuccessCopy>(key: K, value: ConfirmationSuccessCopy[K]) => setCopy({ ...copy, [key]: value })
    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-[20px] font-semibold tracking-tight text-[#1d1d1f]">Conferma Prenotazione</h2>
                <p className="text-[13px] text-[#6e6e73] mt-1">
                    Pagina <code className="text-[12px] bg-black/5 px-1.5 py-0.5 rounded">/confirmation-success</code>. Mostrata dopo prenotazione completata o conferma email. Placeholder <code>{'{total}'}</code> nel footnote rental viene sostituito con il prezzo formattato.
                </p>
            </div>

            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Branch "Booking confermato"</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Titolo (IT)" value={copy.booking_title_it} onChange={v => update('booking_title_it', v)} />
                    <FieldText label="Title (EN)" value={copy.booking_title_en} onChange={v => update('booking_title_en', v)} />
                    <FieldText label="Sottotitolo (IT)" value={copy.booking_subtitle_it} onChange={v => update('booking_subtitle_it', v)} />
                    <FieldText label="Subtitle (EN)" value={copy.booking_subtitle_en} onChange={v => update('booking_subtitle_en', v)} />
                    <FieldText label='Heading "Riepilogo Prenotazione" (IT)' value={copy.booking_summary_heading_it} onChange={v => update('booking_summary_heading_it', v)} />
                    <FieldText label='Heading "Booking Summary" (EN)' value={copy.booking_summary_heading_en} onChange={v => update('booking_summary_heading_en', v)} />
                    <FieldText label='Bottone CTA account (IT)' value={copy.booking_cta_account_it} onChange={v => update('booking_cta_account_it', v)} />
                    <FieldText label="Account CTA (EN)" value={copy.booking_cta_account_en} onChange={v => update('booking_cta_account_en', v)} />
                </div>
            </section>

            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Variante Lavaggio (riepilogo)</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label='"Servizio:" (IT)' value={copy.carwash_row_servizio_it} onChange={v => update('carwash_row_servizio_it', v)} />
                    <FieldText label='"Service:" (EN)' value={copy.carwash_row_servizio_en} onChange={v => update('carwash_row_servizio_en', v)} />
                    <FieldText label='"Data:" (IT)' value={copy.carwash_row_data_it} onChange={v => update('carwash_row_data_it', v)} />
                    <FieldText label='"Date:" (EN)' value={copy.carwash_row_data_en} onChange={v => update('carwash_row_data_en', v)} />
                    <FieldText label='"Orario:" (IT)' value={copy.carwash_row_orario_it} onChange={v => update('carwash_row_orario_it', v)} />
                    <FieldText label='"Time:" (EN)' value={copy.carwash_row_orario_en} onChange={v => update('carwash_row_orario_en', v)} />
                    <FieldText label='"Cliente:" (IT)' value={copy.carwash_row_cliente_it} onChange={v => update('carwash_row_cliente_it', v)} />
                    <FieldText label='"Customer:" (EN)' value={copy.carwash_row_cliente_en} onChange={v => update('carwash_row_cliente_en', v)} />
                    <FieldText label='"Pagamento:" (IT)' value={copy.carwash_row_pagamento_it} onChange={v => update('carwash_row_pagamento_it', v)} />
                    <FieldText label='"Payment:" (EN)' value={copy.carwash_row_pagamento_en} onChange={v => update('carwash_row_pagamento_en', v)} />
                    <FieldText label='Valore "Online" (IT)' value={copy.carwash_payment_online_it} onChange={v => update('carwash_payment_online_it', v)} />
                    <FieldText label='Value "Online" (EN)' value={copy.carwash_payment_online_en} onChange={v => update('carwash_payment_online_en', v)} />
                    <FieldText label='Default cliente (IT)' value={copy.carwash_default_customer_it} onChange={v => update('carwash_default_customer_it', v)} />
                    <FieldText label='Default customer (EN)' value={copy.carwash_default_customer_en} onChange={v => update('carwash_default_customer_en', v)} />
                    <FieldText label='Etichetta "TOTALE PAGATO:" (IT)' value={copy.carwash_totale_pagato_it} onChange={v => update('carwash_totale_pagato_it', v)} />
                    <FieldText label='Label "TOTAL PAID:" (EN)' value={copy.carwash_totale_pagato_en} onChange={v => update('carwash_totale_pagato_en', v)} />
                    <FieldTextArea label='Nota WhatsApp (IT)' value={copy.carwash_whatsapp_note_it} onChange={v => update('carwash_whatsapp_note_it', v)} />
                    <FieldTextArea label='WhatsApp note (EN)' value={copy.carwash_whatsapp_note_en} onChange={v => update('carwash_whatsapp_note_en', v)} />
                </div>
            </section>

            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Variante Noleggio (riepilogo)</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label='"Veicolo:" (IT)' value={copy.rental_row_veicolo_it} onChange={v => update('rental_row_veicolo_it', v)} />
                    <FieldText label='"Vehicle:" (EN)' value={copy.rental_row_veicolo_en} onChange={v => update('rental_row_veicolo_en', v)} />
                    <FieldText label='"Ritiro:" (IT)' value={copy.rental_row_ritiro_it} onChange={v => update('rental_row_ritiro_it', v)} />
                    <FieldText label='"Pickup:" (EN)' value={copy.rental_row_ritiro_en} onChange={v => update('rental_row_ritiro_en', v)} />
                    <FieldText label='"Riconsegna:" (IT)' value={copy.rental_row_riconsegna_it} onChange={v => update('rental_row_riconsegna_it', v)} />
                    <FieldText label='"Return:" (EN)' value={copy.rental_row_riconsegna_en} onChange={v => update('rental_row_riconsegna_en', v)} />
                    <FieldText label='"Luogo:" (IT)' value={copy.rental_row_luogo_it} onChange={v => update('rental_row_luogo_it', v)} />
                    <FieldText label='"Location:" (EN)' value={copy.rental_row_luogo_en} onChange={v => update('rental_row_luogo_en', v)} />
                    <FieldText label='"Pagamento:" (IT)' value={copy.rental_row_pagamento_it} onChange={v => update('rental_row_pagamento_it', v)} />
                    <FieldText label='"Payment:" (EN)' value={copy.rental_row_pagamento_en} onChange={v => update('rental_row_pagamento_en', v)} />
                    <FieldText label='Connettore data/ora "alle" (IT)' value={copy.rental_time_connector_it} onChange={v => update('rental_time_connector_it', v)} />
                    <FieldText label='Time connector "at" (EN)' value={copy.rental_time_connector_en} onChange={v => update('rental_time_connector_en', v)} />
                    <FieldText label='Pagamento "In Sede" (IT)' value={copy.rental_payment_in_sede_it} onChange={v => update('rental_payment_in_sede_it', v)} />
                    <FieldText label='Payment "In Office" (EN)' value={copy.rental_payment_in_sede_en} onChange={v => update('rental_payment_in_sede_en', v)} />
                    <FieldText label='Pagamento "Online" (IT)' value={copy.rental_payment_online_it} onChange={v => update('rental_payment_online_it', v)} />
                    <FieldText label='Payment "Online" (EN)' value={copy.rental_payment_online_en} onChange={v => update('rental_payment_online_en', v)} />
                    <FieldText label='Etichetta "TOTALE PAGATO:" (IT)' value={copy.rental_totale_pagato_it} onChange={v => update('rental_totale_pagato_it', v)} />
                    <FieldText label='Label "TOTAL PAID:" (EN)' value={copy.rental_totale_pagato_en} onChange={v => update('rental_totale_pagato_en', v)} />
                    <FieldText label='Etichetta "TOTALE DA PAGARE:" (IT)' value={copy.rental_totale_da_pagare_it} onChange={v => update('rental_totale_da_pagare_it', v)} />
                    <FieldText label='Label "TOTAL TO PAY:" (EN)' value={copy.rental_totale_da_pagare_en} onChange={v => update('rental_totale_da_pagare_en', v)} />
                    <FieldTextArea label='Footnote pagamento agenzia (IT) — usa {total}' value={copy.rental_agency_footnote_it} onChange={v => update('rental_agency_footnote_it', v)} />
                    <FieldTextArea label='Agency payment footnote (EN) — uses {total}' value={copy.rental_agency_footnote_en} onChange={v => update('rental_agency_footnote_en', v)} />
                </div>
            </section>

            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Branch "Email confermata" (fallback)</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Titolo (IT)" value={copy.email_title_it} onChange={v => update('email_title_it', v)} />
                    <FieldText label="Title (EN)" value={copy.email_title_en} onChange={v => update('email_title_en', v)} />
                    <FieldTextArea label="Body se loggato (IT)" value={copy.email_body_logged_in_it} onChange={v => update('email_body_logged_in_it', v)} />
                    <FieldTextArea label="Body if signed in (EN)" value={copy.email_body_logged_in_en} onChange={v => update('email_body_logged_in_en', v)} />
                    <FieldTextArea label="Body se non loggato (IT)" value={copy.email_body_logged_out_it} onChange={v => update('email_body_logged_out_it', v)} />
                    <FieldTextArea label="Body if signed out (EN)" value={copy.email_body_logged_out_en} onChange={v => update('email_body_logged_out_en', v)} />
                    <FieldText label="CTA se loggato (IT)" value={copy.email_cta_logged_in_it} onChange={v => update('email_cta_logged_in_it', v)} />
                    <FieldText label="CTA if signed in (EN)" value={copy.email_cta_logged_in_en} onChange={v => update('email_cta_logged_in_en', v)} />
                    <FieldText label="CTA se non loggato (IT)" value={copy.email_cta_logged_out_it} onChange={v => update('email_cta_logged_out_it', v)} />
                    <FieldText label="CTA if signed out (EN)" value={copy.email_cta_logged_out_en} onChange={v => update('email_cta_logged_out_en', v)} />
                </div>
            </section>
        </div>
    )
}

// ─── Header / Navigation editor ────────────────────────────────────────────
// Brand vocabulary like "DR7 Club", "Aviation Division", "Prime Wash" stays
// hardcoded in the website. Only localized chrome (CTAs, section headings,
// popup labels, aria) is editable here.
function HeaderEditor({ copy, setCopy }: { copy: HeaderCopy; setCopy: (next: HeaderCopy) => void }) {
    const update = <K extends keyof HeaderCopy>(key: K, value: HeaderCopy[K]) => setCopy({ ...copy, [key]: value })
    return (
        <div className="space-y-6">
            <p className="text-[13px] text-[#6e6e73]">
                Testi di Header e menu di navigazione (barra in alto + drawer EXPLORE). Il vocabolario di brand
                (DR7 Club, Aviation Division, Prime Wash, ecc.) resta fisso nel sito e non è modificabile qui.
            </p>

            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Logo & aria-label</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Logo alt (testo alternativo)" value={copy.logo_alt} onChange={v => update('logo_alt', v)} />
                    <div />
                    <FieldText label='Aria "Apri menu" (IT)' value={copy.open_menu_aria_it} onChange={v => update('open_menu_aria_it', v)} />
                    <FieldText label='Aria "Open menu" (EN)' value={copy.open_menu_aria_en} onChange={v => update('open_menu_aria_en', v)} />
                    <FieldText label='Aria "Chiudi menu" (IT)' value={copy.close_menu_aria_it} onChange={v => update('close_menu_aria_it', v)} />
                    <FieldText label='Aria "Close menu" (EN)' value={copy.close_menu_aria_en} onChange={v => update('close_menu_aria_en', v)} />
                </div>
            </section>

            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Barra superiore</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label='Bottone "EXPLORE" (IT)' value={copy.explore_label_it} onChange={v => update('explore_label_it', v)} />
                    <FieldText label='Button "EXPLORE" (EN)' value={copy.explore_label_en} onChange={v => update('explore_label_en', v)} />
                    <FieldText label='Pill "Credit Wallet" (IT)' value={copy.credit_wallet_label_it} onChange={v => update('credit_wallet_label_it', v)} />
                    <FieldText label='Pill "Credit Wallet" (EN)' value={copy.credit_wallet_label_en} onChange={v => update('credit_wallet_label_en', v)} />
                </div>
            </section>

            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Drawer (menu laterale)</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label='CTA "Prenota Ora" (IT)' value={copy.drawer_book_cta_it} onChange={v => update('drawer_book_cta_it', v)} />
                    <FieldText label='CTA "Book Now" (EN)' value={copy.drawer_book_cta_en} onChange={v => update('drawer_book_cta_en', v)} />
                    <FieldText label='Etichetta "La Nostra Flotta" (IT)' value={copy.flotta_label_it} onChange={v => update('flotta_label_it', v)} />
                    <FieldText label='Label "Our Fleet" (EN)' value={copy.flotta_label_en} onChange={v => update('flotta_label_en', v)} />
                    <FieldText label='Titolo sezione "Servizi" (IT)' value={copy.servizi_heading_it} onChange={v => update('servizi_heading_it', v)} />
                    <FieldText label='Section heading "Services" (EN)' value={copy.servizi_heading_en} onChange={v => update('servizi_heading_en', v)} />
                    <FieldText label='Titolo sezione "Esperienze" (IT)' value={copy.esperienze_heading_it} onChange={v => update('esperienze_heading_it', v)} />
                    <FieldText label='Section heading "Experiences" (EN)' value={copy.esperienze_heading_en} onChange={v => update('esperienze_heading_en', v)} />
                    <FieldText label='Titolo sezione "Prime Wash" (IT)' value={copy.prime_wash_heading_it} onChange={v => update('prime_wash_heading_it', v)} />
                    <FieldText label='Section heading "Prime Wash" (EN)' value={copy.prime_wash_heading_en} onChange={v => update('prime_wash_heading_en', v)} />
                    <FieldText label='Titolo sezione "Business" (IT)' value={copy.business_heading_it} onChange={v => update('business_heading_it', v)} />
                    <FieldText label='Section heading "Business" (EN)' value={copy.business_heading_en} onChange={v => update('business_heading_en', v)} />
                    <FieldText label='Titolo sezione "Digital" (IT)' value={copy.digital_heading_it} onChange={v => update('digital_heading_it', v)} />
                    <FieldText label='Section heading "Digital" (EN)' value={copy.digital_heading_en} onChange={v => update('digital_heading_en', v)} />
                    <FieldText label='CTA "Contattaci" (IT)' value={copy.contact_cta_it} onChange={v => update('contact_cta_it', v)} />
                    <FieldText label='CTA "Contact us" (EN)' value={copy.contact_cta_en} onChange={v => update('contact_cta_en', v)} />
                </div>
            </section>

            <section className="border border-black/10 rounded-2xl p-5 bg-white shadow-sm space-y-4">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Popup prenotazione (apre dal drawer)</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FieldText label="Titolo popup (IT)" value={copy.popup_title_it} onChange={v => update('popup_title_it', v)} />
                    <FieldText label="Popup title (EN)" value={copy.popup_title_en} onChange={v => update('popup_title_en', v)} />
                    <FieldText label="Sottotitolo popup (IT)" value={copy.popup_subtitle_it} onChange={v => update('popup_subtitle_it', v)} />
                    <FieldText label="Popup subtitle (EN)" value={copy.popup_subtitle_en} onChange={v => update('popup_subtitle_en', v)} />
                </div>
            </section>
        </div>
    )
}
