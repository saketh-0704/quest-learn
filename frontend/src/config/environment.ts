function apiBaseUrl(value: string): string {
  const url = new URL(value)
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'VITE_API_BASE_URL must be an HTTP(S) URL without credentials, query, or fragment',
    )
  }
  return url.toString().replace(/\/$/, '')
}
export const environment = Object.freeze({
  apiBaseUrl: apiBaseUrl(
    import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000',
  ),
  apiTimeoutMs: 5000,
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL?.trim() || '',
  supabasePublishableKey:
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || '',
})
