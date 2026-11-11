import { afterEach, expect, it, vi } from 'vitest'
import { ApiError, requestJson } from './client'

afterEach(() => vi.unstubAllGlobals())
it('preserves HTTP status without displaying private response bodies', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({ internal: 'private details' }),
      }),
  )
  await expect(requestJson('/api/health')).rejects.toMatchObject({
    name: 'ApiError',
    status: 503,
  })
})
it('turns invalid JSON and network failures into actionable API errors', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('invalid')
      },
    }),
  )
  await expect(requestJson('/api/health')).rejects.toThrow('invalid JSON')
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
  await expect(requestJson('/api/health')).rejects.toThrow(
    'Cannot reach the API',
  )
})
it('preserves caller cancellation instead of reporting a network failure', async () => {
  const controller = new AbortController()
  controller.abort()
  const error = new DOMException('Cancelled', 'AbortError')
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error))
  await expect(
    requestJson('/api/health', { signal: controller.signal }),
  ).rejects.toBe(error)
  expect(error).not.toBeInstanceOf(ApiError)
})
