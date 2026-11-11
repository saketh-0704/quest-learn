import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '../../services/supabase/client'
import { authErrorMessage } from './authErrors'

type AuthState = {
  session: Session | null
  loading: boolean
  error: string | null
}
type AuthContextValue = AuthState & {
  configured: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string) => Promise<boolean>
  signOut: () => Promise<void>
  retry: () => void
}
const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({
  children,
  client = supabase,
}: {
  children: ReactNode
  client?: SupabaseClient | null
}) {
  const [state, setState] = useState<AuthState>({
    session: null,
    loading: !!client,
    error: null,
  })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!client) {
      setState({ session: null, loading: false, error: null })
      return
    }
    let active = true
    let revision = 0
    setState((previous) => ({ ...previous, loading: true, error: null }))
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, session) => {
      // Keep this callback synchronous: awaiting Auth calls here can deadlock the SDK.
      revision++
      if (active) setState({ session, loading: false, error: null })
    })
    const startedAt = revision
    void client.auth
      .getSession()
      .then(({ data, error }) => {
        if (!active || revision !== startedAt) return
        setState({
          session: error ? null : data.session,
          loading: false,
          error: error
            ? 'We could not restore your session. Please try again.'
            : null,
        })
      })
      .catch(() => {
        if (active && revision === startedAt)
          setState({
            session: null,
            loading: false,
            error: 'We could not restore your session. Please try again.',
          })
      })
    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [client, attempt])

  function requireClient() {
    if (!client) throw new Error('Account services are not configured yet.')
    return client
  }
  async function signIn(email: string, password: string) {
    const { error } = await requireClient().auth.signInWithPassword({
      email: email.trim(),
      password,
    })
    if (error) throw new Error(authErrorMessage(error))
  }
  async function signUp(email: string, password: string) {
    const { data, error } = await requireClient().auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: `${window.location.origin}/account` },
    })
    if (error) throw new Error(authErrorMessage(error))
    return data.session === null
  }
  async function signOut() {
    const { error } = await requireClient().auth.signOut({ scope: 'local' })
    if (error) throw new Error(authErrorMessage(error))
    setState({ session: null, loading: false, error: null })
  }
  return (
    <AuthContext.Provider
      value={{
        ...state,
        configured: !!client,
        signIn,
        signUp,
        signOut,
        retry: () => setAttempt((value) => value + 1),
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('AuthProvider is required')
  return value
}
