import { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { richiediStaff } from './utils/firmaStaff'
import { leggiSicurezzaFirma, dataOra, NON_DISPONIBILE_STORICO, type SchedaFirma } from './utils/firmaSicurezza'

/**
 * DR7 — Security & Signature Audit Trail (rifatto il 25/09/2026).
 *
 * Documento leggibile anche da chi non e' tecnico: in alto il riepilogo di
 * sicurezza con la causa concreta di ogni ATTENZIONE, poi per ogni firmatario
 * livello di verifica, sessione, dispositivo, posizione, rete, OTP,
 * integrita' e la cronologia degli eventi. I dati li prepara
 * utils/firmaSicurezza.ts (lo stesso modello della sezione Sicurezza Firma).
 *
 * Riservato allo staff (utils/firmaStaff.ts): prima rispondeva a chiunque
 * avesse l'id del contratto. Il gestionale lo apre con utils/apriAuditFirma.ts.
 */

const supabase = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!
)

export const handler: Handler = async (event) => {
    if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
    }

    const staff = await richiediStaff(event as any)
    if (staff.risposta) return staff.risposta

    try {
        const params = event.httpMethod === 'GET'
            ? event.queryStringParameters || {}
            : JSON.parse(event.body || '{}')

        const { contractId, requestId, format } = params

        if (!contractId && !requestId) {
            return { statusCode: 400, body: JSON.stringify({ error: 'contractId o requestId richiesto' }) }
        }

        const dati = await leggiSicurezzaFirma(supabase, { contractId, requestId }, { verificaFile: format === 'html' })
        if (!dati) {
            return { statusCode: 404, body: JSON.stringify({ error: 'Nessuna richiesta di firma trovata' }) }
        }

        if (format === 'html') {
            return {
                statusCode: 200,
                headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
                body: generaHtml(dati),
            }
        }

        return { statusCode: 200, headers: { 'Cache-Control': 'no-store' }, body: JSON.stringify(dati) }
    } catch (error: any) {
        console.error('Error in signature-audit:', error)
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Errore nel recupero dell\'audit trail', details: error.message })
        }
    }
}

// ── HTML ────────────────────────────────────────────────────────────────

const esc = (v: unknown): string => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function valore(v: string | null | undefined, vuoto = 'Non disponibile'): string {
    if (!v) return `<span class="muted">${esc(vuoto)}</span>`
    if (v === NON_DISPONIBILE_STORICO) return `<span class="muted">${esc(v)}</span>`
    return esc(v)
}

function riga(etichetta: string, v: string | null | undefined, opz: { mono?: boolean; vuoto?: string } = {}): string {
    return `<div class="row"><div class="k">${esc(etichetta)}</div><div class="v${opz.mono ? ' mono' : ''}">${valore(v, opz.vuoto)}</div></div>`
}

function classeLivello(v: string): string {
    if (/^(VERIFICAT|ACQUISITO|ASSOCIATO)/.test(v)) return 'ok'
    if (/^(NON CORRISPONDE|REVOCATO)/.test(v)) return 'ko'
    if (/^(NON AUTORIZZATO|NON DISPONIBILE|NON ACQUISITO|NON REGISTRATO)/.test(v)) return 'warn'
    return 'neutral'
}

function sezione(titolo: string, corpo: string): string {
    return `<section><h3>${esc(titolo)}</h3>${corpo}</section>`
}

function schedaHtml(s: SchedaFirma, compatta: boolean): string {
    const riepilogo = `
      <div class="summary ${s.riepilogo.stato === 'ATTENZIONE' ? 'summary-warn' : 'summary-ok'}">
        <div class="summary-head">
          <span class="summary-label">Riepilogo sicurezza</span>
          <span class="summary-state">${s.riepilogo.stato}</span>
        </div>
        ${s.riepilogo.cause.length
            ? `<ul>${s.riepilogo.cause.map(c => `<li>${esc(c)}</li>`).join('')}</ul>`
            : '<p>Nessun evento di sicurezza rilevato durante la procedura.</p>'}
      </div>`

    const livelli = `
      <div class="levels">
        ${s.livelli.map(l => `<div class="level"><span class="dots">${esc(l.voce)}</span><span class="badge ${classeLivello(l.valore)}">${valore(l.valore)}</span></div>`).join('')}
      </div>`

    const firmatario = sezione('Firmatario', [
        riga('Nome', s.firmatario.nome),
        riga('Email', s.firmatario.email),
        riga('Telefono', s.firmatario.telefono),
        riga('Data/Ora firma', s.firmatario.dataFirma, { vuoto: 'Non firmato' }),
        s.firmatario.metodo ? riga('Firma apposta con', s.firmatario.metodo) : '',
        s.revoca ? riga('Link revocato', `${s.revoca.quando}${s.revoca.da ? ` da ${s.revoca.da}` : ''}${s.revoca.motivo ? ` — ${s.revoca.motivo}` : ''}`) : '',
    ].join(''))

    const sessione = sezione('Sessione di firma', [
        riga('DR7 Device ID', s.sessione.deviceId, { mono: true }),
        `<p class="note">${esc(s.sessione.nota)}</p>`,
        riga('Prima apertura', s.sessione.primaApertura),
        riga('Prima associazione', s.sessione.primaAssociazione),
        riga('Cambio dispositivo', s.sessione.cambioDispositivo),
        riga('Sessioni differenti rilevate', s.sessione.sessioniRilevate),
        riga('Ultima attivita\'', s.sessione.ultimaAttivita),
    ].join(''))

    const disp = s.dispositivo
    const dispositivo = sezione('Dispositivo', disp ? [
        riga('Categoria', disp.categoria),
        riga('Dispositivo', disp.dispositivo),
        riga('Sistema operativo', disp.sistemaOperativo),
        riga('Browser', disp.browser),
        riga('User-Agent', disp.userAgent, { mono: true }),
        '<p class="note">Solo dati dichiarati dal browser (User-Agent). Una pagina web non puo\' leggere IMEI, numero di serie o indirizzo MAC, e il modello esatto del telefono viene indicato solo quando il browser lo dichiara.</p>',
    ].join('') : '<p class="muted">Non disponibile</p>')

    const p = s.posizione
    const posizione = sezione('Posizione al momento della firma', [
        riga('GPS', p.stato),
        p.coordinate ? riga('Indirizzo stimato', p.indirizzoStimato) : '',
        p.coordinate ? `<p class="note">${esc(p.indirizzoNota)}</p>` : '',
        p.coordinate ? riga('Coordinate', p.coordinate, { mono: true }) : '',
        p.accuratezza ? riga('Accuratezza', p.accuratezza) : '',
        p.acquisizione ? riga('Acquisizione (ora server)', p.acquisizione) : '',
        p.oraDispositivo ? riga('Ora dichiarata dal dispositivo', p.oraDispositivo) : '',
        p.secondiPrimaDellaFirma != null ? riga('Acquisita prima della firma', `${p.secondiPrimaDellaFirma} secondi`) : '',
        p.fonte ? riga('Fonte', p.fonte) : '',
        p.apertura ? riga('Posizione all\'apertura', p.apertura) : '',
        `<div class="subbox"><div class="k">Localizzazione IP approssimativa</div><div class="v">${valore(s.ipGeo)}</div><p class="note">Area ricavata dall'indirizzo IP: e' approssimativa e non sostituisce il GPS.</p></div>`,
    ].join(''))

    const rete = sezione('Rete', [
        riga('IP client', s.rete.clientIp, { mono: true }),
        riga('Infrastruttura / proxy', s.rete.proxy, { mono: true, vuoto: '—' }),
        `<p class="note">${esc(s.rete.nota)}</p>`,
    ].join(''))

    const o = s.otp
    const otp = sezione('Autenticazione', [
        riga('OTP', o.stato),
        o.canale ? riga('Canale', o.canale) : '',
        o.destinatario ? riga('Destinatario', o.destinatario) : '',
        o.oraInvio ? riga('Ora invio', o.oraInvio) : '',
        o.oraVerifica ? riga('Ora verifica', o.oraVerifica) : '',
        riga('Codici inviati', String(o.codiciInviati)),
        riga('Tentativi errati', String(o.tentativiErrati)),
        '<p class="note">Il codice viene inviato solo al recapito registrato da DR7 per il firmatario; la pagina di firma non puo\' sceglierlo.</p>',
    ].join(''))

    const i = s.integrita
    const integrita = sezione('Integrita\'', [
        riga('SHA-256 documento originale', i.hashOriginale, { mono: true }),
        riga('SHA-256 documento firmato', i.hashFirmato, { mono: true }),
        i.fileFirmatoVerificato ? riga('Controllo del file firmato', i.fileFirmatoVerificato) : '',
        riga('SHA-256 audit trail', i.hashAuditTrail, { mono: true }),
        riga('Registro eventi', i.registro),
        riga('Versione contratto', i.versione),
    ].join(''))

    const marketing = s.marketing ? sezione('Consenso marketing (DR7 Trust)', [
        riga('Consenso', s.marketing.consenso ? 'SI' : 'NO'),
        riga('Data', s.marketing.quando),
    ].join('')) : ''

    const timeline = sezione('Eventi di sicurezza', s.eventi.length ? `<ol class="timeline">${s.eventi.map(e => `
        <li class="${e.attenzione ? 'ev-warn' : ''}">
          <div class="t">${esc(e.ora)}</div>
          <div class="c">
            <div class="ev-title">${esc(e.titolo)} <span class="code">${esc(e.codice)}</span></div>
            <div class="ev-desc">${esc(e.descrizione)}</div>
            <div class="ev-meta">${esc(e.dataOra)}${e.clientIp ? ` · IP ${esc(e.clientIp)}` : ''}${e.deviceLabel ? ` · ${esc(e.deviceLabel)}` : ''}</div>
          </div>
        </li>`).join('')}</ol>` : '<p class="muted">Nessun evento registrato</p>')

    const titolo = `<h2>${esc(s.firmatario.nome)} <span class="state">${esc(s.statoFirma)}</span></h2>`

    if (compatta) {
        return `<details class="card old"><summary>${esc(s.firmatario.nome)} — ${esc(s.statoFirma)} — creata il ${esc(s.creataIl)}</summary>${riepilogo}${livelli}${firmatario}${sessione}${otp}${timeline}</details>`
    }
    return `<div class="card">${titolo}${riepilogo}${livelli}<div class="grid">${firmatario}${sessione}${dispositivo}${rete}</div>${posizione}<div class="grid">${otp}${integrita}</div>${marketing}${timeline}</div>`
}

export function generaHtml(dati: NonNullable<Awaited<ReturnType<typeof leggiSicurezzaFirma>>>): string {
    const c = dati.contratto
    const riferimento = c?.contract_number || dati.documento || 'Documento'
    const periodo = c?.rental_start_date
        ? `${new Date(c.rental_start_date).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' })} - ${c.rental_end_date ? new Date(c.rental_end_date).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' }) : ''}`
        : null
    const attenzione = dati.attive.some(s => s.riepilogo.stato === 'ATTENZIONE')

    return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Audit Trail - ${esc(riferimento)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; color: #111; background: #fff; max-width: 210mm; margin: 0 auto; padding: 20px; font-size: 12.5px; line-height: 1.45; }
  header { border: 2px solid #111; padding: 14px 16px; margin-bottom: 16px; }
  header .brand { font-size: 22px; font-weight: 800; letter-spacing: 3px; }
  header .sub { font-size: 12px; font-weight: 700; letter-spacing: 2px; color: #444; }
  .head-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-top: 12px; }
  .head-grid .k { font-size: 10px; text-transform: uppercase; letter-spacing: .5px; color: #666; }
  .head-grid .v { font-weight: 700; font-size: 14px; }
  .card { border: 1px solid #d4d4d8; border-radius: 8px; padding: 14px 16px; margin-bottom: 18px; page-break-inside: auto; }
  .card.old { background: #fafafa; }
  .card.old summary { cursor: pointer; font-weight: 600; }
  h2 { font-size: 16px; margin: 0 0 10px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  h2 .state { font-size: 11px; letter-spacing: 1px; border: 1px solid #111; padding: 2px 8px; border-radius: 999px; }
  h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #444; margin: 14px 0 6px; padding-bottom: 4px; border-bottom: 2px solid #d4af37; }
  .summary { border-radius: 6px; padding: 10px 12px; margin-bottom: 10px; }
  .summary-ok { border: 2px solid #15803d; background: #f0fdf4; }
  .summary-warn { border: 2px solid #b45309; background: #fffbeb; }
  .summary-head { display: flex; justify-content: space-between; align-items: center; }
  .summary-label { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; font-weight: 700; }
  .summary-state { font-weight: 800; letter-spacing: 1px; }
  .summary-ok .summary-state { color: #15803d; }
  .summary-warn .summary-state { color: #b45309; }
  .summary ul { margin: 6px 0 0 18px; padding: 0; }
  .summary p { margin: 6px 0 0; }
  .levels { border: 1px solid #e4e4e7; border-radius: 6px; padding: 6px 10px; }
  .level { display: flex; justify-content: space-between; gap: 10px; padding: 3px 0; align-items: baseline; }
  .level .dots { flex: 1; border-bottom: 1px dotted #a1a1aa; }
  .badge { font-weight: 700; font-size: 11px; letter-spacing: .5px; text-align: right; }
  .badge.ok { color: #15803d; } .badge.ko { color: #b91c1c; } .badge.warn { color: #b45309; } .badge.neutral { color: #3f3f46; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 22px; }
  @media (max-width: 640px) { .grid { grid-template-columns: 1fr; } }
  .row { display: grid; grid-template-columns: 42% 58%; gap: 8px; padding: 3px 0; border-bottom: 1px solid #f4f4f5; }
  .k { color: #666; font-size: 11px; }
  .v { font-weight: 600; word-break: break-word; }
  .mono { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 10.5px; font-weight: 500; word-break: break-all; }
  .muted { color: #8a8a8a; font-weight: 400; font-style: italic; }
  .note { color: #666; font-size: 10.5px; margin: 4px 0 6px; }
  .subbox { margin-top: 8px; border: 1px dashed #a1a1aa; border-radius: 6px; padding: 6px 10px; }
  ol.timeline { list-style: none; margin: 0; padding: 0; border-left: 2px solid #d4d4d8; }
  ol.timeline li { display: grid; grid-template-columns: 64px 1fr; gap: 10px; padding: 6px 0 6px 12px; position: relative; page-break-inside: avoid; }
  ol.timeline li::before { content: ''; position: absolute; left: -6px; top: 11px; width: 10px; height: 10px; border-radius: 50%; background: #111; }
  ol.timeline li.ev-warn::before { background: #b45309; }
  ol.timeline .t { font-family: ui-monospace, Menlo, monospace; font-weight: 700; }
  .ev-title { font-weight: 700; letter-spacing: .3px; }
  .ev-warn .ev-title { color: #b45309; }
  .code { font-family: ui-monospace, Menlo, monospace; font-size: 9.5px; color: #71717a; font-weight: 500; }
  .ev-desc { color: #27272a; }
  .ev-meta { color: #8a8a8a; font-size: 10px; }
  .toolbar { display: flex; justify-content: flex-end; margin-bottom: 10px; }
  .toolbar button { font: inherit; padding: 6px 14px; border: 1px solid #111; background: #fff; border-radius: 6px; cursor: pointer; }
  footer { margin-top: 26px; padding-top: 12px; border-top: 1px solid #e4e4e7; text-align: center; color: #8a8a8a; font-size: 10px; }
  @media print { body { padding: 0; } .toolbar { display: none; } details.card { display: block; } details.card > summary { list-style: none; } }
</style>
</head>
<body>
  <div class="toolbar"><button onclick="window.print()">Stampa / Salva PDF</button></div>
  <header>
    <div class="brand">DR7</div>
    <div class="sub">SECURITY &amp; SIGNATURE AUDIT TRAIL</div>
    <div class="head-grid">
      <div><div class="k">${c ? 'Contratto' : 'Documento'}</div><div class="v">${esc(riferimento)}</div></div>
      <div><div class="k">Stato firma</div><div class="v">${esc(dati.statoContratto)}</div></div>
      <div><div class="k">Riepilogo sicurezza</div><div class="v" style="color:${attenzione ? '#b45309' : '#15803d'}">${attenzione ? 'ATTENZIONE' : 'REGOLARE'}</div></div>
      ${c?.customer_name ? `<div><div class="k">Cliente</div><div class="v">${esc(c.customer_name)}</div></div>` : ''}
      ${c?.vehicle_name ? `<div><div class="k">Veicolo</div><div class="v">${esc(c.vehicle_name)}</div></div>` : ''}
      ${periodo ? `<div><div class="k">Periodo</div><div class="v">${esc(periodo)}</div></div>` : ''}
    </div>
  </header>

  ${dati.attive.map(s => schedaHtml(s, false)).join('')}

  ${dati.storiche.length ? `<h3>Richieste precedenti (sostituite o annullate)</h3>${dati.storiche.map(s => schedaHtml(s, true)).join('')}` : ''}

  <footer>
    Orari: ora ufficiale del server DR7, mostrata nel fuso Europe/Rome. Gli eventi del registro non si modificano: dal 25/09/2026 ognuno e' legato al precedente da un'impronta SHA-256.<br>
    DR7 S.p.A. - Via del Fangario 25, 09122 Cagliari (CA) - P.IVA 04104640927<br>
    Documento generato il ${esc(dataOra(new Date().toISOString()))}
  </footer>
</body>
</html>`
}
