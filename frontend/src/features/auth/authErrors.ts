export function authErrorMessage(error: unknown): string {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? error.code
      : undefined
  if (code === 'invalid_credentials') return 'Email or password is incorrect.'
  if (code === 'email_not_confirmed')
    return 'Confirm your email before signing in.'
  if (code === 'weak_password')
    return 'Choose a stronger password with at least 8 characters.'
  if (
    code === 'over_request_rate_limit' ||
    code === 'over_email_send_rate_limit'
  )
    return 'Too many attempts. Please wait a few minutes and try again.'
  if (code === 'signup_disabled')
    return 'New accounts are currently unavailable.'
  return 'We could not complete that request. Check your connection and try again.'
}
