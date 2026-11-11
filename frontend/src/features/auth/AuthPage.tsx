import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { BrandLink } from '../../components/BrandLink'
import { Card, Page } from '../../components/ui'
import { useAuth } from './AuthProvider'

export default function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  const { configured, signIn, signUp } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const creating = mode === 'signup'
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setError('')
    setNotice('')
    if (creating && password !== confirmation) {
      setError('Your passwords do not match.')
      return
    }
    setBusy(true)
    try {
      if (creating) {
        const needsConfirmation = await signUp(email, password)
        if (needsConfirmation) {
          setPassword('')
          setConfirmation('')
          setNotice(
            'Check your email for a confirmation link. Once confirmed, return here to sign in.',
          )
          return
        }
      } else await signIn(email, password)
      const requested = location.state?.from
      const allowed = [
        '/',
        '/new',
        '/understand',
        '/account',
        '/library',
        '/path',
        '/workspace',
        '/quiz',
        '/results',
        '/review',
        '/progress',
        '/foundation',
      ]
      const destination =
        typeof requested === 'string' &&
        allowed.includes(requested.split(/[?#]/)[0])
          ? requested
          : '/'
      navigate(destination, {
        replace: true,
        state:
          destination.split(/[?#]/)[0] === '/understand'
            ? location.state?.returnState
            : undefined,
      })
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Unable to sign in. Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className="auth-page">
      <div className="auth-landscape">
        <BrandLink />
        <div className="auth-story">
          <p className="eyebrow">The reading trail</p>
          <p>Every quest starts with a page.</p>
        </div>
      </div>
      <div className="auth-form-panel">
        <Page
          eyebrow={creating ? 'Your first expedition' : 'Back to the trail'}
          title={creating ? 'Start your learning journey.' : 'Welcome back.'}
          description={
            creating
              ? 'Create an account to start your first notebook.'
              : 'Sign in to pick up where you left off.'
          }
        />
        <Card>
          {!configured ? (
            <p role="alert">
              Account services are not configured yet. Configure Supabase to
              sign in.
            </p>
          ) : (
            <form onSubmit={submit}>
              <fieldset disabled={busy} className="auth-fields">
                <label>
                  Email address
                  <input
                    type="email"
                    autoComplete="email"
                    required
                    maxLength={254}
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </label>
                <label>
                  Password
                  <input
                    type="password"
                    autoComplete={
                      creating ? 'new-password' : 'current-password'
                    }
                    required
                    minLength={creating ? 8 : undefined}
                    maxLength={128}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </label>
                {creating && (
                  <>
                    <p className="muted">Use at least 8 characters.</p>
                    <label>
                      Confirm password
                      <input
                        type="password"
                        autoComplete="new-password"
                        required
                        value={confirmation}
                        onChange={(event) =>
                          setConfirmation(event.target.value)
                        }
                      />
                    </label>
                  </>
                )}
                {error && (
                  <p role="alert" className="error">
                    {error}
                  </p>
                )}
                {notice && (
                  <p role="status" className="notice">
                    {notice}
                  </p>
                )}
                <button className="button" type="submit">
                  {busy
                    ? 'Please wait…'
                    : creating
                      ? 'Create account'
                      : 'Sign in'}
                </button>
              </fieldset>
            </form>
          )}
          <p>
            {creating ? 'Already have an account? ' : 'New to QuestLearn? '}
            <Link to={creating ? '/login' : '/signup'} state={location.state}>
              {creating ? 'Sign in' : 'Create an account'}
            </Link>
          </p>
        </Card>
      </div>
    </main>
  )
}
