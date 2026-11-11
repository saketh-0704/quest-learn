import { Link } from 'react-router'

export function BrandLink() {
  return (
    <Link to="/" className="nb-brand">
      <img
        src={import.meta.env.BASE_URL + 'questlearn.svg'}
        alt=""
        width="24"
        height="24"
      />
      <span>
        QuestLearn
        <span className="brand-dot" aria-hidden="true">
          .
        </span>
      </span>
    </Link>
  )
}
