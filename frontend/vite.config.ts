import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'

function isPublishableKey(key: string) {
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return true
  const parts = key.split('.')
  if (parts.length !== 3) return false
  try {
    return (
      JSON.parse(atob(parts[1].replaceAll('-', '+').replaceAll('_', '/')))
        .role === 'anon'
    )
  } catch {
    return false
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'VITE_')
  const {
    VITE_API_BASE_URL,
    VITE_SUPABASE_URL,
    VITE_SUPABASE_PUBLISHABLE_KEY,
    ...other
  } = env
  if (Object.keys(other).length)
    throw new Error(
      'Unexpected VITE_ variables. Keep private configuration on the backend.',
    )
  if (
    VITE_SUPABASE_PUBLISHABLE_KEY?.trim() &&
    !isPublishableKey(VITE_SUPABASE_PUBLISHABLE_KEY.trim())
  )
    throw new Error(
      'Use a Supabase publishable or legacy anon key in the frontend.',
    )
  for (const value of [VITE_API_BASE_URL, VITE_SUPABASE_URL]) {
    if (!value?.trim()) continue
    const url = URL.parse(value.trim())
    if (
      !url ||
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error(
        'Frontend URLs must use HTTP(S) without credentials, queries, or fragments.',
      )
  }
  return {
    plugins: [react()],
    test: {
      exclude: ['e2e/**', 'node_modules/**'],
      environment: 'jsdom',
      setupFiles: './src/test/setup.ts',
    },
  }
})
