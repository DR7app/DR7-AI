import { AlarmSoundPlayer } from './alarmSounds'

// 05/10/2026 (direzione): uno slot gia' occupato deve SEMPRE avvisare,
// anche per chi ha role:bypass-otp o quando l'OTP slot_unavailable e'
// spento in Gestione OTP. Prima il conflitto finiva solo nell'audit log
// e la prenotazione veniva salvata in silenzio sopra un'altra.
// Non e' un blocco: l'operatore legge la prenotazione gia' presente e
// sceglie se procedere comunque.
// Popup ROSSO con sirena in loop finche' non si risponde (il confirm del
// browser non si puo' colorare ne' far suonare). Rosso pieno su entrambi
// i temi: e' un allarme, non un elemento dell'interfaccia.
let aperto: Promise<boolean> | null = null

export function confermaSlotOccupato(dettaglio: string): Promise<boolean> {
  // Un solo popup per volta (scelta mezzo + Salva ravvicinati).
  if (aperto) return aperto

  aperto = new Promise<boolean>((resolve) => {
    const suono = new AlarmSoundPlayer()
    suono.play('sirena', true)

    const scrim = document.createElement('div')
    scrim.setAttribute('role', 'alertdialog')
    scrim.setAttribute('aria-modal', 'true')
    scrim.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;padding:16px;'

    const box = document.createElement('div')
    box.style.cssText = 'width:100%;max-width:520px;background:#b91c1c;color:#fff;border:3px solid #fecaca;box-shadow:0 20px 60px rgba(0,0,0,0.5);padding:24px;font-family:inherit;'

    const titolo = document.createElement('div')
    titolo.textContent = 'SLOT NON DISPONIBILE'
    titolo.style.cssText = 'font-size:22px;font-weight:800;letter-spacing:0.08em;margin-bottom:14px;'

    const testo = document.createElement('div')
    testo.textContent = dettaglio
    testo.style.cssText = 'font-size:15px;line-height:1.5;background:rgba(0,0,0,0.2);padding:12px;margin-bottom:16px;white-space:pre-wrap;'

    const domanda = document.createElement('div')
    domanda.textContent = 'Vuoi procedere comunque?'
    domanda.style.cssText = 'font-size:17px;font-weight:700;margin-bottom:18px;'

    const azioni = document.createElement('div')
    azioni.style.cssText = 'display:flex;gap:12px;justify-content:flex-end;flex-wrap:wrap;'

    const annulla = document.createElement('button')
    annulla.type = 'button'
    annulla.textContent = 'Annulla'
    annulla.style.cssText = 'padding:10px 22px;font-weight:700;font-size:15px;background:#fff;color:#b91c1c;border:none;cursor:pointer;'

    const procedi = document.createElement('button')
    procedi.type = 'button'
    procedi.textContent = 'Procedi comunque'
    procedi.style.cssText = 'padding:10px 22px;font-weight:700;font-size:15px;background:transparent;color:#fff;border:2px solid #fff;cursor:pointer;'

    const chiudi = (esito: boolean) => {
      suono.stop()
      document.removeEventListener('keydown', onKey, true)
      scrim.remove()
      aperto = null
      resolve(esito)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); chiudi(false) }
    }
    annulla.onclick = () => chiudi(false)
    procedi.onclick = () => chiudi(true)
    document.addEventListener('keydown', onKey, true)

    azioni.append(annulla, procedi)
    box.append(titolo, testo, domanda, azioni)
    scrim.append(box)
    document.body.append(scrim)
    // Focus su Annulla: un Invio distratto non salva sopra un'altra prenotazione.
    annulla.focus()
  })
  return aperto
}
