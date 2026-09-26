// CARGOS — luoghi (comuni e stati) con il codice ufficiale.
//
// 26/09/2026: CARGOS conosceva ~25 comuni scritti a mano; Sanluri,
// Quartucciu, Assemini... davano "codice ISTAT mancante". Ora i codici
// vengono dalla Tabella 1 ufficiale di CARGOS (V_COMUNI_STATI), salvata in
// cargos_luoghi / cargos_luoghi_nomi da cargos-luoghi-sync.

/**
 * Forma confrontabile di un nome di luogo: senza accenti, maiuscolo, apostrofi
 * tipografici uniformati, tutto cio' che non e' lettera o cifra diventa uno
 * spazio. "Sant’Antioco" e "SANT'ANTIOCO" danno "SANT ANTIOCO".
 * La stessa regola e' usata per riempire cargos_luoghi_nomi: se cambia qui,
 * va rilanciato cargos-luoghi-sync.
 */
export function normalizzaLuogo(nome: string | null | undefined): string {
  return String(nome || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Tutti i nomi con cui un luogo della tabella si puo' cercare (nomi bilingui "BOLZANO/BOZEN"). */
export function nomiDiRicerca(nomeUfficiale: string): string[] {
  const parti = [nomeUfficiale, ...nomeUfficiale.split('/')]
  return Array.from(new Set(parti.map(normalizzaLuogo).filter(Boolean)))
}

export interface RigaLuogoCargos {
  codice: string
  nome: string
  provincia: string | null
  valido_dal: string | null   // aaaa-mm-gg
  valido_al: string | null
}

/** Legge il file V_COMUNI_STATI.dat (CODICE#DESCRIZIONE#provincia#DataInizioVal#DataFineVal). */
export function leggiTabellaLuoghi(testo: string): RigaLuogoCargos[] {
  const data = (s: string) => {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec((s || '').trim())
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null
  }
  return testo.split(/\r?\n/).slice(1)
    .map(l => l.split('#'))
    .filter(r => r.length >= 5 && /^\d{9}$/.test(r[0].trim()))
    .map(r => ({
      codice: r[0].trim(),
      nome: r[1].trim(),
      provincia: r[2].trim() || null,
      valido_dal: data(r[3]),
      valido_al: data(r[4]),
    }))
}
