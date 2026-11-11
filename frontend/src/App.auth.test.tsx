import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { expect, it, vi } from 'vitest'
import App from './App'

vi.mock('./services/supabase/client', () => ({ supabase: null }))

it.each([
  '/',
  '/new',
  '/new?mode=document',
  '/workspace',
  '/library',
  '/account',
  '/path',
  '/quiz',
  '/progress',
  '/understand',
])('requires sign-in before showing %s', async (path) => {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
  expect(
    await screen.findByRole('heading', { name: 'Welcome back.' }),
  ).toBeInTheDocument()
  expect(
    screen.queryByLabelText('Choose study material'),
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('heading', { name: 'A new adventure starts here.' }),
  ).not.toBeInTheDocument()
  expect(
    screen.queryByText('Explore the learning preview →'),
  ).not.toBeInTheDocument()
})

it('keeps signup available without signing in', () => {
  render(
    <MemoryRouter initialEntries={['/signup']}>
      <App />
    </MemoryRouter>,
  )
  expect(
    screen.getByRole('heading', { name: 'Start your learning journey.' }),
  ).toBeInTheDocument()
})
