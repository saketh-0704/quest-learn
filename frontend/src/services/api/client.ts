import { environment } from '../../config/environment'

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'ApiError'
  }
}
/** All feature services share cancellation, deadlines, HTTP errors, and JSON parsing. */
export async function requestJson(
  path: string,
  options: RequestInit = {},
  timeoutMs: number = environment.apiTimeoutMs,
): Promise<unknown> {
  const signal = AbortSignal.any([
    options.signal ?? new AbortController().signal,
    AbortSignal.timeout(timeoutMs),
  ])
  try {
    const response = await fetch(`${environment.apiBaseUrl}${path}`, {
      ...options,
      signal,
    })
    if (!response.ok) {
      const body = await response.json().catch(() => null)
      const detail = body?.detail
      const message = typeof detail === 'string' ? detail : detail?.message
      throw new ApiError(
        typeof message === 'string'
          ? message
          : 'The API request failed. Please try again.',
        response.status,
      )
    }
    try {
      return await response.json()
    } catch (cause) {
      throw new ApiError('The API returned invalid JSON.', response.status, {
        cause,
      })
    }
  } catch (cause) {
    if (cause instanceof ApiError || options.signal?.aborted) throw cause
    throw new ApiError(
      signal.aborted ? 'The API request timed out.' : 'Cannot reach the API.',
      undefined,
      { cause },
    )
  }
}
