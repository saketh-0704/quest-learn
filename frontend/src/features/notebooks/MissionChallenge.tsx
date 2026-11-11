import { useEffect, useRef, useState } from 'react'
import type { Material, Source } from '../../services/api/notebooks'
import { Explorer } from '../world/Explorer'

export function missionQuestion(chapters: Material[], stop: number) {
  const lessons = chapters.flatMap((chapter, index) =>
    (chapter.topics?.length ? chapter.topics : [chapter]).map((lesson) => ({
      ...lesson,
      index,
      excerpt: lesson.answer.replace(/\s+/g, ' ').trim(),
    })),
  )
  const lesson = lessons.find((item) => item.index === stop && item.excerpt)
  if (!lesson) return
  const distractors = [
    ...new Set(
      lessons
        .filter(
          (item) =>
            item.title !== lesson.title && item.excerpt !== lesson.excerpt,
        )
        .map((item) => item.title),
    ),
  ].slice(0, 2)
  if (!distractors.length) return
  const excerpt =
    lesson.excerpt.length > 280
      ? lesson.excerpt.slice(0, 280).replace(/\s+\S*$/, '') + '…'
      : lesson.excerpt
  return {
    excerpt,
    answer: lesson.title,
    options: [lesson.title, ...distractors].sort(),
    hint: lesson.sources[0],
  }
}

export function MissionChallenge({
  question,
  stamped,
  onStamp,
  onSource,
}: {
  question: ReturnType<typeof missionQuestion>
  stamped: boolean
  onStamp: () => void
  onSource: (source: Source) => void
}) {
  const [feedback, setFeedback] = useState('')
  const [earnedHere, setEarnedHere] = useState(false)
  const resultRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (earnedHere) resultRef.current?.focus()
  }, [earnedHere])
  if (!question && !stamped) return null
  return (
    <section
      id="trail-challenge"
      className="trail-mission"
      aria-label="Trail challenge"
      tabIndex={-1}
    >
      <p className="nb-label">Trail challenge</p>
      {stamped ? (
        <div
          ref={resultRef}
          tabIndex={-1}
          className={earnedHere ? 'mission-cleared earned' : 'mission-cleared'}
          role="status"
        >
          <Explorer />
          <div>
            <h3>Stamp earned</h3>
            <p>This landmark is marked on your map.</p>
            <a href="#trail-map">Back to the map ↑</a>
          </div>
        </div>
      ) : (
        question && (
          <>
            <h3>Which lesson does this passage come from?</h3>
            <blockquote>{question.excerpt}</blockquote>
            <div className="mission-answers">
              {question.options.map((option) => (
                <button
                  key={option}
                  onClick={() => {
                    if (option !== question.answer) {
                      setFeedback(
                        'Try again. Look for a clue in the passage or open the source hint.',
                      )
                    } else {
                      setEarnedHere(true)
                      onStamp()
                    }
                  }}
                >
                  {option}
                </button>
              ))}
            </div>
            {question.hint && (
              <button
                className="mission-hint"
                onClick={() => onSource(question.hint)}
              >
                Open source hint
              </button>
            )}
            <p role="status" className="mission-feedback">
              {feedback}
            </p>
          </>
        )
      )}
    </section>
  )
}
