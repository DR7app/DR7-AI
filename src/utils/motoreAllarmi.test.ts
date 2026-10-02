/**
 * Motore allarmi senza browser (02/10/2026): le due decisioni nuove.
 *   - serverAttivo: quando la scheda smette di fare il giro e si limita a suonare;
 *   - messaggiDaInviare: quali occorrenze mandano il messaggio al cliente.
 */
import { describe, it, expect } from 'vitest'
import { serverAttivo, messaggiDaInviare, BATTITO_VALIDO_MS, type AlarmEventRow } from './motoreAllarmi'
import type { ClienteAllarmi } from './alarmDetectors'

/** Client finto: ogni catena di query risponde con `risposte[tabella]`. */
function clienteFinto(risposte: Record<string, { data: unknown; error: unknown }>): ClienteAllarmi {
    return {
        from(tabella: string) {
            const r = risposte[tabella] ?? { data: null, error: null }
            const catena: Record<string, unknown> = {}
            for (const m of ['select', 'eq', 'in', 'neq', 'is', 'not', 'gte', 'lte', 'order', 'range']) {
                catena[m] = () => catena
            }
            catena.maybeSingle = () => Promise.resolve(r)
            catena.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(r).then(ok, ko)
            return catena
        },
    } as unknown as ClienteAllarmi
}

const ORA = new Date('2026-10-02T09:00:00Z')

describe('serverAttivo', () => {
    const battito = (fa: number, errore: string | null = null) => clienteFinto({
        alarm_engine_battito: { data: { fonte: 'server', ultimo_giro: new Date(ORA.getTime() - fa).toISOString(), durata_ms: 900, errore }, error: null },
    })

    it('battito recente e senza errore: la scheda non rifa il giro', async () => {
        expect(await serverAttivo(battito(60_000), ORA)).toBe(true)
    })

    it('battito vecchio: la scheda riprende il giro', async () => {
        expect(await serverAttivo(battito(BATTITO_VALIDO_MS + 1), ORA)).toBe(false)
    })

    it('ultimo giro del server fallito: la scheda riprende il giro', async () => {
        expect(await serverAttivo(battito(30_000, 'timeout'), ORA)).toBe(false)
    })

    it('tabella assente (migration non passata): la scheda fa il giro come prima', async () => {
        const sb = clienteFinto({ alarm_engine_battito: { data: null, error: { code: '42P01', message: 'relation does not exist' } } })
        expect(await serverAttivo(sb, ORA)).toBe(false)
    })
})

describe('messaggiDaInviare', () => {
    const evento = (id: string, alarm_id: string, booking_id: string | null): AlarmEventRow => ({
        id, alarm_id, booking_id, vehicle_id: null, entita: null, priority: 'attenzione', stato: 'aperto',
        triggered_at: ORA.toISOString(), ripetizioni: 0, ultima_notifica: null, posticipato_a: null,
        risolto_at: null, risolto_da_nome: null, nota: null,
    })
    const catalogo = clienteFinto({
        system_alarms: {
            data: [
                { id: 'firma', message_key: 'pro_promemoria_firma_prima_ritiro', messaggio_cliente_auto: true },
                { id: 'ritiro', message_key: null, messaggio_cliente_auto: false },
                { id: 'spento', message_key: 'pro_x', messaggio_cliente_auto: false },
            ],
            error: null,
        },
    })

    it('solo gli allarmi con un messaggio scelto, e solo con una pratica', async () => {
        const invii = await messaggiDaInviare(catalogo, [
            evento('e1', 'firma', 'b1'),
            evento('e2', 'ritiro', 'b2'),
            evento('e3', 'spento', 'b3'),
            evento('e4', 'firma', null),
        ])
        expect(invii).toEqual([
            { alarmId: 'firma', entityId: 'b1', templateKey: 'pro_promemoria_firma_prima_ritiro', eventId: 'e1' },
        ])
    })
})
