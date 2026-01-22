-- ALTERNATIVE FIX: Completely remove the trigger and function
-- This will let you update payment statuses immediately
-- Run this in Supabase SQL Editor

-- Step 1: Drop the trigger
DROP TRIGGER IF EXISTS trigger_auto_create_cauzione_from_booking ON bookings;

-- Step 2: Drop the function
DROP FUNCTION IF EXISTS auto_create_cauzione_from_booking();

-- That's it! Payment status updates should work now.
-- The cauzioni auto-creation feature will be disabled, but you can manually create cauzioni if needed.
