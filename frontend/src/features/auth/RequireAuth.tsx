import { Navigate, useLocation } from 'react-router'
import type { ReactNode } from 'react'
import { useAuth } from './AuthProvider'

export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading, error, retry } = useAuth()
  const location = useLocation()
  if (loading) return <p role="status">Restoring your session…</p>
  if (error)
    return (
      <div role="alert">
        <p>{error}</p>
        <button className="button" onClick={retry}>
          Try again
        </button>
      </div>
    )
  if (!session)
    return (
      <Navigate
        to="/login"
        replace
        state={{
          from: location.pathname + location.search + location.hash,
          returnState: location.state,
        }}
      />
    )
  return children
}
