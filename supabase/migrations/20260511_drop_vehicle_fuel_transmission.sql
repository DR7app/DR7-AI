-- Rimuove i filtri target_vehicle_fuel e target_vehicle_transmission da
-- system_messages. La tabella vehicles del DR7 NON ha colonne fuel /
-- transmission (i veicoli sono descritti in display_name + categoria), quindi
-- questi filtri non avrebbero mai matchato nulla. Rimossi per non confondere
-- il boss in form.

ALTER TABLE system_messages
    DROP COLUMN IF EXISTS target_vehicle_fuel;
ALTER TABLE system_messages
    DROP COLUMN IF EXISTS target_vehicle_transmission;
