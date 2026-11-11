import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Button } from '@astryxdesign/core/Button'
import { HStack } from '@astryxdesign/core/HStack'
import '@astryxdesign/core/astryx.css'
import { BrandLink } from '../../components/BrandLink'
import { useAuth } from '../auth/AuthProvider'
import { Icon } from '../../components/ui'
import { Explorer } from '../world/Explorer'
import { notebookApi, totalXp, type Source } from '../../services/api/notebooks'
import { useNotebooks } from './useNotebooks'
import { Citations } from './Citations'
import { LessonReader } from './LessonReader'
import { MissionChallenge, missionQuestion } from './MissionChallenge'
import { SourcePractice } from './SourcePractice'

const landmarks = [
  { name: 'Library', x: 14, y: 76 },
  { name: 'Forest trail', x: 37, y: 49 },
  { name: 'Bridge', x: 61, y: 67 },
  { name: 'Observatory', x: 85, y: 29 },
]

export default function NotebookWorkspace() {
  const { session, signOut } = useAuth()
  const token = session!.access_token
  const stampStorage = 'questlearn:stamps:' + session!.user.id
  const [stamps, setStamps] = useState(() => {
    try {
      const saved: unknown = JSON.parse(
        localStorage.getItem(stampStorage) ?? '[]',
      )
      if (Array.isArray(saved))
        return new Set(
          saved.filter((value): value is string => typeof value === 'string'),
        )
    } catch {
      // Invalid or unavailable storage is equivalent to no saved stamps.
    }
    return new Set<string>()
  })
  const state = useNotebooks(token)
  const { workspace, selected, busy, loading } = state
  const [title, setTitle] = useState('')
  const [question, setQuestion] = useState('')
  const [checked, setChecked] = useState<string[] | null>(null)
  const [focused, setFocused] = useState('')
  const [checkpoint, setCheckpoint] = useState({ source: '', index: 0 })
  const [reward, setReward] = useState('')
  const [passage, setPassage] = useState<Source | null>(null)
  const [preview, setPreview] = useState<{
    documentId: string
    url: string
  } | null>(null)
  const passageDocumentId = passage?.document_id
  const original =
    preview?.documentId === passageDocumentId ? preview?.url : undefined
  const passageRef = useRef<HTMLElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const notesHeading = useRef<HTMLElement>(null)
  const [notesOpen, setNotesOpen] = useState(false)
  const requestId = useRef('')
  const documents = workspace?.documents ?? []
  const ready = documents.filter((document) => document.status === 'ready')
  const nextMission = ready.find((document) => !document.learned)
  const reviewed = ready.filter((document) => document.learned).length
  const selectedSources =
    checked === null
      ? ready.slice(0, 4).map((document) => document.id)
      : checked.filter((id) => ready.some((document) => document.id === id))
  const source =
    documents.find((d) => d.id === focused) ??
    nextMission ??
    ready[0] ??
    documents[0]
  const chapters = source?.materials ?? []
  const lastChapter = chapters.at(-1)
  const finaleIndex =
    source?.status === 'ready' &&
    (chapters.length === 4 ||
      lastChapter?.title.trim().toLowerCase() === 'review')
      ? chapters.length - 1
      : -1
  const mapPoints = chapters.map((_, index) =>
    chapters.length < landmarks.length && index === finaleIndex
      ? landmarks[3]
      : landmarks[index],
  )
  const stop =
    checkpoint.source === source?.id
      ? Math.min(checkpoint.index, Math.max(0, chapters.length - 1))
      : 0
  const finale = stop === finaleIndex
  const flashcards = stop === 2 && !finale && source?.status === 'ready'
  function stageTitle(index: number) {
    if (index === finaleIndex) return 'Final quiz'
    if (index === 2 && source?.status === 'ready') return 'Flashcards'
    return chapters[index]?.title
  }
  const stampIds = chapters.map((chapter, index) =>
    JSON.stringify(
      index === finaleIndex
        ? [source?.id, index, chapter.title, 'final-quiz']
        : [source?.id, index, chapter.title],
    ),
  )
  const stampCount = stampIds.filter((id) => stamps.has(id)).length
  const stamped = stamps.has(stampIds[stop])
  const challenge =
    source?.status === 'ready' && !finale && !flashcards && !stamped
      ? missionQuestion(chapters, stop)
      : undefined
  function stampLandmark() {
    const next = new Set(stamps).add(stampIds[stop])
    setStamps(next)
    try {
      localStorage.setItem(stampStorage, JSON.stringify([...next]))
    } catch {
      // shortcut: stamps stay in this session when browser storage is unavailable.
    }
  }
  function visitChapter(index: number) {
    if (!source) return
    setFocused(source.id)
    setCheckpoint({ source: source.id, index })
  }
  useEffect(() => {
    if (!reward) return
    const timer = setTimeout(() => setReward(''), 4000)
    return () => clearTimeout(timer)
  }, [reward])
  useEffect(() => {
    setFocused('')
    setChecked(null)
    setQuestion('')
    setPassage(null)
    setNotesOpen(false)
    setReward('')
    setCheckpoint({ source: '', index: 0 })
    requestId.current = ''
  }, [selected])
  const notebookTitle = workspace?.notebook.title
  useEffect(() => setTitle(notebookTitle ?? ''), [selected, notebookTitle])
  useEffect(() => {
    if (passage && notesOpen) passageRef.current?.focus()
  }, [passage, notesOpen])
  useEffect(() => {
    setPreview(null)
    if (!passageDocumentId) return
    const controller = new AbortController()
    let url = ''
    void notebookApi(token, controller.signal)
      .file(passageDocumentId)
      .then((blob) => {
        if (controller.signal.aborted) return
        url = URL.createObjectURL(blob)
        setPreview({ documentId: passageDocumentId, url })
      })
      .catch(() => {})
    return () => {
      controller.abort()
      if (url) URL.revokeObjectURL(url)
    }
  }, [token, passageDocumentId])
  function showPassage(value: Source) {
    setPassage(value)
    setNotesOpen(true)
  }

  return (
    <div className="notebook-app">
      <a className="skip-link" href="#learning-workspace">
        Skip to lesson
      </a>
      <header className="nb-header">
        <BrandLink />
        <div className="header-actions">
          <Link to="/account" className="xp-pocket">
            <Icon kind="star" />
            {totalXp(state.notebooks)} XP
          </Link>
          <Link to="/account" className="profile-link">
            <span aria-hidden="true">
              {session?.user.email?.[0]?.toUpperCase() || 'Q'}
            </span>
            My account
          </Link>
          <button
            className="text-button"
            onClick={() => void state.run('Signing out', () => signOut())}
          >
            Sign out
          </button>
        </div>
      </header>
      <HStack
        as="nav"
        className="workspace-nav"
        aria-label="Jump to workspace section"
        gap={2}
      >
        <Button label="Library" href="#notebook-library" variant="ghost" />
        {source && (
          <Button label="Lesson" href="#lesson-reader" variant="ghost" />
        )}
        {workspace && (
          <Button label="Questions" href="#source-questions" variant="ghost" />
        )}
      </HStack>
      <div className="nb-layout">
        <aside
          className="nb-sidebar"
          id="notebook-library"
          tabIndex={-1}
          aria-label="Notebooks and sources"
        >
          <h2>Notebooks</h2>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              const form = event.currentTarget
              const name = String(new FormData(form).get('name') ?? '').trim()
              void state.run('Creating notebook', async (api) => {
                const notebook = await api.create(name)
                form.reset()
                state.open(notebook.id)
              })
            }}
          >
            <label className="nb-sr" htmlFor="new-notebook">
              New notebook name
            </label>
            <div className="nb-create">
              <input
                id="new-notebook"
                name="name"
                placeholder="New notebook name"
                maxLength={120}
                required
              />
              <button aria-label="Create notebook" disabled={!!busy}>
                +
              </button>
            </div>
          </form>
          <section
            className="library-scroll"
            aria-label="Notebook and source lists"
            tabIndex={0}
          >
            <nav aria-label="Saved notebooks">
              {state.notebooks.map((notebook) => (
                <div className="nb-notebook-row" key={notebook.id}>
                  <button
                    className={notebook.id === selected ? 'active' : ''}
                    aria-current={notebook.id === selected ? 'true' : undefined}
                    onClick={() => state.open(notebook.id)}
                  >
                    <Icon />
                    <span>{notebook.title}</span>
                  </button>
                  {notebook.deleting && (
                    <button
                      onClick={() =>
                        void state.run('Finishing deletion', (api) =>
                          api.remove(notebook.id),
                        )
                      }
                    >
                      Finish deletion
                    </button>
                  )}
                </div>
              ))}
            </nav>
            {!loading && state.notebooks.length === 0 && (
              <p className="nb-muted">Create your first notebook to begin.</p>
            )}
            {workspace && (
              <>
                <div className="nb-divider" />
                <h2>
                  Sources <span>{documents.length}</span>
                </h2>
                <label className="nb-upload">
                  + Add a source
                  <input
                    ref={fileInput}
                    aria-label="Upload PDF or TXT"
                    type="file"
                    accept=".pdf,.txt"
                    disabled={!!busy}
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      if (file)
                        void state
                          .run('Uploading source', (api) =>
                            api.upload(selected, file),
                          )
                          .then((ok) => {
                            if (ok && fileInput.current)
                              fileInput.current.value = ''
                          })
                    }}
                  />
                </label>
                <p className="nb-muted">
                  PDF or UTF-8 TXT · up to 10 MB
                  <br />
                  PDFs up to 100 pages. OCR is not supported.
                </p>
                <p className="nb-muted">
                  Select up to 4 ready sources for each question.
                </p>
                {documents.map((document) => (
                  <article className="nb-source" key={document.id}>
                    <div className="nb-source-title">
                      <input
                        type="checkbox"
                        aria-label={`Use ${document.filename} for questions`}
                        checked={selectedSources.includes(document.id)}
                        disabled={
                          document.status !== 'ready' ||
                          (!selectedSources.includes(document.id) &&
                            selectedSources.length >= 4)
                        }
                        onChange={(event) =>
                          setChecked(
                            event.target.checked
                              ? [...selectedSources, document.id]
                              : selectedSources.filter(
                                  (id) => id !== document.id,
                                ),
                          )
                        }
                      />
                      <button
                        aria-pressed={document.id === source?.id}
                        onClick={() => setFocused(document.id)}
                      >
                        {document.filename}
                      </button>
                    </div>
                    <small>
                      {document.learned ? 'Reviewed · ' : ''}
                      {document.phase === 'retry_wait'
                        ? 'Waiting to retry automatically'
                        : document.phase.replaceAll('_', ' ')}
                    </small>
                    {['uploaded', 'processing'].includes(document.status) && (
                      <>
                        {document.phase === 'indexing' &&
                        document.total_chunks ? (
                          <>
                            <progress
                              aria-label={`Indexing ${document.filename}`}
                              value={document.completed_chunks}
                              max={document.total_chunks}
                            />
                            <small>
                              {document.completed_chunks} /{' '}
                              {document.total_chunks} passages indexed
                            </small>
                          </>
                        ) : (
                          <progress
                            aria-label={`Processing ${document.filename}`}
                          />
                        )}
                        <button
                          disabled={!!busy}
                          onClick={() =>
                            void state.run('Cancelling', (api) =>
                              api.action(document.id, 'cancel'),
                            )
                          }
                        >
                          Cancel
                        </button>
                      </>
                    )}
                    {document.failure_reason &&
                      (document.phase === 'retry_wait' ||
                        document.status === 'failed') && (
                        <p className="nb-error">{document.failure_reason}</p>
                      )}
                    {['failed', 'cancelled'].includes(document.status) && (
                      <button
                        disabled={!!busy}
                        onClick={() =>
                          void state.run('Retrying', (api) =>
                            api.action(document.id, 'retry'),
                          )
                        }
                      >
                        Retry processing
                      </button>
                    )}
                  </article>
                ))}
              </>
            )}
          </section>
        </aside>

        <main className="nb-main" id="learning-workspace" tabIndex={-1}>
          {workspace ? (
            <>
              <div className="nb-title-row">
                <div>
                  <h1>{workspace.notebook.title}</h1>
                </div>
                <details>
                  <summary>Notebook settings</summary>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault()
                      void state.run('Renaming notebook', (api) =>
                        api.rename(selected, title),
                      )
                    }}
                  >
                    <label>
                      Notebook name
                      <input
                        value={title}
                        maxLength={120}
                        required
                        onChange={(event) => setTitle(event.target.value)}
                      />
                    </label>
                    <button disabled={!!busy}>Rename</button>
                  </form>
                  <button
                    className="nb-danger"
                    disabled={!!busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          'Delete this notebook, its files, conversations, and learning progress?',
                        )
                      )
                        void state.run('Deleting notebook', async (api) => {
                          await api.remove(selected)
                          state.open('')
                        })
                    }}
                  >
                    Delete notebook
                  </button>
                </details>
              </div>
              <section
                className={
                  chapters.length
                    ? 'nb-quest-map has-landmarks'
                    : 'nb-quest-map'
                }
                aria-label="Notebook quest map"
              >
                <div className="nb-quest-panel">
                  <span className="nb-label">
                    {chapters.length
                      ? 'Expedition map'
                      : 'The next chapter is yours'}
                  </span>
                  <h2>
                    {stageTitle(stop) ??
                      (source
                        ? 'A new page of discovery.'
                        : 'Every quest starts with a page.')}
                  </h2>
                  <p>
                    {finale
                      ? stamped
                        ? 'You earned the final trail stamp.'
                        : 'Answer 20 questions to complete this source’s quest.'
                      : flashcards
                        ? 'Review flashcards drawn from this document.'
                        : chapters.length
                          ? 'Choose a landmark, read the lesson, and solve its challenge to earn a stamp.'
                          : source
                            ? 'Your trail opens when the learning plan is ready.'
                            : 'Add your reading material to create a four-part learning plan.'}
                  </p>
                  {source ? (
                    <button
                      className="nb-primary btn"
                      onClick={() => {
                        visitChapter(stop)
                        notesHeading.current?.focus()
                        notesHeading.current?.scrollIntoView?.({
                          block: 'nearest',
                        })
                      }}
                    >
                      {finale
                        ? 'Go to final quiz'
                        : flashcards
                          ? 'Go to flashcards'
                          : 'Continue lesson'}{' '}
                      <span aria-hidden="true">→</span>
                    </button>
                  ) : (
                    <button
                      className="nb-primary btn"
                      disabled={!!busy}
                      onClick={() => fileInput.current?.click()}
                    >
                      Add a source →
                    </button>
                  )}
                </div>
                <div className="map-progress">
                  {chapters.length > 0 && (
                    <span className="stamp-count">
                      {stampCount} trail {stampCount === 1 ? 'stamp' : 'stamps'}
                    </span>
                  )}
                  <span>
                    {reviewed}/{ready.length} ready sources reviewed
                  </span>
                  <span>
                    {state.notebooks.find((n) => n.id === selected)?.xp ?? 0} XP
                  </span>
                  {ready.length > 0 && (
                    <div className="nb-xp-track">
                      <progress
                        aria-label="Notebook quest progress"
                        value={reviewed}
                        max={ready.length}
                      />
                      <span
                        aria-hidden="true"
                        style={{
                          transform: 'scaleX(' + reviewed / ready.length + ')',
                        }}
                      />
                    </div>
                  )}
                </div>
              </section>
              {chapters.length > 0 && (
                <nav
                  className={
                    chapters.length <= landmarks.length
                      ? 'nb-trail landmark-map'
                      : 'nb-trail landmark-list'
                  }
                  aria-label="Chapter landmarks"
                  id="trail-map"
                  tabIndex={-1}
                >
                  {chapters.length <= landmarks.length && (
                    <svg
                      className="landmark-path"
                      viewBox="0 0 100 100"
                      preserveAspectRatio="none"
                      aria-hidden="true"
                    >
                      {mapPoints.slice(1).map((point, index) => (
                        <line
                          key={stampIds[index]}
                          x1={mapPoints[index].x}
                          y1={mapPoints[index].y}
                          x2={point.x}
                          y2={point.y}
                          className={
                            stamps.has(stampIds[index]) ? 'cleared' : undefined
                          }
                          vectorEffect="non-scaling-stroke"
                        />
                      ))}
                    </svg>
                  )}
                  {chapters.map((_, index) => {
                    const landmark = mapPoints[index]
                    const complete = stamps.has(stampIds[index])
                    const label = stageTitle(index)
                    return (
                      <button
                        key={stampIds[index]}
                        aria-pressed={index === stop}
                        aria-label={[
                          landmark?.name,
                          label,
                          complete ? 'Stamped' : undefined,
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        style={
                          chapters.length <= landmarks.length
                            ? { left: landmark.x + '%', top: landmark.y + '%' }
                            : undefined
                        }
                        onClick={() => visitChapter(index)}
                      >
                        <span className="chapter-number" aria-hidden="true">
                          {complete ? '✓' : index + 1}
                        </span>
                        <span>
                          {landmark?.name ?? label}
                          {landmark && <small>{label}</small>}
                          {complete && (
                            <small className="landmark-stamp">Stamped</small>
                          )}
                        </span>
                      </button>
                    )
                  })}
                  {chapters.length <= landmarks.length && (
                    <span
                      aria-hidden="true"
                      className="nb-traveler"
                      style={{
                        left: mapPoints[stop].x + '%',
                        top: mapPoints[stop].y + '%',
                      }}
                    >
                      <Explorer key={stop} />
                    </span>
                  )}
                </nav>
              )}
            </>
          ) : (
            <section className="nb-first-camp">
              <p className="nb-label">Your learning journal</p>
              <h1>Start your expedition.</h1>
              <p>A notebook for your reading. A path through your ideas.</p>
              <button
                className="nb-primary btn"
                onClick={() => document.getElementById('new-notebook')?.focus()}
              >
                Create a notebook →
              </button>
            </section>
          )}
          {loading && <p role="status">Loading your workspace…</p>}
          {state.error && (
            <div role="alert" className="nb-error">
              {state.error}
              <button onClick={state.refresh}>Reload</button>
            </div>
          )}
          {source && (
            <section
              className="reading-room"
              id="lesson-reader"
              ref={notesHeading}
              tabIndex={-1}
              aria-label="Lesson reader"
            >
              <div className="reader-toolbar">
                <label>
                  Learning source
                  <select
                    value={source.id}
                    onChange={(event) => setFocused(event.target.value)}
                  >
                    {documents.map((document) => (
                      <option key={document.id} value={document.id}>
                        {document.filename}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="reader-meta">
                  {source.kind.toUpperCase()}
                  {source.page_count
                    ? ' · ' + source.page_count + ' pages'
                    : ''}
                </span>
              </div>
              {challenge && (
                <div className="mission-objective">
                  <div>
                    <p className="nb-label">Trail mission</p>
                    <h2>Match the passage to its lesson</h2>
                    <p>Earn a trail stamp for a correct match.</p>
                  </div>
                  <a className="secondary button" href="#trail-challenge">
                    Go to challenge <span aria-hidden="true">↓</span>
                  </a>
                </div>
              )}
              {!finale && !flashcards && (
                <div
                  key={source.id + ':' + stop}
                  className="lesson-scroll"
                  role="region"
                  aria-label="Lesson and challenge"
                  tabIndex={0}
                >
                  {chapters[stop] ? (
                    <LessonReader
                      material={chapters[stop]}
                      onSource={showPassage}
                    />
                  ) : (
                    <div className="lesson-page lesson-pending">
                      <Explorer />
                      <h2>
                        {source.status === 'failed' ||
                        source.status === 'cancelled'
                          ? 'This source needs another try.'
                          : 'Your learning plan is on its way.'}
                      </h2>
                      <p>Check the source status in your library.</p>
                    </div>
                  )}
                  {(challenge || stamped) && (
                    <MissionChallenge
                      key={stampIds[stop]}
                      question={challenge}
                      stamped={stamped}
                      onStamp={stampLandmark}
                      onSource={showPassage}
                    />
                  )}
                </div>
              )}
              {source.status === 'ready' && chapters.length > 0 && (
                <SourcePractice
                  key={source.id}
                  sourceId={source.id}
                  token={token}
                  finale={finale}
                  flashcardStage={flashcards}
                  complete={stamped}
                  onComplete={stampLandmark}
                  onSource={showPassage}
                />
              )}
              <div className="reader-bottom">
                {source.status === 'ready' ? (
                  <label className="nb-reviewed">
                    <input
                      type="checkbox"
                      checked={source.learned}
                      disabled={!!busy}
                      onChange={async (event) => {
                        const learned = event.target.checked
                        setFocused(source.id)
                        setReward('')
                        if (
                          (await state.run('Saving progress', (api) =>
                            api.progress(source.id, learned),
                          )) &&
                          learned
                        )
                          setReward(source.id)
                      }}
                    />
                    I have reviewed this source
                  </label>
                ) : (
                  <p className="nb-muted">
                    Learning notes appear here as processing completes.
                  </p>
                )}

                {chapters.length > 1 && (
                  <div className="chapter-pagination">
                    <button
                      disabled={stop === 0}
                      onClick={() => visitChapter(stop - 1)}
                    >
                      ← Previous chapter
                    </button>
                    <button
                      disabled={stop === chapters.length - 1}
                      onClick={() => visitChapter(stop + 1)}
                    >
                      Next chapter →
                    </button>
                  </div>
                )}
              </div>
              <details
                className="source-notes"
                open={notesOpen}
                onToggle={(event) => setNotesOpen(event.currentTarget.open)}
              >
                <summary>
                  <Icon />
                  <span>
                    Source notes
                    <small>
                      Original passages, citations and document details
                    </small>
                  </span>
                  <span className="when-closed" aria-hidden="true">
                    +
                  </span>
                  <span className="when-open" aria-hidden="true">
                    −
                  </span>
                </summary>
                <div className="source-notes-body">
                  <p className="nb-source-meta">
                    {source.filename} · {source.total_chunks ?? 0} indexed
                    passages
                  </p>
                  {source.warnings.map((warning) => (
                    <p className="nb-warning" key={warning}>
                      {warning}
                    </p>
                  ))}
                  {source.status === 'ready' &&
                    (!source.materials?.some((m) => m.topics?.length) ||
                      source.materials?.[0]?.intro_version !== 2) && (
                      <button
                        disabled={!!busy}
                        onClick={() =>
                          void state.run('Preparing topic lessons', (api) =>
                            api.action(source.id, 'retry'),
                          )
                        }
                      >
                        {source.materials?.some((m) => m.topics?.length)
                          ? 'Repair learning plan'
                          : 'Split plan into topics'}
                      </button>
                    )}
                  {passage && (
                    <section
                      ref={passageRef}
                      tabIndex={-1}
                      className="nb-passage"
                      aria-label="Cited source passage"
                    >
                      <button
                        className="nb-close"
                        onClick={() => setPassage(null)}
                        aria-label="Close source passage"
                      >
                        ×
                      </button>
                      <h3>{passage.filename}</h3>
                      <small>
                        {passage.page_number
                          ? `Page ${passage.page_number}`
                          : 'Text passage'}
                      </small>
                      <blockquote>{passage.content}</blockquote>
                      {original ? (
                        <a
                          href={
                            original +
                            (passage.page_number
                              ? `#page=${passage.page_number}`
                              : '')
                          }
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open original
                          {passage.page_number
                            ? ` · page ${passage.page_number}`
                            : ''}{' '}
                          ↗
                        </a>
                      ) : (
                        <p className="nb-muted">
                          Original file preview is loading or unavailable. The
                          cited passage is shown above.
                        </p>
                      )}
                    </section>
                  )}

                  {!passage && (
                    <p>
                      Select a reference beneath a lesson or an answer to read
                      the exact source passage here.
                    </p>
                  )}
                </div>
              </details>
            </section>
          )}
          {workspace && (
            <details className="nb-chat" open>
              <summary id="source-questions">
                <Icon kind="path" />
                <span>Ask your sources</span>
                <span className="when-closed" aria-hidden="true">
                  +
                </span>
                <span className="when-open" aria-hidden="true">
                  −
                </span>
              </summary>
              <div className="nb-chat-body">
                <div
                  className="nb-conversation"
                  aria-label="Document conversation"
                >
                  {workspace.turns.length === 0 && (
                    <div className="nb-empty">
                      <Icon />
                      <h2>Your next idea starts with a question.</h2>
                      <p>
                        Add a source and wait for processing, then ask for an
                        explanation, comparison, or a source-supported example.
                      </p>
                      <div className="nb-example">
                        “What are the main ideas, and how do they connect?”
                      </div>
                    </div>
                  )}
                  {workspace.turns.map((turn) => (
                    <article className="nb-turn" key={turn.id}>
                      <div className="nb-question">
                        <span>You</span>
                        <p>{turn.question}</p>
                      </div>
                      <div className="nb-answer">
                        <span>QuestLearn tutor</span>
                        <p>{turn.answer}</p>
                        <Citations
                          sources={turn.sources}
                          onSelect={showPassage}
                        />
                      </div>
                    </article>
                  ))}
                </div>
                {busy && (
                  <div role="status" className="nb-working">
                    {busy === 'Finding evidence and answering' ? (
                      <span className="nb-runway" aria-hidden="true">
                        <span className="nb-runner">
                          <span className="nb-runner-body">
                            <Explorer />
                          </span>
                        </span>
                      </span>
                    ) : (
                      <progress aria-label={busy} />
                    )}
                    {busy}…
                  </div>
                )}
                <form
                  className="nb-composer"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void state
                      .run('Finding evidence and answering', (api) =>
                        api.ask(
                          selected,
                          (requestId.current ||= crypto.randomUUID()),
                          question,
                          selectedSources,
                        ),
                      )
                      .then((ok) => {
                        if (ok) setQuestion('')
                      })
                  }}
                >
                  <label htmlFor="question">Ask your sources</label>
                  <textarea
                    id="question"
                    value={question}
                    onChange={(event) => {
                      setQuestion(event.target.value)
                      requestId.current = ''
                    }}
                    required
                    maxLength={2000}
                    placeholder="Help me understand…"
                    disabled={!!busy}
                  />
                  <div>
                    <small>
                      {selectedSources.length} sources selected · Answers may be
                      incomplete; check citations.
                    </small>
                    <button
                      className="nb-primary"
                      disabled={
                        !!busy || !selectedSources.length || !question.trim()
                      }
                    >
                      Ask question ↗
                    </button>
                  </div>
                </form>
              </div>
            </details>
          )}
          <span className="nb-reward" role="status">
            {reward && (
              <>
                <Icon kind="star" />
                <strong>+100 XP</strong>
                <span>Source reviewed</span>
                <i aria-hidden="true" />
                <i aria-hidden="true" />
                <i aria-hidden="true" />
              </>
            )}
          </span>
          <footer className="nb-footer">
            <span>QuestLearn</span>
            <span>Your sources. Your pace.</span>
          </footer>
        </main>
      </div>
    </div>
  )
}
