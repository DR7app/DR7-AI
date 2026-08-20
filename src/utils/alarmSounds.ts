/**
 * Suoni degli allarmi — catalogo e riproduzione.
 *
 * 2026-08-20 (richiesta direzione): prima esisteva UN solo suono (/alarm.mp3)
 * per tutti e 13 gli allarmi: sentendolo non si capiva se fosse una riconsegna
 * in ritardo o una revisione in scadenza. Ora ogni allarme sceglie il suo.
 *
 * Scelta tecnica: i suoni sono SINTETIZZATI con Web Audio, non file.
 * - niente asset da caricare, niente 404 se un file sparisce dal deploy
 * - suonano identici su ogni browser, senza dipendere da un codec
 * - restano in loop finche' l'allarme non viene fermato, come l'mp3 storico
 * L'mp3 classico resta disponibile come prima voce, per non cambiare l'abitudine
 * di chi lo riconosce gia'.
 */

export type AlarmSoundKey = 'classic' | 'beep' | 'doppio' | 'campanello' | 'sirena' | 'soft'

export const ALARM_SOUNDS: { key: AlarmSoundKey; label: string; hint: string }[] = [
  { key: 'classic',    label: 'Classico',   hint: 'Il suono storico del gestionale (alarm.mp3)' },
  { key: 'beep',       label: 'Beep',       hint: 'Segnale secco e ripetuto — discreto' },
  { key: 'doppio',     label: 'Doppio',     hint: 'Due note alternate — si distingue dal beep' },
  { key: 'campanello', label: 'Campanello', hint: 'Nota lunga tipo campanello — per gli avvisi non urgenti' },
  { key: 'sirena',     label: 'Sirena',     hint: 'Tono crescente e insistente — per le urgenze' },
  { key: 'soft',       label: 'Soffuso',    hint: 'Nota bassa e morbida — poco invadente' },
]

/** Pattern di ogni suono: sequenza di note (frequenza Hz, durata s, pausa dopo). */
const PATTERNS: Record<Exclude<AlarmSoundKey, 'classic'>, { freq: number; dur: number; gap: number; type?: OscillatorType }[]> = {
  beep:       [{ freq: 880, dur: 0.15, gap: 0.35 }],
  doppio:     [{ freq: 880, dur: 0.12, gap: 0.08 }, { freq: 660, dur: 0.12, gap: 0.5 }],
  campanello: [{ freq: 1320, dur: 0.5, gap: 0.9, type: 'triangle' }],
  sirena:     [{ freq: 700, dur: 0.25, gap: 0 }, { freq: 950, dur: 0.25, gap: 0.1 }],
  soft:       [{ freq: 340, dur: 0.4, gap: 0.8, type: 'sine' }],
}

/** Riproduttore: gestisce un solo suono per volta, in loop o singolo. */
export class AlarmSoundPlayer {
  private ctx: AudioContext | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private audioEl: HTMLAudioElement | null = null
  private stopped = true

  private ensureCtx(): AudioContext | null {
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        this.ctx = new Ctor()
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume()
      return this.ctx
    } catch {
      return null
    }
  }

  /** Suona `key`. loop=true continua finche' stop(); loop=false = anteprima. */
  play(key: AlarmSoundKey, loop = true, volume = 0.8): void {
    this.stop()
    this.stopped = false

    if (key === 'classic') {
      try {
        this.audioEl = new Audio('/alarm.mp3')
        this.audioEl.loop = loop
        this.audioEl.volume = volume
        void this.audioEl.play().catch(() => { /* autoplay bloccato: resta il visivo */ })
      } catch { /* niente audio: l'allarme resta visivo */ }
      return
    }

    const ctx = this.ensureCtx()
    if (!ctx) return
    const pattern = PATTERNS[key]

    const suonaSequenza = () => {
      if (this.stopped) return
      let t = ctx.currentTime
      for (const nota of pattern) {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = nota.type || 'square'
        osc.frequency.value = nota.freq
        // Attacco e rilascio morbidi: senza, ogni nota fa "click".
        gain.gain.setValueAtTime(0, t)
        gain.gain.linearRampToValueAtTime(volume * 0.3, t + 0.01)
        gain.gain.setValueAtTime(volume * 0.3, t + nota.dur - 0.02)
        gain.gain.linearRampToValueAtTime(0, t + nota.dur)
        osc.connect(gain); gain.connect(ctx.destination)
        osc.start(t); osc.stop(t + nota.dur)
        t += nota.dur + nota.gap
      }
      if (loop) {
        const totale = pattern.reduce((s, n) => s + n.dur + n.gap, 0)
        this.timer = setTimeout(suonaSequenza, Math.max(300, totale * 1000))
      }
    }
    suonaSequenza()
  }

  stop(): void {
    this.stopped = true
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    if (this.audioEl) { this.audioEl.pause(); this.audioEl.currentTime = 0; this.audioEl = null }
  }
}

/** Anteprima singola, per il pulsante di ascolto in Centralina Pro. */
let anteprima: AlarmSoundPlayer | null = null
export function ascoltaAnteprima(key: AlarmSoundKey): void {
  if (!anteprima) anteprima = new AlarmSoundPlayer()
  anteprima.play(key, false)
}
