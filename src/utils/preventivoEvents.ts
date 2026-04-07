/**
 * Preventivo Event Tracking
 * Appends events to the preventivi.events JSONB array for funnel analysis.
 * Fire-and-forget — never blocks the UI.
 */
import { supabase } from '../supabaseClient'

interface PreventivoEvent {
  event: string
  ts: string
  value?: number
  context?: string
}

export async function appendPreventivoEvent(
  preventivoId: string,
  event: string,
  context?: { value?: number; detail?: string }
): Promise<void> {
  try {
    // Fetch current events
    const { data } = await supabase
      .from('preventivi')
      .select('events')
      .eq('id', preventivoId)
      .single()

    const currentEvents: PreventivoEvent[] = Array.isArray(data?.events) ? data.events : []

    const newEvent: PreventivoEvent = {
      event,
      ts: new Date().toISOString(),
      ...(context?.value != null && { value: context.value }),
      ...(context?.detail && { context: context.detail }),
    }

    await supabase
      .from('preventivi')
      .update({ events: [...currentEvents, newEvent] })
      .eq('id', preventivoId)
  } catch (err) {
    console.error('[preventivoEvents] Failed to append event:', err)
  }
}
