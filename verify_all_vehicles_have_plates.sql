-- Verify all vehicles have license plates (Targa) filled in
-- This is CRITICAL for the plate-based conflict checking to work

-- 1. Check which vehicles are missing plates
SELECT 
    id,
    display_name,
    plate,
    targa,
    status,
    category,
    CASE 
        WHEN (plate IS NULL OR plate = '') AND (targa IS NULL OR targa = '') THEN '❌ MISSING PLATE'
        WHEN plate IS NOT NULL AND plate != '' THEN '✅ Has plate'
        WHEN targa IS NOT NULL AND targa != '' THEN '✅ Has targa'
    END as plate_status
FROM vehicles
WHERE status != 'retired'
ORDER BY 
    CASE 
        WHEN (plate IS NULL OR plate = '') AND (targa IS NULL OR targa = '') THEN 0
        ELSE 1
    END,
    category,
    display_name;

-- 2. Count vehicles with/without plates
SELECT 
    COUNT(*) as total_vehicles,
    COUNT(CASE WHEN plate IS NOT NULL AND plate != '' THEN 1 END) as vehicles_with_plate,
    COUNT(CASE WHEN targa IS NOT NULL AND targa != '' THEN 1 END) as vehicles_with_targa,
    COUNT(CASE WHEN (plate IS NULL OR plate = '') AND (targa IS NULL OR targa = '') THEN 1 END) as vehicles_missing_both
FROM vehicles
WHERE status != 'retired';

-- 3. Sync 'plate' column from 'targa' column if plate is empty
UPDATE vehicles
SET plate = targa
WHERE (plate IS NULL OR plate = '')
    AND targa IS NOT NULL
    AND targa != ''
    AND status != 'retired';

-- 4. After sync, verify again
SELECT 
    'After sync:' as step,
    COUNT(*) as total_vehicles,
    COUNT(CASE WHEN plate IS NOT NULL AND plate != '' THEN 1 END) as vehicles_with_plate,
    COUNT(CASE WHEN (plate IS NULL OR plate = '') THEN 1 END) as vehicles_missing_plate
FROM vehicles
WHERE status != 'retired';

-- 5. List any vehicles still missing plates (these need manual entry)
SELECT 
    id,
    display_name,
    plate,
    targa,
    category,
    '⚠️ NEEDS MANUAL ENTRY' as action
FROM vehicles
WHERE status != 'retired'
    AND (plate IS NULL OR plate = '')
    AND (targa IS NULL OR targa = '')
ORDER BY category, display_name;
