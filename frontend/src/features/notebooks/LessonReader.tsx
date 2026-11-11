import { useState } from 'react'
import type { Material, Source } from '../../services/api/notebooks'
import { Citations } from './Citations'

export function LessonReader({
  material,
  onSource,
}: {
  material: Material
  onSource: (source: Source) => void
}) {
  const [selectedTopic, setSelectedTopic] = useState(0)
  const topics = material.topics ?? []
  const lesson = topics[selectedTopic] ?? material
  return (
    <div className={'lesson-desk' + (topics.length ? ' has-topics' : '')}>
      {topics.length > 0 && (
        <nav className="topic-outline" aria-label="Topic lessons">
          <span className="nb-label">In this chapter</span>
          {topics.map((topic, index) => (
            <button
              key={index}
              aria-pressed={index === selectedTopic}
              onClick={() => setSelectedTopic(index)}
            >
              <span>{String(index + 1).padStart(2, '0')}</span>
              {topic.title}
            </button>
          ))}
        </nav>
      )}
      <article className="lesson-page" aria-label={lesson.title}>
        <div className="lesson-content" key={selectedTopic}>
          <div className="lesson-page-top">
            <span className="nb-label">
              {topics.length
                ? `Topic ${selectedTopic + 1} of ${topics.length}`
                : 'Your study guide'}
            </span>
            <span aria-hidden="true">✧</span>
          </div>
          <h2>{lesson.title}</h2>
          <div className="lesson-copy">
            {lesson.answer
              .split(/\n\s*\n/)
              .filter(Boolean)
              .map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
          </div>
          {lesson.sources.length > 0 && (
            <div className="lesson-references">
              <h3>From your document</h3>
              <Citations sources={lesson.sources} onSelect={onSource} />
            </div>
          )}
        </div>
        {topics.length > 1 && (
          <div className="lesson-pagination">
            <button
              disabled={selectedTopic === 0}
              onClick={() => setSelectedTopic((i) => i - 1)}
            >
              ← Previous topic
            </button>
            <button
              disabled={selectedTopic === topics.length - 1}
              onClick={() => setSelectedTopic((i) => i + 1)}
            >
              Next topic →
            </button>
          </div>
        )}
      </article>
    </div>
  )
}
