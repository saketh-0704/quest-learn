import type { Source } from '../../services/api/notebooks'

export function Citations({
  sources,
  onSelect,
}: {
  sources: Source[]
  onSelect: (source: Source) => void
}) {
  return (
    <div className="nb-citations">
      {sources.map((source, index) => (
        <button
          type="button"
          key={source.chunk_id}
          onClick={() => onSelect(source)}
          aria-label={`Read source ${index + 1}: ${source.filename}${source.page_number ? ` page ${source.page_number}` : ''}`}
        >
          <span aria-hidden="true">{index + 1}</span>
          {source.filename}
          {source.page_number ? ` · p. ${source.page_number}` : ''}
        </button>
      ))}
    </div>
  )
}
