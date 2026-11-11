import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { BrandLink } from '../../components/BrandLink'
import { Card, Icon, Page } from '../../components/ui'
import { Explorer } from '../world/Explorer'
import { getAccount, type VerifiedAccount } from '../../services/api/account'
import { ApiError } from '../../services/api/client'
import { useAuth } from './AuthProvider'
import {
  notebookApi,
  totalXp,
  type Notebook,
} from '../../services/api/notebooks'

export default function AccountPage() {
  const { session, signOut } = useAuth()
  const navigate = useNavigate()
  const [account, setAccount] = useState<VerifiedAccount | null>(null)
  const [journals, setJournals] = useState<(Notebook & { xp: number })[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const token = session?.access_token
  const userId = session?.user.id
  useEffect(() => {
    if (!token) return
    const controller = new AbortController()
    setAccount(null)
    setError('')
    void Promise.all([
      getAccount(token, controller.signal),
      notebookApi(token, controller.signal).list(),
    ])
      .then(([value, notebooks]) => {
        if (controller.signal.aborted) return
        if (value.id !== userId) {
          setError(
            'Your session could not be verified. Sign out and sign in again.',
          )
          return
        }
        setAccount(value)
        setJournals(notebooks.filter((n) => !n.deleting))
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof ApiError && cause.status === 401
              ? 'Your session has expired. Sign out and sign in again.'
              : 'We could not verify your account right now. Please try again.',
          )
      })
    return () => controller.abort()
  }, [token, userId, attempt])
  async function logout() {
    setBusy(true)
    setError('')
    try {
      await signOut()
      navigate('/login', { replace: true })
    } catch {
      setError('Sign out failed. Please try again.')
      setBusy(false)
    }
  }
  return (
    <>
      <header className="nb-header">
        <BrandLink />
        <Link to="/">Back to notebooks</Link>
      </header>
      <main className="player-journal">
        <div className="journal-cover">
          <Page
            eyebrow="PLAYER JOURNAL"
            title="My account"
            description="Your profile and saved learning progress."
          />
          <span className="journal-explorer" aria-hidden="true">
            <Explorer />
          </span>
        </div>
        <Card>
          {account ? (
            <>
              <span className="badge">Account verified</span>
              <h2>{account.email || 'Signed in'}</h2>
              <p className="journal-xp">
                <Icon kind="star" />
                {totalXp(journals)} XP
              </p>
              <p>Each reviewed source in your notebooks counts for 100 XP.</p>
              <h3>Your expeditions</h3>
              <ul className="journal-entries">
                {journals.map((n) => (
                  <li key={n.id}>
                    <Link to={'/?notebook=' + encodeURIComponent(n.id)}>
                      {n.title}
                      <strong>{n.xp} XP →</strong>
                    </Link>
                  </li>
                ))}
              </ul>
              {!journals.length && (
                <p>Create a notebook to start your first expedition.</p>
              )}
            </>
          ) : (
            !error && <p role="status">Verifying your account…</p>
          )}
          {error && (
            <div role="alert">
              <p className="error">{error}</p>
              <button
                className="secondary button"
                onClick={() => setAttempt((value) => value + 1)}
              >
                Try again
              </button>
            </div>
          )}
          <div className="actions">
            <Link className="button" to="/">
              Back to notebooks →
            </Link>
            <button
              className="secondary button"
              disabled={busy}
              onClick={logout}
            >
              {busy ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </Card>
      </main>
    </>
  )
}
