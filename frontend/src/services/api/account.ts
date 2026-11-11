import { ApiError, requestJson } from './client'

export type VerifiedAccount = { id: string; email: string | null }
export async function getAccount(
  token: string,
  signal?: AbortSignal,
): Promise<VerifiedAccount> {
  const data = await requestJson('/api/auth/me', {
    signal,
    headers: { Authorization: `Bearer ${token}` },
  })
  if (
    !data ||
    typeof data !== 'object' ||
    !('id' in data) ||
    typeof data.id !== 'string' ||
    !('email' in data) ||
    (data.email !== null && typeof data.email !== 'string')
  )
    throw new ApiError('The account response was invalid.')
  return { id: data.id, email: data.email }
}
