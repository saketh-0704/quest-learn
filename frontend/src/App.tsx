import { lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router'
import { ErrorBoundary } from './components/ErrorBoundary'
import { AuthProvider, useAuth } from './features/auth/AuthProvider'
import { RequireAuth } from './features/auth/RequireAuth'
import AuthPage from './features/auth/AuthPage'
import AccountPage from './features/auth/AccountPage'

const NotebookWorkspace = lazy(
  () => import('./features/notebooks/NotebookWorkspace'),
)

function AuthenticatedWorkspace() {
  const { session } = useAuth()
  return (
    <RequireAuth>
      <Suspense fallback={<p role="status">Loading your workspace…</p>}>
        <NotebookWorkspace key={session?.user.id} />
      </Suspense>
    </RequireAuth>
  )
}
export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<AuthPage mode="login" />} />
          <Route path="/signup" element={<AuthPage mode="signup" />} />
          <Route
            path="/account"
            element={
              <RequireAuth>
                <AccountPage />
              </RequireAuth>
            }
          />
          <Route path="*" element={<AuthenticatedWorkspace />} />
        </Routes>
      </AuthProvider>
    </ErrorBoundary>
  )
}
