-- Remove old/wrong system_messages keys that are not used by any active function
DELETE FROM system_messages WHERE message_key IN (
  'booking_confirmation',
  'booking_reminder',
  'return_reminder',
  'deposit_reminder',
  'carwash_modified',
  'mechanical_modified',
  'rental_modified'
);
