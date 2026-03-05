import { Handler } from '@netlify/functions';
import { reminderHandler } from './send-booking-reminders';

// Manual trigger for send-booking-reminders (scheduled functions reject direct HTTP calls)
export const handler: Handler = async (event, context) => {
  return reminderHandler(event, context);
};
