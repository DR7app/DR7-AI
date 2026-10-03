import { describe, it, expect } from 'vitest';
import { scopoPagamento } from './scopoPagamento';

describe('scopoPagamento', () => {
    it('penale mandata come saldo noleggio resta una penale (incidente 02/10/2026)', () => {
        expect(scopoPagamento({ metadata: { payment_purpose: 'booking_topup' }, description: 'Penale — Ritardo check-out (> 30 min)' })).toBe('penali');
        expect(scopoPagamento({ metadata: { payment_purpose: 'booking_topup' }, description: 'Danno — Graffio paraurti (parziale)' })).toBe('danni');
    });
    it('scopo esplicito di penali/danni non cambia', () => {
        expect(scopoPagamento({ metadata: { payment_purpose: 'penali' }, description: 'Penali — Mario Rossi' })).toBe('penali');
        expect(scopoPagamento({ metadata: { payment_purpose: 'danni_penali' }, description: 'Danni e penali — Mario' })).toBe('danni_penali');
    });
    it('senza scopo si legge la descrizione, come prima', () => {
        expect(scopoPagamento({ description: 'Danni — Mario Rossi' })).toBe('danni');
        expect(scopoPagamento({ description: 'Penali — Mario Rossi' })).toBe('penali');
        expect(scopoPagamento({ description: 'Noleggio Audi rs3' })).toBe('booking');
    });
    it('saldi, estensioni e altri scopi restano invariati', () => {
        expect(scopoPagamento({ metadata: { payment_purpose: 'booking_topup' }, description: 'Noleggio Audi rs3 (parziale)' })).toBe('booking_topup');
        expect(scopoPagamento({ metadata: { payment_purpose: 'booking_topup' }, description: 'Saldo completo — Mario Rossi' })).toBe('booking_topup');
        expect(scopoPagamento({ metadata: { payment_purpose: 'extension' }, description: 'Estensione noleggio — Mario' })).toBe('extension');
        expect(scopoPagamento({ metadata: { payment_purpose: 'cauzione' }, description: 'Cauzione' })).toBe('cauzione');
    });
});
