import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import App from './App'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  open: vi.fn(),
  create: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
  upload: vi.fn(),
  ask: vi.fn(),
  progress: vi.fn(),
  practice: vi.fn(),
  action: vi.fn(),
  file: vi.fn(),
}))
vi.mock('./features/auth/AuthProvider', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => ({
    session: { access_token: 'test-token', user: { id: 'test-user' } },
    loading: false,
    signOut: vi.fn(),
  }),
}))
vi.mock(import('./services/api/notebooks'), async (importOriginal) => ({
  ...(await importOriginal()),
  notebookApi: () => mocks,
}))
const source = {
  chunk_id: 'chunk-1',
  document_id: 'doc-1',
  filename: 'cedar.pdf',
  page_number: 2,
  content: 'Late returns cost two tokens per day.',
}
const notebook = { id: 'notebook-1', title: 'Library notes', deleting: false }
const document = {
  id: 'doc-1',
  filename: 'cedar.pdf',
  kind: 'pdf',
  status: 'ready',
  phase: 'ready',
  completed_chunks: 2,
  total_chunks: 2,
  warnings: [],
  materials: [
    {
      title: 'Study guide 1',
      answer: 'Introduction: library lending.',
      sources: [source],
    },
  ],
  learned: true,
  page_count: 2,
}
let workspace: {
  notebook: typeof notebook
  documents: (typeof document)[]
  turns: {
    id: string
    question: string
    answer: string
    sources: (typeof source)[]
  }[]
}
beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset())
  workspace = {
    notebook,
    documents: [{ ...document }],
    turns: [
      {
        id: 'turn-1',
        question: 'What is the late fee?',
        answer: 'Two tokens per day.',
        sources: [source],
      },
    ],
  }
  mocks.list.mockResolvedValue([notebook])
  mocks.open.mockImplementation(async () => workspace)
  mocks.file.mockRejectedValue(new Error('Offline'))
})
const mount = (path = '/?notebook=notebook-1') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )

it('restores saved documents, lessons, conversation and learning progress', async () => {
  mount()
  expect(
    await screen.findByRole(
      'heading',
      { name: 'Library notes' },
      { timeout: 3000 },
    ),
  ).toBeInTheDocument()
  expect(screen.getByText('Two tokens per day.')).toBeInTheDocument()
  expect(screen.getByText('Introduction: library lending.')).toBeInTheDocument()
  expect(screen.getByLabelText('I have reviewed this source')).toBeChecked()
  expect(screen.queryByText(/Preview next state/)).not.toBeInTheDocument()
})
it('opens the next unreviewed source from the quest map', async () => {
  workspace.documents.push({
    ...document,
    id: 'doc-2',
    filename: 'oak.pdf',
    learned: false,
  })
  mount()
  fireEvent.click(
    await screen.findByRole('button', { name: /Continue lesson/ }),
  )
  expect(screen.getByLabelText('Learning source')).toHaveValue('doc-2')
  expect(screen.getByRole('region', { name: 'Lesson reader' })).toHaveFocus()
  expect(screen.getByLabelText('Notebook quest progress')).toHaveAttribute(
    'value',
    '1',
  )
})

it('completes the quest after all 20 quiz questions, even with a wrong answer', async () => {
  localStorage.removeItem('questlearn:stamps:test-user')
  mocks.practice.mockResolvedValue({
    flashcards: Array.from({ length: 30 }, (_, i) => ({
      prompt: `Flashcard prompt ${i + 1}`,
      answer: 'The lending policy says fourteen days.',
      source,
    })),
    quiz: Array.from({ length: 20 }, (_, i) => ({
      prompt: `Question prompt ${i + 1}`,
      options: ['Seven days', 'Fourteen days', 'Thirty days'],
      correct_index: 1,
      answer: 'The lending policy says fourteen days.',
      source,
    })),
  })
  workspace.documents[0].materials = [
    {
      title: 'Introduction',
      answer: 'Library members can borrow three books.',
      sources: [source],
    },
    {
      title: 'Main Topics',
      answer: 'Books are due in fourteen days.',
      sources: [source],
    },
    {
      title: 'Worked Examples',
      answer: 'A late book costs two tokens per day.',
      sources: [source],
    },
    { title: 'Review', answer: 'Recall the lending rules.', sources: [source] },
  ]
  const view = mount()
  const map = within(
    await screen.findByRole('navigation', { name: 'Chapter landmarks' }),
  )
  fireEvent.click(map.getByRole('button', { name: 'Bridge Flashcards' }))
  const deck = within(screen.getByRole('region', { name: 'Bridge flashcards' }))
  expect(screen.queryByText('A late book costs two tokens per day.')).toBeNull()
  fireEvent.click(deck.getByRole('button', { name: 'Generate flashcards' }))
  expect(await deck.findByText('Card 1 of 30')).toBeVisible()
  for (let i = 1; i <= 30; i++) {
    fireEvent.click(deck.getByRole('button', { name: 'Reveal answer' }))
    if (i < 30) fireEvent.click(deck.getByRole('button', { name: /Next card/ }))
  }
  fireEvent.click(deck.getByRole('button', { name: 'Finish flashcards' }))
  expect(
    map.getByRole('button', { name: 'Bridge Flashcards Stamped' }),
  ).toBeVisible()
  fireEvent.click(map.getByRole('button', { name: 'Observatory Final quiz' }))
  const quiz = within(screen.getByRole('region', { name: 'Final quiz' }))
  expect(screen.queryByRole('region', { name: 'Trail challenge' })).toBeNull()
  expect(mocks.practice).toHaveBeenCalledTimes(1)
  fireEvent.click(await quiz.findByRole('button', { name: 'Start final quiz' }))
  for (let i = 1; i <= 20; i++) {
    expect(
      quiz.getByRole('heading', { name: `Question ${i} of 20` }),
    ).toHaveFocus()
    fireEvent.click(
      quiz.getByRole('radio', {
        name: i === 1 ? 'Seven days' : 'Fourteen days',
      }),
    )
    fireEvent.click(quiz.getByRole('button', { name: 'Check answer' }))
    expect(quiz.getByRole('status')).toHaveTextContent(
      'The lending policy says fourteen days.',
    )
    if (i === 5) {
      expect(quiz.getByRole('status')).toHaveTextContent(
        'The Lantern revealed.',
      )
      expect(quiz.getByText('4 / 20 stars lit')).toBeVisible()
    }
    if (i < 20)
      fireEvent.click(quiz.getByRole('button', { name: 'Next question' }))
  }
  expect(
    map.getByRole('button', { name: 'Observatory Final quiz' }),
  ).toBeInTheDocument()
  fireEvent.click(quiz.getByRole('button', { name: 'Finish quiz' }))
  expect(quiz.getByRole('heading', { name: 'Quest complete' })).toBeVisible()
  expect(quiz.getByRole('heading', { name: 'Score: 19 / 20' })).toHaveFocus()
  expect(quiz.getByText('4 of 4 constellations revealed')).toBeVisible()
  fireEvent.click(quiz.getByRole('button', { name: 'Retry missed questions' }))
  expect(quiz.getByRole('heading', { name: 'Review 1 of 1' })).toHaveFocus()
  fireEvent.click(quiz.getByRole('radio', { name: 'Fourteen days' }))
  fireEvent.click(quiz.getByRole('button', { name: 'Check answer' }))
  fireEvent.click(quiz.getByRole('button', { name: 'Finish review' }))
  expect(quiz.getByText('20 / 20 stars lit')).toBeVisible()
  expect(quiz.getByRole('heading', { name: 'Score: 19 / 20' })).toHaveFocus()
  expect(
    map.getByRole('button', { name: 'Observatory Final quiz Stamped' }),
  ).toBeVisible()
  expect(mocks.progress).not.toHaveBeenCalled()
  view.unmount()
  mount()
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Observatory Final quiz Stamped',
    }),
  )
  expect(screen.getByRole('heading', { name: 'Quest complete' })).toBeVisible()
  localStorage.removeItem('questlearn:stamps:test-user')
}, 15_000)
it('opens the exact cited passage and PDF page', async () => {
  workspace.turns[0].sources = [
    {
      ...source,
      chunk_id: 'chunk-2',
      page_number: 3,
      content: 'Renewals are free.',
    },
    {
      ...source,
      chunk_id: 'chunk-3',
      document_id: 'doc-2',
      filename: 'oak.pdf',
    },
  ]
  mount()
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Read source 1: cedar.pdf page 2',
    }),
  )
  expect(
    screen.getByRole('region', { name: 'Cited source passage' }),
  ).toHaveTextContent('Late returns cost two tokens per day.')
  expect(screen.getByText('Page 2')).toBeInTheDocument()
  fireEvent.click(
    screen.getByRole('button', { name: 'Read source 1: cedar.pdf page 3' }),
  )
  expect(screen.getByText('Page 3')).toBeInTheDocument()
  expect(mocks.file).toHaveBeenCalledExactlyOnceWith('doc-1')
  fireEvent.click(
    screen.getByRole('button', { name: 'Read source 2: oak.pdf page 2' }),
  )
  expect(mocks.file).toHaveBeenLastCalledWith('doc-2')
})
it('creates a notebook then opens its persisted workspace', async () => {
  mocks.create.mockResolvedValue(notebook)
  mount('/')
  fireEvent.change(screen.getByLabelText('New notebook name'), {
    target: { value: 'Library notes' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Create notebook' }))
  expect(
    await screen.findByRole('heading', { name: 'Library notes' }),
  ).toBeInTheDocument()
  expect(mocks.create).toHaveBeenCalledWith('Library notes')
})
it('keeps a failed question for retry without showing a fake answer', async () => {
  mocks.ask.mockRejectedValue(new Error('Gemini quota reached.'))
  mount()
  await screen.findByRole('heading', { name: 'Library notes' })
  fireEvent.change(screen.getByLabelText('Ask your sources'), {
    target: { value: 'How many books?' },
  })
  fireEvent.click(screen.getByRole('button', { name: /Ask question/ }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Gemini quota reached.',
  )
  expect(screen.getByLabelText('Ask your sources')).toHaveValue(
    'How many books?',
  )
  expect(mocks.ask).toHaveBeenCalledWith(
    'notebook-1',
    expect.any(String),
    'How many books?',
    ['doc-1'],
  )
  fireEvent.click(screen.getByRole('button', { name: /Ask question/ }))
  await waitFor(() => expect(mocks.ask).toHaveBeenCalledTimes(2))
  expect(mocks.ask.mock.calls[1][1]).toBe(mocks.ask.mock.calls[0][1])
})
it('shows the explorer while answering and removes it after failure', async () => {
  let rejectAnswer!: (error: Error) => void
  mocks.ask.mockImplementation(
    () =>
      new Promise((_, reject) => {
        rejectAnswer = reject
      }),
  )
  const { container } = mount()
  await screen.findByRole('heading', { name: 'Library notes' })
  fireEvent.change(screen.getByLabelText('Ask your sources'), {
    target: { value: 'Explain this' },
  })
  fireEvent.click(screen.getByRole('button', { name: /Ask question/ }))
  expect(
    await screen.findByText('Finding evidence and answering…'),
  ).toHaveAttribute('role', 'status')
  expect(container.querySelector('.nb-runner svg')).toBeInTheDocument()
  expect(
    screen.queryByRole('progressbar', {
      name: 'Finding evidence and answering',
    }),
  ).not.toBeInTheDocument()
  rejectAnswer(new Error('Please retry.'))
  await screen.findByRole('alert')
  expect(container.querySelector('.nb-runner')).not.toBeInTheDocument()
})
it('shows measured indexing progress and blocks questions about processing sources', async () => {
  workspace = {
    notebook,
    documents: [
      {
        ...document,
        status: 'processing',
        phase: 'indexing',
        completed_chunks: 1,
        materials: [],
      },
    ],
    turns: [],
  }
  mount()
  expect(
    await screen.findByRole('progressbar', { name: 'Indexing cedar.pdf' }),
  ).toHaveAttribute('value', '1')
  expect(screen.getByRole('button', { name: /Ask question/ })).toBeDisabled()
  expect(screen.getByLabelText('Use cedar.pdf for questions')).toBeDisabled()
})
it('saves review progress through the backend', async () => {
  mocks.progress.mockResolvedValue({ learned: false })
  mount()
  fireEvent.click(await screen.findByLabelText('I have reviewed this source'))
  await waitFor(() =>
    expect(mocks.progress).toHaveBeenCalledWith('doc-1', false),
  )
})

it('keeps the notebook list available when a saved notebook is being deleted', async () => {
  mocks.list.mockResolvedValue([{ ...notebook, deleting: true }])
  mocks.open.mockRejectedValue(new Error('Notebook deletion is in progress.'))
  mount()
  expect(
    await screen.findByRole('button', { name: 'Finish deletion' }),
  ).toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Notebook deletion is in progress.',
  )
})

it('retries failed reads and slows polling once processing is complete', async () => {
  vi.useFakeTimers()
  try {
    mocks.open.mockRejectedValueOnce(new Error('Storage unavailable.'))
    workspace.documents[0].status = 'processing'
    await act(async () => {
      mount()
    })
    expect(screen.getByRole('alert')).toHaveTextContent('Storage unavailable.')

    await act(() => vi.advanceTimersByTimeAsync(4000))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(mocks.open).toHaveBeenCalledTimes(2)
    expect(mocks.list).toHaveBeenCalledTimes(1)

    workspace.documents[0].status = 'ready'
    await act(() => vi.advanceTimersByTimeAsync(4000))
    expect(mocks.open).toHaveBeenCalledTimes(3)

    await act(() => vi.advanceTimersByTimeAsync(29000))
    expect(mocks.open).toHaveBeenCalledTimes(3)
    await act(() => vi.advanceTimersByTimeAsync(1000))
    expect(mocks.open).toHaveBeenCalledTimes(4)
    expect(mocks.list).toHaveBeenCalledTimes(2)
  } finally {
    vi.useRealTimers()
  }
})
