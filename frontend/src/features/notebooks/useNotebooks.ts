import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import {
  notebookApi,
  type Notebook,
  type Workspace,
} from '../../services/api/notebooks'

export function useNotebooks(token: string) {
  const [params, setParams] = useSearchParams()
  const selected = params.get('notebook') || ''
  const [notebooks, setNotebooks] = useState<(Notebook & { xp: number })[]>([])
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [revision, setRevision] = useState(0)
  const operation = useRef<AbortController | null>(null)
  const refresh = () => {
    setLoadError('')
    setError('')
    setRevision((value) => value + 1)
  }
  useEffect(() => {
    setBusy('')
    setWorkspace(null)
    setLoading(true)
    return () => operation.current?.abort()
  }, [selected, token])
  useEffect(() => {
    const controller = new AbortController()
    const api = notebookApi(token, controller.signal)
    let timer: ReturnType<typeof setTimeout>
    let libraryDue = 0
    async function load() {
      let delay = 4000
      try {
        const [list, data] = await Promise.allSettled([
          Date.now() >= libraryDue ? api.list() : null,
          selected ? api.open(selected) : Promise.resolve(null),
        ])
        if (controller.signal.aborted) return
        if (list.status === 'fulfilled' && list.value) {
          setNotebooks(list.value)
          libraryDue = Date.now() + 30000
        }
        setWorkspace(data.status === 'fulfilled' ? data.value : null)
        if (list.status === 'rejected') throw list.reason
        if (data.status === 'rejected') throw data.reason
        setLoadError('')
        if (
          !data.value?.documents.some(
            ({ status }) => status === 'uploaded' || status === 'processing',
          )
        )
          delay = 30000
      } catch (cause) {
        if (!controller.signal.aborted)
          setLoadError(
            cause instanceof Error
              ? cause.message
              : 'Unable to load notebooks.',
          )
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false)
          timer = setTimeout(load, delay)
        }
      }
    }
    void load()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [token, selected, revision])

  async function run(
    label: string,
    task: (api: ReturnType<typeof notebookApi>) => Promise<unknown>,
  ) {
    if (operation.current && !operation.current.signal.aborted) return false
    const controller = new AbortController()
    operation.current = controller
    setBusy(label)
    setError('')
    try {
      await task(notebookApi(token, controller.signal))
      if (controller.signal.aborted) return false
      refresh()
      return true
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : 'The operation failed. Please retry.',
        )
      return false
    } finally {
      if (!controller.signal.aborted) setBusy('')
      controller.abort()
    }
  }
  function open(id: string) {
    setParams(id ? { notebook: id } : {})
  }
  return {
    notebooks,
    workspace,
    selected,
    loading,
    error: error || loadError,
    busy,
    run,
    open,
    refresh,
  }
}
