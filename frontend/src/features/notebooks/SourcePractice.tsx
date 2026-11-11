import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  notebookApi,
  type PracticeSet,
  type Source,
} from '../../services/api/notebooks'
import { Citations } from './Citations'
import {
  constellations,
  ObservatoryScene,
  starsPerConstellation,
} from './ObservatoryScene'

export function SourcePractice({
  sourceId,
  token,
  finale,
  flashcardStage,
  complete,
  onComplete,
  onSource,
}: {
  sourceId: string
  token: string
  finale: boolean
  flashcardStage: boolean
  complete: boolean
  onComplete: () => void
  onSource: (source: Source) => void
}) {
  const request = useRef<AbortController | null>(null)
  const [practice, setPractice] = useState<PracticeSet | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [cardIndex, setCardIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  useEffect(() => () => request.current?.abort(), [])

  async function generate() {
    if (request.current) return
    const controller = new AbortController()
    request.current = controller
    setLoading(true)
    setError('')
    try {
      const result = await notebookApi(token, controller.signal).practice(
        sourceId,
      )
      if (result.quiz.length !== 20)
        throw new Error('The final quiz needs 20 questions. Try again.')
      if (!controller.signal.aborted) setPractice(result)
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : 'Practice could not be generated. Try again.',
        )
    } finally {
      request.current = null
      if (!controller.signal.aborted) setLoading(false)
    }
  }

  const card = practice?.flashcards[cardIndex]
  function moveCard(index: number) {
    setCardIndex(index)
    setRevealed(false)
  }

  const generation = !practice && (
    <>
      <button
        className="nb-primary btn"
        disabled={loading}
        onClick={() => void generate()}
      >
        {error
          ? 'Retry generation'
          : finale
            ? 'Generate final quiz'
            : flashcardStage
              ? 'Generate flashcards'
              : 'Generate study tools'}
      </button>
      {loading && (
        <p role="status">
          {finale
            ? 'Preparing your 20 questions…'
            : flashcardStage
              ? 'Preparing your flashcards…'
              : 'Preparing your mind map and flashcards…'}
        </p>
      )}
      {error && (
        <p className="nb-error" role="alert">
          {error}
        </p>
      )}
    </>
  )

  return (
    <section
      className={
        finale
          ? 'trail-mission source-practice observatory-finale'
          : 'trail-mission source-practice'
      }
      aria-label={
        finale
          ? 'Final quiz'
          : flashcardStage
            ? 'Bridge flashcards'
            : 'Source practice'
      }
    >
      {finale && (
        <header className="observatory-heading">
          <p className="nb-label">Stage 04 · Final quiz</p>
          <h2>{complete ? 'Quest complete' : 'The Observatory'}</h2>
          {!complete && (
            <p>
              Light stars with correct answers. Finish all 20 questions to earn
              the Observatory stamp.
            </p>
          )}
        </header>
      )}
      {flashcardStage && (
        <>
          <h2>Flashcards</h2>
          {generation}
        </>
      )}
      {!finale && !flashcardStage && (
        <>
          <p className="nb-label">Expedition practice</p>
          {!practice && (
            <>
              <h2>Study tools</h2>
              <p>Generate a mind map and flashcards from this source.</p>
              {generation}
            </>
          )}
        </>
      )}
      {!finale && !flashcardStage && practice?.mind_map && (
        <section className="practice-map" aria-label="Mind map">
          <h2>Mind map</h2>
          <p>Open a branch to see how it connects to the central idea.</p>
          <div className="practice-map-tree">
            <p className="practice-map-root">{practice.mind_map.title}</p>
            <ul className="practice-map-branches">
              {practice.mind_map.branches.map((branch, index) => (
                <li key={index}>
                  <details>
                    <summary>{branch.label}</summary>
                    <p>{branch.relation}</p>
                    <ul className="practice-map-concepts">
                      {branch.concepts.map((concept) => (
                        <li key={concept}>{concept}</li>
                      ))}
                    </ul>
                    <Citations sources={[branch.source]} onSelect={onSource} />
                  </details>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
      {!finale && practice && card && (
        <>
          {!flashcardStage && <h2>Flashcards</h2>}
          <div className="practice-card">
            <p className="nb-label">
              Card {cardIndex + 1} of {practice.flashcards.length}
            </p>
            <h3>{card.prompt}</h3>
            <button
              aria-expanded={revealed}
              onClick={() => setRevealed(!revealed)}
            >
              {revealed ? 'Hide answer' : 'Reveal answer'}
            </button>
            {revealed && (
              <div className="practice-feedback" aria-live="polite">
                <p>{card.answer}</p>
                <Citations sources={[card.source]} onSelect={onSource} />
              </div>
            )}
          </div>
          <div className="lesson-pagination">
            <button
              disabled={cardIndex === 0}
              onClick={() => moveCard(cardIndex - 1)}
            >
              ← Previous card
            </button>
            {flashcardStage && cardIndex === practice.flashcards.length - 1 ? (
              <button disabled={!revealed || complete} onClick={onComplete}>
                {complete ? 'Bridge stamped' : 'Finish flashcards'}
              </button>
            ) : (
              <button
                disabled={
                  cardIndex === practice.flashcards.length - 1 ||
                  (flashcardStage && !revealed)
                }
                onClick={() => moveCard(cardIndex + 1)}
              >
                Next card →
              </button>
            )}
          </div>
        </>
      )}
      <div hidden={!finale}>
        <FinalQuiz
          questions={practice?.quiz}
          generation={finale && generation}
          onComplete={onComplete}
          onSource={onSource}
        />
      </div>
    </section>
  )
}

function FinalQuiz({
  questions,
  generation,
  onComplete,
  onSource,
}: {
  questions?: PracticeSet['quiz']
  generation: ReactNode
  onComplete: () => void
  onSource: (source: Source) => void
}) {
  const [started, setStarted] = useState(false)
  const [answers, setAnswers] = useState<number[]>([])
  const [choice, setChoice] = useState<number | null>(null)
  const [checked, setChecked] = useState(false)
  const [review, setReview] = useState<number[]>([])
  const [reviewStep, setReviewStep] = useState(0)
  const [recovered, setRecovered] = useState<number[]>([])
  const frame = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const startButton = useRef<HTMLButtonElement>(null)
  const reviewing = review.length > 0
  const index = reviewing ? review[reviewStep] : answers.length
  const question = questions?.[index]
  const total = constellations.length * starsPerConstellation
  const lit = new Set(recovered)
  const score = answers.reduce((correct, answer, i) => {
    if (answer !== questions?.[i]?.correct_index) return correct
    lit.add(i)
    return correct + 1
  }, 0)
  const correctNow = checked && choice === question?.correct_index
  if (correctNow) lit.add(index)
  const group = Math.floor(
    (question ? index : started ? total - 1 : 0) / starsPerConstellation,
  )
  const revealed = Math.floor(
    (answers.length + Number(checked && !reviewing)) / starsPerConstellation,
  )
  const milestone =
    checked && !reviewing && (index + 1) % starsPerConstellation === 0

  useEffect(() => {
    if (started)
      heading.current?.focus({ preventScroll: index === 0 && !reviewing })
  }, [started, index, reviewing, reviewStep])

  return (
    <div ref={frame} className="observatory-layout">
      <ObservatoryScene
        entered={started}
        group={group}
        revealed={revealed}
        lit={lit}
        total={total}
      />
      <div className="observatory-panel">
        {!started ? (
          <>
            <p className="nb-label">Mission briefing</p>
            <h3>Light the constellations</h3>
            <p>
              Every five answers reveal a constellation. You can revisit missed
              questions after the finale.
            </p>
            {questions ? (
              <button
                ref={startButton}
                className="nb-primary btn"
                onClick={() => {
                  setStarted(true)
                  frame.current?.scrollIntoView?.({ block: 'start' })
                }}
              >
                Start final quiz
              </button>
            ) : (
              generation
            )}
          </>
        ) : !question ? (
          <div className="practice-quiz">
            <h3 ref={heading} tabIndex={-1}>
              Score: {score} / {total}
            </h3>
            <p>
              {lit.size} of {total} stars lit.
            </p>
            {lit.size < total && (
              <button
                className="nb-primary btn"
                onClick={() => {
                  setReview(answers.map((_, i) => i).filter((i) => !lit.has(i)))
                  setReviewStep(0)
                }}
              >
                Retry missed questions
              </button>
            )}
            <button
              className="btn"
              onClick={() => {
                setAnswers([])
                setReview([])
                setReviewStep(0)
                setRecovered([])
                setStarted(false)
                requestAnimationFrame(() => startButton.current?.focus())
              }}
            >
              Retake quiz
            </button>
          </div>
        ) : (
          <form
            key={index}
            className="practice-quiz"
            onSubmit={(event) => {
              event.preventDefault()
              if (choice === null) return
              if (!checked) setChecked(true)
              else {
                if (reviewing) {
                  if (correctNow) setRecovered([...recovered, index])
                  setReviewStep(reviewStep + 1)
                } else {
                  setAnswers([...answers, choice])
                  if (index + 1 === total) onComplete()
                }
                setChoice(null)
                setChecked(false)
              }
            }}
          >
            <h3 ref={heading} tabIndex={-1}>
              {reviewing
                ? `Review ${reviewStep + 1} of ${review.length}`
                : `Question ${index + 1} of ${total}`}
            </h3>
            <fieldset className="practice-options" disabled={checked}>
              <legend>{question.prompt}</legend>
              {question.options.map((option, i) => {
                const result = checked
                  ? i === question.correct_index
                    ? 'Correct'
                    : i === choice
                      ? 'Incorrect'
                      : undefined
                  : undefined
                return (
                  <label key={option} data-result={result}>
                    <input
                      type="radio"
                      name="final-quiz"
                      checked={choice === i}
                      onChange={() => setChoice(i)}
                    />
                    <span>
                      {option}
                      {result && <strong> · {result}</strong>}
                    </span>
                  </label>
                )
              })}
            </fieldset>
            {checked && (
              <div className="practice-feedback">
                <p role="status">
                  <strong>
                    {choice === question.correct_index
                      ? 'Correct.'
                      : 'Correct answer: ' +
                        question.options[question.correct_index] +
                        '.'}
                  </strong>{' '}
                  {question.answer}
                  {milestone && (
                    <strong className="observatory-reveal-note">
                      The {constellations[group].name} revealed.
                    </strong>
                  )}
                </p>
                <Citations sources={[question.source]} onSelect={onSource} />
              </div>
            )}
            <button className="nb-primary btn" disabled={choice === null}>
              {checked
                ? reviewing && reviewStep + 1 === review.length
                  ? 'Finish review'
                  : !reviewing && index + 1 === total
                    ? 'Finish quiz'
                    : 'Next question'
                : 'Check answer'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
