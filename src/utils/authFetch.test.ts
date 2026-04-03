import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock supabase before importing authFetch
vi.mock('../supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
    },
  },
}))

// Mock global fetch
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { authFetch } from './authFetch'
import { supabase } from '../supabaseClient'

const mockedGetSession = vi.mocked(supabase.auth.getSession)

beforeEach(() => {
  vi.clearAllMocks()
  mockFetch.mockResolvedValue(new Response('{}', { status: 200 }))
})

describe('authFetch', () => {
  it('attaches Authorization header when session exists', async () => {
    mockedGetSession.mockResolvedValue({
      data: { session: { access_token: 'test-jwt-token' } },
      error: null,
    } as any)

    await authFetch('/.netlify/functions/list-bookings')

    expect(mockFetch).toHaveBeenCalledWith(
      '/.netlify/functions/list-bookings',
      expect.objectContaining({
        headers: expect.any(Headers),
      })
    )

    const headers = mockFetch.mock.calls[0][1].headers as Headers
    expect(headers.get('Authorization')).toBe('Bearer test-jwt-token')
  })

  it('does not overwrite existing Authorization header', async () => {
    mockedGetSession.mockResolvedValue({
      data: { session: { access_token: 'session-token' } },
      error: null,
    } as any)

    await authFetch('/.netlify/functions/test', {
      headers: { Authorization: 'Bearer custom-token' },
    })

    const headers = mockFetch.mock.calls[0][1].headers as Headers
    expect(headers.get('Authorization')).toBe('Bearer custom-token')
  })

  it('works without a session (no token)', async () => {
    mockedGetSession.mockResolvedValue({
      data: { session: null },
      error: null,
    } as any)

    await authFetch('/.netlify/functions/test')

    const headers = mockFetch.mock.calls[0][1].headers as Headers
    expect(headers.has('Authorization')).toBe(false)
  })

  it('passes through method and body', async () => {
    mockedGetSession.mockResolvedValue({
      data: { session: { access_token: 'tok' } },
      error: null,
    } as any)

    await authFetch('/.netlify/functions/save-customer', {
      method: 'POST',
      body: JSON.stringify({ name: 'test' }),
    })

    expect(mockFetch).toHaveBeenCalledWith(
      '/.netlify/functions/save-customer',
      expect.objectContaining({
        method: 'POST',
        body: '{"name":"test"}',
      })
    )
  })
})
