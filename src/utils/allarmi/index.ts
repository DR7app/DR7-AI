/**
 * Registro dei moduli di allarmi per gruppo (01/10/2026).
 *
 * Ogni file di questa cartella e' un gruppo del catalogo (multe, sinistri,
 * officina...): esporta un `ModuloAllarmi` con le sue rilevazioni e, se serve,
 * la lettura delle sue tabelle. Per aggiungerne uno: importarlo qui e metterlo
 * in MODULI_ALLARMI. Il nome di ogni detector deve essere unico in tutto il
 * catalogo ed e' quello scritto nella colonna `detector` di system_alarms.
 */
import type { Detector, ModuloAllarmi } from '../alarmDetectors'
import { moduloDanniSinistri } from './danniSinistri'
import { moduloManutenzione } from './manutenzione'
import { moduloMulteOfficina } from './multeOfficina'
import { moduloLeadPreparazione } from './leadPreparazione'
import { moduloOperativo } from './operativo'
import { moduloPagamentiCauzioniContratti } from './pagamentiCauzioniContratti'
import { moduloDocumentiFatture } from './documentiFatture'

export const MODULI_ALLARMI: ModuloAllarmi[] = [
    moduloDanniSinistri,
    moduloManutenzione,
    moduloMulteOfficina,
    moduloLeadPreparazione,
    moduloOperativo,
    moduloPagamentiCauzioniContratti,
    moduloDocumentiFatture,
]

export function detectorsDeiModuli(): Record<string, Detector> {
    const tutti: Record<string, Detector> = {}
    for (const m of MODULI_ALLARMI) Object.assign(tutti, m.detectors)
    return tutti
}
