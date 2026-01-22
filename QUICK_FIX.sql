-- SIMPLE FIX: Just disable the broken trigger
-- Run this in Supabase SQL Editor to fix the Da Saldare payment status update

DROP TRIGGER IF EXISTS trigger_auto_create_cauzione_from_booking ON bookings;
