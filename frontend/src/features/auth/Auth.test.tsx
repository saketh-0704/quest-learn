import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { expect, it, vi } from 'vitest'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { AuthProvider, useAuth } from './AuthProvider'
import AuthPage from './AuthPage'
import { RequireAuth } from './RequireAuth'

const session = {
  access_token: 'test-access-token',
  refresh_token: 'test-refresh-token',
  token_type: 'bearer',
  expires_in: 3600,
  user: {
    id: '10000000-0000-0000-0000-000000000001',
    email: 'learner@example.invalid',
  },
} as Session

function makeClient(initial: Session | null = null) {
  let current = initial
  let listener = (_event: string, _session: Session | null) => {}
  const unsubscribe = vi.fn()
  const emit = (next: Session | null) => {
    current = next
    listener(next ? 'SIGNED_IN' : 'SIGNED_OUT', next)
  }
  const auth = {
    onAuthStateChange: vi.fn((callback) => {
      listener = callback
      return { data: { subscription: { unsubscribe } } }
    }),
    getSession: vi.fn(async () => ({
      data: { session: current },
      error: null,
    })),
    signInWithPassword: vi.fn(async () => {
      emit(session)
      return { data: { session }, error: null as object | null }
    }),
    signUp: vi.fn(async () => ({ data: { session: null }, error: null })),
    signOut: vi.fn(async () => {
      emit(null)
      return { error: null }
    }),
  }
  return {
    client: { auth } as unknown as SupabaseClient,
    auth,
    emit,
    unsubscribe,
  }
}

function AccountProbe() {
  const { session, signOut } = useAuth()
  return (
    <>
      <h1>{session?.user.email || 'Guest'}</h1>
      <button onClick={() => void signOut()}>Sign out</button>
    </>
  )
}
function UploadProbe() {
  const location = useLocation()
  return (
    <h1>Upload at {location.pathname + location.search + location.hash}</h1>
  )
}
function mount(client: SupabaseClient, path = '/account') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider client={client}>
        <Routes>
          <Route
            path="/new"
            element={
              <RequireAuth>
                <UploadProbe />
              </RequireAuth>
            }
          />
          <Route
            path="/login"
            element={<AuthPage key="login" mode="login" />}
          />
          <Route
            path="/signup"
            element={<AuthPage key="signup" mode="signup" />}
          />
          <Route
            path="/account"
            element={
              <RequireAuth>
                <AccountProbe />
              </RequireAuth>
            }
          />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
}

it('redirects protected accounts to login and completes login and local logout', async () => {
  const { client, auth } = makeClient()
  mount(client)
  expect(
    await screen.findByRole('heading', { name: 'Welcome back.' }),
  ).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Email address'), {
    target: { value: 'learner@example.invalid' },
  })
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: 'long-password' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  expect(
    await screen.findByRole('heading', { name: 'learner@example.invalid' }),
  ).toBeInTheDocument()
  expect(auth.signInWithPassword).toHaveBeenCalledWith({
    email: 'learner@example.invalid',
    password: 'long-password',
  })
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
  expect(
    await screen.findByRole('heading', { name: 'Welcome back.' }),
  ).toBeInTheDocument()
  expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
})

it('shows rejected credentials without navigating to the account', async () => {
  const { client, auth } = makeClient()
  auth.signInWithPassword.mockResolvedValueOnce({
    data: { session },
    error: { code: 'invalid_credentials' },
  })
  mount(client, '/login')
  fireEvent.change(screen.getByLabelText('Email address'), {
    target: { value: 'learner@example.invalid' },
  })
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: 'wrong-password' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Email or password is incorrect.',
  )
  expect(
    screen.getByRole('heading', { name: 'Welcome back.' }),
  ).toBeInTheDocument()
})

it('validates password confirmation and handles email confirmation without inventing a session', async () => {
  const { client, auth } = makeClient()
  mount(client, '/signup')
  fireEvent.change(screen.getByLabelText('Email address'), {
    target: { value: 'learner@example.invalid' },
  })
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: 'long-password' },
  })
  fireEvent.change(screen.getByLabelText('Confirm password'), {
    target: { value: 'different' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
  expect(screen.getByRole('alert')).toHaveTextContent('passwords do not match')
  expect(auth.signUp).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('Confirm password'), {
    target: { value: 'long-password' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Check your email',
  )
  expect(screen.getByLabelText('Password')).toHaveValue('')
})

it('restores a session and unsubscribes on unmount', async () => {
  const fake = makeClient(session)
  const view = mount(fake.client)
  expect(
    await screen.findByRole('heading', { name: 'learner@example.invalid' }),
  ).toBeInTheDocument()
  view.unmount()
  expect(fake.unsubscribe).toHaveBeenCalledOnce()
})

it('returns to the upload URL after login, including when switching signup pages', async () => {
  const fake = makeClient()
  mount(fake.client, '/new?mode=document#upload')
  await screen.findByRole('heading', { name: 'Welcome back.' })
  fireEvent.click(screen.getByRole('link', { name: 'Create an account' }))
  fireEvent.click(screen.getByRole('link', { name: 'Sign in' }))
  fireEvent.change(screen.getByLabelText('Email address'), {
    target: { value: 'learner@example.invalid' },
  })
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: 'long-password' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  expect(
    await screen.findByRole('heading', {
      name: 'Upload at /new?mode=document#upload',
    }),
  ).toBeInTheDocument()
  act(() => fake.emit(null))
  expect(
    await screen.findByRole('heading', { name: 'Welcome back.' }),
  ).toBeInTheDocument()
  expect(
    screen.queryByRole('heading', { name: /Upload at/ }),
  ).not.toBeInTheDocument()
})

it('does not let a stale restoration overwrite a later sign-out', async () => {
  const fake = makeClient()
  let resolve!: (value: {
    data: { session: Session | null }
    error: null
  }) => void
  fake.auth.getSession.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done
    }),
  )
  mount(fake.client)
  await waitFor(() => expect(fake.auth.getSession).toHaveBeenCalled())
  act(() => fake.emit(null))
  await act(async () => {
    resolve({ data: { session }, error: null })
  })
  expect(
    screen.getByRole('heading', { name: 'Welcome back.' }),
  ).toBeInTheDocument()
  expect(
    screen.queryByRole('heading', { name: 'learner@example.invalid' }),
  ).not.toBeInTheDocument()
})
