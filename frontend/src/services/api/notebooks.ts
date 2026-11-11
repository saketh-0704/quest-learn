import { requestJson } from './client'
import { environment } from '../../config/environment'

export type Notebook = { id: string; title: string; deleting: boolean }
export function totalXp(notebooks: { xp: number; deleting: boolean }[]) {
  return notebooks.reduce(
    (total, notebook) => total + (notebook.deleting ? 0 : (notebook.xp ?? 0)),
    0,
  )
}
export type Source = {
  chunk_id: string
  document_id: string
  filename: string
  page_number: number | null
  content: string
}
type TopicLesson = { title: string; answer: string; sources: Source[] }
export type Material = TopicLesson & {
  topics?: TopicLesson[]
  intro_version?: number
}
type Flashcard = { prompt: string; answer: string; source: Source }
export type PracticeSet = {
  flashcards: Flashcard[]
  quiz: (Flashcard & { options: string[]; correct_index: number })[]
  mind_map: {
    title: string
    branches: {
      label: string
      relation: string
      concepts: string[]
      source: Source
    }[]
  }
}
export type Document = {
  id: string
  filename: string
  kind: 'pdf' | 'txt'
  status: string
  phase: string
  completed_chunks: number
  total_chunks: number | null
  failure_reason: string | null
  warnings: string[]
  materials: Material[] | null
  learned: boolean
  page_count: number | null
}
export type Turn = {
  id: string
  question: string
  answer: string
  sources: Source[]
}
export type Workspace = {
  notebook: Notebook
  documents: Document[]
  turns: Turn[]
}

export function notebookApi(token: string, signal?: AbortSignal) {
  const json = <T>(path: string, method = 'GET', body?: unknown): Promise<T> =>
    requestJson(
      '/api/notebooks' + path,
      {
        method,
        signal,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      300000,
    ) as Promise<T>
  return {
    list: () => json<(Notebook & { xp: number })[]>(''),
    open: (id: string) => json<Workspace>('/' + id),
    create: (title: string) => json<Notebook>('', 'POST', { title }),
    rename: (id: string, title: string) =>
      json<Notebook>('/' + id, 'PATCH', { title }),
    remove: (id: string) => json('/' + id, 'DELETE'),
    action: (id: string, action: 'retry' | 'cancel') =>
      json('/sources/' + id + '/' + action, 'POST'),
    progress: (id: string, learned: boolean) =>
      json('/sources/' + id + '/progress', 'PATCH', { learned }),
    practice: (id: string) =>
      json<PracticeSet>('/sources/' + id + '/practice', 'POST'),
    ask: (
      notebook: string,
      id: string,
      question: string,
      documents: string[],
    ) =>
      json<Turn>('/' + notebook + '/questions', 'POST', {
        id,
        question,
        document_ids: documents,
      }),
    upload: async (id: string, file: File) => {
      const extension = file.name.split('.').pop()?.toLowerCase()
      if (!['pdf', 'txt'].includes(extension ?? ''))
        throw new Error('Choose a PDF or UTF-8 TXT file.')
      if (file.size === 0 || file.size > 10 * 1024 * 1024)
        throw new Error('Choose a nonempty file up to 10 MB.')
      return requestJson(
        `/api/notebooks/${id}/documents?filename=${encodeURIComponent(file.name)}`,
        {
          method: 'POST',
          signal,
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type':
              extension === 'pdf' ? 'application/pdf' : 'text/plain',
          },
          body: file,
        },
        90000,
      )
    },
    file: async (id: string) => {
      const response = await fetch(
        `${environment.apiBaseUrl}/api/notebooks/sources/${id}/file`,
        {
          signal,
          headers: { Authorization: `Bearer ${token}` },
        },
      )
      if (!response.ok)
        throw new Error(
          'The original source could not be opened. Please retry.',
        )
      return response.blob()
    },
  }
}
